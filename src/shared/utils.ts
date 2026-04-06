import type { SiteConfig } from '@/shared/types'

export function toLocalDateKey(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return null
  }
}

export function normalizeDomainInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) {
    return null
  }

  const maybeUrl = trimmed.includes('://') ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(maybeUrl)
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
    if (!host || host.includes(' ')) {
      return null
    }
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return null
  }
}

export function findMatchingConfigDomain(host: string, configs: Record<string, SiteConfig>): string | null {
  let bestMatch: string | null = null

  for (const configuredDomain of Object.keys(configs)) {
    if (host === configuredDomain || host.endsWith(`.${configuredDomain}`)) {
      if (!bestMatch || configuredDomain.length > bestMatch.length) {
        bestMatch = configuredDomain
      }
    }
  }

  return bestMatch
}

export function minutesToMs(minutes: number | null): number | null {
  if (minutes === null) {
    return null
  }
  return Math.max(0, Math.floor(minutes)) * 60_000
}

export function secondsToMs(seconds: number): number {
  return Math.max(0, Math.floor(seconds)) * 1000
}

export function clampPositiveInt(value: number | null, fallback: number | null): number | null {
  if (value === null || Number.isNaN(value)) {
    return fallback
  }
  const normalized = Math.floor(value)
  if (normalized < 0) {
    return fallback
  }
  return normalized
}

export function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
