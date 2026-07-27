export type Phase = 'destroyed' | 'created' | 'started' | 'resumed' | 'paused' | 'stopped'

export interface ActivityState {
  readonly phase: Phase
  readonly instanceNumber: number
  readonly viewModelValue: string | null
  readonly log: readonly string[]
}

export function createActivity(): ActivityState {
  return { phase: 'destroyed', instanceNumber: 0, viewModelValue: null, log: [] }
}

function fire(s: ActivityState, callbacks: string[], phase: Phase): ActivityState {
  return { ...s, phase, log: [...s.log, ...callbacks] }
}

export function launch(s: ActivityState): ActivityState {
  if (s.phase !== 'destroyed') return s
  const up = fire(s, ['onCreate', 'onStart', 'onResume'], 'resumed')
  return {
    ...up,
    instanceNumber: s.instanceNumber + 1,
    viewModelValue: s.viewModelValue ?? 'counter=42',
  }
}

export function rotate(s: ActivityState): ActivityState {
  if (s.phase !== 'resumed') return s
  const down = fire(s, ['onPause', 'onStop', 'onDestroy'], 'destroyed')
  return launch(down) // viewModelValue non-null → preserved
}

const FINISH_CALLBACKS: Partial<Record<Phase, string[]>> = {
  resumed: ['onPause', 'onStop', 'onDestroy'],
  paused: ['onStop', 'onDestroy'],
  stopped: ['onDestroy'],
}

export function finish(s: ActivityState): ActivityState {
  const callbacks = FINISH_CALLBACKS[s.phase]
  if (!callbacks) return s
  const down = fire(s, callbacks, 'destroyed')
  return { ...down, viewModelValue: null }
}

export function background(s: ActivityState): ActivityState {
  if (s.phase !== 'resumed') return s
  return fire(s, ['onPause', 'onStop'], 'stopped')
}

export function foreground(s: ActivityState): ActivityState {
  if (s.phase !== 'stopped') return s
  return fire(s, ['onStart', 'onResume'], 'resumed')
}
