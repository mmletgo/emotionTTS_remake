/**
 * Business Logic:
 *   工作台视图，是用户合成配音的主界面，包含两种工作流：
 *   (1) 单句配音：选声音→写台词→点「开始合成」（显式触发），展示候选音卡片、高级模式四维 override。
 *   (2) 长文本配音：粘贴批量文本，智能拆分→逐句匹配→批量合成，支持单段操作/顺序播放/合并导出。
 *   采用四维 override 模型：参考音 / 情绪 / 向量 / alpha 每项独立可锁定，null = AI 自动。
 *
 * Code Logic:
 *   通过 studioMode 状态切换两个子面板的展示。
 *   单句模式维护 singleOverrides（四维 override）和 singleLlmCache（LLM 缓存）。
 *   合成决策树：全 override → 跳过 LLM；llmCache 命中 → 跳过 LLM；否则调 runMatch。
 *   长文本模式维护 segments 数组（LongTextSegment[]），每段有独立 overrides + llmCache。
 *   高级模式通过 advancedOpen 状态控制 AdvancedSheet 弹出，保存时只更新 overrides 不触发合成。
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import './StudioView.css'
import Icon from '../icons/Icon'
import CastPickerSheet from '../components/CastPickerSheet'
import AdvancedSheet from '../components/AdvancedSheet'
import Avatar from '../components/Avatar'
import type { Character, EmotionVector } from '@/api/types'
import type { LongTextSegment, SegmentOverrides, SegmentLlmCache } from '../utils/longText'
import { makeDefaultOverrides } from '../utils/longText'
import { useMatch } from '@/hooks/useMatch'
import { useSynthesize } from '@/hooks/useSynthesize'
import { useLongTextSplit } from '@/hooks/useLongTextSplit'
import { useCharacterDetail } from '@/hooks/useCharacterDetail'
import { useSequentialPlay } from '@/hooks/useSequentialPlay'
import { useMergeOutputs } from '@/hooks/useMergeOutputs'
import { useUiSettings } from '@/state/uiSettings'
import { exportSegmentsAsZip } from '@/utils/exportZip'

interface StudioViewProps {
  characters: Character[]
  activeChar: Character | null
  onCharChange: (c: Character) => void
  onSynthesized: (audioUrl: string, title: string, sub: string) => void
}

type StudioMode = 'single' | 'long'

/** 单句模式中，候选音卡片展示用 */
interface CandidateCard {
  id: number
  text: string
  filename: string
  ref_audio_url: string
  reason: string
  emotion: { primary: string; intensity: string; complex?: string }
}

// ============================================================
// SRT 解析工具
// ============================================================

/**
 * Business Logic:
 *   允许用户直接导入 SRT 字幕文件，把字幕文字拼成纯文本填入长文本框。
 *
 * Code Logic:
 *   按行扫描，跳过序号行（纯数字）、时间轴行（含 --> ）和空行，
 *   其余都作为台词文字行，join 成一段文本返回。
 */
function parseSrt(raw: string): string {
  const lines = raw.split(/\r?\n/)
  const texts: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^\d+$/.test(trimmed)) continue
    if (/\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/.test(trimmed)) continue
    texts.push(trimmed)
  }
  return texts.join('\n')
}

// ============================================================
// 状态标签文字 / 样式 helper
// ============================================================

function segStatusLabel(status: LongTextSegment['status']): string {
  switch (status) {
    case 'unmatched': return '未匹配'
    case 'pending': return '待合成'
    case 'done': return '已合成'
    case 'error': return '失败'
  }
}

function segStatusClass(status: LongTextSegment['status']): string {
  switch (status) {
    case 'unmatched': return ''
    case 'pending': return ' is-pending'
    case 'done': return ' is-ok'
    case 'error': return ' is-error'
  }
}

// ============================================================
// 段筛选器类型
// ============================================================

type SegFilter = 'all' | 'no_ref' | 'no_audio' | 'no_audition'

// ============================================================
// Main view
// ============================================================

export default function StudioView({
  characters,
  activeChar,
  onCharChange,
  onSynthesized,
}: StudioViewProps) {
  // ── 通用状态（所有 hooks 必须在任何 early return 之前）──────────
  const [mode, setMode] = useState<StudioMode>('single')
  const [script, setScript] = useState<string>('那时候我并不知道，原来一句轻飘飘的"再见"，会在多年之后还烫着我的舌尖。')
  const [castPickerOpen, setCastPickerOpen] = useState<boolean>(false)
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false)

  // ── 单句模式状态 ──────────────────────────────────────────
  /** 单句模式的四维 override */
  const [singleOverrides, setSingleOverrides] = useState<SegmentOverrides>(makeDefaultOverrides())
  /** 单句模式的 LLM 缓存（合成后才有） */
  const [singleLlmCache, setSingleLlmCache] = useState<SegmentLlmCache | null>(null)
  const [synthDone, setSynthDone] = useState<boolean>(false)
  const [activeCandidateIdx, setActiveCandidateIdx] = useState<number>(0)

  // 用于单段高级 sheet 打开（长文本）
  const [segAdvancedId, setSegAdvancedId] = useState<number | null>(null)

  // ── 长文本模式状态 ────────────────────────────────────────
  const [longText, setLongText] = useState<string>('')
  const [segments, setSegments] = useState<LongTextSegment[]>([])
  const [splitting, setSplitting] = useState<boolean>(false)
  const [matching, setMatching] = useState<boolean>(false)
  const [synthing, setSynthing] = useState<boolean>(false)
  const [exporting, setExporting] = useState<boolean>(false)
  const [longMinLen, setLongMinLen] = useState<number>(10)
  const [longGlobalAlpha, setLongGlobalAlpha] = useState<number>(0.6)
  const [segFilter, setSegFilter] = useState<SegFilter>('all')
  // 内联文本编辑
  const [editingSegId, setEditingSegId] = useState<number | null>(null)
  const [editingText, setEditingText] = useState<string>('')
  // 停止合成的 AbortController
  const synthAbortRef = useRef<AbortController | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const srtInputRef = useRef<HTMLInputElement>(null)

  // ── Hooks ───────────────────────────────────────────────────
  const { run: runMatch, loading: matchLoading } = useMatch()
  const { run: runSynth, loading: synthLoading } = useSynthesize()
  const { split: splitFn } = useLongTextSplit()
  const { playing: seqPlaying, currentSegId: seqCurrentId, play: seqPlay, stop: seqStop } = useSequentialPlay()
  const { run: runMerge, loading: mergeLoading } = useMergeOutputs()
  const { settings: uiSettings } = useUiSettings()

  // 加载角色素材库（用于参考音 picker）
  const { items: libraryItems } = useCharacterDetail(activeChar?.char_id ?? '')

  const isBusy = matchLoading || synthLoading
  const longBusy = splitting || matching || synthing

  // ── 当 activeChar 变化时清空单句状态 ────────────────────────
  useEffect(() => {
    setSingleLlmCache(null)
    setSynthDone(false)
    setActiveCandidateIdx(0)
    setSingleOverrides(makeDefaultOverrides())
  }, [activeChar?.char_id])

  // ============================================================
  // 单句模式决策树
  // ============================================================

  /**
   * Business Logic:
   *   单句模式核心合成流程，实现四维 override 决策树：
   *   1. 若所有 override 都已设置 → 跳过 LLM，直接调 TTS。
   *   2. 否则若 llmCache.text === 当前台词 → 跳过 LLM，用 llmCache 补 null 字段。
   *   3. 否则调 runMatch → 写入 llmCache → 合并 override + LLM → 调 TTS。
   *
   * Code Logic:
   *   candidateIdx 为可选参数，用于切换候选音时指定使用哪条候选。
   *   最终传给 runSynth 的参数由 override 覆盖 llmCache 决策得出。
   */
  const handleSynth = useCallback(async (candidateIdx?: number) => {
    if (!activeChar || !script.trim()) return
    const idx = candidateIdx ?? activeCandidateIdx

    let cache = singleLlmCache
    const allOverrideSet =
      singleOverrides.ref !== null &&
      singleOverrides.emotion !== null &&
      singleOverrides.vector !== null &&
      singleOverrides.alpha !== null

    // 决策树：是否需要调 LLM
    if (!allOverrideSet) {
      const cacheHit = cache !== null && cache.text === script
      if (!cacheHit) {
        // 调 LLM 匹配
        const result = await runMatch({
          char_id: activeChar.char_id,
          text: script,
          lock: singleOverrides.emotion
            ? {
                primary: singleOverrides.emotion.primary,
                intensity: singleOverrides.emotion.intensity,
                complex: singleOverrides.emotion.complex,
              }
            : undefined,
          api_priority: uiSettings.api_priority,
        })
        const newCache: SegmentLlmCache = {
          text: script,
          ref_audio_filename: result.candidates[0]?.filename ?? '',
          ref_audio_url: result.candidates[0]?.ref_audio_url ?? '',
          target_emotion: result.target_emotion,
          emo_vector: result.emo_vector,
          emo_alpha: result.emo_alpha,
          candidates: result.candidates.map((c) => ({
            id: c.id,
            text: c.text,
            filename: c.filename,
            ref_audio_url: c.ref_audio_url,
            reason: c.reason,
            emotion: c.emotion,
          })),
        }
        setSingleLlmCache(newCache)
        cache = newCache
      }
    }

    if (!cache && !allOverrideSet) return

    // 合并 override + llmCache 得出最终参数
    const finalRefFilename =
      singleOverrides.ref?.filename ??
      (cache?.candidates?.[idx]?.filename ?? cache?.ref_audio_filename) ??
      ''
    const finalVector: EmotionVector | null =
      singleOverrides.vector ?? cache?.emo_vector ?? null
    const finalAlpha: number =
      singleOverrides.alpha ?? cache?.emo_alpha ?? 0.65
    const finalEmotion = singleOverrides.emotion ?? cache?.target_emotion

    if (!finalRefFilename) return

    const { audio_url } = await runSynth({
      char_id: activeChar.char_id,
      ref_audio_filename: finalRefFilename,
      text: script,
      emo_vector: finalVector,
      emo_alpha: finalAlpha,
    })
    setSynthDone(true)
    setActiveCandidateIdx(idx)
    onSynthesized(
      audio_url,
      script.length > 30 ? script.slice(0, 30) + '…' : script,
      `${activeChar.name} · ${finalEmotion?.primary ?? '?'} · α ${finalAlpha.toFixed(2)}`
    )
  }, [
    activeChar, script, activeCandidateIdx,
    singleOverrides, singleLlmCache,
    runMatch, runSynth, onSynthesized,
  ])

  /**
   * Business Logic:
   *   用户点击候选卡片的「使用此条」按钮，换用不同候选音重新合成。
   *
   * Code Logic:
   *   llmCache 已有，直接用指定 candidateIdx 重新合成（不重跑 match）。
   */
  const handleUseCandidateAtIdx = useCallback(async (idx: number) => {
    if (!activeChar || !script.trim() || !singleLlmCache) return
    const cand = singleLlmCache.candidates?.[idx]
    if (!cand) return
    setActiveCandidateIdx(idx)

    const finalVector: EmotionVector | null = singleOverrides.vector ?? singleLlmCache.emo_vector ?? null
    const finalAlpha: number = singleOverrides.alpha ?? singleLlmCache.emo_alpha ?? 0.65

    const { audio_url } = await runSynth({
      char_id: activeChar.char_id,
      ref_audio_filename: cand.filename,
      text: script,
      emo_vector: finalVector,
      emo_alpha: finalAlpha,
    })
    onSynthesized(
      audio_url,
      script.length > 30 ? script.slice(0, 30) + '…' : script,
      `${activeChar.name} · ${singleLlmCache.target_emotion.primary} · 候选 ${idx + 1}`
    )
  }, [activeChar, script, singleLlmCache, singleOverrides, runSynth, onSynthesized])

  /**
   * Business Logic:
   *   高级模式"保存"回调：只更新 singleOverrides，不触发合成。
   *
   * Code Logic:
   *   setSingleOverrides 写入新值，advancedOpen 由 AdvancedSheet onClose 关闭。
   */
  const handleSingleAdvancedSave = useCallback((newOverrides: SegmentOverrides) => {
    setSingleOverrides(newOverrides)
  }, [])

  // ============================================================
  // 长文本 helpers
  // ============================================================

  /**
   * Business Logic:
   *   全选 / 取消全选，仅在筛选后可见的段落中操作。
   *
   * Code Logic:
   *   先按 segFilter 过滤出可见 id 集合，再对这些 id 统一设 selected。
   */
  const toggleAll = useCallback((checked: boolean) => {
    const visibleIds = new Set(getVisibleSegments(segments, segFilter).map((s) => s.id))
    setSegments((prev) =>
      prev.map((s) => (visibleIds.has(s.id) ? { ...s, selected: checked } : s))
    )
  }, [segments, segFilter])

  /**
   * Business Logic:
   *   用户手动勾选/取消某一段。
   *
   * Code Logic:
   *   按 id 找到对应段落翻转 selected 布尔值。
   */
  const toggleSeg = useCallback((id: number) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s))
    )
  }, [])

  /**
   * Business Logic:
   *   调后端 /api/split_text 把长文本按标点拆成可独立合成的句子列表。
   *
   * Code Logic:
   *   调 useLongTextSplit().split()，把返回的 string[] 转为 LongTextSegment[]，
   *   每条默认 selected=true、status='unmatched'、overrides 全 null、llmCache=null。
   */
  const handleSplit = useCallback(async () => {
    if (!longText.trim() || splitting) return
    setSplitting(true)
    try {
      const texts = await splitFn({ text: longText, minLen: longMinLen })
      const newSegs: LongTextSegment[] = texts.map((text, i) => ({
        id: i + 1,
        text,
        selected: true,
        status: 'unmatched',
        overrides: makeDefaultOverrides(),
        llmCache: null,
      }))
      setSegments(newSegs)
      setSegFilter('all')
    } catch {
      // 静默失败
    } finally {
      setSplitting(false)
    }
  }, [longText, splitting, splitFn, longMinLen])

  /**
   * Business Logic:
   *   对单段执行合成决策树（供批量和单段共用）。
   *   1. 全 override 已设置 → 跳过 LLM 直接 TTS。
   *   2. llmCache 命中（text 相同） → 跳过 LLM。
   *   3. 否则调 runMatch → 写 llmCache → 合并 → TTS。
   *
   * Code Logic:
   *   返回合成后的 audio_url；失败抛出异常供调用方处理。
   *   longGlobalAlpha 作用于 alpha fallback（即 override.alpha === null 时）。
   */
  const synthOneSegment = useCallback(async (
    seg: LongTextSegment,
    globalAlpha: number,
  ): Promise<{ audio_url: string; finalRef: string; finalEmotion: { primary: string; intensity: string; complex?: string } | undefined; finalVector: EmotionVector | null; finalAlpha: number; newCache: SegmentLlmCache | null }> => {
    if (!activeChar) throw new Error('no activeChar')

    const { overrides } = seg
    const allOverrideSet =
      overrides.ref !== null &&
      overrides.emotion !== null &&
      overrides.vector !== null &&
      overrides.alpha !== null

    let cache = seg.llmCache
    if (!allOverrideSet) {
      const cacheHit = cache !== null && cache.text === seg.text
      if (!cacheHit) {
        const result = await runMatch({
          char_id: activeChar.char_id,
          text: seg.text,
          lock: overrides.emotion
            ? {
                primary: overrides.emotion.primary,
                intensity: overrides.emotion.intensity,
                complex: overrides.emotion.complex,
              }
            : undefined,
          api_priority: uiSettings.api_priority,
        })
        cache = {
          text: seg.text,
          ref_audio_filename: result.candidates[0]?.filename ?? '',
          ref_audio_url: result.candidates[0]?.ref_audio_url ?? '',
          target_emotion: result.target_emotion,
          emo_vector: result.emo_vector,
          emo_alpha: result.emo_alpha,
        }
      }
    }

    const finalRef = overrides.ref?.filename ?? cache?.ref_audio_filename ?? ''
    if (!finalRef) throw new Error('no ref audio')

    const finalVector: EmotionVector | null = overrides.vector ?? cache?.emo_vector ?? null
    // alpha：override 优先，否则 llmCache * globalAlpha
    const backendAlpha = cache?.emo_alpha ?? 0.65
    const finalAlpha: number =
      overrides.alpha !== null
        ? overrides.alpha
        : parseFloat((backendAlpha * globalAlpha).toFixed(2))
    const finalEmotion = overrides.emotion ?? cache?.target_emotion

    const { audio_url } = await runSynth({
      char_id: activeChar.char_id,
      ref_audio_filename: finalRef,
      text: seg.text,
      emo_vector: finalVector,
      emo_alpha: finalAlpha,
    })

    return {
      audio_url,
      finalRef,
      finalEmotion,
      finalVector,
      finalAlpha,
      newCache: cache,
    }
  }, [activeChar, runMatch, runSynth])

  /**
   * Business Logic:
   *   对所有勾选段落串行执行合成决策树，每段独立判定缓存命中。
   *
   * Code Logic:
   *   依次调 synthOneSegment，写回 llmCache 和最终合成参数，status→'done'。
   */
  const handleBatchSynth = useCallback(async () => {
    if (!activeChar || synthing) return
    const targets = getVisibleSegments(segments, segFilter).filter((s) => s.selected)
    if (targets.length === 0) return
    setSynthing(true)
    const controller = new AbortController()
    synthAbortRef.current = controller
    for (const seg of targets) {
      if (controller.signal.aborted) break
      try {
        const result = await synthOneSegment(seg, longGlobalAlpha)
        if (controller.signal.aborted) break
        setSegments((prev) =>
          prev.map((s) =>
            s.id === seg.id
              ? {
                  ...s,
                  status: 'done',
                  audio_url: result.audio_url,
                  auditioned: false,
                  llmCache: result.newCache ?? s.llmCache,
                  ref_audio_filename: result.finalRef,
                  ref_audio_url: result.newCache?.ref_audio_url ?? s.ref_audio_url,
                  target_emotion: result.finalEmotion,
                  emo_vector: result.finalVector,
                  emo_alpha: result.finalAlpha,
                }
              : s
          )
        )
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') break
        setSegments((prev) =>
          prev.map((s) => (s.id === seg.id ? { ...s, status: 'error' } : s))
        )
      }
    }
    synthAbortRef.current = null
    setSynthing(false)
  }, [activeChar, synthing, segments, segFilter, synthOneSegment, longGlobalAlpha])

  /**
   * Business Logic:
   *   批量匹配（只做 LLM 匹配，不合成）——仅对已勾选且未有 llmCache 的段落。
   *
   * Code Logic:
   *   依次 await runMatch，写 llmCache，status→'pending'。
   */
  const handleBatchMatch = useCallback(async () => {
    if (!activeChar || matching) return
    const targets = getVisibleSegments(segments, segFilter).filter((s) => s.selected)
    if (targets.length === 0) return
    setMatching(true)
    for (const seg of targets) {
      try {
        const result = await runMatch({
          char_id: activeChar.char_id,
          text: seg.text,
          lock: seg.overrides.emotion
            ? {
                primary: seg.overrides.emotion.primary,
                intensity: seg.overrides.emotion.intensity,
                complex: seg.overrides.emotion.complex,
              }
            : undefined,
          api_priority: uiSettings.api_priority,
        })
        const newCache: SegmentLlmCache = {
          text: seg.text,
          ref_audio_filename: result.candidates[0]?.filename ?? '',
          ref_audio_url: result.candidates[0]?.ref_audio_url ?? '',
          target_emotion: result.target_emotion,
          emo_vector: result.emo_vector,
          emo_alpha: result.emo_alpha,
        }
        setSegments((prev) =>
          prev.map((s) =>
            s.id === seg.id
              ? {
                  ...s,
                  status: 'pending',
                  llmCache: newCache,
                  ref_audio_filename: seg.overrides.ref?.filename ?? newCache.ref_audio_filename,
                  ref_audio_url: seg.overrides.ref?.audio_url ?? newCache.ref_audio_url,
                  target_emotion: seg.overrides.emotion ?? newCache.target_emotion,
                }
              : s
          )
        )
      } catch {
        setSegments((prev) =>
          prev.map((s) => (s.id === seg.id ? { ...s, status: 'error' } : s))
        )
      }
    }
    setMatching(false)
  }, [activeChar, matching, segments, segFilter, runMatch])

  /**
   * Business Logic:
   *   停止正在进行的批量合成。
   *
   * Code Logic:
   *   abort 当前 AbortController。
   */
  const handleStopSynth = useCallback(() => {
    if (synthAbortRef.current) {
      synthAbortRef.current.abort()
    }
  }, [])

  /**
   * Business Logic:
   *   单段重新匹配（只做 LLM，不合成）。
   *
   * Code Logic:
   *   await runMatch，写 llmCache，status→'pending'。
   */
  const handleSegMatch = useCallback(async (segId: number) => {
    if (!activeChar) return
    const seg = segments.find((s) => s.id === segId)
    if (!seg) return
    try {
      const result = await runMatch({
        char_id: activeChar.char_id,
        text: seg.text,
        lock: seg.overrides.emotion
          ? {
              primary: seg.overrides.emotion.primary,
              intensity: seg.overrides.emotion.intensity,
              complex: seg.overrides.emotion.complex,
            }
          : undefined,
        api_priority: uiSettings.api_priority,
      })
      const newCache: SegmentLlmCache = {
        text: seg.text,
        ref_audio_filename: result.candidates[0]?.filename ?? '',
        ref_audio_url: result.candidates[0]?.ref_audio_url ?? '',
        target_emotion: result.target_emotion,
        emo_vector: result.emo_vector,
        emo_alpha: result.emo_alpha,
      }
      setSegments((prev) =>
        prev.map((s) =>
          s.id === segId
            ? {
                ...s,
                status: 'pending',
                llmCache: newCache,
                ref_audio_filename: s.overrides.ref?.filename ?? newCache.ref_audio_filename,
                ref_audio_url: s.overrides.ref?.audio_url ?? newCache.ref_audio_url,
                target_emotion: s.overrides.emotion ?? newCache.target_emotion,
              }
            : s
        )
      )
    } catch {
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, status: 'error' } : s))
      )
    }
  }, [activeChar, segments, runMatch])

  /**
   * Business Logic:
   *   单段重新合成（走决策树）。
   *
   * Code Logic:
   *   调 synthOneSegment，写回 audio_url 和缓存，status→'done'。
   */
  const handleSegSynth = useCallback(async (segId: number) => {
    if (!activeChar) return
    const seg = segments.find((s) => s.id === segId)
    if (!seg) return
    try {
      const result = await synthOneSegment(seg, longGlobalAlpha)
      setSegments((prev) =>
        prev.map((s) =>
          s.id === segId
            ? {
                ...s,
                status: 'done',
                audio_url: result.audio_url,
                auditioned: false,
                llmCache: result.newCache ?? s.llmCache,
                ref_audio_filename: result.finalRef,
                ref_audio_url: result.newCache?.ref_audio_url ?? s.ref_audio_url,
                target_emotion: result.finalEmotion,
                emo_vector: result.finalVector,
                emo_alpha: result.finalAlpha,
              }
            : s
        )
      )
    } catch {
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, status: 'error' } : s))
      )
    }
  }, [activeChar, segments, synthOneSegment, longGlobalAlpha])

  /**
   * Business Logic:
   *   删除某一段落（前端操作，不掉后端）。
   *
   * Code Logic:
   *   filter 掉该 id 的 segment。
   */
  const handleSegDelete = useCallback((segId: number) => {
    setSegments((prev) => prev.filter((s) => s.id !== segId))
  }, [])

  /**
   * Business Logic:
   *   标记某段已被试听（用于"合成后未试听"筛选条件）。
   *
   * Code Logic:
   *   把该 segment.auditioned 设为 true。
   */
  const markAuditioned = useCallback((segId: number) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === segId ? { ...s, auditioned: true } : s))
    )
  }, [])

  /**
   * Business Logic:
   *   长文本中，某段从高级 sheet 保存 overrides 后更新该段 overrides。
   *
   * Code Logic:
   *   只更新对应段的 overrides，不触发合成。
   */
  const handleSegAdvancedSave = useCallback((segId: number, newOverrides: SegmentOverrides) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === segId ? { ...s, overrides: newOverrides } : s))
    )
  }, [])

  /**
   * Business Logic:
   *   打包导出已选中、已合成的段落为 ZIP。
   *
   * Code Logic:
   *   过滤勾选 + 已合成（有 audio_url）的段；交给 exportSegmentsAsZip。
   */
  const handleExportZip = useCallback(async () => {
    if (exporting) return
    const validSegs = segments
      .filter((s) => s.selected && s.audio_url)
      .map((s) => ({ text: s.text, audio_url: s.audio_url as string }))
    if (validSegs.length === 0) {
      alert('请先勾选已合成的段落')
      return
    }
    setExporting(true)
    try {
      await exportSegmentsAsZip(validSegs)
    } catch (e) {
      alert(`打包失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(false)
    }
  }, [segments, exporting])

  /**
   * Business Logic:
   *   合并导出：把所有已选中已合成段落合成一个 WAV 文件下载。
   *
   * Code Logic:
   *   收集 audio_url 列表，调 runMerge，自动触发下载。
   */
  const handleMergeExport = useCallback(async () => {
    const urls = segments
      .filter((s) => s.selected && s.audio_url)
      .map((s) => s.audio_url as string)
    if (urls.length === 0) {
      alert('请先勾选已合成的段落')
      return
    }
    try {
      await runMerge(urls)
    } catch (e) {
      alert(`合并失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [segments, runMerge])

  /**
   * Business Logic:
   *   从头顺序播放所有已选中且已合成的段落。
   *
   * Code Logic:
   *   构建播放队列，调 seqPlay；播放时高亮当前段（seqCurrentId 跟踪）；
   *   每段播完时 markAuditioned。
   */
  const handleSequentialPlay = useCallback(() => {
    if (seqPlaying) {
      seqStop()
      return
    }
    const items = segments
      .filter((s) => s.selected && s.audio_url)
      .map((s) => ({ url: s.audio_url as string, segId: s.id }))
    if (items.length === 0) return
    seqPlay(items, markAuditioned)
  }, [seqPlaying, segments, seqPlay, seqStop, markAuditioned])

  // ── 段落筛选计算 ──────────────────────────────────────────
  const visibleSegments = getVisibleSegments(segments, segFilter)
  const selectedCount = segments.filter((s) => s.selected).length
  const visibleSelectedCount = visibleSegments.filter((s) => s.selected).length
  const visibleCount = visibleSegments.length

  // ── 当前打开高级 sheet 的段 ──────────────────────────────
  const segAdvancedSeg = segments.find((s) => s.id === segAdvancedId) ?? null

  // ── 单句 LLM cache 候选音列表（用于展示候选卡片） ──────────
  const singleCandidates: CandidateCard[] = singleLlmCache?.candidates?.map((c) => ({
    id: c.id,
    text: c.text,
    filename: c.filename,
    ref_audio_url: c.ref_audio_url,
    reason: c.reason,
    emotion: c.emotion,
  })) ?? []

  return (
    <div>
      {/* Mode tabs */}
      <div className="studio-mode" role="tablist">
        <button
          aria-current={mode === 'single' ? 'page' : undefined}
          onClick={() => setMode('single')}
          role="tab"
        >
          单句配音
        </button>
        <button
          aria-current={mode === 'long' ? 'page' : undefined}
          onClick={() => setMode('long')}
          role="tab"
        >
          长文本配音
        </button>
      </div>

      {/* ── Single mode ──────────────────────────────────────── */}
      {mode === 'single' && (
        <div>
          {/* Step 1: Choose voice */}
          <div className={`step${activeChar ? ' is-done' : ''}`}>
            <div className="step-head">
              <div className="step-num">1</div>
              <div className="step-title">选个声音</div>
              <div className="step-hint">点击卡片切换角色</div>
            </div>

            {activeChar ? (
              <div className="cast-card" onClick={() => setCastPickerOpen(true)}>
                <Avatar char={activeChar} className="cast-avatar" />
                <div className="cast-meta">
                  <div className="cast-name">{activeChar.name}</div>
                  <div className="cast-sub">
                    {activeChar.item_count} 个片段 · 覆盖 {activeChar.emotion_count} 种情绪
                  </div>
                </div>
                <div className="cast-actions">
                  <button
                    className="btn-icon"
                    title="试听样本"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="play" size={16} />
                  </button>
                  <button
                    className="btn-icon"
                    title="切换角色"
                    onClick={(e) => {
                      e.stopPropagation()
                      setCastPickerOpen(true)
                    }}
                  >
                    <Icon name="swap" size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="cast-card" onClick={() => setCastPickerOpen(true)}>
                <Avatar char={null} className="cast-avatar" />
                <div className="cast-meta">
                  <div className="cast-name">点击选择角色</div>
                  <div className="cast-sub">尚未选择</div>
                </div>
                <div className="cast-actions">
                  <button className="btn-icon" title="选择角色">
                    <Icon name="swap" size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Script */}
          <div className={`step${script.trim() ? ' is-done' : ''}`}>
            <div className="step-head">
              <div className="step-num">2</div>
              <div className="step-title">写下台词</div>
              <div className="step-hint">最多 300 字</div>
            </div>
            <div className="script-card">
              <textarea
                placeholder="敲下你想要的台词……"
                value={script}
                onChange={(e) => {
                  if (e.target.value.length <= 300) setScript(e.target.value)
                }}
                maxLength={300}
              />
              <div className="script-foot">
                <span className="left">支持中英混排</span>
                <span className="count">
                  <strong>{script.length}</strong> / 300
                </span>
              </div>
            </div>
          </div>

          {/* Step 3: Generate */}
          <div className="step">
            <div className="step-head">
              <div className="step-num">3</div>
              <div className="step-title">让它响起来</div>
              <div className="step-hint">点「开始合成」触发，高级模式可锁定各参数</div>
            </div>
            <div className="action-zone">
              <div className="action-row">
                <button
                  className="btn-primary"
                  onClick={() => handleSynth()}
                  disabled={isBusy || !activeChar || !script.trim()}
                >
                  <Icon name="mic" size={18} />
                  {matchLoading ? '匹配中…' : synthLoading ? '合成中…' : '开始合成'}
                </button>
                {synthDone && (
                  <button
                    className="btn-chip btn-chip--accent"
                    onClick={() => handleSynth()}
                    disabled={isBusy}
                    title="重新生成（保持当前设置）"
                  >
                    <Icon name="regenerate" size={14} />
                    重新生成
                  </button>
                )}
              </div>

              {/* 工具行：高级模式 + override 状态指示 */}
              <div className="action-tools">
                <button
                  className="advanced-link"
                  onClick={() => setAdvancedOpen(true)}
                >
                  高级模式 · 手动情绪 / 参考音 / 向量微调
                </button>

                {/* override 状态提示 chips */}
                {singleOverrides.ref && (
                  <span className="override-chip">
                    <Icon name="library" size={12} />
                    参考音已锁定
                    <button
                      className="vector-chip__cancel"
                      title="重置参考音"
                      onClick={() => setSingleOverrides((p) => ({ ...p, ref: null }))}
                    >
                      <Icon name="cancel" size={12} />
                    </button>
                  </span>
                )}
                {singleOverrides.emotion && (
                  <span className="override-chip">
                    情绪锁定：{singleOverrides.emotion.primary}
                    <button
                      className="vector-chip__cancel"
                      title="重置情绪"
                      onClick={() => setSingleOverrides((p) => ({ ...p, emotion: null }))}
                    >
                      <Icon name="cancel" size={12} />
                    </button>
                  </span>
                )}
                {singleOverrides.vector && (
                  <span className="override-chip">
                    <Icon name="sliders" size={12} />
                    向量已锁定
                    <button
                      className="vector-chip__cancel"
                      title="重置向量"
                      onClick={() => setSingleOverrides((p) => ({ ...p, vector: null }))}
                    >
                      <Icon name="cancel" size={12} />
                    </button>
                  </span>
                )}
                {singleOverrides.alpha !== null && (
                  <span className="override-chip">
                    α = {singleOverrides.alpha.toFixed(2)} 已锁定
                    <button
                      className="vector-chip__cancel"
                      title="重置 Alpha"
                      onClick={() => setSingleOverrides((p) => ({ ...p, alpha: null }))}
                    >
                      <Icon name="cancel" size={12} />
                    </button>
                  </span>
                )}
              </div>
            </div>

            {/* Diagnosis preview（来自 llmCache） */}
            {singleLlmCache && (
              <div className="diag-preview">
                <div className="diag-icon">
                  <Icon name="ai" size={16} />
                </div>
                <div className="diag-text">
                  <div className="diag-label">AI 情绪诊断</div>
                  <div className="diag-body">
                    主情绪：<strong>{singleOverrides.emotion?.primary ?? singleLlmCache.target_emotion.primary}</strong>
                    {(singleOverrides.emotion?.complex ?? singleLlmCache.target_emotion.complex) &&
                      `（${singleOverrides.emotion?.complex ?? singleLlmCache.target_emotion.complex}）`
                    }
                    &nbsp;·&nbsp;
                    <strong className="mono">
                      Alpha = {(singleOverrides.alpha ?? singleLlmCache.emo_alpha).toFixed(2)}
                    </strong>
                    {singleOverrides.ref && (
                      <span style={{ marginLeft: 8, fontSize: '12px', color: 'var(--signal-warn)' }}>
                        · 参考音已手动锁定
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 候选音卡片池（来自 llmCache） */}
            {singleLlmCache && singleCandidates.length > 0 && (
              <div className="candidates-section">
                <div className="candidates-label">
                  <Icon name="list" size={12} />
                  候选参考音（共 {singleCandidates.length} 条）
                </div>
                <div className="candidates-list">
                  {singleCandidates.map((c, idx) => (
                    <div
                      key={c.id}
                      className={`candidate-card${idx === activeCandidateIdx ? ' is-active' : ''}`}
                    >
                      <div className="candidate-head">
                        <span className="candidate-emo">
                          {c.emotion.primary}
                          <span className="candidate-emo-badge">{c.emotion.intensity}</span>
                          {c.emotion.complex && (
                            <span className="candidate-emo-complex">{c.emotion.complex}</span>
                          )}
                        </span>
                        {idx === activeCandidateIdx && (
                          <span className="candidate-active-badge">当前使用</span>
                        )}
                      </div>
                      <div className="candidate-text">{c.text}</div>
                      <div className="candidate-actions">
                        <button
                          className="btn-icon btn-icon--sm"
                          title="试听参考音"
                          onClick={() => {
                            if (c.ref_audio_url) {
                              new Audio(c.ref_audio_url).play().catch(() => {})
                            }
                          }}
                        >
                          <Icon name="play" size={13} />
                        </button>
                        <button
                          className="btn-chip btn-chip--sm"
                          disabled={synthLoading || idx === activeCandidateIdx}
                          onClick={() => handleUseCandidateAtIdx(idx)}
                        >
                          {idx === activeCandidateIdx ? '已使用' : '使用此条'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Long text mode ───────────────────────────────────── */}
      {mode === 'long' && (
        <div>
          {/* Step 1: Choose voice */}
          <div className={`step${activeChar ? ' is-done' : ''}`}>
            <div className="step-head">
              <div className="step-num">1</div>
              <div className="step-title">选个声音</div>
              <div className="step-hint">点击卡片切换角色</div>
            </div>

            {activeChar ? (
              <div className="cast-card" onClick={() => setCastPickerOpen(true)}>
                <Avatar char={activeChar} className="cast-avatar" />
                <div className="cast-meta">
                  <div className="cast-name">{activeChar.name}</div>
                  <div className="cast-sub">
                    {activeChar.item_count} 个片段 · 覆盖 {activeChar.emotion_count} 种情绪
                  </div>
                </div>
                <div className="cast-actions">
                  <button
                    className="btn-icon"
                    title="切换角色"
                    onClick={(e) => {
                      e.stopPropagation()
                      setCastPickerOpen(true)
                    }}
                  >
                    <Icon name="swap" size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="cast-card" onClick={() => setCastPickerOpen(true)}>
                <Avatar char={null} className="cast-avatar" />
                <div className="cast-meta">
                  <div className="cast-name">点击选择角色</div>
                  <div className="cast-sub">尚未选择</div>
                </div>
                <div className="cast-actions">
                  <button className="btn-icon" title="选择角色">
                    <Icon name="swap" size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Import text */}
          <div className="step">
            <div className="step-head">
              <div className="step-num">2</div>
              <div className="step-title">粘贴或导入长文本</div>
              <div className="step-hint">支持 .txt / .srt 字幕</div>
            </div>
            <div className="script-card">
              <textarea
                placeholder={'把整段台词粘贴到这里…\n系统会自动按标点拆分为可独立合成的句子。'}
                value={longText}
                onChange={(e) => setLongText(e.target.value)}
                style={{ minHeight: '160px' }}
              />
              <div className="script-foot">
                <span className="left">
                  <input
                    type="file"
                    accept=".txt"
                    style={{ display: 'none' }}
                    ref={fileInputRef}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        file.text().then((text) => setLongText(text)).catch(() => {})
                        e.target.value = ''
                      }
                    }}
                  />
                  <button
                    className="btn-chip"
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Icon name="file" size={14} /> 导入 TXT
                  </button>

                  <input
                    type="file"
                    accept=".srt"
                    style={{ display: 'none' }}
                    ref={srtInputRef}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        file.text().then((raw) => setLongText(parseSrt(raw))).catch(() => {})
                        e.target.value = ''
                      }
                    }}
                  />
                  <button
                    className="btn-chip"
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                    onClick={() => srtInputRef.current?.click()}
                  >
                    <Icon name="film" size={14} /> 导入 SRT
                  </button>
                </span>
                <span className="long-min-len-row">
                  <label htmlFor="longMinLen" className="long-min-len-label">最短字数</label>
                  <input
                    id="longMinLen"
                    type="number"
                    className="long-min-len-input"
                    min={1}
                    max={700}
                    value={longMinLen}
                    onChange={(e) => setLongMinLen(Math.max(1, Math.min(700, parseInt(e.target.value, 10) || 10)))}
                  />
                </span>
              </div>
            </div>

            <div style={{ marginTop: '12px' }}>
              <button
                className="btn-chip"
                style={{ padding: '6px 16px', fontSize: '13px' }}
                onClick={handleSplit}
                disabled={!longText.trim() || splitting}
              >
                {splitting ? '拆分中…' : (
                  <>
                    <Icon name="scissors" size={14} /> 智能拆分段落
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Step 3: Batch list */}
          <div className="step">
            <div className="step-head">
              <div className="step-num">3</div>
              <div className="step-title">智能拆分与逐句合成</div>
            </div>

            <div className="batch-bar">
              <div className="batch-left">
                <input
                  type="checkbox"
                  className="seg-check"
                  id="selAll"
                  checked={visibleCount > 0 && visibleSelectedCount === visibleCount}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
                <label htmlFor="selAll" style={{ cursor: 'pointer' }}>
                  已选 <strong>{selectedCount}</strong> / {segments.length} 句
                </label>

                {/* 情绪起伏（全局 alpha 权重，仅 alpha override=null 时生效） */}
                <div className="batch-alpha-group">
                  <label className="batch-alpha-label">情绪起伏</label>
                  <select
                    className="batch-select"
                    value={String(longGlobalAlpha)}
                    onChange={(e) => setLongGlobalAlpha(parseFloat(e.target.value))}
                  >
                    <option value="0.2">很低</option>
                    <option value="0.4">低</option>
                    <option value="0.6">中（默认）</option>
                    <option value="0.8">高</option>
                    <option value="1.0">很高</option>
                  </select>
                </div>

                {/* 段筛选器 */}
                <select
                  className="batch-select"
                  value={segFilter}
                  onChange={(e) => setSegFilter(e.target.value as SegFilter)}
                >
                  <option value="all">全部</option>
                  <option value="no_ref">未选参考音</option>
                  <option value="no_audio">未合成音频</option>
                  <option value="no_audition">合成后未试听</option>
                </select>
              </div>

              <div className="batch-right">
                {/* 从头播放 */}
                <button
                  className={`btn-chip${seqPlaying ? ' btn-chip--danger' : ''}`}
                  onClick={handleSequentialPlay}
                  disabled={segments.filter((s) => s.selected && s.audio_url).length === 0 && !seqPlaying}
                >
                  {seqPlaying
                    ? <><Icon name="stop" size={13} /> 停止播放</>
                    : <><Icon name="sequential-play" size={13} /> 从头播放</>
                  }
                </button>

                <button
                  className="btn-chip"
                  onClick={handleBatchMatch}
                  disabled={!activeChar || matching || synthing || selectedCount === 0}
                >
                  {matching ? '匹配中…' : '智能匹配'}
                </button>

                {/* 全部合成 / 停止合成 */}
                {synthing ? (
                  <button
                    className="btn-chip btn-chip--danger"
                    onClick={handleStopSynth}
                  >
                    <Icon name="stop" size={13} /> 停止合成
                  </button>
                ) : (
                  <button
                    className="btn-chip"
                    onClick={handleBatchSynth}
                    disabled={!activeChar || matching || selectedCount === 0}
                  >
                    全部合成
                  </button>
                )}

                {/* 合并导出 WAV */}
                <button
                  className="btn-chip"
                  onClick={handleMergeExport}
                  disabled={
                    longBusy ||
                    mergeLoading ||
                    segments.filter((s) => s.selected && s.audio_url).length === 0
                  }
                >
                  <Icon name="merge" size={13} />
                  {mergeLoading ? ' 合并中…' : ' 合并导出 WAV'}
                </button>

                <button
                  className="btn-chip"
                  onClick={handleExportZip}
                  disabled={
                    longBusy ||
                    exporting ||
                    segments.filter((s) => s.selected && s.audio_url).length === 0
                  }
                >
                  <Icon name="download" size={13} />
                  {exporting ? ' 打包中…' : ' 导出 ZIP'}
                </button>
              </div>
            </div>

            <div className="seg-list">
              {segments.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-3)', fontSize: '14px' }}>
                  请先粘贴文本并点击「智能拆分段落」
                </div>
              )}
              {visibleSegments.map((seg, visibleIdx) => (
                <SegmentItem
                  key={seg.id}
                  seg={seg}
                  displayIndex={segments.findIndex((s) => s.id === seg.id) + 1}
                  visibleIndex={visibleIdx}
                  isSeqPlaying={seqCurrentId === seg.id}
                  charId={activeChar?.char_id}
                  editingId={editingSegId}
                  editingText={editingText}
                  onToggle={toggleSeg}
                  onEditStart={(id) => { setEditingSegId(id); setEditingText(seg.text) }}
                  onEditChange={setEditingText}
                  onEditBlur={(id, text) => {
                    setSegments((prev) => prev.map((s) => s.id === id ? { ...s, text } : s))
                    setEditingSegId(null)
                  }}
                  onMatch={handleSegMatch}
                  onSynth={handleSegSynth}
                  onDelete={handleSegDelete}
                  onVectorEdit={(id) => setSegAdvancedId(id)}
                  onAuditioned={markAuditioned}
                  onPlaySynth={(url, title) => onSynthesized(url, title, `段落 ${seg.id}`)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sheets */}
      <CastPickerSheet
        open={castPickerOpen}
        characters={characters}
        activeCharId={activeChar?.char_id ?? null}
        onClose={() => setCastPickerOpen(false)}
        onSelect={onCharChange}
      />

      {/* 单句模式高级 sheet */}
      <AdvancedSheet
        open={advancedOpen && segAdvancedId === null}
        overrides={singleOverrides}
        llmCache={singleLlmCache}
        libraryItems={libraryItems}
        onClose={() => setAdvancedOpen(false)}
        onSave={handleSingleAdvancedSave}
      />

      {/* 单段高级 sheet（长文本） */}
      <AdvancedSheet
        open={segAdvancedId !== null}
        overrides={segAdvancedSeg?.overrides ?? makeDefaultOverrides()}
        llmCache={segAdvancedSeg?.llmCache ?? null}
        libraryItems={libraryItems}
        onClose={() => setSegAdvancedId(null)}
        onSave={(newOverrides) => {
          if (segAdvancedId !== null) {
            handleSegAdvancedSave(segAdvancedId, newOverrides)
          }
          setSegAdvancedId(null)
        }}
      />
    </div>
  )
}

// ============================================================
// 段落筛选工具函数
// ============================================================

/**
 * Business Logic:
 *   根据用户选择的筛选条件，过滤出当前应该显示的段落列表。
 *
 * Code Logic:
 *   'all' 直接返回全部；其余按字段筛。
 */
function getVisibleSegments(segments: LongTextSegment[], filter: SegFilter): LongTextSegment[] {
  switch (filter) {
    case 'all': return segments
    case 'no_ref': return segments.filter((s) => !s.ref_audio_filename && !s.overrides.ref)
    case 'no_audio': return segments.filter((s) => !s.audio_url)
    case 'no_audition': return segments.filter((s) => s.audio_url && !s.auditioned)
  }
}

// ============================================================
// SegmentItem 子组件
// ============================================================

interface SegmentItemProps {
  seg: LongTextSegment
  displayIndex: number
  visibleIndex: number
  isSeqPlaying: boolean
  charId: string | undefined
  editingId: number | null
  editingText: string
  onToggle: (id: number) => void
  onEditStart: (id: number) => void
  onEditChange: (text: string) => void
  onEditBlur: (id: number, text: string) => void
  onMatch: (id: number) => void
  onSynth: (id: number) => void
  onDelete: (id: number) => void
  onVectorEdit: (id: number) => void
  onAuditioned: (id: number) => void
  onPlaySynth: (url: string, title: string) => void
}

/**
 * Business Logic:
 *   每个段落的卡片，展示文本、状态、操作按钮，hover 时显示操作行。
 *
 * Code Logic:
 *   hover 状态用 CSS :hover + .seg-actions visibility 控制。
 *   内联文本编辑：editingId === seg.id 时改 textarea，blur 回调保存。
 *   override 状态用 seg.overrides 判断，显示相应徽章。
 */
function SegmentItem({
  seg,
  displayIndex,
  isSeqPlaying,
  editingId,
  editingText,
  onToggle,
  onEditStart,
  onEditChange,
  onEditBlur,
  onMatch,
  onSynth,
  onDelete,
  onVectorEdit,
  onAuditioned,
  onPlaySynth,
}: SegmentItemProps) {
  const isEditing = editingId === seg.id
  const hasOverride =
    seg.overrides.ref !== null ||
    seg.overrides.emotion !== null ||
    seg.overrides.vector !== null ||
    seg.overrides.alpha !== null

  // 展示用情绪：override 优先，其次 llmCache，其次 target_emotion（旧数据兼容）
  const displayEmotion =
    seg.overrides.emotion ?? seg.llmCache?.target_emotion ?? seg.target_emotion

  // 展示用 ref_audio_url（用于试听参考音）
  const displayRefUrl =
    seg.overrides.ref?.audio_url ?? seg.llmCache?.ref_audio_url ?? seg.ref_audio_url

  return (
    <div
      className={`seg-item${seg.status === 'done' ? ' is-done' : ''}${isSeqPlaying ? ' is-playing' : ''}`}
    >
      {/* 左：序号 + 勾选 */}
      <span className="seg-num">{String(displayIndex).padStart(2, '0')}</span>
      <input
        type="checkbox"
        className="seg-check"
        checked={seg.selected}
        onChange={() => onToggle(seg.id)}
      />

      {/* 中：文本（编辑态或展示态） */}
      <div className="seg-body">
        {isEditing ? (
          <textarea
            className="seg-edit-textarea"
            value={editingText}
            autoFocus
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={() => onEditBlur(seg.id, editingText)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onEditBlur(seg.id, editingText)
              }
              if (e.key === 'Escape') {
                onEditBlur(seg.id, seg.text)
              }
            }}
          />
        ) : (
          <div className="seg-text" onDoubleClick={() => onEditStart(seg.id)}>
            {seg.text}
          </div>
        )}

        {/* 情绪标签行 */}
        {displayEmotion && (
          <div className="seg-emo-row">
            <span className="seg-emo-badge">
              {displayEmotion.primary}
            </span>
            {hasOverride && (
              <span className="seg-override-badge">已 override</span>
            )}
            {(seg.emo_vector ?? seg.overrides.vector) && (
              <span className="seg-vector-badge">向量</span>
            )}
            {(seg.emo_alpha !== undefined || seg.overrides.alpha !== null) && (
              <span className="seg-alpha-badge">
                α {(seg.overrides.alpha ?? seg.emo_alpha ?? 0).toFixed(2)}
              </span>
            )}
          </div>
        )}

        {/* 操作按钮行（hover 时可见） */}
        <div className="seg-actions">
          {/* 内联编辑 */}
          <button
            className="seg-action-btn"
            title="编辑文本"
            onClick={() => onEditStart(seg.id)}
          >
            <Icon name="edit" size={13} />
          </button>

          {/* 重新匹配 */}
          <button
            className="seg-action-btn"
            title="重新匹配"
            onClick={() => onMatch(seg.id)}
          >
            <Icon name="regenerate" size={13} />
          </button>

          {/* 合成/重新合成 */}
          <button
            className="seg-action-btn"
            title={seg.audio_url ? '重新合成' : '合成'}
            onClick={() => onSynth(seg.id)}
          >
            <Icon name="mic" size={13} />
          </button>

          {/* 试听参考音 */}
          {displayRefUrl && (
            <button
              className="seg-action-btn"
              title="试听参考音"
              onClick={() => {
                new Audio(displayRefUrl).play().catch(() => {})
              }}
            >
              <Icon name="wave" size={13} />
            </button>
          )}

          {/* 高级模式（设置 overrides） */}
          <button
            className={`seg-action-btn${hasOverride ? ' is-active' : ''}`}
            title={hasOverride ? '已设 override（点击修改）' : '高级模式 / 设置 override'}
            onClick={() => onVectorEdit(seg.id)}
          >
            <Icon name="sliders" size={13} />
          </button>

          {/* 删除 */}
          <button
            className="seg-action-btn seg-action-btn--danger"
            title="删除此段"
            onClick={() => onDelete(seg.id)}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>

      {/* 右：状态 + 播放 */}
      <span className={`seg-status${segStatusClass(seg.status)}`}>
        {segStatusLabel(seg.status)}
      </span>
      <button
        className="btn-icon"
        disabled={!seg.audio_url}
        onClick={() => {
          if (seg.audio_url) {
            const title = seg.text.length > 20 ? seg.text.slice(0, 20) + '…' : seg.text
            onAuditioned(seg.id)
            onPlaySynth(seg.audio_url, title)
          }
        }}
      >
        <Icon name="play" size={14} />
      </button>
    </div>
  )
}
