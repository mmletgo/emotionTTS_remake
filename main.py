"""
EmotionTTS 启动器：仅负责拉起 Web 中枢（端口 9880）。

本地 IndexTTS2 服务不再由本脚本拉起，请在你的 indextts env 里另开终端运行：
    python indexTTS_Server/tts_server.py
"""
import os
import sys
import socket
import subprocess
import webbrowser
import time

ROOT_DIR: str = os.path.dirname(os.path.abspath(__file__))
CORE_DIR: str = os.path.join(ROOT_DIR, "core")
WEB_PORT: int = int(os.environ.get("APP_PORT", "9880"))

sys.path.insert(0, ROOT_DIR)
sys.path.insert(0, CORE_DIR)


def is_port_in_use(port: int) -> bool:
    """
    Business Logic（为什么需要这个函数）:
        启动 Web 中枢前需要确认 9880 端口未被占用，避免与已运行实例冲突或端口绑定失败。

    Code Logic（这个函数做什么）:
        尝试与 127.0.0.1:port 建立 TCP 连接；成功返回 True 表示端口已被占用。
    """
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def wait_for_port(port: int, process: subprocess.Popen, timeout: int = 30) -> bool:
    """
    Business Logic（为什么需要这个函数）:
        Web 中枢启动需要时间，启动器要等到端口真正可连接才能向用户报告"就绪"，
        同时若子进程中途崩溃也要立即返回失败。

    Code Logic（这个函数做什么）:
        在 timeout 秒内轮询端口；若进程 poll() 非 None 表示已退出则提前返回 False。
    """
    start = time.time()
    while time.time() - start < timeout:
        if process.poll() is not None:
            print(f"\n❌ 服务进程已退出，返回码: {process.returncode}")
            return False
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except (ConnectionRefusedError, TimeoutError, OSError):
            time.sleep(1)
    return False


def main() -> None:
    """
    Business Logic（为什么需要这个函数）:
        一键启动 Web 中枢，给用户最小的认知负担：跑这一个文件即可使用前端 UI。

    Code Logic（这个函数做什么）:
        端口检查 → 用当前 Python 解释器在 core/ 目录拉起 app.py → 等待端口就绪 →
        若是桌面环境自动打开浏览器；KeyboardInterrupt 时优雅关闭子进程。
    """
    print("=======================================")
    print("    🚀 EmotionTTS Web 中枢启动中")
    print("=======================================")

    if is_port_in_use(WEB_PORT):
        print(f"\n❌ 端口 {WEB_PORT} 已被占用，启动中止。")
        sys.exit(1)

    os.environ["APP_PORT"] = str(WEB_PORT)
    web_process = subprocess.Popen([sys.executable, "app.py"], cwd=CORE_DIR)

    if not wait_for_port(WEB_PORT, web_process, timeout=30):
        web_process.terminate()
        sys.exit(1)

    url = f"http://127.0.0.1:{WEB_PORT}"
    print(f"\n🎉 Web 中枢已就绪: {url}")
    print("💡 本地 TTS 模式需在 indextts env 中另开终端运行: python indexTTS_Server/tts_server.py")

    if sys.platform in ("darwin", "win32"):
        time.sleep(1)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        web_process.wait()
    except KeyboardInterrupt:
        print("\n🛑 正在关闭 Web 中枢...")
        web_process.terminate()


if __name__ == "__main__":
    main()
