/**
 * Business Logic:
 *   长文本批量合成后，用户希望把所有合成产物打包成 ZIP 一次下载，
 *   命名上要能从文件名认出每段的内容（用首字截断作为文件名前缀）。
 *
 * Code Logic:
 *   纯前端用 JSZip 拼包：逐个 fetch audio_url 拿 blob → zip.file() →
 *   generateAsync('blob') → URL.createObjectURL → 触发 <a download> 点击。
 *   文件路径里非法字符全部过滤；空串落到 fallback 名。
 */

import JSZip from 'jszip'

/**
 * Business Logic:
 *   音频文件名要从台词中截字片段，但操作系统对文件名有非法字符限制，
 *   而且台词太长会导致路径超限。需要净化并截断。
 *
 * Code Logic:
 *   去掉 \ / : * ? " < > | 等 OS 不允许的字符 + 换行 / 制表符；
 *   trim 后截前 24 个字符；为空时用 fallback。
 */
export function getSafeFilename(text: string, fallback: string): string {
  const cleaned = text.replace(/[\\/:*?"<>|\n\r\t]/g, '').trim().slice(0, 24)
  return cleaned || fallback
}

/**
 * Business Logic:
 *   把多段已合成的 audio 打包成单个 ZIP 文件触发浏览器下载，
 *   片段以 001_xxx.wav / 002_xxx.wav 编号命名，保留顺序。
 *
 * Code Logic:
 *   串行 fetch 每个 audio_url（避免并发拖慢），加入 JSZip；
 *   生成 zip Blob 后通过隐式 <a download> 触发下载；1s 后释放 ObjectURL。
 *   抛错向上传播让 UI 显示错误提示。
 */
export async function exportSegmentsAsZip(
  segs: ReadonlyArray<{ text: string; audio_url: string }>
): Promise<void> {
  if (segs.length === 0) return
  const zip = new JSZip()
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const safe = getSafeFilename(seg.text, `片段_${i + 1}`)
    const filename = `${String(i + 1).padStart(3, '0')}_${safe}.wav`
    const res = await fetch(seg.audio_url)
    if (!res.ok) throw new Error(`无法获取片段 ${i + 1} 的音频 (HTTP ${res.status})`)
    const blob = await res.blob()
    zip.file(filename, blob)
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' })
  const firstSafe = getSafeFilename(segs[0].text, '批量音频')
  triggerDownload(URL.createObjectURL(zipBlob), `${firstSafe}_等批量导出.zip`)
}

/**
 * Business Logic:
 *   多个地方都要触发浏览器下载（ZIP / 合并 WAV / 单段 WAV），抽公共函数。
 *
 * Code Logic:
 *   create + click + remove + 延迟 revoke ObjectURL（如果传的是 blob URL）。
 */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  if (url.startsWith('blob:')) {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
