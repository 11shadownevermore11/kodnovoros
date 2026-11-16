"""Same-origin gateway to the separate BizBoard API."""
import os

import httpx
from fastapi import APIRouter, FastAPI, Request
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import JSONResponse, Response

router = APIRouter(include_in_schema=False)


async def open_connection(app: FastAPI):
    upstream = os.getenv("BIZBOARD_URL", "http://127.0.0.1:8001")
    app.state.bizboard = httpx.AsyncClient(
        base_url=upstream, timeout=12, trust_env=False,
    )


@router.get("/docs/bizboard")
async def docs():
    return get_swagger_ui_html(openapi_url="/docs/bizboard/openapi.json", title="BizBoard — Swagger UI")


@router.get("/docs/bizboard/openapi.json")
async def schema(request: Request):
    return await forward(request, "/openapi.json")


@router.api_route("/api/v1/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
async def api(request: Request, path: str):
    if any(part in {".", ".."} for part in path.split("/")):
        return JSONResponse({"error": {"message": "Маршрут не найден"}}, status_code=404)
    # Strip caller-supplied forwarding headers. BizBoard rate-limits by client IP.
    return await forward(request, request.url.path)


async def forward(request: Request, path: str):
    headers = {
        name: request.headers[name]
        for name in ("authorization", "content-type", "user-agent", "x-telegram-bot-api-secret-token")
        if name in request.headers
    }
    if request.client:
        headers["x-real-ip"] = request.client.host
    try:
        result = await request.app.state.bizboard.request(
            request.method, path, params=request.query_params.multi_items(),
            content=await request.body(), headers=headers,
        )
    except httpx.RequestError:
        return JSONResponse(
            {"error": {"message": "Сервис объявлений временно недоступен"}},
            status_code=503,
            headers={"Cache-Control": "no-store"},
        )
    response_headers = {"Cache-Control": "no-store"}
    for name in ("content-type", "www-authenticate", "retry-after"):
        if name in result.headers:
            response_headers[name] = result.headers[name]
    return Response(result.content, status_code=result.status_code, headers=response_headers)
