"""Чат-бот «Гид»: помощник по работе с платформой и по поиску мест.
Сначала бот сам понимает запрос (интенты + поиск по базе + генератор маршрутов) и находит реальные места, события
и маршрут. Затем, если подключён GigaChat (GIGACHAT_AUTH_KEY в .env), GigaChat пишет живой ответ строго по найденным
данным и каталогу платформы (RAG) — без выдуманных мест. Без GigaChat бот отвечает сам."""
import re
from datetime import timedelta

import httpx

from . import gigachat
from .config import LLM_API_URL, LLM_API_KEY, LLM_MODEL
from .content import FAQ, EVENT_KINDS
from .models import Event, Place
from .queries import find_places
from .routes_engine import generate
from .search import normalize
from .utils import local_now, event_dict

STOP = set("""где найти найди покажи показать хочу хотим мне нам рядом сейчас какие какой какая есть лучшие лучший хороший
хорошее посоветуй посоветуйте подскажи подскажите куда сходить пойти можно ли в на с и по для что это мы я бы недалеко
поблизости около открыто открытые открыт открытый недорого недорогой недорогие дешево бесплатно бесплатные бесплатный
пожалуйста плиз сегодня завтра город городе донецке донецк интересное интересные""".split())

VERTICAL_HINTS = {
    "creative": ["креатив", "студи", "дизайн", "арт", "it", "айти", "кино", "музык", "мода", "архитектур"],
    "industry": ["завод", "фабрик", "предприят", "промышл", "дегустац", "сделано в регионе", "производств"],
    "maritime": ["мор", "приазов", "маяк", "мариупол", "аудиогид"],
    "investment": ["инвест", "площадк", "технопарк"],
}

SUGGESTIONS = ["Где поесть рядом?", "Маршрут на 3 часа", "Что интересного на выходных?", "Как добавить свой бизнес?",
               "Музеи, открытые сейчас", "Промокоды партнёров"]


def plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def _faq(m: str):
    for keys, answer, actions in FAQ:
        if any(k in m for k in keys):
            return answer, actions
    return None


SYSTEM = ("Ты — Гид платформы «Код Новороссии», дружелюбный помощник туриста и жителя ДНР (Донецк, Мариуполь, Приазовье). "
          "Отвечай по-русски, тепло и по делу, 2–5 предложений, можно короткий список. Называй места ТОЛЬКО из блоков "
          "«Найдено» и «Каталог платформы» — ничего не выдумывай: ни мест, ни адресов, ни цен, ни часов работы. "
          "Если в каталоге нет подходящего — честно скажи и предложи похожее из каталога. Не используй markdown-заголовки. "
          "Если есть маршрут или события — опирайся на них. Можно коротко рассказать историю места, если она есть в описании.")


def _catalog(db) -> str:
    rows = db.query(Place).filter(Place.moderation == "published").all()
    return "\n".join(f"- {p.name} — {p.category.name if p.category else ''}, {p.city}, {p.address}. {p.short or ''}" for p in rows)


def _llm(db, message: str, draft: str, found: str, history: list[dict] | None) -> tuple[str | None, str]:
    """Ответ языковой модели по найденным данным. Возвращает (текст, источник)."""
    user = (f"Вопрос пользователя: {message}\n\nНайдено по запросу:\n{found or '—'}\n\n"
            f"Черновик ответа бота: {draft}\n\nКаталог платформы:\n{_catalog(db)}")
    msgs = [{"role": "system", "content": SYSTEM}]
    for h in (history or [])[-6:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            msgs.append({"role": h["role"], "content": str(h["content"])[:800]})
    msgs.append({"role": "user", "content": user})
    if gigachat.enabled():
        text = gigachat.complete(msgs)
        return (text, "gigachat") if text else (None, "")
    if not LLM_API_URL:
        return None, ""
    try:
        r = httpx.post(f"{LLM_API_URL.rstrip('/')}/chat/completions", timeout=15,
                       headers={"Authorization": f"Bearer {LLM_API_KEY}"} if LLM_API_KEY else {},
                       json={"model": LLM_MODEL, "temperature": 0.3, "messages": msgs})
        return r.json()["choices"][0]["message"]["content"].strip(), "llm"
    except Exception:
        return None, ""


def chat(db, message: str, lat=None, lng=None, history: list[dict] | None = None) -> dict:
    out = _rule_chat(db, message, lat, lng)
    if out.pop("_skip_llm", False):
        return out
    found = []
    for p in out["places"]:
        found.append(f"- место: {p['name']} ({p['category']['name'] if p.get('category') else ''}), {p['address']}, рейтинг {p['rating']}"
                     + (f", {p['distance_m']} м от пользователя" if p.get("distance_m") is not None else ""))
    for e in out["events"]:
        found.append(f"- событие: {e['title']}, {e['start'][:16].replace('T', ' ')}" + (f", {e['place']['name']}" if e.get("place") else ""))
    if out.get("route"):
        found.append("- маршрут: " + " → ".join(f"{s['arrive']} {s['name']}" for s in out["route"]["stops"]))
    better, source = _llm(db, message, out["reply"], "\n".join(found), history)
    if better:
        out["reply"], out["source"] = better, source
    return out


def _rule_chat(db, message: str, lat=None, lng=None) -> dict:
    m = normalize(message)
    out = {"reply": "", "places": [], "events": [], "route": None, "actions": [], "suggestions": []}

    if re.fullmatch(r"\s*(привет|здравствуй\w*|добрый \w+|hi|hello|хай|начать|старт)\W*\s*", m):
        out["reply"] = ("Привет! Я Гид платформы «Код Новороссии». Помогу найти место, собрать маршрут, подсказать "
                        "события и объясню, как работает платформа. Спросите что-нибудь!")
        out["suggestions"] = SUGGESTIONS
        out["_skip_llm"] = True
        return out

    # 1. Маршрут
    if "маршрут" in m or "прогул" in m and ("час" in m or "ч " in m):
        hm = re.search(r"(\d+[.,]?\d*)\s*(час|ч\b)", m)
        hours = float(hm.group(1).replace(",", ".")) if hm else 3
        interests = [v for v, keys in VERTICAL_HINTS.items() if any(k in m for k in keys) and v != "investment"]
        if "музе" in m:
            interests.append("museum")
        if "парк" in m:
            interests.append("park")
        route = generate(db, hours, interests, lat, lng, include_food=hours >= 2.5)
        if route:
            names = " → ".join(s["place"]["name"] for s in route["stops"])
            out["reply"] = (f"Собрал маршрут на {hours:g} ч: {names}. Протяжённость {route['distance_km']} км, "
                            f"финиш около {route['finish']}. Можно открыть его на карте и сохранить.")
            out["route"] = {k: route[k] for k in ("stops_raw", "duration_min", "distance_km", "finish", "title")}
            out["route"]["stops"] = [{"name": s["place"]["name"], "slug": s["place"]["slug"], "arrive": s["arrive"],
                                      "kind": s["kind"]} for s in route["stops"]]
            out["actions"] = [{"label": "Открыть в конструкторе", "to": "/routes/builder"}]
            return out

    # 2. События
    if any(k in m for k in ["афиш", "событи", "мероприят", "выходн", "концерт", "выставк", "фестивал", "мастер-класс",
                            "мастер класс", "спектакл", "что сегодня", "что завтра", "куда сходить вечером"]):
        now = local_now()
        start, end, when = now - timedelta(hours=3), now + timedelta(days=14), "в ближайшие две недели"
        if "сегодня" in m:
            end, when = now.replace(hour=23, minute=59), "сегодня"
        elif "завтра" in m:
            start = (now + timedelta(days=1)).replace(hour=0, minute=0)
            end, when = start.replace(hour=23, minute=59), "завтра"
        elif "выходн" in m:
            sat = now + timedelta(days=(5 - now.weekday()) % 7)
            start, end, when = sat.replace(hour=0, minute=0), (sat + timedelta(days=1)).replace(hour=23, minute=59), "на выходных"
        q = db.query(Event).filter(Event.moderation == "published", Event.start <= end,
                                   (Event.end >= start) | (Event.start >= start))
        kinds = [k for k, title in EVENT_KINDS.items() if title.lower()[:6] in m]
        if kinds:
            q = q.filter(Event.kind.in_(kinds))
        evs = q.order_by(Event.start).limit(5).all()
        if evs:
            out["reply"] = f"Вот что есть {when}:"
            out["events"] = [event_dict(e, db.get(Place, e.place_id) if e.place_id else None) for e in evs]
        else:
            out["reply"] = f"На {when} событий не нашёл — загляните в полную афишу."
        out["actions"] = [{"label": "Вся афиша", "to": "/events"}]
        return out

    # 3. Помощь по платформе
    is_howto = bool(re.search(r"\b(как|можно ли|что такое|зачем|почему|помоги|помощь|инструкц)\b", m))
    faq = _faq(m)
    if faq and (is_howto or len(m.split()) <= 3):
        out["reply"], out["actions"] = faq
        return out

    # 4. Поиск мест
    words = [w for w in m.split() if w not in STOP and len(w) > 1]
    vertical = next((v for v, keys in VERTICAL_HINTS.items() if any(k in m for k in keys)), None)
    params = dict(lat=lat, lng=lng, limit=5)
    if "открыт" in m or "сейчас" in m:
        params["open_now"] = True
    if "бесплатн" in m:
        params["price_max"] = 0
    elif "недорог" in m or "дешев" in m:
        params["price_max"] = 1
    if "дет" in m:
        params["formats"] = "с детьми"
    if "рядом" in m or "поблизости" in m or "недалеко" in m:
        params["sort"] = "distance" if lat else "popularity"
    if "доступн" in m or "коляск" in m:
        params["accessible"] = True
    q = " ".join(words)
    res = find_places(db, q=q or None, **params) if q else {"items": [], "total": 0}
    if not res["items"] and vertical:
        res = find_places(db, vertical=vertical, sort=params.get("sort", "popularity"), **{k: v for k, v in params.items() if k != "sort"})
    if not res["items"] and not q:
        res = find_places(db, sort="popularity", **{k: v for k, v in params.items() if k != "sort"})
    if res["items"]:
        first = res["items"][0]
        extra = " Показываю открытые сейчас." if params.get("open_now") else ""
        dist = f" — {first['distance_m']} м от вас" if first.get("distance_m") is not None else ""
        out["reply"] = f"Нашёл {res['total']} {plural(res['total'], 'место', 'места', 'мест')}.{extra} Лучшее совпадение — «{first['name']}»{dist}."
        out["places"] = res["items"]
        out["actions"] = [{"label": "Открыть в каталоге", "to": f"/catalog?q={q}"}] if q else []
    elif faq:
        out["reply"], out["actions"] = faq
    else:
        out["reply"] = ("Пока не нашёл ответ. Попробуйте переформулировать: например, «кофейня рядом», "
                        "«маршрут на 2 часа по креативным местам» или «как оставить отзыв».")
        out["suggestions"] = SUGGESTIONS
    return out
