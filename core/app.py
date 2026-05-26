"""
EmotionTTS Web 中枢入口：FastAPI 应用、静态资源挂载、首页渲染。
"""
import os
import sys
import time
import asyncio

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

APP_DIR: str = os.path.dirname(os.path.abspath(__file__))
sys.path.append(APP_DIR)
PROJECT_ROOT: str = os.path.abspath(os.path.join(APP_DIR, ".."))

CHARACTERS_DIR: str = os.path.join(PROJECT_ROOT, "characters")
OUTPUTS_DIR: str = os.path.join(PROJECT_ROOT, "outputs")
FRONTEND_DIR: str = os.path.join(APP_DIR, "frontend")

os.makedirs(CHARACTERS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)

# 路由模块
from routers.config_router import router as config_router
from routers.char_router import router as char_router
from routers.tts_router import router as tts_router


app = FastAPI(title="EmotionTTS Client UI")


@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    """
    Business Logic（为什么需要这个函数）:
        热更新前端时浏览器可能强缓存旧 JS/CSS，导致用户看不到最新功能；
        全局禁缓存避免支持成本。

    Code Logic（这个函数做什么）:
        在每个响应头插入 Cache-Control: no-store。
    """
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# 静态资源
app.mount("/outputs", StaticFiles(directory=OUTPUTS_DIR), name="outputs")
app.mount("/characters", StaticFiles(directory=CHARACTERS_DIR), name="characters")
app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")

# API 路由
app.include_router(config_router)
app.include_router(char_router)
app.include_router(tts_router)


def _serve_html(filename: str) -> HTMLResponse:
    """
    Business Logic（为什么需要这个函数）:
        index.html 与 lite.html 都需要"读文件 + 给 js/css 引用追加时间戳"防缓存，
        抽出来避免重复。

    Code Logic（这个函数做什么）:
        读 frontend/{filename}；为所有 .js" / .css" 引用追加 ?t=<timestamp>。
        文件不存在返回 404。
    """
    html_path = os.path.join(FRONTEND_DIR, filename)
    if not os.path.exists(html_path):
        return HTMLResponse(content=f"<h2>找不到 {filename}</h2>", status_code=404)

    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()

    t = int(time.time())
    html = html.replace('.js"', f'.js?t={t}"').replace('.css"', f'.css?t={t}"')
    return HTMLResponse(content=html, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})


@app.get("/")
def serve_frontend() -> HTMLResponse:
    return _serve_html("index.html")


@app.get("/lite.html")
def serve_lite_frontend() -> HTMLResponse:
    return _serve_html("lite.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    icon_path = os.path.join(FRONTEND_DIR, "favicon.ico")
    if os.path.exists(icon_path):
        return FileResponse(icon_path, media_type="image/x-icon")
    return HTMLResponse(status_code=404)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    port = int(os.environ.get("APP_PORT", 9880))
    print(f"🚀 EmotionTTS Web 中枢已启动: http://127.0.0.1:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
