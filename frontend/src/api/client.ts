/**
 * EmotionTTS API 客户端
 * 类型化 fetch 封装 + 每个端点的命名函数
 * baseURL 使用相对路径，Vite dev proxy 转发到 FastAPI :9880
 */

import type {
  AnalyzeEmotionResponse,
  CharCreateResponse,
  CharImportResponse,
  Character,
  CharacterDetail,
  Config,
  ConfigReadResponse,
  ConfigSaveRequest,
  ManualSplitRequest,
  MatchRequest,
  MatchResult,
  MergeItemsRequest,
  MergeOutputsRequest,
  ProgressResponse,
  RenameRequest,
  SplitTextRequest,
  SplitTextResponse,
  StatusResponse,
  SynthesizeRequest,
  SynthesizeResponse,
  UpdateItemsRequest,
  VerifyActiveResponse,
} from './types';

// ============================================================
// 核心封装
// ============================================================

export class ApiError extends Error {
  public readonly status: number;
  public readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  // FormData 传输时不能带 Content-Type（让浏览器自动加 boundary）
  // 所以若 body 是 FormData，覆盖 headers 去掉 Content-Type
  // 这里 fetch 本身会处理，但我们需要在请求时特判（见下方命名函数）

  let body: unknown;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }

  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).detail)
        : String(body);
    throw new ApiError(res.status, body, detail);
  }

  return body as T;
}

/** FormData 版（不注入 Content-Type） */
async function apiForm<T>(path: string, formData: FormData, method = 'POST'): Promise<T> {
  const res = await fetch(path, { method, body: formData });
  let body: unknown;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).detail)
        : String(body);
    throw new ApiError(res.status, body, detail);
  }
  return body as T;
}

function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

// ============================================================
// 配置端点
// ============================================================

/** GET /api/config — 读取完整配置 */
export async function getConfig(): Promise<Config> {
  const res = await api<ConfigReadResponse>('/api/config');
  return res.config;
}

/** POST /api/config/validate — 校验并保存配置（双重验证 LLM + TTS） */
export async function saveConfig(req: ConfigSaveRequest): Promise<StatusResponse> {
  return api<StatusResponse>('/api/config/validate', {
    method: 'POST',
    ...json(req),
  });
}

/** GET /api/config/verify_active — 探活当前 LLM + TTS */
export async function verifyActiveConfig(): Promise<VerifyActiveResponse> {
  return api<VerifyActiveResponse>('/api/config/verify_active');
}

// ============================================================
// 角色端点
// ============================================================

/** GET /api/characters — 角色列表 */
export async function getCharacters(): Promise<Character[]> {
  return api<Character[]>('/api/characters');
}

/** GET /api/characters/{char_id}/details — 角色详情（素材库） */
export async function getCharacterDetails(charId: string): Promise<CharacterDetail> {
  return api<CharacterDetail>(`/api/characters/${encodeURIComponent(charId)}/details`);
}

/**
 * POST /api/characters — 新建角色（multipart: char_name, files[], avatar?, min_silence_len?）
 * 后端返回 {status, char_id}，建角色是后台任务，用 char_id 轮询 /api/progress/{char_id}
 */
export async function createCharacter(
  charName: string,
  audioFiles: File[],
  options?: { avatar?: File; minSilenceLen?: number },
): Promise<CharCreateResponse> {
  const form = new FormData();
  form.append('char_name', charName);
  if (options?.minSilenceLen !== undefined) {
    form.append('min_silence_len', String(options.minSilenceLen));
  }
  if (options?.avatar) {
    form.append('avatar', options.avatar);
  }
  for (const f of audioFiles) {
    form.append('files', f);
  }
  return apiForm<CharCreateResponse>('/api/characters', form, 'POST');
}

/** POST /api/characters/{char_id}/append — 追加音频到已有角色 */
export async function appendToCharacter(
  charId: string,
  audioFiles: File[],
  options?: { minSilenceLen?: number },
): Promise<StatusResponse> {
  const form = new FormData();
  if (options?.minSilenceLen !== undefined) {
    form.append('min_silence_len', String(options.minSilenceLen));
  }
  for (const f of audioFiles) {
    form.append('files', f);
  }
  return apiForm<StatusResponse>(
    `/api/characters/${encodeURIComponent(charId)}/append`,
    form,
    'POST',
  );
}

/** POST /api/characters/{char_id}/rename — 改名 */
export async function renameCharacter(charId: string, newName: string): Promise<StatusResponse> {
  const req: RenameRequest = { new_name: newName };
  return api<StatusResponse>(`/api/characters/${encodeURIComponent(charId)}/rename`, {
    method: 'POST',
    ...json(req),
  });
}

/** DELETE /api/characters/{char_id} — 删除角色 */
export async function deleteCharacter(charId: string): Promise<StatusResponse> {
  return api<StatusResponse>(`/api/characters/${encodeURIComponent(charId)}`, {
    method: 'DELETE',
  });
}

/** POST /api/characters/{char_id}/avatar — 更新头像 */
export async function updateAvatar(charId: string, avatarFile: File): Promise<StatusResponse> {
  const form = new FormData();
  form.append('avatar', avatarFile);
  return apiForm<StatusResponse>(
    `/api/characters/${encodeURIComponent(charId)}/avatar`,
    form,
    'POST',
  );
}

// ---- items 编辑 ----

/** PUT /api/characters/{char_id}/items — 批量更新 items 字段 */
export async function updateItems(
  charId: string,
  updates: UpdateItemsRequest['updates'],
): Promise<StatusResponse> {
  const req: UpdateItemsRequest = { updates };
  return api<StatusResponse>(`/api/characters/${encodeURIComponent(charId)}/items`, {
    method: 'PUT',
    ...json(req),
  });
}

/** DELETE /api/characters/{char_id}/items/{item_id} — 删除单条 item */
export async function deleteItem(charId: string, itemId: number): Promise<StatusResponse> {
  return api<StatusResponse>(
    `/api/characters/${encodeURIComponent(charId)}/items/${itemId}`,
    { method: 'DELETE' },
  );
}

/** POST /api/characters/{char_id}/items/merge — 合并多段 */
export async function mergeItems(charId: string, itemIds: number[]): Promise<StatusResponse> {
  const req: MergeItemsRequest = { item_ids: itemIds };
  return api<StatusResponse>(`/api/characters/${encodeURIComponent(charId)}/items/merge`, {
    method: 'POST',
    ...json(req),
  });
}

/** POST /api/characters/{char_id}/items/{item_id}/manual_split — 手动切分 */
export async function manualSplit(
  charId: string,
  itemId: number,
  splitTime: number,
): Promise<StatusResponse> {
  const req: ManualSplitRequest = { split_time: splitTime };
  return api<StatusResponse>(
    `/api/characters/${encodeURIComponent(charId)}/items/${itemId}/manual_split`,
    { method: 'POST', ...json(req) },
  );
}

// ---- 导入 / 导出 ----

/** GET /api/characters/{char_id}/export — 导出角色 ZIP（返回 Blob URL，由调用方触发下载） */
export function exportCharacterUrl(charId: string): string {
  return `/api/characters/${encodeURIComponent(charId)}/export`;
}

/** POST /api/characters/import — 导入角色 ZIP */
export async function importCharacter(zipFile: File): Promise<CharImportResponse> {
  const form = new FormData();
  form.append('file', zipFile);
  return apiForm<CharImportResponse>('/api/characters/import', form, 'POST');
}

// ============================================================
// 进度轮询
// ============================================================

/** GET /api/progress/{task_id} — 查询后台任务进度 */
export async function getProgress(taskId: string): Promise<ProgressResponse> {
  return api<ProgressResponse>(`/api/progress/${encodeURIComponent(taskId)}`);
}

// ============================================================
// 情绪分析 / 匹配 / 文本切分
// ============================================================

/** POST /api/analyze_emotion — 分析单句情绪（LLM 打标） */
export async function analyzeEmotion(text: string): Promise<AnalyzeEmotionResponse> {
  return api<AnalyzeEmotionResponse>('/api/analyze_emotion', {
    method: 'POST',
    ...json({ text }),
  });
}

/** POST /api/match — 智能情绪匹配，返回参考音 + 情绪向量 */
export async function match(req: MatchRequest): Promise<MatchResult> {
  const raw = await api<MatchResult & { status: string }>('/api/match', {
    method: 'POST',
    ...json(req),
  });
  // 后端返回 {status: 'success', ...MatchResult fields}，直接透传
  return raw;
}

/** POST /api/split_text — 长文本智能切句 */
export async function splitText(req: SplitTextRequest): Promise<SplitTextResponse> {
  return api<SplitTextResponse>('/api/split_text', {
    method: 'POST',
    ...json(req),
  });
}

// ============================================================
// 合成
// ============================================================

/** POST /api/synthesize — 单句合成，返回 audio_url */
export async function synthesize(req: SynthesizeRequest): Promise<SynthesizeResponse> {
  return api<SynthesizeResponse>('/api/synthesize', {
    method: 'POST',
    ...json(req),
  });
}

/** POST /api/outputs/merge — 合并多段输出为一个长音频 */
export async function mergeOutputs(audioUrls: string[]): Promise<SynthesizeResponse> {
  const req: MergeOutputsRequest = { audio_urls: audioUrls };
  return api<SynthesizeResponse>('/api/outputs/merge', {
    method: 'POST',
    ...json(req),
  });
}
