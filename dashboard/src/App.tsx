import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import clsx from 'clsx'
import { Panel } from './components/Panel'
import { Metric, MetricInline } from './components/Metric'
import { StatusIndicator, StatusBar } from './components/StatusIndicator'
import { SettingsModal } from './components/SettingsModal'
import { SetupWizard } from './components/SetupWizard'
import { LineChart } from './components/LineChart'
import { API_BASE, authFetch, isAdmin, saveConfig, setApiToken, viewerFetch } from './api'
import { getMarketHours } from './market-hours'
import { NotificationBell } from './components/NotificationBell'
import { Tooltip, TooltipContent } from './components/Tooltip'
import { AdminLogin } from './components/AdminLogin'
import type { Status, Config, LogEntry, Signal, Position, SignalResearch, PortfolioSnapshot, Trade } from './types'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function getAgentColor(agent: string): string {
  const colors: Record<string, string> = {
    'Analyst': 'text-hud-purple',
    'Executor': 'text-hud-cyan',
    'StockTwits': 'text-hud-success',
    'SignalResearch': 'text-hud-cyan',
    'PositionResearch': 'text-hud-purple',
    'Crypto': 'text-hud-warning',
    'System': 'text-hud-text-dim',
  }
  return colors[agent] || 'text-hud-text'
}

function isCryptoSymbol(symbol: string, cryptoSymbols: string[] = []): boolean {
  const upperSymbol = symbol.toUpperCase()
  const matchesConfig = cryptoSymbols.some(cs => {
    const normalizedConfig = cs.toUpperCase()
    if (upperSymbol === normalizedConfig) return true
    const baseSymbol = normalizedConfig.split('/')[0]
    const quoteSymbol = normalizedConfig.split('/')[1] || 'USD'
    return upperSymbol === `${baseSymbol}${quoteSymbol}`
  })
  return matchesConfig || /^[A-Z]{2,5}\/(USD|USDT|USDC)$/.test(upperSymbol)
}

function formatCryptoSymbol(symbol: string, cryptoSymbols: string[] = []): string {
  if (symbol.includes('/')) return symbol
  const upperSymbol = symbol.toUpperCase()
  for (const cs of cryptoSymbols) {
    const baseSymbol = cs.split('/')[0].toUpperCase()
    if (upperSymbol.startsWith(baseSymbol)) {
      const quote = upperSymbol.slice(baseSymbol.length)
      if (quote.length >= 3 && ['USD', 'USDT', 'USDC'].includes(quote)) {
        return `${baseSymbol}/${quote}`
      }
    }
  }
  const match = upperSymbol.match(/^([A-Z]{2,5})(USD|USDT|USDC)$/)
  if (match) return `${match[1]}/${match[2]}`
  return symbol
}

function getVerdictColor(verdict: string): string {
  if (verdict === 'BUY') return 'text-hud-success'
  if (verdict === 'SKIP') return 'text-hud-error'
  return 'text-hud-warning'
}

function getQualityColor(quality: string): string {
  if (quality === 'excellent') return 'text-hud-success'
  if (quality === 'good') return 'text-hud-primary'
  if (quality === 'fair') return 'text-hud-warning'
  return 'text-hud-error'
}

function getSentimentColor(score: number): string {
  if (score >= 0.3) return 'text-hud-success'
  if (score <= -0.2) return 'text-hud-error'
  return 'text-hud-warning'
}

async function fetchPortfolioHistory(period: string, admin: boolean): Promise<PortfolioSnapshot[]> {
  try {
    const timeframe = period === '1D' ? '15Min' : '1D'
    const intraday = period === '1D' ? '&intraday_reporting=extended_hours' : ''
    // The public endpoint derives timeframe from period server-side.
    const query = admin ? `?period=${period}&timeframe=${timeframe}${intraday}` : `?period=${period}`
    const res = await viewerFetch(`/history${query}`, admin)
    const data = await res.json()
    if (data.ok && data.data?.snapshots) {
      return data.data.snapshots
    }
    return []
  } catch {
    return []
  }
}

async function fetchTrades(admin: boolean): Promise<Trade[] | null> {
  try {
    const res = await viewerFetch('/trades', admin)
    const data = await res.json()
    return data.ok && Array.isArray(data.data) ? data.data : null
  } catch {
    return null
  }
}

function getActionColor(action: string): string {
  if (/fail|error|blocked|rejected|skipped/i.test(action)) return 'text-hud-error'
  if (/executed|filled|opened|closed/i.test(action)) return 'text-hud-success'
  return 'text-hud-text'
}

function getTradeStatusColor(status: string): string {
  if (status === 'filled') return 'text-hud-success'
  if (status === 'partially_filled' || status === 'new' || status === 'accepted') return 'text-hud-warning'
  return 'text-hud-error'
}

const PUBLIC_DISABLED = 'PUBLIC_DISABLED'

export default function App() {
  // No stored token = read-only spectator view. Config/control endpoints stay admin-only server-side.
  const [admin] = useState(isAdmin)
  const [showLogin, setShowLogin] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [setupChecked, setSetupChecked] = useState(false)
  const [time, setTime] = useState(new Date())
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([])
  const [portfolioPeriod, setPortfolioPeriod] = useState<'1D' | '1W' | '1M'>('1D')
  const [trades, setTrades] = useState<Trade[]>([])
  const configSaving = useRef(false)
  const configRevision = useRef(0)
  const [statusRefresh, setStatusRefresh] = useState(0)

  useEffect(() => {
    if (!admin) {
      setSetupChecked(true)
      return
    }
    const checkSetup = async () => {
      try {
        const res = await authFetch(`${API_BASE}/setup/status`)
        const data = await res.json()
        if (data.ok && !data.data.configured) {
          setShowSetup(true)
        }
        setSetupChecked(true)
      } catch {
        setSetupChecked(true)
      }
    }
    checkSetup()
  }, [admin])

  useEffect(() => {
    let cancelled = false
    const fetchStatus = async () => {
      if (configSaving.current) return
      const revision = configRevision.current
      try {
        const res = await viewerFetch('/status', admin)
        if (!admin && res.status === 404) {
          if (!cancelled) setError(PUBLIC_DISABLED)
          return
        }
        const data = await res.json()
        if (cancelled || revision !== configRevision.current) return
        if (data.ok) {
          setStatus(data.data)
          setError(null)
        } else {
          setError(data.error || 'Failed to fetch status')
        }
      } catch {
        if (cancelled || revision !== configRevision.current) return
        setError('Connection failed - is the agent running?')
      }
    }

    if (setupChecked && !showSetup) {
      fetchStatus()
      // Public data is cached server-side for ~10s; polling faster just re-reads the cache.
      const interval = setInterval(fetchStatus, admin ? 5000 : 15000)
      const timeInterval = setInterval(() => setTime(new Date()), 1000)

      return () => {
        cancelled = true
        clearInterval(interval)
        clearInterval(timeInterval)
      }
    }
  }, [admin, setupChecked, showSetup, statusRefresh])

  useEffect(() => {
    if (!setupChecked || showSetup) return

    const loadPortfolioHistory = async () => {
      const history = await fetchPortfolioHistory(portfolioPeriod, admin)
      if (history.length > 0) {
        setPortfolioHistory(history)
      }
    }

    loadPortfolioHistory()
    const historyInterval = setInterval(loadPortfolioHistory, 60000)
    return () => clearInterval(historyInterval)
  }, [admin, setupChecked, showSetup, portfolioPeriod])

  useEffect(() => {
    if (!setupChecked || showSetup) return

    const loadTrades = async () => {
      const recent = await fetchTrades(admin)
      if (recent) setTrades(recent)
    }

    loadTrades()
    const tradesInterval = setInterval(loadTrades, 30000)
    return () => clearInterval(tradesInterval)
  }, [admin, setupChecked, showSetup])

  const handleSaveConfig = async (config: Config) => {
    if (configSaving.current || !status) throw new Error('Configuration is not ready to save')
    const previousConfig = status.config
    configSaving.current = true
    configRevision.current += 1
    setStatus(current => current ? { ...current, config } : current)
    try {
      const savedConfig = await saveConfig(config)
      setStatus(current => current ? { ...current, config: savedConfig } : current)
    } catch (error) {
      setStatus(current => current ? { ...current, config: previousConfig } : current)
      throw error
    } finally {
      configSaving.current = false
      configRevision.current += 1
      setStatusRefresh(value => value + 1)
    }
  }

  // Derived state (must stay above early returns per React hooks rules)
  const account = status?.account
  const positions = status?.positions || []
  const signals = status?.signals || []
  const logs = status?.logs || []
  const costs = status?.costs || { total_usd: 0, calls: 0, tokens_in: 0, tokens_out: 0 }
  const config = status?.config
  // Full config is only present (and only editable) for admins.
  const adminConfig = admin ? (config as Config | undefined) : undefined
  const isMarketOpen = status?.clock?.is_open ?? false

  // P&L baseline: configured starting equity, else the oldest point in the loaded history.
  const startingEquity = config?.starting_equity || portfolioHistory[0]?.equity || account?.equity || 1
  const unrealizedPl = positions.reduce((sum, p) => sum + p.unrealized_pl, 0)
  const totalPl = account ? account.equity - startingEquity : 0
  const realizedPl = totalPl - unrealizedPl
  const totalPlPct = account ? (totalPl / startingEquity) * 100 : 0

  // Chart data derived from portfolio history
  const portfolioChartData = useMemo(() => {
    return portfolioHistory.map(s => s.equity)
  }, [portfolioHistory])

  const portfolioChartLabels = useMemo(() => {
    return portfolioHistory.map(s => {
      const date = new Date(s.timestamp)
      if (portfolioPeriod === '1D') {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      }
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    })
  }, [portfolioHistory, portfolioPeriod])

  const { marketMarkers, marketHoursZone } = useMemo(() => {
    if (portfolioPeriod !== '1D' || portfolioHistory.length === 0) {
      return { marketMarkers: undefined, marketHoursZone: undefined }
    }
    
    return getMarketHours(portfolioHistory)
  }, [portfolioHistory, portfolioPeriod])

  // Early returns (after all hooks)
  if (showSetup) {
    return <SetupWizard onComplete={() => setShowSetup(false)} />
  }

  if (error && !status) {
    const isPublicDisabled = error === PUBLIC_DISABLED
    const isAuthError = isPublicDisabled || error.includes('Unauthorized')
    return (
      <div className="min-h-screen bg-hud-bg flex items-center justify-center p-6">
        <Panel title={isAuthError ? "AUTHENTICATION REQUIRED" : "CONNECTION ERROR"} className="max-w-md w-full">
          <div className="text-center py-8">
            <div className="text-hud-error text-2xl mb-4">{isAuthError ? "NO TOKEN" : "OFFLINE"}</div>
            <p className="text-hud-text-dim text-sm mb-6">
              {isPublicDisabled ? 'The public view is not enabled. Sign in as admin to continue.' : error}
            </p>
            {isAuthError ? (
              <div className="space-y-4">
                <AdminLogin />
                {admin && (
                  <button className="hud-label hover:text-hud-primary" onClick={() => { setApiToken(''); window.location.reload() }}>
                    [CLEAR TOKEN]
                  </button>
                )}
              </div>
            ) : (
              <p className="text-hud-text-dim text-xs">
                Enable the agent: <code className="text-hud-primary">curl -H "Authorization: Bearer $TOKEN" localhost:8787/agent/enable</code>
              </p>
            )}
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-hud-bg">
      <div className="max-w-[1920px] mx-auto p-4">
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-hud-line">
          <div className="flex items-center gap-4 md:gap-6">
            <div className="flex items-baseline gap-2">
              <span className="text-xl md:text-2xl font-light tracking-tight text-hud-text-bright">
                VIIPERS
              </span>
              <span className="hud-label">v2</span>
            </div>
            <StatusIndicator 
              status={isMarketOpen ? 'active' : 'inactive'} 
              label={isMarketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
              pulse={isMarketOpen}
            />
          </div>
          <div className="flex items-center gap-3 md:gap-6 flex-wrap">
            <StatusBar
              items={[
                { label: 'LLM COST', value: `$${costs.total_usd.toFixed(4)}`, status: costs.total_usd > 1 ? 'warning' : 'active' },
                { label: 'API CALLS', value: costs.calls.toString() },
              ]}
            />
            <NotificationBell 
              overnightActivity={status?.overnightActivity}
              premarketPlan={status?.premarketPlan}
            />
            {admin ? (
              <>
                <button
                  className="hud-label hover:text-hud-primary transition-colors"
                  onClick={() => setShowSettings(true)}
                >
                  [CONFIG]
                </button>
                <button
                  className="hud-label hover:text-hud-primary transition-colors"
                  title="Sign out and see what the public sees"
                  onClick={() => { setApiToken(''); window.location.reload() }}
                >
                  [LOGOUT]
                </button>
              </>
            ) : (
              <>
                <span className="hud-label text-hud-warning border border-hud-warning/40 px-2 py-0.5">VIEW ONLY</span>
                <button
                  className="hud-label hover:text-hud-primary transition-colors"
                  onClick={() => setShowLogin(true)}
                >
                  [ADMIN]
                </button>
              </>
            )}
            <span className="hud-value-sm font-mono">
              {time.toLocaleTimeString('en-US', { hour12: false })}
            </span>
          </div>
        </header>

        <div className="grid grid-cols-4 md:grid-cols-8 lg:grid-cols-12 gap-4">
          {/* Row 1: Account, Positions, LLM Costs */}
          <div className="col-span-4 md:col-span-4 lg:col-span-3">
            <Panel title="ACCOUNT" className="h-full">
              {account ? (
                <div className="space-y-4">
                  <Metric label="EQUITY" value={formatCurrency(account.equity)} size="xl" />
                  <div className="grid grid-cols-2 gap-4">
                    <Metric label="CASH" value={formatCurrency(account.cash)} size="md" />
                    <Metric label="BUYING POWER" value={formatCurrency(account.buying_power)} size="md" />
                  </div>
                  <div className="pt-2 border-t border-hud-line space-y-2">
                    <Metric 
                      label="TOTAL P&L" 
                      value={`${formatCurrency(totalPl)} (${formatPercent(totalPlPct)})`}
                      size="md"
                      color={totalPl >= 0 ? 'success' : 'error'}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <MetricInline 
                        label="REALIZED" 
                        value={formatCurrency(realizedPl)}
                        color={realizedPl >= 0 ? 'success' : 'error'}
                      />
                      <MetricInline 
                        label="UNREALIZED" 
                        value={formatCurrency(unrealizedPl)}
                        color={unrealizedPl >= 0 ? 'success' : 'error'}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-hud-text-dim text-sm">Loading...</div>
              )}
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-4 lg:col-span-5">
            <Panel title="POSITIONS" titleRight={`${positions.length}/${config?.max_positions || 5}`} className="h-full">
              {positions.length === 0 ? (
                <div className="text-hud-text-dim text-sm py-8 text-center">No open positions</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-hud-line/50">
                        <th className="hud-label text-left py-2 px-2">Symbol</th>
                        <th className="hud-label text-right py-2 px-2 hidden sm:table-cell">Qty</th>
                        <th className="hud-label text-right py-2 px-2 hidden md:table-cell">Value</th>
                        <th className="hud-label text-right py-2 px-2">P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((pos: Position) => {
                        const plPct = (pos.unrealized_pl / (pos.market_value - pos.unrealized_pl)) * 100
                        const posEntry = status?.positionEntries?.[pos.symbol]
                        const staleness = status?.stalenessAnalysis?.[pos.symbol]
                        const holdTime = posEntry ? Math.floor((Date.now() - posEntry.entry_time) / 3600000) : null
                        
                        return (
                          <motion.tr 
                            key={pos.symbol}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="border-b border-hud-line/20 hover:bg-hud-line/10"
                          >
                            <td className="hud-value-sm py-2 px-2">
                              <Tooltip
                                position="right"
                                content={
                                  <TooltipContent
                                    title={isCryptoSymbol(pos.symbol, config?.crypto_symbols)
                                      ? `${formatCryptoSymbol(pos.symbol, config?.crypto_symbols)} - CRYPTO`
                                      : pos.symbol}
                                    items={[
                                      { label: 'Entry Price', value: posEntry ? formatCurrency(posEntry.entry_price) : 'N/A' },
                                      { label: 'Current Price', value: formatCurrency(pos.current_price) },
                                      { label: 'Hold Time', value: holdTime !== null ? `${holdTime}h` : 'N/A' },
                                      { label: 'Entry Sentiment', value: posEntry ? `${(posEntry.entry_sentiment * 100).toFixed(0)}%` : 'N/A' },
                                      ...(staleness ? [{ 
                                        label: 'Staleness', 
                                        value: `${(staleness.score * 100).toFixed(0)}%`,
                                        color: staleness.shouldExit ? 'text-hud-error' : 'text-hud-text'
                                      }] : []),
                                    ]}
                                    description={posEntry?.entry_reason}
                                  />
                                }
                              >
                                <span className="cursor-help border-b border-dotted border-hud-text-dim">
                                  {isCryptoSymbol(pos.symbol, config?.crypto_symbols) && (
                                    <span className="text-hud-warning mr-1">₿</span>
                                  )}
                                  {isCryptoSymbol(pos.symbol, config?.crypto_symbols) 
                                    ? formatCryptoSymbol(pos.symbol, config?.crypto_symbols)
                                    : pos.symbol}
                                </span>
                              </Tooltip>
                            </td>
                            <td className="hud-value-sm text-right py-2 px-2 hidden sm:table-cell">{pos.qty}</td>
                            <td className="hud-value-sm text-right py-2 px-2 hidden md:table-cell">{formatCurrency(pos.market_value)}</td>
                            <td className={clsx(
                              'hud-value-sm text-right py-2 px-2',
                              pos.unrealized_pl >= 0 ? 'text-hud-success' : 'text-hud-error'
                            )}>
                              <div>{formatCurrency(pos.unrealized_pl)}</div>
                              <div className="text-xs opacity-70">{formatPercent(plPct)}</div>
                            </td>
                          </motion.tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="LLM COSTS" className="h-full">
              <div className="grid grid-cols-2 gap-4">
                <Metric label="TOTAL SPENT" value={`$${costs.total_usd.toFixed(4)}`} size="lg" />
                <Metric label="API CALLS" value={costs.calls.toString()} size="lg" />
                <MetricInline label="TOKENS IN" value={costs.tokens_in.toLocaleString()} />
                <MetricInline label="TOKENS OUT" value={costs.tokens_out.toLocaleString()} />
                <MetricInline 
                  label="AVG COST/CALL" 
                  value={costs.calls > 0 ? `$${(costs.total_usd / costs.calls).toFixed(6)}` : '$0'} 
                />
                <MetricInline label="MODEL" value={config?.llm_model || 'gpt-6-luna'} />
              </div>
            </Panel>
          </div>

          {/* Row 2: Portfolio Performance Chart */}
          <div className="col-span-4 md:col-span-8 lg:col-span-12">
            <Panel 
              title="PORTFOLIO PERFORMANCE" 
              titleRight={
                <div className="flex gap-2">
                  {(['1D', '1W', '1M'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPortfolioPeriod(p)}
                      className={clsx(
                        'hud-label transition-colors',
                        portfolioPeriod === p ? 'text-hud-primary' : 'text-hud-text-dim hover:text-hud-text'
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              } 
              className="h-[320px]"
            >
              {portfolioChartData.length > 1 ? (
                <div className="h-full w-full">
                  <LineChart
                    series={[{ label: 'Equity', data: portfolioChartData, variant: totalPl >= 0 ? 'green' : 'red' }]}
                    labels={portfolioChartLabels}
                    showArea={true}
                    showGrid={true}
                    showDots={false}
                    formatValue={(v) => `$${(v / 1000).toFixed(1)}k`}
                    markers={marketMarkers}
                    marketHours={marketHoursZone}
                  />
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-hud-text-dim text-sm">
                  Collecting performance data...
                </div>
              )}
            </Panel>
          </div>

          {/* Row 3: Signals, Activity, Research */}
          <div className="col-span-4 md:col-span-4 lg:col-span-4">
            <Panel title="ACTIVE SIGNALS" titleRight={signals.length.toString()} className="h-80">
              <div className="overflow-y-auto h-full space-y-1">
                {signals.length === 0 ? (
                  <div className="text-hud-text-dim text-sm py-4 text-center">Gathering signals...</div>
                ) : (
                  signals.slice(0, 20).map((sig: Signal, i: number) => (
                    <Tooltip
                      key={`${sig.symbol}-${sig.source}-${i}`}
                      position="right"
                      content={
                        <TooltipContent
                          title={`${sig.symbol} - ${sig.source.toUpperCase()}`}
                          items={[
                            { label: 'Sentiment', value: `${(sig.sentiment * 100).toFixed(0)}%`, color: getSentimentColor(sig.sentiment) },
                            { label: 'Volume', value: sig.volume },
                            ...(sig.bullish !== undefined ? [{ label: 'Bullish', value: sig.bullish, color: 'text-hud-success' }] : []),
                            ...(sig.bearish !== undefined ? [{ label: 'Bearish', value: sig.bearish, color: 'text-hud-error' }] : []),
                            ...(sig.score !== undefined ? [{ label: 'Score', value: sig.score }] : []),
                            ...(sig.upvotes !== undefined ? [{ label: 'Upvotes', value: sig.upvotes }] : []),
                            ...(sig.momentum !== undefined ? [{ label: 'Momentum', value: `${sig.momentum >= 0 ? '+' : ''}${sig.momentum.toFixed(2)}%` }] : []),
                            ...(sig.price !== undefined ? [{ label: 'Price', value: formatCurrency(sig.price) }] : []),
                          ]}
                          description={sig.reason}
                        />
                      }
                    >
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                        className={clsx(
                          "flex items-center justify-between py-1 px-2 border-b border-hud-line/10 hover:bg-hud-line/10 cursor-help",
                          sig.isCrypto && "bg-hud-warning/5"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {sig.isCrypto && <span className="text-hud-warning text-xs">₿</span>}
                          <span className="hud-value-sm">{sig.symbol}</span>
                          <span className={clsx('hud-label', sig.isCrypto ? 'text-hud-warning' : '')}>{sig.source.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {sig.isCrypto && sig.momentum !== undefined ? (
                            <span className={clsx('hud-label hidden sm:inline', sig.momentum >= 0 ? 'text-hud-success' : 'text-hud-error')}>
                              {sig.momentum >= 0 ? '+' : ''}{sig.momentum.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="hud-label hidden sm:inline">VOL {sig.volume}</span>
                          )}
                          <span className={clsx('hud-value-sm', getSentimentColor(sig.sentiment))}>
                            {(sig.sentiment * 100).toFixed(0)}%
                          </span>
                        </div>
                      </motion.div>
                    </Tooltip>
                  ))
                )}
              </div>
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-4 lg:col-span-4">
            <Panel title="ACTIVITY FEED" titleRight="LIVE" className="h-80">
              <div className="overflow-y-auto h-full font-mono text-xs space-y-1">
                {logs.length === 0 ? (
                  <div className="text-hud-text-dim py-4 text-center">Waiting for activity...</div>
                ) : (
                  logs.slice(-50).reverse().map((log: LogEntry, i: number) => (
                    <motion.div 
                      key={`${log.timestamp}-${i}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-start gap-2 py-1 border-b border-hud-line/10"
                      title={[log.reason, log.error, log.message].filter((v) => typeof v === 'string').join(' — ') || undefined}
                    >
                      <span className="text-hud-text-dim shrink-0 hidden sm:inline w-[52px]">
                        {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                      </span>
                      <span className={clsx('shrink-0 w-[72px] text-right', getAgentColor(log.agent))}>
                        {log.agent}
                      </span>
                      <span className={clsx('flex-1 text-right wrap-break-word', getActionColor(log.action))}>
                        {log.action}
                        {log.symbol && <span className="text-hud-primary ml-1">({log.symbol})</span>}
                      </span>
                    </motion.div>
                  ))
                )}

              </div>
            </Panel>
          </div>

          <div className="col-span-4 md:col-span-8 lg:col-span-4">
            <Panel title="SIGNAL RESEARCH" titleRight={Object.keys(status?.signalResearch || {}).length.toString()} className="h-80">
              <div className="overflow-y-auto h-full space-y-2">
                {Object.entries(status?.signalResearch || {}).length === 0 ? (
                  <div className="text-hud-text-dim text-sm py-4 text-center">Researching candidates...</div>
                ) : (
                  Object.entries(status?.signalResearch || {})
                    .sort(([, a], [, b]) => b.timestamp - a.timestamp)
                    .map(([symbol, research]: [string, SignalResearch]) => (
                    <Tooltip
                      key={symbol}
                      position="left"
                      content={
                        <div className="space-y-2 min-w-[200px]">
                          <div className="hud-label text-hud-primary border-b border-hud-line/50 pb-1">
                            {symbol} DETAILS
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-hud-text-dim">Confidence</span>
                              <span className="text-hud-text-bright">{(research.confidence * 100).toFixed(0)}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-hud-text-dim">Sentiment</span>
                              <span className={getSentimentColor(research.sentiment)}>
                                {(research.sentiment * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-hud-text-dim">Analyzed</span>
                              <span className="text-hud-text">
                                {new Date(research.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                              </span>
                            </div>
                          </div>
                          {research.catalysts.length > 0 && (
                            <div className="pt-1 border-t border-hud-line/30">
                              <span className="text-[9px] text-hud-text-dim">CATALYSTS:</span>
                              <ul className="mt-1 space-y-0.5">
                                {research.catalysts.map((c, i) => (
                                  <li key={i} className="text-[10px] text-hud-success">+ {c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {research.red_flags.length > 0 && (
                            <div className="pt-1 border-t border-hud-line/30">
                              <span className="text-[9px] text-hud-text-dim">RED FLAGS:</span>
                              <ul className="mt-1 space-y-0.5">
                                {research.red_flags.map((f, i) => (
                                  <li key={i} className="text-[10px] text-hud-error">- {f}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      }
                    >
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="p-2 border border-hud-line/30 rounded hover:border-hud-line/60 cursor-help transition-colors"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="hud-value-sm">{symbol}</span>
                          <div className="flex items-center gap-2">
                            <span className={clsx('hud-label', getQualityColor(research.entry_quality))}>
                              {research.entry_quality.toUpperCase()}
                            </span>
                            <span className={clsx('hud-value-sm font-bold', getVerdictColor(research.verdict))}>
                              {research.verdict}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-hud-text-dim leading-tight mb-1">{research.reasoning}</p>
                        {research.red_flags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {research.red_flags.slice(0, 2).map((flag, i) => (
                              <span key={i} className="text-xs text-hud-error bg-hud-error/10 px-1 rounded">
                                {flag.slice(0, 30)}...
                              </span>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    </Tooltip>
                  ))
                )}
              </div>
            </Panel>
          </div>

          {/* Row 4: Trade history straight from the broker (fills, rejections, cancels) */}
          <div className="col-span-4 md:col-span-8 lg:col-span-12">
            <Panel title="RECENT TRADES" titleRight={trades.length.toString()} className="max-h-96">
              {trades.length === 0 ? (
                <div className="text-hud-text-dim text-sm py-6 text-center">No trades yet</div>
              ) : (
                <div className="overflow-auto max-h-80">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-hud-panel">
                      <tr className="border-b border-hud-line/50">
                        <th className="hud-label text-left py-2 px-2">Time</th>
                        <th className="hud-label text-left py-2 px-2">Symbol</th>
                        <th className="hud-label text-left py-2 px-2">Side</th>
                        <th className="hud-label text-right py-2 px-2 hidden sm:table-cell">Qty</th>
                        <th className="hud-label text-right py-2 px-2">Fill Price</th>
                        <th className="hud-label text-right py-2 px-2 hidden md:table-cell">Value</th>
                        <th className="hud-label text-right py-2 px-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((trade, i) => {
                        const qty = trade.filled_qty || trade.qty
                        const value = trade.filled_avg_price !== null ? qty * trade.filled_avg_price : null
                        return (
                          <tr key={`${trade.submitted_at}-${trade.symbol}-${i}`} className="border-b border-hud-line/20 hover:bg-hud-line/10">
                            <td className="hud-value-sm py-2 px-2 text-hud-text-dim whitespace-nowrap">
                              {new Date(trade.filled_at || trade.submitted_at).toLocaleString('en-US', {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
                              })}
                            </td>
                            <td className="hud-value-sm py-2 px-2">{trade.symbol}</td>
                            <td className={clsx('hud-value-sm py-2 px-2 uppercase', trade.side === 'buy' ? 'text-hud-success' : 'text-hud-error')}>
                              {trade.side}
                            </td>
                            <td className="hud-value-sm text-right py-2 px-2 hidden sm:table-cell">{qty || '—'}</td>
                            <td className="hud-value-sm text-right py-2 px-2">
                              {trade.filled_avg_price !== null ? formatCurrency(trade.filled_avg_price) : '—'}
                            </td>
                            <td className="hud-value-sm text-right py-2 px-2 hidden md:table-cell">
                              {value !== null ? formatCurrency(value) : '—'}
                            </td>
                            <td className={clsx('hud-label text-right py-2 px-2', getTradeStatusColor(trade.status))}>
                              {trade.status.replace('_', ' ').toUpperCase()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </div>

        <footer className="mt-4 pt-3 border-t border-hud-line flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex flex-wrap gap-4 md:gap-6">
            {config && (
              <>
                {/* Strategy thresholds are private: shown to the admin only */}
                {adminConfig && (
                  <>
                    <MetricInline label="MAX POS" value={`$${adminConfig.max_position_value}`} />
                    <MetricInline label="MIN SENT" value={`${(adminConfig.min_sentiment_score * 100).toFixed(0)}%`} />
                    <MetricInline label="TAKE PROFIT" value={`${adminConfig.take_profit_pct}%`} />
                    <MetricInline label="STOP LOSS" value={`${adminConfig.stop_loss_pct}%`} />
                    <span className="hidden lg:inline text-hud-line">|</span>
                  </>
                )}
                <MetricInline
                  label="OPTIONS"
                  value={config.options_enabled ? 'ON' : 'OFF'}
                  valueClassName={config.options_enabled ? 'text-hud-purple' : 'text-hud-text-dim'}
                />
                {adminConfig?.options_enabled && (
                  <>
                    <MetricInline label="OPT Δ" value={adminConfig.options_target_delta?.toFixed(2) || '0.35'} />
                    <MetricInline label="OPT DTE" value={`${adminConfig.options_min_dte || 7}-${adminConfig.options_max_dte || 45}`} />
                  </>
                )}
                <span className="hidden lg:inline text-hud-line">|</span>
                <MetricInline 
                  label="CRYPTO" 
                  value={config.crypto_enabled ? '24/7' : 'OFF'} 
                  valueClassName={config.crypto_enabled ? 'text-hud-warning' : 'text-hud-text-dim'}
                />
                {config.crypto_enabled && (
                  <MetricInline label="SYMBOLS" value={(config.crypto_symbols || ['BTC', 'ETH', 'SOL']).map(s => s.split('/')[0]).join('/')} />
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="hud-label hidden md:inline">AUTONOMOUS TRADING SYSTEM</span>
            {status?.broker && <span className="hud-label">{status.broker.toUpperCase()}</span>}
            <span className={clsx('hud-value-sm', status?.tradingMode === 'live' ? 'text-hud-error' : '')}>
              {status?.tradingMode === 'live' ? 'LIVE TRADING' : 'PAPER MODE'}
            </span>
          </div>
        </footer>
      </div>

      <AnimatePresence>
        {admin && showSettings && adminConfig && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <SettingsModal
              config={adminConfig}
              onSave={handleSaveConfig}
              onClose={() => setShowSettings(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {!admin && showLogin && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Admin sign in"
        >
          <div className="max-w-md w-full">
            <AdminLogin onCancel={() => setShowLogin(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
