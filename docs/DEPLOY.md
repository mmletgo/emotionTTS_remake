# EmotionTTS 部署与运维文档

## 快速开始

### 1. 一键部署

```bash
# 交互式部署向导（首次使用）
bash install.sh

# 查看帮助
bash install.sh --help
```

部署向导会引导你完成：
- 系统环境检测（python3 ≥ 3.10 / ffmpeg / git / curl）
- 选择 TTS 和 ASR 部署方式
- 准备 Python 环境
- 下载模型文件
- 写入默认配置

### 2. 启动服务

```bash
bash start.sh
```

服务启动后访问 `http://127.0.0.1:9880`

---

## 部署组合说明

共支持 4 种部署组合：

| TTS 方式 | ASR 方式 | 本地资源需求 | 适用场景 |
|---------|---------|------------|---------|
| 本地 IndexTTS2 | 本地 Whisper | GPU 推荐 + ~10GB 存储 | 完全离线，最高质量 |
| 本地 IndexTTS2 | 云端 API | GPU 推荐 + ~几 GB 存储 | 离线 TTS + 快速 ASR |
| 云端 API | 本地 Whisper | ~466MB 存储 | 快速启动 + 本地 ASR |
| 云端 API | 云端 API | 几乎无本地依赖 | 最快启动，全依赖网络 |

---

## 服务管理命令

```bash
bash start.sh                    # 启动所有服务（默认子命令）
bash start.sh status             # 查看各服务状态
bash start.sh stop               # 停止所有服务
bash start.sh restart            # 重启所有服务
bash start.sh logs webapp        # 实时查看 webapp 日志
bash start.sh logs asr           # 实时查看 asr_service 日志
bash start.sh logs tts           # 实时查看 tts_service 日志
bash start.sh logs all           # 同时跟踪所有日志
```

### status 输出示例

```
EmotionTTS 服务状态
──────────────────────────────────────────────────
SERVICE      PORT   PID      STATUS   LOG
──────────────────────────────────────────────────
webapp       9880   12345    RUN      .runtime/logs/webapp.log
asr_svc      9900   12346    RUN      .runtime/logs/asr.log
tts_svc      9800   -        OFF      -
──────────────────────────────────────────────────
```

---

## 运行时文件结构

`install.sh` 会生成以下运行时文件（均在 `.gitignore` 中）：

```
.runtime/
├── paths.env          # Python 路径、模型路径、功能开关
├── pids/
│   ├── webapp.pid     # webapp 进程 PID
│   ├── asr.pid        # asr_service 进程 PID
│   └── tts.pid        # tts_service 进程 PID
└── logs/
    ├── webapp.log     # webapp 输出
    ├── asr.log        # asr_service 输出
    └── tts.log        # tts_service 输出
```

`.runtime/paths.env` 格式：

```bash
PYTHON_BIN=/path/to/python
INDEXTTS_MODEL_DIR=/path/to/checkpoints   # 仅本地 TTS 时存在
ENABLE_LOCAL_TTS=true|false
ENABLE_LOCAL_ASR=true|false
```

---

## 常见问题排错

### 端口被占用

**症状**：启动报错 `Address already in use` 或健康探活超时

**排查**：
```bash
# 查看哪个进程占用了端口
lsof -i :9880   # webapp
lsof -i :9900   # asr_service
lsof -i :9800   # tts_service

# 强制释放端口
lsof -ti:9880 | xargs kill -9
```

**解决**：`bash start.sh stop` 后再 `bash start.sh`

---

### Whisper 模型下载失败

**症状**：`install.sh` 报 "Whisper 模型下载失败"

**原因**：网络无法访问 HuggingFace

**手动下载**：

```bash
# 方式 1：使用国内镜像
git clone --depth=1 https://hf-mirror.com/Systran/faster-whisper-small \
    models/whisper-small

# 方式 2：设置环境变量后重跑
HF_ENDPOINT=https://hf-mirror.com bash install.sh
```

---

### IndexTTS checkpoints 下载失败

**症状**：`install.sh` 报 "checkpoint 下载失败"

**手动下载**：

```bash
# 设置镜像后下载
HF_ENDPOINT=https://hf-mirror.com huggingface-cli download \
    IndexTeam/IndexTTS-2 \
    --local-dir=/path/to/index-tts/checkpoints

# 或使用 ModelScope
pip install modelscope
modelscope download --model IndexTeam/IndexTTS-2 \
    --local_dir /path/to/index-tts/checkpoints
```

下载完成后选择「已有 venv」模式重跑 `bash install.sh`。

---

### IndexTTS venv 路径错误

**症状**：start.sh 启动 tts_service 报错，日志中有 `No module named 'indextts'`

**排查**：
```bash
# 检查 paths.env 中 PYTHON_BIN 是否正确
cat .runtime/paths.env

# 验证 venv 中是否有 indextts
$PYTHON_BIN -c "import indextts; print(indextts.__file__)"
```

**解决**：重新运行 `bash install.sh`，选择正确的 venv 路径。

---

### webapp 启动后无法访问

**症状**：`curl http://127.0.0.1:9880/` 报连接拒绝

**排查**：
```bash
# 查看 webapp 日志
bash start.sh logs webapp

# 或直接查看日志文件
tail -50 .runtime/logs/webapp.log
```

**常见原因**：
- Python 环境缺少依赖（fastapi / uvicorn）
- 端口 9880 被其他进程占用
- `webapp/config/` 目录权限问题

---

### tts_service 长时间不响应

**症状**：健康探活超时，但日志显示正在加载

**说明**：IndexTTS2 首次加载模型（尤其 CPU 模式）可能需要 2-5 分钟，属正常现象。

```bash
# 持续查看 tts 日志确认加载进度
bash start.sh logs tts
```

---

### LLM 配置

LLM 是 EmotionTTS 的核心组件（情感打标 + 智能匹配），必须配置才能使用主要功能。

**配置入口**：Web UI → 右上角设置图标 → LLM 配置

**默认配置**：Ollama 本地，模型 `qwen2.5:7b`

**支持的提供商**：
- Ollama（本地，需先启动 `ollama serve` 并拉取模型）
- OpenAI 兼容 API（OpenAI / DeepSeek / SiliconFlow / 等）
- 自定义 API Base URL

---

## 重新部署 / 更新配置

重新运行 `bash install.sh` 是安全的（幂等操作）：
- 已有配置会询问是否覆盖
- 已下载的模型不会重复下载
- 已有 venv 可选择跳过创建

如果只想更改 TTS/ASR 配置，也可以直接编辑 `webapp/config/config.json`，修改后 `bash start.sh restart` 生效。
