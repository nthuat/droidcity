export interface HeapObject { readonly id: number; readonly sizeKb: number; readonly reachable: boolean }

export interface HeapState {
  readonly objects: readonly HeapObject[]
  readonly capacityKb: number
  readonly nextId: number
  readonly gcCount: number
  readonly lastFreedKb: number
}

export function createHeap(capacityKb: number): HeapState {
  return { objects: [], capacityKb, nextId: 1, gcCount: 0, lastFreedKb: 0 }
}

export function usedKb(s: HeapState): number {
  return s.objects.reduce((sum, o) => sum + o.sizeKb, 0)
}

export function gc(s: HeapState): HeapState {
  const survivors = s.objects.filter(o => o.reachable)
  const freed = usedKb(s) - survivors.reduce((sum, o) => sum + o.sizeKb, 0)
  return { ...s, objects: survivors, gcCount: s.gcCount + 1, lastFreedKb: freed }
}

export function allocate(s: HeapState, sizeKb: number): { state: HeapState; gcRan: boolean } {
  let state = s
  let gcRan = false
  if (usedKb(state) + sizeKb > state.capacityKb) {
    state = gc(state)
    gcRan = true
  }
  if (usedKb(state) + sizeKb > state.capacityKb) throw new Error('OutOfMemoryError')
  const obj: HeapObject = { id: state.nextId, sizeKb, reachable: true }
  return { state: { ...state, objects: [...state.objects, obj], nextId: state.nextId + 1 }, gcRan }
}

export function release(s: HeapState, id: number): HeapState {
  return { ...s, objects: s.objects.map(o => (o.id === id ? { ...o, reachable: false } : o)) }
}

export function releaseOldest(s: HeapState, count: number): HeapState {
  const targets = s.objects.filter(o => o.reachable).slice(0, count).map(o => o.id)
  return { ...s, objects: s.objects.map(o => (targets.includes(o.id) ? { ...o, reachable: false } : o)) }
}
