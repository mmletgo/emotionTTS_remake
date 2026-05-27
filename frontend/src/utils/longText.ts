/**
 * Business Logic:
 *   长文本配音模式下，每一个被拆分或导入的台词段落需要独立跟踪
 *   匹配状态、合成状态和播放 URL，供 StudioView 长文本面板使用。
 *   四维 override 模型：每段独立维护用户手动锁定的四个字段（ref / emotion / vector / alpha），
 *   以及 LLM 最近一次返回的缓存（llmCache），供决策树判断是否需要重跑 LLM。
 *
 * Code Logic:
 *   定义 LongTextSegment 接口，包含 id / text / selected / status
 *   以及 overrides（四个可 null 的 override）和 llmCache（LLM 缓存）。
 */

import type { EmotionVector } from '@/api/types'

/** 单句 / 长文本段的 LLM 匹配结果缓存 */
export interface SegmentLlmCache {
  /** 匹配时使用的原始台词文本（用于检测缓存是否还有效） */
  text: string
  /** LLM 选出的参考音文件名 */
  ref_audio_filename: string
  /** LLM 选出的参考音 URL（用于试听） */
  ref_audio_url: string
  /** LLM 返回的目标情绪 */
  target_emotion: { primary: string; intensity: string; complex?: string }
  /** LLM 返回的 8 维情绪向量 */
  emo_vector: EmotionVector | null
  /** LLM 返回的情绪强度 alpha */
  emo_alpha: number
  /** LLM 返回的全部候选音（用于单句模式展示候选卡片） */
  candidates?: Array<{
    id: number
    text: string
    filename: string
    ref_audio_url: string
    reason: string
    emotion: { primary: string; intensity: string; complex?: string }
  }>
}

/** 四维 override 模型：每项 null = 跟随 LLM 自动，有值 = 用户手动锁定 */
export interface SegmentOverrides {
  /** 参考音 override：null = AI 自动 */
  ref: { filename: string; audio_url: string; emotion_primary: string } | null
  /** 情绪 override：null = AI 自动 */
  emotion: { primary: string; intensity: string; complex?: string } | null
  /** 情绪向量 override：null = AI 自动 */
  vector: EmotionVector | null
  /** alpha 强度 override：null = AI 自动 */
  alpha: number | null
}

export interface LongTextSegment {
  /** 段落序号（从 1 开始） */
  id: number
  /** 台词文本 */
  text: string
  /** 是否被用户勾选（批量操作对象） */
  selected: boolean
  /**
   * 段落状态：
   * - 'unmatched'：刚拆分，尚未做情绪匹配
   * - 'pending'：已匹配（有 ref_audio_filename），等待合成
   * - 'done'：合成完成（有 audio_url）
   * - 'error'：匹配或合成失败
   */
  status: 'unmatched' | 'pending' | 'done' | 'error'
  /** 四维 override：用户手动锁定的字段 */
  overrides: SegmentOverrides
  /** LLM 最近一次匹配结果缓存 */
  llmCache: SegmentLlmCache | null
  /** 合成后填入的播放 URL */
  audio_url?: string
  /** 用户是否已试听该段（用于"合成后未试听"筛选） */
  auditioned?: boolean
  /** 合成完成后展示用的最终参考音文件名（来自 override 或 llmCache） */
  ref_audio_filename?: string
  /** 合成完成后展示用的最终参考音 URL（来自 override 或 llmCache） */
  ref_audio_url?: string
  /** 合成完成后展示用的最终目标情绪 */
  target_emotion?: { primary: string; intensity: string; complex?: string }
  /** 合成完成后展示用的最终 emo_vector */
  emo_vector?: EmotionVector | null
  /** 合成完成后展示用的最终 emo_alpha */
  emo_alpha?: number
}

/** 创建默认的空 override 对象 */
export function makeDefaultOverrides(): SegmentOverrides {
  return { ref: null, emotion: null, vector: null, alpha: null }
}
