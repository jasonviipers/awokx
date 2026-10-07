import type { Config } from './types'

const TOKEN_KEY = 'mahoraga_api_token'

/** API origin + prefix. Override with VITE_API_BASE to host the dashboard on another site. */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') || '/api'

/**
 * The admin token only ever comes from the admin's own browser storage. It must never be
 * baked into the page (e.g. a window global): the public dashboard is served to everyone.
 */
export function getApiToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setApiToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage unavailable (private mode): admin login won't persist.
  }
}

/** Admin mode = an API token is stored. Everyone else gets the read-only public view. */
export function isAdmin(): boolean {
  return getApiToken() !== ''
}

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  const token = getApiToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json')
  return fetch(url, { ...options, headers })
}

/**
 * Read-only data fetch for the current viewer. Admins hit the authenticated API;
 * public viewers hit /public/* and never send a token.
 */
export function viewerFetch(path: string, admin: boolean): Promise<Response> {
  return admin ? authFetch(`${API_BASE}${path}`) : fetch(`${API_BASE}/public${path}`)
}

export async function saveConfig(config: Config): Promise<Config> {
  const res = await authFetch(`${API_BASE}/config`, {
    method: 'POST',
    body: JSON.stringify(config),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    const issues = data.issues?.map((issue: { path: (string | number)[]; message: string }) =>
      `${issue.path.join('.')}: ${issue.message}`,
    ).join('; ')
    throw new Error(issues || data.error || 'Failed to save configuration')
  }
  if (!data.config || typeof data.config !== 'object') {
    throw new Error('The server returned an invalid configuration response')
  }
  return data.config
}
