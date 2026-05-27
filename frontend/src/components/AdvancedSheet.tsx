/**
 * Business Logic:
 *   高级模式浮层，实现四维 override 模型：参考音 / 情绪锁定 / 8 维情绪向量 / Alpha。
 *   每个维度可独立设置"AI 自动"（null）或"手动锁定"（具体值），互不干扰。
 *   浮层关闭时只保存状态，绝对不触发合成——合成由主界面"开始合成"按钮显式触发。
 *
 * Code Logic:
 *   接收外部传入的 overrides（四维当前 override 状态）和 llmCache（LLM 缓存），
 *   在浮层内展示每个维度的当前生效值（override 优先，否则 llmCache，否则默认占位）。
 *   每个维度都有"AI 自动 / 手动"徽章和"↺ 重置为 AI"按钮。
 *   参考音 section 内嵌调用 ReferencePickerSheet（二级 sheet）。
 *   底部"保存"按钮：将当前 overrides 回调给父组件并关闭，不触发合成。
 */

import { useState, useCallback, useEffect } from 'react'
import './AdvancedSheet.css'
import Icon from '../icons/Icon'
import ReferencePickerSheet from './ReferencePickerSheet'
import type { EmotionVector, LibraryItem } from '@/api/types'
import type { SegmentOverrides, SegmentLlmCache } from '@/utils/longText'

type EmotionPrimary = '喜' | '怒' | '哀' | '惧' | '厌' | '低落' | '惊' | '平'
type EmotionIntensity = 'Low' | 'Medium' | 'High'

const EMO_LABELS: EmotionPrimary[] = ['喜', '怒', '哀', '惧', '厌', '低落', '惊', '平']
const EMO_INTENSITIES: EmotionIntensity[] = ['Low', 'Medium', 'High']

/** 兼容旧版 AdvancedSettings 的形状，供 StudioView 内部使用 */
export interface AdvancedSettings {
  lockPrimary: '' | EmotionPrimary
  lockIntensity: EmotionIntensity
  lockComplex: string
  emoVector: EmotionVector
  emoAlpha: number
}

export const DEFAULT_SETTINGS: AdvancedSettings = {
  lockPrimary: '',
  lockIntensity: 'Medium',
  lockComplex: '',
  emoVector: [0.12, 0.00, 0.68, 0.08, 0.00, 0.42, 0.00, 0.18],
  emoAlpha: 0.55,
}

const DEFAULT_VECTOR: EmotionVector = [0.12, 0.00, 0.68, 0.08, 0.00, 0.42, 0.00, 0.18]
const DEFAULT_ALPHA = 0.55

interface AdvancedSheetProps {
  open: boolean
  /** 当前四维 override 状态（父组件维护） */
  overrides: SegmentOverrides
  /** LLM 最近一次匹配结果缓存（可为 null） */
  llmCache: SegmentLlmCache | null
  /** 角色的 library items，用于内嵌参考音 picker */
  libraryItems: LibraryItem[]
  /** 关闭浮层（不保存） */
  onClose: () => void
  /** 保存：用新 overrides 回调父组件，不触发合成 */
  onSave: (overrides: SegmentOverrides) => void
}

export default function AdvancedSheet({
  open,
  overrides,
  llmCache,
  libraryItems,
  onClose,
  onSave,
}: AdvancedSheetProps) {
  // 本地编辑副本：打开时从 props 同步
  const [localOverrides, setLocalOverrides] = useState<SegmentOverrides>(overrides)
  const [refPickerOpen, setRefPickerOpen] = useState(false)

  // 每次打开时同步最新 overrides
  useEffect(() => {
    if (open) {
      setLocalOverrides(overrides)
    }
  }, [open, overrides])

  // ── 参考音 section ──────────────────────────────────────────
  const handleRefSelect = useCallback((item: LibraryItem) => {
    setRefPickerOpen(false)
    setLocalOverrides((prev) => ({
      ...prev,
      ref: {
        filename: item.filename,
        audio_url: item.audio_url,
        emotion_primary: item.emotion_primary,
      },
    }))
  }, [])

  const resetRef = useCallback(() => {
    setLocalOverrides((prev) => ({ ...prev, ref: null }))
  }, [])

  // ── 情绪 section ─────────────────────────────────────────────
  const handleEmotionChange = useCallback(<K extends 'primary' | 'intensity' | 'complex'>(
    key: K,
    val: string,
  ) => {
    setLocalOverrides((prev) => ({
      ...prev,
      emotion: {
        primary: prev.emotion?.primary ?? (llmCache?.target_emotion?.primary ?? '平'),
        intensity: prev.emotion?.intensity ?? (llmCache?.target_emotion?.intensity ?? 'Medium'),
        complex: prev.emotion?.complex ?? (llmCache?.target_emotion?.complex ?? ''),
        [key]: val,
      },
    }))
  }, [llmCache])

  const resetEmotion = useCallback(() => {
    setLocalOverrides((prev) => ({ ...prev, emotion: null }))
  }, [])

  // ── 向量 section ─────────────────────────────────────────────
  const handleVecChange = useCallback((idx: number, val: number) => {
    setLocalOverrides((prev) => {
      const base = prev.vector ?? llmCache?.emo_vector ?? DEFAULT_VECTOR
      const next = [...base] as unknown as [number, number, number, number, number, number, number, number]
      next[idx] = val
      return { ...prev, vector: next }
    })
  }, [llmCache])

  const resetVector = useCallback(() => {
    setLocalOverrides((prev) => ({ ...prev, vector: null }))
  }, [])

  // ── Alpha section ────────────────────────────────────────────
  const handleAlphaChange = useCallback((val: number) => {
    setLocalOverrides((prev) => ({ ...prev, alpha: val }))
  }, [])

  const resetAlpha = useCallback(() => {
    setLocalOverrides((prev) => ({ ...prev, alpha: null }))
  }, [])

  // ── 保存 ─────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    onSave(localOverrides)
    onClose()
  }, [localOverrides, onSave, onClose])

  const handleScrimClick = useCallback(() => onClose(), [onClose])

  // ── 派生展示值 ───────────────────────────────────────────────
  // 当前生效的参考音（override 优先，否则 llmCache）
  const effectiveRef = localOverrides.ref ?? (llmCache ? {
    filename: llmCache.ref_audio_filename,
    audio_url: llmCache.ref_audio_url,
    emotion_primary: llmCache.target_emotion.primary,
  } : null)
  const refIsOverride = localOverrides.ref !== null

  // 当前生效的情绪
  const effectiveEmotion = localOverrides.emotion ?? llmCache?.target_emotion ?? null
  const emotionIsOverride = localOverrides.emotion !== null

  // 当前生效的向量（用于展示滑块）
  const effectiveVector = localOverrides.vector ?? llmCache?.emo_vector ?? DEFAULT_VECTOR
  const vectorIsOverride = localOverrides.vector !== null

  // 当前生效的 alpha
  const effectiveAlpha = localOverrides.alpha ?? llmCache?.emo_alpha ?? DEFAULT_ALPHA
  const alphaIsOverride = localOverrides.alpha !== null

  return (
    <>
      <div className="scrim" data-open={open ? 'true' : 'false'} onClick={handleScrimClick} />
      <aside className="sheet" data-open={open ? 'true' : 'false'} role="dialog" aria-modal="true">
        <div className="sheet__head">
          <div>
            <div className="sheet__title">高级模式</div>
            <div className="sheet__subtitle">手动覆盖 AI 匹配 · 留空跟随 AI</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="sheet__body">

          {/* ── 信号流示意（解释四个参数的层级关系） ────── */}
          <div className="adv-flow-card">
            <div className="adv-flow-row">
              <span className="adv-flow-chip adv-flow-chip--upstream">情绪锁定</span>
              <span className="adv-flow-arrow">约束</span>
              <span className="adv-flow-mid">AI 决策</span>
            </div>
            <div className="adv-flow-row">
              <span className="adv-flow-chip">参考音</span>
              <span className="adv-flow-op">+</span>
              <span className="adv-flow-chip">向量</span>
              <span className="adv-flow-op">×</span>
              <span className="adv-flow-chip">Alpha</span>
              <span className="adv-flow-arrow">合成引擎</span>
            </div>
            <div className="adv-flow-foot">
              参考音决定音色与自带情绪；向量 × Alpha 在其上叠加。同主情绪时 Alpha 自动 ×0.6 防爆音。
            </div>
          </div>

          {/* ── ① 上游约束 group ─────────────────────────── */}
          <div className="adv-stage adv-stage--upstream">
            <span className="adv-stage-num">①</span>
            <span className="adv-stage-label">上游约束</span>
            <span className="adv-stage-desc">影响 AI 决策，不直接进引擎</span>
          </div>

          {/* 情绪锁定 ───────────────────────────────────── */}
          <div className="adv-section">
            <div className="adv-section-head">
              <div className="adv-section-title">
                <h4>情绪锁定</h4>
                <span className="adv-section-role">约束 AI 怎么挑参考音 + 怎么生成向量</span>
              </div>
              <div className="adv-badges">
                <span className={`adv-badge${emotionIsOverride ? ' adv-badge--manual' : ' adv-badge--auto'}`}>
                  {emotionIsOverride ? '手动' : (llmCache ? 'AI 自动' : '未匹配')}
                </span>
                {emotionIsOverride && (
                  <button className="adv-reset-btn" onClick={resetEmotion} title="重置为 AI 自动">
                    ↺ 重置为 AI
                  </button>
                )}
              </div>
            </div>

            {!emotionIsOverride && effectiveEmotion && (
              <div className="adv-placeholder-hint">
                AI 诊断：{effectiveEmotion.primary} · {effectiveEmotion.intensity}
                {effectiveEmotion.complex && ` · ${effectiveEmotion.complex}`}
                <span className="adv-placeholder-sub">（操作下方控件即手动锁定）</span>
              </div>
            )}
            {!emotionIsOverride && !effectiveEmotion && (
              <div className="adv-placeholder-hint">尚未匹配，操作下方控件即手动锁定</div>
            )}

            <div className="adv-lock-row">
              <select
                className="adv-select"
                value={emotionIsOverride
                  ? (localOverrides.emotion?.primary ?? '')
                  : (effectiveEmotion?.primary ?? '')
                }
                onChange={(e) => handleEmotionChange('primary', e.target.value as EmotionPrimary)}
              >
                <option value="">（跟随 AI）</option>
                {EMO_LABELS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <select
                className="adv-select"
                value={emotionIsOverride
                  ? (localOverrides.emotion?.intensity ?? 'Medium')
                  : (effectiveEmotion?.intensity ?? 'Medium')
                }
                onChange={(e) => handleEmotionChange('intensity', e.target.value as EmotionIntensity)}
              >
                {EMO_INTENSITIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
              <input
                type="text"
                className="adv-input"
                placeholder="复合情绪：嘲讽、傲娇..."
                value={emotionIsOverride
                  ? (localOverrides.emotion?.complex ?? '')
                  : (effectiveEmotion?.complex ?? '')
                }
                onChange={(e) => handleEmotionChange('complex', e.target.value)}
              />
            </div>
            <div className="adv-field-note">
              intensity 仅为语义标签传给 LLM，实际张力由下方 Alpha 控制。
            </div>
          </div>

          {/* ── ② 下游信号 group ─────────────────────────── */}
          <div className="adv-stage adv-stage--signal">
            <span className="adv-stage-num">②</span>
            <span className="adv-stage-label">下游信号</span>
            <span className="adv-stage-desc">直接送进 TTS 引擎</span>
          </div>

          {/* 参考音 ─────────────────────────────────────── */}
          <div className="adv-section">
            <div className="adv-section-head">
              <div className="adv-section-title">
                <h4>参考音</h4>
                <span className="adv-section-role">音色 + 自带情绪底色</span>
              </div>
              <div className="adv-badges">
                <span className={`adv-badge${refIsOverride ? ' adv-badge--manual' : ' adv-badge--auto'}`}>
                  {refIsOverride ? '手动' : (llmCache ? 'AI 自动' : '未匹配')}
                </span>
                {refIsOverride && (
                  <button className="adv-reset-btn" onClick={resetRef} title="重置为 AI 自动">
                    ↺ 重置为 AI
                  </button>
                )}
              </div>
            </div>

            <div className="adv-ref-row">
              {effectiveRef ? (
                <div className={`adv-ref-card${refIsOverride ? ' is-manual' : ' is-auto'}`}>
                  <div className="adv-ref-info">
                    <span className="adv-ref-emo">{effectiveRef.emotion_primary}</span>
                    <span className="adv-ref-filename">{effectiveRef.filename}</span>
                  </div>
                  {effectiveRef.audio_url && (
                    <button
                      className="btn-icon btn-icon--sm"
                      title="试听参考音"
                      onClick={() => new Audio(effectiveRef.audio_url).play().catch(() => {})}
                    >
                      <Icon name="play" size={13} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="adv-ref-empty">尚未匹配 · 点击下方按钮手动指定</div>
              )}
              <button
                className="btn-chip btn-chip--sm"
                onClick={() => setRefPickerOpen(true)}
                disabled={libraryItems.length === 0}
              >
                <Icon name="library" size={13} />
                {refIsOverride ? '更换参考音' : '手动指定参考音'}
              </button>
            </div>
          </div>

          {/* 8 维情绪向量 ───────────────────────────────── */}
          <div className="adv-section">
            <div className="adv-section-head">
              <div className="adv-section-title">
                <h4>情绪向量（8 通道）</h4>
                <span className="adv-section-role">在参考音之上叠加情绪 · 各维 0–1</span>
              </div>
              <div className="adv-badges">
                <span className={`adv-badge${vectorIsOverride ? ' adv-badge--manual' : ' adv-badge--auto'}`}>
                  {vectorIsOverride ? '手动' : (llmCache?.emo_vector ? 'AI 自动' : '默认')}
                </span>
                {vectorIsOverride && (
                  <button className="adv-reset-btn" onClick={resetVector} title="重置为 AI 自动">
                    ↺ 重置为 AI
                  </button>
                )}
              </div>
            </div>

            <div className="emo-grid">
              {EMO_LABELS.map((label, idx) => (
                <div className="emo-cell" key={label}>
                  <label htmlFor={`emo-range-${idx}`}>{label}</label>
                  <input
                    id={`emo-range-${idx}`}
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round((effectiveVector[idx] ?? 0) * 100)}
                    onChange={(e) => handleVecChange(idx, parseInt(e.target.value, 10) / 100)}
                  />
                  <span className={`val${!vectorIsOverride ? ' val--auto' : ''}`}>
                    {(effectiveVector[idx] ?? 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="adv-field-note">建议各维总和 ≤ 0.8，超出易出现颤抖 / 过曝。</div>
          </div>

          {/* Alpha ──────────────────────────────────────── */}
          <div className="adv-section">
            <div className="adv-section-head">
              <div className="adv-section-title">
                <h4>Alpha · 向量混合强度</h4>
                <span className="adv-section-role">向量在参考音之上的叠加权重</span>
              </div>
              <div className="adv-badges">
                <span className={`adv-badge${alphaIsOverride ? ' adv-badge--manual' : ' adv-badge--auto'}`}>
                  {alphaIsOverride ? '手动' : (llmCache ? 'AI 自动' : '默认')}
                </span>
                {alphaIsOverride && (
                  <button className="adv-reset-btn" onClick={resetAlpha} title="重置为 AI 自动">
                    ↺ 重置为 AI
                  </button>
                )}
              </div>
            </div>

            <div className="adv-alpha-row">
              <input
                type="range"
                min="10"
                max="100"
                value={Math.round(effectiveAlpha * 100)}
                onChange={(e) => handleAlphaChange(parseInt(e.target.value, 10) / 100)}
                style={{ flex: 1 }}
              />
              <span className={`adv-alpha-val mono${!alphaIsOverride ? ' val--auto' : ''}`}>
                {effectiveAlpha.toFixed(2)}
              </span>
            </div>
            <div className="adv-field-note">
              默认 0.65。目标 / 参考主情绪相同时引擎自动 ×0.6 防爆音。
            </div>
          </div>

        </div>

        <div className="sheet__foot">
          <button className="btn-soft" onClick={onClose}>取消</button>
          <button
            className="btn-primary btn-primary--sm"
            onClick={handleSave}
          >
            保存
          </button>
        </div>
      </aside>

      {/* 二级 sheet：参考音选择 */}
      <ReferencePickerSheet
        open={refPickerOpen}
        items={libraryItems}
        selectedItemId={localOverrides.ref ? null : null}
        onClose={() => setRefPickerOpen(false)}
        onSelect={handleRefSelect}
      />
    </>
  )
}

