/**
 * Business Logic:
 *   工作台视图，是用户合成配音的主界面，包含两种工作流：
 *   (1) 单句配音：三步引导（选声音→写台词→合成），合成后展示候选音卡片、重新生成、手动选参考音
 *   (2) 长文本配音：粘贴批量文本，智能拆分→逐句匹配→批量合成，支持单段操作/顺序播放/合并导出
 *
 * Code Logic:
 *   通过 studioMode 状态切换两个子面板的展示。
 *   单句模式调用 useMatch + useSynthesize 真 hook，完成后展示候选音卡片池。
 *   长文本模式维护 segments 数组（LongTextSegment[]），依次调
 *   useLongTextSplit / useMatch / useSynthesize 完成全流程。
 *   高级模式通过 advancedOpen 状态控制 AdvancedSheet 弹出。
 *   顺序播放用 useSequentialPlay hook 管理。
 *   合并导出用 useMergeOutputs hook 管理。
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import './StudioView.css'
import Icon from '../icons/Icon'
import CastPickerSheet from '../components/CastPickerSheet'
import AdvancedSheet, { DEFAULT_SETTINGS } from '../components/AdvancedSheet'
import ReferencePickerSheet from '../components/ReferencePickerSheet'
import Avatar from '../components/Avatar'
import type { AdvancedSettings } from '../components/AdvancedSheet'
import type { Character, LibraryItem, EmotionVector } from '@/api/types'
import type { LongTextSegment } from '../utils/longText'
import { useMatch } from '@/hooks/useMatch'
import { useSynthesize } from '@/hooks/useSynthesize'
import { useLongTextSplit } from '@/hooks/useLongTextSplit'
import { useCharacterDetail } from '@/hooks/useCharacterDetail'
import { useSequentialPlay } from '@/hooks/useSequentialPlay'
import { useMergeOutputs } from '@/hooks/useMergeOutputs'
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
  const [advSettings, setAdvSettings] = useState<AdvancedSettings>(DEFAULT_SETTINGS)

  // ── 单句模式状态 ──────────────────────────────────────────
  const [matchResult, setMatchResult] = useState<{
    target_emotion: { primary: string; intensity: string; complex?: string }
    candidates: CandidateCard[]
    emo_vector: EmotionVector | null
    emo_alpha: number
  } | null>(null)
  const [synthDone, setSynthDone] = useState<boolean>(false)
  const [activeCandidateIdx, setActiveCandidateIdx] = useState<number>(0)
  // 向量状态：null = AI 自动，有值 = 用户/AI 注入
  const [singleEmoVector, setSingleEmoVector] = useState<EmotionVector | null>(null)
  const [singleEmoAlpha, setSingleEmoAlpha] = useState<number>(0.65)
  const [singleVectorActive, setSingleVectorActive] = useState<boolean>(false)
  // 手动参考音：从 ReferencePickerSheet 选定后存此值
  const [manualRefItem, setManualRefItem] = useState<LibraryItem | null>(null)
  const [refPickerOpen, setRefPickerOpen] = useState<boolean>(false)
  // 用于单段高级 sheet 打开（长文本）
  const [segAdvancedId, setSegAdvancedId] = useState<number | null>(null)
  // 长文本每段的参考音 picker
  const [segRefPickerId, setSegRefPickerId] = useState<number | null>(null)

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

  // 加载角色素材库（用于手动选参考音）
  const { items: libraryItems } = useCharacterDetail(activeChar?.char_id ?? '')

  const isBusy = matchLoading || synthLoading
  const longBusy = splitting || matching || synthing

  // ── 当 activeChar 变化时清空单句 matchResult / refItem ──────
  useEffect(() => {
    setMatchResult(null)
    setSynthDone(false)
    setActiveCandidateIdx(0)
    setManualRefItem(null)
    setSingleEmoVector(null)
    setSingleVectorActive(false)
  }, [activeChar?.char_id])

  // ============================================================
  // 单句模式
  // ============================================================

  /**
   * Business Logic:
   *   单句模式核心流程：先 LLM 情绪匹配，再用指定候选（或手动选）TTS 合成，
   *   最后通知 BottomPlayer。
   *
   * Code Logic:
   *   依次调用 runMatch / runSynth，结果通过 onSynthesized 回传父组件。
   *   若有 manualRefItem 强制用它，否则用 candidates[candidateIdx]。
   *   若 singleVectorActive 则传向量，否则用 AI 返回向量。
   */
  const handleSynth = useCallback(async (candidateIdx?: number) => {
    if (!activeChar || !script.trim()) return
    const idx = candidateIdx ?? activeCandidateIdx

    const result = await runMatch({
      char_id: activeChar.char_id,
      text: script,
      lock: advSettings.lockPrimary
        ? {
            primary: advSettings.lockPrimary,
            intensity: advSettings.lockIntensity,
            complex: advSettings.lockComplex || undefined,
          }
        : undefined,
    })
    // 注入向量
    const newVector = result.emo_vector
    setSingleEmoVector(newVector)
    setSingleEmoAlpha(result.emo_alpha)
    setSingleVectorActive(!!newVector)
    setMatchResult({
      target_emotion: result.target_emotion,
      candidates: result.candidates.map((c) => ({
        id: c.id,
        text: c.text,
        filename: c.filename,
        ref_audio_url: c.ref_audio_url,
        reason: c.reason,
        emotion: c.emotion,
      })),
      emo_vector: result.emo_vector,
      emo_alpha: result.emo_alpha,
    })
    setActiveCandidateIdx(idx)

    const refFilename = manualRefItem?.filename ?? result.candidates[idx]?.filename
    if (!refFilename) return

    const vector = singleVectorActive ? singleEmoVector : result.emo_vector
    const alpha = singleVectorActive ? singleEmoAlpha : result.emo_alpha

    const { audio_url } = await runSynth({
      char_id: activeChar.char_id,
      ref_audio_filename: refFilename,
      text: script,
      emo_vector: vector,
      emo_alpha: alpha,
    })
    setSynthDone(true)
    onSynthesized(
      audio_url,
      script.length > 30 ? script.slice(0, 30) + '…' : script,
      `${activeChar.name} · ${result.target_emotion.primary} · α ${result.emo_alpha.toFixed(2)}`
    )
  }, [activeChar, script, advSettings, activeCandidateIdx, manualRefItem, singleVectorActive, singleEmoVector, singleEmoAlpha, runMatch, runSynth, onSynthesized])

  /**
   * Business Logic:
   *   用户点击候选卡片的「使用此条」按钮，换用不同候选音重新合成。
   *
   * Code Logic:
   *   先把 matchResult 里该候选的 filename 传给 runSynth，更新播放器。
   */
  const handleUseCandidateAtIdx = useCallback(async (idx: number) => {
    if (!activeChar || !script.trim() || !matchResult) return
    const cand = matchResult.candidates[idx]
    if (!cand) return
    setActiveCandidateIdx(idx)

    const vector = singleVectorActive ? singleEmoVector : matchResult.emo_vector
    const alpha = singleVectorActive ? singleEmoAlpha : matchResult.emo_alpha

    const { audio_url } = await runSynth({
      char_id: activeChar.char_id,
      ref_audio_filename: cand.filename,
      text: script,
      emo_vector: vector,
      emo_alpha: alpha,
    })
    onSynthesized(
      audio_url,
      script.length > 30 ? script.slice(0, 30) + '…' : script,
      `${activeChar.name} · ${matchResult.target_emotion.primary} · 候选 ${idx + 1}`
    )
  }, [activeChar, script, matchResult, singleVectorActive, singleEmoVector, singleEmoAlpha, runSynth, onSynthesized])

  /**
   * Business Logic:
   *   高级模式应用后立即重新合成，让参数调整立即生效。
   *
   * Code Logic:
   *   先更新 advSettings，再调 handleSynth。
   */
  const handleAdvancedApply = useCallback(
    async (settings: AdvancedSettings) => {
      setAdvSettings(settings)
      setAdvancedOpen(false)
      // 若用户在高级模式中设置了向量，注入到单句状态
      setSingleEmoVector(settings.emoVector)
      setSingleEmoAlpha(settings.emoAlpha)
      setSingleVectorActive(true)
      await handleSynth()
    },
    [handleSynth]
  )

  /**
   * Business Logic:
   *   用户选完参考音后，用该 ref 重新合成（不重跑 match）。
   *
   * Code Logic:
   *   更新 manualRefItem，用当前 matchResult 里的向量直接合成。
   */
  const handleRefPickerSelect = useCallback(async (item: LibraryItem) => {
    setRefPickerOpen(false)
    setManualRefItem(item)
    if (!activeChar || !script.trim()) return
    const vector = singleVectorActive ? singleEmoVector : matchResult?.emo_vector ?? null
    const alpha = singleVectorActive ? singleEmoAlpha : matchResult?.emo_alpha ?? 0.65
    const { audio_url } = await runSynth({
      char_id: activeChar.char_id,
      ref_audio_filename: item.filename,
      text: script,
      emo_vector: vector,
      emo_alpha: alpha,
    })
    setSynthDone(true)
    onSynthesized(
      audio_url,
      script.length > 30 ? script.slice(0, 30) + '…' : script,
      `${activeChar.name} · 手动参考音 · ${item.emotion_primary}`
    )
  }, [activeChar, script, matchResult, singleVectorActive, singleEmoVector, singleEmoAlpha, runSynth, onSynthesized])

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
   *   每条默认 selected=true、status='unmatched'。
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
   *   对所有勾选段落串行调 LLM 情绪匹配，逐个回填 ref_audio_filename /
   *   emo_vector / emo_alpha，完成后 status 变 'pending'。
   *   全局 alpha 权重 longGlobalAlpha 作为 alpha 上限乘数。
   *
   * Code Logic:
   *   依次 await runMatch，每次拿 candidates[0].filename 和 emo 字段写回对应 segment。
   *   finalAlpha = backendAlpha * globalWeight（对齐旧版逻辑）。
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
        })
        const best = result.candidates[0]
        const backendAlpha = result.emo_alpha ?? 0.65
        const finalAlpha = parseFloat((backendAlpha * longGlobalAlpha).toFixed(2))
        setSegments((prev) =>
          prev.map((s) =>
            s.id === seg.id
              ? {
                  ...s,
                  status: 'pending',
                  ref_audio_filename: best?.filename,
                  ref_audio_url: best?.ref_audio_url,
                  emo_vector: result.emo_vector,
                  emo_alpha: finalAlpha,
                  target_emotion: result.target_emotion,
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
  }, [activeChar, matching, segments, segFilter, runMatch, longGlobalAlpha])

  /**
   * Business Logic:
   *   对所有勾选且 status==='pending' 的段落串行调合成，支持 abort 停止。
   *
   * Code Logic:
   *   依次 await runSynth，传 AbortController.signal，
   *   每次把 audio_url 写回对应 segment；收到 abort 时立即跳出循环。
   */
  const handleBatchSynth = useCallback(async () => {
    if (!activeChar || synthing) return
    const targets = segments.filter((s) => s.selected && s.status === 'pending')
    if (targets.length === 0) return
    setSynthing(true)
    const controller = new AbortController()
    synthAbortRef.current = controller
    for (const seg of targets) {
      if (controller.signal.aborted) break
      if (!seg.ref_audio_filename) {
        setSegments((prev) =>
          prev.map((s) => (s.id === seg.id ? { ...s, status: 'error' } : s))
        )
        continue
      }
      try {
        const { audio_url } = await runSynth({
          char_id: activeChar.char_id,
          ref_audio_filename: seg.ref_audio_filename,
          text: seg.text,
          emo_vector: seg.emo_vector,
          emo_alpha: seg.emo_alpha,
        })
        if (controller.signal.aborted) break
        setSegments((prev) =>
          prev.map((s) => (s.id === seg.id ? { ...s, status: 'done', audio_url } : s))
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
  }, [activeChar, synthing, segments, runSynth])

  /**
   * Business Logic:
   *   停止正在进行的批量合成。
   *
   * Code Logic:
   *   abort 当前 AbortController，setSynthing(false)。
   */
  const handleStopSynth = useCallback(() => {
    if (synthAbortRef.current) {
      synthAbortRef.current.abort()
    }
  }, [])

  /**
   * Business Logic:
   *   单段重新匹配——不触及其他段，只更新该段的 ref 和向量。
   *
   * Code Logic:
   *   await runMatch，写回对应 segment，finalAlpha 同批量逻辑。
   */
  const handleSegMatch = useCallback(async (segId: number) => {
    if (!activeChar) return
    const seg = segments.find((s) => s.id === segId)
    if (!seg) return
    try {
      const result = await runMatch({
        char_id: activeChar.char_id,
        text: seg.text,
      })
      const best = result.candidates[0]
      const backendAlpha = result.emo_alpha ?? 0.65
      const finalAlpha = parseFloat((backendAlpha * longGlobalAlpha).toFixed(2))
      setSegments((prev) =>
        prev.map((s) =>
          s.id === segId
            ? {
                ...s,
                status: 'pending',
                ref_audio_filename: best?.filename,
                ref_audio_url: best?.ref_audio_url,
                emo_vector: result.emo_vector,
                emo_alpha: finalAlpha,
                target_emotion: result.target_emotion,
              }
            : s
        )
      )
    } catch {
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, status: 'error' } : s))
      )
    }
  }, [activeChar, segments, runMatch, longGlobalAlpha])

  /**
   * Business Logic:
   *   单段重新合成。
   *
   * Code Logic:
   *   await runSynth，写回 audio_url，status→'done'。
   */
  const handleSegSynth = useCallback(async (segId: number) => {
    if (!activeChar) return
    const seg = segments.find((s) => s.id === segId)
    if (!seg?.ref_audio_filename) return
    try {
      const { audio_url } = await runSynth({
        char_id: activeChar.char_id,
        ref_audio_filename: seg.ref_audio_filename,
        text: seg.text,
        emo_vector: seg.emo_vector,
        emo_alpha: seg.emo_alpha,
      })
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, status: 'done', audio_url, auditioned: false } : s))
      )
    } catch {
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, status: 'error' } : s))
      )
    }
  }, [activeChar, segments, runSynth])

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
   *   长文本中替换某段参考音（从 ReferencePickerSheet 选定后）。
   *
   * Code Logic:
   *   更新 ref_audio_filename 和 ref_audio_url，status→'pending'，触发自动合成。
   */
  const handleSegRefSelect = useCallback(async (item: LibraryItem) => {
    const segId = segRefPickerId
    setSegRefPickerId(null)
    if (!segId || !activeChar) return
    setSegments((prev) =>
      prev.map((s) =>
        s.id === segId
          ? {
              ...s,
              ref_audio_filename: item.filename,
              ref_audio_url: item.audio_url,
              status: 'pending',
            }
          : s
      )
    )
    // 自动触发合成
    const seg = segments.find((s) => s.id === segId)
    if (!seg) return
    try {
      const { audio_url } = await runSynth({
        char_id: activeChar.char_id,
        ref_audio_filename: item.filename,
        text: seg.text,
        emo_vector: seg.emo_vector,
        emo_alpha: seg.emo_alpha,
      })
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, status: 'done', audio_url, auditioned: false } : s))
      )
    } catch {
      setSegments((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, status: 'error' } : s))
      )
    }
  }, [segRefPickerId, activeChar, segments, runSynth])

  /**
   * Business Logic:
   *   长文本模式单段高级 sheet 应用，针对指定 segment 更新向量后自动合成。
   *
   * Code Logic:
   *   从 settings 中取出向量值，写回对应 segment，然后调 handleSegSynth。
   */
  const handleSegAdvancedApply = useCallback(async (settings: AdvancedSettings) => {
    const segId = segAdvancedId
    setSegAdvancedId(null)
    if (!segId) return
    setSegments((prev) =>
      prev.map((s) =>
        s.id === segId
          ? { ...s, emo_vector: settings.emoVector, emo_alpha: settings.emoAlpha }
          : s
      )
    )
    // 合成
    await handleSegSynth(segId)
  }, [segAdvancedId, handleSegSynth])

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

  // ── 当段高级 sheet 相关 ──────────────────────────────────
  const segAdvancedInitial: AdvancedSettings = (() => {
    const seg = segments.find((s) => s.id === segAdvancedId)
    if (!seg) return DEFAULT_SETTINGS
    return {
      ...DEFAULT_SETTINGS,
      emoVector: (seg.emo_vector as [number, number, number, number, number, number, number, number] | undefined) ?? DEFAULT_SETTINGS.emoVector,
      emoAlpha: seg.emo_alpha ?? DEFAULT_SETTINGS.emoAlpha,
    }
  })()

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
              <div className="step-hint">AI 会自动诊断情绪并挑选最合适的参考音</div>
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

              {/* 工具行：高级模式 + 向量状态 + 手动选参考音 */}
              <div className="action-tools">
                <button
                  className="advanced-link"
                  onClick={() => setAdvancedOpen(true)}
                >
                  高级模式 · 手动情绪 / 参考音 / 向量微调
                </button>

                {singleVectorActive && (
                  <span className="vector-chip is-active">
                    <Icon name="sliders" size={12} />
                    向量控制已启用
                    <button
                      className="vector-chip__cancel"
                      title="取消向量，回归 AI 自动"
                      onClick={() => {
                        setSingleVectorActive(false)
                        setSingleEmoVector(null)
                      }}
                    >
                      <Icon name="cancel" size={12} />
                    </button>
                  </span>
                )}

                <button
                  className="btn-chip btn-chip--sm"
                  onClick={() => setRefPickerOpen(true)}
                  disabled={!activeChar}
                  title="手动指定参考音片段"
                >
                  <Icon name="library" size={13} />
                  {manualRefItem ? `参考音：${manualRefItem.emotion_primary}` : '手动选参考音'}
                  {manualRefItem && (
                    <span
                      className="chip-cancel"
                      onClick={(e) => { e.stopPropagation(); setManualRefItem(null) }}
                    >
                      <Icon name="close" size={10} />
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Diagnosis preview */}
            {matchResult && (
              <div className="diag-preview">
                <div className="diag-icon">
                  <Icon name="ai" size={16} />
                </div>
                <div className="diag-text">
                  <div className="diag-label">情绪诊断</div>
                  <div className="diag-body">
                    主情绪：<strong>{matchResult.target_emotion.primary}</strong>
                    {matchResult.target_emotion.complex && `（${matchResult.target_emotion.complex}）`}
                    &nbsp;·&nbsp;
                    <strong className="mono">Alpha = {matchResult.emo_alpha.toFixed(2)}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* 候选音卡片池 */}
            {matchResult && matchResult.candidates.length > 0 && (
              <div className="candidates-section">
                <div className="candidates-label">
                  <Icon name="list" size={12} />
                  候选参考音（共 {matchResult.candidates.length} 条）
                </div>
                <div className="candidates-list">
                  {matchResult.candidates.map((c, idx) => (
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

                {/* 情绪起伏（全局 alpha 权重） */}
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
                    disabled={
                      !activeChar ||
                      matching ||
                      segments.filter((s) => s.selected && s.status === 'pending').length === 0
                    }
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
                  onRefPicker={(id) => setSegRefPickerId(id)}
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
        initial={advSettings}
        onClose={() => setAdvancedOpen(false)}
        onApply={handleAdvancedApply}
      />

      {/* 单段高级 sheet（长文本） */}
      <AdvancedSheet
        open={segAdvancedId !== null}
        initial={segAdvancedInitial}
        onClose={() => setSegAdvancedId(null)}
        onApply={handleSegAdvancedApply}
      />

      {/* 单句手动参考音 picker */}
      <ReferencePickerSheet
        open={refPickerOpen}
        items={libraryItems}
        selectedItemId={manualRefItem?.id ?? null}
        onClose={() => setRefPickerOpen(false)}
        onSelect={handleRefPickerSelect}
      />

      {/* 长文本单段参考音 picker */}
      <ReferencePickerSheet
        open={segRefPickerId !== null}
        items={libraryItems}
        selectedItemId={null}
        onClose={() => setSegRefPickerId(null)}
        onSelect={handleSegRefSelect}
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
    case 'no_ref': return segments.filter((s) => !s.ref_audio_filename)
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
  onRefPicker: (id: number) => void
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
  onRefPicker,
  onDelete,
  onVectorEdit,
  onAuditioned,
  onPlaySynth,
}: SegmentItemProps) {
  const isEditing = editingId === seg.id

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
        {seg.target_emotion && (
          <div className="seg-emo-row">
            <span className="seg-emo-badge">
              {seg.target_emotion.primary}
            </span>
            {seg.emo_vector && (
              <span className="seg-vector-badge">向量</span>
            )}
            {seg.emo_alpha !== undefined && (
              <span className="seg-alpha-badge">α {seg.emo_alpha.toFixed(2)}</span>
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

          {/* 重新合成 */}
          {seg.ref_audio_filename && (
            <button
              className="seg-action-btn"
              title="重新合成"
              onClick={() => onSynth(seg.id)}
            >
              <Icon name="mic" size={13} />
            </button>
          )}

          {/* 替换参考音 */}
          <button
            className="seg-action-btn"
            title="替换参考音"
            onClick={() => onRefPicker(seg.id)}
          >
            <Icon name="library" size={13} />
          </button>

          {/* 试听参考音 */}
          {seg.ref_audio_url && (
            <button
              className="seg-action-btn"
              title="试听参考音"
              onClick={() => {
                new Audio(seg.ref_audio_url!).play().catch(() => {})
              }}
            >
              <Icon name="wave" size={13} />
            </button>
          )}

          {/* 设置情绪向量 */}
          <button
            className={`seg-action-btn${seg.emo_vector ? ' is-active' : ''}`}
            title={seg.emo_vector ? '已设情绪向量（点击修改）' : '设置情绪向量'}
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
