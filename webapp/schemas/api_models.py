"""
API 数据模型定义 (Schemas)
存放所有请求体和响应体的 Pydantic 模型，用于接口入参校验。
"""

from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List, Literal

# ==========================================
# 1. 配置相关模型 (Config)
# ==========================================

class AsrConfig(BaseModel):
    """ASR 服务配置（本地 asr_service 或云端 OpenAI 兼容接口）。"""
    type: Literal["local", "cloud"] = "local"
    api_base: str = "http://127.0.0.1:9900/v1"
    api_key: str = ""
    model: str = "whisper-small"
    language: str = "zh"


class ConfigRequest(BaseModel):
    llm_active_type: str
    llm_configs: dict
    tts: dict
    asr: Optional[AsrConfig] = None


class TestLlmRequest(BaseModel):
    """单个 LLM 配置的连通性测试请求体（不落盘）。"""
    api_base: str
    api_key: str = ""
    model: str


class TestTtsRequest(BaseModel):
    """TTS 配置的连通性测试请求体（不落盘）。"""
    type: Literal["local", "cloud"] = "local"
    api_base: str = ""
    api_key: str = ""


class TestAsrRequest(BaseModel):
    """ASR 配置的连通性测试请求体（不落盘）。"""
    type: Literal["local", "cloud"] = "local"
    api_base: str = "http://127.0.0.1:9900/v1"
    api_key: str = ""


# ==========================================
# 2. 角色素材相关模型 (Character Items)
# ==========================================
class UpdateItemsRequest(BaseModel):
    updates: Dict[str, Any]

class MergeItemsRequest(BaseModel):
    item_ids: List[int]

class ManualSplitRequest(BaseModel):
    split_time: float

# ==========================================
# 3. 核心业务处理模型 (LLM & TTS & Text)
# ==========================================
class AnalyzeEmotionRequest(BaseModel):
    text: str

class MatchRequest(BaseModel):
    char_id: str
    text: str
    manual_emotion: Optional[Dict[str, str]] = None
    api_priority: bool = True  # 前端"允许 API 模式优先"开关；True 时若有 is_api_safe 子集则独占候选池

class SplitTextRequest(BaseModel):
    text: str
    min_len: int = 10
    max_len: int = 150

class SynthAudioRequest(BaseModel):
    text: str
    char_id: str = ""
    ref_audio_filename: str = ""
    emo_vector: Optional[List[float]] = None
    emo_alpha: float = 1.0

class MergeOutputsRequest(BaseModel):
    audio_urls: List[str]


# ==========================================
# 4. OpenAI 兼容外部调用模型
# ==========================================
class OpenAITTSRequest(BaseModel):
    model: str = "emotionTTS"
    input: str
    voice: str  # 外部调用时，这里传入你的“角色名”，比如“胡桃”
    response_format: Literal["wav", "mp3", "opus", "aac", "flac", "pcm"] = "wav"
    speed: float = Field(default=1.0, ge=0.25, le=4.0)