import { useEffect, useMemo, useState } from 'react'
import { openOptionsPage, sendRuntimeMessage } from '@/shared/chrome-api'
import { useDashboardStore } from '@/shared/dashboard-store'

export default function App() {
  const [busy, setBusy] = useState(false)
  const [addingRule, setAddingRule] = useState(false)
  const [quickDailyMinutes, setQuickDailyMinutes] = useState('30')
  const [quickPauseMinutes, setQuickPauseMinutes] = useState('')
  const [quickOpenLimitPerDay, setQuickOpenLimitPerDay] = useState('')
  const data = useDashboardStore((state) => state.data)
  const status = useDashboardStore((state) => state.status)
  const refresh = useDashboardStore((state) => state.refresh)
  const initAutoSync = useDashboardStore((state) => state.initAutoSync)
  const stopAutoSync = useDashboardStore((state) => state.stopAutoSync)
  const setStatus = useDashboardStore((state) => state.setStatus)
  const getDisplayedUsedToday = useDashboardStore((state) => state.getDisplayedUsedToday)
  const getDisplayedDailyRemaining = useDashboardStore((state) => state.getDisplayedDailyRemaining)
  const liveNowMs = useDashboardStore((state) => state.liveNowMs)

  useEffect(() => {
    void refresh()
    initAutoSync()

    const onFocus = () => {
      void refresh({ silentError: true, keepStatus: true })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh({ silentError: true, keepStatus: true })
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopAutoSync()
    }
  }, [initAutoSync, refresh, stopAutoSync])

  const displayedUsedToday = useMemo(() => getDisplayedUsedToday(), [data, liveNowMs, getDisplayedUsedToday])
  const displayedDailyRemaining = useMemo(() => getDisplayedDailyRemaining(), [data, liveNowMs, getDisplayedDailyRemaining])

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

      await refresh()
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

      await refresh()
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
            <p>Used today: {displayedUsedToday}</p>
            <p>Remaining today: {displayedDailyRemaining}</p>
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
