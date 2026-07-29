import * as THREE from 'three'
import { makeVent } from './props'
import type { InspectorInfo } from '../ui/inspector'

// Static machine-board geometry: one contiguous plate-tiled floor replacing the old
// ground+grid. Built once and added to the scene from main.ts — no disposal needed,
// this lives for the page lifetime (see plan's disposal-discipline note).

const BOARD_COLOR = 0xd8d5cf
// Light theme: diffuse carries the zone color; emissive is reserved for live states.
const PLATE_EMISSIVE_INTENSITY = 0
const PLATE_H = 0.3

const COLORS = {
  boot: 0xa7b8c2,
  foundry: 0xa8c8ad,
  wards: 0xb3cfd8,
  cityhall: 0xb0b4d6,
  surfaceflinger: 0xc4aacb,
  network: 0xd8ae85,
  launcher: 0xb2cf9e,
  hardware: 0x3b4954, // kernel space deliberately stays dark — the one shadowed region
}

function plateMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: PLATE_EMISSIVE_INTENSITY,
    roughness: 0.8,
  })
}

// A board slab segment: matte box whose top face sits at `topY`, footprint [x0,x1] x [z0,z1].
// Real geometry (not a thin overlay) so the recessed z-segments actually step down —
// their side faces render as the visible "cliff" between segments.
function makeSlab(x0: number, x1: number, z0: number, z1: number, topY: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(x1 - x0, 1, z1 - z0),
    new THREE.MeshStandardMaterial({ color: BOARD_COLOR, roughness: 0.9 }),
  )
  mesh.position.set((x0 + x1) / 2, topY - 0.5, (z0 + z1) / 2)
  return mesh
}

// Hover tooltips: per-zone plates get their own info; everything untagged on the
// board (slabs, rims, silk texts, deck, ramp) falls back to the group-level info
// via the inspector's parent-chain walk.
const PLATE_INFO: Record<string, InspectorInfo> = {
  wards: { title: 'Ward plots', note: 'Four app plots — one sandboxed process each.' },
  boot: { title: 'Boot strip', note: 'Recessed on purpose — bootloader/kernel/init run before userspace exists.' },
  hardware: { title: 'Hardware strip', note: 'The silicon. Framework never touches it directly — HALs and drivers sit between.' },
  foundry: { title: 'Foundry plate', note: 'Zygote district — process factory floor.' },
  cityhall: { title: 'City Hall pit', note: 'Recessed civic district — every Binder road descends here.' },
  surfaceflinger: { title: 'Compositor plate', note: 'SurfaceFlinger district — every frame\'s last stop before glass.' },
  network: { title: 'Network plate', note: 'Radio edge district — every fetch leaves the board from here.' },
  launcher: { title: 'Launcher deck', note: 'Elevated plaza — the home screen is just an app with a view.' },
}
const BOARD_INFO: InspectorInfo = {
  title: 'The device',
  note: 'One machine board — everything above this PCB is software.',
}

// A flat zone plate: box top face sits at `topY`, footprint is [x0,x1] x [z0,z1].
function makePlate(color: number, x0: number, x1: number, z0: number, z1: number, topY: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, PLATE_H, z1 - z0), plateMaterial(color))
  mesh.position.set((x0 + x1) / 2, topY - PLATE_H / 2, (z0 + z1) / 2)
  return mesh
}

function tagged(mesh: THREE.Mesh, info: InspectorInfo): THREE.Mesh {
  mesh.userData.info = info
  return mesh
}

// A ramp/rim wedge whose top face tilts linearly from `from` to `to` (any axis) —
// `thickness` is the flat width of the ramp perpendicular to travel. Orientation via
// lookAt (not hand-rolled trig): robust regardless of which world axis the slope runs
// along, and keeps the perpendicular edge level since the default up vector is (0,1,0).
function makeSlope(color: number, from: THREE.Vector3, to: THREE.Vector3, thickness: number): THREE.Mesh {
  const len = from.distanceTo(to)
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, PLATE_H, len), plateMaterial(color))
  mesh.position.copy(from).lerp(to, 0.5)
  mesh.lookAt(to)
  return mesh
}

// Flat canvas-texture "silk-screen" plane, laid on top of the board facing up.
function makeEdgeText(
  text: string, width: number, depth: number, x: number, y: number, z: number, color = '#6b7280',
): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.font = 'bold 56px system-ui, sans-serif'
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(x, y, z)
  return mesh
}

// cityhallPit: recessed floor (y -2) with a sloped rim connecting it back up to
// board level (y 0), inset RIM units from the pit's outer footprint.
function buildPit(): THREE.Object3D[] {
  const x0 = -45, x1 = 45, z0 = -5, z1 = 25
  const floorY = -2
  const RIM = 3
  const fx0 = x0 + RIM, fx1 = x1 - RIM, fz0 = z0 + RIM, fz1 = z1 - RIM
  const midZ = (fz0 + fz1) / 2
  return [
    tagged(makePlate(COLORS.cityhall, fx0, fx1, fz0, fz1, floorY), PLATE_INFO.cityhall),
    makeSlope(COLORS.cityhall, new THREE.Vector3(0, 0, z0), new THREE.Vector3(0, floorY, fz0), x1 - x0), // north rim
    makeSlope(COLORS.cityhall, new THREE.Vector3(0, 0, z1), new THREE.Vector3(0, floorY, fz1), x1 - x0), // south rim
    makeSlope(COLORS.cityhall, new THREE.Vector3(x0, 0, midZ), new THREE.Vector3(fx0, floorY, midZ), fz1 - fz0), // west rim
    makeSlope(COLORS.cityhall, new THREE.Vector3(x1, 0, midZ), new THREE.Vector3(fx1, floorY, midZ), fz1 - fz0), // east rim
  ]
}

// launcherPlatform: elevated deck (top y 3) with a ramp down to board level (y 0)
// on its pit-facing edge, per the plan's "ramp from platform front edge to pit rim".
function buildLauncherPlatform(): THREE.Object3D[] {
  const x0 = -30, x1 = 30, z0 = 25, z1 = 55
  const topY = 3
  const rampZ1 = z0 + 6 // ramp occupies the first 6 units of the platform's depth
  // Solid deck box (full height, base on the board at y 0) — the old 0.3 plate
  // floated at y 2.7..3 with visible void beneath it.
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(x1 - x0, topY, z1 - rampZ1),
    plateMaterial(COLORS.launcher),
  )
  deck.position.set((x0 + x1) / 2, topY / 2, (rampZ1 + z1) / 2)
  deck.userData.info = PLATE_INFO.launcher
  return [
    deck,
    makeSlope(COLORS.launcher, new THREE.Vector3(0, 0, z0), new THREE.Vector3(0, topY, rampZ1), x1 - x0),
  ]
}

export function buildBoard(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'board'
  group.userData.info = BOARD_INFO

  // Depth 120→140, extending only off the back edge (front stays at z=60 so every
  // existing plate/zone coordinate below is untouched). The slab is 3 z-segments,
  // not one solid box: boot (-60..-45) and hardware (-80..-60) each sit at their
  // own lower top-face y so the recess is real geometry, not just a thin plate
  // floating inside an opaque box — their shared z-boundaries render as the visible
  // step/cliff walls (BoxGeometry side faces render by default, no extra work needed).
  // Main slab is 4 segments ringing the city-hall pit footprint (-45..45 × -5..25) —
  // a single -85..85 box would fill the pit solid, hiding the recessed floor and
  // rim slopes inside opaque geometry (same buried-geometry lesson as the strips).
  group.add(makeSlab(-85, -45, -45, 60, 0)) // west of pit
  group.add(makeSlab(45, 85, -45, 60, 0)) // east of pit
  group.add(makeSlab(-45, 45, -45, -5, 0)) // north strip (wards)
  group.add(makeSlab(-45, 45, 25, 60, 0)) // south strip (under launcher)
  group.add(makeSlab(-45, 45, -5, 25, -2 - PLATE_H)) // recessed under the pit — floor plate rests on it
  // Recessed slabs sit one PLATE_H below their plate tops so the plates rest ON
  // the slab instead of embedding flush in it — coplanar top faces z-fight (visible
  // as shimmering scanline flicker across the strip).
  group.add(makeSlab(-85, 85, -60, -45, -0.2 - PLATE_H)) // boot segment, recessed
  group.add(makeSlab(-85, 85, -80, -60, -0.5 - PLATE_H)) // hardware segment, deeper recess

  group.add(tagged(makePlate(COLORS.boot, -85, 85, -60, -45, -0.2), PLATE_INFO.boot)) // recessed back strip
  group.add(tagged(makePlate(COLORS.hardware, -85, 85, -75, -60, -0.5), PLATE_INFO.hardware)) // hardware/kernel strip, deeper recess
  group.add(tagged(makePlate(COLORS.foundry, -85, -45, -45, 5, 0.3), PLATE_INFO.foundry))
  group.add(tagged(makePlate(COLORS.wards, -45, 45, -45, -5, 0.3), PLATE_INFO.wards))
  group.add(tagged(makePlate(COLORS.surfaceflinger, 45, 85, -45, 0, 0.3), PLATE_INFO.surfaceflinger))
  group.add(tagged(makePlate(COLORS.network, 45, 85, 0, 35, 0.3), PLATE_INFO.network))
  for (const o of buildPit()) group.add(o)
  for (const o of buildLauncherPlatform()) group.add(o)

  group.add(makeEdgeText('DROIDCITY · ANDROID USERSPACE', 70, 6, 0, 0.06, 57))
  group.add(makeEdgeText('INTERNET →', 16, 6, 76, 0.36, 17))
  // The hardware strip sits at the board's far edge in a recess — the scene's
  // single directional light grazes past it and the ambient alone leaves it
  // unreadably dark. A dedicated soft overhead light keeps the metal legible.
  const stripLight = new THREE.PointLight(0xaec6dd, 400, 70, 1.8)
  stripLight.position.set(0, 14, -67)
  group.add(stripLight)

  // Light-grey, not the dark default ink — this label prints on the dark plate.
  group.add(makeEdgeText('HARDWARE', 30, 6, 0, -0.44, -73, '#8b98a5')) // on the hardware plate (top -0.5)

  // Silk-screen sub-labels under each hardware block — dimmer than the section
  // title above, x's mirror hardwareRow.ts's CPU_X/RAM_X/DISK_X (and PSI_X).
  const HW_LABEL_DIM = '#4d5560'
  // Sits between the title (-73) and the CPU/RAM/PSI/DISK row (-62) — names the
  // layer beneath this physical strip without claiming to model it (see docs).
  group.add(makeEdgeText('HAL · drivers · physical', 40, 1.6, 0, -0.44, -70, HW_LABEL_DIM))
  group.add(makeEdgeText('CPU', 8, 1.6, -30, -0.44, -62, HW_LABEL_DIM))
  group.add(makeEdgeText('RAM BANK', 8, 1.6, 0, -0.44, -62, HW_LABEL_DIM))
  group.add(makeEdgeText('PSI', 8, 1.6, 14, -0.44, -62, HW_LABEL_DIM))
  group.add(makeEdgeText('DISK', 8, 1.6, 30, -0.44, -62, HW_LABEL_DIM))

  // Board corners: 2 vents each. Back corners (z -57) sit on the recessed boot strip
  // (plate top -0.2); front corners (z 57) sit on bare board (no plate reaches there).
  const CORNER_Y_BACK = -0.2
  const CORNER_Y_FRONT = 0
  const cornerSpots: Array<[number, number, number]> = [
    [-78, CORNER_Y_BACK, -57], [-74, CORNER_Y_BACK, -56],
    [78, CORNER_Y_BACK, -57], [74, CORNER_Y_BACK, -56],
    [-78, CORNER_Y_FRONT, 57], [-74, CORNER_Y_FRONT, 56],
    [78, CORNER_Y_FRONT, 57], [74, CORNER_Y_FRONT, 56],
  ]
  for (const [x, y, z] of cornerSpots) {
    const vent = makeVent()
    vent.position.set(x, y, z)
    group.add(vent)
  }

  return group
}
