"""
系统配置管理模块 (Settings)
负责读取与保存应用的 JSON 配置文件，并对缺失字段做兜底。
"""
import os
import json
from typing import Any

APP_DIR: str = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR: str = os.path.join(APP_DIR, "config")
CONFIG_FILE: str = os.path.join(CONFIG_DIR, "config.json")

os.makedirs(CONFIG_DIR, exist_ok=True)


def _default_config() -> dict[str, Any]:
    """
    Business Logic（为什么需要这个函数）:
        新用户首次启动或配置丢失时，需要一份开箱即用的默认结构，避免前端炸开空字段。

    Code Logic（这个函数做什么）:
        返回内置的默认 LLM/TTS 配置字典。默认 LLM 走本地 Ollama，TTS 走本地
        IndexTTS2 服务（127.0.0.1:9800）。
    """
    return {
        "llm": {
            "active_type": "ollama",
            "configs": {
                "siliconflow": {"api_base": "https://api.siliconflow.cn/v1", "api_key": "", "model": "deepseek-ai/DeepSeek-V3.2"},
                "youzhi": {"api_base": "https://api.modelverse.cn/v1", "api_key": "", "model": "mimo-v2-flash"},
                "deepseek": {"api_base": "https://api.deepseek.com/v1", "api_key": "", "model": "deepseek-chat"},
                "ollama": {"api_base": "http://127.0.0.1:11434/v1", "api_key": "", "model": ""},
                "custom": {"api_base": "", "api_key": "", "model": ""},
            },
        },
        "tts": {
            "type": "local",
            "api_base": "http://127.0.0.1:9800/v1",
            "api_key": "",
        },
    }


def get_config() -> dict[str, Any]:
    """
    Business Logic（为什么需要这个函数）:
        全应用读取 LLM/TTS 配置的统一入口；调用方不关心文件是否存在、是否缺字段。

    Code Logic（这个函数做什么）:
        读取 config.json，缺失或损坏时回退到默认；对已存在配置只做"字段补全"，
        不再尝试任何旧版本自动迁移。
    """
    cfg = _default_config()

    if not os.path.exists(CONFIG_FILE):
        return cfg

    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
    except Exception as e:
        print(f"⚠️ 读取 config.json 失败，使用默认配置: {e}")
        return cfg

    # LLM 字段补全：保留已知 provider 的用户值；移除已不存在的 provider（如旧版 quick）
    saved_llm = saved.get("llm", {}) if isinstance(saved.get("llm"), dict) else {}
    cfg["llm"]["active_type"] = saved_llm.get("active_type", cfg["llm"]["active_type"])
    if cfg["llm"]["active_type"] not in cfg["llm"]["configs"]:
        cfg["llm"]["active_type"] = "ollama"

    saved_configs = saved_llm.get("configs", {}) if isinstance(saved_llm.get("configs"), dict) else {}
    for provider, defaults in cfg["llm"]["configs"].items():
        if provider in saved_configs and isinstance(saved_configs[provider], dict):
            v = saved_configs[provider]
            # 修复历史遗留：早期版本误把 /chat/completions 写进 api_base
            if isinstance(v.get("api_base"), str) and v["api_base"].endswith("/chat/completions"):
                v["api_base"] = v["api_base"].replace("/chat/completions", "")
            defaults.update(v)

    # TTS 字段补全
    saved_tts = saved.get("tts", {}) if isinstance(saved.get("tts"), dict) else {}
    cfg["tts"].update({k: v for k, v in saved_tts.items() if k in cfg["tts"]})

    return cfg


def save_config(config_data: dict[str, Any]) -> None:
    """
    Business Logic（为什么需要这个函数）:
        用户在前端修改配置后需要持久化，下次启动可以保留。

    Code Logic（这个函数做什么）:
        以 UTF-8 + 2 空格缩进将配置字典写入 config.json。
    """
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config_data, f, ensure_ascii=False, indent=2)
