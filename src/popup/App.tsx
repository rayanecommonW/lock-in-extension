import { useCallback, useEffect, useRef, useState } from 'react'
import { openOptionsPage, queryActiveTab, sendRuntimeMessage } from '@/shared/chrome-api'

type DashboardPayload = {
  settings: {
    extensionEnabled: boolean
  }
  totalSites: number
  activeDomain: string | null
  activeHasRule: boolean
  activeSummary: {
    domain: string
    usedToday: string
    dailyRemaining: string
    opensToday: number
  } | null
}

export default function App() {
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [addingRule, setAddingRule] = useState(false)
  const [quickDailyMinutes, setQuickDailyMinutes] = useState('30')
  const [quickPauseMinutes, setQuickPauseMinutes] = useState('')
  const [quickOpenLimitPerDay, setQuickOpenLimitPerDay] = useState('')
  const [status, setStatus] = useState('')
  const loadInFlightRef = useRef(false)

  const load = useCallback(async (options?: { silentError?: boolean; keepStatus?: boolean }) => {
    if (loadInFlightRef.current) {
      return
    }

    loadInFlightRef.current = true
    try {
      const activeTab = await queryActiveTab()
      const payload = await sendRuntimeMessage<DashboardPayload>({
        type: 'GET_DASHBOARD_DATA',
        activeUrl: activeTab?.url,
      })
      setData(payload)

      if (!options?.keepStatus) {
        setStatus('')
      }
    } catch (error) {
      if (!options?.silentError) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setStatus(`Failed to load popup data: ${message}`)
      }
    } finally {
      loadInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    void load()

    const refreshInterval = window.setInterval(() => {
      void load({ silentError: true, keepStatus: true })
    }, 1000)

    return () => {
      window.clearInterval(refreshInterval)
    }
  }, [load])

  const toggleEnabled = async () => {
    if (!data || busy) {
      return
    }
    setBusy(true)
    try {
      const result = await sendRuntimeMessage<{ success: boolean }>({
        type: 'UPDATE_SETTINGS',
        patch: { extensionEnabled: !data.settings.extensionEnabled },
      })

      if (!result.success) {
        setStatus('Failed to update extension state.')
        return
      }

      await load()
      setStatus('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Failed to update extension state: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  const addCurrentSiteRule = async () => {
    if (!data?.activeDomain || data.activeHasRule || addingRule) {
      return
    }

    const parsedMinutes = Number.parseInt(quickDailyMinutes, 10)
    if (!Number.isFinite(parsedMinutes) || parsedMinutes < 1) {
      setStatus('Please enter a valid daily limit (at least 1 minute).')
      return
    }

    const pauseEveryRaw = quickPauseMinutes.trim()
    const pauseEveryParsed = pauseEveryRaw ? Number.parseInt(pauseEveryRaw, 10) : null
    if (pauseEveryRaw && (!Number.isFinite(pauseEveryParsed) || pauseEveryParsed === null || pauseEveryParsed < 1)) {
      setStatus('Take a pause every must be at least 1 minute or left empty.')
      return
    }

    const openLimitRaw = quickOpenLimitPerDay.trim()
    const openLimitParsed = openLimitRaw ? Number.parseInt(openLimitRaw, 10) : null
    if (openLimitRaw && (!Number.isFinite(openLimitParsed) || openLimitParsed === null || openLimitParsed < 1)) {
      setStatus('Open limit per day must be at least 1 or left empty.')
      return
    }

    const domain = data.activeDomain
    setAddingRule(true)
    try {
      const result = await sendRuntimeMessage<{ success: boolean; error?: string }>({
        type: 'UPSERT_SITE',
        config: {
          domain,
          enabled: true,
          dailyLimitMinutes: parsedMinutes,
          sessionLimitMinutes: pauseEveryParsed,
          openLimitPerDay: openLimitParsed,
          reflectDelaySeconds: 10,
          reflectMessage: 'Are you sure you want to spend time on this site?',
          bonusMode: 'strict',
        },
      })

      if (!result.success) {
        setStatus(`Failed to add rule: ${result.error ?? 'unknown error'}`)
        return
      }

      await load()
      setStatus(`Added ${domain} with ${parsedMinutes} min/day.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Failed to add rule: ${message}`)
    } finally {
      setAddingRule(false)
    }
  }

  const openSettings = () => {
    void openOptionsPage().catch((error) => {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Failed to open settings: ${message}`)
    })
  }

  return (
    <main className="popupRoot">
      <header className="popupHeader">
        <h1>Lock In</h1>
        <p>Focus manager for browser time.</p>
      </header>

      <section className="card">
        <div className="rowBetween">
          <span>Status</span>
          <span className={`badge ${data?.settings.extensionEnabled ? 'on' : 'off'}`}>
            {data?.settings.extensionEnabled ? 'ON' : 'OFF'}
          </span>
        </div>
        <button className="btnPrimary" disabled={busy || !data || addingRule} onClick={() => void toggleEnabled()}>
          {data?.settings.extensionEnabled ? 'Disable extension' : 'Enable extension'}
        </button>
      </section>

      <section className="card">
        <div className="rowBetween">
          <span>Tracked sites</span>
          <strong>{data?.totalSites ?? 0}</strong>
        </div>
        {data?.activeSummary ? (
          <div className="activeSite">
            <h2>{data.activeSummary.domain}</h2>
            <p>Used today: {data.activeSummary.usedToday}</p>
            <p>Remaining today: {data.activeSummary.dailyRemaining}</p>
            <p>Opens today: {data.activeSummary.opensToday}</p>
          </div>
        ) : data?.activeDomain ? (
          data.activeHasRule ? (
            <p className="muted">Current tab already has a rule.</p>
          ) : (
            <div className="quickAddBox">
              <p className="muted">Current tab is not tracked yet: {data.activeDomain}</p>
              <div className="quickFields">
                <label className="quickLabel" htmlFor="quick-daily-limit">Daily limit (min)</label>
                <input
                  id="quick-daily-limit"
                  className="quickInput"
                  type="number"
                  min={1}
                  step={1}
                  value={quickDailyMinutes}
                  onChange={(event) => setQuickDailyMinutes(event.target.value)}
                />

                <label className="quickLabel" htmlFor="quick-pause-limit">Take a pause every (min)</label>
                <input
                  id="quick-pause-limit"
                  className="quickInput"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="optional"
                  value={quickPauseMinutes}
                  onChange={(event) => setQuickPauseMinutes(event.target.value)}
                />

                <label className="quickLabel" htmlFor="quick-open-limit">Open limit / day</label>
                <input
                  id="quick-open-limit"
                  className="quickInput"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="optional"
                  value={quickOpenLimitPerDay}
                  onChange={(event) => setQuickOpenLimitPerDay(event.target.value)}
                />
              </div>

              <button
                className="btnSmall btnQuickAdd"
                disabled={addingRule || busy}
                onClick={() => void addCurrentSiteRule()}
              >
                {addingRule ? 'Adding...' : 'Add this site'}
              </button>
            </div>
          )
        ) : (
          <p className="muted">Current tab is not trackable.</p>
        )}
      </section>

      {status && <p className="muted">{status}</p>}

      <button className="btnGhost" onClick={openSettings}>Open full settings</button>
    </main>
  )
}
