"""
IndexTTS2 推理服务（轻量 wrapper）

使用方式：在你自己的 indextts env 里运行：
    INDEXTTS_MODEL_DIR=/path/to/checkpoints python tts_server.py

依赖（由用户的 indextts env 提供）：
    - indextts (含 IndexTTS2)
    - torch / fastapi / uvicorn / pydantic

环境变量：
    INDEXTTS_MODEL_DIR  IndexTTS2 checkpoints 目录（默认 ./checkpoints）
    INDEXTTS_PORT       监听端口（默认 9800）
    INDEXTTS_USE_FP16   是否半精度（默认 1）
"""
import base64
import gc
import json
import os
import re
import uuid
from threading import Lock
from typing import Optional

import torch
import uvicorn
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from indextts.infer_v2 import IndexTTS2

MODEL_DIR: str = os.environ.get("INDEXTTS_MODEL_DIR", "./checkpoints")
PORT: int = int(os.environ.get("INDEXTTS_PORT", "9800"))
USE_FP16: bool = os.environ.get("INDEXTTS_USE_FP16", "1") not in ("0", "false", "False")
UPLOAD_DIR: str = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="IndexTTS2 Server", version="1.0.0")
gpu_lock: Lock = Lock()
tts: Optional[IndexTTS2] = None


def _init_engine() -> None:
    """
    Business Logic（为什么需要这个函数）:
        进程启动时加载 IndexTTS2 模型权重，避免首次请求承受冷启动延迟。

    Code Logic（这个函数做什么）:
        在 GPU 锁内创建 IndexTTS2 实例，加载 MODEL_DIR/config.yaml；多次调用会先释放旧实例。
    """
    global tts
    with gpu_lock:
        if tts is not None:
            del tts
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        tts = IndexTTS2(
            model_dir=MODEL_DIR,
            cfg_path=os.path.join(MODEL_DIR, "config.yaml"),
            use_fp16=USE_FP16,
            use_deepspeed=False,
            use_cuda_kernel=True,
        )
        print(f"[tts_server] IndexTTS2 engine ready (model_dir={MODEL_DIR})", flush=True)


def _cleanup(path: str) -> None:
    """BackgroundTask 回调：删除一个临时文件，吞掉异常。"""
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _sanitize_text(text: str) -> str:
    """去除推理输入中可能产生异常字符的内容；保留中文、英文字母、数字、常见标点。"""
    return re.sub(r"[^\w\s一-龥.,!?，。！？、；：“”'()（）\-~]", "", text).strip()


class SpeechReq(BaseModel):
    """与 OpenAI /v1/audio/speech 兼容的请求体（额外支持 emo_vector / emo_alpha）。"""
    model: str = "IndexTTS2"
    input: str = Field(..., max_length=500)
    voice: str
    speed: float = 1.0
    response_format: str = "wav"
    emo_vector: Optional[list[float]] = None
    emo_alpha: float = 1.0


@app.get("/health")
def health() -> dict:
    """探活端点。Web 中枢的 verify_tts(local) 会调用此接口。"""
    return {"status": "ready", "engine_loaded": tts is not None}


@app.post("/v1/audio/speech")
def generate_speech(req: SpeechReq, background_tasks: BackgroundTasks):
    """
    Business Logic（为什么需要这个函数）:
        Web 中枢把"参考音 + 文本 + 情绪向量"打包过来后，需要由本地 GPU 完成实际推理。

    Code Logic（这个函数做什么）:
        1) 解析 voice 字符串里偷渡的 [EMO:vector|alpha] 前缀；2) base64 decode 参考音落到
        uploads/；3) GPU 锁内 tts.infer；4) 用 BackgroundTask 清理中间文件。
    """
    clean_input = _sanitize_text(req.input)
    if not clean_input:
        raise HTTPException(status_code=400, detail="Invalid text input: only unsupported characters.")

    request_id = uuid.uuid4().hex
    temp_out = f"temp_out_{request_id}.wav"

    # 解析 voice 字符串前缀的情绪向量偷渡协议：[EMO:[v0,..,v7]|alpha]base64:...
    actual_voice = req.voice
    final_emo_vector = req.emo_vector
    final_emo_alpha = req.emo_alpha
    m = re.match(r"^\[EMO:(.*?)\|(.*?)\](.*)$", req.voice, flags=re.DOTALL)
    if m:
        try:
            final_emo_vector = json.loads(m.group(1))
            final_emo_alpha = float(m.group(2))
            actual_voice = m.group(3)
        except Exception as e:
            print(f"[tts_server] Failed to parse EMO prefix: {e}", flush=True)

    # 还原参考音文件
    try:
        if actual_voice.startswith("base64:"):
            b64_data = actual_voice.split("base64:", 1)[1].strip()
            pad = (-len(b64_data)) % 4
            if pad:
                b64_data += "=" * pad
            prompt_audio_path = os.path.join(UPLOAD_DIR, f"ref_{request_id}.wav")
            with open(prompt_audio_path, "wb") as f:
                f.write(base64.b64decode(b64_data))
            background_tasks.add_task(_cleanup, prompt_audio_path)
        else:
            prompt_audio_path = os.path.join(UPLOAD_DIR, os.path.basename(actual_voice))

        if not os.path.exists(prompt_audio_path):
            raise HTTPException(status_code=400, detail="Reference audio missing")

        with gpu_lock:
            assert tts is not None, "TTS engine not initialized"
            tts.infer(
                spk_audio_prompt=prompt_audio_path,
                text=clean_input,
                output_path=temp_out,
                emo_vector=final_emo_vector,
                emo_alpha=final_emo_alpha,
            )

        if not os.path.exists(temp_out):
            raise HTTPException(status_code=500, detail="File generation failed")

        background_tasks.add_task(_cleanup, temp_out)
        return FileResponse(path=temp_out, media_type="audio/wav")

    except HTTPException:
        raise
    except Exception as e:
        print(f"[tts_server] inference error: {e}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    _init_engine()
    print(f"🚀 IndexTTS2 server listening on http://0.0.0.0:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
