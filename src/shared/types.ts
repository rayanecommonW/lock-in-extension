export type BonusMode = 'strict' | 'bitch_mode'

export interface SiteConfig {
  domain: string
  enabled: boolean
  dailyLimitMinutes: number | null
  sessionLimitMinutes: number | null
  openLimitPerDay: number | null
  reflectDelaySeconds: number
  reflectMessage: string
  bonusMode: BonusMode
}

export interface DailyStat {
  dateKey: string
  usedMs: number
  openCount: number
  bonusMs: number
}

export interface DomainSession {
  id: string
  domain: string
  startedAt: number
  lastActivityAt: number
  usedMs: number
  reflectCompleted: boolean
  openTabIds: number[]
  bonusMs: number
  lastBonusGrantAt: number | null
}

export interface Settings {
  extensionEnabled: boolean
  inactivityThresholdMinutes: number
  schemaVersion: number
}

export interface StorageState {
  siteConfigs: Record<string, SiteConfig>
  dailyStats: Record<string, DailyStat>
  sessions: Record<string, DomainSession>
  settings: Settings
}

export type AccessReason = 'navigate' | 'recheck'
export type AccessAction = 'allow' | 'reflect' | 'block'
export type BlockReason = 'daily_limit' | 'session_limit' | 'open_limit'

export interface AccessDecision {
  action: AccessAction
  matchedDomain: string | null
  reason?: BlockReason
  canAddFive?: boolean
  reflectDelaySeconds?: number
  reflectMessage?: string
  remainingDailyMs?: number | null
  remainingSessionMs?: number | null
  openCount?: number
  openLimit?: number | null
}

export interface CheckAccessRequest {
  type: 'CHECK_ACCESS'
  url: string
  reason: AccessReason
}

export interface CompleteReflectRequest {
  type: 'COMPLETE_REFLECT'
  domain: string
}

export interface HeartbeatRequest {
  type: 'HEARTBEAT'
  url: string
  active: boolean
}

export interface AddFiveMinutesRequest {
  type: 'ADD_FIVE_MINUTES'
  domain: string
}

export interface GetOptionsDataRequest {
  type: 'GET_OPTIONS_DATA'
}

export interface UpsertSiteRequest {
  type: 'UPSERT_SITE'
  config: SiteConfig
}

export interface DeleteSiteRequest {
  type: 'DELETE_SITE'
  domain: string
}

export interface UpdateSettingsRequest {
  type: 'UPDATE_SETTINGS'
  patch: Partial<Pick<Settings, 'extensionEnabled' | 'inactivityThresholdMinutes'>>
}

export interface GetDashboardDataRequest {
  type: 'GET_DASHBOARD_DATA'
  activeUrl?: string
}

export type ExtensionRequest =
  | CheckAccessRequest
  | CompleteReflectRequest
  | HeartbeatRequest
  | AddFiveMinutesRequest
  | GetOptionsDataRequest
  | UpsertSiteRequest
  | DeleteSiteRequest
  | UpdateSettingsRequest
  | GetDashboardDataRequest
