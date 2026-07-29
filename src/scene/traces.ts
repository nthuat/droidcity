import * as THREE from 'three'
import { mergeStaticGroup } from './merge'

// Motherboard "ribbon" traces: thin flat strips connecting the hardware strip
// (CPU/RAM/DISK, board.ts plate top y -0.5) up through the boot strip (top y -0.2)
// onto the main plates (top y 0.3). Each ribbon climbs in two short sloped steps —
// one at the hardware/boot seam (z -60), one at the boot/plate seam (z -45), board.ts's
// real plate boundaries — with flat runs in between, so the strip crossings read as a
// deliberate climb. Nothing sits flush-buried under a plate (learned from MB2/HW1:
// buried geometry reads as missing, not present-but-hidden).
//
// x/z sources duplicate hardwareRow.ts's private CPU_X/RAM_X/DISK_X and main.ts's
// ANCHORS.hardware.z (-68) as plain numbers rather than importing them — same
// import-cycle rationale as routes.ts's ANCHORS duplication (see that file's header).

const TRACE_W = 0.5
const TRACE_H = 0.06
const TRACE_COLOR = 0x6b7a86
const TRACE_RAISE = 0.08 // well clear of plate tops — 0.02 sat inside depth-buffer noise at distance
const BUS_W = 1.2 // CPU-RAM bus wider than per-plot traces
const CPU_RAM_BUS_INFO = { title: 'Memory bus (CPU ↔ RAM)', note: 'Every instruction and object the CPU touches streams over this bus. Caches hide most trips — a miss stalls the core.' }
const RAM_DISK_BUS_INFO = { title: 'Storage bus (RAM ↔ DISK)', note: 'Pages move here: Room reads and mmap\'d dex page IN, write-backs and evictions page OUT. DMA — the CPU doesn\'t carry the bytes.' }

const Y_HW = -0.5
const Y_BOOT = -0.2
const Y_PLATE = 0.3
const Z_HW_BOOT = -60 // hardware/boot plate seam (board.ts)
const Z_BOOT_PLATE = -45 // boot/main-plate seam (board.ts)
// Per-plot fans jog east/west then run straight south into their plot — a single
// plate-seam->plot-center diagonal crossed neighbor wards (bench/heap clips).
// Each plot jogs at its OWN z (JOG_Z0 - n * JOG_STEP): with one shared jog z all
// 12 east-west legs (3 families x 4 plots) sat collinear at the same y — a stack
// of coplanar boxes whose z-fight rendered the whole run as broken hooks.
// Farther plots jog farther north, so no jog leg ever crosses a south leg.
const JOG_Z0 = -36
const JOG_STEP = 1
// Families ride stacked y layers for the same reason: jog legs must cross other
// families' climb lanes (CPU's legs cross the RAM/DISK fan corridor at x -3..6),
// and an in-plane crossing is a coplanar patch. 0.06 (one TRACE_H) per layer is
// real geometric clearance, far above depth-buffer noise.
const RAM_LAYER_LIFT = 0.06
const DISK_LAYER_LIFT = 0.12
const STEP_LEN = 2 // z-length of each sloped climbing step

const HW_Z = -68 // hardwareRow.ts component z (world, matches ANCHORS.hardware)
const CPU_X = -30
const RAM_X = 0
const DISK_X = 30
const CORE_OFFSETS = [-4.8, -1.6, 1.6, 4.8] // mirrors hardwareRow.ts's CPU slotXOffsets

// RAM and DISK per-plot trace families run the exact same fan-per-plot shape as
// CPU's (below), just shifted sideways by these lane offsets so the three
// families run in parallel instead of converging on the identical x at each
// plot's ward-trunk point (z-fighting). Small relative to plot spacing (22.5
// apart) and within each block's real footprint (RAM ~21.6 wide, disk ~5 wide),
// so each family still reads as landing on the right plot.
const RAM_LANE_OFFSET = 0.8
const DISK_LANE_OFFSET = 1.6
// RAM family gets its own narrower fan: CPU's CORE_OFFSETS lane 4 (+4.8, +0.8
// lane = x 5.6) cut through the 'init' boot station (x ~5..9 on the boot strip).
// Max here is 3.6 + 0.8 = 4.4 — clear of the station's west face.
const RAM_FAN_OFFSETS = [-3.6, -1.2, 1.2, 3.6]
const CPU_TRACE_INFO = { title: 'CPU trace', note: 'Lights while this ward\'s main thread holds a core.' }
const RAM_TRACE_INFO = { title: 'Memory bus', note: 'Lights when this ward allocates or GC runs — pages moving between heap and physical RAM.' }
const DISK_TRACE_INFO = { title: 'Storage bus', note: 'Lights on Room reads and write-backs — the ward\'s private DB lives on this flash.' }

const PLOT_X = [-33.75, -11.25, 11.25, 33.75]
const PLOT_Z = -25
const WARD_TRUNK = new THREE.Vector3(0, Y_PLATE, PLOT_Z) // ward-strip center, no specific plot
const ZYGOTE = new THREE.Vector3(-65, Y_PLATE, -20)

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z)
}

function traceMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: TRACE_COLOR, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.6,
  })
}

// Sloped tiles get trimmed at both ends: a tilted box's end-face corners poke
// past the endpoint into the flat tile it meets (coplanar penetration inside
// the merged mesh — feathered z-fight). Tiles meet at shared endpoints only;
// the raised joint pad covers the trimmed elbow. Threshold skips the tiny
// origin-raise tilt (see climbPoints) — only real climb steps trim.
const SLOPE_TRIM = 0.06
const SLOPE_DY_MIN = 0.1

// One flat/sloped ribbon tile between two points, oriented via lookAt (handles the
// sloped climbing steps the same way board.ts's makeSlope does — no separate math).
function segment(mat: THREE.MeshStandardMaterial, from: THREE.Vector3, to: THREE.Vector3): THREE.Mesh {
  const a = from.clone().setY(from.y + TRACE_RAISE)
  const b = to.clone().setY(to.y + TRACE_RAISE)
  if (Math.abs(b.y - a.y) > SLOPE_DY_MIN) {
    const dir = b.clone().sub(a).normalize()
    a.addScaledVector(dir, SLOPE_TRIM)
    b.addScaledVector(dir, -SLOPE_TRIM)
  }
  const len = a.distanceTo(b) || 0.001
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(TRACE_W, TRACE_H, len), mat)
  mesh.position.copy(a).lerp(b, 0.5)
  mesh.position.y -= TRACE_H / 2
  mesh.lookAt(b)
  return mesh
}

// Corner joint: a trace-width pad at a waypoint, top face 0.015 above the
// segment tops so it covers jog notches and trimmed slope elbows without ever
// sitting coplanar with them (routes.ts jointPad pattern).
function jointPad(mat: THREE.MeshStandardMaterial, p: THREE.Vector3): THREE.Mesh {
  // Disc pad — covers jogs at any approach angle (box pads left bowtie notches).
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(TRACE_W * 0.72, TRACE_W * 0.72, TRACE_H, 10), mat)
  pad.position.set(p.x, p.y + TRACE_RAISE + 0.015 - TRACE_H / 2, p.z)
  return pad
}

function ribbon(mat: THREE.MeshStandardMaterial, points: readonly THREE.Vector3[]): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  for (let i = 0; i < points.length - 1; i++) meshes.push(segment(mat, points[i], points[i + 1]))
  // Joint pads at every interior waypoint (fan jogs AND climb-step junctions)
  // so corners connect instead of leaving notches.
  for (let i = 1; i < points.length - 1; i++) meshes.push(jointPad(mat, points[i]))
  return meshes
}

// The climb from a hardware-strip source point up onto the main plate: flat along
// the hw strip -> sloped step up to boot level -> flat across the boot strip ->
// sloped step up to plate level. Each sloped step ENDS exactly at its seam, fully
// over the LOWER strip: a step centered on the seam only reached the upper level
// 2 units past it, so its first half tunneled into the upper plate's side wall —
// the lane visually died at the seam and reappeared on the plate top (read as a
// broken link from any camera that could see the wall face).
function climbPoints(x: number, srcZ: number, lift = 0): THREE.Vector3[] {
  // Origin rides one extra TRACE_RAISE: lanes depart at the bus z (and DISK
  // lanes cross the disk east run), where a same-y origin tile sat coplanar
  // on the wide bus top and z-fought. The 0.02 tilt over the 6-unit run is
  // invisible and below SLOPE_DY_MIN, so the tile isn't trimmed as a slope.
  // `lift` is the family's y layer (see RAM_LAYER_LIFT above).
  return [
    v(x, Y_HW + TRACE_RAISE + lift, srcZ),
    v(x, Y_HW + lift, Z_HW_BOOT - STEP_LEN * 2),
    v(x, Y_BOOT + lift, Z_HW_BOOT),
    v(x, Y_BOOT + lift, Z_BOOT_PLATE - STEP_LEN * 2),
    v(x, Y_PLATE + lift, Z_BOOT_PLATE),
  ]
}

// One ribbon per plot from a hardware-strip source block, fanned across the
// same 4 lane offsets CPU uses (mirrors hardwareRow.ts's slot/slab spread),
// shifted sideways by laneOffsetX and tagged with a hover tooltip. Mirrors the
// CPU per-plot loop in buildTraces below — kept separate (not shared with CPU)
// since CPU predates this lane-offset shape.
function buildPlotFamily(
  sourceX: number, fanOffsets: readonly number[], laneOffsetX: number, info: { title: string; note: string },
  lift = 0,
): { mats: THREE.MeshStandardMaterial[]; meshes: THREE.Mesh[] } {
  const mats: THREE.MeshStandardMaterial[] = []
  const meshes: THREE.Mesh[] = []
  PLOT_X.forEach((plotX, n) => {
    const mat = traceMaterial()
    mats.push(mat)
    const fanX = sourceX + fanOffsets[n] + laneOffsetX
    const jogZ = JOG_Z0 - n * JOG_STEP
    const points = [
      ...climbPoints(fanX, HW_Z, lift),
      v(fanX, Y_PLATE + lift, jogZ),
      v(plotX + laneOffsetX, Y_PLATE + lift, jogZ),
      v(plotX + laneOffsetX, Y_PLATE + lift, PLOT_Z),
    ]
    for (const m of ribbon(mat, points)) {
      m.userData.info = info
      meshes.push(m)
    }
  })
  return { mats, meshes }
}

export interface Traces {
  readonly group: THREE.Group
  setCpuTraceGlow(plot: number, color: number | null): void
  setRamTraceGlow(plot: number, color: number | null): void
  setDiskTraceGlow(plot: number, color: number | null): void
  setCpuRamBusGlow(color: number | null): void
  setRamDiskBusGlow(color: number | null): void
}

export function buildTraces(): Traces {
  const group = new THREE.Group()
  group.name = 'traces'
  // Segments build into a staging group, then merge per (material, info):
  // each glowing unit already owns a unique material, so merging collapses its
  // ~7 boxes into one mesh while the glow API keeps driving the same material
  // instances (~98 meshes down to ~16).
  const staging = new THREE.Group()

  // 4 CPU traces: CPU block -> each ward plot, one parallel ribbon per core slot.
  const cpuFamily = buildPlotFamily(CPU_X, CORE_OFFSETS, 0, CPU_TRACE_INFO)
  for (const m of cpuFamily.meshes) staging.add(m)

  // CPU ↔ RAM bus: wide flat ribbon along the hardware strip surface.
  const busMat = traceMaterial()
  const a = v(CPU_X, Y_HW, HW_Z).addScaledVector(new THREE.Vector3(0, TRACE_RAISE, 0), 1)
  const b = v(RAM_X, Y_HW, HW_Z).addScaledVector(new THREE.Vector3(0, TRACE_RAISE, 0), 1)
  const len = a.distanceTo(b) || 0.001
  const busMesh = new THREE.Mesh(new THREE.BoxGeometry(BUS_W, TRACE_H, len), busMat)
  busMesh.position.copy(a).lerp(b, 0.5)
  busMesh.position.y -= TRACE_H / 2
  busMesh.lookAt(b)
  busMesh.userData.info = CPU_RAM_BUS_INFO
  staging.add(busMesh)

  // RAM ↔ DISK bus: wide flat ribbon along the hardware strip surface.
  const ramDiskMat = traceMaterial()
  const c = v(RAM_X, Y_HW, HW_Z).addScaledVector(new THREE.Vector3(0, TRACE_RAISE, 0), 1)
  const d = v(DISK_X, Y_HW, HW_Z).addScaledVector(new THREE.Vector3(0, TRACE_RAISE, 0), 1)
  const lenRamDisk = c.distanceTo(d) || 0.001
  const ramDiskMesh = new THREE.Mesh(new THREE.BoxGeometry(BUS_W, TRACE_H, lenRamDisk), ramDiskMat)
  ramDiskMesh.position.copy(c).lerp(d, 0.5)
  ramDiskMesh.position.y -= TRACE_H / 2
  ramDiskMesh.lookAt(d)
  ramDiskMesh.userData.info = RAM_DISK_BUS_INFO
  staging.add(ramDiskMesh)

  // RAM: one climb, forking into RAM -> zygote and RAM -> ward-strip trunk.
  const ramMat = traceMaterial()
  const ramClimb = climbPoints(RAM_X, HW_Z, RAM_LAYER_LIFT)
  const ramExit = ramClimb[ramClimb.length - 1]
  const ramRibbons = [
    ...ribbon(ramMat, ramClimb),
    ...ribbon(ramMat, [ramExit, ZYGOTE.clone().setY(ZYGOTE.y + RAM_LAYER_LIFT)]),
    ...ribbon(ramMat, [ramExit, WARD_TRUNK.clone().setY(WARD_TRUNK.y + RAM_LAYER_LIFT)]),
    // ramExit is an endpoint of all three ribbons (never interior), so no
    // ribbon() pad lands on the fork elbow — add it explicitly.
    jointPad(ramMat, ramExit),
  ]
  for (const m of ramRibbons) {
    m.userData.info = RAM_TRACE_INFO
    staging.add(m)
  }

  // Per-plot RAM and DISK traces, parallel to the CPU family above.
  const ramFamily = buildPlotFamily(RAM_X, RAM_FAN_OFFSETS, RAM_LANE_OFFSET, RAM_TRACE_INFO, RAM_LAYER_LIFT)
  for (const m of ramFamily.meshes) staging.add(m)
  const diskFamily = buildPlotFamily(DISK_X, CORE_OFFSETS, DISK_LANE_OFFSET, DISK_TRACE_INFO, DISK_LAYER_LIFT)
  for (const m of diskFamily.meshes) staging.add(m)

  for (const m of mergeStaticGroup(staging)) group.add(m)

  function setFamilyGlow(mats: THREE.MeshStandardMaterial[], plot: number, color: number | null): void {
    const mat = mats[plot]
    if (!mat) return
    mat.emissive.setHex(color ?? 0x000000)
    mat.emissiveIntensity = color !== null ? 0.5 : 0
  }

  function setSingleGlow(mat: THREE.MeshStandardMaterial, color: number | null): void {
    mat.emissive.setHex(color ?? 0x000000)
    mat.emissiveIntensity = color !== null ? 0.5 : 0
  }

  return {
    group,
    setCpuTraceGlow(plot, color) { setFamilyGlow(cpuFamily.mats, plot, color) },
    setRamTraceGlow(plot, color) { setFamilyGlow(ramFamily.mats, plot, color) },
    setDiskTraceGlow(plot, color) { setFamilyGlow(diskFamily.mats, plot, color) },
    setCpuRamBusGlow(color) { setSingleGlow(busMat, color) },
    setRamDiskBusGlow(color) { setSingleGlow(ramDiskMat, color) },
  }
}
