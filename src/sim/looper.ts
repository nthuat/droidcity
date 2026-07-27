import { ANR_MS } from './constants'

export interface Message {
  readonly id: number
  readonly label: string
  readonly costMs: number
}

export interface LooperState {
  readonly queue: readonly Message[]
  readonly current: { readonly msg: Message; readonly elapsedMs: number } | null
  readonly processedIds: readonly number[]
  readonly anr: boolean
  readonly nextId: number
}

export function createLooper(): LooperState {
  return { queue: [], current: null, processedIds: [], anr: false, nextId: 1 }
}

export function post(s: LooperState, label: string, costMs: number): LooperState {
  const msg: Message = { id: s.nextId, label, costMs }
  return { ...s, queue: [...s.queue, msg], nextId: s.nextId + 1 }
}

export function advance(s: LooperState, dtMs: number): LooperState {
  let { queue, current, processedIds } = s
  let remaining = dtMs
  while (remaining > 0) {
    if (!current) {
      if (queue.length === 0) break
      current = { msg: queue[0], elapsedMs: 0 }
      queue = queue.slice(1)
    }
    const need = current.msg.costMs - current.elapsedMs
    const spent = Math.min(need, remaining)
    current = { msg: current.msg, elapsedMs: current.elapsedMs + spent }
    remaining -= spent
    if (current.elapsedMs >= current.msg.costMs) {
      processedIds = [...processedIds, current.msg.id]
      current = null
    }
  }
  const anr = current !== null && current.elapsedMs >= ANR_MS
  return { ...s, queue, current, processedIds, anr }
}
