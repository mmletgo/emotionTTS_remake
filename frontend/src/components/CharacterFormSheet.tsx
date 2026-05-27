/**
 * Business Logic（为什么需要这个函数）:
 *   用户在角色详情页需要补充更多音频素材（追加流程）。
 *   新建角色已迁移到独立全屏 BuildCharacterView，本 Sheet 只保留 append 模式。
 *
 * Code Logic（这个函数做什么）:
 *   仅展示追加音频的表单：音频上传 + 切片灵敏度 + AI 情绪打标开关 + 进度条。
 *   调用 useAppendCharacter hook，完成后回调 onDone()，供父组件刷新详情。
 */

import { useState, useRef, useCallback } from 'react'
import './CharacterFormSheet.css'
import Icon from '../icons/Icon'
import { useAppendCharacter } from '@/hooks/useAppendCharacter'

interface CharacterFormSheetProps {
  open: boolean
  /** 目标角色的 ID */
  charId: string
  onClose: () => void
  /** 追加完成后回调 */
  onDone: () => void
}

export default function CharacterFormSheet({
  open,
  charId,
  onClose,
  onDone,
}: CharacterFormSheetProps) {
  const [silenceLen, setSilenceLen] = useState<number>(0.8)
  const [audioFiles, setAudioFiles] = useState<File[]>([])
  const [enableLlmTagging, setEnableLlmTagging] = useState<boolean>(true)

  const audioInputRef = useRef<HTMLInputElement>(null)

  const { append, state, reset } = useAppendCharacter()

  const isRunning = state.status === 'running' && (state.progress > 0 || state.msg !== '')

  const handleAudioChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setAudioFiles(files)
  }, [])

  const handleClose = useCallback(() => {
    if (isRunning) return
    setAudioFiles([])
    setSilenceLen(0.8)
    setEnableLlmTagging(true)
    reset()
    if (audioInputRef.current) audioInputRef.current.value = ''
    onClose()
  }, [isRunning, reset, onClose])

  const handleSubmit = useCallback(async () => {
    if (audioFiles.length === 0 || !charId) return
    try {
      await append({
        charId,
        audioFiles,
        minSilenceLen: silenceLen,
        enableLlmTagging,
      })
      onDone()
      handleClose()
    } catch {
      // 错误已在 state 中展示
    }
  }, [audioFiles, charId, silenceLen, enableLlmTagging, append, onDone, handleClose])

  const canSubmit = audioFiles.length > 0 && !isRunning

  return (
    <>
      <div className="scrim" data-open={open ? 'true' : 'false'} onClick={handleClose} />
      <aside className="sheet char-form-sheet" data-open={open ? 'true' : 'false'} role="dialog" aria-modal="true">
        <div className="sheet__head">
          <div>
            <div className="sheet__title">补充音频</div>
            <div className="sheet__subtitle">追加更多音频素材到当前角色</div>
          </div>
          <button className="icon-btn" onClick={handleClose} aria-label="关闭" disabled={isRunning}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="sheet__body">
          {/* 音频上传 */}
          <div className="form-field">
            <label className="form-label">原始音频 *（可多选）</label>
            <div
              className="form-drop-area"
              onClick={() => audioInputRef.current?.click()}
            >
              <Icon name="mic" size={24} style={{ color: 'var(--ink-3)', marginBottom: '8px' }} />
              {audioFiles.length > 0 ? (
                <span className="form-file-count">已选 {audioFiles.length} 个文件</span>
              ) : (
                <span className="form-drop-hint">点击选择音频文件（mp3/wav/flac…）</span>
              )}
            </div>
            {audioFiles.length > 0 && (
              <div className="form-file-list">
                {audioFiles.map((f, i) => (
                  <div key={i} className="form-file-item">
                    <Icon name="file" size={12} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                    <span className="form-file-item-name">{f.name}</span>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleAudioChange}
              disabled={isRunning}
            />
          </div>

          {/* 切片灵敏度 */}
          <div className="form-field">
            <label className="form-label">
              句子切割灵敏度
              <span className="form-label-hint">数值越小切得越细，默认 0.8</span>
            </label>
            <input
              type="number"
              className="form-input form-input-number"
              min={0.1}
              max={2.0}
              step={0.1}
              value={silenceLen}
              onChange={(e) => setSilenceLen(parseFloat(e.target.value))}
              disabled={isRunning}
            />
          </div>

          {/* AI 情绪打标开关 */}
          <div className="form-field">
            <label className="form-label">AI 情绪打标</label>
            <div className="form-toggle-row">
              <button
                className={`form-toggle${enableLlmTagging ? ' form-toggle--on' : ''}`}
                onClick={() => !isRunning && setEnableLlmTagging((v) => !v)}
                disabled={isRunning}
                type="button"
              >
                <span className="form-toggle-thumb" />
              </button>
              <span className="form-toggle-hint">
                {enableLlmTagging ? '开启：追加后自动运行 LLM 情绪分析' : '关闭：仅切片 + Whisper 转写，跳过情绪打标'}
              </span>
            </div>
          </div>

          {/* 进度条 */}
          {(isRunning || state.done) && (
            <div className="form-progress">
              <div className="form-progress-bar-track">
                <div
                  className="form-progress-bar-fill"
                  style={{ width: `${state.progress}%` }}
                  data-status={state.status}
                />
              </div>
              <div className={`form-progress-msg${state.error ? ' is-error' : ''}`}>
                {state.error ?? state.msg}
              </div>
            </div>
          )}
        </div>

        <div className="sheet__foot">
          <button className="btn-soft" onClick={handleClose} disabled={isRunning}>
            取消
          </button>
          <button
            className="btn-primary btn-primary--sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isRunning ? (
              <>
                <span className="form-spinner" />
                处理中...
              </>
            ) : '开始追加处理'}
          </button>
        </div>
      </aside>
    </>
  )
}
