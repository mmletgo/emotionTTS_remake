/**
 * Business Logic:
 *   设置视图，管理 LLM 提供商配置、ASR 语音识别配置、TTS 引擎配置和通用偏好，
 *   让用户无需编辑 config.json 文件就能调整系统行为。
 *
 * Code Logic:
 *   四个 Apple 风格分组（LLM / ASR / TTS / 通用）。
 *   后端配置（LLM / ASR / TTS）通过 useConfig hook 读写。
 *   前端独有设置（silence/min_text/alpha/api_priority）通过 useUiSettings 读写。
 *   主题和强调色通过 AppContext 的 setTheme / setAccent 驱动全局 CSS。
 */

import { useState, useCallback, useEffect } from 'react'
import './SettingsView.css'
import Icon from '../icons/Icon'
import { useConfig } from '@/hooks/useConfig'
import { useUiSettings } from '@/state/uiSettings'
import { useApp } from '@/state/AppContext'
import { ACCENT_SWATCHES } from '@/state/accentSwatches'
import { ASR_LANGUAGE_OPTIONS } from '@/api/types'
import type { AsrLanguage, LlmProvider } from '@/api/types'
import type { Theme } from '@/state/AppContext'

type TtsDeployType = 'local' | 'cloud'
type AsrDeployType = 'local' | 'cloud'

const LLM_PROVIDER_OPTIONS: { value: LlmProvider; label: string }[] = [
  { value: 'ollama', label: '本地 Ollama（默认）' },
  { value: 'siliconflow', label: '硅基流动' },
  { value: 'youzhi', label: '优云智算' },
  { value: 'deepseek', label: 'Deepseek 官方' },
  { value: 'custom', label: '自定义' },
]

function SegCtlSettings<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="seg-ctl-settings">
      {options.map((opt) => (
        <button
          key={opt.value}
          aria-pressed={value === opt.value ? 'true' : 'false'}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function SettingsView() {
  const { config, saving, save, testLlm, testTts, testAsr } = useConfig()
  const { settings: uiSettings, update: updateUi } = useUiSettings()
  const { theme, setTheme, accent, setAccent } = useApp()

  // LLM local state (populated from config)
  const [llmProvider, setLlmProvider] = useState<LlmProvider>('ollama')
  const [llmApiBase, setLlmApiBase] = useState<string>('http://127.0.0.1:11434/v1')
  const [llmApiKey, setLlmApiKey] = useState<string>('')
  const [llmModel, setLlmModel] = useState<string>('qwen2.5:7b')
  const [llmStatus, setLlmStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [llmStatusMsg, setLlmStatusMsg] = useState<string>('')
  const [llmTesting, setLlmTesting] = useState<boolean>(false)

  // ASR local state
  const [asrDeploy, setAsrDeploy] = useState<AsrDeployType>('local')
  const [asrApiBase, setAsrApiBase] = useState<string>('http://127.0.0.1:9900/v1')
  const [asrApiKey, setAsrApiKey] = useState<string>('')
  const [asrLanguage, setAsrLanguage] = useState<AsrLanguage>('zh')
  const [asrStatus, setAsrStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [asrStatusMsg, setAsrStatusMsg] = useState<string>('')
  const [asrTesting, setAsrTesting] = useState<boolean>(false)

  // TTS local state
  const [ttsDeploy, setTtsDeploy] = useState<TtsDeployType>('local')
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [ttsStatusMsg, setTtsStatusMsg] = useState<string>('')
  const [ttsTesting, setTtsTesting] = useState<boolean>(false)

  // 保存按钮反馈
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'err'>('idle')
  const [saveStatusMsg, setSaveStatusMsg] = useState<string>('')

  // Sync from config on load
  useEffect(() => {
    if (!config) return
    const activeType = config.llm.active_type
    setLlmProvider(activeType)
    const providerCfg = config.llm.configs[activeType]
    if (providerCfg) {
      setLlmApiBase(providerCfg.api_base)
      setLlmApiKey(providerCfg.api_key)
      setLlmModel(providerCfg.model)
    }
    setTtsDeploy(config.tts.type)
    if (config.asr) {
      setAsrDeploy(config.asr.type)
      setAsrApiBase(config.asr.api_base)
      setAsrApiKey(config.asr.api_key)
      // 兼容旧 config：language 缺失或非已知值时回落到 'zh'
      const knownLangs = ASR_LANGUAGE_OPTIONS.map((o) => o.value)
      const cfgLang = config.asr.language as AsrLanguage
      setAsrLanguage(knownLangs.includes(cfgLang) ? cfgLang : 'zh')
    }
  }, [config])

  const handleThemeChange = useCallback((t: Theme) => {
    setTheme(t)
  }, [setTheme])

  const handleAccentChange = useCallback((val: string) => {
    setAccent(val)
  }, [setAccent])

  const handleTestLlm = useCallback(async () => {
    setLlmTesting(true)
    const res = await testLlm({
      api_base: llmApiBase,
      api_key: llmApiKey,
      model: llmModel,
    })
    setLlmStatus(res.ok ? 'ok' : 'err')
    setLlmStatusMsg(res.msg)
    setLlmTesting(false)
  }, [testLlm, llmApiBase, llmApiKey, llmModel])

  const handleTestTts = useCallback(async () => {
    setTtsTesting(true)
    const res = await testTts({
      type: ttsDeploy,
      api_base: ttsDeploy === 'local' ? 'http://127.0.0.1:9800/v1' : '',
      api_key: '',
    })
    setTtsStatus(res.ok ? 'ok' : 'err')
    setTtsStatusMsg(res.msg)
    setTtsTesting(false)
  }, [testTts, ttsDeploy])

  const handleTestAsr = useCallback(async () => {
    setAsrTesting(true)
    const res = await testAsr({
      type: asrDeploy,
      api_base: asrApiBase,
      api_key: asrApiKey,
    })
    setAsrStatus(res.ok ? 'ok' : 'err')
    setAsrStatusMsg(res.msg)
    setAsrTesting(false)
  }, [testAsr, asrDeploy, asrApiBase, asrApiKey])

  const handleSave = useCallback(async () => {
    if (!config) return
    setSaveStatus('idle')
    setSaveStatusMsg('')
    // 把当前 provider 的字段塞回 llm_configs[llmProvider]，其它 provider 沿用 config 中已有值
    const mergedLlmConfigs = {
      ...config.llm.configs,
      [llmProvider]: { api_base: llmApiBase, api_key: llmApiKey, model: llmModel },
    }
    try {
      await save({
        llm_active_type: llmProvider,
        llm_configs: mergedLlmConfigs,
        tts: {
          type: ttsDeploy,
          api_base: ttsDeploy === 'local' ? 'http://127.0.0.1:9800/v1' : (config.tts.api_base ?? ''),
          api_key: config.tts.api_key ?? '',
        },
        asr: {
          type: asrDeploy,
          api_base: asrApiBase,
          api_key: asrApiKey,
          model: config.asr?.model ?? 'whisper-small',
          language: asrLanguage,
        },
      })
      setSaveStatus('ok')
      setSaveStatusMsg('已保存')
    } catch (err) {
      setSaveStatus('err')
      setSaveStatusMsg(err instanceof Error ? err.message : String(err))
    }
  }, [config, save, llmProvider, llmApiBase, llmApiKey, llmModel, ttsDeploy, asrDeploy, asrApiBase, asrApiKey, asrLanguage])

  const toggleApiPriority = useCallback(() => {
    updateUi({ api_priority: !uiSettings.api_priority })
  }, [uiSettings.api_priority, updateUi])

  // Determine active accent swatch value (may be full oklch() string or bare params)
  const activeAccentValue = ACCENT_SWATCHES.find((sw) => sw.value === accent)?.value ?? null

  return (
    <div>
      <div className="settings-title">设置</div>

      {/* LLM group */}
      <div className="settings-group">
        <div className="settings-group-head">
          <div className="settings-group-icon llm">
            <Icon name="sparkle" size={16} />
          </div>
          <div>
            <div className="settings-group-title">语言大模型</div>
            <div className="settings-group-subtitle">用于情感分析与参考音挑选的底层 LLM</div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-label">服务商</div>
          <div className="settings-value">
            <select
              className="settings-select"
              value={llmProvider}
              disabled={saving}
              onChange={(e) => setLlmProvider(e.target.value as LlmProvider)}
            >
              {LLM_PROVIDER_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">API Base URL</div>
          <div className="settings-value">
            <input
              type="text"
              className="settings-input"
              value={llmApiBase}
              placeholder="例如 http://127.0.0.1:11434/v1"
              disabled={saving}
              onChange={(e) => setLlmApiBase(e.target.value)}
            />
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">
            API Key
            <small>本地服务可留空</small>
          </div>
          <div className="settings-value">
            <input
              type="password"
              className="settings-input"
              value={llmApiKey}
              placeholder="留空或输入你的 Key"
              disabled={saving}
              onChange={(e) => setLlmApiKey(e.target.value)}
            />
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">模型名称</div>
          <div className="settings-value">
            <input
              type="text"
              className="settings-input"
              value={llmModel}
              placeholder="例如 qwen2.5:7b"
              disabled={saving}
              onChange={(e) => setLlmModel(e.target.value)}
            />
          </div>
          <div>
            <button
              className={`btn-test${llmStatus === 'ok' ? ' is-ok' : llmStatus === 'err' ? ' is-err' : ''}`}
              onClick={handleTestLlm}
              disabled={llmTesting}
            >
              {llmTesting ? '测试中…' : llmStatus === 'ok' ? '已连通' : '测试连通'}
            </button>
          </div>
        </div>
      </div>

      {/* ASR group */}
      <div className="settings-group">
        <div className="settings-group-head">
          <div className="settings-group-icon asr">
            <Icon name="transcribe" size={16} />
          </div>
          <div>
            <div className="settings-group-title">语音识别</div>
            <div className="settings-group-subtitle">音频转写服务（本地 Whisper 或云端 ASR）</div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-label">部署方式</div>
          <div className="settings-value">
            <SegCtlSettings<AsrDeployType>
              options={[
                { value: 'local', label: '本地' },
                { value: 'cloud', label: '远端' },
              ]}
              value={asrDeploy}
              onChange={setAsrDeploy}
            />
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">
            默认转写语种
            <small>新建/追加角色未指定时的兜底语种</small>
          </div>
          <div className="settings-value">
            <select
              className="settings-select"
              value={asrLanguage}
              style={{ maxWidth: '180px' }}
              disabled={saving}
              onChange={(e) => setAsrLanguage(e.target.value as AsrLanguage)}
            >
              {ASR_LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div />
        </div>

        {asrDeploy === 'local' ? (
          <div className="settings-row">
            <div className="settings-label">
              本地端口
              <small>需另开终端启动 asr_service</small>
            </div>
            <div className="settings-value mono">127.0.0.1:9900</div>
            <div>
              <button
                className={`btn-test${asrStatus === 'ok' ? ' is-ok' : asrStatus === 'err' ? ' is-err' : ''}`}
                onClick={handleTestAsr}
                disabled={asrTesting}
              >
                {asrTesting ? '检测中…' : asrStatus === 'ok' ? '服务在线' : '检测'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="settings-row">
              <div className="settings-label">API Base URL</div>
              <div className="settings-value">
                <input
                  type="text"
                  className="settings-input"
                  value={asrApiBase}
                  placeholder="例如 https://api.openai.com/v1"
                  disabled={saving}
                  onChange={(e) => setAsrApiBase(e.target.value)}
                />
              </div>
              <div />
            </div>
            <div className="settings-row">
              <div className="settings-label">
                API Key
                <small>云端服务必填</small>
              </div>
              <div className="settings-value">
                <input
                  type="password"
                  className="settings-input"
                  value={asrApiKey}
                  placeholder="输入 API Key"
                  disabled={saving}
                  onChange={(e) => setAsrApiKey(e.target.value)}
                />
              </div>
              <div>
                <button
                  className={`btn-test${asrStatus === 'ok' ? ' is-ok' : asrStatus === 'err' ? ' is-err' : ''}`}
                  onClick={handleTestAsr}
                  disabled={asrTesting}
                >
                  {asrTesting ? '检测中…' : asrStatus === 'ok' ? '已连通' : '测试连通'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* TTS group */}
      <div className="settings-group">
        <div className="settings-group-head">
          <div className="settings-group-icon tts">
            <Icon name="mic" size={16} />
          </div>
          <div>
            <div className="settings-group-title">语音合成引擎</div>
            <div className="settings-group-subtitle">IndexTTS2 推理服务的位置</div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-label">部署方式</div>
          <div className="settings-value">
            <SegCtlSettings<TtsDeployType>
              options={[
                { value: 'local', label: '本地' },
                { value: 'cloud', label: '远端' },
              ]}
              value={ttsDeploy}
              onChange={setTtsDeploy}
            />
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">
            本地端口
            <small>需另开终端启动 tts_service</small>
          </div>
          <div className="settings-value mono">127.0.0.1:9800</div>
          <div>
            <button
              className={`btn-test${ttsStatus === 'ok' ? ' is-ok' : ttsStatus === 'err' ? ' is-err' : ''}`}
              onClick={handleTestTts}
              disabled={ttsTesting}
            >
              {ttsTesting ? '检测中…' : ttsStatus === 'ok' ? '服务在线' : '检测'}
            </button>
          </div>
        </div>
      </div>

      {/* General group */}
      <div className="settings-group">
        <div className="settings-group-head">
          <div className="settings-group-icon gen">
            <Icon name="sliders" size={16} />
          </div>
          <div>
            <div className="settings-group-title">通用</div>
            <div className="settings-group-subtitle">外观、默认参数</div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-label">主题</div>
          <div className="settings-value">
            <SegCtlSettings<Theme>
              options={[
                { value: 'light', label: '亮色' },
                { value: 'dark', label: '暗色' },
                { value: 'auto', label: '跟随系统' },
              ]}
              value={theme}
              onChange={handleThemeChange}
            />
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">强调色</div>
          <div className="settings-value">
            <div className="swatch-row">
              {ACCENT_SWATCHES.map((sw) => (
                <button
                  key={sw.value}
                  className="sw"
                  aria-pressed={activeAccentValue === sw.value ? 'true' : 'false'}
                  aria-label={sw.label}
                  style={{ background: sw.color }}
                  onClick={() => handleAccentChange(sw.value)}
                />
              ))}
            </div>
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">
            静音切分灵敏度
            <small>新建角色时默认值（秒）</small>
          </div>
          <div className="settings-value">
            <input
              type="number"
              className="settings-input"
              value={uiSettings.silence_threshold}
              min="0.1"
              max="2.0"
              step="0.1"
              style={{ maxWidth: '100px' }}
              onChange={(e) => updateUi({ silence_threshold: parseFloat(e.target.value) || 0.8 })}
            />
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">
            长文本最短字数
            <small>低于此数将与相邻句子合并</small>
          </div>
          <div className="settings-value">
            <input
              type="number"
              className="settings-input"
              value={uiSettings.min_text_length}
              min="1"
              max="700"
              style={{ maxWidth: '100px' }}
              onChange={(e) => updateUi({ min_text_length: parseInt(e.target.value, 10) || 10 })}
            />
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">
            情绪起伏默认值
            <small>批量匹配时使用</small>
          </div>
          <div className="settings-value">
            <select
              className="settings-select"
              value={String(uiSettings.default_alpha)}
              style={{ maxWidth: '160px' }}
              onChange={(e) => {
                const map: Record<string, number> = {
                  '0.2': 0.2,
                  '0.4': 0.4,
                  '0.6': 0.6,
                  '0.8': 0.8,
                  '1.0': 1.0,
                }
                updateUi({ default_alpha: map[e.target.value] ?? 0.6 })
              }}
            >
              <option value="0.2">很低 (0.2)</option>
              <option value="0.4">低 (0.4)</option>
              <option value="0.6">中 (0.6)</option>
              <option value="0.8">高 (0.8)</option>
              <option value="1.0">很高 (1.0)</option>
            </select>
          </div>
          <div />
        </div>

        <div className="settings-row">
          <div className="settings-label">
            允许 API 模式优先
            <small>开启后：素材库内若存在 API-safe 素材，智能匹配仅在该子集中挑选（屏蔽未标记素材）；关闭则使用全部已打标素材</small>
          </div>
          <div className="settings-value" />
          <div>
            <button
              className="toggle"
              role="switch"
              aria-checked={uiSettings.api_priority ? 'true' : 'false'}
              onClick={toggleApiPriority}
              aria-label="API 模式优先"
            />
          </div>
        </div>
      </div>

      {/* 保存栏 */}
      <div className="settings-savebar">
        <div className={`settings-savebar-msg ${saveStatus}`}>
          {saveStatus === 'ok' && saveStatusMsg}
          {saveStatus === 'err' && `保存失败：${saveStatusMsg}`}
          {saveStatus === 'idle' && (llmStatusMsg || ttsStatusMsg || asrStatusMsg)}
        </div>
        <button
          className="btn-save"
          onClick={handleSave}
          disabled={saving || !config}
        >
          {saving ? '保存中…' : '保存配置'}
        </button>
      </div>
    </div>
  )
}
