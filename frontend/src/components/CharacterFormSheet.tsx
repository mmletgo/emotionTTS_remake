/**
 * Business Logic（为什么需要这个函数）:
 *   用户需要新建角色或向已有角色补充音频素材。两种模式复用同一 Sheet 浮层，
 *   create 模式包含角色名称和头像，append 模式只需上传音频即可。
 *
 * Code Logic（这个函数做什么）:
 *   mode='create' 时展示角色名 + 头像 + 音频上传，调用 useBuildCharacter；
 *   mode='append' 时只展示音频上传，调用 useAppendCharacter；
 *   都有切片灵敏度(min_silence_len) + 进度条 + 状态文本。
 *   完成后回调 onDone(charId?)，供父组件刷新列表或跳转详情。
 */

import { useState, useRef, useCallback } from 'react'
import './CharacterFormSheet.css'
import Icon from '../icons/Icon'
import { useBuildCharacter } from '@/hooks/useBuildCharacter'
import { useAppendCharacter } from '@/hooks/useAppendCharacter'

export type CharacterFormMode = 'create' | 'append'

interface CharacterFormSheetProps {
  open: boolean
  mode: CharacterFormMode
  /** append 模式下，目标角色的 ID */
  charId?: string
  onClose: () => void
  /** 完成后回调，create 模式会传 charId，append 模式传 undefined */
  onDone: (charId?: string) => void
}

export default function CharacterFormSheet({
  open,
  mode,
  charId,
  onClose,
  onDone,
}: CharacterFormSheetProps) {
  const [charName, setCharName] = useState<string>('')
  const [silenceLen, setSilenceLen] = useState<number>(0.8)
  const [audioFiles, setAudioFiles] = useState<File[]>([])
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)

  const audioInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const { build, state: buildState, reset: resetBuild } = useBuildCharacter()
  const { append, state: appendState, reset: resetAppend } = useAppendCharacter()

  const state = mode === 'create' ? buildState : appendState
  const isRunning = state.status === 'running' && (state.progress > 0 || state.msg !== '')

  const handleAudioChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setAudioFiles(files)
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

  const handleClose = useCallback(() => {
    if (isRunning) return // 处理中不允许关闭
    setCharName('')
    setSilenceLen(0.8)
    setAudioFiles([])
    setAvatarFile(null)
    setAvatarPreview(null)
    resetBuild()
    resetAppend()
    if (audioInputRef.current) audioInputRef.current.value = ''
    if (avatarInputRef.current) avatarInputRef.current.value = ''
    onClose()
  }, [isRunning, resetBuild, resetAppend, onClose])

  const handleSubmit = useCallback(async () => {
    if (audioFiles.length === 0) return
    if (mode === 'create') {
      if (!charName.trim()) return
      try {
        const newCharId = await build({
          charName: charName.trim(),
          audioFiles,
          avatar: avatarFile ?? undefined,
          minSilenceLen: silenceLen,
        })
        onDone(newCharId)
        handleClose()
      } catch {
        // 错误已在 state 中展示
      }
    } else {
      if (!charId) return
      try {
        await append({
          charId,
          audioFiles,
          minSilenceLen: silenceLen,
        })
        onDone()
        handleClose()
      } catch {
        // 错误已在 state 中展示
      }
    }
  }, [mode, charName, audioFiles, avatarFile, silenceLen, charId, build, append, onDone, handleClose])

  const title = mode === 'create' ? '新建角色' : '补充音频'
  const subtitle = mode === 'create'
    ? '上传原始音频，AI 自动切片并分析情绪'
    : '追加更多音频素材到当前角色'
  const btnLabel = mode === 'create' ? '开始全自动切片与清洗' : '开始追加处理'
  const canSubmit = audioFiles.length > 0 && (mode === 'append' || charName.trim() !== '') && !isRunning

  return (
    <>
      <div className="scrim" data-open={open ? 'true' : 'false'} onClick={handleClose} />
      <aside className="sheet char-form-sheet" data-open={open ? 'true' : 'false'} role="dialog" aria-modal="true">
        <div className="sheet__head">
          <div>
            <div className="sheet__title">{title}</div>
            <div className="sheet__subtitle">{subtitle}</div>
          </div>
          <button className="icon-btn" onClick={handleClose} aria-label="关闭" disabled={isRunning}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="sheet__body">
          {/* 角色名称 (create only) */}
          {mode === 'create' && (
            <div className="form-field">
              <label className="form-label">角色名称 *</label>
              <input
                type="text"
                className="form-input"
                placeholder="例如：霸气总裁、温柔姐姐..."
                value={charName}
                onChange={(e) => setCharName(e.target.value)}
                disabled={isRunning}
              />
            </div>
          )}

          {/* 头像 (create only) */}
          {mode === 'create' && (
            <div className="form-field">
              <label className="form-label">角色头像（可选）</label>
              <div className="form-avatar-row">
                {avatarPreview ? (
                  <img src={avatarPreview} className="form-avatar-preview" alt="头像预览" />
                ) : (
                  <div className="form-avatar-placeholder" onClick={() => avatarInputRef.current?.click()}>
                    <Icon name="image" size={20} style={{ color: 'var(--ink-3)' }} />
                  </div>
                )}
                <div className="form-avatar-actions">
                  <button
                    className="btn-chip"
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={isRunning}
                  >
                    <Icon name="upload" size={13} /> {avatarFile ? '更换图片' : '选择图片'}
                  </button>
                  {avatarFile && (
                    <span className="form-file-name">{avatarFile.name}</span>
                  )}
                </div>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
                disabled={isRunning}
              />
            </div>
          )}

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
            ) : btnLabel}
          </button>
        </div>
      </aside>
    </>
  )
}
