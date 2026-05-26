# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

**EmotionTTS** 是面向中文配音 / 有声内容创作者的本地 TTS 工作站。两个进程：Web 中枢（`webapp`，端口 9880）+ IndexTTS2 推理服务（`tts_service`，端口 9800）。

三层核心能力：
1. **角色素材库**：上传参考音 → 静音切分 → Whisper 转写 → LLM 情感打标 → 落盘到 `characters/{char_id}/library.json`。
2. **AI 智能匹配**：用户输入目标台词 → LLM 在候选音池中挑出情绪最贴合的参考音，并动态生成 8 维情绪向量 `[喜, 怒, 哀, 惧, 厌, 低落, 惊, 平]` + Alpha 强度。
3. **音频合成**：把「参考音 + 文本 + 情绪向量 + Alpha」交给 IndexTTS2 推理服务，返回带情感的 WAV。

完整需求文档见 `docs/PRD.md`。

## 启动与运行

整套项目（Web 中枢 + 本地 TTS 推理）**共用同一个 indextts venv**（`/Users/hans/repos/index-tts/.venv`，uv 管理，Python 3.10.20），里面已经装好 FastAPI / pydub / httpx / faster-whisper / indextts / torch 全部依赖。

```bash
alias emotts-py=/Users/hans/repos/index-tts/.venv/bin/python

# 1) Web 中枢（端口 9880）
emotts-py main.py

# 2) IndexTTS2 推理服务（端口 9800，另开终端）
INDEXTTS_MODEL_DIR=/Users/hans/repos/index-tts/checkpoints emotts-py tts_service/server.py
```

只走远端 LLM 时不需要起 9800；要用本地 TTS 才需要。

**没有测试套件**，没有 lint 配置。验证方式：浏览器打开 `http://127.0.0.1:9880/` 走通「创建角色 → 匹配 → 合成」三条主链路。Pyright 检查：`pyright`（仓库根，使用根目录的 `pyrightconfig.json`，应为 0 errors）。

## 架构与目录地图

模块化单体架构，Web 中枢按"api / domain / clients"三层分包，**api 不能直接调外部 HTTP，必须经 clients；api 也不写业务逻辑，必须经 domain**。

```
emotionTTS_v4.5/
├── main.py                          # 启动器：端口检测 + uvicorn 同进程拉 webapp.app
├── pyrightconfig.json               # 指向 /Users/hans/repos/index-tts/.venv
├── CLAUDE.md / docs/PRD.md
├── webapp/                          # ── Web 中枢（9880）
│   ├── app.py                       # FastAPI 入口，挂载 5 个 router + 静态资源 + 首页
│   ├── settings.py                  # config.json 读写
│   ├── api/                         # 薄壳 HTTP 层（详见 webapp/api/CLAUDE.md）
│   ├── domain/                      # 业务逻辑层（详见 webapp/domain/CLAUDE.md）
│   ├── clients/                     # 外部 HTTP 客户端（详见 webapp/clients/CLAUDE.md）
│   ├── schemas/api_models.py        # Pydantic 请求体
│   ├── prompts/system_prompts.py    # LLM system prompt 集中管理
│   └── frontend/                    # 原生 HTML/CSS/JS 单页
├── tts_service/                     # ── 本地 IndexTTS2 推理服务（9800）
│   └── server.py                    # 依赖用户 indextts env 内的 indextts 包
├── characters/{char_id}/            # 数据：角色目录（library.json + voice_lib/ + avatar.*）
├── outputs/                         # 数据：合成产物（synth_* / api_synth_* / merged_*）
└── models/whisper-small/            # 数据：Faster-Whisper 本地模型（int8）
```

## 关键陷阱与约束

1. **本地 TTS 必须用户手动启动**：`main.py` 不会自动拉起 9800；用户需在 indextts env 中跑 `python tts_service/server.py`。
2. **api/domain/clients 三层不能跨越**：api 调 domain，domain 调 clients；不允许 api 直接 import httpx 或 api 直接读写文件。详见各层 mini-CLAUDE.md。
3. **`/v1/audio/speech` 与 `/api/match`+`/api/synthesize` 共用业务核心**：都走 `domain.matcher.match_for_text` + `domain.synthesizer.synthesize_with_reference`，行为一致；区别仅在 OpenAI 兼容路径有 24kHz 重采样与括号清洗。
4. **情绪叠加 0.6 折算**：`domain/matcher.py` 中当目标主情绪与参考音一致时把 emo_alpha 乘 0.6 防爆音——不要在 api 层重复实现。
5. **manual_emotion 强制覆盖 target_emotion**：用户在 `manualEmotionModal` 锁定情绪后，`matcher` 仍调 LLM 选候选 + 生成向量，但最终返回的 `target_emotion` 一定 == 用户值（双保险：prompt 指令 + 后端强覆盖）。
6. **`emo_vector` 偷渡协议**：`clients/tts.py` 把 `voice` 字段写成 `[EMO:[v0..v7]|alpha]base64:...`；`tts_service/server.py` 入口处用正则剥离。两端必须同步。
7. **`webapp/api/_progress.py`**：跨 router 共享的后台任务进度字典，进程重启会丢失（有意为之，详见 PRD 5.6）。
8. **API 白名单优先**：智能匹配候选池由 `domain/matcher._select_candidate_pool` 决定——只要存在 `is_api_safe=true` 的素材，就只用这批；否则用全集。合并/切分产生的新 item `is_api_safe` 始终 false（不继承）。
9. **导入角色 ZIP 时强制刷新 char_id**：`domain.characters.import_zip` 会把新 `library.json.char_id` 强制等于新目录名；不要去掉这步，否则历史包内的不一致会污染新数据。
10. **`tts_service/server.py` 启动时清 uploads/**：`_clear_stale_uploads()` 在 `_init_engine` 前调用，处理上次崩溃残留；不要乱改顺序。
11. **前端禁缓存靠时间戳**：`webapp/app.py` 把所有 `.js` / `.css` 引用替换为 `?t={timestamp}`。
12. **`outputs/` 永不自动清理**：有意为之（详见 PRD 5.6），用户自管。
13. **ffmpeg 信任系统 PATH**：不再绑内置 ffmpeg；用户需自行 `brew install ffmpeg`。

## 配置文件约定

`webapp/config/config.json`（首次启动时由 `webapp/settings.py` 自动在 `webapp/config/` 下创建）结构：
```jsonc
{
  "llm": {
    "active_type": "ollama",
    "configs": {<provider>: {api_base, api_key, model}}
  },
  "tts": {"type": "local"|"cloud", "api_base": "...", "api_key": "..."}
}
```

默认 `active_type=ollama`、`tts.type=local`（指向 `http://127.0.0.1:9800/v1`）。远端 TTS 由用户填 api_base；没有任何内置远端节点。
