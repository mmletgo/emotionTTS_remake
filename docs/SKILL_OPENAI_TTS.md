---
name: emotiontts-openai-api
description: 通过 OpenAI 兼容协议调用 EmotionTTS 本地 TTS 服务，按"角色名"指定音色并自动注入情绪向量。底层 IndexTTS2 支持中文 / 英文 / 中英混合等多语言。适用场景：让外部 AI / 第三方客户端 / 自动化脚本把任意文本合成为带情感的角色配音 WAV。触发关键词：emotionTTS、/v1/audio/speech、本地 TTS、角色配音、有声内容生成、配音、TTS、text-to-speech。
---

# EmotionTTS OpenAI 兼容 API Skill

EmotionTTS 是一套本地部署的情感配音 TTS 系统，底层 IndexTTS2 模型支持多语言（以中英为主，可中英混合）。它在标准 OpenAI Audio API 之上做了一处扩展：`voice` 字段不再是固定的预设音色（如 alloy / echo），而是用户在自己机器上建立的**角色素材库**（如"胡桃""灵儿""Narrator"）。服务端会根据输入文本自动用 LLM 选出最贴合的参考音并生成 8 维情绪向量，再交给 IndexTTS2 合成。

外部调用方只需要遵循 OpenAI 的请求格式即可，无需理解情绪向量、参考音匹配等内部细节。

## 服务地址与前置条件

- **Base URL**：`http://<host>:9880`（默认本机 `http://127.0.0.1:9880`）
- **认证**：本地服务**不校验 API Key**，可以传任意字符串或留空
- **依赖服务**：
  - Web 中枢（9880）—— 必须运行
  - IndexTTS2 推理服务（9800）—— 必须运行（实际合成在这里）
  - LLM —— 必须在服务端 `config.json` 中配置好（用于情绪分析与参考音匹配）
- **目标角色**：必须已经在本地建立至少一条已打过情绪标的素材

通常由部署方提前把服务拉起来，调用方只需要拿到 Base URL 和一个有效的角色名 / 角色 id。**但如果调用方是运行在本机上的 Agent（包括 Claude Code 这类 CLI Agent），且发现服务未启动，可以按下一节"Agent 自助启停服务"的流程主动拉起本地服务，用完后再关掉**。

## Agent 自助启停服务（仅本机 Agent 场景）

适用对象：Agent 直接运行在 EmotionTTS 仓库所在的本机上，具备执行 `bash` 的权限，且仓库目录可写。**远程调用方请跳过本节**。

### 工作流

1. **先探测**：调用 `curl -sf http://127.0.0.1:9880/v1/voices` 或 `bash start.sh status`，判断 webapp（9880）和 tts_service（9800）是否已经在跑。
   - 已经在跑 → 直接进入合成调用，**不要再启动、也不要在用完后停掉**（这些是用户开发会话里在用的服务，关掉等于打断用户）。
   - 未启动 → 进入第 2 步。
2. **临时启动**（仅当确认服务未跑、且本次任务需要）：在仓库根目录执行 `bash start.sh`。脚本会按 `config.json` 自动拉起 webapp，以及（当 `tts.type=local` 时）tts_service 与 asr_service。脚本以 `nohup` 后台拉起并写入 `.runtime/pids/`、`.runtime/logs/`，前台立即返回。
3. **等待就绪**：循环 `curl -sf http://127.0.0.1:9880/v1/voices` 直到返回 200（一般 1–10s；首启会更慢）。tts_service 首次加载模型可能需要 30–90s——`POST /v1/audio/speech` 在模型未就绪时会以 500/超时报错，Agent 应当带重试或等到 `bash start.sh status` 中 tts 为 RUN。
4. **执行任务**：按本文档其余章节正常调用 `/v1/voices` 与 `/v1/audio/speech`。
5. **任务结束后必须关停**（仅针对"本 Agent 自己启动的"那次）：执行 `bash start.sh stop`，避免占用用户的端口与显存。如果第 1 步发现服务原本就在跑，**禁止**在结束时调用 stop。

### 关键命令速查

```bash
# 仓库根目录
bash start.sh status          # 查状态（不会启动任何东西）
bash start.sh                 # 启动（已在跑的服务会被跳过）
bash start.sh stop            # 停止所有由本脚本管理的服务
bash start.sh logs webapp     # 跟踪 webapp 日志（tail -f；调试用，Agent 通常直接读文件）
```

日志文件位置：`.runtime/logs/{webapp,tts,asr}.log`。Agent 排错时建议直接 `tail -n 200 .runtime/logs/tts.log` 而不是 `logs` 子命令（后者会阻塞）。

### 注意事项

- **首次部署需要先跑一遍 `bash install.sh`**（交互式）。Agent 不要替用户执行 install.sh，如果 `bash start.sh` 报 `PYTHON_BIN 无效`，提示用户人工运行 install.sh，不要自行猜配置。
- **本机独占**：tts_service 单卡串行。Agent 启动期间不要再起第二份，否则端口冲突直接失败。
- **不要修改 `config.json`**：Agent 只负责启停，不要为了"让本地 tts 跑起来"擅自把 `tts.type` 从 cloud 改成 local——这是用户的部署选择，改了等于改用户配置。
- **关停是义务，不是可选**：Agent 拉起的服务如果忘记 stop，会持续占 9880/9800/9900 端口和显存，下次用户开发时会撞车。每个会话内"谁启动谁负责关停"。

## 端点 1：列出可用角色 `GET /v1/voices`

在合成之前，调用方应当先发现本地有哪些角色可用。返回格式遵循 OpenAI list 协议（`{"object":"list","data":[...]}`）。

### 请求

```http
GET /v1/voices HTTP/1.1
Host: 127.0.0.1:9880
```

无请求体。

### 响应

```json
{
  "object": "list",
  "data": [
    {
      "id": "char_1716548000",
      "name": "胡桃",
      "avatar_url": "/characters/char_1716548000/avatar.png",
      "sample_count": 42,
      "emotion_count": 7,
      "preview_audio_url": "/characters/char_1716548000/voice_lib/sample_0001.wav"
    }
  ]
}
```

字段说明：
- `id`：角色目录名（机器友好，建议存库）
- `name`：用户起的中文名（人类友好，可直接在 UI 下拉显示）
- `sample_count`：素材库内已打标的样本数
- `emotion_count`：覆盖了多少种情绪
- `avatar_url` / `preview_audio_url`：相对路径，需要前置 Base URL 才能访问

## 端点 2：合成语音 `POST /v1/audio/speech`

OpenAI Audio Speech API 的兼容实现。

### 请求

```http
POST /v1/audio/speech HTTP/1.1
Host: 127.0.0.1:9880
Content-Type: application/json
Authorization: Bearer any-string  # 可省略

{
  "model": "emotionTTS",
  "input": "你好呀，今天过得怎么样？",
  "voice": "胡桃",
  "response_format": "wav",
  "speed": 1.0
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 否 | OpenAI 协议要求字段，本服务不依赖具体值，传 `"emotionTTS"` 即可 |
| `input` | string | **是** | 要合成的文本。IndexTTS2 支持中文 / 英文 / 中英混合等多语言；具体语种的发音效果取决于角色参考音的语种与训练覆盖度。允许包含 `（...）` `(...)` `【...】` `[...]` 形式的舞台提示，服务端会自动剥离后再合成 |
| `voice` | string | **是** | 角色名（中文名）**或**角色 id（目录名），两者都接受 |
| `response_format` | string | 否 | 输出容器/编码，可选 `wav` / `mp3` / `opus` / `aac` / `flac` / `pcm`，默认 `wav`。`pcm` 为 OpenAI 约定的裸样本：24kHz / 单声道 / 16-bit signed little-endian / 无文件头 |
| `speed` | float | 否 | 语速倍率，范围 `0.25`–`4.0`，默认 `1.0`。服务端用 ffmpeg `atempo` 滤镜变速并保持音高 |

### 响应

成功：HTTP 200，`Content-Type: audio/wav`，body 为 WAV 二进制（24kHz、单声道，QQ 等客户端兼容）。

失败：

| 状态码 | 触发条件 | 处理建议 |
| --- | --- | --- |
| 404 | `voice` 找不到对应角色 | 先调用 `/v1/voices` 确认角色存在 |
| 400 | 角色素材库为空或全部未打标 | 联系部署方在该角色下追加并打标素材 |
| 404 | 服务端参考音文件丢失（数据被人手动删除等） | 联系部署方修复素材库 |
| 422 | `speed` 超出 [0.25, 4.0] 或 `response_format` 不在白名单 | 客户端校验入参 |
| 500 | 内部错误（LLM 调用失败、TTS 服务未启动、ffmpeg 后处理失败等） | 检查 9800 推理服务、LLM 配置、ffmpeg 是否在 PATH |

错误响应体形如 `{"detail": "角色【XXX】不存在"}`。

## 完整调用示例

### curl

```bash
# 1. 发现角色
curl http://127.0.0.1:9880/v1/voices

# 2. 合成并落盘
curl -X POST http://127.0.0.1:9880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "model": "emotionTTS",
    "input": "今天的风也好温柔啊。",
    "voice": "胡桃"
  }' \
  --output hutao_line.wav
```

### Python — requests

```python
import requests

BASE = "http://127.0.0.1:9880"

# 1. 列举可用角色（首次或缓存失效时）
voices = requests.get(f"{BASE}/v1/voices").json()["data"]
print({v["name"]: v["id"] for v in voices})

# 2. 合成（voice 直接用中文名）
resp = requests.post(
    f"{BASE}/v1/audio/speech",
    json={
        "model": "emotionTTS",
        "input": "（轻声）你听，外面下雨了。",
        "voice": "胡桃",
    },
    timeout=120,  # 长文本可能慢，建议 60-180s
)
resp.raise_for_status()
with open("out.wav", "wb") as f:
    f.write(resp.content)
```

### Python — openai SDK（用 base_url 指向本地）

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:9880/v1",
    api_key="not-used",          # 必填占位，不校验
)

# 发现
voices = client.models.list()  # 不可用，本服务未实现 /v1/models
# 改为：
import httpx
voices = httpx.get("http://127.0.0.1:9880/v1/voices").json()["data"]

# 合成
audio = client.audio.speech.create(
    model="emotionTTS",
    voice="胡桃",
    input="春风又绿江南岸，明月何时照我还。",
)
audio.stream_to_file("poem.wav")
```

### JavaScript / Node — fetch

```javascript
const BASE = "http://127.0.0.1:9880";

const voices = await fetch(`${BASE}/v1/voices`).then(r => r.json());

const resp = await fetch(`${BASE}/v1/audio/speech`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "emotionTTS",
    input: "欢迎来到璃月港。",
    voice: "胡桃",
  }),
});
const buf = Buffer.from(await resp.arrayBuffer());
require("fs").writeFileSync("welcome.wav", buf);
```

## 设计与使用约定

1. **角色寻址优先级**：服务端先按 id（目录名）精确匹配，再按 name（中文名）匹配。若同名角色存在多个，命中顺序取决于目录扫描顺序——为避免歧义，建议生产环境用 id。
2. **舞台提示自动剥离**：`input` 中的 `（你好）` `(stage whisper)` `【旁白】` `[SFX]` 等括号片段在合成前会被正则去掉。不要依赖它们影响语气；情绪由文本本身的语义决定。
3. **情绪由 LLM 自动判定**：调用方**不需要**也**不能**通过本接口指定情绪向量。如需手动锁定情绪，请使用项目内部接口 `/api/match` + `/api/synthesize`（不在本 Skill 覆盖范围）。
4. **候选音池**：本接口使用角色**全部已打标素材**（不限制 `is_api_safe` 标记），命中率最高。
5. **响应格式**：`response_format` 在合成完成后由服务端 ffmpeg 转码，支持 wav / mp3 / opus / aac / flac / pcm 六种。所有有头格式的采样率均为 24kHz / 单声道；pcm 为同规格的无头裸样本。
6. **`speed` 实现**：服务端用 ffmpeg `atempo` 滤镜变速（保持音高），合法范围 `0.25`–`4.0`，超出会被 Pydantic 校验拒绝（422）。后处理会增加 0.2–1s 不等的额外耗时。
7. **超时**：单句通常 2–10s，长段落（>200 字）可能 30s+。speed 偏离 1.0 或选择非 wav 格式会再叠加少量后处理时间。建议客户端超时设 120s 以上。
8. **并发**：服务端 TTS 推理是单卡串行，多请求会排队。客户端不要无脑并发，否则只会拉长每个请求的等待时间。
9. **无鉴权**：默认部署不带 API Key 校验。如果暴露到公网，请用 nginx / Caddy 在前面套一层 Basic Auth 或 mTLS。

## 与标准 OpenAI TTS 的差异速查

| 维度 | OpenAI 官方 | EmotionTTS |
| --- | --- | --- |
| `voice` 取值 | 固定 alloy/echo/fable/onyx/nova/shimmer | **任意自建角色名 / id** |
| 情绪表达 | 无 | LLM 自动选择 + 8 维向量驱动 |
| `model` 取值 | tts-1 / tts-1-hd | 任意字符串（不校验） |
| `response_format` | mp3 / opus / aac / flac / wav / pcm | **同款 6 种**（默认 wav 而非 mp3） |
| `speed` | 0.25–4.0 实际生效 | **同款 0.25–4.0**，ffmpeg atempo 保持音高 |
| 鉴权 | Bearer API Key 必填 | 默认无校验 |
| 发现端点 | 无 | 额外提供 `GET /v1/voices` |

## 调试建议

- 返回 404 时先 `curl /v1/voices` 看角色是否存在、名字拼写是否一致（注意全/半角差异）。
- 返回 500 且日志提示连接 9800 失败 → 部署方未启动 IndexTTS2 推理服务。
- 返回 500 且日志提示 LLM 报错 → 部署方 `config.json` 中的 LLM 配置不可用（api_base / api_key / model 检查）。
- 合成音质异常（破音 / 卡顿）→ 反馈给部署方让其在素材库中补充该角色更高质量的参考音；调用方层面无法调优。
