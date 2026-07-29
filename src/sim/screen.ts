// What the glass shows: the launcher's icon grid (home) or the foreground
// app's UI. Pure state — the display scenario renders it, main.ts reduces
// bus events into it.

export interface ScreenState {
  readonly mode: 'home' | 'app'
  readonly app: string | null
}

export function createScreen(): ScreenState {
  return { mode: 'home', app: null }
}

export function screenOnResumed(_s: ScreenState, app: string): ScreenState {
  return { mode: 'app', app }
}

export function screenOnHome(_s: ScreenState): ScreenState {
  return { mode: 'home', app: null }
}

// Only the foreground app's death changes the glass — a background kill is
// invisible to the user until they revisit that app.
export function screenOnKilled(s: ScreenState, app: string): ScreenState {
  return s.mode === 'app' && s.app === app ? createScreen() : s
}
