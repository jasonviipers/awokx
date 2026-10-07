import { useEffect, useState } from 'react'
import { API_BASE, authFetch } from '../api'
import type { Config, ModelInfo } from '../types'
import { Panel } from './Panel'

const KNOWN_LLM_PROVIDERS = ['openai-raw', 'ai-sdk', 'cloudflare-gateway']

const PROVIDER_LABELS: Record<ModelInfo['provider'], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
  deepseek: 'DeepSeek',
}

/** openai-raw takes bare OpenAI IDs; AI SDK and the gateway take "provider/id". */
function modelValue(model: ModelInfo, llmProvider: string): string {
  return llmProvider === 'openai-raw' ? model.id : `${model.provider}/${model.id}`
}

/** Convert a stored model value when switching between bare and "provider/id" formats. */
function convertModelValue(value: string, toProvider: string): string {
  if (toProvider === 'openai-raw') return value.startsWith('openai/') ? value.slice('openai/'.length) : value
  if (KNOWN_LLM_PROVIDERS.includes(toProvider) && value && !value.includes('/')) return `openai/${value}`
  return value
}

interface SettingsModalProps {
  config: Config
  onSave: (config: Config) => Promise<void>
  onClose: () => void
}

export function SettingsModal({ config, onSave, onClose }: SettingsModalProps) {
  const [localConfig, setLocalConfig] = useState<Config>(config)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [apiToken, setApiToken] = useState(localStorage.getItem('viipers_api_token') || '')

  // Note: We intentionally do NOT sync localConfig with the config prop after initial mount.
  // This prevents the parent's polling (every 5s) from overwriting user's unsaved changes.

  const handleTokenSave = () => {
    if (apiToken) {
      localStorage.setItem('viipers_api_token', apiToken)
    } else {
      localStorage.removeItem('viipers_api_token')
    }
    window.location.reload()
  }

  // The model list lives in the backend catalog so the UI never offers retired models.
  const [catalog, setCatalog] = useState<ModelInfo[] | null>(null)
  useEffect(() => {
    let cancelled = false
    authFetch(`${API_BASE}/models`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled && data.ok && Array.isArray(data.data?.models)) setCatalog(data.data.models)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const handleChange = <K extends keyof Config>(key: K, value: Config[K]) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }))
  }

  const handleProviderChange = (llmProvider: Config['llm_provider']) => {
    setLocalConfig(prev => ({
      ...prev,
      llm_provider: llmProvider,
      llm_model: convertModelValue(prev.llm_model, llmProvider || 'openai-raw'),
      llm_analyst_model: prev.llm_analyst_model && convertModelValue(prev.llm_analyst_model, llmProvider || 'openai-raw'),
    }))
  }

  const renderModelOptions = (kind: 'research' | 'analyst', current: string) => {
    const llmProvider = localConfig.llm_provider || 'openai-raw'
    if (!catalog || !KNOWN_LLM_PROVIDERS.includes(llmProvider)) {
      return current ? <option value={current}>{current}</option> : null
    }
    const models = catalog.filter(m =>
      (kind === 'research' ? m.tier !== 'smart' : m.tier !== 'cheap') &&
      (llmProvider !== 'openai-raw' || m.provider === 'openai'),
    )
    const option = (m: ModelInfo) => {
      const value = modelValue(m, llmProvider)
      return (
        <option key={value} value={value}>
          {m.label} — ${m.inputPerM} / ${m.outputPerM}
        </option>
      )
    }
    const hasCurrent = models.some(m => modelValue(m, llmProvider) === current)
    const providers = [...new Set(models.map(m => m.provider))]
    return (
      <>
        {current && !hasCurrent && <option value={current}>{current} (current, not in latest list)</option>}
        {llmProvider === 'openai-raw'
          ? models.map(option)
          : providers.map(p => (
              <optgroup key={p} label={PROVIDER_LABELS[p]}>
                {models.filter(m => m.provider === p).map(option)}
              </optgroup>
            ))}
      </>
    )
  }

  const handleClose = () => {
    if (!saving) onClose()
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(localConfig)
      onClose()
    } catch (error) {
      setSaveError(`${error instanceof Error ? error.message : 'Failed to save configuration'}. The change was reverted. Your edits are kept here so you can retry.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      {/* Pixel width on purpose: the HUD's 10px root font makes rem-based max-w-* far too narrow */}
      <Panel
        title="TRADING CONFIGURATION"
        className="w-[min(1200px,96vw)] max-h-[92vh] overflow-auto"
        titleRight={
          <button onClick={handleClose} disabled={saving} className="hud-label hover:text-hud-primary">
            [ESC]
          </button>
        }
      >
        <div onClick={e => e.stopPropagation()} className="space-y-6">
          {/* API Authentication */}
          <div className="pb-4 border-b border-hud-line max-w-[720px]">
            <h3 className="hud-label mb-3 text-hud-error">API Authentication (Required)</h3>
            <div className="flex gap-2">
              <input
                type="password"
                className="hud-input flex-1"
                value={apiToken}
                onChange={e => setApiToken(e.target.value)}
                placeholder="Enter VIIPERS_API_TOKEN"
              />
              <button className="hud-button" onClick={handleTokenSave}>
                Save & Reload
              </button>
            </div>
            <p className="text-[9px] text-hud-text-dim mt-1">
              Your VIIPERS_API_TOKEN from Cloudflare secrets. Required for all API access.
            </p>
          </div>

          {/* Settings flow into balanced columns so the modal uses the screen width */}
          <div className="columns-1 md:columns-2 xl:columns-3 gap-10">
          {/* Position Limits */}
            <div className="break-inside-avoid mb-8">
            <h3 className="hud-label mb-3 text-hud-primary">Position Limits</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="hud-label block mb-1">Max Position Value ($)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.max_position_value}
                  onChange={e => handleChange('max_position_value', Number(e.target.value))}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Max Positions</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.max_positions}
                  onChange={e => handleChange('max_positions', Number(e.target.value))}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Position Size (% of Cash)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.position_size_pct_of_cash}
                  onChange={e => handleChange('position_size_pct_of_cash', Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* Sentiment Thresholds */}
            <div className="break-inside-avoid mb-8">
            <h3 className="hud-label mb-3 text-hud-primary">Sentiment Thresholds</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="hud-label block mb-1">Min Sentiment to Buy (0-1)</label>
                <input
                  type="number"
                  step="0.05"
                  className="hud-input w-full"
                  value={localConfig.min_sentiment_score}
                  onChange={e => handleChange('min_sentiment_score', Number(e.target.value))}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Min Analyst Confidence (0-1)</label>
                <input
                  type="number"
                  step="0.05"
                  className="hud-input w-full"
                  value={localConfig.min_analyst_confidence}
                  onChange={e => handleChange('min_analyst_confidence', Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* Risk Management */}
            <div className="break-inside-avoid mb-8">
            <h3 className="hud-label mb-3 text-hud-primary">Risk Management</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="hud-label block mb-1">Take Profit (%)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.take_profit_pct}
                  onChange={e => handleChange('take_profit_pct', Number(e.target.value))}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Stop Loss (%)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.stop_loss_pct}
                  onChange={e => handleChange('stop_loss_pct', Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* Timing */}
            <div className="break-inside-avoid mb-8">
            <h3 className="hud-label mb-3 text-hud-primary">Polling Intervals</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="hud-label block mb-1">Data Poll (ms)</label>
                <input
                  type="number"
                  step="1000"
                  className="hud-input w-full"
                  value={localConfig.data_poll_interval_ms}
                  onChange={e => handleChange('data_poll_interval_ms', Number(e.target.value))}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Analyst Interval (ms)</label>
                <input
                  type="number"
                  step="1000"
                  className="hud-input w-full"
                  value={localConfig.analyst_interval_ms}
                  onChange={e => handleChange('analyst_interval_ms', Number(e.target.value))}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Pre-Market Plan Window (min)</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  className="hud-input w-full"
                  value={localConfig.premarket_plan_window_minutes ?? 5}
                  onChange={e => handleChange('premarket_plan_window_minutes', Number(e.target.value))}
                />
                <p className="text-[9px] text-hud-text-dim mt-1">Generate a plan when within N minutes of the next market open.</p>
              </div>
              <div>
                <label className="hud-label block mb-1">Market Open Execute Window (min)</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="hud-input w-full"
                  value={localConfig.market_open_execute_window_minutes ?? 2}
                  onChange={e => handleChange('market_open_execute_window_minutes', Number(e.target.value))}
                />
                <p className="text-[9px] text-hud-text-dim mt-1">Execute the plan if the market is open and within this window.</p>
              </div>
            </div>
          </div>

          {/* LLM Config */}
            <div className="break-inside-avoid mb-8">
            <h3 className="hud-label mb-3 text-hud-primary">LLM Configuration</h3>
            <div className="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label className="hud-label block mb-1">Provider</label>
                <select
                  className="hud-input w-full"
                  value={localConfig.llm_provider || 'openai-raw'}
                  onChange={e => handleProviderChange(e.target.value as Config['llm_provider'])}
                >
                  <option value="openai-raw">OpenAI Direct (default)</option>
                  <option value="ai-sdk">AI SDK (5 providers)</option>
                  <option value="cloudflare-gateway">Cloudflare AI Gateway</option>
                  {localConfig.llm_provider &&
                    !['openai-raw', 'ai-sdk', 'cloudflare-gateway'].includes(localConfig.llm_provider) && (
                      <option value={localConfig.llm_provider}>Custom (backend configured)</option>
                    )}
                </select>
                <p className="text-[9px] text-hud-text-dim mt-1">
                  {localConfig.llm_provider === 'ai-sdk' && 'Supports: OpenAI, Anthropic, Google, xAI, DeepSeek'}
                  {(!localConfig.llm_provider || localConfig.llm_provider === 'openai-raw') && 'Uses OPENAI_API_KEY directly (+ optional OPENAI_BASE_URL).'}
                  {localConfig.llm_provider &&
                    !['openai-raw', 'ai-sdk', 'cloudflare-gateway'].includes(localConfig.llm_provider) &&
                    'Provider is configured in the backend; selection is hidden in the dashboard.'}
                  {localConfig.llm_provider === 'cloudflare-gateway' && 'Uses CLOUDFLARE_AI_GATEWAY_* env vars via Cloudflare AI Gateway /compat.'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="hud-label block mb-1">Research Model (cheap)</label>
                <select
                  className="hud-input w-full"
                  value={localConfig.llm_model}
                  onChange={e => handleChange('llm_model', e.target.value)}
                >
                  {renderModelOptions('research', localConfig.llm_model)}
                </select>
              </div>
              <div>
                <label className="hud-label block mb-1">Analyst Model (smart)</label>
                <select
                  className="hud-input w-full"
                  value={localConfig.llm_analyst_model || ''}
                  onChange={e => handleChange('llm_analyst_model', e.target.value)}
                >
                  {renderModelOptions('analyst', localConfig.llm_analyst_model || '')}
                </select>
              </div>
            </div>
            <p className="text-[9px] text-hud-text-dim mt-1">
              {catalog
                ? 'Latest models from the server catalog. Prices are USD per 1M input / output tokens.'
                : 'Loading model list…'}
            </p>
          </div>

          {/* Account Config */}
            <div className="break-inside-avoid mb-8">
            <h3 className="hud-label mb-3 text-hud-primary">Account</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="hud-label block mb-1">Starting Equity ($)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.starting_equity || 100000}
                  onChange={e => handleChange('starting_equity', Number(e.target.value))}
                />
                <p className="text-xs text-hud-text-dim mt-1">For P&L calculation</p>
              </div>
            </div>
          </div>

          {/* Options Trading */}
            <div className="break-inside-avoid mb-8">
            <h3 className="hud-label mb-3 text-hud-purple">Options Trading (Beta)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="hud-input w-4 h-4"
                    checked={localConfig.options_enabled || false}
                    onChange={e => handleChange('options_enabled', e.target.checked)}
                  />
                  <span className="hud-label">Enable Options Trading</span>
                </label>
              </div>
              <div>
                <label className="hud-label block mb-1">Min Confidence (0-1)</label>
                <input
                  type="number"
                  step="0.05"
                  className="hud-input w-full"
                  value={localConfig.options_min_confidence || 0.75}
                  onChange={e => handleChange('options_min_confidence', Number(e.target.value))}
                  disabled={!localConfig.options_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Max % Per Trade</label>
                <input
                  type="number"
                  step="0.5"
                  className="hud-input w-full"
                  value={localConfig.options_max_pct_per_trade || 2}
                  onChange={e => handleChange('options_max_pct_per_trade', Number(e.target.value))}
                  disabled={!localConfig.options_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Min DTE (days)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.options_min_dte || 7}
                  onChange={e => handleChange('options_min_dte', Number(e.target.value))}
                  disabled={!localConfig.options_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Max DTE (days)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.options_max_dte || 45}
                  onChange={e => handleChange('options_max_dte', Number(e.target.value))}
                  disabled={!localConfig.options_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Target Delta</label>
                <input
                  type="number"
                  step="0.05"
                  className="hud-input w-full"
                  value={localConfig.options_target_delta || 0.35}
                  onChange={e => handleChange('options_target_delta', Number(e.target.value))}
                  disabled={!localConfig.options_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Stop Loss (%)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.options_stop_loss_pct || 50}
                  onChange={e => handleChange('options_stop_loss_pct', Number(e.target.value))}
                  disabled={!localConfig.options_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Take Profit (%)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.options_take_profit_pct || 100}
                  onChange={e => handleChange('options_take_profit_pct', Number(e.target.value))}
                  disabled={!localConfig.options_enabled}
                />
              </div>
            </div>
          </div>

          {/* Crypto Trading */}
            <div className="break-inside-avoid mb-8">
            <h3 className="hud-label mb-3 text-hud-cyan">Crypto Trading (24/7)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="hud-input w-4 h-4"
                    checked={localConfig.crypto_enabled || false}
                    onChange={e => handleChange('crypto_enabled', e.target.checked)}
                  />
                  <span className="hud-label">Enable Crypto Trading</span>
                </label>
                <p className="text-[9px] text-hud-text-dim mt-1">Trade crypto 24/7 based on momentum. Alpaca supports 20+ coins.</p>
              </div>
              <div>
                <label className="hud-label block mb-1">Symbols (comma-separated)</label>
                <input
                  type="text"
                  className="hud-input w-full"
                  value={(localConfig.crypto_symbols || ['BTC/USD', 'ETH/USD', 'SOL/USD']).join(', ')}
                  onChange={e => handleChange('crypto_symbols', e.target.value.split(',').map(s => s.trim()))}
                  disabled={!localConfig.crypto_enabled}
                  placeholder="BTC/USD, ETH/USD, SOL/USD, DOGE/USD, AVAX/USD..."
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Momentum Threshold (%)</label>
                <input
                  type="number"
                  step="0.5"
                  className="hud-input w-full"
                  value={localConfig.crypto_momentum_threshold || 2.0}
                  onChange={e => handleChange('crypto_momentum_threshold', Number(e.target.value))}
                  disabled={!localConfig.crypto_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Max Position ($)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.crypto_max_position_value || 1000}
                  onChange={e => handleChange('crypto_max_position_value', Number(e.target.value))}
                  disabled={!localConfig.crypto_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Take Profit (%)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.crypto_take_profit_pct || 10}
                  onChange={e => handleChange('crypto_take_profit_pct', Number(e.target.value))}
                  disabled={!localConfig.crypto_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Stop Loss (%)</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.crypto_stop_loss_pct || 5}
                  onChange={e => handleChange('crypto_stop_loss_pct', Number(e.target.value))}
                  disabled={!localConfig.crypto_enabled}
                />
              </div>
            </div>
          </div>

          {/* Stale Position Management */}
            <div className="break-inside-avoid mb-8">
            <h3 className="hud-label mb-3 text-hud-warning">Stale Position Management</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="hud-input w-4 h-4"
                    checked={localConfig.stale_position_enabled ?? true}
                    onChange={e => handleChange('stale_position_enabled', e.target.checked)}
                  />
                  <span className="hud-label">Enable Stale Position Detection</span>
                </label>
              </div>
              <div>
                <label className="hud-label block mb-1">Max Hold Days</label>
                <input
                  type="number"
                  className="hud-input w-full"
                  value={localConfig.stale_max_hold_days || 3}
                  onChange={e => handleChange('stale_max_hold_days', Number(e.target.value))}
                  disabled={!localConfig.stale_position_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Min Gain % to Keep</label>
                <input
                  type="number"
                  step="0.5"
                  className="hud-input w-full"
                  value={localConfig.stale_min_gain_pct || 5}
                  onChange={e => handleChange('stale_min_gain_pct', Number(e.target.value))}
                  disabled={!localConfig.stale_position_enabled}
                />
              </div>
              <div>
                <label className="hud-label block mb-1">Social Volume Decay</label>
                <input
                  type="number"
                  step="0.1"
                  className="hud-input w-full"
                  value={localConfig.stale_social_volume_decay || 0.3}
                  onChange={e => handleChange('stale_social_volume_decay', Number(e.target.value))}
                  disabled={!localConfig.stale_position_enabled}
                />
                <p className="text-[9px] text-hud-text-dim mt-1">Exit if volume drops to this % of entry</p>
              </div>
            </div>
          </div>
          </div>

          {/* Actions */}
          {saveError && (
            <p role="alert" className="text-hud-error text-sm">{saveError}</p>
          )}
          {/* Stays visible while scrolling so Save is always reachable */}
          <div className="sticky -bottom-3 -mx-3 px-3 py-3 bg-hud-bg-panel flex justify-end gap-4 border-t border-hud-line">
            <button className="hud-button" onClick={handleClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="hud-button"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
