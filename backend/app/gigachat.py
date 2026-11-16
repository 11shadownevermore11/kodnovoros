"""GigaChat (Сбер) для чат-бота «Гид».

Как подключить:
  1. developers.sber.ru → «GigaChat API» → создайте проект (для физлиц — тариф Freemium, scope GIGACHAT_API_PERS).
  2. В проекте нажмите «Получить ключ» → скопируйте «Ключ авторизации» (Authorization key — длинная строка в base64).
  3. Впишите его в файл .env в корне проекта:  GIGACHAT_AUTH_KEY=ваш_ключ   и перезапустите сервер (run.bat / run.sh).

Сервер сам получает access token (живёт 30 минут) и обновляет его. Если GigaChat недоступен, бот отвечает
своими силами — поиском по базе, маршрутами и справкой, так что демо никогда не «падает».
"""
import logging
import threading
import time
import uuid

import httpx

from .config import GIGACHAT_AUTH_KEY, GIGACHAT_SCOPE, GIGACHAT_MODEL, GIGACHAT_VERIFY_SSL

log = logging.getLogger("gigachat")
OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
CHAT_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"

_lock = threading.Lock()
_token = {"value": "", "exp": 0.0}
_verify = {"value": None}  # None — ещё не выяснили, нужен ли сертификат Минцифры


def enabled() -> bool:
    return bool(GIGACHAT_AUTH_KEY)


def _verify_opts():
    """Сертификаты GigaChat выданы НУЦ Минцифры. Если корневой сертификат не установлен в системе:
    путь к .pem/.crt в GIGACHAT_VERIFY_SSL — используем его; 'false' — без проверки; 'auto' — пробуем с проверкой, потом без."""
    v = GIGACHAT_VERIFY_SSL.strip()
    if v.lower() in ("false", "0", "no"):
        return [False]
    if v.lower() in ("true", "1", "yes"):
        return [True]
    if v and v.lower() != "auto":
        return [v]
    return [_verify["value"]] if _verify["value"] is not None else [True, False]


def _request(method: str, url: str, **kw) -> httpx.Response:
    last = None
    for verify in _verify_opts():
        try:
            with httpx.Client(verify=verify, timeout=20) as c:
                r = c.request(method, url, **kw)
            if _verify["value"] is None:
                _verify["value"] = verify
                if verify is False:
                    log.warning("GigaChat: соединение без проверки сертификата (не установлен корневой сертификат Минцифры). "
                                "Чтобы включить проверку, укажите путь к нему в GIGACHAT_VERIFY_SSL.")
            return r
        except httpx.ConnectError as e:  # в т.ч. ошибка SSL — пробуем следующий вариант
            last = e
    raise last or RuntimeError("GigaChat недоступен")


def _get_token() -> str:
    with _lock:
        if _token["value"] and _token["exp"] - time.time() > 60:
            return _token["value"]
        r = _request("POST", OAUTH_URL,
                     headers={"Authorization": f"Basic {GIGACHAT_AUTH_KEY}", "RqUID": str(uuid.uuid4()),
                              "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
                     data={"scope": GIGACHAT_SCOPE})
        r.raise_for_status()
        d = r.json()
        _token["value"] = d["access_token"]
        exp = d.get("expires_at", 0)
        _token["exp"] = exp / 1000 if exp > 1e11 else (exp or time.time() + 1700)
        return _token["value"]


def complete(messages: list[dict], temperature: float = 0.4, max_tokens: int = 700) -> str | None:
    """messages: [{"role": "system"|"user"|"assistant", "content": "..."}]. Возвращает текст ответа или None."""
    if not enabled():
        return None
    try:
        tok = _get_token()
        r = _request("POST", CHAT_URL, headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"},
                     json={"model": GIGACHAT_MODEL, "messages": messages, "temperature": temperature,
                           "max_tokens": max_tokens, "repetition_penalty": 1.05})
        if r.status_code == 401:  # токен истёк раньше срока — получаем новый и повторяем один раз
            _token["value"] = ""
            tok = _get_token()
            r = _request("POST", CHAT_URL, headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"},
                         json={"model": GIGACHAT_MODEL, "messages": messages, "temperature": temperature, "max_tokens": max_tokens})
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"].strip()
    except Exception as e:
        log.warning("GigaChat: %s", e)
        return None
