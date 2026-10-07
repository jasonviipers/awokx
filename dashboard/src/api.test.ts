import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveConfig, viewerFetch } from './api'
import type { Config } from './types'

describe('configuration API', () => {
  const fetchMock = vi.fn()
  const config = { max_positions: 5 } as Config

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses the server config response and authenticates the request', async () => {
    const saved = { ...config, max_positions: 6 }
    fetchMock.mockResolvedValue(Response.json({ ok: true, config: saved }))
    await expect(saveConfig(config)).resolves.toEqual(saved)
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/config')
    expect(request.method).toBe('POST')
    expect(request.headers.get('Authorization')).toBe('Bearer test-token')
    expect(request.headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(request.body)).toEqual(config)
  })

  it('reports server validation issues instead of succeeding', async () => {
    fetchMock.mockResolvedValue(Response.json({
      ok: false,
      error: 'Invalid configuration',
      issues: [{ path: ['max_positions'], message: 'Too big' }],
    }, { status: 400 }))
    await expect(saveConfig(config)).rejects.toThrow('max_positions: Too big')
  })

  it('reports authentication failure even without an ok field', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }))
    await expect(saveConfig(config)).rejects.toThrow('Unauthorized')
  })

  it('rejects a success response with no configuration', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    await expect(saveConfig(config)).rejects.toThrow('invalid configuration response')
  })

  it('propagates connection failures for rollback', async () => {
    fetchMock.mockRejectedValue(new Error('Offline'))
    await expect(saveConfig(config)).rejects.toThrow('Offline')
  })
})

describe('viewer API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { getItem: () => 'test-token' })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends the token to the admin API', async () => {
    await viewerFetch('/status', true)
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/status')
    expect(request.headers.get('Authorization')).toBe('Bearer test-token')
  })

  it('never sends the token to the public API', async () => {
    await viewerFetch('/status', false)
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/public/status')
    expect(request).toBeUndefined()
  })
})
