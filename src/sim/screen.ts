// What the glass shows: the launcher's icon grid (home) or the foreground
// app's UI. Pure state — the display scenario renders it, main.ts reduces
// bus events into it.

export interface ScreenState {
  readonly mode: 'home' | 'app' | 'recents' | 'shade' | 'permission'
  // In 'app' mode: the foreground app. In 'recents' mode: the app that was
  // foreground when Recents opened (still running behind the overlay) — Back
  // returns to it. At home: null.
  readonly app: string | null
}

export function createScreen(): ScreenState {
  return { mode: 'home', app: null }
}

export function screenOnResumed(_s: ScreenState, app: string): ScreenState {
  return { mode: 'app', app }
}

// Recents overlay: the foreground app keeps running behind it.
export function screenOnRecents(s: ScreenState): ScreenState {
  return s.mode === 'recents' ? s : { mode: 'recents', app: s.app }
}

// Back inside recents dismisses the overlay back to whatever was underneath.
export function screenOnRecentsDismissed(s: ScreenState): ScreenState {
  if (s.mode !== 'recents') return s
  return s.app ? { mode: 'app', app: s.app } : { mode: 'home', app: null }
}

// Notification shade: pulled over whatever is showing; underlying app keeps
// running (same overlay semantics as recents).
export function screenOnShade(s: ScreenState): ScreenState {
  return s.mode === 'shade' ? s : { mode: 'shade', app: s.app }
}

export function screenOnShadeDismissed(s: ScreenState): ScreenState {
  if (s.mode !== 'shade') return s
  return s.app ? { mode: 'app', app: s.app } : { mode: 'home', app: null }
}

// Runtime-permission dialog: the SYSTEM draws it over the requesting app —
// the app is foreground underneath and resumes as-is once resolved.
export function screenOnPermissionRequest(s: ScreenState, app: string): ScreenState {
  return { mode: 'permission', app }
}

export function screenOnPermissionResolved(s: ScreenState): ScreenState {
  if (s.mode !== 'permission') return s
  return s.app ? { mode: 'app', app: s.app } : { mode: 'home', app: null }
}

export function screenOnHome(_s: ScreenState): ScreenState {
  return { mode: 'home', app: null }
}

// Only the foreground app's death changes the glass — a background kill is
// invisible to the user until they revisit that app. In recents, the dead
// app's card disappears (rendering concern); the underlying app reference
// clears so Back lands on home instead of a corpse.
export function screenOnKilled(s: ScreenState, app: string): ScreenState {
  if (s.app !== app) return s
  if (s.mode === 'app' || s.mode === 'permission') return createScreen()
  if (s.mode === 'recents') return { mode: 'recents', app: null }
  if (s.mode === 'shade') return { mode: 'shade', app: null }
  return s
}
