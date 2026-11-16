"""Код Новороссии — единая цифровая платформа туризма ДНР. Точка входа API."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

import os

from .config import MEDIA_DIR, WEB_DIST, DEMO_MODE, SITE_URL
from .safety import SanitizeJSONMiddleware, csp, inline_script_hashes, security_headers
from .db import Base, engine, SessionLocal, get_db
from .routers import auth, public, user, owner, admin, misc, bizboard
from .search import rebuild_index
from . import photos, geocode


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        from .models import Vertical, AuditLog
        from .seed import seed, SEED_VERSION
        marker = db.query(AuditLog).filter(AuditLog.action == "seed").order_by(AuditLog.id.desc()).first()
        if not db.query(Vertical).first():
            seed(db, demo=DEMO_MODE)
        elif DEMO_MODE and (marker is None or marker.entity != f"v{SEED_VERSION}"):
            # демо-данные обновились — пересоздаём демо-базу
            db.close()
            Base.metadata.drop_all(engine)
            Base.metadata.create_all(engine)
            db = SessionLocal()
            seed(db, demo=DEMO_MODE)
        rebuild_index(db)
        photos.write_names_list(db)
        print(f"📷 Свои фото берутся из папки: {photos.PHOTOS_DIR.resolve()}", flush=True)
        geocode.start_background(SessionLocal)  # точные координаты мест через Яндекс Геокодер (в фоне, с кэшем)
    finally:
        db.close()
    await bizboard.open_connection(app)
    try:
        yield
    finally:
        await app.state.bizboard.aclose()


app = FastAPI(title="Код Новороссии API", version="1.0.0", lifespan=lifespan,
              description="Общее API сайта и мобильного приложения: объекты, вертикали, поиск, отзывы, маршруты, "
                          "события, кабинеты владельцев и инвесторов, панель управления.")
# CORS: сайт и API живут на одном адресе, поэтому чужим сайтам доступ к API из браузера не нужен.
# Приложение на телефоне — не браузер, CORS его не касается. Свои домены можно добавить в CORS_ORIGINS через запятую.
_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", f"{SITE_URL},http://localhost:5173,http://127.0.0.1:8000").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   allow_headers=["Authorization", "Content-Type"])
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(SanitizeJSONMiddleware)  # вычищает HTML/скрипты из всех JSON-запросов к API

_index_html = (WEB_DIST / "index.html").read_text(encoding="utf-8") if (WEB_DIST / "index.html").exists() else ""
_CSP = csp(inline_script_hashes(_index_html))


@app.middleware("http")
async def secure_headers(request: Request, call_next):
    resp = await call_next(request)
    for k, v in security_headers(request.url.path, _CSP).items():
        resp.headers[k] = v
    return resp

for r in (auth.router, public.router, user.router, owner.router, admin.router, admin.curator_router, misc.router, bizboard.router):
    app.include_router(r)

app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")
app.mount("/photos", StaticFiles(directory=str(photos.PHOTOS_DIR)), name="photos")  # свои фото — см. photos/README.md


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ---------- Раздача собранного React-приложения с SEO-подстановкой ----------
if WEB_DIST.exists():
    if (WEB_DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(WEB_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str, request: Request, db: Session = Depends(get_db)):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        root = WEB_DIST.resolve()
        f = (WEB_DIST / full_path).resolve()
        if full_path and f.is_file():
            if root not in f.parents:  # защита от выхода за папку сайта: /../../backend/kod.db
                return JSONResponse({"detail": "Not found"}, status_code=404)
            return FileResponse(f)
        template = (WEB_DIST / "index.html").read_text(encoding="utf-8")
        meta = misc.seo_meta(db, "/" + full_path)
        return HTMLResponse(misc.render_index(template, meta, "/" + full_path))
else:
    @app.get("/", include_in_schema=False)
    def root():
        return {"app": "Код Новороссии API", "docs": "/docs",
                "hint": "Соберите веб: cd web && npm i && npm run build — и сайт будет доступен здесь же"}
