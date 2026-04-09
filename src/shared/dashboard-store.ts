import { create } from 'zustand'
import { queryActiveTab, sendRuntimeMessage } from '@/shared/chrome-api'
import { formatDurationMs } from '@/shared/format'
import type { DashboardData } from '@/shared/types'

const LIVE_TICK_INTERVAL_MS = 1000
const SYNC_INTERVAL_MS = 1000

type LiveSnapshot = {
  domain: string
  capturedAtMs: number
  usedTodayMs: number
  dailyRemainingMs: number | null
}

type RefreshOptions = {
  silentError?: boolean
  keepStatus?: boolean
}

type DashboardStore = {
  data: DashboardData | null
  status: string
  liveNowMs: number
  liveSnapshot: LiveSnapshot | null
  isInitialized: boolean
  tickHandle: number | null
  syncHandle: number | null
  refresh: (options?: RefreshOptions) => Promise<void>
  initAutoSync: () => void
  stopAutoSync: () => void
  setStatus: (status: string) => void
  clearStatus: () => void
  getDisplayedUsedToday: () => string | undefined
  getDisplayedDailyRemaining: () => string | undefined
}

let refreshInFlight = false

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  data: null,
  status: '',
  liveNowMs: Date.now(),
  liveSnapshot: null,
  isInitialized: false,
  tickHandle: null,
  syncHandle: null,

  refresh: async (options) => {
    if (refreshInFlight) {
      return
    }

    refreshInFlight = true
    try {
      const activeTab = await queryActiveTab()
      const payload = await sendRuntimeMessage<DashboardData>({
        type: 'GET_DASHBOARD_DATA',
        activeUrl: activeTab?.url,
      })

      const nowMs = Date.now()
      set((state) => {
        let nextSnapshot: LiveSnapshot | null = null

        if (payload.settings.extensionEnabled && payload.activeSummary) {
          const serverUsedMs = payload.activeSummary.usedTodayMs
          const serverRemainingMs = payload.activeSummary.dailyRemainingMs

          if (!state.liveSnapshot || state.liveSnapshot.domain !== payload.activeSummary.domain) {
            nextSnapshot = {
              domain: payload.activeSummary.domain,
              capturedAtMs: nowMs,
              usedTodayMs: serverUsedMs,
              dailyRemainingMs: serverRemainingMs,
            }
          } else {
            const elapsedMs = Math.max(0, nowMs - state.liveSnapshot.capturedAtMs)
            const optimisticUsedMs = state.liveSnapshot.usedTodayMs + elapsedMs
            const optimisticRemainingMs = state.liveSnapshot.dailyRemainingMs === null
              ? null
              : Math.max(0, state.liveSnapshot.dailyRemainingMs - elapsedMs)

            const mergedUsedMs = Math.max(serverUsedMs, optimisticUsedMs)
            let mergedRemainingMs: number | null
            if (serverRemainingMs === null) {
              mergedRemainingMs = null
            } else if (optimisticRemainingMs === null) {
              mergedRemainingMs = serverRemainingMs
            } else {
              mergedRemainingMs = Math.min(serverRemainingMs, optimisticRemainingMs)
            }

            nextSnapshot = {
              domain: payload.activeSummary.domain,
              capturedAtMs: nowMs,
              usedTodayMs: mergedUsedMs,
              dailyRemainingMs: mergedRemainingMs,
            }
          }
        }

        return {
          data: payload,
          liveSnapshot: nextSnapshot,
          status: options?.keepStatus ? state.status : '',
        }
      })
    } catch (error) {
      if (!options?.silentError) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        set({ status: `Failed to load popup data: ${message}` })
      }
    } finally {
      refreshInFlight = false
    }
  },

  initAutoSync: () => {
    if (get().isInitialized) {
      return
    }

    const tickHandle = window.setInterval(() => {
      set({ liveNowMs: Date.now() })
    }, LIVE_TICK_INTERVAL_MS)

    const syncHandle = window.setInterval(() => {
      void get().refresh({ silentError: true, keepStatus: true })
    }, SYNC_INTERVAL_MS)

    set({
      isInitialized: true,
      tickHandle,
      syncHandle,
      liveNowMs: Date.now(),
    })
  },

  stopAutoSync: () => {
    const { tickHandle, syncHandle } = get()
    if (tickHandle !== null) {
      window.clearInterval(tickHandle)
    }
    if (syncHandle !== null) {
      window.clearInterval(syncHandle)
    }

    set({
      isInitialized: false,
      tickHandle: null,
      syncHandle: null,
    })
  },

  setStatus: (status) => {
    set({ status })
  },

  clearStatus: () => {
    set({ status: '' })
  },

  getDisplayedUsedToday: () => {
    const state = get()
    const activeSummary = state.data?.activeSummary
    if (!activeSummary) {
      return undefined
    }

    if (
      state.data?.settings.extensionEnabled
      && state.liveSnapshot
      && state.liveSnapshot.domain === activeSummary.domain
    ) {
      const elapsedMs = Math.max(0, state.liveNowMs - state.liveSnapshot.capturedAtMs)
      return formatDurationMs(state.liveSnapshot.usedTodayMs + elapsedMs)
    }

    return formatDurationMs(activeSummary.usedTodayMs)
  },

  getDisplayedDailyRemaining: () => {
    const state = get()
    const activeSummary = state.data?.activeSummary
    if (!activeSummary) {
      return undefined
    }

    if (
      state.data?.settings.extensionEnabled
      && state.liveSnapshot
      && state.liveSnapshot.domain === activeSummary.domain
    ) {
      const elapsedMs = Math.max(0, state.liveNowMs - state.liveSnapshot.capturedAtMs)
      return formatDurationMs(
        state.liveSnapshot.dailyRemainingMs === null
          ? null
          : Math.max(0, state.liveSnapshot.dailyRemainingMs - elapsedMs),
      )
    }

    return formatDurationMs(activeSummary.dailyRemainingMs)
  },
}))
