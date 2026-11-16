"""Тесты безопасности: SQL-инъекции, XSS, обход путей, подбор пароля, загрузка файлов. python -m pytest -q"""
import os
import tempfile

os.environ.setdefault("DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db"))
os.environ["DEMO_MODE"] = "true"
os.environ["GEOCODE_OFF"] = "1"

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.safety import clean, safe_url


@pytest.fixture(scope="module")
def c():
    with TestClient(app) as client:
        yield client


def auth(c, email):
    r = c.post("/api/auth/login", json={"email": email, "password": "demo123"}).json()
    return {"Authorization": f"Bearer {r['token']}"}


SQLI = ["' OR 1=1 --", "\" OR \"\"=\"", "1; DROP TABLE places; --", "' UNION SELECT password_hash FROM users --", "%' AND 1=1 AND '%'='"]


def test_sql_injection_search_and_login(c):
    total = c.get("/api/places", params={"limit": 200}).json()["total"]
    for s in SQLI:
        r = c.get("/api/places", params={"q": s, "sort": s, "vertical": s, "category": s})
        assert r.status_code == 200
        assert r.json()["total"] < total  # инъекция не «открывает» всю таблицу
        assert c.post("/api/auth/login", json={"email": s, "password": s}).status_code in (401, 429)
    assert c.get("/api/places", params={"limit": 200}).json()["total"] == total  # таблица цела


def test_xss_stripped_from_input(c):
    assert clean({"text": "<script>alert(1)</script>Привет<img src=x onerror=alert(1)>"})["text"] == "alert(1)Привет"
    assert "<" not in clean({"text": "<scr<script>ipt>alert(1)</script>"})["text"]
    assert clean({"website": "javascript:alert(1)"})["website"] == ""
    assert clean({"photos": ["/media/a.jpg", "data:text/html;base64,xx"]})["photos"] == ["/media/a.jpg", ""]
    assert clean({"color": "red;background:url(x)"})["color"] == "#1B4FA3"
    assert clean({"password": "<p@ss>"})["password"] == "<p@ss>"
    assert safe_url("site.ru") == "https://site.ru"

    h = auth(c, "user@kod.ru")
    pid = c.get("/api/places", params={"q": "ботанический"}).json()["items"][0]["id"]
    r = c.post(f"/api/places/{pid}/reviews", json={"rating": 5, "text": "<script>alert('xss')</script>Красиво!"}, headers=h)
    assert r.status_code == 200
    reviews = c.get(f"/api/places/{pid}").json()["reviews"]
    assert all("<script" not in x["text"] for x in reviews)


def test_owner_cannot_inject_script_or_js_link(c):
    h = auth(c, "owner@kod.ru")
    place = c.get("/api/places/restoran-na-pechi").json()
    r = c.patch(f"/api/owner/places/{place['id']}", headers=h,
                json={"name": "На Печи</script><script>alert(1)</script>", "website": "javascript:alert(document.cookie)"})
    assert r.status_code == 200
    p = r.json()
    assert "<script" not in p["name"] and p["website"] == ""
    page = c.get(f"/place/{p['slug']}").text
    assert "<script>alert" not in page


def test_seo_path_is_escaped(c):
    r = c.get('/place/x"><script>alert(1)</script>')
    assert "<script>alert(1)</script>" not in r.text


def test_security_headers_and_traversal(c):
    r = c.get("/")
    assert "default-src 'self'" in r.headers.get("content-security-policy", "")
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert r.headers.get("x-frame-options") == "DENY"
    for bad in ["/..%2f..%2fbackend%2fapp%2fconfig.py", "/../backend/app/config.py", "/%2e%2e/%2e%2e/backend/app/config.py"]:
        assert "SECRET_KEY" not in c.get(bad).text


def test_upload_checks_content(c):
    h = auth(c, "user@kod.ru")
    fake = c.post("/api/upload", headers=h, files={"file": ("x.jpg", b"<html><script>alert(1)</script></html>", "image/jpeg")})
    assert fake.status_code == 400
    ok = c.post("/api/upload", headers=h, files={"file": ("x.png", b"\x89PNG\r\n\x1a\n" + b"0" * 64, "image/png")})
    assert ok.status_code == 200


def test_login_rate_limit(c):
    codes = [c.post("/api/auth/login", json={"email": "admin@kod.ru", "password": "wrong"}).status_code for _ in range(12)]
    assert 429 in codes
