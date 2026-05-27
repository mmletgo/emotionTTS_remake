"""
EmotionTTS Web 中枢入口：FastAPI 应用 + 静态资源 + 首页。

启动方式：从仓库根运行 `python main.py`，main.py 会负责把仓库根加入 sys.path
并以 uvicorn 拉起本模块的 `app` 实例。
"""
import os

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

from webapp.api import characters, config, emotion, openai_compat, synthesis

WEBAPP_DIR: str = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT: str = os.path.abspath(os.path.join(WEBAPP_DIR, ".."))
CHARACTERS_DIR: str = os.path.join(PROJECT_ROOT, "characters")
OUTPUTS_DIR: str = os.path.join(PROJECT_ROOT, "outputs")
FRONTEND_DIR: str = os.path.join(WEBAPP_DIR, "frontend")
ASSETS_DIR: str = os.path.join(FRONTEND_DIR, "assets")

os.makedirs(CHARACTERS_DIR, exist_ok=True)
os.makedirs(OUTPUTS_DIR, exist_ok=True)


app = FastAPI(title="EmotionTTS Web 中枢")


@app.middleware("http")
async def no_cache(request: Request, call_next):
    """
    Business Logic（为什么需要这个函数）:
        本地工作站场景，全局禁缓存比"按版本号 cache busting"更稳。

    Code Logic（这个函数做什么）:
        在所有响应头插入 Cache-Control: no-store。
        Vite 构建产物的 assets 已带 hash 文件名，此处统一禁缓存不影响正确性。
    """
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# 静态资源：数据产物
app.mount("/outputs", StaticFiles(directory=OUTPUTS_DIR), name="outputs")
app.mount("/characters", StaticFiles(directory=CHARACTERS_DIR), name="characters")

# 静态资源：Vite 构建产物（assets 目录，构建后才存在）
if os.path.isdir(ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

# API 路由
app.include_router(config.router)
app.include_router(characters.router)
app.include_router(emotion.router)
app.include_router(synthesis.router)
app.include_router(openai_compat.router)


def _build_not_ready_html() -> str:
    """
    Business Logic（为什么需要这个函数）:
        前端 Vite 构建产物尚未生成时，访问根路由应返回友好提示而非 500。

    Code Logic（这个函数做什么）:
        返回一段静态 HTML 字符串，提示用户先执行 npm run build 或 npm run dev。
    """
    return """<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EmotionTTS — 前端未就绪</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e2230; border-radius: 12px; padding: 40px 48px; max-width: 480px;
            box-shadow: 0 4px 24px rgba(0,0,0,.4); text-align: center; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    p  { color: #94a3b8; line-height: 1.6; margin-bottom: 20px; }
    code { background: #2d3347; border-radius: 6px; padding: 2px 8px;
           font-family: monospace; font-size: .9rem; color: #7dd3fc; }
    .steps { text-align: left; list-style: none; padding: 0; }
    .steps li { padding: 6px 0; border-bottom: 1px solid #2d3347; }
    .steps li:last-child { border-bottom: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>EmotionTTS</h1>
    <p>前端构建产物尚未生成，请先运行以下命令：</p>
    <ul class="steps">
      <li>开发模式：<code>cd frontend &amp;&amp; npm run dev</code></li>
      <li>生产构建：<code>cd frontend &amp;&amp; npm run build</code></li>
    </ul>
    <p style="margin-top:20px;margin-bottom:0;font-size:.85rem;">
      构建完成后刷新本页即可。API 服务（端口 9880）已正常运行。
    </p>
  </div>
</body>
</html>"""


def _serve_index() -> HTMLResponse:
    """
    Business Logic（为什么需要这个函数）:
        根路由与 SPA fallback 都需要返回 index.html，提取为共用函数避免重复。

    Code Logic（这个函数做什么）:
        若 webapp/frontend/index.html 存在则读取原文返回（FileResponse 等价语义）；
        否则返回友好提示页，HTTP 200（让浏览器正常渲染），不 500。
    """
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if not os.path.exists(index_path):
        return HTMLResponse(content=_build_not_ready_html(), status_code=200)
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()
    return HTMLResponse(content=html)


@app.get("/", include_in_schema=False)
def serve_index() -> HTMLResponse:
    """
    Business Logic（为什么需要这个函数）:
        根路由是 SPA 的入口，浏览器访问 9880 应直接加载 React 应用。

    Code Logic（这个函数做什么）:
        委托 _serve_index() 返回 index.html 或友好提示页。
    """
    return _serve_index()


@app.get("/favicon.ico", include_in_schema=False, response_model=None)
def favicon() -> Response:
    """
    Business Logic（为什么需要这个函数）:
        浏览器自动请求 /favicon.ico，需要有效响应，否则出现 404 噪音。

    Code Logic（这个函数做什么）:
        返回 webapp/frontend/favicon.ico；文件不存在时返回 404。
    """
    icon = os.path.join(FRONTEND_DIR, "favicon.ico")
    if os.path.exists(icon):
        return FileResponse(icon, media_type="image/x-icon")
    return HTMLResponse(status_code=404)


@app.get("/{full_path:path}", include_in_schema=False, response_model=None)
def spa_fallback(full_path: str) -> Response:
    """
    Business Logic（为什么需要这个函数）:
        React Router 使用 history 模式，用户刷新或直接访问子路径（如 /library）时
        FastAPI 不能返回 404，必须回退到 index.html 让前端路由接管。

    Code Logic（这个函数做什么）:
        对所有未被前面路由匹配的 GET 请求：
        - 若路径以 api/ v1/ outputs/ characters/ assets/ 开头 → 跳过（返回 404）；
        - 否则回退到 index.html（或友好提示页）。
    """
    skip_prefixes = ("api/", "v1/", "outputs/", "characters/", "assets/")
    if any(full_path.startswith(p) for p in skip_prefixes):
        return HTMLResponse(status_code=404)
    return _serve_index()
