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
  return entry.serviceRunning
    ? `${withRestored}\nService running — LMK will take cached wards first.`
    : withRestored
}
