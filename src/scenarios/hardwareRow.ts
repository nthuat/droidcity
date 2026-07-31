import * as THREE from 'three'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

// Static hardware strip: CPU (west) · RAM bank (center) · DISK (east), recessed on
// the hardware plate (board.ts top y -0.5). All geometry is static; only materials
// change in response to setCoreStates/setRamSegments/diskBlink (wired live in a
// later task, this file just exposes the paint API).

const PLATE_TOP = -0.5
// Light-theme metal: silver idle dies on a mid-gray substrate (dark-on-dark made
// idle cores invisible; dark-on-light read as holes). Busy green / stuck red pop.
const HOUSING_COLOR = 0x77828e
const CORE_IDLE = 0xb7c2c9
const CORE_STUCK = 0xf85149
const RAM_SHELL_COLOR = 0x5a636e
const RAM_SHARED_COLOR = 0x9aa7b8
const RAM_FILL_MARGIN = 0.2 // top/bottom inset so the fill visibly sits inside the shell
const RAM_FILL_MAX_H = 3 - RAM_FILL_MARGIN * 2
const RAM_MIN_FILL = 0.05
const RAM_FILL_EMISSIVE = 0.6
const RAM_PULSE_MS = 300
const DISK_IDLE = 0x454e58
const DISK_IDLE_EMISSIVE = 0.15 // idle LED stays slightly visible instead of fully dark
const DISK_READ = 0x76e3ea
const DISK_WRITE = 0xd29922
const DISK_DECAY_MS = 300
const CORE_PULSE_HZ = 0.006 // ~160ms period, matches other scenarios' pulse feel

const CPU_X = -30
const RAM_X = 0
const DISK_X = 30

// +14 clears the RAM bank's east end (app slab at +10.8, 2 wide → edge 11.8)
const PSI_X = RAM_X + 14
// East of DISK, clear of the DISK per-plot trace fan (max lane x 36.4 in traces.ts)
const RADIO_X = 45
const RADIO_IDLE = 0x454e58
const RADIO_ACTIVE = 0x3ddc84
const RADIO_DECAY_MS = 400
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
  fill: number
  note: string
}

interface Slot {
  mesh: THREE.Mesh
  mat: THREE.MeshStandardMaterial
}

interface RamSlot {
  group: THREE.Group
  fillMesh: THREE.Mesh
  fillMat: THREE.MeshStandardMaterial
  pulseT: number
}

function buildCpu(group: THREE.Group): Slot[] {
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(14, 2, 8),
    new THREE.MeshStandardMaterial({ color: HOUSING_COLOR, roughness: 0.6 }),
  )
  housing.position.set(CPU_X, PLATE_TOP + 1, 0)
  housing.userData.info = { title: 'CPU', note: 'Cores that run every app process’s main thread. Red means stuck. Framework never touches this directly: calls go through HALs and kernel drivers.' }
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

// 2 static slabs for the Zygote's shared framework pages, permanently occupied,
// not part of setRamSegments (which only ever addresses the 8 dynamic app slabs).
// Sit left of the app slabs, so the latter's offsets shift +2.4 to make room -
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
      title: 'Shared framework pages: Zygote',
      note: 'One physical copy of the preloaded framework, mapped copy-on-write into EVERY app process. Why fork is cheap and why per-app memory is counted as PSS.',
    }
    group.add(slab)
  }
}

// Each app slab is a tank: a dark static shell (the physical page reservation,
// always the same dim color whether occupied or not) plus an inset fill box
// whose height tracks live heap usage, scale.y = fill fraction, min 0.05 so
// an occupied-but-near-empty heap still reads as "there". Fill grows from the
// shell's base like the Zygote/PSI meters (scale.y + position.y compensation),
// not from its vertical center.
function buildRam(group: THREE.Group): RamSlot[] {
  buildRamShared(group)
  const slabXOffsets = [-6, -3.6, -1.2, 1.2, 3.6, 6, 8.4, 10.8]
  const fillBaseY = PLATE_TOP + RAM_FILL_MARGIN
  return slabXOffsets.map((dx) => {
    const slotGroup = new THREE.Group()

    const shellMat = new THREE.MeshStandardMaterial({ color: RAM_SHELL_COLOR, roughness: 0.6 })
    const shell = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.8), shellMat)
    shell.position.set(RAM_X + dx, PLATE_TOP + 1.5, 0)
    slotGroup.add(shell)

    const fillMat = new THREE.MeshStandardMaterial({
      color: RAM_SHELL_COLOR, emissive: RAM_SHELL_COLOR, emissiveIntensity: RAM_FILL_EMISSIVE, roughness: 0.5,
    })
    const fillMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, RAM_FILL_MAX_H, 0.5), fillMat)
    fillMesh.position.set(RAM_X + dx, fillBaseY, 0)
    fillMesh.scale.y = RAM_MIN_FILL
    fillMesh.visible = false
    slotGroup.add(fillMesh)

    group.add(slotGroup)
    return { group: slotGroup, fillMesh, fillMat, pulseT: 0 }
  })
}

function buildDisk(group: THREE.Group): THREE.MeshStandardMaterial {
  // Grouped so the inspector's parent-chain walk-up finds the tooltip from any
  // platter, the arm, or the LED, not just whichever mesh happened to carry it.
  const diskGroup = new THREE.Group()
  diskGroup.userData.info = {
    title: 'Disk',
    note: 'Blinks on every Room read/write. APK and dex are mmap\'d from here, paged into RAM on demand, evicted without write-back.',
  }
  group.add(diskGroup)

  const platterMat = new THREE.MeshStandardMaterial({ color: 0x828c96, roughness: 0.4, metalness: 0.3 })
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
    color: DISK_IDLE, emissive: DISK_IDLE, emissiveIntensity: DISK_IDLE_EMISSIVE, roughness: 0.4,
  })
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), ledMat)
  led.position.set(DISK_X, PLATE_TOP + 2, 3)
  diskGroup.add(led)
  return ledMat
}

// Radio / NIC: the network district's hardware. Sits on the strip like DISK -
// the tower's DNS/TLS/TTFB pipeline all ends as RF on this mast.
function buildRadio(group: THREE.Group): THREE.MeshStandardMaterial {
  const radioGroup = new THREE.Group()
  radioGroup.userData.info = {
    title: 'Radio / NIC',
    note: 'The network tower\'s silicon. Every fetch the tower pipelines, DNS, TLS, download, leaves the device as RF from this mast.',
  }
  group.add(radioGroup)

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.2, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x6e7681, roughness: 0.5 }),
  )
  base.position.set(RADIO_X, PLATE_TOP + 0.6, 0)
  radioGroup.add(base)

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 4.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x828c96, roughness: 0.4, metalness: 0.3 }),
  )
  mast.position.set(RADIO_X, PLATE_TOP + 1.2 + 2.1, 0)
  radioGroup.add(mast)

  const tipMat = new THREE.MeshStandardMaterial({
    color: RADIO_IDLE, emissive: RADIO_IDLE, emissiveIntensity: DISK_IDLE_EMISSIVE, roughness: 0.4,
  })
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), tipMat)
  tip.position.set(RADIO_X, PLATE_TOP + 1.2 + 4.2 + 0.2, 0)
  radioGroup.add(tip)
  return tipMat
}

// zram: a compressed swap area inside RAM. Under pressure kswapd compresses
// cold pages here INSTEAD of killing: slower memory beats a dead process.
// x 20 sits between PSI (14) and DISK (30), clear of both.
const ZRAM_X = 20
const ZRAM_MAX_H = 3.2
function buildZram(group: THREE.Group): { shell: THREE.Mesh; fill: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const zramGroup = new THREE.Group()
  zramGroup.userData.info = {
    title: 'zram, compressed swap in RAM',
    note: 'kswapd\'s first answer to memory pressure: compress cold anonymous pages into this area instead of killing anything. Costs CPU on every touch, but the process lives. lmkd only gets a turn once reclaim can no longer keep up.',
  }
  group.add(zramGroup)
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, ZRAM_MAX_H, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x5a636e, roughness: 0.7, transparent: true, opacity: 0.5 }),
  )
  shell.position.set(ZRAM_X, PLATE_TOP + ZRAM_MAX_H / 2, 0)
  zramGroup.add(shell)
  const mat = new THREE.MeshStandardMaterial({ color: 0x6ea8d8, emissive: 0x6ea8d8, emissiveIntensity: 0.15, roughness: 0.5 })
  const fill = new THREE.Mesh(new THREE.BoxGeometry(2.2, ZRAM_MAX_H, 1.2), mat)
  fill.scale.y = 0.02
  fill.position.set(ZRAM_X, PLATE_TOP + ZRAM_MAX_H * 0.01, 0)
  zramGroup.add(fill)
  return { shell, fill, mat }
}

function buildPsi(group: THREE.Group): { bar: THREE.Mesh; mat: THREE.MeshStandardMaterial } {
  const mat = new THREE.MeshStandardMaterial({
    color: PSI_GREEN, emissive: PSI_GREEN, emissiveIntensity: 0.5, roughness: 0.5,
  })
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.8, PSI_BASE_H, 0.8), mat)
  bar.position.set(PSI_X, PLATE_TOP + PSI_BASE_H / 2, 0)
  bar.userData.info = {
    title: 'PSI: memory pressure',
    note: 'Stall-based pain signal. lmkd kills on pressure, not on exact fullness.',
  }
  group.add(bar)
  return { bar, mat }
}

const DEFAULT_NARRATION = 'The hardware layer: CPU cores (west) run each app process’s main thread, RAM segments (center) fill as processes are spawned, the disk (east) blinks on every Room read/write, zram compresses cold pages before anything is killed, and the radio mast (far east) turns the network tower’s pipeline into RF, the silicon underneath everything else in the city.'

export function makeHardwareRowScenario(): Scenario & {
  setCoreStates(s: CoreState[]): void
  setRamSegments(s: (RamSegment | null)[]): void
  pulseRam(app: string): void
  diskBlink(write: boolean): void
  radioBlink(): void
  setPressure(frac: number): void
  setZram(frac: number): void
  pulseReclaim(): void
} {
  const group = new THREE.Group()

  const coreSlots = buildCpu(group)
  const ramSlots = buildRam(group)
  const diskLedMat = buildDisk(group)
  const radioTipMat = buildRadio(group)
  const { bar: psiBar, mat: psiMat } = buildPsi(group)
  const { fill: zramFill, mat: zramMat } = buildZram(group)
  let zramPulseT = 0

  let coreStates: CoreState[] = coreSlots.map(() => ({ color: null, stuck: false, app: '' }))
  // paintCore runs per-frame via syncCores, only rebuild the userData.info
  // object when the running/stuck/app combination actually changed.
  const lastCoreInfoKey: (string | null)[] = coreSlots.map(() => null)
  let ramApps: (string | null)[] = ramSlots.map(() => null)
  let elapsedMs = 0
  let diskLedT = 0
  let diskLedColor = DISK_READ
  let radioT = 0

  function paintCore(i: number): void {
    const { mesh, mat } = coreSlots[i]
    const s = coreStates[i]
    const infoKey = `${s.color !== null}|${s.stuck}|${s.app}`
    if (lastCoreInfoKey[i] !== infoKey) {
      lastCoreInfoKey[i] = infoKey
      mesh.userData.info = s.color !== null
        ? {
            title: `Core: running ${s.app}`,
            note: s.stuck ? 'Main thread blocked >5s: ANR territory.' : 'Executing this ward\'s main-thread messages.',
          }
        : { title: 'Core: idle', note: 'No app process is executing right now.' }
    }
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
    const slot = ramSlots[i]
    ramApps[i] = seg?.app ?? null
    slot.fillMesh.visible = seg !== null
    if (seg) {
      const frac = Math.max(seg.fill, RAM_MIN_FILL)
      slot.fillMesh.scale.y = frac
      slot.fillMesh.position.y = PLATE_TOP + RAM_FILL_MARGIN + (RAM_FILL_MAX_H * frac) / 2
      slot.fillMat.color.setHex(seg.color)
      slot.fillMat.emissive.setHex(seg.color)
      slot.fillMat.emissiveIntensity = RAM_FILL_EMISSIVE
      slot.pulseT = 0
    }
    slot.group.userData.info = seg
      ? { title: `RAM: ${seg.app}'s pages`, note: seg.note }
      : { title: 'RAM: free', note: 'Unclaimed physical pages.' }
  }

  function paintDisk(): void {
    const hex = diskLedT > 0 ? diskLedColor : DISK_IDLE
    diskLedMat.color.setHex(hex)
    diskLedMat.emissive.setHex(hex)
    diskLedMat.emissiveIntensity = diskLedT > 0 ? diskLedT / DISK_DECAY_MS : DISK_IDLE_EMISSIVE
  }

  function paintRadio(): void {
    const hex = radioT > 0 ? RADIO_ACTIVE : RADIO_IDLE
    radioTipMat.color.setHex(hex)
    radioTipMat.emissive.setHex(hex)
    radioTipMat.emissiveIntensity = radioT > 0 ? radioT / RADIO_DECAY_MS : DISK_IDLE_EMISSIVE
  }

  const panel = makePanel('Hardware: CPU · RAM · Disk')
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
    pulseRam(app) {
      ramSlots.forEach((slot, i) => {
        if (ramApps[i] === app) slot.pulseT = RAM_PULSE_MS
      })
    },
    diskBlink(write) {
      diskLedT = DISK_DECAY_MS
      diskLedColor = write ? DISK_WRITE : DISK_READ
      paintDisk()
    },
    radioBlink() {
      radioT = RADIO_DECAY_MS
      paintRadio()
    },
    setZram(frac) {
      const clamped = THREE.MathUtils.clamp(frac, 0, 1)
      const h = Math.max(0.02, clamped) * ZRAM_MAX_H
      zramFill.scale.y = h / ZRAM_MAX_H
      zramFill.position.y = PLATE_TOP + h / 2
    },
    pulseReclaim() {
      zramPulseT = 500
      zramMat.emissiveIntensity = 0.9
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
      if (radioT > 0) {
        radioT = Math.max(0, radioT - dtMs)
        paintRadio()
      }
      if (zramPulseT > 0) {
        zramPulseT = Math.max(0, zramPulseT - dtMs)
        zramMat.emissiveIntensity = 0.15 + (zramPulseT / 500) * 0.75
      }
      ramSlots.forEach((slot) => {
        if (slot.pulseT <= 0) return
        slot.pulseT = Math.max(0, slot.pulseT - dtMs)
        const t = slot.pulseT / RAM_PULSE_MS
        slot.fillMat.emissiveIntensity = RAM_FILL_EMISSIVE + (1 - RAM_FILL_EMISSIVE) * t
      })
    },
    setIdle() {
      // visual only, no ambient behavior; state is driven entirely by the setters
    },
  }
}
