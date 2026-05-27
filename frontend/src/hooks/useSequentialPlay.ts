/**
 * Business Logic:
 *   长文本模式下需要把所有已合成的段落按顺序连续播放，
 *   播放到每段时高亮当前段落，播完自动跳下一段，
 *   用户可以中途点击停止。
 *
 * Code Logic:
 *   维护一个 Audio 实例和当前播放 index。
 *   play() 接收 url 列表和 onPlay/onEnd 回调。
 *   每次 audio.ended 时递增 index 并播放下一条。
 *   stop() 暂停并清空队列。
 */

import { useCallback, useRef, useState } from 'react'

export interface SequentialPlayItem {
  url: string
  segId: number
}

interface UseSequentialPlayResult {
  playing: boolean
  currentSegId: number | null
  play: (items: SequentialPlayItem[], onAuditioned?: (segId: number) => void) => void
  stop: () => void
}

export function useSequentialPlay(): UseSequentialPlayResult {
  const [playing, setPlaying] = useState<boolean>(false)
  const [currentSegId, setCurrentSegId] = useState<number | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<SequentialPlayItem[]>([])
  const indexRef = useRef<number>(0)
  const onAuditionedRef = useRef<((segId: number) => void) | undefined>(undefined)

  /**
   * Business Logic:
   *   内部递归播放下一条，每次播放时通知外部哪个 seg 正在播，
   *   并在播完时标记 auditioned。
   *
   * Code Logic:
   *   从 queueRef 取当前 index 的 item，设置 audio.src 并 play()；
   *   ended 事件里 index++ 再调自身。
   */
  const playAt = useCallback((index: number) => {
    const queue = queueRef.current
    if (index >= queue.length) {
      setPlaying(false)
      setCurrentSegId(null)
      return
    }
    const item = queue[index]
    indexRef.current = index

    if (!audioRef.current) {
      audioRef.current = new Audio()
    }
    const audio = audioRef.current
    audio.src = item.url
    setCurrentSegId(item.segId)

    if (onAuditionedRef.current) {
      onAuditionedRef.current(item.segId)
    }

    const handleEnded = (): void => {
      audio.removeEventListener('ended', handleEnded)
      playAt(index + 1)
    }
    audio.addEventListener('ended', handleEnded)

    audio.play().catch(() => {
      audio.removeEventListener('ended', handleEnded)
      playAt(index + 1)
    })
  }, [])

  /**
   * Business Logic:
   *   开始顺序播放一批段落音频。
   *
   * Code Logic:
   *   初始化队列和 index，设置 playing=true，从 0 开始播。
   */
  const play = useCallback((items: SequentialPlayItem[], onAuditioned?: (segId: number) => void) => {
    if (items.length === 0) return

    // 停止当前播放
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    queueRef.current = items
    indexRef.current = 0
    onAuditionedRef.current = onAuditioned
    setPlaying(true)
    setCurrentSegId(null)
    playAt(0)
  }, [playAt])

  /**
   * Business Logic:
   *   用户点击停止按钮时调用。
   *
   * Code Logic:
   *   暂停 audio，清空队列，重置状态。
   */
  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    queueRef.current = []
    indexRef.current = 0
    setPlaying(false)
    setCurrentSegId(null)
  }, [])

  return { playing, currentSegId, play, stop }
}
