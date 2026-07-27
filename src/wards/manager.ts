import * as THREE from 'three'
import type { Bus } from '../core/bus'
import type { PacketSystem } from '../scene/packet'
import { buildWardMeshes, type WardMeshes } from '../scene/ward'
import { createLooper, post, advance, type LooperState } from '../sim/looper'
import { createActivity, launch, rotate as rotateActivity, type ActivityState } from '../sim/lifecycle'
import { createHeap, allocate, releaseOldest, gc as gcHeap, usedKb, type HeapState } from '../sim/heap'
import { createDb, query, insert, DB_QUERY_MS, type DbState } from '../sim/roomDb'
import { createPlots, allocatePlot, releasePlot } from '../sim/wardPlots'
import { DEFAULT_STAGES, startFrame, advanceFrame, type FrameRun } from '../sim/framePipeline'
import { makePanel, type Panel } from '../ui/panel'
import { syncCars, syncFloors, syncCrates, syncFlashes, SHED_FLASH_MS, SCREEN_FLASH_MS } from './visualSync'

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
}

export interface WardManagerDeps {
  bus: Bus
  scene: THREE.Scene
  packets: PacketSystem
  anchors: Record<string, THREE.Vector3>
  plotAnchors: readonly THREE.Vector3[]
  buildMeshes?: (app: string) => WardMeshes
}

const RISE_MS = 800
const DEMOLISH_MS = 600
const DATA_REQUEST_MS = 600
const IDLE_TAP_MS = 2000
const IDLE_ROTATE_MS = 18000
const IDLE_RELEASE_MS = 6000
const REBUILD_MS = 1200
const REBUILD_HALF_MS = REBUILD_MS / 2
const SWEEP_MS = 600
const BLOCK_MAIN_THREAD_MS = 8000
const ALLOC_KB = 80
const ALLOC_COUNT = 3
const PROCESSED_ID_LIMIT = 50
const LOG_LIMIT = 20
const HEAP_CAPACITY_KB = 2000

const APP_STAGES = DEFAULT_STAGES.filter(s => !['gpu', 'surfaceFlinger'].includes(s.name))

interface WardEntry {
  app: string
  pid: number
  plot: number
  meshes: WardMeshes
  looper: LooperState
  activity: ActivityState
  heap: HeapState
  db: DbState
  frame: FrameRun | null
  dying: boolean
  riseMs: number
  demolishMs: number
  resumedMs: number
  dataRequested: boolean
  dbQueryMs: number
  dbPending: boolean
  anrFlashT: number
  shedFlashMs: number
  screenFlashMs: number
  sweepMs: number
  sweepMesh: THREE.Mesh | null
  rebuildMs: number
  idleTapMs: number
  idleRotateMs: number
  idleReleaseMs: number
  carPool: Map<number, THREE.Mesh>
  cratePool: Map<number, THREE.Mesh>
  crateSlots: Map<number, number>
  panel: Panel | null
}

function trimProcessed(s: LooperState): LooperState {
  return s.processedIds.length > PROCESSED_ID_LIMIT
    ? { ...s, processedIds: s.processedIds.slice(-PROCESSED_ID_LIMIT) }
    : s
}

function trimLog(s: ActivityState): ActivityState {
  return s.log.length > LOG_LIMIT ? { ...s, log: s.log.slice(-LOG_LIMIT) } : s
}

function narrationFor(entry: WardEntry): string {
  const base = `${entry.activity.phase} · queue ${entry.looper.queue.length} · heap ${usedKb(entry.heap)}/${entry.heap.capacityKb}KB`
  return entry.looper.anr ? `${base} · ANR! main thread blocked 5s+` : base
}

export function createWardManager(deps: WardManagerDeps): WardManager {
  const { bus, scene, packets, anchors, plotAnchors } = deps
  const buildMeshes = deps.buildMeshes ?? buildWardMeshes
  const wards = new Map<string, WardEntry>()
  let plots = createPlots(plotAnchors.length)
  let idleEnabled = true

  function allocate3x80kb(entry: WardEntry, app: string): void {
    for (let i = 0; i < ALLOC_COUNT; i++) {
      try {
        const result = allocate(entry.heap, ALLOC_KB)
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
    if (result.plot === -1) return // duplicate app, or no free plot (LMK race) — skip
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
      riseMs: 0,
      demolishMs: 0,
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
      carPool: new Map(),
      cratePool: new Map(),
      crateSlots: new Map(),
      panel: null,
    }
    wards.set(app, entry)

    entry.activity = launch(entry.activity)
    bus.emit('activity:resumed', { app })
    packets.fly([plotAnchors[result.plot], anchors.cityhall, anchors.launcher])
  }

  function onKilled({ app }: { app: string; pid: number }): void {
    const entry = wards.get(app)
    if (!entry || entry.dying) return
    entry.dying = true
    entry.demolishMs = 0
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
      allocate3x80kb(entry, app)
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
      entry.meshes.group.scale.y = Math.max(0, 1 - entry.demolishMs / DEMOLISH_MS)
      if (entry.demolishMs >= DEMOLISH_MS) {
        entry.meshes.dispose()
        scene.remove(entry.meshes.group)
        plots = releasePlot(plots, app)
        wards.delete(app)
      }
      return
    }

    if (!entry.dataRequested) {
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
    }

    if (entry.frame) {
      entry.frame = advanceFrame(entry.frame, dtMs)
      if (entry.frame.done) {
        bus.emit('frame:submitted', { app, dropped: entry.frame.dropped })
        packets.fly([plotAnchors[entry.plot], anchors.surfaceflinger])
        entry.frame = null
      }
    }

    entry.activity = trimLog(entry.activity)
    entry.shedFlashMs = Math.max(0, entry.shedFlashMs - dtMs)
    entry.screenFlashMs = Math.max(0, entry.screenFlashMs - dtMs)
    entry.sweepMs = Math.max(0, entry.sweepMs - dtMs)
    entry.anrFlashT += dtMs
    updateGroupScale(entry, dtMs)

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
        const panel = makePanel(`${app} — app process`)
        panel.addButton('Block main thread (8s)', () => blockMainThread(app, BLOCK_MAIN_THREAD_MS))
        panel.addButton('Rotate', () => rotateWard(app))
        panel.addButton('Force GC', () => forceGc(app))
        panel.addButton('Refresh data', () => refreshData(app))
        panel.setNarration(narrationFor(entry))
        entry.panel = panel
      }
      return entry.panel.root
    },
    blockMainThread,
    forceGc,
    rotate: rotateWard,
    refreshData,
  }
}
