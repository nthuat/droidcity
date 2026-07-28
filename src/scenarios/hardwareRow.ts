import * as THREE from 'three'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

// Static hardware strip: CPU (west) · RAM bank (center) · DISK (east), recessed on
// the hardware plate (board.ts top y -0.5). All geometry is static; only materials
// change in response to setCoreStates/setRamSegments/diskBlink (wired live in a
// later task — this file just exposes the paint API).

const PLATE_TOP = -0.5
const HOUSING_COLOR = 0x161b22
const CORE_IDLE = 0x1c2128
const CORE_STUCK = 0xf85149
const RAM_IDLE = 0x2a2f36
const RAM_SHARED_COLOR = 0x9aa7b8
const DISK_IDLE = 0x30363d
const DISK_READ = 0x76e3ea
const DISK_WRITE = 0xd29922
const DISK_DECAY_MS = 300
const CORE_PULSE_HZ = 0.006 // ~160ms period, matches other scenarios' pulse feel

const CPU_X = -55
const RAM_X = 0
const DISK_X = 55

const PSI_X = RAM_X + 11
const PSI_BASE_H = 0.4
const PSI_MAX_H = 4
const PSI_AMBER_AT = 0.5
const PSI_RED_AT = 0.8
const PSI_GREEN = 0x3fb950
const PSI_AMBER = 0xd29922
const PSI_RED = 0xf85149

interface CoreState {
  color: number | null
  stuck: boolean
  app: string
}

interface RamSegment {
  color: number
  app: string
}

interface Slot {
  mesh: THREE.Mesh
  mat: THREE.MeshStandardMaterial
}

function buildCpu(group: THREE.Group): Slot[] {
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(14, 2, 8),
    new THREE.MeshStandardMaterial({ color: HOUSING_COLOR, roughness: 0.6 }),
  )
  housing.position.set(CPU_X, PLATE_TOP + 1, 0)
  housing.userData.info = { title: 'CPU', note: 'Cores that run every ward’s main thread — red means stuck.' }
  group.add(housing)

  const slotTop = PLATE_TOP + 2 + 0.2
  const slotXOffsets = [-4.8, -1.6, 1.6, 4.8]
  return slotXOffsets.map((dx) => {
    const mat = new THREE.MeshStandardMaterial({
      color: CORE_IDLE, emissive: CORE_IDLE, emissiveIntensity: 0, roughness: 0.5,
    })
    const slot = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.4, 6), mat)
    slot.position.set(CPU_X + dx, slotTop, 0)
    group.add(slot)
    return { mesh: slot, mat }
  })
}

// 2 static slabs for the Zygote's shared framework pages — permanently occupied,
// not part of setRamSegments (which only ever addresses the 8 dynamic app slabs).
// Sit left of the app slabs, so the latter's offsets shift +2.4 to make room —
// combined footprint stays centered on RAM_X, so the "RAM BANK" silk label needs
// no change.
function buildRamShared(group: THREE.Group): void {
  const sharedXOffsets = [-10.8, -8.4]
  for (const dx of sharedXOffsets) {
    const mat = new THREE.MeshStandardMaterial({
      color: RAM_SHARED_COLOR, emissive: RAM_SHARED_COLOR, emissiveIntensity: 0.15, roughness: 0.5,
    })
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2, 3.4, 0.8), mat)
    slab.position.set(RAM_X + dx, PLATE_TOP + 1.7, 0)
    slab.userData.info = {
      title: 'Shared framework pages — Zygote',
      note: 'One physical copy of the preloaded framework, mapped copy-on-write into EVERY app process. Why fork is cheap and why per-app memory is counted as PSS.',
    }
    group.add(slab)
  }
}

function buildRam(group: THREE.Group): Slot[] {
  buildRamShared(group)
  const slabXOffsets = [-6, -3.6, -1.2, 1.2, 3.6, 6, 8.4, 10.8]
  return slabXOffsets.map((dx) => {
    const mat = new THREE.MeshStandardMaterial({
      color: RAM_IDLE, emissive: RAM_IDLE, emissiveIntensity: 0, roughness: 0.5,
    })
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.8), mat)
    slab.position.set(RAM_X + dx, PLATE_TOP + 1.5, 0)
    group.add(slab)
    return { mesh: slab, mat }
  })
}

function buildDisk(group: THREE.Group): THREE.MeshStandardMaterial {
  // Grouped so the inspector's parent-chain walk-up finds the tooltip from any
  // platter, the arm, or the LED — not just whichever mesh happened to carry it.
  const diskGroup = new THREE.Group()
  diskGroup.userData.info = {
    title: 'Disk',
    note: 'Blinks on every Room read/write. APK and dex are mmap\'d from here — paged into RAM on demand, evicted without write-back.',
  }
  group.add(diskGroup)

  const platterMat = new THREE.MeshStandardMaterial({ color: 0x484f58, roughness: 0.4, metalness: 0.3 })
  for (let i = 0; i < 3; i++) {
    const platter = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.3, 24), platterMat)
    platter.position.set(DISK_X, PLATE_TOP + 0.15 + i * 0.7, 0)
    diskGroup.add(platter)
  }
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.2, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x6e7681, roughness: 0.5 }),
  )
  arm.position.set(DISK_X + 2.5, PLATE_TOP + 1.6, 2.6)
  diskGroup.add(arm)

  const ledMat = new THREE.MeshStandardMaterial({
    color: DISK_IDLE, emissive: DISK_IDLE, emissiveIntensity: 0, roughness: 0.4,
  })
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), ledMat)
  led.position.set(DISK_X, PLATE_TOP + 2, 3)
  diskGroup.add(led)
  return ledMat
}

function buildPsi(group: THREE.Group): { bar: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({
    color: PSI_GREEN, emissive: PSI_GREEN, emissiveIntensity: 0.5, roughness: 0.5,
  })
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, PSI_BASE_H, 0.8), mat)
  bar.position.set(PSI_X, PLATE_TOP + PSI_BASE_H / 2, 0)
  bar.userData.info = {
    title: 'PSI — memory pressure',
    note: 'Stall-based pain signal. lmkd kills on pressure, not on exact fullness.',
  }
  group.add(bar)
  return { bar, mat }
}

const DEFAULT_NARRATION = 'The hardware layer: CPU cores (west) run each ward’s main thread, RAM segments (center) fill as processes are spawned, and the disk (east) blinks on every Room read/write — the silicon underneath everything else in the city.'

export function makeHardwareRowScenario(): Scenario & {
  setCoreStates(s: CoreState[]): void
  setRamSegments(s: (RamSegment | null)[]): void
  diskBlink(write: boolean): void
  setPressure(frac: number): void
} {
  const group = new THREE.Group()

  const coreSlots = buildCpu(group)
  const ramSlots = buildRam(group)
  const diskLedMat = buildDisk(group)
  const { bar: psiBar, mat: psiMat } = buildPsi(group)

  let coreStates: CoreState[] = coreSlots.map(() => ({ color: null, stuck: false, app: '' }))
  let elapsedMs = 0
  let diskLedT = 0
  let diskLedColor = DISK_READ

  function paintCore(i: number): void {
    const { mesh, mat } = coreSlots[i]
    const s = coreStates[i]
    mesh.userData.info = s.color !== null
      ? {
          title: `Core — running ${s.app}`,
          note: s.stuck ? 'Main thread blocked >5s — ANR territory.' : 'Executing this ward\'s main-thread messages.',
        }
      : { title: 'Core — idle', note: 'No ward is executing right now.' }
    if (s.stuck) {
      mat.color.setHex(CORE_STUCK)
      mat.emissive.setHex(CORE_STUCK)
      return // intensity pulsed continuously in update()
    }
    const color = s.color ?? CORE_IDLE
    mat.color.setHex(color)
    mat.emissive.setHex(color)
    mat.emissiveIntensity = s.color !== null ? 0.7 : 0
  }

  function paintRam(i: number, seg: RamSegment | null): void {
    const { mesh, mat } = ramSlots[i]
    const hex = seg?.color ?? RAM_IDLE
    mat.color.setHex(hex)
    mat.emissive.setHex(hex)
    mat.emissiveIntensity = seg !== null ? 0.6 : 0
    mesh.userData.info = seg
      ? {
          title: `RAM — ${seg.app}'s pages`,
          note: '150MB of physical memory behind that ward\'s heap. Freed only when the process dies.',
        }
      : { title: 'RAM — free', note: 'Unclaimed physical pages.' }
  }

  function paintDisk(): void {
    const hex = diskLedT > 0 ? diskLedColor : DISK_IDLE
    diskLedMat.color.setHex(hex)
    diskLedMat.emissive.setHex(hex)
    diskLedMat.emissiveIntensity = diskLedT > 0 ? diskLedT / DISK_DECAY_MS : 0
  }

  const panel = makePanel('Hardware — CPU · RAM · Disk')
  panel.setNarration(DEFAULT_NARRATION)

  return {
    name: 'Hardware',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(0, 14, 30),
    cameraTarget: new THREE.Vector3(0, 1, 0),
    setCoreStates(s) {
      coreStates = s
      coreStates.forEach((_, i) => paintCore(i))
    },
    setRamSegments(s) {
      s.forEach((seg, i) => paintRam(i, seg))
    },
    diskBlink(write) {
      diskLedT = DISK_DECAY_MS
      diskLedColor = write ? DISK_WRITE : DISK_READ
      paintDisk()
    },
    setPressure(frac) {
      const clamped = THREE.MathUtils.clamp(frac, 0, 1)
      const h = PSI_BASE_H + clamped * PSI_MAX_H
      psiBar.scale.y = h / PSI_BASE_H
      psiBar.position.y = PLATE_TOP + h / 2
      const color = clamped > PSI_RED_AT ? PSI_RED : clamped > PSI_AMBER_AT ? PSI_AMBER : PSI_GREEN
      psiMat.color.setHex(color)
      psiMat.emissive.setHex(color)
    },
    update(dtMs) {
      elapsedMs += dtMs
      if (coreStates.some(s => s.stuck)) {
        const pulse = 0.5 + 0.4 * Math.sin(elapsedMs * CORE_PULSE_HZ)
        coreStates.forEach((s, i) => {
          if (s.stuck) coreSlots[i].mat.emissiveIntensity = pulse
        })
      }
      if (diskLedT > 0) {
        diskLedT = Math.max(0, diskLedT - dtMs)
        paintDisk()
      }
    },
    reset() {
      coreStates = coreSlots.map(() => ({ color: null, stuck: false, app: '' }))
      coreStates.forEach((_, i) => paintCore(i))
      ramSlots.forEach((_, i) => paintRam(i, null))
      diskLedT = 0
      paintDisk()
      psiBar.scale.y = 1
      psiBar.position.y = PLATE_TOP + PSI_BASE_H / 2
      psiMat.color.setHex(PSI_GREEN)
      psiMat.emissive.setHex(PSI_GREEN)
      panel.setNarration(DEFAULT_NARRATION)
    },
    setIdle() {
      // visual only — no ambient behavior; state is driven entirely by the setters
    },
  }
}
