# emotionTTS_remake

> 本项目是 **B 站 UP 主 [@阿也nico](https://space.bilibili.com/58332755)** 分享代码的 **重制 / 交互优化版**。
> 在原作者开源工作的基础上重写了前后端架构、UX 与部署体验。详见文末 [致谢与原作者](#致谢与原作者归属)。

面向中文配音 / 有声内容创作者的本地 TTS（文本转语音）工作站。一句话功能：

> **上传一段参考音 → AI 自动切片、转写、打情绪标签 → 输入台词 → AI 挑出最合适的参考音 + 8 维情绪向量 → 一键合成带情感的克隆配音。**

https://github.com/user-attachments/assets/8382a4ba-56c6-4799-8c7b-767f3d924e9f

后端基于 [IndexTTS2](https://github.com/index-tts/index-tts)，前端是 Vite + React SPA，全部本地运行，支持 OpenAI 兼容 API 外部调用。

---

## ✨ 功能特性

- 🎭 **角色素材库**：上传参考音自动 → 静音切分 → Faster-Whisper 转写 → LLM 情感打标 → 落盘成可复用的角色库
- 🧠 **AI 智能匹配**：输入目标台词，LLM 在候选音池中挑选情绪最贴合的参考音，并动态生成 8 维情绪向量 `[喜, 怒, 哀, 惧, 厌, 低落, 惊, 平]` + Alpha 强度
- 🎙️ **零样本高保真克隆**：基于 IndexTTS2，参考音 + 文本 + 情绪向量 → 带情感的 WAV
- 📑 **长文本批量配音**：智能分段 → 批量匹配 → 串行合成 → 合并导出 / ZIP 打包
- ✂️ **素材库可视化编辑**：波形图试听、文案编辑、AI 重打标、手动切分、多段合并、API 白名单维护
- 🔌 **OpenAI 兼容 API**：`POST /v1/audio/speech`、`GET /v1/voices`，第三方应用（IM 机器人、Agent、剪辑插件等）可直接调用
- 📦 **角色一键导出 / 导入**：整套角色（含参考音、转写、情绪标签）打包成 ZIP，跨机器迁移
- 🔋 **完全本地化**：TTS、ASR、参考音都在本机；LLM 可走 Ollama 本地或自配的远端 API

---

## 🖥️ 系统要求

| 项 | 要求 |
| --- | --- |
| 操作系统 | macOS / Linux / Windows |
| Python | ≥ 3.10 |
| ffmpeg | 系统 PATH 中可用 |
| GPU | **强烈推荐**（IndexTTS2 推理）；CPU 也能跑但单句要数十秒 |
| 显存 | ≥ 8GB（FP16 模式） |
| 存储 | 本地全量模式约 10GB（IndexTTS2 checkpoints + Whisper small） |
| LLM | Ollama/lm studio 本地（小显存推荐 `qwen3.5:9b、qwen3.5-4b`,大显存推荐`qwen3.6:27b、qwen3.6-35b-a3b`,模型都可以在 https://modelscope.cn/models?name=qwen 下载）或任意 OpenAI 兼容 API（DeepSeek / SiliconFlow / 自定义） |

> ASR 与 TTS 均支持「本地 / 云端」二选一，最轻量的部署组合（云 TTS + 云 ASR）几乎不需要本地资源。
>
> **`python3` / `ffmpeg` / `git` / `curl` 这些系统依赖如果没装，部署脚本会询问并自动调用包管理器装好**：
> - **macOS**：用 Homebrew，缺 brew 时连 brew 一起装
> - **Linux**：自动识别 apt / dnf / yum / pacman / zypper
> - **Windows**：用 winget（Win10 1809+/Win11 内置），fallback 到 Chocolatey / Scoop
>
> 你不需要先手工准备它们。

---

## 🚀 快速开始

### 方案一：一键部署（推荐）

#### macOS / Linux

```bash
# 1) 克隆仓库
git clone https://github.com/mmletgo/emotionTTS_remake.git
cd emotionTTS_remake

# 2) 交互式部署向导（会引导你选择 TTS/ASR 部署方式、下载模型）
bash install.sh

# 3) 启动所有服务
bash start.sh

# 4) 浏览器打开
open http://127.0.0.1:9880      # macOS
# xdg-open http://127.0.0.1:9880  # Linux
```

#### Windows（原生 PowerShell，无需 WSL）

```powershell
# 1) 克隆仓库（缺 git 会被 install.ps1 自动装上，先用浏览器下载 ZIP 也行）
git clone https://github.com/mmletgo/emotionTTS_remake.git
cd emotionTTS_remake

# 2) 首次运行可能被执行策略拦住，先放行（仅当前会话有效）
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# 3) 交互式部署向导
.\install.ps1

# 4) 启动所有服务
.\start.ps1

# 5) 浏览器打开
start http://127.0.0.1:9880
```

> Windows 上 winget / Chocolatey / Scoop 安装系统依赖时可能弹 UAC 提权对话框，授权即可。
> 如果你完全没有 winget / choco / scoop，脚本会引导你装 winget（Win10 1809+ 自带，老系统从 Microsoft Store 装 "App Installer"）。

部署向导会自动完成：

- ✅ **检测并自动安装系统依赖**（python3 ≥ 3.10 / ffmpeg / git / curl）
  - macOS：走 Homebrew，没装 brew 时会先问你是否自动装 brew
  - Linux：自动识别 apt / dnf / yum / pacman / zypper 之一调用 `sudo` 安装
  - Windows：winget 优先，fallback 到 Chocolatey / Scoop
  - 全部自动安装步骤都会先询问 `[Y/n]` 再执行，不会偷偷动你的系统
- ✅ 让你选 TTS 方式：本地 IndexTTS2 / 云端 API
- ✅ 让你选 ASR 方式：本地 Whisper / 云端 API
- ✅ 准备 Python 虚拟环境
- ✅ 下载模型（Whisper small / IndexTTS2 checkpoints，支持 HF 镜像）
- ✅ 写入默认配置到 `webapp/config/config.json`

### 方案二：手动启动（适合已有 IndexTTS env 的开发者）

**macOS / Linux**

```bash
# 假设你已经有 indextts 的 Python 环境
export EMOTTS_PY=/path/to/indextts/venv/bin/python

# 终端 1：Web 中枢（必启，端口 9880）
$EMOTTS_PY main.py

# 终端 2：本地 IndexTTS2 推理服务（本地 TTS 模式必启，端口 9800）
INDEXTTS_MODEL_DIR=/path/to/index-tts/checkpoints \
    $EMOTTS_PY tts_service/server.py

# 终端 3：本地 Whisper ASR 微服务（本地 ASR 模式必启，端口 9900）
$EMOTTS_PY asr_service/server.py

# （可选）终端 4：前端开发模式，HMR
cd frontend && npm install && npm run dev
# 修改 frontend 源码后发布：npm run build → 产物入 webapp/frontend/
```

**Windows（PowerShell）**

```powershell
# 假设你已经有 indextts 的 Python 环境
$env:EMOTTS_PY = "C:\path\to\indextts\.venv\Scripts\python.exe"

# 终端 1：Web 中枢
& $env:EMOTTS_PY main.py

# 终端 2：本地 IndexTTS2 推理服务
$env:INDEXTTS_MODEL_DIR = "C:\path\to\index-tts\checkpoints"
& $env:EMOTTS_PY tts_service\server.py

# 终端 3：本地 Whisper ASR 微服务
& $env:EMOTTS_PY asr_service\server.py
```

> 只走云端 TTS 时不需要起 9800；只走云端 ASR 时不需要起 9900。

### 服务管理

**macOS / Linux**

```bash
bash start.sh status              # 查看各服务状态
bash start.sh stop                # 停止所有服务
bash start.sh restart             # 重启所有服务
bash start.sh logs webapp         # 实时查看 webapp 日志
bash start.sh logs tts            # 实时查看 tts_service 日志
bash start.sh logs asr            # 实时查看 asr_service 日志
bash start.sh logs all            # 同时跟踪所有日志
```

**Windows**

```powershell
.\start.ps1 status               # 查看各服务状态
.\start.ps1 stop                 # 停止所有服务
.\start.ps1 restart              # 重启所有服务
.\start.ps1 logs webapp          # 实时查看 webapp 日志（stdout + stderr 两个文件）
.\start.ps1 logs tts             # 实时查看 tts_service 日志
.\start.ps1 logs asr             # 实时查看 asr_service 日志
.\start.ps1 logs all             # 同时跟踪所有日志（用 Start-Job 多路 tail）
```

详细部署文档：[docs/DEPLOY.md](docs/DEPLOY.md)

---

## 📖 使用教程

主页 `http://127.0.0.1:9880` 有三个核心标签：**🛠️ 角色库** / **🎬 单句配音** / **📑 长文本配音**。下面按推荐顺序走一遍。

### 第 0 步：配置 LLM（必须）

LLM 是 EmotionTTS 的核心组件（情感打标 + 智能匹配），不配 LLM 主要功能都用不了。

1. 点击右上角 ⚙️ **设置**
2. **LLM 配置** 选一个提供商：
   - **Ollama（本地，推荐）**：需先 `ollama serve` 并 `ollama pull qwen3.5:9b`
   - **DeepSeek / SiliconFlow / 自定义**：填 api_base + api_key + model
3. **TTS 配置**：默认 `local`（指向 `http://127.0.0.1:9800/v1`），如需远端节点切换为 `cloud` 并填地址
4. **ASR 配置**：默认 `local`（指向 `http://127.0.0.1:9900/v1`），如需 OpenAI Whisper 切换为 `cloud`
5. 点击「保存」—— 后端会做**双重连通性校验**通过后才落盘

### 第 1 步：创建角色（上传参考音）

切到 **🛠️ 角色库** → **➕ 新建角色**：

1. 填角色名（如「芙宁娜」）
2. 拖一张头像（可选）
3. 拖入 1 个以上的参考音文件（推荐：去噪后的 1–30 分钟语音，wav / mp3 均可）
4. 调整 `min_silence_len`（默认 0.8 秒；越小切得越碎）
5. 勾选「AI 情绪打标」（默认开，会让 LLM 对每段切片打 8 维情绪标签）
6. 点击「开始构建」

后台四阶段流水线自动执行（前端实时进度条）：

```
切片 (5-15%) → ASR 转写 (15-50%) → LLM 情绪打标 (50-90%) → 写入 (90-100%)
```

完成后角色卡片自动出现在网格。

### 第 2 步：单句配音

切到 **🎬 单句配音**：

1. **角色下拉**选你刚创建的角色
2. **台词输入框**写台词，例如 `你居然在这里！`
3. 点击 **🚀 AI 智能合成**

幕后：
- 后端调 LLM 在角色素材库里挑出情绪最贴合的参考音
- LLM 同时生成 8 维情绪向量 + Alpha 强度
- 调用 IndexTTS2 合成 → 返回 WAV → 前端自动播放

#### 想精确控制？

- **🗂️ 手动选参考音**：从素材库里手工挑一条
- **🎭 锁定情绪**：在 `manualEmotionModal` 强制指定 `{primary, intensity, complex}`，LLM 会在锁定下选候选 + 生成向量
- **🎛️ 设置情绪向量**：直接拖 8 个滑块 + Alpha 强度，完全覆盖 LLM 输出

### 第 3 步：长文本批量配音

切到 **📑 长文本配音**：

1. 粘贴长文本 / 批量导入 TXT / 导入 SRT 字幕
2. 设置 `min_len`（默认 10 字），点 **✂️ 智能拆分段落**
3. 每个片段以「卡片」形式呈现，可独立：
   - 编辑文案、切换发音人、设置局部情绪向量、单独合成
   - 「向下拼接」「此处切分」对参考音做素材级编辑
4. 批量栏选「情绪起伏」全局权重，点 **🤖 智能选参考音频** 批量匹配
5. 点 **🚀 全部合成** 串行合成所有片段
6. 完成后 **💾 下载音频 ▾** 可：
   - **🔗 合并导出**：所有片段串联成一个长音频
   - **📦 批量导出为 ZIP**：每段一个 wav 打包

### 第 4 步：素材库管理（进阶）

点角色卡片上的「素材库」进入详情页：

- **波形图试听** + 在波形上拖红线 **手动切分**
- 多条素材勾选后 **合并** 成一条
- **🤖 一键 AI 情绪分析**：对未打标素材逐条调 LLM 打标
- **🤖 AI 重标情绪**：后端批量重打全部 / 指定范围的情绪
- **♡ / ♥ API 白名单**：标 ♥ 的素材会被优先用于 OpenAI 兼容 API 调用
- **📤 导出 ZIP** / **📥 导入 ZIP**：跨机器迁移角色

---

## 🔌 OpenAI 兼容 API

第三方应用可以把 emotionTTS_remake 当作一个 OpenAI 兼容的 TTS 服务调用。

### 列出可用角色

```bash
curl http://127.0.0.1:9880/v1/voices
```

返回（OpenAI list 协议）：

```json
{
  "object": "list",
  "data": [
    {
      "id": "char_66ff5e94",
      "name": "芙宁娜",
      "avatar_url": "/characters/char_66ff5e94/avatar.png",
      "sample_count": 180,
      "emotion_count": 7,
      "preview_audio_url": "/characters/char_66ff5e94/voice_lib/xxx.wav"
    }
  ]
}
```

### 合成音频

```bash
curl -X POST http://127.0.0.1:9880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "model": "emotionTTS",
    "input": "[惊讶] 你居然在这里！",
    "voice": "芙宁娜",
    "response_format": "wav",
    "speed": 1.0
  }' \
  --output out.wav
```

- `voice` 可以是 `char_id` 或角色名（容错：忽略空格 + 大小写做模糊匹配）
- `input` 中 `(...)` `[...]` `【...】` 内容会被自动剥离（避免被合成出来）
- 后端会自动执行：智能匹配参考音 → 生成情绪向量 → 合成 → 24kHz 重采样

### Python 调用示例

```python
import openai

client = openai.OpenAI(
    base_url="http://127.0.0.1:9880/v1",
    api_key="not-needed",  # 本地无鉴权
)

with client.audio.speech.with_streaming_response.create(
    model="emotionTTS",
    voice="芙宁娜",
    input="你居然在这里！",
) as response:
    response.stream_to_file("out.wav")
```

### 🤖 给 AI Agent 的提示

**如果你是正在阅读本文档的 AI agent（Claude / GPT / 本地 LLM 等），且当前任务需要"把文本变成带情感的角色配音"**（IndexTTS2 支持中文 / 英文 / 中英混合等多语言，不限于中文）：本仓库已经把上面这套 OpenAI 兼容协议封装成了一份可直接加载的 Skill 文件 —— [`docs/SKILL_OPENAI_TTS.md`](docs/SKILL_OPENAI_TTS.md)。

它带有 frontmatter `name: emotiontts-openai-api`，里面包含：

- 服务地址、前置条件、可选/必填参数清单
- `GET /v1/voices` 发现角色 + `POST /v1/audio/speech` 合成的完整请求/响应示例
- `voice` 字段的模糊匹配规则、`input` 中括号/动作提示词自动剥离行为
- 常见错误码与排障建议

**使用方式**：把 `docs/SKILL_OPENAI_TTS.md` 作为 skill / system prompt / 上下文片段加载，然后按里面给出的请求格式直接调用本机 `http://127.0.0.1:9880`，无需自行探索 API。

---

## 🗂️ 目录结构

```
emotionTTS_remake/
├── main.py                  # 启动器（端口检测 + uvicorn）
├── install.sh / start.sh    # 一键部署 + 服务管理
├── pyrightconfig.json       # 类型检查配置
├── CLAUDE.md                # 项目记忆（AI Agent 用）
├── docs/
│   ├── PRD.md               # 完整产品需求文档（BDD 描述全部功能）
│   └── DEPLOY.md            # 部署与运维细节
├── webapp/                  # Web 中枢（FastAPI on 9880）
│   ├── app.py               # FastAPI 入口
│   ├── api/                 # 薄壳 HTTP 层
│   ├── domain/              # 业务逻辑层
│   ├── clients/             # 外部 HTTP 客户端
│   ├── schemas/             # Pydantic 模型
│   ├── prompts/             # LLM system prompts
│   └── frontend/            # Vite + React SPA 构建产物
├── frontend/                # React 源码（Vite 8 + React 18 + TS 5）
├── tts_service/server.py    # 本地 IndexTTS2 推理服务（9800）
├── asr_service/server.py    # 本地 Whisper ASR 微服务（9900）
├── characters/              # 用户角色数据（gitignore）
├── outputs/                 # 合成产物（gitignore）
└── models/whisper-small/    # Faster-Whisper 本地模型
```

完整架构、约束、API 契约见 [docs/PRD.md](docs/PRD.md)。

---

## ⚙️ 配置文件

首次启动会在 `webapp/config/config.json` 自动写入默认配置：

```jsonc
{
  "llm": {
    "active_type": "ollama",
    "configs": {
      "ollama":     { "api_base": "http://127.0.0.1:11434/v1", "api_key": "", "model": "qwen3.5:9b" },
      "deepseek":   { "api_base": "https://api.deepseek.com/v1", "api_key": "", "model": "deepseek-chat" },
      "siliconflow":{ "api_base": "https://api.siliconflow.cn/v1", "api_key": "", "model": "deepseek-ai/DeepSeek-V3.2" },
      "custom":     { "api_base": "", "api_key": "", "model": "" }
    }
  },
  "tts": { "type": "local", "api_base": "http://127.0.0.1:9800/v1", "api_key": "" },
  "asr": { "type": "local", "api_base": "http://127.0.0.1:9900/v1", "api_key": "", "model": "whisper-small", "language": "zh" }
}
```

API Key 明文存储；本项目设计为**单机或受信内网**使用，不内置身份认证。

---

## ❓ 常见问题

### 端口被占用

**macOS / Linux**

```bash
lsof -i :9880   # webapp
lsof -i :9900   # asr_service
lsof -i :9800   # tts_service
lsof -ti:9880 | xargs kill -9   # 强制释放
```

**Windows（PowerShell）**

```powershell
Get-NetTCPConnection -LocalPort 9880 -ErrorAction SilentlyContinue   # webapp
Get-NetTCPConnection -LocalPort 9900 -ErrorAction SilentlyContinue   # asr_service
Get-NetTCPConnection -LocalPort 9800 -ErrorAction SilentlyContinue   # tts_service
# 强制释放：
Get-NetTCPConnection -LocalPort 9880 | Select -Expand OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

更优雅的方式：`.\start.ps1 stop`（或 `bash start.sh stop`）会按 PID 文件优雅关停，必要时兜底用端口杀残留。

### Whisper / IndexTTS 模型下载失败

国内网络访问 HuggingFace 不稳，使用镜像：

```bash
# macOS / Linux
HF_ENDPOINT=https://hf-mirror.com bash install.sh
```

```powershell
# Windows
$env:HF_ENDPOINT = "https://hf-mirror.com"; .\install.ps1
```

### Windows: 执行策略阻止脚本运行

报错 `cannot be loaded because running scripts is disabled on this system`：

```powershell
# 仅当前 PowerShell 会话放行（最安全）
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# 或永久放行当前用户（一次设置长期生效）
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### tts_service 长时间不响应

IndexTTS2 首次加载模型（尤其 CPU 模式）需要 2–5 分钟，属正常现象。`bash start.sh logs tts`（或 `.\start.ps1 logs tts`）查看加载进度。

### 想换 LLM 提供商

主页右上角 ⚙️ 设置 → LLM 配置 → 切换 `active_type` 后填 `api_base` / `api_key` / `model` → 保存。

更多排错见 [docs/DEPLOY.md](docs/DEPLOY.md)。

---

## 🤝 致谢与原作者归属

本项目的核心思路与早期实现来自 **B 站 UP 主 [@阿也nico](https://space.bilibili.com/58332755)** 分享的开源代码。原作者在视频和分享中无偿公开了基于 IndexTTS2 的本地配音工作流原型，为本项目奠定了基础。

**本项目 emotionTTS_remake 是在此基础上的重制 / 交互优化版**，主要改动：

- 🏗️ **架构重构**：后端按「api / domain / clients」三层模块化重构，前端整体重写为 Vite + React SPA
- 🎨 **UX 重做**：全新的角色库、单句配音、长文本批量配音三大主视图，移除原版「快速模式」「付费聚合节点」等耦合
- 🔌 **OpenAI 兼容增强**：补全 `/v1/voices` 列表协议，调整 `/v1/audio/speech` 与主 UI 共用业务核心
- 🚀 **部署体验**：一键 `install.sh` + `start.sh`，支持 4 种本地 / 云端 TTS×ASR 组合
- 🧹 **依赖瘦身**：移除增量更新、埋点、嵌入式 Python、内置 ffmpeg 等冗余，依赖用户系统 PATH

**底层 TTS 引擎**：[IndexTTS2](https://github.com/index-tts/index-tts)（IndexTeam 开源）
**ASR 引擎**：[Faster-Whisper](https://github.com/SYSTRAN/faster-whisper)
**LLM**：用户可选 Ollama / DeepSeek / SiliconFlow / 任意 OpenAI 兼容 API

向原作者、IndexTTS 团队、以及所有开源依赖的贡献者致谢。 ❤️

---

## 📄 License

本项目采用 [MIT License](LICENSE) 开源。

原作者的代码版权归原作者所有；本项目对其重制 / 优化部分的版权归 contributors 所有，均以 MIT 协议授权。
