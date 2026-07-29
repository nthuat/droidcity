import * as THREE from 'three'
import { mergeStaticGroup } from './merge'
import type { InspectorInfo } from '../ui/inspector'

// Physical roads + conveyors tying the board's zones together, plus the waypoint
// polylines packets fly along. Mirrors main.ts's ANCHORS / PLOT_ANCHORS values
// (duplicated, not imported, to avoid a main.ts <-> routes.ts import cycle — the
// board layout is fixed by the machine-board plan, low risk of drift).

// board.ts's foundry/wards/surfaceflinger/network plates all share topY 0.3 (only
// the pit floor -2, boot strip -0.2, and launcher platform 3 differ) — anchors and
// waypoints that rest on one of those four plates use PLATE_Y, not board-base 0.
const PLATE_Y = 0.3

const ANCHORS: Record<string, THREE.Vector3> = {
  boot: new THREE.Vector3(0, 0, -52),
  hardware: new THREE.Vector3(0, 0, -68),
  zygote: new THREE.Vector3(-55, PLATE_Y, -35),
  cityhall: new THREE.Vector3(0, PLATE_Y, -35),
  surfaceflinger: new THREE.Vector3(60, PLATE_Y, -35),
  network: new THREE.Vector3(65, PLATE_Y, 17),
  launcher: new THREE.Vector3(-22, 0, 50),
}
const PLOT_X = [-33.75, -11.25, 11.25, 33.75]
const PLOT_Z = -10
const PLOT_ANCHORS = PLOT_X.map(x => new THREE.Vector3(x, PLATE_Y, PLOT_Z))
// Stops just past the board rim (85) so the road reads as leaving the city
// without a long strip floating over the void.
const OFFBOARD_EAST = new THREE.Vector3(88, 0, 17)
// The phone's screen, front and center at the south rim (see surfaceFlinger.ts).
const DISPLAY_WALL = new THREE.Vector3(0, 0, 58)
// Registered as an anchor so packet flights can target the glass directly
// (e.g. the tap leg hardware -> displaywall).
ANCHORS.displaywall = DISPLAY_WALL

const ROAD_COLOR = 0x546e78
const EDGE_COLOR = 0x00838f
const ROAD_W = 1.6
const ROAD_H = 0.15
const EDGE_W = 0.15
const EDGE_H = 0.05
// 0.15: high enough that legs descending the pit rim / plate-crest steps never
// intersect the slope surfaces beneath them (0.05 left descending decks nearly
// coplanar with the rim wedges — feathered z-fight combs at every crossing).
const ROAD_RAISE = 0.15
const CONVEYOR_RAISE = 0.4
// Two DARK asphalt tones: after the light-theme lift the old light tile color
// matched the pale plates and every other tile vanished — belts read as dashes.
const CONVEYOR_COLORS = [0x46545e, 0x38444d]
const CONVEYOR_SEGMENT_LEN = 3
const WAYPOINT_LIFT = 0.5

// Default hover tooltips by segment kind — routes with an explicit `info`
// (First casting) overwrite these in buildRoutes; TRUNKS get the defaults too.
const ROAD_INFO: InspectorInfo = {
  title: 'Binder road',
  note: 'Every packet crossing process walls is a Binder transaction.',
}
const CONVEYOR_INFO: InspectorInfo = {
  title: 'Fork conveyor',
  note: 'Carries freshly forked processes from Zygote to their plots.',
}

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z)
}

// Shared static materials — every segment of a kind renders from the same
// instance so mergeStaticGroup can collapse them into one mesh per kind.
const roadMat = new THREE.MeshStandardMaterial({ color: ROAD_COLOR, roughness: 0.7 })
const conveyorMats = CONVEYOR_COLORS.map(
  color => new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
)
const edgeMat = new THREE.MeshStandardMaterial({
  color: EDGE_COLOR, emissive: EDGE_COLOR, emissiveIntensity: 0.6,
})

interface RouteDef {
  readonly from: string
  readonly to: string
  readonly waypoints: readonly THREE.Vector3[]
  readonly conveyor?: boolean
  // Polyline actually meshed for this route (defaults to `waypoints`). Per-plot
  // routes that share a long trunk leg draw only their unique branch — the trunk
  // is meshed exactly once in TRUNKS below. Rebuilding it per plot stacked 4
  // coplanar boxes (conveyors with mismatched stripe phases) that z-fought.
  readonly draw?: readonly THREE.Vector3[]
  readonly info?: InspectorInfo
}

const ROUTES: RouteDef[] = [
  // foundry -> each ward plot (conveyor south from the core band into the app
  // band, corridor along z -22 — between the band seam (-25) and the ward
  // walls (-19)). Packets fly the full path; the visible spine is TRUNKS'.
  ...PLOT_X.map((x, n): RouteDef => ({
    from: 'zygote', to: `plot${n}`, conveyor: true,
    waypoints: [ANCHORS.zygote, v(ANCHORS.zygote.x, PLATE_Y, -22), v(x, PLATE_Y, -22), v(x, PLATE_Y, PLOT_Z)],
    draw: [v(x, PLATE_Y, -22), v(x, PLATE_Y, PLOT_Z)],
  })),
  // each ward plot -> cityhall: apps sit directly on the framework band — every
  // Binder call is a short straight hop north. Outer plots jog inward at z -28
  // to land on the hall's plate (x -30..30).
  ...PLOT_X.map((x, n): RouteDef => ({
    from: `plot${n}`, to: 'cityhall',
    waypoints: Math.abs(x) <= 20
      ? [v(x, PLATE_Y, PLOT_Z), v(x, PLATE_Y, -35)]
      : [v(x, PLATE_Y, PLOT_Z), v(x, PLATE_Y, -28), v(Math.sign(x) * 20, PLATE_Y, -28), v(Math.sign(x) * 20, PLATE_Y, -35)],
  })),
  // cityhall -> launcher: the Intent's return leg — south off the app band at
  // the z 5 seam (slope tops at the seam, over bare board), then to the shed.
  {
    from: 'cityhall', to: 'launcher',
    waypoints: [ANCHORS.cityhall, v(-10, PLATE_Y, -28), v(-22, PLATE_Y, -28), v(-22, PLATE_Y, 5), v(-22, 0, 12), ANCHORS.launcher],
  },
  // each ward plot -> surfaceflinger: frame corridor along z -17, then north
  // into the compositor. Crossings with the plot->cityhall roads are
  // perpendicular same-material overlaps (invisible).
  ...PLOT_X.map((x, n): RouteDef => ({
    from: `plot${n}`, to: 'surfaceflinger',
    waypoints: [v(x, PLATE_Y, PLOT_Z), v(x, PLATE_Y, -17), ANCHORS.surfaceflinger],
    draw: [v(x, PLATE_Y, PLOT_Z), v(x, PLATE_Y, -17)],
  })),
  // compositor -> panel: east along the core band, south down the network
  // plate's east rim, off its SOUTH edge (slope starts at the seam, fully over
  // bare board), then southwest to the screen.
  {
    from: 'surfaceflinger', to: 'displaywall',
    waypoints: [
      ANCHORS.surfaceflinger, v(78, PLATE_Y, -30), v(78, PLATE_Y, 35),
      v(74, 0, 43), v(30, 0, 49), DISPLAY_WALL,
    ],
  },
  // network -> each ward plot: shared trunk west along z 14 at board level, then
  // per-plot branch stepping up onto the app band across the z 5 seam.
  ...PLOT_X.map((x, n): RouteDef => ({
    from: 'network', to: `plot${n}`,
    waypoints: [
      ANCHORS.network, v(46.5, PLATE_Y, 15), v(45, 0, 14), v(x, 0, 14),
      v(x, 0, 7), v(x, PLATE_Y, 5), v(x, PLATE_Y, PLOT_Z),
    ],
    draw: [v(x, 0, 14), v(x, 0, 7), v(x, PLATE_Y, 5), v(x, PLATE_Y, PLOT_Z)],
  })),
  // network -> off-board east (the INTERNET road): stays on the network plate
  // (0.3) to the board rim at x 85, then steps down off-board.
  { from: 'network', to: 'offboard-east', waypoints: [ANCHORS.network, v(85, PLATE_Y, 17), OFFBOARD_EAST] },
  // zygote -> cityhall (genealogy: first casting) — straight along the core
  // band: system_server is cast next door and resides next door.
  {
    from: 'zygote', to: 'cityhall', conveyor: true,
    waypoints: [ANCHORS.zygote, v(-30, PLATE_Y, -35), ANCHORS.cityhall],
    info: {
      title: 'First casting',
      note: 'system_server is itself a process — the very first fork out of Zygote at boot. Cast next door, resides next door: every Binder road ends here.',
    },
  },
]

// Shared trunk legs, each meshed exactly once (see RouteDef.draw above).
const TRUNKS: { readonly points: readonly THREE.Vector3[]; readonly conveyor?: boolean }[] = [
  // foundry conveyor spine: south to the z -22 corridor, then east through all 4 plot columns
  { conveyor: true, points: [ANCHORS.zygote, v(ANCHORS.zygote.x, PLATE_Y, -22), v(PLOT_X[3], PLATE_Y, -22)] },
  // network trunk: off the plate at (45,0,14), then west along z 14 to the first plot column
  { points: [ANCHORS.network, v(46.5, PLATE_Y, 15), v(45, 0, 14), v(PLOT_X[0], 0, 14)] },
  // surfaceflinger frame corridor along z -17, then north into the compositor
  { points: [v(PLOT_X[0], PLATE_Y, -17), v(ANCHORS.surfaceflinger.x, PLATE_Y, -17), ANCHORS.surfaceflinger] },
]

function resolveAnchor(key: string): THREE.Vector3 | undefined {
  if (key.startsWith('plot')) return PLOT_ANCHORS[Number(key.slice(4))]
  if (key === 'offboard-east') return OFFBOARD_EAST
  return ANCHORS[key]
}

function lift(points: readonly THREE.Vector3[]): THREE.Vector3[] {
  return points.map(p => p.clone().setY(p.y + WAYPOINT_LIFT))
}

// One straight road tile between two points — flat box + two thin emissive edge
// stripes as children (local space, so they stay put regardless of the box's
// lookAt-derived rotation). Horizontal legs extend deck and stripes ROAD_W/2
// past both endpoints so polyline corners overlap instead of leaving notches
// (overlaps merge into one same-material mesh — invisible). Sloped legs stay
// exact: their top faces already meet flat neighbors at the waypoint, and an
// along-slope extension would poke a ridge up through the adjoining flat leg.
// Decks are exact-length — conveyor tiles alternate colors,
// so an overlapping deck would z-fight against its differently-colored
// neighbor (stripes still extend: they share one material everywhere).
function roadSegment(
  mat: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, raise: number,
): THREE.Object3D {
  const a = from.clone().setY(from.y + raise)
  const b = to.clone().setY(to.y + raise)
  const len = a.distanceTo(b) || 0.001
  // NO endpoint extension: extended decks overlapped coplanar on straight runs
  // and z-fought as a shimmering comb (read as both broken lines AND "lag").
  // Corners are covered by jointPad (raised 0.02 — never coplanar with decks).
  const road = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W, ROAD_H, len), mat)
  road.position.copy(a).lerp(b, 0.5)
  road.position.y -= ROAD_H / 2
  road.lookAt(b)

  const edgeGeo = new THREE.BoxGeometry(EDGE_W, EDGE_H, len)
  const edgeY = ROAD_H / 2 + EDGE_H / 2
  const edgeX = ROAD_W / 2 - EDGE_W / 2
  const edgeL = new THREE.Mesh(edgeGeo, edgeMat)
  edgeL.position.set(-edgeX, edgeY, 0)
  const edgeR = new THREE.Mesh(edgeGeo, edgeMat)
  edgeR.position.set(edgeX, edgeY, 0)
  road.add(edgeL, edgeR)
  return road
}

// Corner joint: a road-width pad at an interior waypoint, top face 0.02 above
// the deck so it cleanly covers the notch where two legs meet at any angle
// (including slope-to-slope corners the horizontal extension can't reach).
function jointPad(mat: THREE.Material, p: THREE.Vector3, raise: number): THREE.Mesh {
  // Cylinder, not box: legs meet at arbitrary angles (rim corners, ramp exits) and
  // an axis-aligned box left bowtie notches there — a disc covers any approach angle.
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(ROAD_W * 0.72, ROAD_W * 0.72, ROAD_H, 12), mat)
  pad.position.set(p.x, p.y + raise + 0.02 - ROAD_H / 2, p.z)
  return pad
}

// Conveyor leg: subdivided into short alternating-color tiles for a ribbed look,
// raised CONVEYOR_RAISE above the plate.
function conveyorLeg(from: THREE.Vector3, to: THREE.Vector3): THREE.Object3D[] {
  const n = Math.max(1, Math.round(from.distanceTo(to) / CONVEYOR_SEGMENT_LEN))
  const segments: THREE.Object3D[] = []
  for (let i = 0; i < n; i++) {
    // Endpoints from cumulative lerp fractions of the one from->to pair, so
    // tile i ends exactly where tile i+1 starts — contiguous, no rounding gaps.
    const p0 = from.clone().lerp(to, i / n)
    const p1 = from.clone().lerp(to, (i + 1) / n)
    segments.push(roadSegment(conveyorMats[i % 2], p0, p1, CONVEYOR_RAISE))
  }
  return segments
}

function buildPolyline(points: readonly THREE.Vector3[], conveyor: boolean | undefined): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = []
  const raise = conveyor ? CONVEYOR_RAISE : ROAD_RAISE
  for (let i = 0; i < points.length - 1; i++) {
    if (conveyor) meshes.push(...conveyorLeg(points[i], points[i + 1]))
    else meshes.push(roadSegment(roadMat, points[i], points[i + 1], raise))
  }
  // Joint pads at interior waypoints keep the polyline visually continuous
  // around every corner. Conveyor pads use color A — every leg's first tile is
  // color A too, so the pad reads as part of the belt.
  for (let i = 1; i < points.length - 1; i++) {
    meshes.push(jointPad(conveyor ? conveyorMats[0] : roadMat, points[i], raise))
  }
  for (const mesh of meshes) mesh.userData.info = conveyor ? CONVEYOR_INFO : ROAD_INFO
  return meshes
}

export interface Routes {
  readonly group: THREE.Group
  path(from: string, to: string): THREE.Vector3[]
}

export function buildRoutes(): Routes {
  const group = new THREE.Group()
  group.name = 'routes'
  // Build every segment into a staging group, then merge into one mesh per
  // (material, info) pair: plain roads, each conveyor color, edge stripes —
  // ~300 draw calls down to ~8. First casting carries its own `info`, so its
  // segments land in their own buckets and keep their distinct tooltip.
  const staging = new THREE.Group()
  for (const route of ROUTES) {
    const meshes = buildPolyline(route.draw ?? route.waypoints, route.conveyor)
    if (route.info) {
      for (const mesh of meshes) {
        mesh.userData.info = route.info
      }
    }
    for (const mesh of meshes) staging.add(mesh)
  }
  for (const trunk of TRUNKS) {
    for (const mesh of buildPolyline(trunk.points, trunk.conveyor)) staging.add(mesh)
  }
  for (const mesh of mergeStaticGroup(staging)) group.add(mesh)

  return {
    group,
    path(from, to) {
      const forward = ROUTES.find(r => r.from === from && r.to === to)
      if (forward) return lift(forward.waypoints)
      const backward = ROUTES.find(r => r.from === to && r.to === from)
      if (backward) return lift([...backward.waypoints].reverse())
      const a = resolveAnchor(from)
      const b = resolveAnchor(to)
      return a && b ? lift([a, b]) : []
    },
  }
}

export function pathLength(path: readonly THREE.Vector3[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) total += path[i - 1].distanceTo(path[i])
  return total
}
