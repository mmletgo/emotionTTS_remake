/**
 * Business Logic:
 *   底部固定 mini player，展示当前合成结果的试听控制，
 *   包括封面、标题、进度条、播放/暂停和快进/快退。
 *
 * Code Logic:
 *   网易云音乐风格三列布局：左侧信息、中间进度控制、右侧动作按钮。
 *   当 playerSrc 为 null 时进入 idle 状态（半透明）。
 *   使用 HTML audio 元素驱动真实播放；进度拖拽通过 onMouseDown + mousemove 实现。
 */

import { useRef, useState, useEffect, useCallback } from 'react'
import './BottomPlayer.css'
import Icon from '../icons/Icon'
import type { Character } from '@/api/types'
import Avatar from './Avatar'

interface BottomPlayerProps {
  src: string | null
  title: string
  sub: string
  playing: boolean
  activeChar: Character | null
  onPlayingChange: (playing: boolean) => void
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function BottomPlayer({
  src,
  title,
  sub,
  playing,
  activeChar,
  onPlayingChange,
}: BottomPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(0)

  const isIdle = src === null

  // Sync playing state with audio element
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [playing])

  // Update src
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (src) {
      audio.src = src
      if (playing) audio.play().catch(() => {})
    } else {
      audio.pause()
      audio.src = ''
    }
  }, [src]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) setDuration(audioRef.current.duration)
  }, [])

  const handleEnded = useCallback(() => {
    onPlayingChange(false)
    setCurrentTime(0)
  }, [onPlayingChange])

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!trackRef.current || !audioRef.current || duration === 0) return
      const rect = trackRef.current.getBoundingClientRect()
      const pct = (e.clientX - rect.left) / rect.width
      const newTime = pct * duration
      audioRef.current.currentTime = newTime
      setCurrentTime(newTime)
    },
    [duration]
  )

  const handleSkip = useCallback(
    (delta: number) => {
      if (!audioRef.current) return
      const newTime = Math.max(0, Math.min(duration, (audioRef.current.currentTime || 0) + delta))
      audioRef.current.currentTime = newTime
      setCurrentTime(newTime)
    },
    [duration]
  )

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`player${isIdle ? ' is-idle' : ''}`}>
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      {/* Left: cover + info */}
      <div className="player__now">
        <Avatar char={activeChar} className="player__cover" fallbackText="E" />
        <div className="player__info">
          <div className="player__title">{title || '暂无合成结果'}</div>
          <div className="player__sub">{sub || '合成后在此播放'}</div>
        </div>
      </div>

      {/* Center: transport + progress bar */}
      <div className="player__progress">
        <div className="player__controls">
          <button
            className="icon-btn"
            title="后退 5s"
            onClick={() => handleSkip(-5)}
          >
            <Icon name="skip-back" size={14} />
          </button>
          <button
            className="icon-btn icon-btn--play"
            title={playing ? '暂停' : '播放'}
            onClick={() => onPlayingChange(!playing)}
          >
            <Icon name={playing ? 'pause' : 'play'} size={14} />
          </button>
          <button
            className="icon-btn"
            title="前进 5s"
            onClick={() => handleSkip(5)}
          >
            <Icon name="skip-fwd" size={14} />
          </button>
        </div>

        <div className="player__bar">
          <span className="time">{formatTime(currentTime)}</span>
          <div
            className="player__track"
            ref={trackRef}
            onClick={handleTrackClick}
          >
            <div className="player__fill" style={{ width: `${progress}%` }} />
            <div className="player__knob" style={{ left: `${progress}%` }} />
          </div>
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: actions */}
      <div className="player__actions">
        <button className="icon-btn" title="下载">
          <Icon name="download" size={14} />
        </button>
        <button className="icon-btn" title="重新生成">
          <Icon name="refresh" size={14} />
        </button>
        <button className="icon-btn" title="历史">
          <Icon name="list" size={14} />
        </button>
      </div>
    </div>
  )
}
