// Mirrors Android's oom_adj tiers (see foundry.ts's OOM_ADJ map): a FOREGROUND
// SERVICE outranks a plain background service and a cached process, but still
// loses to anything the user is looking at.
export type Priority = 'foreground' | 'visible' | 'fgservice' | 'service' | 'cached'
// lmkd kills from the front of this list.
export const KILL_ORDER: readonly Priority[] = ['cached', 'service', 'fgservice', 'visible', 'foreground']

export interface Proc {
  readonly pid: number
  readonly name: string
  readonly priority: Priority
  readonly memoryMb: number
}

export interface SystemState {
  readonly procs: readonly Proc[]
  readonly nextPid: number
  readonly capacityMb: number
  readonly killedPids: readonly number[]
}

export function createSystem(capacityMb: number): SystemState {
  return { procs: [], nextPid: 1, capacityMb, killedPids: [] }
}

export function usedMb(s: SystemState): number {
  return s.procs.reduce((sum, p) => sum + p.memoryMb, 0)
}

// An app allocating more: its RSS grows. Deliberately does NOT kill anyone here
//, pressure rising is the input to the reclaim/LMK ladder, not a kill itself.
// Capped at capacity so a runaway allocation can't produce nonsense totals.
export function growProcess(s: SystemState, name: string, addMb: number): SystemState {
  const proc = s.procs.find(p => p.name === name)
  if (!proc || addMb <= 0) return s
  const headroom = Math.max(0, s.capacityMb - usedMb(s))
  const grantedMb = Math.min(addMb, headroom)
  if (grantedMb === 0) return s
  return {
    ...s,
    procs: s.procs.map(p => (p.pid === proc.pid ? { ...p, memoryMb: p.memoryMb + grantedMb } : p)),
  }
}

function reclaim(s: SystemState, memoryMb: number): SystemState {
  let procs = [...s.procs]
  let killed = [...s.killedPids]
  for (const tier of KILL_ORDER) {
    if (tier === 'foreground') break
    // oldest first within a tier = lowest pid first
    const victims = procs.filter(p => p.priority === tier).sort((a, b) => a.pid - b.pid)
    for (const v of victims) {
      if (s.capacityMb - procs.reduce((sum, p) => sum + p.memoryMb, 0) >= memoryMb) break
      procs = procs.filter(p => p.pid !== v.pid)
      killed = [...killed, v.pid]
    }
  }
  return { ...s, procs, killedPids: killed }
}

export function fork(s: SystemState, name: string, priority: Priority, memoryMb: number): SystemState {
  let next = s
  if (usedMb(next) + memoryMb > next.capacityMb) {
    next = reclaim(next, memoryMb)
  }
  if (usedMb(next) + memoryMb > next.capacityMb) return next // still no room
  const proc: Proc = { pid: next.nextPid, name, priority, memoryMb }
  return { ...next, procs: [...next.procs, proc], nextPid: next.nextPid + 1 }
}

export function setPriority(s: SystemState, pid: number, priority: Priority): SystemState {
  return { ...s, procs: s.procs.map(p => (p.pid === pid ? { ...p, priority } : p)) }
}
