# EmotionTTS 产品需求文档（PRD）

> 本文档使用 BDD（行为驱动开发）`Given / When / Then` 范式，覆盖 EmotionTTS 全部功能与业务逻辑。

> **【精简版变更说明】** 本仓库相对原 v4.5 版本已剔除以下能力，对应章节请视为废弃：
> - 增量更新机制（main.py 不再检查远端 version.json）
> - 启动埋点（umami_tracker）
> - "快速模式"（quick 节点 + 作者付费聚合节点 101.201.246.121:3000）
> - 单独校验付费 TTS Key 的接口（/api/tts/verify_key）
> - 旧版本配置自动迁移到 quick 模式
> - Windows 一键启动批处理（一键启动.bat / 启动TTS服务.bat）+ webapp/.venv 嵌入式 Python
> - lite.html / lite_server.py（精简版独立部署）
> - tts_service/ 中原本含 IndexTTS2 模型源代码（改为依赖用户 indextts env，仅保留 `tts_service/server.py` 轻量 wrapper）
> - 内置 ffmpeg / ffprobe 二进制（改为信任系统 PATH）
>
> 默认 LLM 改为 `ollama`；默认 TTS 改为 `local`（127.0.0.1:9800）。

---

## 0. 文档总览

### 0.1 产品定位
EmotionTTS 是一个面向中文配音/有声内容创作者的本地 + 云端混合 TTS（文本转语音）工作站。它通过"参考音素材库 + 大语言模型(LLM)情感分析 + 8 维情绪向量驱动的 IndexTTS2 模型"三层能力，实现**带情感色彩的高保真零样本声音克隆**。

### 0.2 用户角色（Persona）
| 角色 | 说明 |
| --- | --- |
| **创作者用户** | 视频/小说/广播剧/游戏 Mod 配音者；通过 Web UI 创建角色、合成台词 |
| **第三方应用开发者** | 通过 OpenAI 兼容协议 `/v1/audio/speech` 把 EmotionTTS 当作可调用的 TTS 服务 |
| **本机系统管理员** | 负责安装、启动、升级、配置 LLM/TTS/ASR 三个外部 Key 的人（通常与用户同一人） |

### 0.3 术语表
| 术语 | 含义 |
| --- | --- |
| **角色（character）** | 一个被克隆的声音身份，含名称、头像、参考音库 |
| **素材（item）** | 角色音库内的一条参考音 + 其转录文本 + 情感标签 |
| **library.json** | 单个角色的全量元数据（含 items 数组） |
| **情绪向量（emo_vector）** | 8 维浮点数组 `[高兴, 愤怒, 悲伤, 恐惧, 反感, 低落, 惊讶, 自然]`，每维 0–1，建议总和 ≤ 0.8 |
| **Alpha 权重（emo_alpha）** | 情绪向量整体强度，0.1–1.0 |
| **本地模式（local）** | TTS 走本机 IndexTTS2 服务（9800 端口），免 Key |
| **远端模式（cloud）** | TTS 走用户自部署的远端 IndexTTS2 节点（用户填 api_base） |
| **AI 智能匹配** | 把候选音池交给 LLM，由它挑出与目标台词情感最契合的参考音并生成 emo_vector |
| **API 白名单** | `is_api_safe=true` 的素材集合；OpenAI 兼容 API 调用时优先用这个集合 |
| **任务进度（task_progress）** | 服务端进程内变量，键为 `char_id` 或 `${char_id}_append` |

### 0.4 范围声明
本 PRD 覆盖：Web UI 主版本（index.html）、Web 中枢（FastAPI on 9880）、本地 IndexTTS2 服务（FastAPI on 9800，轻量 wrapper `tts_service/server.py`，依赖用户的 indextts env）、启动器（`python main.py`）。

本 PRD **不覆盖**：IndexTTS2 模型本身的训练 / 算法细节、用户网络环境拓扑、密钥服务方的计费体系。

---

## 1. 系统架构

### 1.1 进程拓扑
```
┌──────────────────────────────────────────────────────┐
│ main.py (启动器，端口检查 → uvicorn 同进程)            │
└──────────────────────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────────────────────┐
        │ Web 中枢 9880 (webapp.app:app)              │
        │                                              │
        │  webapp/api/         （薄壳 HTTP）           │
        │   ├─ config / characters / emotion          │
        │   ├─ synthesis / openai_compat              │
        │   └─ _progress.py（进程内任务进度字典）       │
        │                                              │
        │  webapp/domain/      （业务核心）             │
        │   ├─ characters / library_builder           │
        │   ├─ library_editor / matcher                │
        │   ├─ synthesizer / text_splitter            │
        │                                              │
        │  webapp/clients/     （HTTP 客户端）          │
        │   ├─ llm.py  → 外部 OpenAI 兼容 LLM         │
        │   └─ tts.py  → IndexTTS2 服务               │
        └─────────────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────────┐
        ▼                                 ▼
┌──────────────────┐              ┌─────────────────────────┐
│ 用户自配 LLM     │              │ 本地 TTS 9800           │
│ (Ollama/远端 etc)│              │ tts_service/server.py   │
└──────────────────┘              │ (用户在自己的 indextts   │
                                  │  env 中手动启动)         │
                                  │   /health               │
                                  │   /v1/audio/speech      │
                                  │ 单例 + 线程串行锁         │
                                  └─────────────────────────┘
```

### 1.2 数据存储
| 位置 | 内容 |
| --- | --- |
| `characters/{char_id}/library.json` | 角色元数据 + 素材索引 |
| `characters/{char_id}/avatar.{png|jpg|jpeg|webp}` | 角色头像（最多 1 张） |
| `characters/{char_id}/voice_lib/*.{mp3|wav}` | 参考音文件 |
| `outputs/synth_*.wav` | 主 UI 合成产物 |
| `outputs/api_synth_*.wav` | OpenAI 兼容接口合成产物 |
| `outputs/merged_*.wav` | 多片段合并导出产物 |
| `webapp/config/config.json` | 全局配置（LLM / TTS） |
| `models/whisper-small/` | 本地 Faster-Whisper 模型（int8 量化） |

### 1.3 外部依赖
| 类型 | 用途 | 默认/示例地址 |
| --- | --- | --- |
| **LLM 提供商**（五选一） | 情感分析、智能匹配 | `ollama`（默认）、`siliconflow`、`youzhi`、`deepseek`、`custom` |
| **本地 TTS** | 合成音频（默认） | `http://127.0.0.1:9800/v1/audio/speech` |
| **远端 TTS** | 用户自部署 IndexTTS2 远端服务（可选） | 由用户在配置中填写 api_base |
| **本地 ASR** | 参考音转录 | `models/whisper-small`（faster-whisper, int8） |

---

## 2. 功能场景（BDD）

> 每个能力按 `Feature → Scenario` 组织。`Background` 段落定义该 Feature 的共用前置条件。所有 Scenario 都从用户视角描述，技术细节放在 `Note` 行。

---

### Feature 2.1 应用启动

**Background**
- 项目位于 `<ROOT>`
- 用户运行 `python main.py` 启动 Web 中枢
- 如需本地 TTS 模式，用户需另在自己的 indextts env 中运行 `python tts_service/server.py`

#### Scenario 2.1.1 Web 中枢端口被占用时拒绝启动
```gherkin
Given 9880 端口已被其它进程占用
When 用户运行 python main.py
Then 控制台打印 "❌ 端口 9880 已被占用，启动中止。"
And 进程以非零状态退出
```

#### Scenario 2.1.2 启动成功后引导用户访问
```gherkin
Given Web 中枢已在 9880 监听
When 系统输出最终提示
Then 控制台打印 "🎉 Web 中枢已就绪: http://127.0.0.1:9880"
And 在 macOS / Windows 平台自动调用 webbrowser.open
And 同时提示用户如需本地 TTS 模式请在 indextts env 中启动 tts_service/server.py
```

---

### Feature 2.3 系统配置与连通性验证

**Background**
- 用户首次进入系统时尚无有效 Key
- Web 中枢已就绪
- 前端通过顶栏的"⚙️ 设置"按钮打开 `configModal`

#### Scenario 2.3.1 读取当前配置
```gherkin
Given 用户已打开主页 index.html
When 前端发起 GET /api/config
Then 后端返回 {config: <完整配置对象>}
And 若 config.json 不存在则返回内置默认值
And 默认 llm.active_type = "ollama"
And 默认 tts.type = "local"，api_base = "http://127.0.0.1:9800/v1"
```

#### Scenario 2.3.2 旧版 api_base 自动裁剪
```gherkin
Given 某个 LLM 配置的 api_base 以 "/chat/completions" 结尾（早期版本错误格式）
When 后端读取配置
Then 系统自动把后缀裁掉，转换为以 "/v1" 结尾的标准 base
```

#### Scenario 2.3.3 主页探活：双引擎连通性检测
```gherkin
Given 用户已配置好 LLM 与 TTS
When 前端发起 GET /api/config/verify_active
Then 后端顺序执行：
  - 若 tts.type == "local": GET http://127.0.0.1:9800/health，成功则 tts_status = "local_ready"
  - 若 tts.type == "cloud": GET {tts.api_base}/models，成功则 tts_status = "success"
  - LLM: 取 active_type 对应配置，发送测试 chat 请求，成功则 llm_status = "success"
And 返回 {status, tts_status, llm_status}
And 若任一引擎失败，整体 status = "error"
```

#### Scenario 2.3.4 保存配置时做双重校验后才落盘
```gherkin
Given 用户在 configModal 内填写了 LLM 与 TTS 字段
When 前端 POST /api/config/validate 提交完整配置
Then 后端依次：
  1. 用候选 LLM 配置发测试请求；不通过则 HTTP 400 "大模型连通失败: <原因>"
  2. 用候选 TTS 配置做 verify_tts（local 走 /health，cloud 走 {api_base}/models）；不通过则 HTTP 400
And 全部通过后写入 config.json
And 返回 {status: "success", msg: "配置双重校验通过并已应用！"}
```

#### Scenario 2.3.5 配置校验失败时不写盘
```gherkin
Given /api/config/validate 流程中 LLM 测试 4xx/5xx
When 后端检测到 verify_llm_config 返回 valid=false
Then 后端立即抛 HTTPException 400，不调用 save_config
And 前端在 verifyMsg 区域显示红色错误信息
```

---

### Feature 2.5 创建角色（自动切片）

**Background**
- 用户已在主页切换到"🛠️ 角色库"标签
- 用户准备了 1 个以上的语音文件（推荐去掉噪音，时长 1–30 分钟）

#### Scenario 2.5.1 上传音频自动构建角色素材库
```gherkin
Given 用户点击"➕ 新建角色"并填写：
  - char_name = "芙宁娜"
  - avatar = furina.png（可选）
  - files = [voice_clip_01.wav, voice_clip_02.mp3]
  - min_silence_len = 0.8 秒
When 前端发起 POST /api/characters (multipart/form-data)
Then 后端：
  1. 生成 char_id 形如 char_<8 位十六进制>
  2. 创建 characters/{char_id}/，保存 avatar 与原始上传文件
  3. 在 BackgroundTasks 中提交 build_character_dataset(char_id)，立即同步返回 {status: "success", char_id}
And 前端开始每 ~2 秒轮询 GET /api/progress/{char_id}
```

#### Scenario 2.5.2 自动切片流水线
```gherkin
Given build_character_dataset 后台任务已启动
When 后台任务开始执行
Then 系统按顺序执行：
  1. WAV 文件先压缩为 MP3 (bitrate=128k)，降低后续上传/识别成本
  2. 全部音频统一响度标准化到 -20 dBFS
  3. pydub.silence.split_on_silence 切片
     · min_silence_len = 用户传入秒 * 1000 ms
     · silence_thresh = -40 dB（硬编码）
     · keep_silence = 150 ms
  4. 丢弃 < 0.5 秒的过短片段
  5. 对每个有效片段调用 transcribe_audio_smart(filepath)
     · asr.type == "custom" → 调云端 ASR (OpenAI 兼容 /audio/transcriptions)
     · asr.type == "local"  → 调本地 faster-whisper (CPU/int8) 单例
  6. 文本清理：移除 (...) [...] 【...】 及内部内容，中文上下文下把英文 ,?!:; 替换为中文标点
  7. 文本为空的片段直接丢弃且删除其音频文件
  8. 每条有效片段生成 item: id 连续递增、filename = "voice_lib/{char_id}_NNNN.mp3"、emotion 默认 {primary:"平", complex:"", intensity:"Medium"}、duration 精确到 0.01s
  9. 写入 library.json
  10. 删除所有临时文件与原始上传文件
And task_progress[char_id] 从 0 → 5 → 15-95（识别中）→ 100（完成）
And 失败时 task_progress[char_id].status = "error"，包含错误消息
```

#### Scenario 2.5.3 进度查询
```gherkin
Given 后台任务正在执行
When 前端发起 GET /api/progress/{char_id}
Then 后端返回 {progress: 0-100, msg: "<消息>", status: "running"|"success"|"error"}
And 若 task_id 未注册，返回 {progress: 0, msg: "等待中...", status: "running"} (兜底)
```

#### Scenario 2.5.4 创建后自动刷新角色列表
```gherkin
Given task_progress[char_id].status 变为 "success"
When 前端轮询拿到 success
Then 前端关闭进度对话框
And 前端重新调用 GET /api/characters 刷新角色网格
And 新角色卡片自动显示在列表中
```

---

### Feature 2.6 角色管理：列表、查看、改名、换头像、删除、追加、导入、导出

#### Scenario 2.6.1 列出所有角色
```gherkin
Given characters/ 下存在若干角色目录
When 前端发起 GET /api/characters
Then 后端遍历所有子目录，读取 library.json
And 返回 [{id, name, avatar, count, preview_audio}, ...]
And 跳过 library.json 损坏的角色目录（不抛错）
And 每个角色的 preview_audio 取 items 数组的第一条
```

#### Scenario 2.6.2 查看角色详情
```gherkin
Given 用户在角色库点击"素材库"
When 前端发起 GET /api/characters/{char_id}/details
Then 后端返回该角色完整的 library.json
And 角色不存在时返回 HTTP 404 "Character not found"
```

#### Scenario 2.6.3 重命名角色
```gherkin
Given 用户在 editCharNameModal 输入新名字
When 前端 POST /api/characters/{char_id}/rename {new_name: "<新名>"}
Then 后端读 library.json，更新 char_name 字段，写回
And 返回 {status: "success"}
And 角色不存在时返回 HTTP 404 "找不到该角色"
```

#### Scenario 2.6.4 更换头像
```gherkin
Given 用户上传新头像文件
When 前端 POST /api/characters/{char_id}/avatar (multipart, avatar=<file>)
Then 后端：
  1. 删除现有 avatar.{png|jpg|jpeg|webp}
  2. 按上传文件扩展名保存新 avatar
And 返回 {status: "success"}
```

#### Scenario 2.6.5 删除角色
```gherkin
Given 用户在角色卡片点击"删除"并确认
When 前端 DELETE /api/characters/{char_id}
Then 后端递归删除 characters/{char_id}/ 整个目录（含 library、avatar、voice_lib）
And 返回 {status: "success"}
And 操作是幂等的：目录不存在时也返回 success
And 删除不可恢复
```

#### Scenario 2.6.6 追加音频素材
```gherkin
Given 用户已选中某个角色，点击"➕ 手动补充"上传新音频
When 前端 POST /api/characters/{char_id}/append (multipart, files=[...], min_silence_len=0.8)
Then 后端在 BackgroundTasks 中提交 append_character_dataset
And 立即返回 {status: "success"}，task_id 为 "{char_id}_append"
And 后台任务执行与 build_character_dataset 相同的切片+识别流程，但：
  · 读取现有 library.json，新 item.id 从 max(已有 id) + 1 起递增
  · 新文件命名规则：voice_lib/{char_id}_append_NNNN_<4位uuid>.mp3
  · 新条目追加（而非覆盖）到 items 数组
And 前端轮询 /api/progress/{char_id}_append 跟踪进度
```

#### Scenario 2.6.7 导出角色为 ZIP 包
```gherkin
Given 用户点击角色卡片上的"导出"按钮
When 前端 GET /api/characters/{char_id}/export
Then 后端：
  1. 创建临时目录
  2. 把 characters/{char_id}/ 完整打包成 zip
  3. 以 "角色包_{char_name}.zip" 作为下载文件名返回 FileResponse
  4. 在 BackgroundTasks 中异步清理临时目录
And 浏览器自动下载 zip
And 角色不存在时返回 HTTP 404 "Character not found"
```

#### Scenario 2.6.8 导入外部 ZIP 包
```gherkin
Given 用户在角色库点击"📥 导入角色包(ZIP)"并选择一个 .zip 文件
When 前端 POST /api/characters/import (multipart, file=<zip>)
Then 后端：
  1. 校验文件名以 .zip 结尾，否则返回 HTTP 400 "请上传 ZIP 格式的角色包"
  2. 解压到临时目录；解压失败返回 HTTP 400 "ZIP 解析失败"
  3. 在临时目录中递归搜索 library.json 作为角色包根目录；找不到则返回 HTTP 400 "非标准角色包"
  4. 生成新的 char_id，把内容复制到 characters/{new_char_id}/
  5. 清理临时目录
And 返回 {status: "success", char_id: "<new_char_id>"}
```

---

### Feature 2.7 素材库编辑

**Background**
- 用户进入某个角色的"素材库"视图
- 表格展示该角色全部 items：波形图、试听、文案文本框、情感标签（primary/intensity/complex）、操作列

#### Scenario 2.7.1 批量保存修改
```gherkin
Given 用户已修改若干 item 的 text、emotion、is_api_safe（♡/♥）字段
When 用户点击"💾 保存更改"
Then 前端 PUT /api/characters/{char_id}/items {updates: {"<item_id>": {text, emotion, is_api_safe}, ...}}
And 后端读 library.json，按 id 匹配并部分更新对应字段，写回
And 返回 {status: "success"}
And 后端不会清除 updates 中未提及的字段
```

#### Scenario 2.7.2 删除单条素材
```gherkin
Given 用户对某行点"🗑️ 删除"
When 前端 DELETE /api/characters/{char_id}/items/{item_id}
Then 后端读 library.json
And 找到对应 item，删除其音频文件
And 从 items 数组移除该项，写回 library.json
And 返回 {status: "success"}
And 角色不存在 → HTTP 404 "找不到该角色"
And item_id 不匹配 → HTTP 404 "找不到该音频片段"
```

#### Scenario 2.7.3 合并多条素材为一条
```gherkin
Given 用户勾选了 ≥ 2 条素材并点击"合并"
When 前端 POST /api/characters/{char_id}/items/merge {item_ids: [a, b, c]}
Then 后端按 item_ids 给定的顺序串联音频：
  · 段间插入 500 ms 静音
  · 文本无标点时自动补中文逗号
  · 新 id = max(所有 id) + 1
  · 新文件名 = voice_lib/{char_id}_merged_{new_id}_<4位uuid>.mp3
  · MP3 bitrate 128k
And 后端删除被合并的旧音频文件
And 新 item 插入到原第一条所在位置
And 新 item 的 emotion 重置为 {primary:"平", complex:"", intensity:"Medium"}, is_api_safe=false
And 返回 {status: "success"}
And item_ids 少于 2 个 → HTTP 400 "合并素材不能少于2条"
And 所有目标文件都缺失 → HTTP 400 "合并失败：由于实体文件丢失..."
```

#### Scenario 2.7.4 在波形图上手动切分
```gherkin
Given 用户在素材表格中打开 manualSplitModal，拖动红线到 t 秒处
When 前端 POST /api/characters/{char_id}/items/{item_id}/manual_split {split_time: t}
Then 后端：
  1. 读取原音频，按 t 秒切成前后两段
  2. 各导出为 MP3 (128k)，命名 voice_lib/{char_id}_split_{new_id}_<4位uuid>.mp3
  3. 对两段分别调用 transcribe_audio_smart 重新识别文本；识别失败则降级为 "原文本 (前段)" / "原文本 (后段)"
  4. 两条新 item 的 emotion 复制自原 item（保留打标）
  5. 删除原音频文件，在原位置插入两条新 item
And 返回 {status: "success"}
And item_id 不匹配 → HTTP 400 "找不到对应的素材节点"
And 文件不存在 → HTTP 400 "找不到需要切分的实体音频文件"
And split_time ≤ 0 或 ≥ 音频时长 → HTTP 400 "不合法的切分时间点，超出了音频长度"
```

#### Scenario 2.7.5 单句情感分析（手动打标）
```gherkin
Given 用户在某行点击"AI 分析"或在情感面板使用 analyze
When 前端 POST /api/analyze_emotion {text: "<台词>"}
Then 后端取当前 active LLM 配置
And 调 webapp.clients.llm.chat_json，使用 EMOTION_ANALYSIS_PROMPT
And LLM 必须返回严格 JSON：{primary: "<喜|怒|哀|惧|惊|厌|平>", complex: "<1-8 字>", intensity: "<Low|Medium|High>"}
And 若 JSON 解析失败则自动重试至多 3 次
And 成功返回 {status: "success", emotion: {primary, complex, intensity}}
And 3 次仍失败 → HTTP 500 "大模型返回的不是有效 JSON..."
```

#### Scenario 2.7.6 批量 AI 情感分析（一键打标）
```gherkin
Given 角色库有若干 emotion.complex 为空的 item
When 用户点击"🤖 一键 AI 情绪分析"
Then 前端遍历未打标 items，逐条 POST /api/analyze_emotion
And 实时显示进度（"x / y"）
And 每条结果立即写回表格 UI
And 用户最后一次性点击"💾 保存更改"才落盘
```

#### Scenario 2.7.7 API 白名单（is_api_safe）维护
```gherkin
Given 用户点击素材行的爱心图标，把 ♡ 切换为 ♥
When 前端把变化纳入 updates 提交保存
Then 后端把该 item 的 is_api_safe 置为 true
And 后续：
  · /api/match：若该角色存在任意 is_api_safe=true 的 item，则只在白名单中匹配；否则用全量素材
  · /v1/audio/speech (OpenAI 兼容)：同上
And 合并、切分新生成的 item 默认 is_api_safe=false（需用户主动启用）
```

---

### Feature 2.8 单句配音

**Background**
- 用户已切换到"🎬 单句配音"标签
- 用户已选定角色（charSelect）

#### Scenario 2.8.1 AI 智能匹配
```gherkin
Given 用户输入台词 "你居然在这里!" 并选定角色"芙宁娜"
When 用户点击"🚀 AI 智能合成"
Then 前端 POST /api/match {char_id, text, manual_emotion?:null}
Then 后端：
  1. 角色寻址：char_id 可以是 ID 也可以是角色名（忽略空格大小写后模糊匹配）
  2. 加载 library.json，过滤出 emotion 非默认的有效 items
  3. 若白名单非空，仅取白名单池；否则取全量
  4. 构造候选 JSON（index/text/emotion/is_api_safe），调 advanced_match_emotion，使用 get_api_advanced_match_prompt
  5. LLM 必须返回 JSON {target_emotion, candidates:[chosen_index], emo_vector:[8 维], emo_alpha:0.1-1.0}
  6. 防爆音处理：若 target_emotion.primary == 选中候选的 emotion.primary，则 emo_alpha *= 0.6
And 返回 {status, char_id, char_name, target_emotion, candidates:[{id, text, emotion, filename, ref_audio_url, reason:"AI 智能匹配"}], emo_vector, emo_alpha}
And 角色不存在 → HTTP 404 "角色【xxx】不存在"
And 候选池为空 → HTTP 400 "角色素材库为空或未打标"
And LLM 输出非法 → HTTP 500
```

#### Scenario 2.8.2 手动选参考音
```gherkin
Given 用户点击"🗂️ 手动选参考音频"
When selectLibraryModal 打开
Then 前端从 /api/characters/{char_id}/details 加载完整 items
And 支持按文本搜索和按 primary 情绪过滤
And 用户点击某条"选择"
Then 该条作为 candidates[0] 写入 currentCandidates，并立即可触发合成
```

#### Scenario 2.8.3 强制指定情绪
```gherkin
Given 用户在 manualEmotionModal 显式指定 {primary:"怒", intensity:"High", complex:"咆哮"}
When 前端 POST /api/match {char_id, text, manual_emotion:{...}}
Then 后端跳过 LLM 的情感判断步骤，直接使用 manual_emotion 作为 target_emotion 寻找候选
And 其余流程与 Scenario 2.8.1 相同
```

#### Scenario 2.8.4 情绪向量精调
```gherkin
Given 用户在 vectorEmotionModal 调整 8 维滑块和 Alpha
When 用户点击"✔️ 确定使用"
Then 前端把 activeEmoVector / activeEmoAlpha 设为用户值
And "🎛️ 设置情绪向量"按钮变红表示已激活
And 后续合成请求里这两个值会覆盖 LLM 给的 emo_vector / emo_alpha
And 用户点击"取消"按钮可恢复为 null（即由 AI 决定）
```

#### Scenario 2.8.5 合成最终音频
```gherkin
Given 已经从匹配或手动流程拿到 candidates[0] 与（可选）emo_vector / emo_alpha
When 用户点击"用此参考合成"
Then 前端 POST /api/synthesize {text, char_id, ref_audio_filename, emo_vector, emo_alpha}
Then 后端：
  1. 解析参考音文件绝对路径
  2. 文件丢失 → HTTP 404 "参考音频文件丢失"
  3. 读取参考音并 base64 编码
  4. 若 emo_vector 非空，voice payload = "[EMO:{json_vector}|{alpha}]base64:{b64}"，否则 = "base64:{b64}"
  5. 根据 tts.type 选择 endpoint：
     · local → http://127.0.0.1:9800/v1/audio/speech，无 Authorization
     · cloud → {tts.api_base}/audio/speech，若 tts.api_key 非空则带 Authorization: Bearer <key>
  6. POST {model:"indexTTS2", input:text, voice, speed:1.0, response_format:"wav"}
  7. 把返回 WAV 写到 outputs/synth_<8 位 hex>.wav
And 返回 {status:"success", audio_url:"/outputs/synth_xxx.wav"}
And 前端自动播放并显示"💾 下载音频"
And 上游 TTS 异常 → HTTP 500
```

#### Scenario 2.8.6 取消进行中的合成
```gherkin
Given 单句合成正在进行
When 用户点击"🛑 停止"
Then 前端通过 AbortController 终止 fetch
And 已经发出的请求在到达后端时可能仍会产出文件，但前端不再使用
And 按钮恢复为"🚀 AI 智能合成"
```

---

### Feature 2.9 长文本批量配音

**Background**
- 用户切换到"📑 长文本配音"标签
- 用户已选定全局发音人
- 工作集是一个 longTextSegments 数组（前端内存对象）

#### Scenario 2.9.1 从 textarea / TXT / SRT 导入文本
```gherkin
Given 用户在 longInputText 粘贴长文本，或选择"📄 批量导入 TXT"，或选择"🎬 导入 SRT 字幕"
When 文件类型为多个 .txt
Then 前端按文件名字母升序读取并拼接为一段大文本

When 文件类型为 .srt
Then 前端解析 SRT 时间轴，按字幕行作为天然分段（不再调拆分接口）
```

#### Scenario 2.9.2 智能拆分
```gherkin
Given 用户已输入大段文本并设置 min_len（默认 10）
When 用户点击"✂️ 智能拆分段落"
Then 前端 POST /api/split_text {text, min_len, max_len=150}
Then 后端按 smart_split_text 规则：
  · 按 。 ！ ？ . ! ? ; : 换行 切句
  · 英文 "." 若是缩写（依据 COMMON_ABBREVIATIONS）则不切
  · 拆分后过短的句子合并到下一句
  · 拆分后超长的句子递归在 ; : ， - ( ) 空格处再切，仍超长则硬截断
And 返回 {status:"success", segments:[...]}
And 前端把每段包装成 segment-card：{id, text, charId, candidates:[], audioUrl:null, selected:false, target_emotion:null, hasAuditioned:false, emo_vector:null, emo_alpha:0.65}
And 同时显示批量控制栏 longBatchBar
```

#### Scenario 2.9.3 片段卡片可独立配置
```gherkin
Given 一张 segment-card
When 用户操作
Then 卡片支持：
  · 编辑文案（最多 200 字）
  · 点头像切换该片段的角色
  · 「🎛️ 设置情绪向量」局部覆盖 emo_vector / emo_alpha
  · 「🗂️ 选参考音频」从该角色库挑参考
  · 「🚀 开始合成」单独合成
  · 「➕ 插入片段」「🗑️ 删除」操控数组
  · 「向下拼接」与下一片段做素材级合并（调 /api/characters/{charId}/items/merge）
  · 「此处切分」对参考音波形切分（调 /api/characters/{charId}/items/{itemId}/manual_split）
```

#### Scenario 2.9.4 批量 AI 匹配
```gherkin
Given 用户勾选若干片段（默认全选）
And 在批量栏选了"情绪起伏" alpha 全局权重 (0.2/0.4/0.6/0.8/1.0)
When 用户点击"🤖 智能选参考音频 (N)"
Then 前端串行遍历选中片段，逐一 POST /api/match
And 把返回的 emo_vector 乘以全局权重，emo_alpha 直接取后端值（或被全局权重再乘）后存入片段
And 进度条实时显示"已完成 x / N"
And 完成后每个片段的 candidates / target_emotion / emo_vector / emo_alpha 都被写好
```

#### Scenario 2.9.5 批量合成
```gherkin
Given 选中的片段已有 candidates 与 emo_vector
When 用户点击"🚀 全部合成 (N)"
Then 前端串行调用 /api/synthesize，每完成一段就把 audioUrl 写回 segment 并刷新 UI
And 中途点击"🛑 停止"可中断剩余任务
And 失败的片段保留错误状态，可单独重试
```

#### Scenario 2.9.6 批量播放队列
```gherkin
Given 某些片段已经合成完音频
When 用户点击"▶️ 从头播放 (N)"
Then 前端构造播放队列（已选 + 已合成）
And 自动顺序播放每个 audioUrl
And 每播放完一段，把对应 segment.hasAuditioned 置为 true（红点脉冲消失）
And 用户可再次点击该按钮切换暂停 / 继续
```

#### Scenario 2.9.7 合并导出整段长音频
```gherkin
Given 选中的片段都已合成
When 用户在"💾 下载音频 ▾"下拉里点"🔗 合并导出"
Then 前端 POST /api/outputs/merge {audio_urls:[...]}
Then 后端遍历 URL，加载 wav，段间插入 500ms 静音串联导出
And 返回 {status:"success", audio_url:"/outputs/merged_xxx.wav"}
And 前端触发浏览器下载
And audio_urls 为空 → HTTP 400 "未提供需要合并的音频"
```

#### Scenario 2.9.8 ZIP 批量导出（不合并）
```gherkin
Given 多个片段都已合成
When 用户在下拉里点"📦 批量导出为 ZIP"
Then 前端用 JSZip 在浏览器侧打包所有 audioUrl 对应的 wav，按片段顺序命名
And 触发浏览器下载 zip
```

#### Scenario 2.9.9 长文本过滤显示
```gherkin
Given 用户在批量栏选了过滤模式
When 过滤模式为：
  · "全部"           → 显示全部片段
  · "未选参考音"     → 仅显示 candidates 为空的片段
  · "未合成音频"     → 仅显示 audioUrl 为 null 的片段
  · "合成后未试听"   → 仅显示 audioUrl 非空 且 hasAuditioned=false 的片段
Then 其它片段在 UI 上隐藏（数据保留）
```

---

### Feature 2.10 OpenAI 兼容外部 API

#### Scenario 2.10.1 第三方应用直接调 /v1/audio/speech 完成"角色名 + 台词"合成
```gherkin
Given 一个第三方应用（如 IM 机器人）已知某角色名 "芙宁娜"
When 它发起 POST http://127.0.0.1:9880/v1/audio/speech
Body:
  {
    "model": "emotionTTS",
    "input": "[惊讶] 你居然在这里！",
    "voice": "芙宁娜",
    "response_format": "wav",
    "speed": 1.0
  }
Then 后端：
  1. 清洗 input：移除所有 ( ) [ ] 【 】 内容及括号本身
  2. 把 voice 当作角色名/char_id 走 /api/match 同款匹配流程（优先用 is_api_safe 白名单）
  3. 拿到候选 + emo_vector + emo_alpha 后走合成
  4. 输出文件命名 outputs/api_synth_<8 位 hex>.wav
  5. 若结果采样率不是 24000Hz，转换为 24000Hz
  6. 以 FileResponse 直接返回音频流，Content-Type 按 response_format 决定（wav/mp3）
And 错误分支与 /api/match + /api/synthesize 一致
```

#### Scenario 2.10.2 外部调用的角色寻址容错
```gherkin
Given voice 字段是 "芙 宁 娜"（带空格）或 "FuNiNa"（错误大小写）
When 后端寻址
Then 系统忽略空格和大小写做模糊匹配，仍能命中正确角色
And 完全无法命中 → HTTP 404 "角色【...】不存在"
```

---

### Feature 2.11 本地 IndexTTS2 服务（9800）

**Background**
- 用户已在自己的 indextts env 中运行 `python tts_service/server.py`
- IndexTTS2 是单例加载（启动时一次性加载），推理串行化（线程锁保护）

#### Scenario 2.11.1 健康检查
```gherkin
Given 9800 服务已就绪
When 调用方 GET /health
Then 返回 200 {"status":"ok","model":"indexTTS2"}
And 此时模型可能还未真正加载（按需懒加载）
```

#### Scenario 2.11.2 首次合成触发模型加载
```gherkin
Given 服务刚启动，_tts_instance == None
When 第一次 POST /v1/audio/speech 到达
Then 在线程锁内创建 IndexTTS2(cfg_path, model_dir, use_fp16=False)
And 后续请求复用同一实例
And 即使是不同线程的并发请求，也通过 _tts_lock 串行执行 infer
```

#### Scenario 2.11.3 voice 字段编码协议
```gherkin
Given 调用方需要传参考音 + 情绪向量
When 构造 voice 字段
Then 协议如下：
  · 仅参考音：voice = "base64:<base64-encoded audio bytes>"
  · 带情绪向量：voice = "[EMO:<json_list>|<alpha_float>]base64:<base64-encoded audio bytes>"
And 服务端用正则 ^\[EMO:(?P<vec>.*)\|(?P<alpha>[^\]]+)\] 解析前缀
And vec 必须是合法 JSON 数组，alpha 必须可解析为浮点
And 解析失败 → HTTP 400 "voice 字段中的 [EMO:...] 解析失败"
And 缺少 base64: 前缀 → HTTP 400 "voice 字段必须以 'base64:' 开头"
And base64 解码失败 → HTTP 400 "voice base64 解码失败"
```

#### Scenario 2.11.4 合成请求处理
```gherkin
Given 一个合法的 SpeechRequest
When POST /v1/audio/speech
Then 服务端：
  1. 校验 input 非空（否则 HTTP 400 "input 不能为空"）
  2. 解析 voice 得到 (audio_bytes, emo_vector, emo_alpha)
  3. 将 audio_bytes 写入临时 wav 作为 spk_audio_prompt
  4. 调 IndexTTS2.infer(spk_audio_prompt, text=input, output_path=tmp, emo_alpha, emo_vector, use_emo_text=False)
  5. 读取生成的 wav 字节，删除临时文件
  6. 返回 Response(content=wav_bytes, media_type="audio/wav")
```

---

---

## 3. 数据模型

### 3.1 `characters/{char_id}/library.json`
```jsonc
{
  "char_id": "char_66ff5e94",          // 角色唯一 ID；目录名理论上应与之一致（实际项目中可能有历史差异）
  "char_name": "芙宁娜",                // 显示名
  "items": [
    {
      "id": 179,                        // 整数主键；删除/合并/切分后可能不连续
      "filename": "voice_lib/xxx.mp3",  // 相对路径，前缀固定 voice_lib/
      "text": "你居然在这里！",          // ASR 转录或用户手改文本
      "emotion": {
        "primary": "喜",                // 必填，枚举 喜/怒/哀/惧/惊/厌/平
        "complex": "雀跃",              // 可选，1-8 字复合情绪描述
        "intensity": "High"             // 必填，枚举 Low/Medium/High
      },
      "duration": 4.65,                 // 秒，浮点，2 位小数
      "is_api_safe": true               // 可选，是否纳入 API 白名单；默认视为 false
    }
  ]
}
```

### 3.2 `webapp/config/config.json`
```jsonc
{
  "llm": {
    "active_type": "ollama",            // ollama | siliconflow | youzhi | deepseek | custom
    "configs": {
      "siliconflow":{ "api_base": "https://api.siliconflow.cn/v1",  "api_key": "", "model": "deepseek-ai/DeepSeek-V3.2" },
      "youzhi":     { "api_base": "https://api.modelverse.cn/v1",   "api_key": "", "model": "mimo-v2-flash" },
      "deepseek":   { "api_base": "https://api.deepseek.com/v1",    "api_key": "", "model": "deepseek-chat" },
      "ollama":     { "api_base": "http://127.0.0.1:11434/v1",      "api_key": "", "model": "" },
      "custom":     { "api_base": "",                                "api_key": "", "model": "" }
    }
  },
  "tts": {
    "type": "local",                              // local | cloud
    "api_base": "http://127.0.0.1:9800/v1",       // local 模式忽略；cloud 模式必填
    "api_key": ""                                  // 仅在 cloud 模式且远端需要鉴权时填
  }
}
```

### 3.3 文件命名约定
| 路径模式 | 来源 |
| --- | --- |
| `characters/{char_id}/voice_lib/{char_id}_NNNN.mp3` | 创建角色时切片产物 |
| `characters/{char_id}/voice_lib/{char_id}_append_NNNN_<4 位 uuid>.mp3` | 追加素材时切片产物 |
| `characters/{char_id}/voice_lib/{char_id}_merged_{new_id}_<4 位 uuid>.mp3` | 素材合并产物 |
| `characters/{char_id}/voice_lib/{char_id}_split_{new_id}_<4 位 uuid>.mp3` | 素材手动切分产物 |
| `outputs/synth_<8 位 hex>.wav` | Web UI 单句/长文本合成产物 |
| `outputs/api_synth_<8 位 hex>.wav` | OpenAI 兼容接口 /v1/audio/speech 产物 |
| `outputs/lite_synth_<8 位 hex>.wav` | 精简版合成产物 |
| `outputs/merged_<8 位 hex>.wav` | 多段合并产物 |

---

## 4. 接口契约（速查）

> 全部端点均挂在 `app.py` 起的 9880 服务。除特别说明外，请求/响应均为 JSON，错误响应遵循 `{"detail": "<msg>"}`（FastAPI 默认）。

### 4.1 配置类
| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/config` | 读取完整配置 |
| GET | `/api/config/verify_active` | 主页探活，返回 tts_status / llm_status |
| POST | `/api/config/validate` | 提交并校验保存配置 |

### 4.2 角色管理类
| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/api/characters` | 列出所有角色卡片 |
| POST | `/api/characters` | 创建角色（自动切片） |
| GET | `/api/characters/{char_id}/details` | 获取角色完整 library.json |
| DELETE | `/api/characters/{char_id}` | 删除角色 |
| POST | `/api/characters/{char_id}/rename` | 改名 |
| POST | `/api/characters/{char_id}/avatar` | 换头像 |
| POST | `/api/characters/{char_id}/append` | 追加素材（后台任务） |
| PUT | `/api/characters/{char_id}/items` | 批量更新 items |
| DELETE | `/api/characters/{char_id}/items/{item_id}` | 删除单条素材 |
| POST | `/api/characters/{char_id}/items/merge` | 合并多条素材 |
| POST | `/api/characters/{char_id}/items/{item_id}/manual_split` | 在指定时间手动切分 |
| GET | `/api/characters/{char_id}/export` | 导出 ZIP |
| POST | `/api/characters/import` | 导入 ZIP |
| GET | `/api/progress/{task_id}` | 轮询后台任务进度 |

### 4.3 合成与情感类
| Method | Path | 用途 |
| --- | --- | --- |
| POST | `/api/analyze_emotion` | 对单句文本做情感打标 |
| POST | `/api/match` | 候选音匹配 + emo_vector 生成 |
| POST | `/api/synthesize` | 用指定参考音 + 情绪向量合成 |
| POST | `/api/split_text` | 智能拆分长文本 |
| POST | `/api/outputs/merge` | 合并多段输出 wav |
| POST | `/v1/audio/speech` | OpenAI 兼容外部接口 |

### 4.4 9800 本地 TTS 服务（tts_service/server.py）
| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/v1/audio/speech` | OpenAI 协议合成；voice 字段支持 `[EMO:vec|alpha]base64:...` |

---

## 5. 非功能性需求

### 5.1 输入限制
| 项 | 限制 |
| --- | --- |
| 单句合成 textarea 字数 | 300 字 |
| 长文本片段 textarea 字数 | 200 字 |
| 拆分 min_len | 默认 10，可调 1–700 |
| 拆分 max_len | 固定 150（前端不暴露） |
| 静音切片阈值 | -40 dB |
| 切片最小有效时长 | 0.5 秒 |
| 合并素材 item 数 | ≥ 2 |
| 手动切分时间点 | 必须 0 < t < 音频时长 |
| 情绪向量维度 | 8 |
| 情绪向量单维范围 | 0.0–1.0；推荐总和 ≤ 0.8 |
| Alpha 权重范围 | 0.1–1.0 |

### 5.2 并发与重试
| 项 | 行为 |
| --- | --- |
| LLM 调用超时 | 60 秒 |
| TTS 调用超时 | 1200 秒（20 分钟） |
| LLM 返回非 JSON | 自动重试 3 次后抛错 |
| 本地 IndexTTS2 并发 | 全局串行（线程锁），不支持并行推理 |
| 后台任务 | build_character_dataset / append_character_dataset 进程内异步，进度通过 task_progress 字典暴露 |
| 主页探活 | LLM + TTS 并发执行（asyncio） |

### 5.3 缓存与刷新
- Web 中枢全局响应头 `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`，禁止浏览器缓存
- HTML 输出时动态把 `.js`、`.css` 引用替换为带时间戳 query（`?t=<unix_ts>`）防版本错配

### 5.4 安全
- API Key（LLM/TTS）在 `config.json` 明文存储；用户自负保管
- 无身份验证机制；默认设计为单机或受信内网使用
- 删除操作不可恢复，前端必须二次确认；后端不做软删除

### 5.5 平台
| 平台 | 启动方式 |
| --- | --- |
| macOS / Linux / Windows | `python main.py` 启动 Web 中枢；本地 TTS 需在自己的 indextts env 里另开终端 `python tts_service/server.py` |

---

## 6. 关键业务约束（不变量 Invariants）

1. **`char_id` 唯一性**：新建/导入角色生成的 `char_id = "char_" + hex(8)`，落盘到目录名；旧版数据中目录名与 `library.json` 内 `char_id` 可能不一致，列表展示与详情读取应以目录名为准。
2. **items 主键稳定性**：item.id 在删除/合并/切分后可能形成空洞；前端必须按 id 寻址，不可按数组索引。
3. **白名单优先级**：`/api/match` 与 `/v1/audio/speech` 在选择候选池时，"存在 ≥1 个 `is_api_safe=true`" 即视为启用白名单（其它素材被排除）；否则用全量已打标素材池。
4. **打标可用性**：素材若 `emotion.complex == ""` 且 `intensity` 是默认值，则在匹配候选池里被视为"未打标"，不参与匹配（实现里以 `emotion` 非空白对象作为有效）。
5. **情绪相同时降权**：当 LLM 返回的 `target_emotion.primary` 与所选候选音 `emotion.primary` 相同，最终 `emo_alpha = LLM 返回值 × 0.6`，避免情绪叠加爆音。
6. **本地模式必须先起 9800**：当 `tts.type=local` 时，前端探活和合成都依赖 9800 健康；否则 verify_active 返回 tts_status=error。本仓库不会自动拉起该服务，用户需在 indextts env 中手动启动 `tts_service/server.py`。
7. **emo_vector 偷渡协议**：Web 中枢与 IndexTTS2 服务之间通过把 `voice` 字段写成 `[EMO:[v0..v7]|alpha]base64:...` 形式传递情绪向量；两端必须保持同步。
8. **更新源单点信任**：增量更新只信任 `gitee.com/yuan-ye-nigula/emotion-tts`，无签名校验；若该仓库被劫持会有任意代码执行风险（已知设计权衡）。
9. **后台任务无持久化**：`task_progress` 只存内存，进程重启后所有进度丢失；前端拿不到旧任务进度即视为"任务可能已完成或失败"。
10. **`/outputs` 永不自清理**：合成产物会持续累积，需用户或运维手动清理。

---

## 7. 待澄清/已知缺口（Open Questions）

> 写 PRD 时发现的、源代码未给出明确语义、需要产品决策的问题。

1. **角色目录名 vs `library.json.char_id` 不一致**：现网真实数据中存在目录 `char_0484abf3` 内 `library.json` 写着 `char_66ff5e94`。当前后端用目录名寻址，导出/导入时按目录名保留——是否要在导入时统一刷新内部 `char_id` 字段？
2. **`outputs/` 自动清理策略**：是否引入按容量/时间的自动清理？目前完全靠用户手动。
3. **后台任务进度持久化**：进程重启后 task_progress 丢失，正在进行的素材构建若用户刷新页面会一无所知；是否要落盘到 `task_progress.json`？
4. **`is_api_safe` 默认值**：合并/切分产生的新 item 默认是 false，是否要支持"继承原 item 的白名单状态"？
5. **多用户隔离**：当前是单机单用户假设，若部署到内网多人使用，需补充身份与作品空间隔离层。
6. **本地 IndexTTS2 并发**：业务上是否允许排队？现在串行锁会让多个慢请求互相阻塞。

---

*文档基于 v4.5 精简版整理；与原版的差异详见文档头部"精简版变更说明"。*
