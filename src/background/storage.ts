import type { DailyStat, DomainSession, Settings, SiteConfig, StorageState } from '@/shared/types'

const KEY_SITE_CONFIGS = 'siteConfigs'
const KEY_DAILY_STATS = 'dailyStats'
const KEY_SESSIONS = 'sessions'
const KEY_SETTINGS = 'settings'

const SCHEMA_VERSION = 1

const DEFAULT_SETTINGS: Settings = {
  extensionEnabled: true,
  inactivityThresholdMinutes: 5,
  schemaVersion: SCHEMA_VERSION,
}

let mutationQueue: Promise<void> = Promise.resolve()

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type SiteConfigCompat = Omit<SiteConfig, 'bonusMode'> & {
  bonusMode?: unknown
}

function asSiteConfigs(value: unknown): Record<string, SiteConfig> {
  if (!isObject(value)) {
    return {}
  }

  const rawConfigs = value as Record<string, SiteConfigCompat>
  const normalizedConfigs: Record<string, SiteConfig> = {}

  for (const domain of Object.keys(rawConfigs)) {
    const config = rawConfigs[domain]
    if (!isObject(config)) {
      continue
    }

    const normalizedBonusMode = config.bonusMode === 'strict' ? 'strict' : 'bitch_mode'

    normalizedConfigs[domain] = {
      ...(config as SiteConfig),
      bonusMode: normalizedBonusMode,
    }
  }

  return normalizedConfigs
}

function normalizeMsCounter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

function normalizeHistoryByDate(value: unknown): Record<string, { usedMs: number; openCount: number; bonusMs: number }> {
  if (!isObject(value)) {
    return {}
  }

  const rawHistory = value as Record<string, unknown>
  const normalizedHistory: Record<string, { usedMs: number; openCount: number; bonusMs: number }> = {}

  for (const dateKey of Object.keys(rawHistory)) {
    const rawEntry = rawHistory[dateKey]
    if (!isObject(rawEntry)) {
      continue
    }

    normalizedHistory[dateKey] = {
      usedMs: normalizeMsCounter(rawEntry.usedMs),
      openCount: normalizeMsCounter(rawEntry.openCount),
      bonusMs: normalizeMsCounter(rawEntry.bonusMs),
    }
  }

  return normalizedHistory
}

function asDailyStats(value: unknown): Record<string, DailyStat> {
  if (!isObject(value)) {
    return {}
  }

  const rawStats = value as Record<string, unknown>
  const normalizedStats: Record<string, DailyStat> = {}

  for (const domain of Object.keys(rawStats)) {
    const rawStat = rawStats[domain]
    if (!isObject(rawStat)) {
      continue
    }

    normalizedStats[domain] = {
      dateKey: typeof rawStat.dateKey === 'string' ? rawStat.dateKey : '',
      usedMs: normalizeMsCounter(rawStat.usedMs),
      openCount: normalizeMsCounter(rawStat.openCount),
      bonusMs: normalizeMsCounter(rawStat.bonusMs),
      historyByDate: normalizeHistoryByDate(rawStat.historyByDate),
    }
  }

  return normalizedStats
}

function asSessions(value: unknown): Record<string, DomainSession> {
  return isObject(value) ? (value as Record<string, DomainSession>) : {}
}

function asSettings(value: unknown): Settings {
  if (!isObject(value)) {
    return { ...DEFAULT_SETTINGS }
  }

  const raw = value as Partial<Settings>
  return {
    extensionEnabled: typeof raw.extensionEnabled === 'boolean' ? raw.extensionEnabled : DEFAULT_SETTINGS.extensionEnabled,
    inactivityThresholdMinutes: typeof raw.inactivityThresholdMinutes === 'number' && raw.inactivityThresholdMinutes > 0
      ? raw.inactivityThresholdMinutes
      : DEFAULT_SETTINGS.inactivityThresholdMinutes,
    schemaVersion: DEFAULT_SETTINGS.schemaVersion,
  }
}

export async function ensureStorageInitialized(): Promise<void> {
  const raw = await chrome.storage.local.get([KEY_SITE_CONFIGS, KEY_DAILY_STATS, KEY_SESSIONS, KEY_SETTINGS])
  const updates: Record<string, unknown> = {}

  if (!isObject(raw[KEY_SITE_CONFIGS])) {
    updates[KEY_SITE_CONFIGS] = {}
  }
  if (!isObject(raw[KEY_DAILY_STATS])) {
    updates[KEY_DAILY_STATS] = {}
  }
  if (!isObject(raw[KEY_SESSIONS])) {
    updates[KEY_SESSIONS] = {}
  }

  const settings = asSettings(raw[KEY_SETTINGS])
  if (!isObject(raw[KEY_SETTINGS]) || settings.schemaVersion !== SCHEMA_VERSION) {
    updates[KEY_SETTINGS] = settings
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates)
  }
}

export async function loadState(): Promise<StorageState> {
  await ensureStorageInitialized()
  const raw = await chrome.storage.local.get([KEY_SITE_CONFIGS, KEY_DAILY_STATS, KEY_SESSIONS, KEY_SETTINGS])

  return {
    siteConfigs: asSiteConfigs(raw[KEY_SITE_CONFIGS]),
    dailyStats: asDailyStats(raw[KEY_DAILY_STATS]),
    sessions: asSessions(raw[KEY_SESSIONS]),
    settings: asSettings(raw[KEY_SETTINGS]),
  }
}

export async function saveState(state: StorageState): Promise<void> {
  await chrome.storage.local.set({
    [KEY_SITE_CONFIGS]: state.siteConfigs,
    [KEY_DAILY_STATS]: state.dailyStats,
    [KEY_SESSIONS]: state.sessions,
    [KEY_SETTINGS]: state.settings,
  })
}

export function mutateState<T>(mutator: (state: StorageState) => Promise<T> | T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    mutationQueue = mutationQueue.then(async () => {
      try {
        const state = await loadState()
        const result = await mutator(state)
        await saveState(state)
        resolve(result)
      } catch (error) {
        reject(error)
      }
    }).catch(() => {
      // Keep queue alive after a failure.
    })
  })
}
