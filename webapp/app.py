"""
EmotionTTS Web 中枢入口：FastAPI 应用 + 静态资源 + 首页。

启动方式：从仓库根运行 `python main.py`，main.py 会负责把仓库根加入 sys.path
并以 uvicorn 拉起本模块的 `app` 实例。
"""
import os
import time

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from webapp.api import characters, config, emotion, openai_compat, synthesis

WEBAPP_DIR: str = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT: str = os.path.abspath(os.path.join(WEBAPP_DIR, ".."))
CHARACTERS_DIR: str = os.path.join(PROJECT_ROOT, "characters")
OUTPUTS_DIR: str = os.path.join(PROJECT_ROOT, "outputs")
FRONTEND_DIR: str = os.path.join(WEBAPP_DIR, "frontend")

os.makedirs(CHARACTERS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)


app = FastAPI(title="EmotionTTS Web 中枢")


@app.middleware("http")
async def no_cache(request: Request, call_next):
    """
    Business Logic（为什么需要这个函数）:
        前端 JS/CSS 热改动时，浏览器缓存会让用户看不到最新效果；本地工作站场景下全局
        禁缓存比"按版本号 cache busting"更稳。

    Code Logic（这个函数做什么）:
        在所有响应头插入 Cache-Control: no-store。
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
app.include_router(config.router)
app.include_router(characters.router)
app.include_router(emotion.router)
app.include_router(synthesis.router)
app.include_router(openai_compat.router)


def _serve_html(filename: str) -> HTMLResponse:
    """
    Business Logic（为什么需要这个函数）:
        index.html / lite.html 都需要"读文件 + 给 js/css 引用追加时间戳"防缓存。

    Code Logic（这个函数做什么）:
        读 frontend/{filename}；把 .js" 与 .css" 引用替换为带 ?t=<unix_ts> 的形式。
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
def serve_index() -> HTMLResponse:
    return _serve_html("index.html")


@app.get("/lite.html")
def serve_lite() -> HTMLResponse:
    return _serve_html("lite.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    icon = os.path.join(FRONTEND_DIR, "favicon.ico")
    if os.path.exists(icon):
        return FileResponse(icon, media_type="image/x-icon")
    return HTMLResponse(status_code=404)
