export interface CityEvents {
  'boot:stageDone': { stage: string }
  'boot:complete': Record<string, never>
  'app:launchRequested': { app: string }
  'process:forked': { app: string; pid: number }
  'process:killed': { app: string; pid: number }
  'activity:resumed': { app: string }
  'data:requested': { app: string; source: 'db' | 'network' }
  'data:cacheHit': { app: string; stale: boolean }
  'data:fetched': { app: string; ms: number }
  'data:dropped': { app: string }
  'net:phase': { app: string; phase: string }
  'ui:messagePosted': { app: string; label: string }
  'frame:submitted': { app: string; dropped: boolean }
  'frame:composited': { app: string }
  'gc:swept': { app: string; freedKb: number }
  'anr': { app: string }
  'memory:trim': Record<string, never>
}
export type CityEventName = keyof CityEvents
export interface Bus {
  on<K extends CityEventName>(event: K, fn: (p: CityEvents[K]) => void): () => void
  emit<K extends CityEventName>(event: K, payload: CityEvents[K]): void
  clear(): void
}

type Handler = (payload: never) => void

export function createBus(): Bus {
  const handlers = new Map<CityEventName, Set<Handler>>()
  return {
    on(event, fn) {
      let set = handlers.get(event)
      if (!set) {
        set = new Set()
        handlers.set(event, set)
      }
      set.add(fn as Handler)
      return () => { set!.delete(fn as Handler) }
    },
    emit(event, payload) {
      const set = handlers.get(event)
      if (!set) return
      for (const fn of [...set]) {
        try {
          ;(fn as (p: typeof payload) => void)(payload)
        } catch (err) {
          console.error(`bus handler error for ${event}:`, err)
        }
      }
    },
    clear() { handlers.clear() },
  }
}
