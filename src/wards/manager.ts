import * as THREE from 'three'
import type { Bus } from '../core/bus'
import type { PacketSystem } from '../scene/packet'
import { buildWardMeshes, type WardMeshes } from '../scene/ward'
import { createLooper, post, advance } from '../sim/looper'
import { createActivity, launch, rotate as rotateActivity } from '../sim/lifecycle'
import { createHeap, allocate, releaseOldest, gc as gcHeap } from '../sim/heap'
import { createDb, query, insert, DB_QUERY_MS } from '../sim/roomDb'
import { createPlots, allocatePlot, releasePlot } from '../sim/wardPlots'
import { DEFAULT_STAGES, startFrame, advanceFrame, withHeavyDraw } from '../sim/framePipeline'
import { buildWardPanel } from './panel'
import { type WardEntry, trimProcessed, trimLog, narrationFor } from './entry'
import { syncCars, syncFloors, syncCrates, syncFlashes, disposeMesh, clearPool, SHED_FLASH_MS, SCREEN_FLASH_MS } from './visualSync'

export interface WardHandles {
  readonly app: string
  readonly pid: number
  readonly plot: number
}

export interface WardManager {
  update(dtMs: number): void
  setIdle(enabled: boolean): void
  wards(): readonly WardHandles[]
  wardGroupFor(app: string): THREE.Group | null
  wardAppFromObject(obj: THREE.Object3D): string | null
  panelFor(app: string): HTMLElement | null
  blockMainThread(app: string, ms: number): void
  forceGc(app: string): void
  rotate(app: string): void
  refreshData(app: string): void
  runHeavyFrame(app: string): void
}

export interface WardManagerDeps {
  bus: Bus
  scene: THREE.Scene
  packets: PacketSystem
  anchors: Record<string, THREE.Vector3>
  plotAnchors: readonly THREE.Vector3[]
  buildMeshes?: (app: string) => WardMeshes
  routePath?: (from: string, to: string) => THREE.Vector3[]
}

const RISE_MS = 800
const DEMOLISH_MS = 600
const DATA_REQUEST_MS = 600
const IDLE_TAP_MS = 2000
const IDLE_ROTATE_MS = 18000
const IDLE_RELEASE_MS = 6000
const IDLE_ALLOC_MS = 5000
const REBUILD_MS = 1200
const REBUILD_HALF_MS = REBUILD_MS / 2
const SWEEP_MS = 600
const ALLOC_KB = 80
const ALLOC_COUNT = 3
const IDLE_ALLOC_KB = 60
const IDLE_ALLOC_COUNT = 2
const HEAP_CAPACITY_KB = 2000
const HEAVY_DRAW_MS = 20

const APP_STAGES = DEFAULT_STAGES.filter(s => !['gpu', 'surfaceFlinger'].includes(s.name))

export function createWardManager(deps: WardManagerDeps): WardManager {
  const { bus, scene, packets, anchors, plotAnchors } = deps
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
    // free plot (LMK race) — dropped by design, no queueing/retry.
    if (result.plot === -1) return
    plots = result.state

    const meshes = buildMeshes(app)
    meshes.group.position.copy(plotAnchors[result.plot])
    meshes.group.scale.y = 0
    scene.add(meshes.group)

    const entry: WardEntry = {
      app, pid, plot: result.plot, meshes,
      looper: createLooper(),
      activity: createActivity(),
      heap: createHeap(HEAP_CAPACITY_KB),
      db: createDb(),
      frame: null,
      dying: false,
      resumed: false,
      riseMs: 0,
      demolishMs: 0,
      demolishStartScale: 1,
      resumedMs: 0,
      dataRequested: false,
      dbQueryMs: 0,
      dbPending: false,
      anrFlashT: 0,
      shedFlashMs: 0,
      screenFlashMs: 0,
      sweepMs: 0,
      sweepMesh: null,
      rebuildMs: 0,
      idleTapMs: 0,
      idleRotateMs: 0,
      idleReleaseMs: 0,
      idleAllocMs: 0,
      carPool: new Map(),
      cratePool: new Map(),
      crateSlots: new Map(),
      panel: null,
    }
    wards.set(app, entry)
    // activity:resumed (+ Binder packet) fires later, when the rise animation
    // completes (see updateWard) — not synchronously here. Firing it immediately
    // let a whole story chapter's event chain (launchRequested→forked→resumed→…)
    // resolve inside one call stack, outrunning the story player's wait-arming.
  }

  function onKilled({ app }: { app: string; pid: number }): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    entry.dying = true
    entry.demolishMs = 0
    entry.demolishStartScale = entry.meshes.group.scale.y
  }

  function onDataArrived(app: string, isFetched: boolean): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
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
    if (!entry || entry.dying) return
    if (!entry.frame) entry.frame = startFrame(APP_STAGES)
  }

  function onComposited({ app }: { app: string }): void {
    const entry = wards.get(app)
    if (!entry) return
    entry.screenFlashMs = SCREEN_FLASH_MS
  }

  bus.on('process:forked', onForked)
  bus.on('process:killed', onKilled)
  bus.on('data:cacheHit', p => onDataArrived(p.app, false))
  bus.on('data:fetched', p => onDataArrived(p.app, true))
  bus.on('ui:messagePosted', onMessagePosted)
  bus.on('frame:composited', onComposited)

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
  }

  function rotateWard(app: string): void {
    const entry = wards.get(app)
    if (!entry || entry.dying || entry.activity.phase !== 'resumed') return
    entry.activity = rotateActivity(entry.activity)
    entry.rebuildMs = REBUILD_MS
  }

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
    if (entry.riseMs < RISE_MS) {
      entry.riseMs = Math.min(RISE_MS, entry.riseMs + dtMs)
      entry.meshes.group.scale.y = entry.riseMs / RISE_MS
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
        entry.crateSlots.clear()
        if (entry.sweepMesh) {
          entry.meshes.cratesParent.remove(entry.sweepMesh)
          disposeMesh(entry.sweepMesh)
          entry.sweepMesh = null
        }
        entry.meshes.dispose()
        scene.remove(entry.meshes.group)
        plots = releasePlot(plots, app)
        wards.delete(app)
      }
      return
    }

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
    entry.looper = trimProcessed(advance(entry.looper, dtMs))
    if (entry.looper.anr && !wasAnr) bus.emit('anr', { app })

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
      entry.frame = advanceFrame(entry.frame, dtMs)
      if (entry.frame.done) {
        bus.emit('frame:submitted', { app, dropped: entry.frame.dropped })
        packets.fly(routePath(`plot${entry.plot}`, 'surfaceflinger'), { arcHeight: 1 })
        entry.frame = null
      }
    }

    entry.activity = trimLog(entry.activity)
    entry.shedFlashMs = Math.max(0, entry.shedFlashMs - dtMs)
    entry.screenFlashMs = Math.max(0, entry.screenFlashMs - dtMs)
    entry.sweepMs = Math.max(0, entry.sweepMs - dtMs)
    entry.anrFlashT += dtMs
    updateGroupScale(entry, dtMs)

    // Activity resumes (onCreate/onStart/onResume + Binder packet) once the rise
    // animation finishes — not synchronously on fork — so floors light while the
    // narration reads, and the data-request timer above only starts from here.
    if (!entry.resumed && entry.riseMs >= RISE_MS) {
      entry.resumed = true
      entry.activity = launch(entry.activity)
      bus.emit('activity:resumed', { app })
      const plotKey = `plot${entry.plot}`
      const toCityhall = routePath(plotKey, 'cityhall')
      const toLauncher = routePath('cityhall', 'launcher')
      packets.fly([...toCityhall, ...toLauncher.slice(1)], { color: 0xbc8cff, arcHeight: 1 })
    }

    if (entry.panel) entry.panel.setNarration(narrationFor(entry))

    syncCars(entry.meshes, entry.looper, entry.carPool)
    syncFloors(entry.meshes, entry.activity.phase)
    entry.meshes.viewModelOrb.visible = entry.activity.viewModelValue !== null
    syncCrates(entry.meshes, entry.heap, entry.cratePool, entry.crateSlots)
    syncFlashes(entry, entry.looper.anr, entry.anrFlashT)
  }

  return {
    update(dtMs) {
      for (const [app, entry] of [...wards]) updateWard(app, entry, dtMs)
    },
    setIdle(enabled) { idleEnabled = enabled },
    wards() {
      return [...wards.values()].map(e => ({ app: e.app, pid: e.pid, plot: e.plot }))
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
          { blockMainThread, rotate: rotateWard, forceGc, refreshData },
          narrationFor(entry),
        )
      }
      return entry.panel.root
    },
    blockMainThread,
    forceGc,
    rotate: rotateWard,
    refreshData,
    runHeavyFrame,
  }
}
