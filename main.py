"""
EmotionTTS 启动器：拉起 Web 中枢（默认端口 9880）。

本地 IndexTTS2 推理服务（端口 9800）需要在你自己的 indextts env 中另开终端运行：
    python tts_service/server.py
"""
import asyncio
import os
import socket
import sys
import time
import webbrowser

ROOT_DIR: str = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT_DIR)

WEB_PORT: int = int(os.environ.get("APP_PORT", "9880"))


def is_port_in_use(port: int) -> bool:
    """
    Business Logic（为什么需要这个函数）:
        Web 中枢启动前需要确认 9880 没被占用，避免与已运行实例冲突。

    Code Logic（这个函数做什么）:
        尝试 TCP 连到 127.0.0.1:port；成功返回 True 表示已被占用。
    """
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def main() -> None:
    """
    Business Logic（为什么需要这个函数）:
        一键启动：把所有复杂度（端口检查、ASGI 服务器配置、浏览器拉起）封装在一个入口。

    Code Logic（这个函数做什么）:
        1) 端口探测，已占用则退出；2) 提示用户本地 TTS 启动方式；3) macOS/Windows 上
        延迟 1.5s 后自动开浏览器；4) 用 uvicorn 同进程拉起 webapp.app。
    """
    print("=======================================")
    print("    🚀 EmotionTTS Web 中枢启动中")
    print("=======================================")

    if is_port_in_use(WEB_PORT):
        print(f"\n❌ 端口 {WEB_PORT} 已被占用，启动中止。")
        sys.exit(1)

    url = f"http://127.0.0.1:{WEB_PORT}"
    print(f"💡 本地 TTS 模式需在 indextts env 中另开终端运行: python tts_service/server.py")
    print(f"🌐 准备访问: {url}\n")

    if sys.platform in ("darwin", "win32"):
        # 延迟开浏览器，避免在服务器还没监听时打开
        def _open_later() -> None:
            time.sleep(1.5)
            try:
                webbrowser.open(url)
            except Exception:
                pass

        import threading
        threading.Thread(target=_open_later, daemon=True).start()

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    import uvicorn
    uvicorn.run("webapp.app:app", host="0.0.0.0", port=WEB_PORT, log_level="info")


if __name__ == "__main__":
    main()
