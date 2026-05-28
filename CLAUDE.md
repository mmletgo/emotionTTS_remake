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

### 推荐方式：一键脚本

```bash
# 第一步：一次性部署（交互式，首次使用）
bash install.sh

# 第二步：启动所有服务
bash start.sh

# 常用管理命令
bash start.sh status          # 查看各服务状态
bash start.sh stop            # 停止所有服务
bash start.sh restart         # 重启所有服务
bash start.sh logs webapp     # 查看 webapp 日志
bash start.sh logs asr        # 查看 asr_service 日志
bash start.sh logs tts        # 查看 tts_service 日志
```

完整部署文档见 `docs/DEPLOY.md`。

### 高级/手动方式

适用于已有 indextts venv 的开发者：

```bash
# 设定 Python（指向你的 indextts venv）
EMOTTS_PY=/path/to/venv/bin/python

# 1) Web 中枢（端口 9880）
$EMOTTS_PY main.py

# 2) IndexTTS2 推理服务（端口 9800，另开终端）
INDEXTTS_MODEL_DIR=/path/to/index-tts/checkpoints $EMOTTS_PY tts_service/server.py

# 3) ASR 语音识别微服务（端口 9900，另开终端）
$EMOTTS_PY asr_service/server.py

# 4) 前端开发模式（可选，5173，HMR）
cd frontend && npm install && npm run dev
# Vite proxy 把 /api /v1 /outputs /characters 转发到 9880
# 改完打包：npm run build → 产物输出到 webapp/frontend/
```

只走云端 TTS 时不需要起 9800；只走云端 ASR 时不需要起 9900。前端日常修改走 `npm run dev`，发布前 `npm run build` 把产物提交进 `webapp/frontend/`。

**没有测试套件**，没有 lint 配置。验证方式：浏览器打开 `http://127.0.0.1:9880/` 走通「创建角色 → 匹配 → 合成」三条主链路。Pyright 检查：`pyright`（仓库根，使用根目录的 `pyrightconfig.json`，应为 0 errors）。

## 架构与目录地图

模块化单体架构，Web 中枢按"api / domain / clients"三层分包，**api 不能直接调外部 HTTP，必须经 clients；api 也不写业务逻辑，必须经 domain**。

```
emotionTTS_remake/
├── main.py                          # 启动器：端口检测 + uvicorn 同进程拉 webapp.app
├── pyrightconfig.json               # 指向 /Users/hans/repos/index-tts/.venv
├── CLAUDE.md / docs/PRD.md
├── webapp/                          # ── Web 中枢（9880）
│   ├── app.py                       # FastAPI 入口，挂载 5 个 router + 静态资源 + 首页
│   ├── settings.py                  # config.json 读写（llm / tts / asr 三节）
│   ├── api/                         # 薄壳 HTTP 层（详见 webapp/api/CLAUDE.md）
│   ├── domain/                      # 业务逻辑层（详见 webapp/domain/CLAUDE.md）
│   ├── clients/                     # 外部 HTTP 客户端（详见 webapp/clients/CLAUDE.md）
│   ├── schemas/api_models.py        # Pydantic 请求体（含 AsrConfig）
│   ├── prompts/system_prompts.py    # LLM system prompt 集中管理
│   └── frontend/                    # Vite + React SPA 构建产物（index.html + assets/，入库）
├── frontend/                        # ── React 源码（详见 frontend/CLAUDE.md）
│   ├── src/{views,components,hooks,api,state,icons,styles,utils}
│   ├── vite.config.ts               # dev proxy → :9880；build outDir → ../webapp/frontend
│   └── package.json                 # Vite 8 + React 18 + TypeScript 5（无运行时框架依赖）
├── tts_service/                     # ── 本地 IndexTTS2 推理服务（9800）
│   └── server.py                    # 依赖用户 indextts env 内的 indextts 包
├── asr_service/                     # ── 本地 Whisper ASR 微服务（9900）
│   └── server.py                    # OpenAI 兼容 /v1/audio/transcriptions，懒加载 Whisper
├── characters/{char_id}/            # 数据：角色目录（library.json + voice_lib/ + avatar.*）
├── outputs/                         # 数据：合成产物（synth_* / api_synth_* / merged_*）
└── models/whisper-small/            # 数据：Faster-Whisper 本地模型（int8）
```

## 关键陷阱与约束

1. **本地 TTS 必须用户手动启动**：`main.py` 不会自动拉起 9800；用户需在 indextts env 中跑 `python tts_service/server.py`。
2. **本地 ASR 也必须用户手动启动**：`main.py` 不会自动拉起 9900；用户需在 indextts env 中跑 `python asr_service/server.py`。使用云端 ASR（如 OpenAI）时配置 `asr.type=cloud` + `api_base` + `api_key` 即可，不需要启动本地服务。ASR 配置读自 `config.json` 的 `asr` 节（`settings.py` 管理，旧 config.json 无此节时自动回填默认）。
3. **api/domain/clients 三层不能跨越**：api 调 domain，domain 调 clients；不允许 api 直接 import httpx 或 api 直接读写文件。详见各层 mini-CLAUDE.md。
4. **`/v1/audio/speech` 与 `/api/match`+`/api/synthesize` 共用业务核心**：都走 `domain.matcher.match_for_text` + `domain.synthesizer.synthesize_with_reference`，行为一致；区别仅在 OpenAI 兼容路径有 24kHz 重采样与括号清洗。外部发现可用角色走 `GET /v1/voices`（OpenAI list 协议），复用 `domain.characters.list_all`，返回 id/name/avatar_url/sample_count/emotion_count/preview_audio_url。
5. **情绪叠加 0.6 折算**：`domain/matcher.py` 中当目标主情绪与参考音一致时把 emo_alpha 乘 0.6 防爆音——不要在 api 层重复实现。
6. **manual_emotion 强制覆盖 target_emotion**：用户在 `manualEmotionModal` 锁定情绪后，`matcher` 仍调 LLM 选候选 + 生成向量，但最终返回的 `target_emotion` 一定 == 用户值（双保险：prompt 指令 + 后端强覆盖）。
7. **`emo_vector` 偷渡协议**：`clients/tts.py` 把 `voice` 字段写成 `[EMO:[v0..v7]|alpha]base64:...`；`tts_service/server.py` 入口处用正则剥离。两端必须同步。
8. **`webapp/api/_progress.py`**：跨 router 共享的后台任务进度字典，进程重启会丢失（有意为之，详见 PRD 5.6）。
9. **API 白名单优先**：智能匹配候选池由 `domain/matcher._select_candidate_pool` 决定，受 `api_priority` 参数控制——开启时只要存在 `is_api_safe=true` 的素材就只用这批（独占而非加权），否则用全部已打标素材；关闭则忽略该标记直接用全集。前端通过 `/api/match` 的 `api_priority` 字段（设置页"允许 API 模式优先"开关）传入；OpenAI 兼容接口 `/v1/audio/speech` 固定 False（不限制 is_api_safe，使用全集已打标素材）。合并/切分产生的新 item `is_api_safe` 始终 false（不继承）。
10. **导入角色 ZIP 时强制刷新 char_id + 内容查重**：`domain.characters.import_zip` 先用 `_character_fingerprint`（基于 items 的 filename+text，与 char_id 无关）与现有角色比对，命中则抛 `DuplicateCharacter`（api 翻译为 409）拒绝导入，杜绝"同一角色被导入成两份、对外 `/v1/voices` 列表出现重复角色"；通过后把新 `library.json.char_id` 强制等于新目录名。这两步都不要去掉。
11. **`tts_service/server.py` 启动时清 uploads/**：`_clear_stale_uploads()` 在 `_init_engine` 前调用，处理上次崩溃残留；不要乱改顺序。
12. **前端为 Vite + React SPA**：`webapp/app.py` 直接 serve `webapp/frontend/index.html`（Vite 输出，asset 带 hash 无需时间戳）；`/assets/*` 挂 StaticFiles；所有非 API 路径回退到 index.html（SPA history 模式 fallback）。构建前根路由返回友好提示页而非 500。
13. **`outputs/` 永不自动清理**：有意为之（详见 PRD 5.6），用户自管。
14. **ffmpeg 信任系统 PATH**：不再绑内置 ffmpeg；用户需自行 `brew install ffmpeg`。

## 配置文件约定

`webapp/config/config.json`（首次启动时由 `webapp/settings.py` 自动在 `webapp/config/` 下创建）结构：
```jsonc
{
  "llm": {
    "active_type": "ollama",
    "configs": {<provider>: {api_base, api_key, model}}
  },
  "tts": {"type": "local"|"cloud", "api_base": "...", "api_key": "..."},
  "asr": {"type": "local"|"cloud", "api_base": "...", "api_key": "", "model": "whisper-small", "language": "zh"}
}
```

默认 `active_type=ollama`、`tts.type=local`（指向 `http://127.0.0.1:9800/v1`）、`asr.type=local`（指向 `http://127.0.0.1:9900/v1`）。远端 TTS/ASR 由用户填 api_base；没有任何内置远端节点。
