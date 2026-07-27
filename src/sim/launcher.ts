export const APPS: readonly string[] = ['chat', 'maps', 'camera', 'bank']

export interface LauncherState {
  readonly launching: readonly string[]
  readonly running: readonly string[]
}

export function createLauncher(): LauncherState {
  return { launching: [], running: [] }
}

export function requestLaunch(s: LauncherState, app: string): { state: LauncherState; accepted: boolean } {
  const busy = s.launching.includes(app) || s.running.includes(app)
  if (!APPS.includes(app) || busy) return { state: s, accepted: false }
  return { state: { ...s, launching: [...s.launching, app] }, accepted: true }
}

export function markRunning(s: LauncherState, app: string): LauncherState {
  if (!s.launching.includes(app)) return s
  return { launching: s.launching.filter(a => a !== app), running: [...s.running, app] }
}

export function markStopped(s: LauncherState, app: string): LauncherState {
  return { launching: s.launching.filter(a => a !== app), running: s.running.filter(a => a !== app) }
}
