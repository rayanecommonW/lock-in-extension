import { useEffect, useMemo, useRef, useState } from 'react'
import { sendRuntimeMessage } from '@/shared/chrome-api'
import ActivityBarChart from '@/options/components/ActivityBarChart'
import { formatDurationMs } from '@/shared/format'
import { toLocalDateKey } from '@/shared/utils'
import type { DailyStat, Settings, SiteConfig, StorageState } from '@/shared/types'

type FormState = {
  domain: string
  enabled: boolean
  dailyLimitMinutes: string
  sessionLimitMinutes: string
  openLimitPerDay: string
  reflectDelaySeconds: string
  reflectMessage: string
  bonusMode: SiteConfig['bonusMode']
}

const emptyForm: FormState = {
  domain: '',
  enabled: true,
  dailyLimitMinutes: '',
  sessionLimitMinutes: '',
  openLimitPerDay: '',
  reflectDelaySeconds: '10',
  reflectMessage: 'Are you sure you wanna spend time on this site?',
  bonusMode: 'strict',
}

type StatSlice = {
  usedMs: number
  openCount: number
}

function valueToNullableInt(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function minsLabel(value: number | null): string {
  if (value === null) {
    return 'off'
  }
  return `${value} min`
}

function formatChartDateLabel(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    return dateKey
  }

  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function buildRecentDateKeys(days: number): string[] {
  const keys: string[] = []
  const now = new Date()

  for (let offset = 0; offset < days; offset += 1) {
    const copy = new Date(now)
    copy.setDate(now.getDate() - offset)
    keys.push(toLocalDateKey(copy))
  }

  return keys
}

function statSliceForDate(stat: DailyStat, dateKey: string): StatSlice {
  if (stat.dateKey === dateKey) {
    return {
      usedMs: stat.usedMs,
      openCount: stat.openCount,
    }
  }

  const snapshot = stat.historyByDate?.[dateKey]
  if (!snapshot) {
    return { usedMs: 0, openCount: 0 }
  }

  return {
    usedMs: snapshot.usedMs,
    openCount: snapshot.openCount,
  }
}

function sumUsedForDates(stat: DailyStat, dateKeys: string[]): number {
  return dateKeys.reduce((sum, dateKey) => sum + statSliceForDate(stat, dateKey).usedMs, 0)
}

function totalUsed(stat: DailyStat): number {
  let sum = stat.usedMs
  const history = stat.historyByDate ?? {}
  for (const dateKey of Object.keys(history)) {
    if (dateKey !== stat.dateKey) {
      sum += history[dateKey].usedMs
    }
  }
  return sum
}

function totalOpens(stat: DailyStat): number {
  let sum = stat.openCount
  const history = stat.historyByDate ?? {}
  for (const dateKey of Object.keys(history)) {
    if (dateKey !== stat.dateKey) {
      sum += history[dateKey].openCount
    }
  }
  return sum
}

function readDailyStat(dailyStats: Record<string, DailyStat>, domain: string): DailyStat {
  return dailyStats[domain] ?? {
    dateKey: '',
    usedMs: 0,
    openCount: 0,
    bonusMs: 0,
    historyByDate: {},
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [siteConfigs, setSiteConfigs] = useState<Record<string, SiteConfig>>({})
  const [dailyStats, setDailyStats] = useState<Record<string, DailyStat>>({})
  const [form, setForm] = useState<FormState>(emptyForm)
  const [status, setStatus] = useState('')
  const loadInFlightRef = useRef(false)

  const orderedSites = useMemo(() => Object.values(siteConfigs).sort((a, b) => a.domain.localeCompare(b.domain)), [siteConfigs])

  const activity = useMemo(() => {
    const todayKey = toLocalDateKey()
    const weekKeys = buildRecentDateKeys(7)
    const monthKeys = buildRecentDateKeys(30)
    const chartDateKeys = [...monthKeys].reverse()

    const siteRows = orderedSites.map((site) => {
      const stat = readDailyStat(dailyStats, site.domain)
      const todaySlice = statSliceForDate(stat, todayKey)

      return {
        domain: site.domain,
        todayMs: todaySlice.usedMs,
        weekMs: sumUsedForDates(stat, weekKeys),
        monthMs: sumUsedForDates(stat, monthKeys),
        totalMs: totalUsed(stat),
        todayOpens: todaySlice.openCount,
        totalOpens: totalOpens(stat),
      }
    }).sort((a, b) => b.todayMs - a.todayMs)

    const chartPoints = chartDateKeys.map((dateKey) => {
      const perDate = orderedSites.reduce((acc, site) => {
        const stat = readDailyStat(dailyStats, site.domain)
        const slice = statSliceForDate(stat, dateKey)

        return {
          usedMs: acc.usedMs + slice.usedMs,
          openCount: acc.openCount + slice.openCount,
        }
      }, {
        usedMs: 0,
        openCount: 0,
      })

      return {
        dateKey,
        label: formatChartDateLabel(dateKey),
        usedMs: perDate.usedMs,
        openCount: perDate.openCount,
      }
    })

    const totals = siteRows.reduce((acc, row) => ({
      todayMs: acc.todayMs + row.todayMs,
      weekMs: acc.weekMs + row.weekMs,
      monthMs: acc.monthMs + row.monthMs,
      totalMs: acc.totalMs + row.totalMs,
    }), {
      todayMs: 0,
      weekMs: 0,
      monthMs: 0,
      totalMs: 0,
    })

    return {
      ...totals,
      siteRows,
      topSites: [...siteRows].sort((a, b) => b.weekMs - a.weekMs).slice(0, 6),
      chartPoints,
    }
  }, [dailyStats, orderedSites])

  const load = async (options?: { silentError?: boolean }) => {
    if (loadInFlightRef.current) {
      return
    }

    loadInFlightRef.current = true
    try {
      const data = await sendRuntimeMessage<StorageState>({ type: 'GET_OPTIONS_DATA' })
      setSettings(data.settings)
      setSiteConfigs(data.siteConfigs)
      setDailyStats(data.dailyStats)
    } catch (error) {
      if (!options?.silentError) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setStatus(`Failed to load settings: ${message}`)
      }
    } finally {
      loadInFlightRef.current = false
    }
  }

  useEffect(() => {
    void load()

    const refreshInterval = window.setInterval(() => {
      void load({ silentError: true })
    }, 1000)

    return () => {
      window.clearInterval(refreshInterval)
    }
  }, [])

  const onInput = (key: keyof FormState, value: string | boolean) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    const reflectDelay = valueToNullableInt(form.reflectDelaySeconds)
    const payload: SiteConfig = {
      domain: form.domain,
      enabled: form.enabled,
      dailyLimitMinutes: valueToNullableInt(form.dailyLimitMinutes),
      sessionLimitMinutes: valueToNullableInt(form.sessionLimitMinutes),
      openLimitPerDay: valueToNullableInt(form.openLimitPerDay),
      reflectDelaySeconds: reflectDelay === null ? 0 : reflectDelay,
      reflectMessage: form.reflectMessage,
      bonusMode: form.bonusMode,
    }

    let result: { success: boolean; error?: string }
    try {
      result = await sendRuntimeMessage<{ success: boolean; error?: string }>({ type: 'UPSERT_SITE', config: payload })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Save failed: ${message}`)
      return
    }

    if (!result.success) {
      setStatus(`Save failed: ${result.error ?? 'unknown error'}`)
      return
    }

    setStatus(`Saved settings for ${form.domain}`)
    setForm(emptyForm)
    await load()
  }

  const onEdit = (config: SiteConfig) => {
    setForm({
      domain: config.domain,
      enabled: config.enabled,
      dailyLimitMinutes: config.dailyLimitMinutes?.toString() ?? '',
      sessionLimitMinutes: config.sessionLimitMinutes?.toString() ?? '',
      openLimitPerDay: config.openLimitPerDay?.toString() ?? '',
      reflectDelaySeconds: String(config.reflectDelaySeconds),
      reflectMessage: config.reflectMessage,
      bonusMode: config.bonusMode,
    })
  }

  const onDelete = async (domain: string) => {
    try {
      const result = await sendRuntimeMessage<{ success: boolean }>({ type: 'DELETE_SITE', domain })
      if (!result.success) {
        setStatus(`Delete failed for ${domain}`)
        return
      }

      setStatus(`Deleted ${domain}`)
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Delete failed for ${domain}: ${message}`)
    }
  }

  const onToggleGlobal = async (enabled: boolean) => {
    try {
      const result = await sendRuntimeMessage<{ success: boolean }>({
        type: 'UPDATE_SETTINGS',
        patch: { extensionEnabled: enabled },
      })

      if (!result.success) {
        setStatus('Failed to update extension state')
        return
      }

      setSettings((prev) => prev ? { ...prev, extensionEnabled: enabled } : prev)
      setStatus(enabled ? 'Extension enabled' : 'Extension disabled')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Failed to update extension state: ${message}`)
    }
  }

  const onUpdateInactivity = async (value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      return
    }

    try {
      const result = await sendRuntimeMessage<{ success: boolean }>({
        type: 'UPDATE_SETTINGS',
        patch: { inactivityThresholdMinutes: parsed },
      })

      if (!result.success) {
        setStatus('Failed to update inactivity threshold')
        return
      }

      setSettings((prev) => prev ? { ...prev, inactivityThresholdMinutes: parsed } : prev)
      setStatus(`Inactivity reset set to ${parsed} min`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Failed to update inactivity threshold: ${message}`)
    }
  }

  return (
    <main className="layout">
      <header className="header">
        <h1>Lock In - site rules</h1>
        <p>Data stays local in browser storage. No backend, no remote tracking.</p>
      </header>

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Global Controls</h2>
        <div className="btnRow">
          <button
            className="btnPrimary"
            onClick={() => onToggleGlobal(true)}
            disabled={settings?.extensionEnabled === true}
          >
            Turn extension ON
          </button>
          <button
            className="btnGhost"
            onClick={() => onToggleGlobal(false)}
            disabled={settings?.extensionEnabled === false}
          >
            Turn extension OFF
          </button>
        </div>

        <div className="row2" style={{ marginTop: 12 }}>
          <label>
            Advanced: inactivity reset threshold (minutes)
            <input
              type="number"
              min={1}
              defaultValue={settings?.inactivityThresholdMinutes ?? 5}
              onBlur={(event) => void onUpdateInactivity(event.target.value)}
            />
          </label>
          <div>
            <span className="pill">Current state: {settings?.extensionEnabled ? 'ON' : 'OFF'}</span>
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Activity</h2>
        <div className="activityStats">
          <article className="activityStat">
            <span>Today</span>
            <strong>{formatDurationMs(activity.todayMs)}</strong>
          </article>
          <article className="activityStat">
            <span>This week</span>
            <strong>{formatDurationMs(activity.weekMs)}</strong>
          </article>
          <article className="activityStat">
            <span>This month</span>
            <strong>{formatDurationMs(activity.monthMs)}</strong>
          </article>
          <article className="activityStat">
            <span>Total screen time</span>
            <strong>{formatDurationMs(activity.totalMs)}</strong>
          </article>
        </div>

        {activity.chartPoints.length > 0 ? (
          <>
            <p className="footerNote" style={{ marginTop: 12 }}>Last 30 days usage trend</p>
            <ActivityBarChart data={activity.chartPoints} />

            {activity.topSites.length > 0 && (
              <div className="activityTopSites">
                <h3>Top sites this week</h3>
                <div className="activityTopSiteList">
                  {activity.topSites.map((site) => (
                    <article key={site.domain} className="activityTopSiteItem">
                      <div>
                        <strong>{site.domain}</strong>
                        <p>{site.todayOpens} opens today</p>
                      </div>
                      <div className="activityTopSiteMetrics">
                        <span>Today: {formatDurationMs(site.todayMs)}</span>
                        <span>7d: {formatDurationMs(site.weekMs)}</span>
                        <span>Total: {formatDurationMs(site.totalMs)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="footerNote">No activity tracked yet.</p>
        )}
      </section>

      <div className="grid">
        <section className="card">
          <h2>Add / Update a site</h2>
          <form onSubmit={onSubmit}>
            <label>
              Website domain
              <input
                value={form.domain}
                onChange={(event) => onInput('domain', event.target.value)}
                placeholder="youtube.com"
                required
              />
            </label>

            <div className="row3">
              <label>
               Max limit per day (min)
                <input
                  type="number"
                  min={0}
                  value={form.dailyLimitMinutes}
                  onChange={(event) => onInput('dailyLimitMinutes', event.target.value)}
                  placeholder="optional"
                />
              </label>
              <label>
                Take a pause every (min)
                <input
                  type="number"
                  min={0}
                  value={form.sessionLimitMinutes}
                  onChange={(event) => onInput('sessionLimitMinutes', event.target.value)}
                  placeholder="optional"
                />
              </label>
              <label>
                Open limit / day
                <input
                  type="number"
                  min={0}
                  value={form.openLimitPerDay}
                  onChange={(event) => onInput('openLimitPerDay', event.target.value)}
                  placeholder="optional"
                />
              </label>
            </div>

            <div className="row2">
              <label>
                Reflect delay (sec)
                <input
                  type="number"
                  min={0}
                  value={form.reflectDelaySeconds}
                  onChange={(event) => onInput('reflectDelaySeconds', event.target.value)}
                />
              </label>
              <label>
                Bonus mode
                <select
                  value={form.bonusMode}
                  onChange={(event) => onInput('bonusMode', event.target.value as SiteConfig['bonusMode'])}
                >
                  <option value="strict">strict</option>
                  <option value="bitch_mode">im a bitch</option>
                </select>
              </label>
            </div>

            <label>
              Reflect message
              <textarea
                rows={3}
                value={form.reflectMessage}
                onChange={(event) => onInput('reflectMessage', event.target.value)}
              />
            </label>

            <label>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => onInput('enabled', event.target.checked)}
              />{' '}
              Enable this site rule
            </label>

            <div className="btnRow">
              <button type="submit" className="btnPrimary">Save site rule</button>
              <button type="button" className="btnGhost" onClick={() => setForm(emptyForm)}>Clear form</button>
            </div>
          </form>

          <div className="status">{status}</div>
        </section>

        <section className="card">
          <h2>Tracked sites</h2>
          {orderedSites.length === 0 && <p>No sites configured yet.</p>}
          {orderedSites.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Limits</th>
                  <th>Today</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orderedSites.map((site) => {
                  const stat = readDailyStat(dailyStats, site.domain)
                  return (
                    <tr key={site.domain}>
                      <td>
                        <strong>{site.domain}</strong>
                        <br />
                        <span className="pill">{site.enabled ? 'enabled' : 'disabled'}</span>
                      </td>
                      <td>
                        <div>daily: {minsLabel(site.dailyLimitMinutes)}</div>
                        <div>pause every: {minsLabel(site.sessionLimitMinutes)}</div>
                        <div>opens/day: {site.openLimitPerDay ?? 'off'}</div>
                        <div>mode: {site.bonusMode === 'strict' ? 'strict' : 'im a bitch'}</div>
                      </td>
                      <td>
                        <div>{formatDurationMs(stat.usedMs)} used</div>
                        <div>{stat.openCount} opens</div>
                      </td>
                      <td>
                        <div className="btnRow">
                          <button className="btnSecondary" onClick={() => onEdit(site)}>Edit</button>
                          <button className="btnGhost" onClick={() => void onDelete(site.domain)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          <p className="footerNote">
            Pause cycle reset: all tabs for a site closed OR away from the site more than the inactivity threshold.
          </p>
        </section>
      </div>
    </main>
  )
}
