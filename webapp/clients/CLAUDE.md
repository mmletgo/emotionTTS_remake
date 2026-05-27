# webapp/clients/

外部服务的 **HTTP 客户端**抽象。把"调用一个 OpenAI 兼容接口"封装成 Python 协程，让 domain 层完全不感知 HTTP 细节。

## 文件分工

| 文件 | 暴露 API | 用途 |
| --- | --- | --- |
| `llm.py` | `verify_config(cfg)` · `chat_json(user_content, cfg, system_prompt, tag)` | 任何 OpenAI 兼容 chat/completions（情绪打标、智能匹配都通过 chat_json） |
| `tts.py` | `verify_endpoint(cfg)` · `synthesize(text, prompt_audio_path, output_abs_path, cfg, emo_vector, emo_alpha)` | 调 IndexTTS2 服务（本地 9800 或远端 api_base） |
| `asr.py` | `transcribe(audio_path, *, api_base, api_key, model, language, response_format, prompt, timeout)` · `ping(api_base, api_key, timeout)` | 调 OpenAI 兼容 /v1/audio/transcriptions（本地 asr_service 9900 或云端 OpenAI 等）；失败抛 `AsrError` |

## 约束

- clients **不感知任何业务概念**（角色、素材库、情绪打标流程等）；接收方传 system_prompt + 用户输入 + 配置就行。
- 失败时抛**普通 Exception**，不抛 HTTPException。
- 协议适配（如 LLM `<think>` 标签清理、Markdown 围栏剥离、`/chat/completions` 后缀容错）都集中在 clients 层。
- `tts.py.synthesize` 中通过把 `voice` 字符串改成 `[EMO:[v0..v7]|alpha]base64:...` 来把情绪向量带给 `tts_service/server.py`；改协议两端必须同步。
