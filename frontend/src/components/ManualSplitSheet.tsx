/**
 * Business Logic（为什么需要这个函数）:
 *   用户发现自动切分的片段切割点不准确，需要通过试听音频后手动在指定时间点切分。
 *
 * Code Logic（这个函数做什么）:
 *   Sheet 内嵌 audio 元素，播放时实时显示当前时间点，
 *   用户点击"在此处一分为二"按钮时调用 useManualSplit hook，
 *   完成后回调 onDone 刷新详情。
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import './ManualSplitSheet.css'
import Icon from '../icons/Icon'
import { useManualSplit } from '@/hooks/useManualSplit'

interface ManualSplitSheetProps {
  open: boolean
  charId: string
  itemId: number
  filename: string
  onClose: () => void
  onDone: () => void
}

export default function ManualSplitSheet({
  open,
  charId,
  itemId,
  filename,
  onClose,
  onDone,
}: ManualSplitSheetProps) {
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const { split, loading, error } = useManualSplit()

  // 每次打开时重置时间
  useEffect(() => {
    if (open) {
      setCurrentTime(0)
      setDuration(0)
    } else {
      audioRef.current?.pause()
    }
  }, [open])

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime)
    }
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration)
    }
  }, [])

  const handleSplit = useCallback(async () => {
    if (currentTime <= 0.5) return
    try {
      await split(charId, itemId, currentTime)
      audioRef.current?.pause()
      onDone()
      onClose()
    } catch {
      // 错误在 state 中展示
    }
  }, [charId, itemId, currentTime, split, onDone, onClose])

  const handleClose = useCallback(() => {
    audioRef.current?.pause()
    onClose()
  }, [onClose])

  // 规范化 filename（Windows 反斜杠处理）
  const normalizedFilename = filename.replace(/\\/g, '/')
  const audioSrc = `/characters/${charId}/${normalizedFilename}?t=${Date.now()}`

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const canSplit = currentTime > 0.5 && !loading

  return (
    <>
      <div className="scrim" data-open={open ? 'true' : 'false'} onClick={handleClose} />
      <aside className="sheet split-sheet" data-open={open ? 'true' : 'false'} role="dialog" aria-modal="true">
        <div className="sheet__head">
          <div>
            <div className="sheet__title">可视化切割</div>
            <div className="sheet__subtitle">播放音频，在合适位置点击切割</div>
          </div>
          <button className="icon-btn" onClick={handleClose} aria-label="关闭" disabled={loading}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="sheet__body">
          {/* 音频播放器 */}
          <div className="split-player">
            <audio
              ref={audioRef}
              src={audioSrc}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              controls
              style={{ width: '100%' }}
            />
          </div>

          {/* 时间轴可视化 */}
          {duration > 0 && (
            <div className="split-timeline">
              <div className="split-timeline-bar">
                <div
                  className="split-timeline-progress"
                  style={{ width: `${progressPct}%` }}
                />
                <div
                  className="split-timeline-cursor"
                  style={{ left: `${progressPct}%` }}
                />
              </div>
              <div className="split-timeline-labels">
                <span className="split-time-display">
                  {formatTime(currentTime)}
                </span>
                <span className="split-duration">
                  / {formatTime(duration)}
                </span>
              </div>
            </div>
          )}

          {/* 说明 */}
          <div className="split-hint">
            <Icon name="scissors" size={14} style={{ color: 'var(--ink-3)' }} />
            播放到你认为该切割的位置，点击下方按钮在当前时间点一分为二
          </div>

          {currentTime <= 0.5 && currentTime > 0 && (
            <div className="split-warn">下刀点太靠前，请继续播放</div>
          )}

          {error && (
            <div className="split-error">{error}</div>
          )}
        </div>

        <div className="sheet__foot">
          <button className="btn-soft" onClick={handleClose} disabled={loading}>取消</button>
          <button
            className="btn-primary btn-primary--sm"
            onClick={handleSplit}
            disabled={!canSplit}
          >
            <Icon name="scissors" size={14} />
            在 {formatTime(currentTime)} 处一分为二
          </button>
        </div>
      </aside>
    </>
  )
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(2)
  return `${m}:${s.padStart(5, '0')}`
}
