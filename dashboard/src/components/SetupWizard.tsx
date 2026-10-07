import { useEffect, useState } from 'react'
import { authFetch } from '../api'
import { Panel } from './Panel'

interface SetupWizardProps {
  onComplete: () => void
}

interface SetupStatus {
  configured: boolean
  broker: 'alpaca' | 'okx'
  missingSecrets: string[]
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false)
  const [showInstructions, setShowInstructions] = useState(false)
  const [setup, setSetup] = useState<SetupStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    authFetch('/api/setup/status')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (!data.ok) throw new Error(data.error || 'Failed to check configuration')
        setSetup(data.data)
      })
      .catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : 'Failed to connect to agent')
      })
    return () => { cancelled = true }
  }, [])

  const checkSetup = async () => {
    setChecking(true)
    setError(null)
    try {
      const res = await authFetch('/api/setup/status')
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to check configuration')
      setSetup(data.data)
      if (data.data.configured) onComplete()
      else setError('Broker credentials are still missing. Add the secrets below, then check again.')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to connect to agent')
    } finally {
      setChecking(false)
    }
  }

  if (!showInstructions) {
    return (
      <div className="min-h-screen bg-hud-bg flex items-center justify-center p-6">
        <Panel title="VIIPERS SETUP" className="w-full max-w-xl">
          <div className="space-y-6">
            <div className="text-center py-2">
              <h2 className="text-xl font-light text-hud-warning mb-2">Risk Disclaimer</h2>
              <p className="text-hud-text-dim text-xs">Please read carefully before proceeding</p>
            </div>
            <div className="bg-hud-bg p-4 rounded text-xs text-hud-text-dim space-y-3 max-h-64 overflow-y-auto">
              <p>
                This software is provided for <strong className="text-hud-text">educational and informational purposes only</strong>.
                Nothing in this software constitutes financial, investment, legal, or tax advice.
              </p>
              <p><strong className="text-hud-text">By using this software, you acknowledge and agree that:</strong></p>
              <ul className="list-disc pl-4 space-y-1">
                <li>All trading and investment decisions are made <strong className="text-hud-warning">at your own risk</strong></li>
                <li>Markets are volatile and <strong className="text-hud-error">you can lose some or all of your capital</strong></li>
                <li>No guarantees of performance, profits, or outcomes are made</li>
                <li>The authors, contributors, and maintainers are not responsible for any financial losses</li>
                <li>You are solely responsible for your own trades and investment decisions</li>
                <li>This software may contain bugs, errors, or behave unexpectedly</li>
                <li>Past performance does not guarantee future results</li>
              </ul>
              <p>
                <strong className="text-hud-error">If you do not fully understand the risks involved in trading or investing, you should not use this software.</strong>
              </p>
              <p>No member, contributor, or operator of this project shall be held liable for losses of any kind.</p>
            </div>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="acceptDisclaimer"
                checked={disclaimerAccepted}
                onChange={event => setDisclaimerAccepted(event.target.checked)}
                className="accent-hud-primary mt-1"
              />
              <label htmlFor="acceptDisclaimer" className="text-xs text-hud-text">
                I have read and understand the risks. I accept full responsibility for any losses that may occur from using this software.
              </label>
            </div>
            <button
              className="hud-button w-full disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => setShowInstructions(true)}
              disabled={!disclaimerAccepted}
            >
              I Understand, Continue
            </button>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-hud-bg flex items-center justify-center p-6">
      <Panel title="VIIPERS SETUP" className="w-full max-w-xl">
        <div className="space-y-6">
          <h2 className="text-xl font-light text-hud-text-bright">Configure your broker</h2>
          <p className="text-sm text-hud-text-dim">
            Add your {setup?.broker === 'okx' ? 'OKX' : 'Alpaca'} credentials as Cloudflare Worker secrets
            from the project directory. Run each command and enter the value when prompted.
            For local development, add the same values to .dev.vars and restart the Worker.
          </p>
          {setup && !setup.configured && (
            <pre className="bg-hud-bg p-3 text-hud-primary text-sm overflow-x-auto">
              {setup.missingSecrets.map(name => `bunx wrangler secret put ${name}`).join('\n')}
            </pre>
          )}
          <p className="text-sm text-hud-text-dim">
            Use paper or demo trading for testing: set ALPACA_PAPER=true for Alpaca,
            or OKX_SIMULATED=true with an OKX demo trading key. Configure your LLM
            provider key separately to enable AI analysis.
          </p>
          {error && <p role="alert" className="text-hud-error text-sm">{error}</p>}
          <button className="hud-button w-full" onClick={checkSetup} disabled={checking}>
            {checking ? 'Checking...' : 'Check Setup & Continue'}
          </button>
        </div>
      </Panel>
    </div>
  )
}
