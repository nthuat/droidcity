import type * as THREE from 'three'
import type { WardMeshes } from '../scene/ward'
import type { LooperState } from '../sim/looper'
import type { ActivityState } from '../sim/lifecycle'
import { usedKb, type HeapState } from '../sim/heap'
import type { DbState } from '../sim/roomDb'
import type { FrameRun } from '../sim/framePipeline'
import type { Panel } from '../ui/panel'

const PROCESSED_ID_LIMIT = 50
const LOG_LIMIT = 20

export interface WardEntry {
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
  resumed: boolean
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
  idleTapMs: number
  idleRotateMs: number
  idleReleaseMs: number
  idleAllocMs: number
  carPool: Map<number, THREE.Mesh>
  cratePool: Map<number, THREE.Mesh>
  crateSlots: Map<number, number>
  panel: Panel | null
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
  return entry.looper.anr ? `${base} · ANR! main thread blocked 5s+` : base
}
