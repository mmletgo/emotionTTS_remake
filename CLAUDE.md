# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

**EmotionTTS** 是面向中文配音 / 有声内容创作者的本地 TTS 工作站（精简版）。技术栈：FastAPI + 原生 JS 前端 + IndexTTS2（情感向量驱动的零样本声音克隆）+ Faster-Whisper（本地 ASR）+ 任意 OpenAI 兼容 LLM（情感分析与素材匹配）。

三层核心能力：
1. **角色素材库**：上传参考音 → 静音切分 → Whisper 转写 → LLM 情感打标 → 落盘到 `characters/{char_id}/library.json`。
2. **AI 智能匹配**：用户输入目标台词 → LLM 在候选音池中挑出情绪最贴合的参考音，并动态生成 8 维情绪向量 `[喜, 怒, 哀, 惧, 厌, 低落, 惊, 平]` + Alpha 强度。
3. **音频合成**：把「参考音 + 文本 + 情绪向量 + Alpha」交给 IndexTTS2 推理服务（本地 9800 或用户自部署远端），返回带情感的 WAV。

完整产品需求请见 `docs/PRD.md`。

## 启动与运行

整套项目（Web 中枢 + 本地 TTS 推理）**共用同一个 indextts venv**。这个 venv 同时具备 FastAPI / pydub / httpx / faster-whisper / indextts / torch 全部依赖，无需再装别的。

本机的 indextts venv 路径：`/Users/hans/repos/index-tts/.venv`（uv 管理，Python 3.10.20）。

```bash
# 别名（推荐写进 shell rc 里）
alias emotts-py=/Users/hans/repos/index-tts/.venv/bin/python

# 1) Web 中枢（端口 9880）
emotts-py main.py

# 2) IndexTTS2 推理服务（端口 9800，另开终端）
INDEXTTS_MODEL_DIR=/Users/hans/repos/index-tts/checkpoints emotts-py indexTTS_Server/tts_server.py
```

只要 LLM 配置走远端（siliconflow / deepseek / 远端 ollama），可不启动 9800；要走本地 TTS 才需要起 9800。

**没有测试套件**，没有 lint 配置。验证方式：浏览器打开 `http://127.0.0.1:9880/` 走通「创建角色 → 匹配 → 合成」三条主链路。

类型检查走 `pyrightconfig.json`，已把 venvPath 指向 indextts venv，IDE / Pyright 能解析 indextts、faster_whisper 等模块。

## 目录地图

| 路径 | 一行描述 |
| --- | --- |
| `main.py` | 启动器：纯粹拉起 Web 中枢（9880）；不再自动拉本地 TTS、不再做增量更新 |
| `core/` | Web 中枢全部代码（FastAPI 后端 + 原生 JS 前端） |
| `core/app.py` | FastAPI 入口，挂载静态目录与三个路由 router；强制全局禁缓存 |
| `core/routers/` | API 路由层：`config_router`（配置校验/保存）、`char_router`（角色 CRUD + 进度查询）、`tts_router`（情感分析 / 匹配 / 合成 / 文本切分 / 合并 / OpenAI 兼容 `/v1/audio/speech`） |
| `core/utils/` | 业务工具：`llm_provider`（统一 LLM/TTS HTTP 客户端）、`audio_processor`（静音切分 + Whisper 转写 + 入库）、`character_mgr`（素材合并/手动切分）、`text_splitter` |
| `core/schemas/api_models.py` | 全部 Pydantic 请求体 |
| `core/config/settings.py` | `config.json` 读写 + 字段补全（不再做老版本自动升级） |
| `core/prompts/system_prompts.py` | 情绪打标 / 智能匹配（含 8 维向量约束）的 system prompt 集中管理 |
| `core/frontend/` | 原生 HTML/CSS/JS 单页：`index.html` + `js/{core,api,synth,library,audio_player,modals,help_links,utils}.js` |
| `indexTTS_Server/tts_server.py` | IndexTTS2 推理服务（轻量 wrapper，依赖用户的 indextts env） |
| `characters/{char_id}/` | 单个角色的所有数据：`library.json` + `voice_lib/*.wav` + `avatar.{png,jpg,webp}` |
| `outputs/` | 所有合成产物：`synth_*.wav`、`api_synth_*.wav`、`merged_*.wav` |
| `models/whisper-small/` | 本地 Faster-Whisper 模型（int8 量化），离线 ASR 用 |
| `docs/PRD.md` | 完整 BDD 产品需求文档 |

## 关键陷阱与约束

1. **本地 TTS 必须用户手动启动**：精简后 `main.py` 不再尝试自动启动 9800 端口的推理服务；用户需要在自己的 indextts env 中跑 `python indexTTS_Server/tts_server.py`。Web 中枢探活失败时只会显示「TTS 异常」，不会自动救活。
2. **`/v1/audio/speech` 直接复用 `/api/match`**：OpenAI 兼容接口不是独立实现，而是构造 `MatchRequest` 调用 `handle_match()` 后再合成。改匹配逻辑会同时影响外部 API 调用。
3. **情绪叠加 0.6 折算**：`tts_router.handle_match()` 中，当 LLM 诊断的目标主情绪与参考音的主情绪一致时，会把 LLM 给的 `emo_alpha` 再乘 0.6 防爆音——改情绪逻辑时务必保留这个保护。
4. **`emo_vector` 偷渡协议**：Web 中枢通过把 `voice` 字段写成 `[EMO:[v0,..,v7]|alpha]base64:...` 的前缀形式把情绪向量带给 IndexTTS2 服务；`tts_server.py` 入口处用正则剥离。改其中一端必须同步另一端。
5. **进度查询是进程内变量**：`char_router.task_progress` 是个普通 dict，多 worker 部署或重启会丢失。
6. **API 白名单优先**：智能匹配时如果素材库里有 `is_api_safe=true` 的条目，会**只**用这些条目做候选池，否则才用全量。
7. **前端禁缓存靠时间戳**：`core/app.py` 的 `/` 和 `/lite.html` 入口会把所有 `.js` / `.css` 替换成 `?t={timestamp}` 强制刷新。
8. **`outputs/` 永远不会自动清理**：合成产物会无限累积，需要手动清理或加定时任务。
9. **ffmpeg 信任系统 PATH**：精简后不再绑内置 ffmpeg；用户需自行 `brew install ffmpeg` 或等价方式安装。

## 配置文件约定

- `core/config/config.json` 是唯一的运行时配置，被 `settings.py` 集中读写。结构：
  ```
  {
    "llm": {
      "active_type": "ollama" | "siliconflow" | "youzhi" | "deepseek" | "custom",
      "configs": { <provider>: { api_base, api_key, model } }
    },
    "tts": { "type": "local" | "cloud", "api_base": "...", "api_key": "..." }
  }
  ```
- 默认 `active_type=ollama`、`tts.type=local`（指向 `http://127.0.0.1:9800/v1`）。
- 远端 TTS（`tts.type=cloud`）需用户自配 api_base，**没有任何内置远端节点**。
