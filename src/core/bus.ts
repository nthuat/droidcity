export interface CityEvents {
  'boot:stageDone': { stage: string }
  'boot:complete': Record<string, never>
  'app:launchRequested': { app: string }
  'process:forked': { app: string; pid: number }
  'process:killed': { app: string; pid: number }
  'activity:resumed': { app: string }
  // No `start` field: launcherPlaza (the emitter) can't see activity phase, only
  // WardManager can — it decides warm vs hot on receipt and reports the actual
  // type via the onStartType dep callback. (Plan drafted a `start` field on this
  // payload; dropped as unreliable since the only producer can't know the truth.)
  'app:broughtToFront': { app: string }
  // Forward hooks — emitted for future consumers; panels currently sync per-frame.
  'service:changed': { app: string; running: boolean }
  'broadcast:sent': { action: string }
  'data:requested': { app: string; source: 'db' | 'network' }
  'data:cacheHit': { app: string; stale: boolean }
  'data:fetched': { app: string; ms: number }
  'data:dropped': { app: string }
  'net:phase': { app: string; phase: string }
  'ui:messagePosted': { app: string; label: string }
  'frame:submitted': { app: string; dropped: boolean }
  'frame:composited': { app: string }
  'gc:swept': { app: string; freedKb: number }
  // NDK/JNI: a managed thread crossed into the .so (nativeKb = running total of
  // malloc'd native bytes, which no GC will reclaim).
  'jni:called': { app: string; nativeKb: number }
  // SIGSEGV inside native code — the whole process dies, no onDestroy.
  'native:crashed': { app: string }
  'anr': { app: string }
  'memory:trim': Record<string, never>
  'memory:pressure': Record<string, never>
  // Forward hooks — emitted for future consumers; panels currently sync per-frame.
  'activity:pushed': { app: string; depth: number }
  'activity:popped': { app: string; depth: number }
  // Fired whenever an Activity leaves the foreground while the process survives
  // (goHome, or finish-rooting the last stacked Activity) — real Android only
  // ever renders the one foreground app; this tells the display wall to drop the
  // app's tile from bright to faint. LMK death is already covered by
  // process:killed, so this event never fires for that path.
  'activity:backgrounded': { app: string }
  // bindService/unbindService — client holds a Binder connection to service's
  // ward; drives the tether visual and foundry priority inheritance.
  'service:bound': { client: string; service: string }
  'service:unbound': { client: string }
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
