"""
本地 ASR 转录服务（Whisper 微服务）

使用方式：在 indextts env 里运行：
    python asr_service/server.py

依赖（由 indextts env 提供）：
    - faster-whisper
    - fastapi / uvicorn / python-multipart

环境变量：
    WHISPER_MODEL_DIR   Faster-Whisper 模型目录（默认 <repo_root>/models/whisper-small）
    ASR_PORT            监听端口（默认 9900）
"""
import os
import tempfile
import uuid
from threading import Lock
from typing import Annotated, Literal, Optional

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

# ==================== 路径 & 环境变量 ====================

_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_SERVER_DIR)

WHISPER_MODEL_DIR: str = os.environ.get(
    "WHISPER_MODEL_DIR",
    os.path.join(_REPO_ROOT, "models", "whisper-small"),
)
PORT: int = int(os.environ.get("ASR_PORT", "9900"))

# uploads 目录用于清理残留，实际转录使用 tempfile
UPLOAD_DIR: str = os.path.join(_SERVER_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ==================== FastAPI 应用 ====================

app = FastAPI(title="Whisper ASR Service", version="1.0.0")
_model_lock: Lock = Lock()

# 延迟加载，首次请求时初始化
_whisper_model = None  # type: ignore[assignment]


def _get_model():  # type: ignore[return]
    """
    Business Logic（为什么需要这个函数）:
        Whisper 模型较大，进程启动时不立即加载可减少冷启动时间；
        首次请求时懒加载并缓存到模块级单例，后续请求复用。

    Code Logic（这个函数做什么）:
        线程安全地检查并创建 WhisperModel 单例（CPU + int8 量化）。
        若模型目录不存在或为空，抛出 RuntimeError。
    """
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    with _model_lock:
        if _whisper_model is not None:
            return _whisper_model
        print(f"[asr_server] 正在加载 Whisper 模型: {WHISPER_MODEL_DIR}", flush=True)
        if not os.path.isdir(WHISPER_MODEL_DIR) or not os.listdir(WHISPER_MODEL_DIR):
            raise RuntimeError(
                f"找不到 Whisper 模型文件！请确认 {WHISPER_MODEL_DIR} 存在且非空。"
            )
        # 延迟导入，避免在没有 faster-whisper 的环境下导入模块时崩溃
        from faster_whisper import WhisperModel  # type: ignore[import]
        _whisper_model = WhisperModel(
            WHISPER_MODEL_DIR,
            device="cpu",
            compute_type="int8",
            local_files_only=True,
        )
        print("[asr_server] Whisper 模型加载完毕。", flush=True)
        return _whisper_model


def _clear_stale_uploads() -> None:
    """
    Business Logic（为什么需要这个函数）:
        每次转录后临时文件应被清理；若进程上次崩溃，uploads/ 可能残留。
        启动时一次性清空以节省磁盘。

    Code Logic（这个函数做什么）:
        遍历 UPLOAD_DIR 下的文件逐个 os.remove；目录本身保留；异常吞掉。
    """
    if not os.path.isdir(UPLOAD_DIR):
        return
    removed = 0
    for name in os.listdir(UPLOAD_DIR):
        path = os.path.join(UPLOAD_DIR, name)
        if os.path.isfile(path):
            try:
                os.remove(path)
                removed += 1
            except Exception:
                pass
    if removed:
        print(f"[asr_server] 清理了 {removed} 个残留临时文件", flush=True)


# ==================== 探活端点 ====================

@app.get("/healthz")
def healthz() -> dict[str, str]:
    """
    Business Logic（为什么需要这个函数）:
        Web 中枢的 ASR 探活和前端 '检测' 按钮需要一个轻量可达性检查端点。

    Code Logic（这个函数做什么）:
        无条件返回 {"status": "ok"}，不触发模型加载。
    """
    return {"status": "ok"}


@app.get("/v1/models")
def list_models() -> dict[str, list[dict[str, str]]]:
    """
    Business Logic（为什么需要这个函数）:
        OpenAI 客户端惯例：先 GET /v1/models 探活；本地服务返回固定列表即可。

    Code Logic（这个函数做什么）:
        返回包含 whisper-small 模型条目的 OpenAI 格式 models 列表。
    """
    return {"data": [{"id": "whisper-small", "object": "model"}]}


# ==================== 核心转录端点 ====================

@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: Annotated[UploadFile, File(description="待转录音频文件")],
    model: Annotated[Optional[str], Form()] = None,
    language: Annotated[str, Form()] = "zh",
    response_format: Annotated[Literal["json", "verbose_json", "text"], Form()] = "json",
    temperature: Annotated[float, Form()] = 0.0,
    prompt: Annotated[Optional[str], Form()] = None,
):
    """
    Business Logic（为什么需要这个函数）:
        Web 中枢需要将每段切分好的 WAV 文件转录为文本；
        本端点是 OpenAI 兼容接口，可以直接被 httpx 以相同协议调用，
        也可切换到 OpenAI / 其他云端 ASR 服务而无需修改客户端代码。

    Code Logic（这个函数做什么）:
        1) 将上传的音频写入 tempfile；
        2) 调用 faster-whisper transcribe，使用 vad_filter + beam_size=5；
        3) 根据 response_format 返回 json / verbose_json / text；
        4) 清理临时文件；temperature 参数接收但忽略（faster-whisper 不暴露该参数）。
    """
    _ = model  # 本地只有一个模型，忽略此字段

    try:
        whisper = _get_model()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # 写入临时文件
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    tmp_path = os.path.join(UPLOAD_DIR, f"asr_{uuid.uuid4().hex}{suffix}")
    try:
        content = await file.read()
        with open(tmp_path, "wb") as f_tmp:
            f_tmp.write(content)

        # 调用 faster-whisper 推理
        segments_gen, info = whisper.transcribe(
            tmp_path,
            language=language,
            initial_prompt=prompt,
            vad_filter=True,
            beam_size=5,
        )
        segments_list = list(segments_gen)  # 消费生成器

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"转录失败: {e}")
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass

    # 拼接全文
    full_text = "".join(seg.text for seg in segments_list).strip()

    if response_format == "text":
        return PlainTextResponse(content=full_text)

    if response_format == "verbose_json":
        duration = float(getattr(info, "duration", 0.0))
        segments_data = [
            {
                "id": i,
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
            }
            for i, seg in enumerate(segments_list)
        ]
        return {
            "text": full_text,
            "language": language,
            "duration": round(duration, 3),
            "segments": segments_data,
        }

    # 默认 response_format == "json"
    return {"text": full_text}


# ==================== 入口 ====================

if __name__ == "__main__":
    import sys
    # Windows 上 uvicorn 默认 ProactorEventLoop 与部分异步 IO 库不兼容；
    # 强制使用 SelectorEventLoop 确保跨平台行为一致
    if sys.platform == "win32":
        import asyncio
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    _clear_stale_uploads()
    print(f"[asr_server] 启动 Whisper ASR 服务，端口 {PORT}")
    print(f"[asr_server] 模型目录: {WHISPER_MODEL_DIR}")
    print(f"[asr_server] 探活: http://127.0.0.1:{PORT}/healthz")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
