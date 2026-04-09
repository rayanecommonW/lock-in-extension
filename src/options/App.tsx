import { useEffect, useMemo, useState } from 'react'
import { sendRuntimeMessage } from '@/shared/chrome-api'
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

function readDailyStat(dailyStats: Record<string, DailyStat>, domain: string): DailyStat {
  return dailyStats[domain] ?? {
    dateKey: '',
    usedMs: 0,
    openCount: 0,
    bonusMs: 0,
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [siteConfigs, setSiteConfigs] = useState<Record<string, SiteConfig>>({})
  const [dailyStats, setDailyStats] = useState<Record<string, DailyStat>>({})
  const [form, setForm] = useState<FormState>(emptyForm)
  const [status, setStatus] = useState('')

  const orderedSites = useMemo(() => Object.values(siteConfigs).sort((a, b) => a.domain.localeCompare(b.domain)), [siteConfigs])

  const load = async () => {
    try {
      const data = await sendRuntimeMessage<StorageState>({ type: 'GET_OPTIONS_DATA' })
      setSettings(data.settings)
      setSiteConfigs(data.siteConfigs)
      setDailyStats(data.dailyStats)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Failed to load settings: ${message}`)
    }
  }

  useEffect(() => {
    void load()
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
                        <div>{Math.floor(stat.usedMs / 60000)} min used</div>
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
