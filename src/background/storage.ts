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

function asSiteConfigs(value: unknown): Record<string, SiteConfig> {
  return isObject(value) ? (value as Record<string, SiteConfig>) : {}
}

function asDailyStats(value: unknown): Record<string, DailyStat> {
  return isObject(value) ? (value as Record<string, DailyStat>) : {}
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
