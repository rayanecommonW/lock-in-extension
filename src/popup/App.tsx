import { useEffect, useState } from 'react'
import { openOptionsPage, queryActiveTab, sendRuntimeMessage } from '@/shared/chrome-api'

type DashboardPayload = {
  settings: {
    extensionEnabled: boolean
  }
  totalSites: number
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
  const [status, setStatus] = useState('')

  const load = async () => {
    try {
      const activeTab = await queryActiveTab()
      const payload = await sendRuntimeMessage<DashboardPayload>({
        type: 'GET_DASHBOARD_DATA',
        activeUrl: activeTab?.url,
      })
      setData(payload)
      setStatus('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStatus(`Failed to load popup data: ${message}`)
    }
  }

  useEffect(() => {
    void load()
  }, [])

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
        <button className="btnPrimary" disabled={busy || !data} onClick={() => void toggleEnabled()}>
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
        ) : (
          <p className="muted">Current tab is not tracked.</p>
        )}
      </section>

      {status && <p className="muted">{status}</p>}

      <button className="btnGhost" onClick={openSettings}>Open full settings</button>
    </main>
  )
}
