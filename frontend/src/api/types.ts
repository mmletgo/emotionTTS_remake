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

export interface Config {
  llm: LlmConfig;
  tts: TtsConfig;
}

export interface VerifyActiveResponse {
  status: 'success' | 'error';
  tts_status: 'success' | 'local_ready' | 'error';
  llm_status: 'success' | 'error';
}

// ============================================================
// 请求体
// ============================================================

export interface ConfigSaveRequest {
  llm_active_type: string;
  llm_configs: Record<string, LlmProviderConfig>;
  tts: Partial<TtsConfig>;
}

export interface MatchRequest {
  char_id: string;
  text: string;
  manual_emotion?: {
    primary?: string;
    intensity?: string;
    complex?: string;
  };
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
