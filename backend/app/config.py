"""Настройки платформы «Код Новороссии». Всё переопределяется переменными окружения."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Файл .env в корне проекта (KEY=значение) — удобно хранить ключи, не трогая код. Переменные окружения важнее.
_env = BASE_DIR.parent / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        if "=" in _line and not _line.lstrip().startswith("#"):
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", BASE_DIR / "media"))
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
WEB_DIST = Path(os.getenv("WEB_DIST", BASE_DIR.parent / "web" / "dist"))

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'kod.db'}")
SECRET_KEY = os.getenv("SECRET_KEY", "kod-novorossii-dev-secret-change-me-in-production")
TOKEN_TTL_HOURS = int(os.getenv("TOKEN_TTL_HOURS", "72"))
TIMEZONE = os.getenv("TZ_NAME", "Europe/Moscow")
# DEMO_MODE: показывает демо-аккаунты и текущие 2FA-коды на странице входа (для жюри). В проде — false.
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
SITE_URL = os.getenv("SITE_URL", "http://localhost:8000")

# Яндекс Карты на сайте: ключ JavaScript API (https://developer.tech.yandex.ru → «JavaScript API и HTTP Геокодер»).
# Ключ проекта вписан по умолчанию; свой можно задать в .env (YANDEX_MAPS_KEY=...). Пустое значение в .env — карта OpenStreetMap.
YANDEX_MAPS_KEY = os.getenv("YANDEX_MAPS_KEY", "16cd06bb-bd28-4d38-9389-4d02acec42a2")

# Чат-бот на GigaChat (Сбер). Ключ авторизации — developers.sber.ru → проект GigaChat API → «Получить ключ».
# Впишите в .env: GIGACHAT_AUTH_KEY=...  Подробно — в backend/app/gigachat.py.
GIGACHAT_AUTH_KEY = os.getenv("GIGACHAT_AUTH_KEY", "").strip()
GIGACHAT_SCOPE = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")   # для юрлиц: GIGACHAT_API_B2B / GIGACHAT_API_CORP
GIGACHAT_MODEL = os.getenv("GIGACHAT_MODEL", "GigaChat")            # или GigaChat-Pro / GigaChat-Max
GIGACHAT_VERIFY_SSL = os.getenv("GIGACHAT_VERIFY_SSL", "auto")      # auto | true | false | путь к сертификату Минцифры

# Опционально: другой LLM для чат-бота (любой OpenAI-совместимый API: GigaChat-прокси, YandexGPT-прокси, локальная модель)
LLM_API_URL = os.getenv("LLM_API_URL", "")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")

SERVICE_ROLES = {"curator", "moderator", "admin"}  # для них обязательна 2FA
ROLE_TITLES = {
    "user": "Пользователь",
    "owner": "Владелец бизнеса",
    "curator": "Куратор «одного окна»",
    "moderator": "Модератор",
    "admin": "Администратор",
}
REVIEW_COMPLAINT_SLA_HOURS = 24
VERIFICATION_SLA_WORKDAYS = 3
GEO_CHECKIN_RADIUS_M = 300
