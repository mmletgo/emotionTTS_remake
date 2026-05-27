/**
 * EmotionTTS API 类型定义
 * 按后端 webapp/schemas/api_models.py 和 webapp/api/*.py 路由提取
 */

// ============================================================
// 联合类型
// ============================================================

export type EmotionPrimary = '喜' | '怒' | '哀' | '惧' | '厌' | '低落' | '惊' | '平';
export type EmotionIntensity = 'Low' | 'Medium' | 'High';
export type LlmProvider = 'ollama' | 'siliconflow' | 'youzhi' | 'deepseek' | 'custom';

/**
 * 参考音转写语种代码（Whisper / faster-whisper 兼容）。
 * 'auto' = 让模型自动检测（云端 OpenAI Whisper 也支持，传空字符串 / "auto" 触发）。
 * 其余为常见 ISO 639-1 代码。
 */
export type AsrLanguage = 'auto' | 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es';

/** UI 用：语种 → 中文显示名 */
export const ASR_LANGUAGE_OPTIONS: { value: AsrLanguage; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日文' },
  { value: 'ko', label: '韩文' },
  { value: 'fr', label: '法文' },
  { value: 'de', label: '德文' },
  { value: 'es', label: '西班牙文' },
  { value: 'auto', label: '自动检测' },
];

/** 8 维情绪向量：[喜, 怒, 哀, 惧, 厌, 低落, 惊, 平] */
export type EmotionVector = readonly [number, number, number, number, number, number, number, number];

// ============================================================
// 角色 & 素材库
// ============================================================

export interface Character {
  char_id: string;
  name: string;
  avatar_url?: string;
  item_count: number;
  emotion_count: number;
  updated_at: string;
  /** 试听样本音频 URL（后端取 items[0]，可能为 undefined 表示素材库为空） */
  preview_audio_url?: string;
}

export interface EmotionTag {
  primary: EmotionPrimary;
  intensity: EmotionIntensity;
  complex?: string;
}

export interface LibraryItem {
  id: number;
  item_id?: number;   // 兼容后端有时用 id / 有时用 item_id
  text: string;
  filename: string;
  audio_url: string;
  emotion?: EmotionTag;
  emotion_primary: EmotionPrimary;
  emotion_intensity: EmotionIntensity;
  emotion_complex?: string;
  is_favorite: boolean;
  is_api_safe: boolean;
}

export interface CharacterDetail {
  char_id: string;
  name: string;
  avatar_url?: string;
  items: LibraryItem[];
}

// ============================================================
// 匹配结果
// ============================================================

export interface MatchCandidate extends LibraryItem {
  match_score: number;
  reason?: string;
  ref_audio_url?: string;
}

export interface MatchResult {
  char_id: string;
  char_name: string;
  target_emotion: { primary: string; intensity: string; complex?: string };
  candidates: Array<{
    id: number;
    text: string;
    emotion: EmotionTag;
    filename: string;
    ref_audio_url: string;
    reason: string;
  }>;
  emo_vector: EmotionVector | null;
  emo_alpha: number;
}

// ============================================================
// 进度
// ============================================================

/** 后端 library_builder 完成时实际会返回 'success'，兼容 'done' */
export type TaskStatus = 'running' | 'done' | 'success' | 'error';

export interface ProgressResponse {
  progress: number;   // 0-100
  msg: string;
  status: TaskStatus;
  /** 当前阶段，由后端字段决定，前端只用于可视化分类 */
  stage: 'slicing' | 'asr' | 'tagging' | 'writing' | null;
}

// ============================================================
// 配置
// ============================================================

export interface LlmProviderConfig {
  api_base: string;
  api_key: string;
  model: string;
}

export interface LlmConfig {
  active_type: LlmProvider;
  configs: Record<LlmProvider, LlmProviderConfig>;
}

export interface TtsConfig {
  type: 'local' | 'cloud';
  api_base: string;
  api_key: string;
}

export interface AsrConfig {
  type: 'local' | 'cloud';
  api_base: string;
  api_key: string;
  model: string;
  language: string;
}

export interface Config {
  llm: LlmConfig;
  tts: TtsConfig;
  asr: AsrConfig;
}

export interface VerifyActiveResponse {
  status: 'success' | 'error';
  tts_status: 'success' | 'local_ready' | 'error';
  llm_status: 'success' | 'error';
  asr_status: 'success' | 'local_ready' | 'error';
}

/** 单引擎测试请求/响应（POST /api/config/test_{llm,tts,asr}），用前端正在编辑且尚未落盘的字段 */
export interface TestLlmRequest {
  api_base: string;
  api_key: string;
  model: string;
}

export interface TestTtsRequest {
  type: 'local' | 'cloud';
  api_base: string;
  api_key: string;
}

export interface TestAsrRequest {
  type: 'local' | 'cloud';
  api_base: string;
  api_key: string;
}

export interface TestEndpointResponse {
  status: 'success' | 'error';
  msg: string;
}

// ============================================================
// 请求体
// ============================================================

export interface ConfigSaveRequest {
  llm_active_type: string;
  llm_configs: Record<string, LlmProviderConfig>;
  tts: Partial<TtsConfig>;
  asr?: Partial<AsrConfig>;
}

export interface MatchRequest {
  char_id: string;
  text: string;
  manual_emotion?: {
    primary?: string;
    intensity?: string;
    complex?: string;
  };
  /** 对应设置页"允许 API 模式优先"。true=有 is_api_safe 素材时独占候选池，false=忽略该标记用全集。省略时后端默认 true。 */
  api_priority?: boolean;
}

export interface SynthesizeRequest {
  text: string;
  char_id: string;
  ref_audio_filename: string;
  emo_vector?: EmotionVector | number[] | null;
  emo_alpha?: number;
}

export interface SplitTextRequest {
  text: string;
  min_len?: number;
  max_len?: number;
}

export interface MergeOutputsRequest {
  audio_urls: string[];
}

export interface UpdateItemsRequest {
  updates: Record<string, unknown>;
}

export interface MergeItemsRequest {
  item_ids: number[];
}

export interface ManualSplitRequest {
  split_time: number;
}

export interface RenameRequest {
  new_name: string;
}

// ============================================================
// 响应体
// ============================================================

export interface StatusResponse {
  status: 'success' | 'error';
  msg?: string;
}

export interface CharCreateResponse {
  status: 'success' | 'error';
  char_id: string;
}

export interface CharImportResponse {
  status: 'success' | 'error';
  char_id: string;
}

export interface SynthesizeResponse {
  status: 'success' | 'error';
  audio_url: string;
}

export interface SplitTextResponse {
  status: 'success' | 'error';
  segments: string[];
}

export interface MatchResponse extends StatusResponse {
  char_id: string;
  char_name: string;
  target_emotion: { primary: string; intensity: string; complex?: string };
  candidates: MatchResult['candidates'];
  emo_vector: EmotionVector | null;
  emo_alpha: number;
}

export interface AnalyzeEmotionResponse {
  status: 'success' | 'error';
  emotion: unknown;
}

export interface ConfigReadResponse {
  config: Config;
}
