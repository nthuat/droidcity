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
const DISK_IDLE = 0x30363d
const DISK_READ = 0x76e3ea
const DISK_WRITE = 0xd29922
const DISK_DECAY_MS = 300
const CORE_PULSE_HZ = 0.006 // ~160ms period, matches other scenarios' pulse feel

const CPU_X = -55
const RAM_X = 0
const DISK_X = 55

interface CoreState {
  color: number | null
  stuck: boolean
}

function buildCpu(group: THREE.Group): THREE.MeshStandardMaterial[] {
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
    return mat
  })
}

function buildRam(group: THREE.Group): THREE.MeshStandardMaterial[] {
  const slabXOffsets = [-8.4, -6, -3.6, -1.2, 1.2, 3.6, 6, 8.4]
  return slabXOffsets.map((dx, i) => {
    const mat = new THREE.MeshStandardMaterial({
      color: RAM_IDLE, emissive: RAM_IDLE, emissiveIntensity: 0, roughness: 0.5,
    })
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.8), mat)
    slab.position.set(RAM_X + dx, PLATE_TOP + 1.5, 0)
    if (i === 0) slab.userData.info = { title: 'RAM', note: 'Fills as processes are spawned.' }
    group.add(slab)
    return mat
  })
}

function buildDisk(group: THREE.Group): THREE.MeshStandardMaterial {
  const platterMat = new THREE.MeshStandardMaterial({ color: 0x484f58, roughness: 0.4, metalness: 0.3 })
  for (let i = 0; i < 3; i++) {
    const platter = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.3, 24), platterMat)
    platter.position.set(DISK_X, PLATE_TOP + 0.15 + i * 0.7, 0)
    if (i === 0) platter.userData.info = { title: 'Disk', note: 'Blinks on every Room read/write.' }
    group.add(platter)
  }
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.2, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x6e7681, roughness: 0.5 }),
  )
  arm.position.set(DISK_X + 2.5, PLATE_TOP + 1.6, 2.6)
  group.add(arm)

  const ledMat = new THREE.MeshStandardMaterial({
    color: DISK_IDLE, emissive: DISK_IDLE, emissiveIntensity: 0, roughness: 0.4,
  })
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), ledMat)
  led.position.set(DISK_X, PLATE_TOP + 2, 3)
  group.add(led)
  return ledMat
}

const DEFAULT_NARRATION = 'The hardware layer: CPU cores (west) run each ward’s main thread, RAM segments (center) fill as processes are spawned, and the disk (east) blinks on every Room read/write — the silicon underneath everything else in the city.'

export function makeHardwareRowScenario(): Scenario & {
  setCoreStates(s: CoreState[]): void
  setRamSegments(s: (number | null)[]): void
  diskBlink(write: boolean): void
} {
  const group = new THREE.Group()

  const coreMats = buildCpu(group)
  const ramMats = buildRam(group)
  const diskLedMat = buildDisk(group)

  let coreStates: CoreState[] = coreMats.map(() => ({ color: null, stuck: false }))
  let elapsedMs = 0
  let diskLedT = 0
  let diskLedColor = DISK_READ

  function paintCore(i: number): void {
    const mat = coreMats[i]
    const s = coreStates[i]
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

  function paintRam(i: number, color: number | null): void {
    const mat = ramMats[i]
    const hex = color ?? RAM_IDLE
    mat.color.setHex(hex)
    mat.emissive.setHex(hex)
    mat.emissiveIntensity = color !== null ? 0.6 : 0
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
      s.forEach((color, i) => paintRam(i, color))
    },
    diskBlink(write) {
      diskLedT = DISK_DECAY_MS
      diskLedColor = write ? DISK_WRITE : DISK_READ
      paintDisk()
    },
    update(dtMs) {
      elapsedMs += dtMs
      if (coreStates.some(s => s.stuck)) {
        const pulse = 0.5 + 0.4 * Math.sin(elapsedMs * CORE_PULSE_HZ)
        coreStates.forEach((s, i) => {
          if (s.stuck) coreMats[i].emissiveIntensity = pulse
        })
      }
      if (diskLedT > 0) {
        diskLedT = Math.max(0, diskLedT - dtMs)
        paintDisk()
      }
    },
    reset() {
      coreStates = coreMats.map(() => ({ color: null, stuck: false }))
      coreStates.forEach((_, i) => paintCore(i))
      ramMats.forEach((_, i) => paintRam(i, null))
      diskLedT = 0
      paintDisk()
      panel.setNarration(DEFAULT_NARRATION)
    },
    setIdle() {
      // visual only — no ambient behavior; state is driven entirely by the setters
    },
  }
}
