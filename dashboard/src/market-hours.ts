import type { PortfolioSnapshot } from './types'

const marketTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function getMarketHours(snapshots: PortfolioSnapshot[]) {
  const markers: { index: number; label: string; color?: string }[] = []
  let openIndex = -1
  let closeIndex = -1

  snapshots.forEach((snapshot, index) => {
    const parts = marketTime.formatToParts(new Date(snapshot.timestamp))
    const hour = Number(parts.find(part => part.type === 'hour')?.value)
    const minute = Number(parts.find(part => part.type === 'minute')?.value)
    if (hour === 9 && minute >= 30 && minute < 45 && openIndex === -1) {
      openIndex = index
      markers.push({ index, label: 'OPEN', color: 'var(--color-hud-success)' })
    } else if (hour === 16 && minute === 0 && closeIndex === -1) {
      closeIndex = index
      markers.push({ index, label: 'CLOSE', color: 'var(--color-hud-error)' })
    }
  })

  return {
    marketMarkers: markers.length > 0 ? markers : undefined,
    marketHoursZone: openIndex >= 0 && closeIndex > openIndex ? { openIndex, closeIndex } : undefined,
  }
}
