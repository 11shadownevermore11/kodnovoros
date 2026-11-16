"""Защита: очистка входных данных от XSS, заголовки безопасности (CSP и др.), ограничение попыток входа.

SQL-инъекции: все запросы к базе идут через SQLAlchemy ORM с параметрами (нет склейки SQL из строк),
сортировки и фильтры — только из белых списков. Тесты в tests/test_security.py пытаются сломать это намеренно.
XSS: (1) React и Compose экранируют весь вывод; (2) этот модуль вычищает HTML-теги и опасные ссылки из ЛЮБЫХ
JSON-запросов к API до того, как данные попадут в базу; (3) Content-Security-Policy запрещает чужие скрипты
и inline-скрипты; (4) серверная подстановка SEO-тегов экранирует всё, включая JSON-LD.
"""
import base64
import hashlib
import json
import re
import time
from collections import defaultdict, deque

from fastapi import HTTPException

TAG = re.compile(r"<\s*/?\s*[a-zA-Z!][^>]*>")          # любые HTML-теги и комментарии
DANGEROUS_URL = re.compile(r"^\s*(javascript|vbscript|data|file)\s*:", re.I)
COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# поля, которые не трогаем (пароли и коды могут содержать любые символы)
RAW_KEYS = {"password", "new_password", "old_password", "totp", "code", "token", "setup_token", "secret"}
URL_KEYS = {"website", "url", "photo", "photos", "image", "doc_file", "avatar", "audio", "video", "file"}
COLOR_KEYS = {"color"}
MAX_LEN = 20000


def safe_url(u: str) -> str:
    """Разрешены только http(s), mailto, tel и относительные пути сайта. Остальное (javascript:, data: …) — пустая строка."""
    u = (u or "").strip()
    if not u:
        return ""
    if DANGEROUS_URL.match(u) or u.startswith("//"):
        return ""
    if re.match(r"^(https?://|mailto:|tel:|/|#)", u, re.I):
        return u.replace('"', "%22").replace("<", "%3C").replace(">", "%3E")
    if re.match(r"^[\w.-]+\.[a-z]{2,}(/.*)?$", u, re.I):   # «site.ru» без схемы
        return "https://" + u
    return ""


def clean_text(s: str) -> str:
    s = CONTROL.sub("", s)
    prev = None
    while prev != s:                       # снимаем вложенные/разорванные теги вида <scr<script>ipt>
        prev, s = s, TAG.sub("", s)
    return s[:MAX_LEN]


def clean(value, key: str = ""):
    k = key.lower()
    if isinstance(value, dict):
        return {kk: clean(vv, kk) for kk, vv in value.items()}
    if isinstance(value, list):
        return [clean(v, key) for v in value]
    if isinstance(value, str):
        if k in RAW_KEYS:
            return value
        if k in URL_KEYS:
            return safe_url(clean_text(value))
        if k in COLOR_KEYS:
            return value if COLOR.match(value.strip()) else "#1B4FA3"
        return clean_text(value)
    return value


class SanitizeJSONMiddleware:
    """ASGI-прослойка: очищает тело всех JSON-запросов POST/PUT/PATCH к /api до обработчиков."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH") or not scope["path"].startswith("/api/") or scope["path"].startswith("/api/v1/"):
            return await self.app(scope, receive, send)
        ctype = dict(scope["headers"]).get(b"content-type", b"").decode("latin-1")
        if "application/json" not in ctype:
            return await self.app(scope, receive, send)
        body, more = b"", True
        while more:
            msg = await receive()
            body += msg.get("body", b"")
            more = msg.get("more_body", False)
            if len(body) > 5 * 1024 * 1024:
                break
        try:
            body = json.dumps(clean(json.loads(body)), ensure_ascii=False).encode()
        except Exception:
            pass  # невалидный JSON — пусть FastAPI сам вернёт 422
        headers = [(k, v) for k, v in scope["headers"] if k != b"content-length"] + [(b"content-length", str(len(body)).encode())]
        scope = dict(scope, headers=headers)
        done = False

        async def replay():
            nonlocal done
            if not done:
                done = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


# ---------- Заголовки безопасности ----------
YANDEX = "https://*.yandex.ru https://*.yandex.net https://yandex.ru https://yastatic.net https://*.yastatic.net https://api-maps.yandex.ru"


def csp(inline_hashes: list[str]) -> str:
    hashes = " ".join(f"'sha256-{h}'" for h in inline_hashes)
    return "; ".join([
        "default-src 'self'",
        # 'unsafe-eval' нужен JavaScript API Яндекс Карт (шаблоны меток); inline-скрипты — только по хэшу
        f"script-src 'self' {hashes} 'unsafe-eval' {YANDEX}",
        f"style-src 'self' 'unsafe-inline' {YANDEX}",
        "img-src 'self' data: blob: https:",
        f"font-src 'self' data: {YANDEX}",
        f"connect-src 'self' {YANDEX}",
        f"frame-src {YANDEX}",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


def inline_script_hashes(html: str) -> list[str]:
    out = []
    for m in re.finditer(r"<script(?![^>]*\bsrc=)(?![^>]*application/ld\+json)[^>]*>(.*?)</script>", html, re.S | re.I):
        out.append(base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode())
    return out


def security_headers(path: str, policy: str) -> dict:
    h = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
        "Cross-Origin-Opener-Policy": "same-origin",
    }
    if not path.startswith("/docs") and not path.startswith("/redoc"):
        h["Content-Security-Policy"] = policy
    if path.startswith("/media/") or path.startswith("/photos/"):
        # загруженные файлы: никогда не исполнять как страницу
        h["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
        h["Content-Disposition"] = "inline"
    return h


# ---------- Ограничение попыток входа ----------
_attempts: dict[str, deque] = defaultdict(deque)
LIMIT, WINDOW = 10, 300  # 10 неудачных попыток за 5 минут


def check_rate(key: str):
    q = _attempts[key]
    now = time.time()
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        raise HTTPException(429, "Слишком много попыток. Подождите несколько минут.")


def note_failure(key: str):
    _attempts[key].append(time.time())


def reset_rate(key: str):
    _attempts.pop(key, None)


# ---------- Проверка загружаемых файлов по содержимому ----------
MAGIC = {
    ".jpg": [b"\xff\xd8\xff"], ".jpeg": [b"\xff\xd8\xff"], ".png": [b"\x89PNG\r\n\x1a\n"], ".gif": [b"GIF87a", b"GIF89a"],
    ".webp": [b"RIFF"], ".pdf": [b"%PDF-"], ".mp3": [b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"], ".m4a": [b"\x00\x00\x00"],
}


def file_matches(ext: str, content: bytes) -> bool:
    sigs = MAGIC.get(ext)
    if not sigs or not any(content.startswith(s) for s in sigs):
        return False
    if ext == ".webp" and content[8:12] != b"WEBP":
        return False
    head = content[:2048].lower()
    return b"<script" not in head and b"<html" not in head and b"<svg" not in head
