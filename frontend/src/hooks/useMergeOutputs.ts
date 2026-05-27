/**
 * Business Logic:
 *   长文本模式下用户希望把所有已合成的段落合并成一个完整长音频下载，
 *   而不是 ZIP 包。调用后端 /api/outputs/merge 接口。
 *
 * Code Logic:
 *   接收 audio_url 列表，POST 到 mergeOutputs，返回合并后的 audio_url；
 *   下载时用 <a> 标签触发浏览器保存。
 */

import { useCallback, useState } from 'react'
import { mergeOutputs } from '@/api/client'

interface UseMergeOutputsResult {
  run: (audioUrls: string[]) => Promise<string>
  loading: boolean
  error: string | null
}

export function useMergeOutputs(): UseMergeOutputsResult {
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Business Logic:
   *   合并多段已合成的音频文件，并触发浏览器下载。
   *
   * Code Logic:
   *   POST /api/outputs/merge，拿到 audio_url 后创建 <a> 标签点击下载，
   *   返回 audio_url 给调用方备用。
   */
  const run = useCallback(async (audioUrls: string[]): Promise<string> => {
    if (audioUrls.length === 0) throw new Error('没有可合并的音频')
    setLoading(true)
    setError(null)
    try {
      const res = await mergeOutputs(audioUrls)
      const url = res.audio_url
      // 触发下载
      const a = document.createElement('a')
      a.href = url
      a.download = `merged_${Date.now()}.wav`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      return url
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { run, loading, error }
}
