import * as THREE from 'three'
import type { WardMeshes } from '../scene/ward'
import type { LooperState } from '../sim/looper'
import type { Phase } from '../sim/lifecycle'
import type { HeapState } from '../sim/heap'
import type { FrameRun } from '../sim/framePipeline'
import { makeCar } from '../scene/builders'

// Ported at mini scale from the retired v1 scenarios (mainThread/lifecycle/gc).
export const SHED_FLASH_MS = 400
export const SCREEN_FLASH_MS = 400
export const SWEEP_MS = 600

const LIT = 0x3fb950
const DIM = 0xb7c2c9
const CAR_SCALE = 0.3
const CAR_SPACING = 0.9
const GRID = 4
const CRATE_SPACING = 1.4
const CRATE_REACHABLE = 0xb08d57
const CRATE_GARBAGE = 0x6e7681
const BENCH_ACTIVE = 0x76e3ea

export function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose()
  ;(mesh.material as THREE.Material).dispose()
}

export function clearPool<K>(parent: { remove(o: THREE.Object3D): void }, pool: Map<K, THREE.Mesh>): void {
  for (const mesh of pool.values()) {
    parent.remove(mesh)
    disposeMesh(mesh)
  }
  pool.clear()
}

function litCount(phase: Phase): number {
  switch (phase) {
    case 'resumed': return 3
    case 'started': case 'paused': return 2
    case 'created': case 'stopped': return 1
    default: return 0
  }
}

export function syncCars(meshes: WardMeshes, looper: LooperState, carPool: Map<number, THREE.Mesh>): void {
  const items = looper.current ? [looper.current.msg, ...looper.queue] : [...looper.queue]
  const wanted = new Set<number>()
  items.forEach((msg, i) => {
    wanted.add(msg.id)
    let car = carPool.get(msg.id)
    if (!car) {
      car = makeCar(msg.costMs >= 1000 ? 0xf85149 : 0xd29922)
      car.scale.setScalar(CAR_SCALE)
      carPool.set(msg.id, car)
      meshes.carsParent.add(car)
    }
    const isCurrent = looper.current?.msg.id === msg.id
    const progress = isCurrent ? looper.current!.elapsedMs / msg.costMs : 0
    car.position.z = 2 - i * CAR_SPACING - (isCurrent ? progress * 0.6 : 0)
    car.position.y = 0.1
  })
  for (const [id, car] of carPool) {
    if (!wanted.has(id)) {
      disposeMesh(car)
      meshes.carsParent.remove(car)
      carPool.delete(id)
    }
  }
}

const APP_FLOOR_LIT_INTENSITY = 0.35

// Application floor lights once at rise-complete (bindApplication precedes any
// Activity) and dims on demolition. No phase-driven flicker — just on/off.
export function setAppFloorLit(meshes: WardMeshes, lit: boolean): void {
  const mat = meshes.appFloor.material as THREE.MeshStandardMaterial
  mat.emissiveIntensity = lit ? APP_FLOOR_LIT_INTENSITY : 0
}

const PROVIDER_SLAB_LIT_INTENSITY = 0.35

// ContentProviders instantiate before Application.onCreate — lit slightly ahead
// of the appFloor during rise, dimmed on demolition (same on/off shape).
export function setProviderSlabLit(meshes: WardMeshes, lit: boolean): void {
  const mat = meshes.providerSlab.material as THREE.MeshStandardMaterial
  mat.emissiveIntensity = lit ? PROVIDER_SLAB_LIT_INTENSITY : 0
}

const SERVICE_ANNEX_LIT_INTENSITY = 0.6

// Service annex lights amber on toggleService(app) → running; on/off toggle,
// not a timed flash like shed/screen.
export function setServiceAnnexLit(meshes: WardMeshes, lit: boolean): void {
  const mat = meshes.serviceAnnex.material as THREE.MeshStandardMaterial
  mat.emissiveIntensity = lit ? SERVICE_ANNEX_LIT_INTENSITY : 0
}

// Worker cars slide along the worker lane for as long as their IO request is
// in flight — purely cosmetic motion, no request-progress tracking needed.
export function syncWorkerCars(meshes: WardMeshes, cars: ReadonlyMap<string, THREE.Mesh>, tMs: number): void {
  let i = 0
  for (const car of cars.values()) {
    car.position.z = Math.sin(tMs / 400 + i * 2) * 2
    car.position.y = 0.1
    i++
  }
}

export function syncFloors(meshes: WardMeshes, phase: Phase): void {
  const lit = litCount(phase)
  meshes.floors.forEach((floor, i) => {
    const mat = floor.material as THREE.MeshStandardMaterial
    const on = i < lit
    mat.color.setHex(on ? LIT : DIM)
    mat.emissive.setHex(on ? LIT : 0x000000)
    mat.emissiveIntensity = on ? 0.35 : 0
  })
}

function crateSlotPosition(i: number): THREE.Vector3 {
  return new THREE.Vector3((i % GRID) * CRATE_SPACING - 2.1, 0.4, Math.floor(i / GRID) * CRATE_SPACING - 2.1)
}

// x position of the sweep plane in cratesParent-local space for a given
// remaining sweepMs (grid spans -2.1..2.1, so -2.8..2.8 covers it with margin).
// Shared by syncFlashes (positions the mesh) and manager (gates crate removal)
// so both agree on where the bar actually is in the same tick.
export function sweepBarX(sweepMs: number): number {
  const progress = 1 - sweepMs / SWEEP_MS
  return -2.8 + progress * 5.6
}

function claimSlot(slots: Map<number, number>, id: number): number {
  const used = new Set(slots.values())
  let i = 0
  while (used.has(i)) i++
  slots.set(id, i)
  return i
}

export function syncCrates(
  meshes: WardMeshes,
  heap: HeapState,
  cratePool: Map<number, THREE.Mesh>,
  slots: Map<number, number>,
  sweepActive: boolean,
  sweepX: number,
): void {
  const ids = new Set(heap.objects.map(o => o.id))
  for (const obj of heap.objects) {
    let crate = cratePool.get(obj.id)
    if (!crate) {
      const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9)
      const mat = new THREE.MeshStandardMaterial({ color: 0x3fb950, transparent: true })
      crate = new THREE.Mesh(geo, mat)
      cratePool.set(obj.id, crate)
      meshes.cratesParent.add(crate)
      claimSlot(slots, obj.id)
    }
    crate.position.copy(crateSlotPosition(slots.get(obj.id)!))
    const mat = crate.material as THREE.MeshStandardMaterial
    // Neutral crate tan — distinct from every app color so heap objects never
    // read as part of the (app-colored) Activity tower.
    mat.color.setHex(obj.reachable ? CRATE_REACHABLE : CRATE_GARBAGE)
    mat.opacity = obj.reachable ? 1 : 0.4
  }
  for (const [id, crate] of cratePool) {
    if (ids.has(id)) continue
    // Swept out of the heap already, but the travelling bar hasn't reached this
    // crate's slot yet — keep it visible as garbage until the bar passes, so GC
    // reads as "crates fall as the plane sweeps by" instead of an instant vanish.
    // Slot stays claimed (not freed below) so claimSlot can't hand it to a new
    // crate mid-sweep.
    if (sweepActive && crate.position.x > sweepX) {
      const mat = crate.material as THREE.MeshStandardMaterial
      mat.color.setHex(CRATE_GARBAGE)
      mat.opacity = 0.4
      continue
    }
    disposeMesh(crate)
    meshes.cratesParent.remove(crate)
    cratePool.delete(id)
    slots.delete(id)
  }
}

// One card visible per stacked activity above the root (entry.backStack).
export function syncStackCards(meshes: WardMeshes, backStack: number): void {
  meshes.stackCards.forEach((card, i) => { card.visible = i < backStack })
}

export const SINGLE_TOP_FLASH_MS = 300

// launchMode singleTop: pushing onto an already-on-top instance reuses it
// instead of stacking a new card — flash the top visible card instead.
export function syncSingleTopFlash(meshes: WardMeshes, backStack: number, flashMs: number): void {
  const topIndex = backStack - 1
  meshes.stackCards.forEach((card, i) => {
    const mat = card.material as THREE.MeshStandardMaterial
    mat.emissiveIntensity = i === topIndex && flashMs > 0 ? flashMs / SINGLE_TOP_FLASH_MS : 0
  })
}

const THREAD_MAIN = 0x3fb950
const THREAD_RENDER = 0x76e3ea
const THREAD_BINDER = 0xbc8cff
const THREAD_WORKER = 0x8b949e
const THREAD_DIM = 0x8fa0aa
const THREAD_LIT_INTENSITY = 0.6

function setThreadPostLit(post: THREE.Mesh, litColor: number, on: boolean): void {
  const mat = post.material as THREE.MeshStandardMaterial
  mat.color.setHex(on ? litColor : THREAD_DIM)
  mat.emissive.setHex(on ? litColor : 0x000000)
  mat.emissiveIntensity = on ? THREAD_LIT_INTENSITY : 0
}

export interface ThreadPostSync {
  main: boolean
  render: boolean
  binder: boolean
  worker: number
}

// Thread rack: 6 posts (main, renderThread, binder×2, worker×2). Worker posts
// light left-to-right, one per in-flight worker car — matches syncWorkerCars'
// count instead of tracking per-thread identity (there's no per-thread sim
// state to key off of).
export function syncThreadPosts(meshes: WardMeshes, s: ThreadPostSync): void {
  const [main, render, binder0, binder1, worker0, worker1] = meshes.threadPosts
  setThreadPostLit(main, THREAD_MAIN, s.main)
  setThreadPostLit(render, THREAD_RENDER, s.render)
  setThreadPostLit(binder0, THREAD_BINDER, s.binder)
  setThreadPostLit(binder1, THREAD_BINDER, s.binder)
  setThreadPostLit(worker0, THREAD_WORKER, s.worker >= 1)
  setThreadPostLit(worker1, THREAD_WORKER, s.worker >= 2)
}

export function syncBench(meshes: WardMeshes, frame: FrameRun | null): void {
  meshes.benchStations.forEach((station, i) => {
    const mat = station.material as THREE.MeshStandardMaterial
    const active = frame !== null && !frame.done && frame.currentStageIndex === i
    mat.emissive.setHex(active ? BENCH_ACTIVE : 0x000000)
    mat.emissiveIntensity = active ? 0.6 : 0
  })
}

export interface FlashState {
  meshes: WardMeshes
  shedFlashMs: number
  screenFlashMs: number
  sweepMs: number
  sweepMesh: THREE.Mesh | null
}

const SCREEN_FOREGROUND_GLOW = 0.3

export function syncFlashes(state: FlashState, anrOn: boolean, anrFlashT: number, isForeground = false): void {
  const shedMat = state.meshes.shedGlow.material as THREE.MeshStandardMaterial
  shedMat.emissiveIntensity = state.shedFlashMs > 0 ? state.shedFlashMs / SHED_FLASH_MS : 0

  const linkMat = state.meshes.shedLink.material as THREE.MeshStandardMaterial
  const linkGlow = state.shedFlashMs > 0 ? state.shedFlashMs / SHED_FLASH_MS : 0
  linkMat.emissive.setHex(linkGlow > 0 ? 0x76e3ea : 0x000000)
  linkMat.emissiveIntensity = linkGlow

  const screenMat = state.meshes.screenPanel.material as THREE.MeshStandardMaterial
  // Foreground apps' surfaces show content continuously — steady glow while on
  // screen; the composite flash brightens on top of it. Backgrounded = dark.
  const base = isForeground ? SCREEN_FOREGROUND_GLOW : 0
  const flash = state.screenFlashMs > 0 ? state.screenFlashMs / SCREEN_FLASH_MS : 0
  screenMat.emissiveIntensity = Math.max(base, flash)

  const anrMat = state.meshes.anrOverlay.material as THREE.MeshBasicMaterial
  anrMat.opacity = anrOn ? 0.25 + 0.2 * Math.sin(anrFlashT / 120) : 0
  // Actually hide it when idle: opacity 0 still raycasts, so the ward-sized box
  // otherwise swallows every hover and its ANR tooltip shadows all inner meshes.
  state.meshes.anrOverlay.visible = anrOn

  if (state.sweepMs > 0) {
    if (!state.sweepMesh) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 1.2, 3),
        new THREE.MeshBasicMaterial({ color: 0xdb6d28, transparent: true, opacity: 0.6 }),
      )
      state.meshes.cratesParent.add(mesh)
      state.sweepMesh = mesh
    }
    state.sweepMesh.visible = true
    state.sweepMesh.position.x = sweepBarX(state.sweepMs)
  } else if (state.sweepMesh) {
    state.sweepMesh.visible = false
  }
}

// Native side: the JNI bridge lights while a crossing is in flight, and the
// native-heap pile grows with malloc'd bytes. It never shrinks on GC — the
// only thing that clears it is process death (which demolishes the ward).
const JNI_LIT = 0x3ddc84
const JNI_IDLE = 0x6e7681
const NATIVE_HEAP_FULL_KB = 2000
export function syncNative(meshes: WardMeshes, nativeKb: number, jniFlashMs: number): void {
  const bridgeMat = meshes.jniBridge.material as THREE.MeshStandardMaterial
  const lit = jniFlashMs > 0
  bridgeMat.color.setHex(lit ? JNI_LIT : JNI_IDLE)
  bridgeMat.emissive.setHex(lit ? JNI_LIT : 0x000000)
  bridgeMat.emissiveIntensity = lit ? 0.7 : 0
  const shopMat = meshes.nativeShop.material as THREE.MeshStandardMaterial
  shopMat.emissive.setHex(lit ? JNI_LIT : 0x000000)
  shopMat.emissiveIntensity = lit ? 0.35 : 0
  // 0.1 floor keeps the pile visible (and hoverable) at zero bytes.
  const frac = Math.min(1, nativeKb / NATIVE_HEAP_FULL_KB)
  meshes.nativeHeap.scale.y = 0.1 + frac * 2.4
  meshes.nativeHeap.position.y = 0.05 + (0.1 + frac * 2.4) * 0.5
}

// A delivered broadcast lights the mailbox: the same amber the city uses for
// "system handed you something".
const MAIL_LIT = 0xd29922
export function syncMailbox(meshes: WardMeshes, flashMs: number): void {
  const mat = meshes.mailbox.material as THREE.MeshStandardMaterial
  const lit = flashMs > 0
  mat.emissive.setHex(lit ? MAIL_LIT : 0x000000)
  mat.emissiveIntensity = lit ? 0.8 : 0
}
