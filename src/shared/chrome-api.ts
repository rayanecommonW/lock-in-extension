import type { ExtensionRequest } from '@/shared/types'

export function sendRuntimeMessage<T>(payload: ExtensionRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response: T) => {
      const lastError = chrome.runtime.lastError
      if (lastError) {
        reject(new Error(lastError.message))
        return
      }
      resolve(response)
    })
  })
}

export function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve, reject) => {
    const tryCurrentWindow = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const lastError = chrome.runtime.lastError
        if (lastError) {
          reject(new Error(lastError.message))
          return
        }

        resolve(tabs[0] ?? null)
      })
    }

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const lastError = chrome.runtime.lastError
      if (lastError) {
        tryCurrentWindow()
        return
      }

      if (tabs.length > 0) {
        resolve(tabs[0] ?? null)
        return
      }

      tryCurrentWindow()
    })
  })
}

export function openOptionsPage(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.openOptionsPage(() => {
      const lastError = chrome.runtime.lastError
      if (lastError) {
        reject(new Error(lastError.message))
        return
      }

      resolve()
    })
  })
}
