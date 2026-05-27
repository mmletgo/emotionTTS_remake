/**
 * Business Logic（为什么需要这个组件）:
 *   用户需要新建角色时，配置角色名、头像、音频文件、切片参数，然后提交后端全自动处理。
 *   之前这些步骤塞在 Sheet 抽屉里，展示空间不足，体验割裂。
 *   改为独立全屏 View，可以展示更丰富的四阶段进度（切片/转写/打标/写入）和完成总览。
 *
 * Code Logic（这个函数做什么）:
 *   三个阶段卡片：配置区（始终显示）→ 处理进度（提交后显示）→ 完成总览（done 后显示）。
 *   进度使用 useBuildCharacter hook 轮询，stage 字段驱动四个阶段状态卡片。
 *   完成后调用 getCharacterDetails 拿情绪分布；失败时显示错误 banner + 重试按钮。
 *   处理中点击返回触发 confirm 中断提示。
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import './BuildCharacterView.css'
import Icon from '../icons/Icon'
import { useBuildCharacter } from '@/hooks/useBuildCharacter'
import { getCharacterDetails } from '@/api/client'
import { ASR_LANGUAGE_OPTIONS } from '@/api/types'
import type { AsrLanguage, EmotionPrimary } from '@/api/types'

// ============================================================
// 阶段类型定义
// ============================================================

type StageKey = 'slicing' | 'asr' | 'tagging' | 'writing'
type StageStatus = 'pending' | 'active' | 'done' | 'error'

interface StageInfo {
  key: StageKey
  label: string
  desc: string
}

const STAGES: StageInfo[] = [
  { key: 'slicing', label: '切片', desc: '静音切分音频' },
  { key: 'asr', label: '转写', desc: 'Whisper 识别' },
  { key: 'tagging', label: '打标', desc: 'LLM 情绪分析' },
  { key: 'writing', label: '写入', desc: '落盘素材库' },
]

const STAGE_ORDER: StageKey[] = ['slicing', 'asr', 'tagging', 'writing']

/**
 * Business Logic:
 *   根据后端返回的当前 stage 和任务状态，判断每个阶段卡片应显示的状态。
 *
 * Code Logic:
 *   若任务 error，当前 stage 为 error，之前的为 done，之后的为 pending。
 *   若任务 done，所有阶段都是 done。
 *   否则当前 stage 是 active，之前的是 done，之后的是 pending。
 *   stage 为 null 时（不区分阶段），所有卡片都是 pending（显示中性等待状态）。
 */
function deriveStageStatus(
  stageKey: StageKey,
  currentStage: string | null,
  isError: boolean,
  isDone: boolean,
): StageStatus {
  if (isDone && !isError) return 'done'
  if (currentStage === null) return 'pending'
  const currentIdx = STAGE_ORDER.indexOf(currentStage as StageKey)
  const thisIdx = STAGE_ORDER.indexOf(stageKey)
  if (isError) {
    if (thisIdx < currentIdx) return 'done'
    if (thisIdx === currentIdx) return 'error'
    return 'pending'
  }
  if (thisIdx < currentIdx) return 'done'
  if (thisIdx === currentIdx) return 'active'
  return 'pending'
}

// ============================================================
// 阶段卡片子组件
// ============================================================

interface StageCardProps {
  info: StageInfo
  status: StageStatus
}

/**
 * Business Logic:
 *   直观展示四个处理阶段（切片/转写/打标/写入）中每一个的当前状态。
 *
 * Code Logic:
 *   根据 status prop 渲染不同样式：pending 灰色、active 蓝色 + spinner、
 *   done 绿色 + 勾、error 红色 + X。
 */
function StageCard({ info, status }: StageCardProps) {
  return (
    <div className={`bcv-stage-card bcv-stage-card--${status}`}>
      <div className="bcv-stage-icon">
        {status === 'done' && <Icon name="check" size={16} />}
        {status === 'active' && <span className="bcv-spinner" />}
        {status === 'error' && <Icon name="close" size={16} />}
        {status === 'pending' && <span className="bcv-stage-dot" />}
      </div>
      <div className="bcv-stage-label">{info.label}</div>
      <div className="bcv-stage-desc">{info.desc}</div>
    </div>
  )
}

// ============================================================
// BuildCharacterView 主体
// ============================================================

interface BuildCharacterViewProps {
  /** 完成后跳回素材库，可选传新角色 charId */
  onBack: (newCharId?: string) => void
}

export default function BuildCharacterView({ onBack }: BuildCharacterViewProps) {
  // ---- 表单状态 ----
  const [charName, setCharName] = useState<string>('')
  const [silenceLen, setSilenceLen] = useState<number>(0.8)
  const [audioFiles, setAudioFiles] = useState<File[]>([])
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [enableLlmTagging, setEnableLlmTagging] = useState<boolean>(true)
  const [language, setLanguage] = useState<AsrLanguage>('zh')

  // ---- 完成总览状态 ----
  const [emotionDist, setEmotionDist] = useState<Map<EmotionPrimary, number>>(new Map())
  const [newCharId, setNewCharId] = useState<string | null>(null)

  const audioInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const { build, state, reset } = useBuildCharacter()

  const isRunning = state.status === 'running' && (state.progress > 0 || state.msg !== '')
  const isDone = state.done && !state.error
  const isError = !!state.error

  // 完成后拉取角色详情统计情绪分布
  useEffect(() => {
    if (isDone && state.charId) {
      setNewCharId(state.charId)
      getCharacterDetails(state.charId)
        .then((detail) => {
          const dist = new Map<EmotionPrimary, number>()
          for (const item of detail.items) {
            const p = item.emotion?.primary ?? item.emotion_primary
            if (p) dist.set(p, (dist.get(p) ?? 0) + 1)
          }
          setEmotionDist(dist)
        })
        .catch(() => {
          // 情绪分布加载失败不影响主流程
        })
    }
  }, [isDone, state.charId])

  // ---- 表单处理 ----
  const handleAudioChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setAudioFiles((prev) => {
      // 合并到已有列表，避免重复（按文件名 + 大小去重）
      const existing = new Set(prev.map((f) => `${f.name}_${f.size}`))
      const newFiles = files.filter((f) => !existing.has(`${f.name}_${f.size}`))
      return [...prev, ...newFiles]
    })
    e.target.value = ''
  }, [])

  const handleAudioDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(f.name)
    )
    if (files.length === 0) return
    setAudioFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}_${f.size}`))
      const newFiles = files.filter((f) => !existing.has(`${f.name}_${f.size}`))
      return [...prev, ...newFiles]
    })
  }, [])

  const handleRemoveFile = useCallback((idx: number) => {
    setAudioFiles((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const handleAvatarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setAvatarFile(file)
    if (file) {
      const url = URL.createObjectURL(file)
      setAvatarPreview(url)
    } else {
      setAvatarPreview(null)
    }
  }, [])

  // ---- 返回 / 中断 ----
  const handleBack = useCallback(() => {
    if (isRunning) {
      if (!window.confirm('处理中，确定要中断并返回吗？')) return
    }
    onBack()
  }, [isRunning, onBack])

  // ---- 提交 ----
  const handleSubmit = useCallback(async () => {
    if (audioFiles.length === 0 || !charName.trim() || isRunning) return
    try {
      await build({
        charName: charName.trim(),
        audioFiles,
        avatar: avatarFile ?? undefined,
        minSilenceLen: silenceLen,
        enableLlmTagging,
        language,
      })
    } catch {
      // 错误已在 state 中展示
    }
  }, [audioFiles, charName, avatarFile, silenceLen, enableLlmTagging, language, isRunning, build])

  // ---- 重试 ----
  const handleRetry = useCallback(() => {
    reset()
  }, [reset])

  // ---- 完成后进入详情 ----
  const handleGoDetail = useCallback(() => {
    if (newCharId) onBack(newCharId)
  }, [newCharId, onBack])

  // ---- 继续新建 ----
  const handleNewAnother = useCallback(() => {
    reset()
    setCharName('')
    setSilenceLen(0.8)
    setAudioFiles([])
    setAvatarFile(null)
    setAvatarPreview(null)
    setEnableLlmTagging(true)
    setLanguage('zh')
    setEmotionDist(new Map())
    setNewCharId(null)
  }, [reset])

  const canSubmit = audioFiles.length > 0 && charName.trim() !== '' && !isRunning && !isDone

  // ---- 阶段状态推断（基于 stage 字段）----
  const stageStatuses = STAGES.map((s) =>
    deriveStageStatus(s.key, state.stage ?? null, isError, isDone)
  )

  // ---- 拖拽区视觉状态 ----
  const [isDragOver, setIsDragOver] = useState(false)

  return (
    <div className="bcv">
      {/* 顶部条 */}
      <div className="bcv-topbar">
        <button className="bcv-back-btn" onClick={handleBack}>
          <Icon name="chev-left" size={16} />
          返回素材库
        </button>
        <div className="bcv-topbar-title">新建角色</div>
        <div className="bcv-topbar-spacer" />
      </div>

      <div className="bcv-content">
        {/* 卡片 1：配置区 */}
        <div className={`bcv-card${isRunning || isDone ? ' bcv-card--faded' : ''}`}>
          <div className="bcv-card-title">角色配置</div>

          {/* 角色名 + 头像 */}
          <div className="bcv-row bcv-row--top">
            <div className="bcv-field bcv-field--grow">
              <label className="bcv-label">角色名称 *</label>
              <input
                type="text"
                className="bcv-input"
                placeholder="例如：霸气总裁、温柔姐姐..."
                value={charName}
                onChange={(e) => setCharName(e.target.value)}
                disabled={isRunning || isDone}
              />
            </div>
            <div className="bcv-field bcv-field--avatar">
              <label className="bcv-label">头像（可选）</label>
              <div
                className="bcv-avatar-btn"
                onClick={() => !isRunning && !isDone && avatarInputRef.current?.click()}
                title="点击上传头像"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} className="bcv-avatar-img" alt="头像预览" />
                ) : (
                  <Icon name="image" size={20} style={{ color: 'var(--ink-3)' }} />
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
                disabled={isRunning || isDone}
              />
            </div>
          </div>

          {/* 拖拽上传区 */}
          <div className="bcv-field">
            <label className="bcv-label">原始音频 * （支持拖拽，可多文件）</label>
            <div
              className={`bcv-drop-area${isDragOver ? ' bcv-drop-area--over' : ''}${isRunning || isDone ? ' bcv-drop-area--disabled' : ''}`}
              onClick={() => !isRunning && !isDone && audioInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => { setIsDragOver(false); if (!isRunning && !isDone) handleAudioDrop(e) }}
            >
              <Icon name="mic" size={28} style={{ color: 'var(--ink-3)', marginBottom: '8px' }} />
              {audioFiles.length > 0 ? (
                <span className="bcv-drop-count">已选 {audioFiles.length} 个文件</span>
              ) : (
                <span className="bcv-drop-hint">点击或拖拽音频到此处（mp3 / wav / flac…）</span>
              )}
            </div>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleAudioChange}
              disabled={isRunning || isDone}
            />

            {/* 已选文件列表 */}
            {audioFiles.length > 0 && (
              <div className="bcv-file-list">
                {audioFiles.map((f, i) => (
                  <div key={i} className="bcv-file-item">
                    <Icon name="file" size={12} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                    <span className="bcv-file-name">{f.name}</span>
                    {!isRunning && !isDone && (
                      <button
                        className="bcv-file-del"
                        onClick={() => handleRemoveFile(i)}
                        title="移除"
                      >
                        <Icon name="close" size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 底部参数行 */}
          <div className="bcv-row bcv-row--params">
            <div className="bcv-field bcv-field--narrow">
              <label className="bcv-label">
                切片灵敏度
                <span className="bcv-label-hint">（秒，越小切越细）</span>
              </label>
              <input
                type="number"
                className="bcv-input bcv-input--number"
                min={0.1}
                max={2.0}
                step={0.1}
                value={silenceLen}
                onChange={(e) => setSilenceLen(parseFloat(e.target.value))}
                disabled={isRunning || isDone}
              />
            </div>
            <div className="bcv-field bcv-field--narrow">
              <label className="bcv-label">
                转写语种
                <span className="bcv-label-hint">（参考音的语言）</span>
              </label>
              <select
                className="bcv-input bcv-input--select"
                value={language}
                onChange={(e) => setLanguage(e.target.value as AsrLanguage)}
                disabled={isRunning || isDone}
              >
                {ASR_LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="bcv-field bcv-field--toggle">
              <label className="bcv-label">AI 情绪打标</label>
              <button
                className={`bcv-toggle${enableLlmTagging ? ' bcv-toggle--on' : ''}`}
                onClick={() => !isRunning && !isDone && setEnableLlmTagging((v) => !v)}
                disabled={isRunning || isDone}
                title={enableLlmTagging ? '已开启 LLM 情绪打标' : '已关闭 LLM 情绪打标（仅切片 + ASR）'}
              >
                <span className="bcv-toggle-thumb" />
                <span className="bcv-toggle-label">{enableLlmTagging ? '开' : '关'}</span>
              </button>
            </div>
            <div className="bcv-field bcv-field--submit">
              <button
                className="btn-primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {isRunning ? (
                  <>
                    <span className="bcv-spinner bcv-spinner--sm" />
                    处理中...
                  </>
                ) : '开始全自动处理'}
              </button>
            </div>
          </div>
        </div>

        {/* 卡片 2：处理进度（提交后显示） */}
        {(isRunning || isDone || isError) && (
          <div className="bcv-card">
            <div className="bcv-card-title">处理进度</div>

            {/* 四阶段卡片 */}
            <div className="bcv-stages">
              {STAGES.map((s, i) => (
                <StageCard key={s.key} info={s} status={stageStatuses[i]} />
              ))}
            </div>

            {/* 总进度条 */}
            <div className="bcv-progress-bar-track">
              <div
                className={`bcv-progress-bar-fill${isError ? ' bcv-progress-bar-fill--error' : ''}`}
                style={{ width: `${state.progress}%` }}
              />
            </div>
            <div className={`bcv-progress-info`}>
              <span className={`bcv-progress-msg${isError ? ' bcv-progress-msg--error' : ''}`}>
                {state.error ?? state.msg}
              </span>
              <span className="bcv-progress-pct">{state.progress}%</span>
            </div>

            {/* 错误 banner + 重试 */}
            {isError && (
              <div className="bcv-error-banner">
                <Icon name="cancel" size={16} />
                <span>处理失败：{state.error}</span>
                <button className="btn-soft bcv-retry-btn" onClick={handleRetry}>
                  重试
                </button>
              </div>
            )}
          </div>
        )}

        {/* 卡片 3：完成总览（done 后显示） */}
        {isDone && (
          <div className="bcv-card bcv-card--done">
            <div className="bcv-card-title">
              <Icon name="check" size={16} style={{ color: 'var(--signal-ok)', marginRight: '6px' }} />
              处理完成
            </div>
            <div className="bcv-done-summary">
              <div className="bcv-done-row">
                <Icon name="library" size={14} style={{ color: 'var(--ink-3)' }} />
                <span>
                  成功处理 <strong>{emotionDist.size > 0
                    ? Array.from(emotionDist.values()).reduce((a, b) => a + b, 0)
                    : '—'}</strong> 段素材
                </span>
              </div>

              {emotionDist.size > 0 && (
                <div className="bcv-emo-dist">
                  <span className="bcv-emo-dist-label">情绪分布：</span>
                  <div className="bcv-emo-chips">
                    {Array.from(emotionDist.entries()).map(([emo, count]) => (
                      <span key={emo} className="bcv-emo-chip">
                        {emo} {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="bcv-done-actions">
              <button className="btn-primary" onClick={handleGoDetail}>
                进入角色详情
              </button>
              <button className="btn-soft" onClick={handleNewAnother}>
                继续新建另一个
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
