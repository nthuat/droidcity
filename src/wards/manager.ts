import * as THREE from 'three'
import type { Bus } from '../core/bus'
import type { PacketSystem } from '../scene/packet'
import { buildWardMeshes, type WardMeshes } from '../scene/ward'
import { createLooper, post, advance } from '../sim/looper'
import { createActivity, launch, rotate as rotateActivity, background, foreground, finish, type Phase } from '../sim/lifecycle'
import { createHeap, allocate, releaseOldest, gc as gcHeap, usedKb } from '../sim/heap'
import type { Priority } from '../sim/processes'
import { createDb, query, insert, DB_QUERY_MS } from '../sim/roomDb'
import { createPlots, allocatePlot, releasePlot } from '../sim/wardPlots'
import { DEFAULT_STAGES, startFrame, advanceFrame, withHeavyDraw } from '../sim/framePipeline'
import { buildWardPanel } from './panel'
import { type WardEntry, trimProcessed, trimLog, narrationFor } from './entry'
import {
  syncCars, syncFloors, syncCrates, syncFlashes, syncBench, syncWorkerCars, syncStackCards, syncNative,
  setAppFloorLit, setServiceAnnexLit, setProviderSlabLit, disposeMesh, clearPool,
  syncSingleTopFlash, syncThreadPosts, sweepBarX, SHED_FLASH_MS, SCREEN_FLASH_MS, SINGLE_TOP_FLASH_MS, SWEEP_MS,
} from './visualSync'
import { makeCar } from '../scene/builders'

export interface WardHandles {
  readonly app: string
  readonly pid: number
  readonly plot: number
}

export interface WardManager {
  update(dtMs: number): void
  setIdle(enabled: boolean): void
  wards(): readonly WardHandles[]
  wardStats(): {
    app: string; plot: number; busy: boolean; anr: boolean; phase: Phase; backStack: number
    heapUsedKb: number; heapCapacityKb: number; nativeKb: number; panelMessage: string
  }[]
  wardGroupFor(app: string): THREE.Group | null
  wardAppFromObject(obj: THREE.Object3D): string | null
  panelFor(app: string): HTMLElement | null
  blockMainThread(app: string, ms: number): void
  forceGc(app: string): void
  callNative(app: string): void
  nativeCrash(app: string): void
  rotate(app: string): void
  refreshData(app: string): void
  runHeavyFrame(app: string): void
  goHome(app: string): void
  toggleService(app: string): boolean
  pushActivity(app: string, mode?: 'standard' | 'singleTop'): void
  popActivity(app: string): void
  bindService(clientApp: string, serviceApp: string): void
  unbindService(clientApp: string): void
  toggleBind(app: string): void
}

export interface WardManagerDeps {
  bus: Bus
  scene: THREE.Scene
  packets: PacketSystem
  anchors: Record<string, THREE.Vector3>
  plotAnchors: readonly THREE.Vector3[]
  buildMeshes?: (app: string) => WardMeshes
  routePath?: (from: string, to: string) => THREE.Vector3[]
  onWardSpawned?: (app: string, pid: number, group: THREE.Group) => void
  onWardKilled?: (app: string) => void
  // Told about warm/hot brought-to-front (via app:broughtToFront) and Home
  // (goHome) so the foreground/cached/service split stays in sync with foundry's
  // OOM ladder. Optional so unit tests can omit it.
  setAppPriority?: (app: string, priority: Priority) => void
  // Fired once per spawn ('cold') and once per app:broughtToFront resolution
  // ('warm' | 'hot') — main.ts flashes the ward label's third line with it.
  onStartType?: (app: string, type: 'cold' | 'warm' | 'hot') => void
  // Fired when a process:forked lands but no ward can spawn (plot still held by
  // a demolishing predecessor, or no free plot). Without a listener the forked
  // proc lives on with no ward and the launcher stays 'launching' forever —
  // main.ts wires this to foundry.killApp so the whole flow unwinds.
  onSpawnDropped?: (app: string, pid: number) => void
  // A native SIGSEGV takes the process down; main.ts wires this to
  // foundry.killApp so the whole city unwinds exactly like an LMK kill.
  onNativeCrash?: (app: string) => void
}

const RISE_MS = 800
const BUSY_GLOW_MS = 400
const JNI_FLASH_MS = 500
const RESTORE_WINDOW_MS = 60000
const FRAME_VISUAL_SCALE = 0.02
const DEMOLISH_MS = 600
const DATA_REQUEST_MS = 600
const IDLE_TAP_MS = 2000
const IDLE_ROTATE_MS = 18000
const IDLE_RELEASE_MS = 6000
const IDLE_ALLOC_MS = 5000
const REBUILD_MS = 1200
const REBUILD_HALF_MS = REBUILD_MS / 2
const ALLOC_KB = 80
const ALLOC_COUNT = 3
const IDLE_ALLOC_KB = 60
const IDLE_ALLOC_COUNT = 2
const HEAP_CAPACITY_KB = 2000
const HEAVY_DRAW_MS = 20
const WORKER_CAR_COLOR = 0x8b949e
const WORKER_CAR_SCALE = 0.3
const HOT_PULSE_MS = 200
const BINDER_PULSE_MS = 300
// How long a transient panel feedback line (no-op explanation, GC result,
// etc.) stays up — long enough to actually read, unlike the sim-scale flash
// constants above.
const PANEL_MESSAGE_MS = 2500
const MAX_BACK_STACK = 3
const TETHER_COLOR = 0xbc8cff
const TETHER_Y = 2

const APP_STAGES = DEFAULT_STAGES.filter(s => !['gpu', 'surfaceFlinger'].includes(s.name))

export function createWardManager(deps: WardManagerDeps): WardManager {
  const { bus, scene, packets, anchors, plotAnchors, onWardSpawned, onWardKilled, setAppPriority, onStartType, onSpawnDropped, onNativeCrash } = deps
  const buildMeshes = deps.buildMeshes ?? buildWardMeshes
  // Default mirrors pre-routes.ts behavior: a straight two-point hop between the
  // named anchors/plot slots. Real routing is wired in from main.ts via routePath.
  const routePath = deps.routePath ?? ((from: string, to: string): THREE.Vector3[] => {
    const resolve = (key: string): THREE.Vector3 => key.startsWith('plot') ? plotAnchors[Number(key.slice(4))] : anchors[key]
    return [resolve(from), resolve(to)]
  })
  const wards = new Map<string, WardEntry>()
  let plots = createPlots(plotAnchors.length)
  let idleEnabled = true
  // Running sim clock (no Date.now — accumulates from update(dtMs) so it scales
  // with story-mode's slowed sim time same as everything else). Used only to
  // decide whether a fresh fork of a just-killed app counts as a "restore".
  let nowMs = 0
  const recentlyKilled = new Map<string, number>()
  // Android allows exactly one resumed Activity system-wide. Every path that
  // resumes an app routes through bringToForeground() so the previously
  // foreground app is auto-backgrounded (onPause/onStop + foundry priority
  // drop) instead of relying on each caller to remember to do it.
  let foregroundApp: string | null = null

  function bringToForeground(app: string): void {
    if (foregroundApp === app) return
    const previous = foregroundApp
    foregroundApp = app
    if (previous === null) return
    const prevEntry = wards.get(previous)
    if (!prevEntry || prevEntry.dying || prevEntry.activity.phase !== 'resumed') return
    prevEntry.activity = background(prevEntry.activity)
    prevEntry.binderPulseMs = BINDER_PULSE_MS
    bus.emit('activity:backgrounded', { app: previous })
    setAppPriority?.(previous, backgroundPriority(prevEntry))
    if (prevEntry.boundTo) recomputeServicePriority(prevEntry.boundTo)
  }

  // The priority a backgrounded ward should hold: normally 'service' while its
  // own Service runs, else 'cached' — but a bound client keeps this ward's
  // importance at 'visible' as long as that client is foreground, mirroring
  // Android's Binder-connection priority inheritance (oom_adj 100 vs 500/900).
  function backgroundPriority(entry: WardEntry): Priority {
    const boundClient = [...wards.values()].find(
      w => w.app !== entry.app && !w.dying && w.boundTo === entry.app,
    )
    if (boundClient && boundClient.activity.phase === 'resumed') return 'visible'
    return entry.serviceRunning ? 'service' : 'cached'
  }

  // Re-derives a service ward's foundry priority from its binding clients'
  // current states. Only meaningful while the target isn't itself foreground
  // (that priority is owned by the resume/foreground path, not this one).
  // Called after bind/unbind AND whenever a bound client stops being foreground
  // (backgrounded, finished, killed) — else the service ward keeps a stale
  // 'visible' inherited from a client that's no longer on screen.
  function recomputeServicePriority(serviceApp: string): void {
    const entry = wards.get(serviceApp)
    if (!entry || entry.dying || entry.activity.phase === 'resumed') return
    setAppPriority?.(entry.app, backgroundPriority(entry))
  }

  // Next living ward alphabetically after `app`, wrapping around — the target
  // the panel's 'Bind to <next app>' button offers.
  function nextLivingWard(app: string): string | null {
    const names = [...wards.values()].filter(w => !w.dying).map(w => w.app).sort()
    if (names.length < 2) return null
    const idx = names.indexOf(app)
    return names[(idx + 1) % names.length]
  }

  // Sets the transient panel feedback line (see WardEntry.panelMessage) —
  // used on button no-ops and otherwise-invisible notable results so every
  // click gives the user something to read.
  function setPanelMessage(entry: WardEntry, msg: string): void {
    entry.panelMessage = msg
    entry.panelMessageMs = PANEL_MESSAGE_MS
  }

  function createTether(client: WardEntry, service: WardEntry): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(client.meshes.group.position.x, TETHER_Y, client.meshes.group.position.z),
      new THREE.Vector3(service.meshes.group.position.x, TETHER_Y, service.meshes.group.position.z),
    ])
    const material = new THREE.LineBasicMaterial({ color: TETHER_COLOR })
    const line = new THREE.Line(geometry, material)
    line.userData.info = {
      title: 'Bound service',
      note: 'Client holds a Binder connection; while the client is foreground the service process inherits visibility — oom_adj 100 instead of 500/900.',
    }
    scene.add(line)
    return line
  }

  function disposeTether(entry: WardEntry): void {
    if (!entry.tether) return
    scene.remove(entry.tether)
    entry.tether.geometry.dispose()
    ;(entry.tether.material as THREE.Material).dispose()
    entry.tether = null
  }

  // Panel 'Bind to <next app>' / 'Unbind' button: client's Binder connection to
  // another ward's Service. Rebinding drops any prior tether first (one bind
  // per client). Priority inheritance is recomputed immediately (bind/unbind)
  // and again on every future background-transition via backgroundPriority.
  function bindService(clientApp: string, serviceApp: string): void {
    const client = wards.get(clientApp)
    const service = wards.get(serviceApp)
    if (!client || !service || client.dying || service.dying || clientApp === serviceApp) return
    if (client.boundTo === serviceApp) return
    if (client.boundTo) unbindService(clientApp)
    client.boundTo = serviceApp
    client.tether = createTether(client, service)
    bus.emit('service:bound', { client: clientApp, service: serviceApp })
    recomputeServicePriority(serviceApp)
  }

  function unbindService(clientApp: string): void {
    const client = wards.get(clientApp)
    if (!client || client.boundTo === null) return
    const serviceApp = client.boundTo
    disposeTether(client)
    client.boundTo = null
    bus.emit('service:unbound', { client: clientApp })
    recomputeServicePriority(serviceApp)
  }

  function allocateN(entry: WardEntry, app: string, count: number, sizeKb: number): void {
    for (let i = 0; i < count; i++) {
      try {
        const result = allocate(entry.heap, sizeKb)
        entry.heap = result.state
        if (result.gcRan) {
          bus.emit('gc:swept', { app, freedKb: entry.heap.lastFreedKb })
          entry.sweepMs = SWEEP_MS
        }
      } catch {
        // OutOfMemoryError — spec says swallow silently, no leak UI in this task.
      }
    }
  }

  function onForked({ app, pid }: { app: string; pid: number }): void {
    const result = allocatePlot(plots, app)
    // duplicate app (incl. a re-fork landing while the old instance is still
    // demolishing — its plot isn't released until demolition completes), or no
    // free plot (LMK race) — dropped by design, no queueing/retry. The forked
    // proc still exists though, so tell main.ts to kill it (else: launcher
    // stuck 'launching', unkillable foreground proc, dead kiosk).
    if (result.plot === -1) {
      onSpawnDropped?.(app, pid)
      return
    }
    plots = result.state

    const meshes = buildMeshes(app)
    meshes.group.position.copy(plotAnchors[result.plot])
    meshes.group.scale.y = 0
    scene.add(meshes.group)

    const killedAt = recentlyKilled.get(app)
    const restored = killedAt !== undefined && nowMs - killedAt < RESTORE_WINDOW_MS

    const entry: WardEntry = {
      app, pid, plot: result.plot, meshes,
      looper: createLooper(),
      activity: createActivity(),
      backStack: 0,
      heap: createHeap(HEAP_CAPACITY_KB),
      nativeKb: 0,
      jniFlashMs: 0,
      db: createDb(),
      frame: null,
      dying: false,
      resumed: false,
      restored,
      serviceRunning: false,
      riseMs: 0,
      demolishMs: 0,
      demolishStartScale: 1,
      resumedMs: 0,
      dataRequested: false,
      dbQueryMs: 0,
      dbPending: false,
      anrFlashT: 0,
      busyGlowMs: 0,
      shedFlashMs: 0,
      screenFlashMs: 0,
      sweepMs: 0,
      sweepMesh: null,
      rebuildMs: 0,
      hotPulseMs: 0,
      idleTapMs: 0,
      idleRotateMs: 0,
      idleReleaseMs: 0,
      idleAllocMs: 0,
      carPool: new Map(),
      cratePool: new Map(),
      crateSlots: new Map(),
      workerCars: new Map(),
      panel: null,
      singleTopFlashMs: 0,
      boundTo: null,
      tether: null,
      binderPulseMs: 0,
      panelMessage: '',
      panelMessageMs: 0,
    }
    wards.set(app, entry)
    onWardSpawned?.(app, pid, meshes.group)
    // activity:resumed (+ Binder packet) fires later, when the rise animation
    // completes (see updateWard) — not synchronously here. Firing it immediately
    // let a whole story chapter's event chain (launchRequested→forked→resumed→…)
    // resolve inside one call stack, outrunning the story player's wait-arming.
  }

  function onKilled({ app }: { app: string; pid: number }): void {
    recentlyKilled.set(app, nowMs)
    if (foregroundApp === app) foregroundApp = null
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    entry.dying = true
    entry.demolishMs = 0
    entry.demolishStartScale = entry.meshes.group.scale.y
    setAppFloorLit(entry.meshes, false)
    setProviderSlabLit(entry.meshes, false)
    // Tether never outlives either end: drop this ward's own outgoing bind,
    // and any other living client's tether that pointed at this (now-dead) ward.
    if (entry.boundTo) {
      const serviceApp = entry.boundTo
      disposeTether(entry)
      entry.boundTo = null
      // Dead client no longer lends 'visible' — service drops to service/cached.
      recomputeServicePriority(serviceApp)
    }
    for (const other of wards.values()) {
      if (other.boundTo === app) { disposeTether(other); other.boundTo = null }
    }
  }

  // onTrimMemory, modeled coarsely: every live ward voluntarily sheds its two
  // oldest heap objects (they turn grey/garbage, same as a real GC sweep) —
  // silent (no narration change) because this is cooperative shrink, not a
  // kill. Reuses the same releaseOldest + sweep-visual + gc:swept path as
  // forceGc/idle release.
  function onMemoryTrim(): void {
    for (const entry of wards.values()) {
      if (entry.dying) continue
      const targets = entry.heap.objects.filter(o => o.reachable).slice(0, 2)
      if (targets.length === 0) continue
      entry.heap = releaseOldest(entry.heap, 2)
      entry.sweepMs = SWEEP_MS
      bus.emit('gc:swept', { app: entry.app, freedKb: targets.reduce((sum, o) => sum + o.sizeKb, 0) })
    }
  }

  // A ward requesting data (auto DATA_REQUEST_MS expiry or a manual refresh —
  // both emit this event) spawns a worker car per outstanding source, so the
  // ward visibly hops main → worker instead of implying main-thread IO.
  function onDataRequested({ app, source }: { app: string; source: 'db' | 'network' }): void {
    const entry = wards.get(app)
    if (!entry || entry.dying || entry.workerCars.has(source)) return
    const car = makeCar(WORKER_CAR_COLOR)
    car.scale.setScalar(WORKER_CAR_SCALE)
    entry.meshes.workerParent.add(car)
    entry.workerCars.set(source, car)
  }

  // Shared by every completion path (success or drop) so a source's worker car
  // never outlives its request, regardless of how the request ends.
  function removeWorkerCar(entry: WardEntry, source: 'db' | 'network'): void {
    const workerCar = entry.workerCars.get(source)
    if (!workerCar) return
    entry.meshes.workerParent.remove(workerCar)
    disposeMesh(workerCar)
    entry.workerCars.delete(source)
  }

  // networkTower's queue caps at 3 in-flight requests and silently drops
  // anything beyond that (no data:fetched ever follows) — without this, that
  // app's network worker car would orbit the lane forever.
  function onDataDropped({ app }: { app: string }): void {
    const entry = wards.get(app)
    if (!entry) return
    removeWorkerCar(entry, 'network')
  }

  function onDataArrived(app: string, isFetched: boolean): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    removeWorkerCar(entry, isFetched ? 'network' : 'db')
    const label = isFetched ? 'bindNetwork' : 'bindCache'
    const cost = isFetched ? 16 : 4
    entry.looper = post(entry.looper, label, cost)
    bus.emit('ui:messagePosted', { app, label })
    if (isFetched) {
      entry.db = insert(entry.db, 'feed')
      allocateN(entry, app, ALLOC_COUNT, ALLOC_KB)
    }
  }

  function onMessagePosted({ app }: { app: string; label: string }): void {
    const entry = wards.get(app)
    // Backgrounded/destroyed wards still run their looper (background work is
    // real) but never render — matches real Android: only the foreground
    // Activity produces frames.
    if (!entry || entry.dying || entry.activity.phase !== 'resumed') return
    if (!entry.frame) entry.frame = startFrame(APP_STAGES)
  }

  function onComposited({ app }: { app: string }): void {
    const entry = wards.get(app)
    if (!entry) return
    entry.screenFlashMs = SCREEN_FLASH_MS
  }

  // Reached only via launcherPlaza tapping an already-running app's kiosk. The
  // event carries no start type — this manager owns activity.phase, so it's the
  // only party that can tell warm ('stopped' → foreground()) from hot (already
  // 'resumed') apart, and it reports the real type back via onStartType.
  function onBroughtToFront({ app }: { app: string }): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    entry.binderPulseMs = BINDER_PULSE_MS
    if (entry.activity.phase === 'stopped') {
      bringToForeground(app)
      entry.activity = foreground(entry.activity) // floors relight 1→3 via syncFloors
      setAppPriority?.(app, 'foreground')
      bus.emit('activity:resumed', { app })
      onStartType?.(app, 'warm')
    } else if (entry.activity.phase === 'resumed') {
      bringToForeground(app)
      entry.screenFlashMs = SCREEN_FLASH_MS
      entry.hotPulseMs = HOT_PULSE_MS
      setAppPriority?.(app, 'foreground')
      bus.emit('activity:resumed', { app })
      onStartType?.(app, 'hot')
    } else if (entry.activity.phase === 'destroyed') {
      // Finished-root relaunch: pop-at-0 finished the Activity but the process
      // (and this ward) survived — launcher still lists the app running (it only
      // markStopped()s on process:killed), so a kiosk tap reaches here instead of
      // process:forked. launch() recreates the Activity — a real warm start, not
      // just foreground()'s resume-in-place.
      bringToForeground(app)
      entry.activity = launch(entry.activity)
      setAppPriority?.(app, 'foreground')
      bus.emit('activity:resumed', { app })
      onStartType?.(app, 'warm')
    }
    // Any other phase (created/started/paused): no-op — launcherPlaza only emits
    // this for an app the launcher sim already considers running.
  }

  bus.on('process:forked', onForked)
  bus.on('process:killed', onKilled)
  bus.on('data:requested', onDataRequested)
  bus.on('data:dropped', onDataDropped)
  bus.on('data:cacheHit', p => onDataArrived(p.app, false))
  bus.on('data:fetched', p => onDataArrived(p.app, true))
  bus.on('ui:messagePosted', onMessagePosted)
  bus.on('frame:composited', onComposited)
  bus.on('memory:trim', onMemoryTrim)
  bus.on('app:broughtToFront', onBroughtToFront)

  function blockMainThread(app: string, ms: number): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    entry.looper = post(entry.looper, 'diskReadOnMain', ms)
  }

  function forceGc(app: string): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    entry.heap = gcHeap(entry.heap)
    entry.sweepMs = SWEEP_MS
    bus.emit('gc:swept', { app, freedKb: entry.heap.lastFreedKb })
    setPanelMessage(entry, entry.heap.lastFreedKb > 0
      ? `GC — freed ${entry.heap.lastFreedKb}KB (native heap ${entry.nativeKb}KB untouched)`
      : `GC — nothing unreachable (native heap ${entry.nativeKb}KB untouched)`)
  }

  // JNI call: a managed thread crosses into the .so. Costs a main-thread
  // message (marshalling + the native work itself) and mallocs native bytes
  // that no GC will ever reclaim.
  const JNI_WORK_MS = 40
  const JNI_MALLOC_KB = 160
  function callNative(app: string): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    entry.looper = post(entry.looper, 'jniCall', JNI_WORK_MS)
    entry.nativeKb += JNI_MALLOC_KB
    entry.jniFlashMs = JNI_FLASH_MS
    entry.busyGlowMs = BUSY_GLOW_MS
    bus.emit('jni:called', { app, nativeKb: entry.nativeKb })
    setPanelMessage(entry, `JNI → native: +${JNI_MALLOC_KB}KB native heap (${entry.nativeKb}KB total, GC can't free it)`)
  }

  // Native crash: SIGSEGV in the .so takes the whole process down — no Java
  // exception to catch, no onDestroy, just a tombstone. Same demolition path as
  // an LMK kill because from the city's view it IS the same: process gone.
  function nativeCrash(app: string): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    setPanelMessage(entry, 'SIGSEGV in native code — process gone, tombstone written, no onDestroy')
    bus.emit('native:crashed', { app })
    onNativeCrash?.(app)
  }

  function rotateWard(app: string): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    if (entry.activity.phase !== 'resumed') {
      setPanelMessage(entry, 'Rotate: activity not in foreground')
      return
    }
    entry.activity = rotateActivity(entry.activity)
    entry.rebuildMs = REBUILD_MS
  }

  // Panel 'Home' button: backgrounds the Activity (floors dim to 1) and drops
  // foundry priority to service (if the ward's service is on) or cached.
  // No-op unless actually resumed — a second Home press must not re-emit
  // activity:backgrounded or re-touch priority (background() itself would
  // already be a phase no-op).
  function goHome(app: string): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    if (entry.activity.phase !== 'resumed') {
      setPanelMessage(entry, 'Home: not in foreground')
      return
    }
    entry.activity = background(entry.activity)
    entry.binderPulseMs = BINDER_PULSE_MS
    setAppPriority?.(app, backgroundPriority(entry))
    bus.emit('activity:backgrounded', { app })
    if (entry.boundTo) recomputeServicePriority(entry.boundTo)
    if (foregroundApp === app) foregroundApp = null
  }

  // Panel 'Open screen' / 'Open (singleTop)' buttons: pushes a stacked Activity
  // onto the task. Only meaningful from the foreground (resumed) — capped at 3
  // (matches the 3 pre-built stackCards in WardMeshes), beyond that a no-op.
  // singleTop + something already stacked above the root: reuse the top
  // instance instead — no new card, no activity:pushed, just a brief flash.
  function pushActivity(app: string, mode: 'standard' | 'singleTop' = 'standard'): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    if (entry.activity.phase !== 'resumed') {
      const label = mode === 'singleTop' ? 'Open (singleTop)' : 'Open screen'
      setPanelMessage(entry, `${label}: activity not in foreground`)
      return
    }
    if (mode === 'singleTop' && entry.backStack > 0) {
      entry.singleTopFlashMs = SINGLE_TOP_FLASH_MS
      return
    }
    if (entry.backStack >= MAX_BACK_STACK) {
      setPanelMessage(entry, 'back stack full — max 3 stacked screens')
      return
    }
    entry.backStack += 1
    bus.emit('activity:pushed', { app, depth: entry.backStack })
    // Real Android singleTop semantics: no existing instance on top of the
    // task to reuse, so it falls back to a standard push — same as above,
    // just flagged so the click doesn't look identical to a plain 'Open screen'.
    if (mode === 'singleTop') {
      setPanelMessage(entry, 'singleTop: no instance on top — pushed new one')
    }
  }

  // Panel 'Back' button: pops the top stacked Activity, or — once the stack is
  // already empty — finishes the root Activity itself. finish() is the sim's
  // own no-op guard for an already-destroyed phase, so popping past that point
  // is simply ignored (nothing left to pop). Finishing the root leaves the
  // process (and this ward) alive — warm-start material — so foundry priority
  // drops the same way goHome does (service if running, else cached).
  function popActivity(app: string): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    if (entry.backStack > 0) {
      entry.backStack -= 1
      bus.emit('activity:popped', { app, depth: entry.backStack })
      return
    }
    if (entry.activity.phase === 'destroyed') {
      setPanelMessage(entry, 'Back: nothing to close')
      return
    }
    entry.activity = finish(entry.activity)
    setAppPriority?.(app, backgroundPriority(entry))
    bus.emit('activity:backgrounded', { app })
    if (entry.boundTo) recomputeServicePriority(entry.boundTo)
    if (foregroundApp === app) foregroundApp = null
  }

  // Panel 'Start service'/'Stop service' button: flips entry.serviceRunning,
  // lights the annex amber, emits service:changed. Only touches foundry priority
  // when the ward is currently backgrounded (phase 'stopped') — a foreground
  // ward stays 'foreground' regardless of service state (spec: "foreground apps
  // stay 'foreground'"). Returns the new running state for the panel to reflect.
  function toggleService(app: string): boolean {
    const entry = wards.get(app)
    if (!entry || entry.dying) return false
    entry.serviceRunning = !entry.serviceRunning
    setServiceAnnexLit(entry.meshes, entry.serviceRunning)
    bus.emit('service:changed', { app, running: entry.serviceRunning })
    if (entry.activity.phase === 'stopped') {
      setAppPriority?.(app, backgroundPriority(entry))
    }
    return entry.serviceRunning
  }

  // City Hall 'Send broadcast' + boot:complete (main.ts) both emit this. Every
  // non-dying ward reacts identically regardless of `action` — no per-app intent
  // filtering modeled here (teaching-scope simplification, see plan).
  function onBroadcastSent(): void {
    for (const entry of wards.values()) {
      if (entry.dying) continue
      entry.looper = post(entry.looper, 'onReceive', 6)
      bus.emit('ui:messagePosted', { app: entry.app, label: 'onReceive' })
    }
  }
  bus.on('broadcast:sent', onBroadcastSent)

  function refreshData(app: string): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    bus.emit('data:requested', { app, source: 'db' })
    bus.emit('data:requested', { app, source: 'network' })
    entry.dbQueryMs = 0
    entry.dbPending = true
  }

  function runHeavyFrame(app: string): void {
    const entry = wards.get(app)
    if (!entry || entry.dying || entry.frame) return
    entry.frame = startFrame(withHeavyDraw(APP_STAGES, HEAVY_DRAW_MS))
  }

  function updateGroupScale(entry: WardEntry, dtMs: number): void {
    // A restored ward (re-forked <60s after an LMK kill) rises in half the
    // time — saved state + ViewModel skip most of the cold-start cost.
    const riseDuration = entry.restored ? RISE_MS / 2 : RISE_MS
    if (entry.riseMs < riseDuration) {
      entry.riseMs = Math.min(riseDuration, entry.riseMs + dtMs)
      entry.meshes.group.scale.y = entry.riseMs / riseDuration
      return
    }
    if (entry.rebuildMs > 0) {
      entry.rebuildMs = Math.max(0, entry.rebuildMs - dtMs)
      entry.meshes.group.scale.y = entry.rebuildMs > REBUILD_HALF_MS
        ? (entry.rebuildMs - REBUILD_HALF_MS) / REBUILD_HALF_MS
        : 1 - entry.rebuildMs / REBUILD_HALF_MS
      return
    }
    entry.meshes.group.scale.y = 1
  }

  function updateWard(app: string, entry: WardEntry, dtMs: number): void {
    if (entry.dying) {
      entry.demolishMs += dtMs
      entry.meshes.group.scale.y = entry.demolishStartScale * Math.max(0, 1 - entry.demolishMs / DEMOLISH_MS)
      if (entry.demolishMs >= DEMOLISH_MS) {
        // buildWardMeshes' dispose() only frees its own static disposables —
        // cars/crates/sweep-plane are created dynamically by this manager and
        // are almost always still alive at kill time (this branch returns
        // above before syncCars/syncCrates can drain them), so dispose them here.
        clearPool(entry.meshes.carsParent, entry.carPool)
        clearPool(entry.meshes.cratesParent, entry.cratePool)
        clearPool(entry.meshes.workerParent, entry.workerCars)
        entry.crateSlots.clear()
        if (entry.sweepMesh) {
          entry.meshes.cratesParent.remove(entry.sweepMesh)
          disposeMesh(entry.sweepMesh)
          entry.sweepMesh = null
        }
        entry.meshes.dispose()
        scene.remove(entry.meshes.group)
        onWardKilled?.(app)
        plots = releasePlot(plots, app)
        wards.delete(app)
      }
      return
    }

    // ContentProviders instantiate before Application.onCreate — light the
    // slab a beat ahead of the appFloor (which lights at rise-complete, below).
    const riseDuration = entry.restored ? RISE_MS / 2 : RISE_MS
    setProviderSlabLit(entry.meshes, entry.riseMs >= riseDuration * 0.75)

    if (entry.resumed && !entry.dataRequested) {
      entry.resumedMs += dtMs
      if (entry.resumedMs >= DATA_REQUEST_MS) {
        entry.dataRequested = true
        bus.emit('data:requested', { app, source: 'db' })
        bus.emit('data:requested', { app, source: 'network' })
        entry.dbPending = true
        entry.dbQueryMs = 0
      }
    }
    if (entry.dbPending) {
      entry.dbQueryMs += dtMs
      if (entry.dbQueryMs >= DB_QUERY_MS) {
        entry.dbPending = false
        const result = query(entry.db, 'feed')
        bus.emit('data:cacheHit', { app, stale: !result.fresh })
        entry.shedFlashMs = SHED_FLASH_MS
      }
    }

    const wasAnr = entry.looper.anr
    // Compare last processed id (not length — trimProcessed caps the array at a
    // fixed size, so length stops changing once full).
    const lastProcessedBefore = entry.looper.processedIds[entry.looper.processedIds.length - 1]
    entry.looper = trimProcessed(advance(entry.looper, dtMs))
    if (entry.looper.anr && !wasAnr) bus.emit('anr', { app })
    const lastProcessedAfter = entry.looper.processedIds[entry.looper.processedIds.length - 1]
    if (entry.looper.current !== null || lastProcessedAfter !== lastProcessedBefore || entry.frame !== null) {
      entry.busyGlowMs = BUSY_GLOW_MS
    } else {
      entry.busyGlowMs = Math.max(0, entry.busyGlowMs - dtMs)
    }

    if (idleEnabled) {
      entry.idleTapMs += dtMs
      if (entry.idleTapMs >= IDLE_TAP_MS) {
        entry.idleTapMs -= IDLE_TAP_MS
        entry.looper = post(entry.looper, 'tap', 4)
      }
      entry.idleRotateMs += dtMs
      if (entry.idleRotateMs >= IDLE_ROTATE_MS) {
        entry.idleRotateMs -= IDLE_ROTATE_MS
        if (entry.activity.phase === 'resumed') {
          entry.activity = rotateActivity(entry.activity)
          entry.rebuildMs = REBUILD_MS
        }
      }
      entry.idleReleaseMs += dtMs
      if (entry.idleReleaseMs >= IDLE_RELEASE_MS) {
        entry.idleReleaseMs -= IDLE_RELEASE_MS
        entry.heap = releaseOldest(entry.heap, 2)
      }
      // Heap pressure to counterbalance releaseOldest above — without it, free-mode
      // wards never approach capacity and gc:swept never fires on its own.
      entry.idleAllocMs += dtMs
      if (entry.idleAllocMs >= IDLE_ALLOC_MS) {
        entry.idleAllocMs -= IDLE_ALLOC_MS
        allocateN(entry, app, IDLE_ALLOC_COUNT, IDLE_ALLOC_KB)
      }
    }

    if (entry.frame) {
      // Frame sim-time is stretched (a 9ms frame plays over ~450ms real) so the
      // render bench visibly lights stage by stage; `dropped` is computed from
      // sim totals at startFrame, so the stretch never changes verdicts.
      entry.frame = advanceFrame(entry.frame, dtMs * FRAME_VISUAL_SCALE)
      syncBench(entry.meshes, entry.frame)
      if (entry.frame.done) {
        bus.emit('frame:submitted', { app, dropped: entry.frame.dropped })
        packets.fly(routePath(`plot${entry.plot}`, 'surfaceflinger'), { arcHeight: 1 })
        entry.frame = null
        syncBench(entry.meshes, null)
      }
    }

    entry.activity = trimLog(entry.activity)
    entry.shedFlashMs = Math.max(0, entry.shedFlashMs - dtMs)
    entry.screenFlashMs = Math.max(0, entry.screenFlashMs - dtMs)
    entry.sweepMs = Math.max(0, entry.sweepMs - dtMs)
    entry.jniFlashMs = Math.max(0, entry.jniFlashMs - dtMs)
    entry.singleTopFlashMs = Math.max(0, entry.singleTopFlashMs - dtMs)
    entry.binderPulseMs = Math.max(0, entry.binderPulseMs - dtMs)
    entry.panelMessageMs = Math.max(0, entry.panelMessageMs - dtMs)
    entry.anrFlashT += dtMs
    updateGroupScale(entry, dtMs)
    if (entry.hotPulseMs > 0) {
      entry.hotPulseMs = Math.max(0, entry.hotPulseMs - dtMs)
      const bounce = 1 + 0.15 * Math.sin((entry.hotPulseMs / HOT_PULSE_MS) * Math.PI)
      entry.meshes.group.scale.y *= bounce
    }

    // Activity resumes (onCreate/onStart/onResume + Binder packet) once the rise
    // animation finishes — not synchronously on fork — so floors light while the
    // narration reads, and the data-request timer above only starts from here.
    if (!entry.resumed && entry.riseMs >= (entry.restored ? RISE_MS / 2 : RISE_MS)) {
      entry.resumed = true
      bringToForeground(app)
      setAppFloorLit(entry.meshes, true)
      entry.activity = launch(entry.activity)
      bus.emit('activity:resumed', { app })
      onStartType?.(app, 'cold')
      const plotKey = `plot${entry.plot}`
      const toCityhall = routePath(plotKey, 'cityhall')
      const toLauncher = routePath('cityhall', 'launcher')
      packets.fly([...toCityhall, ...toLauncher.slice(1)], { color: 0xbc8cff, arcHeight: 1 })
    }

    if (entry.panel) {
      entry.panel.setNarration(narrationFor(entry))
      entry.panel.syncService(entry.serviceRunning)
      entry.panel.syncBind(entry.boundTo, nextLivingWard(app))
    }

    syncCars(entry.meshes, entry.looper, entry.carPool)
    syncWorkerCars(entry.meshes, entry.workerCars, entry.anrFlashT)
    syncFloors(entry.meshes, entry.activity.phase)
    syncStackCards(entry.meshes, entry.backStack)
    syncSingleTopFlash(entry.meshes, entry.backStack, entry.singleTopFlashMs)
    entry.meshes.viewModelOrb.visible = entry.activity.viewModelValue !== null
    syncCrates(entry.meshes, entry.heap, entry.cratePool, entry.crateSlots, entry.sweepMs > 0, sweepBarX(entry.sweepMs))
    syncNative(entry.meshes, entry.nativeKb, entry.jniFlashMs)
    syncFlashes(entry, entry.looper.anr, entry.anrFlashT, entry.app === foregroundApp && entry.activity.phase === 'resumed')
    syncThreadPosts(entry.meshes, {
      main: entry.busyGlowMs > 0,
      render: entry.frame !== null,
      binder: entry.binderPulseMs > 0,
      worker: entry.workerCars.size,
    })
  }

  // Panel 'Bind to <next app>' / 'Unbind' button: toggles a bind to the next
  // living ward alphabetically (the same target the panel label shows).
  function toggleBind(app: string): void {
    const entry = wards.get(app)
    if (!entry) return
    if (entry.boundTo) {
      unbindService(app)
      return
    }
    const target = nextLivingWard(app)
    if (target) {
      bindService(app, target)
    } else {
      setPanelMessage(entry, 'Bind: no other ward to bind to')
    }
  }

  return {
    update(dtMs) {
      nowMs += dtMs
      for (const [app, entry] of [...wards]) updateWard(app, entry, dtMs)
    },
    setIdle(enabled) { idleEnabled = enabled },
    wards() {
      return [...wards.values()].map(e => ({ app: e.app, pid: e.pid, plot: e.plot }))
    },
    wardStats() {
      return [...wards.values()].filter(e => !e.dying).map(e => ({
        app: e.app, plot: e.plot, busy: e.busyGlowMs > 0 || e.looper.current !== null, anr: e.looper.anr, phase: e.activity.phase,
        backStack: e.backStack, heapUsedKb: usedKb(e.heap), heapCapacityKb: e.heap.capacityKb,
        nativeKb: e.nativeKb,
        panelMessage: e.panelMessageMs > 0 ? e.panelMessage : '',
      }))
    },
    wardGroupFor(app) {
      return wards.get(app)?.meshes.group ?? null
    },
    wardAppFromObject(obj) {
      let o: THREE.Object3D | null = obj
      while (o) {
        const app = o.userData.app
        if (typeof app === 'string') return app
        o = o.parent
      }
      return null
    },
    panelFor(app) {
      const entry = wards.get(app)
      if (!entry) return null
      if (!entry.panel) {
        entry.panel = buildWardPanel(
          app,
          { blockMainThread, rotate: rotateWard, forceGc, callNative, nativeCrash, refreshData, goHome, toggleService, pushActivity, popActivity, toggleBind },
          narrationFor(entry),
          entry.serviceRunning,
        )
      }
      return entry.panel.root
    },
    blockMainThread,
    forceGc,
    callNative,
    nativeCrash,
    rotate: rotateWard,
    refreshData,
    runHeavyFrame,
    goHome,
    toggleService,
    pushActivity,
    popActivity,
    bindService,
    unbindService,
    toggleBind,
  }
}
