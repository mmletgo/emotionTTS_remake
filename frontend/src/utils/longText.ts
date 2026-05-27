/**
 * Business Logic:
 *   长文本配音模式下，每一个被拆分或导入的台词段落需要独立跟踪
 *   匹配状态、合成状态和播放 URL，供 StudioView 长文本面板使用。
 *
 * Code Logic:
 *   定义 LongTextSegment 接口，包含 id / text / selected / status
 *   以及后端匹配/合成后填充的 ref_audio_filename / emo_vector / emo_alpha / audio_url。
 */

import type { EmotionVector } from '@/api/types'

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
  /** 匹配后填入的参考音文件名 */
  ref_audio_filename?: string
  /** 合成后填入的播放 URL */
  audio_url?: string
  /** 匹配后填入的 8 维情绪向量 */
  emo_vector?: EmotionVector | null
  /** 匹配后填入的情绪强度 alpha */
  emo_alpha?: number
  /** 用户是否已试听该段（用于"合成后未试听"筛选） */
  auditioned?: boolean
  /** 匹配后的目标情绪信息 */
  target_emotion?: { primary: string; intensity: string; complex?: string }
  /** 参考音 URL（用于试听参考音） */
  ref_audio_url?: string
}
