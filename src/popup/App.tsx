import { useEffect, useState } from 'react'

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

  const load = async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const payload = await chrome.runtime.sendMessage({
      type: 'GET_DASHBOARD_DATA',
      activeUrl: activeTab?.url,
    }) as DashboardPayload
    setData(payload)
  }

  useEffect(() => {
    void load()
  }, [])

  const toggleEnabled = async () => {
    if (!data || busy) {
      return
    }
    setBusy(true)
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      patch: { extensionEnabled: !data.settings.extensionEnabled },
    })
    await load()
    setBusy(false)
  }

  const openSettings = () => {
    void chrome.runtime.openOptionsPage()
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
        <button className="btnPrimary" disabled={busy} onClick={() => void toggleEnabled()}>
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

      <button className="btnGhost" onClick={openSettings}>Open full settings</button>
    </main>
  )
}
