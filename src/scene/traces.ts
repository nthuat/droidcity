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
const TRACE_RAISE = 0.02 // clears the plate top so the ribbon's visible face doesn't z-fight
const BUS_W = 1.2 // CPU-RAM bus wider than per-plot traces
const CPU_RAM_BUS_INFO = { title: 'Memory bus (CPU ↔ RAM)', note: 'Every instruction and object the CPU touches streams over this bus. Caches hide most trips — a miss stalls the core.' }
const RAM_DISK_BUS_INFO = { title: 'Storage bus (RAM ↔ DISK)', note: 'Pages move here: Room reads and mmap\'d dex page IN, write-backs and evictions page OUT. DMA — the CPU doesn\'t carry the bytes.' }

const Y_HW = -0.5
const Y_BOOT = -0.2
const Y_PLATE = 0.3
const Z_HW_BOOT = -60 // hardware/boot plate seam (board.ts)
const Z_BOOT_PLATE = -45 // boot/main-plate seam (board.ts)
// Per-plot fans jog east/west at this z then run straight south into their plot —
// a single plate-seam->plot-center diagonal crossed neighbor wards (bench/heap clips).
const Z_FAN_JOG = -38
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
// "database district" analog: this sim has no standalone DB district — Room reads
// that miss cache (data:fetched) already route through the network district, so
// that's the closest real target for an east-corridor disk trace.
const NETWORK = new THREE.Vector3(65, Y_PLATE, 17)

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z)
}

function traceMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: TRACE_COLOR, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.6,
  })
}

// One flat/sloped ribbon tile between two points, oriented via lookAt (handles the
// sloped climbing steps the same way board.ts's makeSlope does — no separate math).
function segment(mat: THREE.MeshStandardMaterial, from: THREE.Vector3, to: THREE.Vector3): THREE.Mesh {
  const a = from.clone().setY(from.y + TRACE_RAISE)
  const b = to.clone().setY(to.y + TRACE_RAISE)
  const len = a.distanceTo(b) || 0.001
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(TRACE_W, TRACE_H, len), mat)
  mesh.position.copy(a).lerp(b, 0.5)
  mesh.position.y -= TRACE_H / 2
  mesh.lookAt(b)
  return mesh
}

function ribbon(mat: THREE.MeshStandardMaterial, points: readonly THREE.Vector3[]): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  for (let i = 0; i < points.length - 1; i++) meshes.push(segment(mat, points[i], points[i + 1]))
  // Joint pads at interior waypoints: trace-width squares sitting 0.01 above
  // the ribbon so fan-jog corners connect instead of leaving notches.
  for (let i = 1; i < points.length - 1; i++) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(TRACE_W, TRACE_H, TRACE_W), mat)
    pad.position.set(points[i].x, points[i].y + TRACE_RAISE + 0.01 - TRACE_H / 2, points[i].z)
    meshes.push(pad)
  }
  return meshes
}

// The climb from a hardware-strip source point up to just inside the main plate:
// flat along hw strip -> sloped step across the hw/boot seam -> flat across boot
// strip -> sloped step across the boot/plate seam. Returned exit point sits just
// past the plate seam, ready for a tail run across the plate to the real target.
function climbPoints(x: number, srcZ: number): THREE.Vector3[] {
  return [
    v(x, Y_HW, srcZ),
    v(x, Y_HW, Z_HW_BOOT - STEP_LEN),
    v(x, Y_BOOT, Z_HW_BOOT + STEP_LEN),
    v(x, Y_BOOT, Z_BOOT_PLATE - STEP_LEN),
    v(x, Y_PLATE, Z_BOOT_PLATE + STEP_LEN),
  ]
}

// One ribbon per plot from a hardware-strip source block, fanned across the
// same 4 lane offsets CPU uses (mirrors hardwareRow.ts's slot/slab spread),
// shifted sideways by laneOffsetX and tagged with a hover tooltip. Mirrors the
// CPU per-plot loop in buildTraces below — kept separate (not shared with CPU)
// since CPU predates this lane-offset shape.
function buildPlotFamily(
  sourceX: number, fanOffsets: readonly number[], laneOffsetX: number, info: { title: string; note: string },
): { mats: THREE.MeshStandardMaterial[]; meshes: THREE.Mesh[] } {
  const mats: THREE.MeshStandardMaterial[] = []
  const meshes: THREE.Mesh[] = []
  PLOT_X.forEach((plotX, n) => {
    const mat = traceMaterial()
    mats.push(mat)
    const fanX = sourceX + fanOffsets[n] + laneOffsetX
    const points = [
      ...climbPoints(fanX, HW_Z),
      v(fanX, Y_PLATE, Z_FAN_JOG),
      v(plotX + laneOffsetX, Y_PLATE, Z_FAN_JOG),
      v(plotX + laneOffsetX, Y_PLATE, PLOT_Z),
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
  const cpuMats: THREE.MeshStandardMaterial[] = []

  // 4 CPU traces: CPU block -> each ward plot, one parallel ribbon per core slot.
  PLOT_X.forEach((plotX, n) => {
    const mat = traceMaterial()
    cpuMats.push(mat)
    const fanX = CPU_X + CORE_OFFSETS[n]
    const points = [
      ...climbPoints(fanX, HW_Z),
      v(fanX, Y_PLATE, Z_FAN_JOG),
      v(plotX, Y_PLATE, Z_FAN_JOG),
      v(plotX, Y_PLATE, PLOT_Z),
    ]
    for (const m of ribbon(mat, points)) {
      m.userData.info = CPU_TRACE_INFO
      staging.add(m)
    }
  })

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
  const ramClimb = climbPoints(RAM_X, HW_Z)
  const ramExit = ramClimb[ramClimb.length - 1]
  const ramRibbons = [
    ...ribbon(ramMat, ramClimb),
    ...ribbon(ramMat, [ramExit, ZYGOTE]),
    ...ribbon(ramMat, [ramExit, WARD_TRUNK]),
  ]
  for (const m of ramRibbons) {
    m.userData.info = RAM_TRACE_INFO
    staging.add(m)
  }

  // DISK -> east corridor toward the network district (see NETWORK comment above).
  // Runs east along the hardware strip to x 60 first, then climbs — climbing at
  // DISK_X (30) sent the diagonal tail straight through ward plot 3.
  const diskMat = traceMaterial()
  const diskPoints = [v(DISK_X, Y_HW, HW_Z), ...climbPoints(60, HW_Z), NETWORK]
  for (const m of ribbon(diskMat, diskPoints)) {
    m.userData.info = DISK_TRACE_INFO
    staging.add(m)
  }

  // Per-plot RAM and DISK traces, parallel to the CPU family above.
  const ramFamily = buildPlotFamily(RAM_X, RAM_FAN_OFFSETS, RAM_LANE_OFFSET, RAM_TRACE_INFO)
  for (const m of ramFamily.meshes) staging.add(m)
  const diskFamily = buildPlotFamily(DISK_X, CORE_OFFSETS, DISK_LANE_OFFSET, DISK_TRACE_INFO)
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
    setCpuTraceGlow(plot, color) { setFamilyGlow(cpuMats, plot, color) },
    setRamTraceGlow(plot, color) { setFamilyGlow(ramFamily.mats, plot, color) },
    setDiskTraceGlow(plot, color) { setFamilyGlow(diskFamily.mats, plot, color) },
    setCpuRamBusGlow(color) { setSingleGlow(busMat, color) },
    setRamDiskBusGlow(color) { setSingleGlow(ramDiskMat, color) },
  }
}
