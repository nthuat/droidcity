import type * as THREE from 'three'
import type { WardMeshes } from '../scene/ward'
import type { LooperState } from '../sim/looper'
import type { ActivityState } from '../sim/lifecycle'
import { usedKb, type HeapState } from '../sim/heap'
import type { DbState } from '../sim/roomDb'
import type { FrameRun } from '../sim/framePipeline'
import type { WardPanel } from './panel'

const PROCESSED_ID_LIMIT = 50
const LOG_LIMIT = 20

export interface WardEntry {
  app: string
  pid: number
  plot: number
  meshes: WardMeshes
  looper: LooperState
  activity: ActivityState
  // Stacked activities above the root (0 = just the root). Capped at 3 —
  // matches the 3 pre-built stackCards in WardMeshes.
  backStack: number
  heap: HeapState
  db: DbState
  frame: FrameRun | null
  dying: boolean
  resumed: boolean
  restored: boolean
  // Flipped by manager.toggleService(app). Default false. Read by goHome to pick
  // the backgrounded foundry priority (service vs cached) and by narrationFor.
  serviceRunning: boolean
  riseMs: number
  demolishMs: number
  demolishStartScale: number
  resumedMs: number
  dataRequested: boolean
  dbQueryMs: number
  dbPending: boolean
  anrFlashT: number
  // Core-activity afterglow: real messages finish inside one frame tick, so the
  // instantaneous looper.current is almost never observable. Any processed
  // message (or in-flight frame) keeps the CPU core lit for a visible window.
  busyGlowMs: number
  shedFlashMs: number
  screenFlashMs: number
  sweepMs: number
  sweepMesh: THREE.Mesh | null
  rebuildMs: number
  hotPulseMs: number
  idleTapMs: number
  idleRotateMs: number
  idleReleaseMs: number
  idleAllocMs: number
  carPool: Map<number, THREE.Mesh>
  cratePool: Map<number, THREE.Mesh>
  crateSlots: Map<number, number>
  workerCars: Map<'db' | 'network', THREE.Mesh>
  panel: WardPanel | null
  // launchMode singleTop: brief top-stack-card flash timer, decremented like the
  // other *Ms flash fields; also drives a transient narration line while > 0.
  singleTopFlashMs: number
  // bindService/unbindService: app name of the ward this one is currently bound
  // to as a client (null = not bound). Drives foundry priority inheritance on
  // the target and the visible tether line.
  boundTo: string | null
  tether: THREE.Line | null
  // Binder pool posts flash for a beat whenever an IPC crosses to/from this
  // ward's process (foreground/background transitions) — set to
  // BINDER_PULSE_MS, decays like the other *Ms flash fields.
  binderPulseMs: number
}

export function trimProcessed(s: LooperState): LooperState {
  return s.processedIds.length > PROCESSED_ID_LIMIT
    ? { ...s, processedIds: s.processedIds.slice(-PROCESSED_ID_LIMIT) }
    : s
}

export function trimLog(s: ActivityState): ActivityState {
  return s.log.length > LOG_LIMIT ? { ...s, log: s.log.slice(-LOG_LIMIT) } : s
}

export function narrationFor(entry: WardEntry): string {
  const base = `${entry.activity.phase} · queue ${entry.looper.queue.length} · heap ${usedKb(entry.heap)}/${entry.heap.capacityKb}KB`
  const line = entry.looper.anr ? `${base} · ANR! main thread blocked 5s+` : base
  const withRestored = entry.restored ? `Restored — saved state + ViewModel made this cheap.\n${line}` : line
  const withService = entry.serviceRunning
    ? `${withRestored}\nService running — LMK will take cached wards first.`
    : withRestored
  // Rotation (and any other config change — locale, dark mode, fold state)
  // drives the same tear-down/rebuild — rebuildMs > 0 covers all of them.
  const withRotate = entry.rebuildMs > 0
    ? `${withService}\nRotation is just one config change — locale, dark mode, fold state recreate the Activity the same way.`
    : withService
  return entry.singleTopFlashMs > 0
    ? `${withRotate}\nsingleTop: already on top — reused, no new instance.`
    : withRotate
}
