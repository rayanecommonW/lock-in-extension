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
      return 'Time for a pause.'
    case 'open_limit':
      return 'Open limit per day reached.'
    default:
      return 'Limit reached.'
  }
}

function pausePlayingMedia(): void {
  const mediaElements = document.querySelectorAll<HTMLMediaElement>('video, audio')
  for (const mediaElement of mediaElements) {
    try {
      if (!mediaElement.paused) {
        mediaElement.pause()
      }
    } catch {
      // Ignore media APIs that cannot be paused from the current context.
    }
  }
}

function renderModalSkeleton(title: string, message: string): { root: ShadowRoot; content: HTMLElement } {
  const root = getOrCreateOverlayContainer()
  root.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light;
        font-family: 'Segoe UI Variable Text', 'Avenir Next', 'Inter', 'Helvetica Neue', 'Segoe UI', sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      .wrap {
        pointer-events: auto;
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 18px;
        background:
          radial-gradient(circle at 12% 8%, rgba(112, 180, 232, 0.20), transparent 40%),
          radial-gradient(circle at 88% 92%, rgba(255, 173, 96, 0.16), transparent 44%),
          linear-gradient(145deg, rgba(6, 12, 20, 0.82), rgba(14, 17, 24, 0.90));
        backdrop-filter: blur(8px) saturate(1.2);
      }
      .card {
        position: relative;
        overflow: hidden;
        width: min(92vw, 520px);
        border-radius: 24px;
        padding: 26px 24px 20px;
        background: linear-gradient(160deg, #f9fcff 0%, #eff4fb 100%);
        color: #152031;
        border: 1px solid rgba(18, 35, 56, 0.16);
        box-shadow:
          0 24px 56px rgba(5, 9, 16, 0.45),
          0 2px 0 rgba(255, 255, 255, 0.65) inset;
        animation: card-in 220ms cubic-bezier(0.2, 0.9, 0.2, 1);
      }
      .card::before {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 5px;
        background: linear-gradient(90deg, #3f9ddf 0%, #48c3a0 50%, #f1a65f 100%);
      }
      .eyebrow {
        margin: 0 0 10px;
        font-size: 0.72rem;
        letter-spacing: 0.11em;
        text-transform: uppercase;
        font-weight: 700;
        color: #3f638b;
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(1.34rem, 2.3vw, 1.62rem);
        line-height: 1.2;
        letter-spacing: -0.015em;
        font-weight: 760;
      }
      .body {
        margin: 0;
        font-size: 1rem;
        line-height: 1.55;
        color: #25374f;
      }
      .muted {
        margin-top: 14px;
        color: #33506f;
        font-size: 0.92rem;
        line-height: 1.4;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(66, 118, 167, 0.10);
        border: 1px solid rgba(66, 118, 167, 0.18);
      }
      .row {
        margin-top: 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 9px;
      }
      button {
        border: 1px solid transparent;
        border-radius: 12px;
        padding: 10px 14px;
        font-weight: 700;
        font-size: 0.92rem;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
      }
      button:hover {
        transform: translateY(-1px);
      }
      button:active {
        transform: translateY(0);
      }
      button:disabled {
        opacity: 0.65;
        cursor: not-allowed;
        transform: none;
      }
      .primary {
        background: linear-gradient(145deg, #2d86d0, #2f6fd6);
        color: #fff;
        box-shadow: 0 10px 24px rgba(31, 90, 170, 0.35);
      }
      .secondary {
        background: linear-gradient(145deg, #17345a, #1e4678);
        color: #f2f7ff;
        box-shadow: 0 8px 18px rgba(10, 20, 36, 0.32);
      }
      .ghost {
        background: rgba(255, 255, 255, 0.66);
        border-color: rgba(23, 52, 90, 0.24);
        color: #17345a;
      }
      @media (max-width: 460px) {
        .card {
          padding: 24px 18px 18px;
        }
        button {
          flex: 1;
          min-width: 120px;
        }
      }
      @keyframes card-in {
        from {
          opacity: 0;
          transform: translateY(8px) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    </style>
    <div class="wrap">
      <section class="card">
        <p class="eyebrow">Lock In</p>
        <h1>${title}</h1>
        <p class="body">${message}</p>
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

  const isSessionPause = decision.reason === 'session_limit'
  if (isSessionPause) {
    pausePlayingMedia()
  }

  const delaySeconds = Math.max(0, Math.floor(decision.reflectDelaySeconds ?? 0))
  const message = decision.reflectMessage ?? 'Are you sure you want to spend time on this site?'
  const title = isSessionPause ? 'Time for a pause' : 'Reflect before browsing'
  const { root } = renderModalSkeleton(title, message)
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
  leaveButton.onclick = async () => {
    leaveButton.disabled = true

    const result = await sendMessage<{ success: boolean }>({
      type: 'CLOSE_TAB',
    })

    if (!result.success) {
      // Fallback for rare cases where tab close is unavailable.
      window.location.href = 'about:blank'
    }
  }
  content.appendChild(leaveButton)
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
