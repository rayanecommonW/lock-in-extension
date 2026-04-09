import type { AccessDecision, BlockReason, ExtensionRequest } from '@/shared/types'
import { sendRuntimeMessage } from '@/shared/chrome-api'

const OVERLAY_ID = 'lock-in-overlay-root'
const HEARTBEAT_INTERVAL_MS = 1000

let overlayKind: 'none' | 'reflect' | 'block' = 'none'
let heartbeatHandle: number | null = null

function sendMessage<T>(payload: ExtensionRequest): Promise<T> {
  return sendRuntimeMessage<T>(payload)
}

function getOrCreateOverlayContainer(): ShadowRoot {
  let host = document.getElementById(OVERLAY_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = OVERLAY_ID
    document.documentElement.appendChild(host)
  }

  host.style.position = 'fixed'
  host.style.inset = '0'
  host.style.zIndex = '2147483647'
  host.style.pointerEvents = 'none'

  let shadow = host.shadowRoot
  if (!shadow) {
    shadow = host.attachShadow({ mode: 'open' })
  }

  return shadow
}

function removeOverlay(): void {
  const host = document.getElementById(OVERLAY_ID)
  if (host) {
    host.remove()
  }
  overlayKind = 'none'
}

function reasonLabel(reason?: BlockReason): string {
  switch (reason) {
    case 'daily_limit':
      return 'Max limit per day reached.'
    case 'session_limit':
      return 'Session time limit reached.'
    case 'open_limit':
      return 'Open limit per day reached.'
    default:
      return 'Limit reached.'
  }
}

function renderModalSkeleton(title: string, message: string): { root: ShadowRoot; content: HTMLElement } {
  const root = getOrCreateOverlayContainer()
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap {
        pointer-events: auto;
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top left, rgba(36, 16, 22, 0.92), rgba(9, 11, 15, 0.95));
        backdrop-filter: blur(7px);
      }
      .card {
        width: min(92vw, 520px);
        border-radius: 22px;
        padding: 26px;
        box-sizing: border-box;
        background: linear-gradient(145deg, #f9efe6 0%, #efe7dc 100%);
        color: #1b1513;
        border: 2px solid #2d1f1a;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
        font-family: 'Trebuchet MS', 'Gill Sans', 'Segoe UI', sans-serif;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
        font-size: 1rem;
        line-height: 1.45;
      }
      .muted {
        margin-top: 10px;
        color: #4e4039;
        font-size: 0.95rem;
      }
      .row {
        margin-top: 18px;
        display: flex;
        gap: 10px;
      }
      button {
        border: 0;
        border-radius: 10px;
        padding: 10px 14px;
        font-weight: 700;
        cursor: pointer;
      }
      .primary {
        background: #8d2f2a;
        color: #fff;
      }
      .secondary {
        background: #2d1f1a;
        color: #f6efe8;
      }
      .ghost {
        background: transparent;
        border: 1px solid #3a2b24;
        color: #3a2b24;
      }
    </style>
    <div class="wrap">
      <section class="card">
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="muted" id="lock-in-note"></div>
        <div class="row" id="lock-in-actions"></div>
      </section>
    </div>
  `

  const content = root.getElementById('lock-in-actions') as HTMLElement
  return { root, content }
}

async function showReflectModal(decision: AccessDecision): Promise<void> {
  if (overlayKind === 'reflect') {
    return
  }

  overlayKind = 'reflect'
  const matchedDomain = decision.matchedDomain
  if (!matchedDomain) {
    removeOverlay()
    return
  }

  const delaySeconds = Math.max(0, Math.floor(decision.reflectDelaySeconds ?? 0))
  const message = decision.reflectMessage ?? 'Are you sure you want to spend time on this site?'
  const { root } = renderModalSkeleton('Reflect before browsing', message)
  const note = root.getElementById('lock-in-note') as HTMLElement

  let remaining = delaySeconds
  note.textContent = `Unlocking in ${remaining}s...`

  await new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      remaining -= 1
      note.textContent = `Unlocking in ${Math.max(0, remaining)}s...`
      if (remaining <= 0) {
        window.clearInterval(timer)
        resolve()
      }
    }, 1000)

    if (delaySeconds === 0) {
      window.clearInterval(timer)
      resolve()
    }
  })

  await sendMessage<{ success: boolean }>({
    type: 'COMPLETE_REFLECT',
    domain: matchedDomain,
  })

  removeOverlay()
  const followUp = await requestAccess('recheck')
  await applyDecision(followUp)
}

async function showBlockModal(decision: AccessDecision): Promise<void> {
  if (overlayKind === 'block') {
    return
  }

  overlayKind = 'block'
  const matchedDomain = decision.matchedDomain
  if (!matchedDomain) {
    removeOverlay()
    return
  }

  const { root, content } = renderModalSkeleton('Limit reached', reasonLabel(decision.reason))
  const note = root.getElementById('lock-in-note') as HTMLElement
  const opensNote = decision.openLimit === null
    ? `Today opens: ${decision.openCount ?? 0}`
    : `Today opens: ${decision.openCount ?? 0}/${decision.openLimit}`
  note.textContent = opensNote

  if (decision.canAddFive) {
    const addButton = document.createElement('button')
    addButton.className = 'primary'
    addButton.textContent = 'Add 5 minutes'
    addButton.onclick = async () => {
      addButton.disabled = true
      const result = await sendMessage<{ success: boolean; reason?: string }>({
        type: 'ADD_FIVE_MINUTES',
        domain: matchedDomain,
      })
      if (!result.success) {
        addButton.disabled = false
        return
      }
      removeOverlay()
      const followUp = await requestAccess('recheck')
      await applyDecision(followUp)
    }
    content.appendChild(addButton)
  }

  const leaveButton = document.createElement('button')
  leaveButton.className = decision.canAddFive ? 'secondary' : 'primary'
  leaveButton.textContent = 'Leave'
  leaveButton.onclick = () => {
    window.location.href = 'about:blank'
  }
  content.appendChild(leaveButton)

  const closeButton = document.createElement('button')
  closeButton.className = 'ghost'
  closeButton.textContent = 'Keep page blocked'
  closeButton.onclick = () => {
    // Keep block overlay visible; no-op action.
  }
  content.appendChild(closeButton)
}

async function applyDecision(decision: AccessDecision): Promise<void> {
  if (decision.action === 'allow') {
    removeOverlay()
    return
  }

  if (decision.action === 'reflect') {
    await showReflectModal(decision)
    return
  }

  await showBlockModal(decision)
}

async function requestAccess(reason: 'navigate' | 'recheck'): Promise<AccessDecision> {
  return sendMessage<AccessDecision>({
    type: 'CHECK_ACCESS',
    url: window.location.href,
    reason,
  })
}

function isActivelyViewingPage(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function startHeartbeat(): void {
  if (heartbeatHandle !== null) {
    window.clearInterval(heartbeatHandle)
  }

  heartbeatHandle = window.setInterval(async () => {
    try {
      const decision = await sendMessage<AccessDecision>({
        type: 'HEARTBEAT',
        url: window.location.href,
        active: isActivelyViewingPage() && overlayKind === 'none',
      })

      if (decision.action === 'allow' && overlayKind === 'block') {
        removeOverlay()
      }

      if (decision.action === 'reflect' && overlayKind === 'none') {
        await applyDecision(decision)
      }

      if (decision.action === 'block' && overlayKind !== 'block') {
        await applyDecision(decision)
      }
    } catch {
      // Ignore transient message errors while pages navigate.
    }
  }, HEARTBEAT_INTERVAL_MS)
}

async function bootstrap(): Promise<void> {
  try {
    const decision = await requestAccess('navigate')
    await applyDecision(decision)
  } catch {
    // Ignore transient startup messaging errors while extension worker spins up.
  }

  startHeartbeat()
}

void bootstrap()
