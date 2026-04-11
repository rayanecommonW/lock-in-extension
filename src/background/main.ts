import { mutateState, ensureStorageInitialized } from '@/background/storage'
import type {
  AccessDecision,
  BlockReason,
  DashboardData,
  DailyStat,
  DomainSession,
  ExtensionRequest,
  SiteConfig,
  StorageState,
} from '@/shared/types'
import {
  createSessionId,
  findMatchingConfigDomain,
  minutesToMs,
  normalizeDomainInput,
  parseDomainFromUrl,
  toLocalDateKey,
} from '@/shared/utils'

const CLEANUP_ALARM = 'lock-in-cleanup'
const MIDNIGHT_RESET_ALARM = 'lock-in-midnight-reset'
const ONE_MINUTE = 1
const ONE_MINUTE_MS = 60_000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const HISTORY_RETENTION_DAYS = 35
const BONUS_FIVE_MINUTES_MS = 5 * 60_000
const HEARTBEAT_TICK_MS = 1000
const BONUS_DEBOUNCE_MS = 1000

function createEmptyDailyStat(dateKey: string): DailyStat {
  return {
    dateKey,
    usedMs: 0,
    openCount: 0,
    bonusMs: 0,
    historyByDate: {},
  }
}

function pruneHistoryByDate(
  historyByDate: Record<string, { usedMs: number; openCount: number; bonusMs: number }>,
  referenceDateKey: string,
): Record<string, { usedMs: number; openCount: number; bonusMs: number }> {
  const cutoffDate = new Date()
  cutoffDate.setTime(cutoffDate.getTime() - (HISTORY_RETENTION_DAYS - 1) * ONE_DAY_MS)
  const cutoffDateKey = toLocalDateKey(cutoffDate)

  const pruned: Record<string, { usedMs: number; openCount: number; bonusMs: number }> = {}
  for (const dateKey of Object.keys(historyByDate)) {
    if (dateKey >= cutoffDateKey && dateKey <= referenceDateKey) {
      pruned[dateKey] = historyByDate[dateKey]
    }
  }

  return pruned
}

function rollStatIntoHistory(stat: DailyStat, nextDateKey: string): DailyStat {
  const currentHistory = stat.historyByDate ?? {}
  const nextHistory = {
    ...currentHistory,
    [stat.dateKey]: {
      usedMs: stat.usedMs,
      openCount: stat.openCount,
      bonusMs: stat.bonusMs,
    },
  }

  return {
    dateKey: nextDateKey,
    usedMs: 0,
    openCount: 0,
    bonusMs: 0,
    historyByDate: pruneHistoryByDate(nextHistory, nextDateKey),
  }
}

function createSession(domain: string, nowMs: number, reflectCompleted: boolean): DomainSession {
  return {
    id: createSessionId(),
    domain,
    startedAt: nowMs,
    lastActivityAt: nowMs,
    usedMs: 0,
    reflectCompleted,
    openTabIds: [],
    bonusMs: 0,
    lastBonusGrantAt: null,
  }
}

function ensureDailyStat(state: StorageState, domain: string, dateKey: string): DailyStat {
  const current = state.dailyStats[domain]
  if (!current) {
    const reset = createEmptyDailyStat(dateKey)
    state.dailyStats[domain] = reset
    return reset
  }

  if (current.dateKey !== dateKey) {
    const rolled = rollStatIntoHistory(current, dateKey)
    state.dailyStats[domain] = rolled
    return rolled
  }

  current.historyByDate = pruneHistoryByDate(current.historyByDate ?? {}, dateKey)
  return current
}

function runDailyReset(state: StorageState, dateKey: string): void {
  for (const domain of Object.keys(state.dailyStats)) {
    ensureDailyStat(state, domain, dateKey)
  }
}

function resetTodayStats(state: StorageState, dateKey: string): void {
  runDailyReset(state, dateKey)

  for (const domain of Object.keys(state.siteConfigs)) {
    const stat = ensureDailyStat(state, domain, dateKey)
    stat.usedMs = 0
    stat.openCount = 0
    stat.bonusMs = 0
  }

  for (const domain of Object.keys(state.dailyStats)) {
    const stat = ensureDailyStat(state, domain, dateKey)
    stat.usedMs = 0
    stat.openCount = 0
    stat.bonusMs = 0
  }
}

function ensureSession(state: StorageState, domain: string, nowMs: number, reflectCompleted: boolean): DomainSession {
  const current = state.sessions[domain]
  if (!current) {
    const session = createSession(domain, nowMs, reflectCompleted)
    state.sessions[domain] = session
    return session
  }
  return current
}

function includeTab(session: DomainSession, tabId: number): void {
  if (tabId >= 0 && !session.openTabIds.includes(tabId)) {
    session.openTabIds.push(tabId)
  }
}

function isSessionPauseDue(config: SiteConfig, session: DomainSession): boolean {
  const sessionLimitMs = minutesToMs(config.sessionLimitMinutes)
  if (sessionLimitMs === null) {
    return false
  }

  return session.usedMs >= sessionLimitMs + session.bonusMs
}

function activateSessionPause(session: DomainSession, nowMs: number): void {
  session.reflectCompleted = false
  session.usedMs = 0
  session.bonusMs = 0
  session.startedAt = nowMs
  session.lastActivityAt = nowMs
}

function createSessionPauseDecision(config: SiteConfig, domain: string, daily: DailyStat, session: DomainSession): AccessDecision {
  const dailyLimitMs = minutesToMs(config.dailyLimitMinutes)
  const sessionLimitMs = minutesToMs(config.sessionLimitMinutes)
  const openLimit = config.openLimitPerDay

  return {
    action: 'reflect',
    matchedDomain: domain,
    reason: 'session_limit',
    reflectDelaySeconds: config.reflectDelaySeconds,
    reflectMessage: 'Take a short pause before continuing.',
    remainingDailyMs: dailyLimitMs === null
      ? null
      : Math.max(0, dailyLimitMs + daily.bonusMs - daily.usedMs),
    remainingSessionMs: sessionLimitMs === null
      ? null
      : Math.max(0, sessionLimitMs + session.bonusMs - session.usedMs),
    openCount: daily.openCount,
    openLimit,
  }
}

function getTimeBlockReason(config: SiteConfig, daily: DailyStat, session: DomainSession): BlockReason | null {
  const dailyLimitMs = minutesToMs(config.dailyLimitMinutes)
  if (dailyLimitMs !== null && daily.usedMs >= dailyLimitMs + daily.bonusMs) {
    return 'daily_limit'
  }

  const sessionLimitMs = minutesToMs(config.sessionLimitMinutes)
  if (sessionLimitMs !== null && session.usedMs >= sessionLimitMs + session.bonusMs) {
    return 'session_limit'
  }

  return null
}

function toDecision(config: SiteConfig, domain: string, daily: DailyStat, session: DomainSession): AccessDecision {
  const openLimit = config.openLimitPerDay
  if (openLimit !== null && daily.openCount > openLimit) {
    return {
      action: 'block',
      matchedDomain: domain,
      reason: 'open_limit',
      canAddFive: false,
      openCount: daily.openCount,
      openLimit,
    }
  }

  const dailyLimitMs = minutesToMs(config.dailyLimitMinutes)
  if (dailyLimitMs !== null && daily.usedMs >= dailyLimitMs + daily.bonusMs) {
    return {
      action: 'block',
      matchedDomain: domain,
      reason: 'daily_limit',
      canAddFive: config.bonusMode === 'bitch_mode',
      openCount: daily.openCount,
      openLimit,
    }
  }

  const sessionLimitMs = minutesToMs(config.sessionLimitMinutes)

  const remainingDailyMs = dailyLimitMs === null
    ? null
    : Math.max(0, dailyLimitMs + daily.bonusMs - daily.usedMs)
  const remainingSessionMs = sessionLimitMs === null
    ? null
    : Math.max(0, sessionLimitMs + session.bonusMs - session.usedMs)

  if (!session.reflectCompleted && config.reflectDelaySeconds > 0) {
    return {
      action: 'reflect',
      matchedDomain: domain,
      reflectDelaySeconds: config.reflectDelaySeconds,
      reflectMessage: config.reflectMessage,
      remainingDailyMs,
      remainingSessionMs,
      openCount: daily.openCount,
      openLimit,
    }
  }

  return {
    action: 'allow',
    matchedDomain: domain,
    remainingDailyMs,
    remainingSessionMs,
    openCount: daily.openCount,
    openLimit,
  }
}

function getSiteFromUrl(url: string, state: StorageState): { domain: string; config: SiteConfig } | null {
  const host = parseDomainFromUrl(url)
  if (!host) {
    return null
  }

  const matchedDomain = findMatchingConfigDomain(host, state.siteConfigs)
  if (!matchedDomain) {
    return null
  }

  const config = state.siteConfigs[matchedDomain]
  if (!config || !config.enabled) {
    return null
  }

  return {
    domain: matchedDomain,
    config,
  }
}

function sanitizeSiteConfig(input: SiteConfig): SiteConfig | null {
  const domain = normalizeDomainInput(input.domain)
  if (!domain) {
    return null
  }

  const normalizedDaily = input.dailyLimitMinutes === null ? null : Math.max(0, Math.floor(input.dailyLimitMinutes))
  const normalizedSession = input.sessionLimitMinutes === null ? null : Math.max(0, Math.floor(input.sessionLimitMinutes))
  const normalizedOpen = input.openLimitPerDay === null ? null : Math.max(0, Math.floor(input.openLimitPerDay))
  const reflectDelaySeconds = Math.max(0, Math.floor(input.reflectDelaySeconds))
  const rawBonusMode = String(input.bonusMode)

  return {
    domain,
    enabled: Boolean(input.enabled),
    dailyLimitMinutes: normalizedDaily,
    sessionLimitMinutes: normalizedSession,
    openLimitPerDay: normalizedOpen,
    reflectDelaySeconds,
    reflectMessage: input.reflectMessage.trim() || 'Are you sure you want to spend time on this site?',
    bonusMode: rawBonusMode === 'strict' ? 'strict' : 'bitch_mode',
  }
}

async function handleCheckAccess(request: ExtensionRequest, tabId: number): Promise<AccessDecision> {
  if (request.type !== 'CHECK_ACCESS') {
    return { action: 'allow', matchedDomain: null }
  }

  return mutateState(async (state) => {
    const dateKey = toLocalDateKey()
    runDailyReset(state, dateKey)

    if (!state.settings.extensionEnabled) {
      return { action: 'allow', matchedDomain: null }
    }

    const site = getSiteFromUrl(request.url, state)
    if (!site) {
      return { action: 'allow', matchedDomain: null }
    }

    const now = Date.now()
    const inactivityMs = Math.max(1, Math.floor(state.settings.inactivityThresholdMinutes * 60_000))
    const daily = ensureDailyStat(state, site.domain, dateKey)
    let session = ensureSession(state, site.domain, now, false)

    if (now - session.lastActivityAt > inactivityMs) {
      session = createSession(site.domain, now, false)
      state.sessions[site.domain] = session
    }

    includeTab(session, tabId)

    if (request.reason === 'navigate') {
      daily.openCount += 1
    }

    if (session.reflectCompleted && isSessionPauseDue(site.config, session)) {
      activateSessionPause(session, now)
      return createSessionPauseDecision(site.config, site.domain, daily, session)
    }

    return toDecision(site.config, site.domain, daily, session)
  })
}

async function handleCompleteReflect(request: ExtensionRequest, tabId: number): Promise<{ success: boolean }> {
  if (request.type !== 'COMPLETE_REFLECT') {
    return { success: false }
  }

  return mutateState(async (state) => {
    const config = state.siteConfigs[request.domain]
    if (!config) {
      return { success: false }
    }

    const now = Date.now()
    let session = ensureSession(state, request.domain, now, true)
    if (!session.reflectCompleted) {
      session.reflectCompleted = true
    }
    session.lastActivityAt = now
    includeTab(session, tabId)
    state.sessions[request.domain] = session
    return { success: true }
  })
}

async function handleHeartbeat(request: ExtensionRequest, tabId: number): Promise<AccessDecision> {
  if (request.type !== 'HEARTBEAT') {
    return { action: 'allow', matchedDomain: null }
  }

  return mutateState(async (state) => {
    const dateKey = toLocalDateKey()
    runDailyReset(state, dateKey)

    if (!state.settings.extensionEnabled) {
      return { action: 'allow', matchedDomain: null }
    }

    const site = getSiteFromUrl(request.url, state)
    if (!site) {
      return { action: 'allow', matchedDomain: null }
    }

    const now = Date.now()
    const inactivityMs = Math.max(1, Math.floor(state.settings.inactivityThresholdMinutes * 60_000))
    const daily = ensureDailyStat(state, site.domain, dateKey)
    let session = ensureSession(state, site.domain, now, true)

    includeTab(session, tabId)

    if (request.active && now - session.lastActivityAt > inactivityMs) {
      session = createSession(site.domain, now, false)
      includeTab(session, tabId)
      state.sessions[site.domain] = session
      return toDecision(site.config, site.domain, daily, session)
    }

    if (request.active && session.reflectCompleted && isSessionPauseDue(site.config, session)) {
      activateSessionPause(session, now)
      return createSessionPauseDecision(site.config, site.domain, daily, session)
    }

    if (request.active) {
      session.lastActivityAt = now
      if (session.reflectCompleted) {
        session.usedMs += HEARTBEAT_TICK_MS
        daily.usedMs += HEARTBEAT_TICK_MS

        if (isSessionPauseDue(site.config, session)) {
          activateSessionPause(session, now)
          return createSessionPauseDecision(site.config, site.domain, daily, session)
        }
      }
    }

    return toDecision(site.config, site.domain, daily, session)
  })
}

async function handleAddFiveMinutes(request: ExtensionRequest, tabId: number): Promise<{ success: boolean; reason?: string }> {
  if (request.type !== 'ADD_FIVE_MINUTES') {
    return { success: false, reason: 'invalid_request' }
  }

  return mutateState(async (state) => {
    const config = state.siteConfigs[request.domain]
    if (!config) {
      return { success: false, reason: 'unknown_domain' }
    }

    if (config.bonusMode !== 'bitch_mode') {
      return { success: false, reason: 'strict_mode' }
    }

    const dateKey = toLocalDateKey()
    runDailyReset(state, dateKey)

    const now = Date.now()
    const daily = ensureDailyStat(state, request.domain, dateKey)
    const session = ensureSession(state, request.domain, now, true)
    includeTab(session, tabId)

    const blockReason = getTimeBlockReason(config, daily, session)
    if (blockReason !== 'daily_limit') {
      return { success: false, reason: 'not_blocked_by_time' }
    }

    if (session.lastBonusGrantAt && now - session.lastBonusGrantAt < BONUS_DEBOUNCE_MS) {
      return { success: false, reason: 'debounced' }
    }

    session.bonusMs += BONUS_FIVE_MINUTES_MS
    session.lastBonusGrantAt = now
    session.reflectCompleted = false

    daily.bonusMs += BONUS_FIVE_MINUTES_MS

    return { success: true }
  })
}

async function handleCloseTab(tabId: number): Promise<{ success: boolean }> {
  if (tabId < 0) {
    return { success: false }
  }

  try {
    await chrome.tabs.remove(tabId)
    return { success: true }
  } catch {
    return { success: false }
  }
}

async function handleGetOptionsData(): Promise<StorageState> {
  return mutateState(async (state) => {
    runDailyReset(state, toLocalDateKey())
    return state
  })
}

async function handleUpsertSite(request: ExtensionRequest): Promise<{ success: boolean; error?: string }> {
  if (request.type !== 'UPSERT_SITE') {
    return { success: false, error: 'invalid_request' }
  }

  const sanitized = sanitizeSiteConfig(request.config)
  if (!sanitized) {
    return { success: false, error: 'invalid_domain' }
  }

  return mutateState(async (state) => {
    state.siteConfigs[sanitized.domain] = sanitized
    ensureDailyStat(state, sanitized.domain, toLocalDateKey())
    return { success: true }
  })
}

async function handleDeleteSite(request: ExtensionRequest): Promise<{ success: boolean }> {
  if (request.type !== 'DELETE_SITE') {
    return { success: false }
  }

  return mutateState(async (state) => {
    delete state.siteConfigs[request.domain]
    delete state.sessions[request.domain]
    delete state.dailyStats[request.domain]
    return { success: true }
  })
}

async function handleUpdateSettings(request: ExtensionRequest): Promise<{ success: boolean }> {
  if (request.type !== 'UPDATE_SETTINGS') {
    return { success: false }
  }

  return mutateState(async (state) => {
    if (typeof request.patch.extensionEnabled === 'boolean') {
      state.settings.extensionEnabled = request.patch.extensionEnabled
    }

    if (typeof request.patch.inactivityThresholdMinutes === 'number') {
      const clamped = Math.max(1, Math.floor(request.patch.inactivityThresholdMinutes))
      state.settings.inactivityThresholdMinutes = clamped
    }

    return { success: true }
  })
}

async function handleResetDayStats(request: ExtensionRequest): Promise<{ success: boolean }> {
  if (request.type !== 'RESET_DAY_STATS') {
    return { success: false }
  }

  return mutateState(async (state) => {
    resetTodayStats(state, toLocalDateKey())
    return { success: true }
  })
}

async function handleGetDashboardData(request: ExtensionRequest): Promise<DashboardData> {
  if (request.type !== 'GET_DASHBOARD_DATA') {
    return {
      settings: {
        extensionEnabled: true,
      },
      totalSites: 0,
      activeDomain: null,
      activeHasRule: false,
      activeSummary: null,
      summaries: [],
    }
  }

  return mutateState(async (state) => {
    const dateKey = toLocalDateKey()
    runDailyReset(state, dateKey)

    const domains = Object.keys(state.siteConfigs).sort()
    const summaries = domains.map((domain) => {
      const config = state.siteConfigs[domain]
      const stat = ensureDailyStat(state, domain, dateKey)
      const session = state.sessions[domain]

      const dailyLimitMs = minutesToMs(config.dailyLimitMinutes)
      const sessionLimitMs = minutesToMs(config.sessionLimitMinutes)

      return {
        domain,
        enabled: config.enabled,
        usedTodayMs: stat.usedMs,
        opensToday: stat.openCount,
        dailyRemainingMs: dailyLimitMs === null ? null : Math.max(0, dailyLimitMs + stat.bonusMs - stat.usedMs),
        sessionUsedMs: session?.usedMs ?? 0,
        sessionRemainingMs: sessionLimitMs === null
          ? null
          : Math.max(0, sessionLimitMs + (session?.bonusMs ?? 0) - (session?.usedMs ?? 0)),
      }
    })

    let activeSummary: DashboardData['activeSummary'] = null
    let activeDomain: string | null = null
    let activeHasRule = false

    if (request.activeUrl) {
      const host = parseDomainFromUrl(request.activeUrl)
      if (host) {
        activeDomain = host

        const matchedDomain = findMatchingConfigDomain(host, state.siteConfigs)
        if (matchedDomain) {
          activeHasRule = true
          activeDomain = matchedDomain
          activeSummary = summaries.find((summary) => summary.domain === matchedDomain) ?? null
        }
      }
    }

    return {
      settings: state.settings,
      totalSites: domains.length,
      activeSummary,
      activeDomain,
      activeHasRule,
      summaries,
    }
  })
}

async function cleanupSessions(): Promise<void> {
  const tabs = await chrome.tabs.query({})
  const existingTabIds = new Set<number>()
  for (const tab of tabs) {
    if (typeof tab.id === 'number') {
      existingTabIds.add(tab.id)
    }
  }

  await mutateState(async (state) => {
    runDailyReset(state, toLocalDateKey())

    for (const domain of Object.keys(state.sessions)) {
      const session = state.sessions[domain]
      session.openTabIds = session.openTabIds.filter((tabId) => existingTabIds.has(tabId))
      if (session.openTabIds.length === 0) {
        delete state.sessions[domain]
      }
    }
  })
}

function scheduleCleanupAlarm(): void {
  chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: ONE_MINUTE })
}

function getMinutesUntilNextLocalMidnight(now = new Date()): number {
  const nextMidnight = new Date(now)
  nextMidnight.setHours(24, 0, 0, 0)

  return Math.max(ONE_MINUTE, Math.ceil((nextMidnight.getTime() - now.getTime()) / ONE_MINUTE_MS))
}

function scheduleMidnightResetAlarm(): void {
  chrome.alarms.create(MIDNIGHT_RESET_ALARM, {
    delayInMinutes: getMinutesUntilNextLocalMidnight(),
  })
}

function scheduleBackgroundAlarms(): void {
  scheduleCleanupAlarm()
  scheduleMidnightResetAlarm()
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureStorageInitialized()
  scheduleBackgroundAlarms()
})

chrome.runtime.onStartup.addListener(async () => {
  await ensureStorageInitialized()
  scheduleBackgroundAlarms()
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CLEANUP_ALARM) {
    await cleanupSessions()
    return
  }

  if (alarm.name === MIDNIGHT_RESET_ALARM) {
    await mutateState(async (state) => {
      runDailyReset(state, toLocalDateKey())
    })
    scheduleMidnightResetAlarm()
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void mutateState(async (state) => {
    for (const domain of Object.keys(state.sessions)) {
      const session = state.sessions[domain]
      session.openTabIds = session.openTabIds.filter((existingId) => existingId !== tabId)
      if (session.openTabIds.length === 0) {
        delete state.sessions[domain]
      }
    }
  })
})

chrome.runtime.onMessage.addListener((request: ExtensionRequest, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? -1

  void (async () => {
    switch (request.type) {
      case 'CHECK_ACCESS': {
        const result = await handleCheckAccess(request, tabId)
        sendResponse(result)
        return
      }
      case 'COMPLETE_REFLECT': {
        const result = await handleCompleteReflect(request, tabId)
        sendResponse(result)
        return
      }
      case 'HEARTBEAT': {
        const result = await handleHeartbeat(request, tabId)
        sendResponse(result)
        return
      }
      case 'ADD_FIVE_MINUTES': {
        const result = await handleAddFiveMinutes(request, tabId)
        sendResponse(result)
        return
      }
      case 'CLOSE_TAB': {
        const result = await handleCloseTab(tabId)
        sendResponse(result)
        return
      }
      case 'GET_OPTIONS_DATA': {
        const result = await handleGetOptionsData()
        sendResponse(result)
        return
      }
      case 'UPSERT_SITE': {
        const result = await handleUpsertSite(request)
        sendResponse(result)
        return
      }
      case 'DELETE_SITE': {
        const result = await handleDeleteSite(request)
        sendResponse(result)
        return
      }
      case 'UPDATE_SETTINGS': {
        const result = await handleUpdateSettings(request)
        sendResponse(result)
        return
      }
      case 'RESET_DAY_STATS': {
        const result = await handleResetDayStats(request)
        sendResponse(result)
        return
      }
      case 'GET_DASHBOARD_DATA': {
        const result = await handleGetDashboardData(request)
        sendResponse(result)
        return
      }
      default:
        sendResponse({ action: 'allow', matchedDomain: null })
    }
  })()

  return true
})

void ensureStorageInitialized().then(() => {
  scheduleBackgroundAlarms()
})

