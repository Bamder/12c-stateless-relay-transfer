from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

_MISSING_DIST_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>12C Client — 尚未构建</title>
  <style>
    body {{ font-family: system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.6; }}
    code {{ background: #f4f4f5; padding: 0.15rem 0.35rem; border-radius: 4px; }}
    pre {{ background: #f4f4f5; padding: 1rem; border-radius: 8px; overflow-x: auto; }}
  </style>
</head>
<body>
  <h1>Client 静态产物未找到</h1>
  <p>分发目录：<code>{static_dir}</code></p>
  <p>Registry 已启动，但尚未挂载 Client Web。请先构建生产包：</p>
  <pre>cd client
.\\build.ps1 -Production</pre>
  <p>构建完成后重启 Registry，再访问本页。</p>
</body>
</html>
"""


def client_dist_ready(static_dir: Path | None) -> bool:
    if static_dir is None:
        return False
    return static_dir.is_dir() and (static_dir / "index.html").is_file()


def request_public_origin(request: Request) -> str:
    forwarded_proto = request.headers.get("x-forwarded-proto")
    forwarded_host = request.headers.get("x-forwarded-host")
    if forwarded_proto and forwarded_host:
        scheme = forwarded_proto.split(",", maxsplit=1)[0].strip()
        host = forwarded_host.split(",", maxsplit=1)[0].strip()
        if scheme and host:
            return f"{scheme}://{host}".rstrip("/")
    return str(request.base_url).rstrip("/")


def mount_client_static(app: FastAPI, static_dir: Path | None) -> bool:
    dist_ready = client_dist_ready(static_dir)

    if dist_ready and static_dir is not None:

        @app.get("/relay.config.json")
        async def embedded_relay_config(request: Request) -> JSONResponse:
            return JSONResponse(
                content={"registry": {"url": request_public_origin(request)}},
            )

        app.mount(
            "/",
            StaticFiles(directory=str(static_dir), html=True),
            name="client",
        )
        return True

    if static_dir is not None:

        @app.get("/")
        async def missing_client_dist() -> HTMLResponse:
            body = _MISSING_DIST_HTML.format(static_dir=static_dir)
            return HTMLResponse(body, status_code=503)

    return False
