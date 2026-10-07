import { describe, expect, it } from 'vitest'
import { getMarketHours } from './market-hours'
import type { PortfolioSnapshot } from './types'

function snapshots(...timestamps: string[]): PortfolioSnapshot[] {
  return timestamps.map(timestamp => ({ timestamp: Date.parse(timestamp), equity: 100, pl: 0, pl_pct: 0 }))
}

describe('New York market hours', () => {
  it.each([
    ['winter', '2026-01-06T14:30:00Z', '2026-01-06T21:00:00Z'],
    ['summer', '2026-07-06T13:30:00Z', '2026-07-06T20:00:00Z'],
  ])('places %s markers at US market times regardless of local timezone', (_season, open, close) => {
    const result = getMarketHours(snapshots(open, close))
    expect(result.marketMarkers?.map(marker => [marker.label, marker.index])).toEqual([['OPEN', 0], ['CLOSE', 1]])
    expect(result.marketHoursZone).toEqual({ openIndex: 0, closeIndex: 1 })
  })

  it('does not mark 09:30 and 16:00 UTC as New York opening and closing', () => {
    const result = getMarketHours(snapshots('2026-01-06T09:30:00Z', '2026-01-06T16:00:00Z'))
    expect(result.marketMarkers).toBeUndefined()
    expect(result.marketHoursZone).toBeUndefined()
  })

  it('omits the shaded zone until both boundaries are available', () => {
    expect(getMarketHours(snapshots('2026-07-06T13:30:00Z')).marketHoursZone).toBeUndefined()
  })
})
