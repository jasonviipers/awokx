import { useState } from 'react'
import { setApiToken } from '../api'

interface AdminLoginProps {
  onCancel?: () => void
}

/** Stores the admin API token in this browser only, then reloads into admin mode. */
export function AdminLogin({ onCancel }: AdminLoginProps) {
  const [token, setToken] = useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!token.trim()) return
    setApiToken(token.trim())
    window.location.reload()
  }

  return (
    <form onSubmit={submit} className="text-left bg-hud-panel p-4 border border-hud-line space-y-2">
      <label className="hud-label block" htmlFor="admin-token">Admin API token</label>
      <input
        id="admin-token"
        type="password"
        autoComplete="current-password"
        className="hud-input w-full"
        placeholder="Enter VIIPERS_API_TOKEN"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2">
        <button type="submit" className="hud-button flex-1">Sign in</button>
        {onCancel && (
          <button type="button" className="hud-button flex-1" onClick={onCancel}>Cancel</button>
        )}
      </div>
      <p className="text-hud-text-dim text-xs">
        Stored only in this browser. Find it in <code className="text-hud-primary">.dev.vars</code> (local) or Cloudflare secrets (deployed).
      </p>
    </form>
  )
}
