export interface PlotsState { readonly slots: readonly (string | null)[] }

export function createPlots(count: number): PlotsState {
  return { slots: Array.from({ length: count }, () => null) }
}

export function allocatePlot(s: PlotsState, app: string): { state: PlotsState; plot: number } {
  if (s.slots.includes(app)) return { state: s, plot: -1 }
  const plot = s.slots.indexOf(null)
  if (plot === -1) return { state: s, plot: -1 }
  const slots = s.slots.map((v, i) => (i === plot ? app : v))
  return { state: { slots }, plot }
}

export function releasePlot(s: PlotsState, app: string): PlotsState {
  return { slots: s.slots.map(v => (v === app ? null : v)) }
}
