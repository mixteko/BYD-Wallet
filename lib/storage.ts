import { seedAppState, STORAGE_KEY } from './seed'
import type { AppState } from './types'

export function loadState(): AppState {
  if (typeof window === 'undefined') {
    return seedAppState
  }

  const storedValue = window.localStorage.getItem(STORAGE_KEY)

  if (!storedValue) {
    return seedAppState
  }

  try {
    const parsed = JSON.parse(storedValue) as AppState
    return { ...seedAppState, ...parsed }
  } catch {
    return seedAppState
  }
}

export function saveState(state: AppState) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}
