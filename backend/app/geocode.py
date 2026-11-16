"""Точные координаты мест через Яндекс HTTP Геокодер (тот же ключ, что у карт: «JavaScript API и HTTP Геокодер»).

При запуске сервера в фоне по адресу каждого места запрашиваются координаты; ответ проверяется (точность и расстояние
от примерной точки — защита от «уехавших» меток) и сохраняется в backend/geocache.json. Дальше сервер берёт координаты
из кэша сразу — интернет для этого уже не нужен. Если кэш нужно пересчитать — удалите geocache.json и перезапустите сервер.
Точку любого места можно поправить и вручную: панель управления → Объекты → координаты (или клик по карте в кабинете владельца).
"""
import json
import logging
import math
import re
import threading

import httpx

from .config import BASE_DIR, YANDEX_MAPS_KEY

log = logging.getLogger("geocode")
CACHE = BASE_DIR / "geocache.json"
URL = "https://geocode-maps.yandex.ru/1.x/"
GOOD_PRECISION = {"exact", "number", "near", "range", "street", "other"}
HOUSE_PRECISION = {"exact", "number", "near"}


def _load() -> dict:
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _dist_km(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


# Для мест без точного адреса — понятный геокодеру запрос; None — не геокодировать (точка выставлена вручную)
QUERIES = {
    "Бульвар Пушкина": "Донецк, бульвар Пушкина",
    "Площадь Ленина": "Донецк, площадь Ленина",
    "Парк им. Щербакова": "Донецк, парк имени Щербакова",
    "Набережная реки Кальмиус": None,
    "Детская железная дорога": None,
    "Спорткомплекс «Олимпийский»": None,
    "Центр «Мой бизнес»": None,
    "Мемориал «Саур-Могила»": "Донецкая Народная Республика, Саур-Могила",
    "Мариупольский драматический театр": "Мариуполь, Театральная площадь",
    "Приморский бульвар Мариуполя": "Мариуполь, Приморский бульвар",
    "Белосарайский маяк": None,
    "Седово — родина полярника Г. Седова": "Донецкая Народная Республика, посёлок Седово",
    "Пляжи Безыменного": "Донецкая Народная Республика, село Безыменное",
    "Коса Лукоморье": None,
    "Дом Джона Юза": None,
    "Художественный музей «Арт-Донбасс»": None,
}


def query_for(p) -> str | None:
    """Строка для геокодера: из QUERIES или «город, адрес». None — не геокодировать."""
    attrs = p.attrs or {}
    if "geo" in attrs:
        return attrs["geo"] or None
    if p.name in QUERIES:
        return QUERIES[p.name]
    addr = re.sub(r"\(.*?\)", "", p.address or "").strip(" ,")
    if not addr or addr.lower() in ("г. донецк", "донецк"):
        return None
    if p.city and p.city.lower() not in addr.lower() and p.city not in ("Приазовье",):
        addr = f"{p.city}, {addr}"
    return addr


def apply_cached(db) -> int:
    """Подставляет координаты из кэша. Вызывается при заполнении базы и после фонового геокодирования."""
    from .models import Place
    cache, n = _load(), 0
    for p in db.query(Place).all():
        q = query_for(p)
        hit = cache.get(q) if q else None
        if hit and hit.get("ok") and (abs(p.lat - hit["lat"]) > 1e-6 or abs(p.lng - hit["lng"]) > 1e-6):
            p.lat, p.lng = hit["lat"], hit["lng"]
            n += 1
    if n:
        db.commit()
    return n


def _geocode(q: str, near: tuple[float, float]) -> dict:
    r = httpx.get(URL, timeout=10, params={
        "apikey": YANDEX_MAPS_KEY, "geocode": q, "format": "json", "lang": "ru_RU", "results": 1,
        "ll": f"{near[1]},{near[0]}", "spn": "0.6,0.6"})
    r.raise_for_status()
    members = r.json()["response"]["GeoObjectCollection"]["featureMember"]
    if not members:
        return {"ok": False, "why": "не найдено"}
    g = members[0]["GeoObject"]
    lng, lat = map(float, g["Point"]["pos"].split())
    meta = g["metaDataProperty"]["GeocoderMetaData"]
    return {"lat": lat, "lng": lng, "precision": meta.get("precision"), "kind": meta.get("kind"), "text": meta.get("text"), "ok": True}


def run(session_factory):
    """Фоновое уточнение координат всех мест, которых ещё нет в кэше."""
    if not YANDEX_MAPS_KEY:
        return
    from .models import Place
    db = session_factory()
    try:
        cache, changed, moved = _load(), False, 0
        for p in db.query(Place).all():
            q = query_for(p)
            if not q or q in cache:
                continue
            try:
                res = _geocode(q, (p.lat, p.lng))
            except Exception as e:  # нет сети / ключ не принят — попробуем при следующем запуске
                log.warning("Геокодер недоступен: %s", e)
                break
            if res.get("ok"):
                limit = (p.attrs or {}).get("geo_max_km", 4 if p.city == "Донецк" else 25)
                d = _dist_km((p.lat, p.lng), (res["lat"], res["lng"]))
                house = bool(re.search(r"\d", q.split(",")[-1]))  # адрес с номером дома — нужна точность до дома
                good = res.get("precision") in (HOUSE_PRECISION if house else GOOD_PRECISION)
                if not good or d > limit:
                    res = {**res, "ok": False, "why": f"неточно ({res.get('precision')}) или далеко ({d:.1f} км)"}
            cache[q] = res
            changed = True
            if res.get("ok"):  # обновляем только что уточнённые места (ручные правки других мест не трогаем)
                p.lat, p.lng = res["lat"], res["lng"]
                moved += 1
        if changed:
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        db.commit()
        n = moved
        if n:
            from .search import rebuild_index
            rebuild_index(db)
            log.info("Уточнены координаты: %s мест", n)
    finally:
        db.close()


def start_background(session_factory):
    import os
    if os.getenv("GEOCODE_OFF"):
        return
    threading.Thread(target=run, args=(session_factory,), daemon=True, name="geocode").start()
