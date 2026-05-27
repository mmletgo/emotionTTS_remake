/**
 * Business Logic:
 *   前端独有的 UI 设置，与后端 config（LLM/TTS）无关，
 *   用 localStorage 持久化，无需经过后端接口。
 *
 * Code Logic:
 *   useUiSettings hook 在读取时从 localStorage 解析设置，
 *   update 时写回 localStorage 并触发 React state 更新。
 */

import { useCallback, useState } from 'react'

export interface UiSettings {
  silence_threshold: number
  min_text_length: number
  default_alpha: number
  api_priority: boolean
}

const STORAGE_KEY = 'emotts:ui_settings'

const DEFAULT_UI_SETTINGS: UiSettings = {
  silence_threshold: 0.8,
  min_text_length: 10,
  default_alpha: 0.6,
  api_priority: true,
}

/**
 * Business Logic:
 *   提供 silence_threshold / min_text_length / default_alpha / api_priority
 *   四项前端独有设置，SettingsView 通用分组使用此 hook 管理。
 *
 * Code Logic:
 *   初始化时从 localStorage 读取并合并默认值；
 *   update 函数接受 Partial<UiSettings> 做增量更新，并同步写入 localStorage。
 */
export function useUiSettings(): {
  settings: UiSettings
  update: (partial: Partial<UiSettings>) => void
} {
  const [settings, setSettings] = useState<UiSettings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        return { ...DEFAULT_UI_SETTINGS, ...(JSON.parse(raw) as Partial<UiSettings>) }
      }
    } catch {
      // ignore parse errors
    }
    return DEFAULT_UI_SETTINGS
  })

  const update = useCallback((partial: Partial<UiSettings>): void => {
    setSettings((prev) => {
      const next = { ...prev, ...partial }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors
      }
      return next
    })
  }, [])

  return { settings, update }
}
