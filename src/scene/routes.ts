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
  zygote: new THREE.Vector3(-65, PLATE_Y, -20),
  cityhall: new THREE.Vector3(0, -2, 10),
  surfaceflinger: new THREE.Vector3(65, PLATE_Y, -22),
  network: new THREE.Vector3(65, PLATE_Y, 17),
  launcher: new THREE.Vector3(0, 3, 40),
}
const PLOT_X = [-33.75, -11.25, 11.25, 33.75]
const PLOT_Z = -25
const PLOT_ANCHORS = PLOT_X.map(x => new THREE.Vector3(x, PLATE_Y, PLOT_Z))
// Stops just past the board rim (85) so the road reads as leaving the city
// without a long strip floating over the void.
const OFFBOARD_EAST = new THREE.Vector3(88, 0, 17)
const DISPLAY_WALL = new THREE.Vector3(82, PLATE_Y, -22)

const ROAD_COLOR = 0x546e78
const EDGE_COLOR = 0x00838f
const ROAD_W = 1.6
const ROAD_H = 0.15
const EDGE_W = 0.15
const EDGE_H = 0.05
const ROAD_RAISE = 0.05 // clears the plate top so road/stripes don't z-fight
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
  // foundry -> each ward plot (conveyor along z -25). Packets fly the full path;
  // the visible conveyor spine is built once in TRUNKS (draw: []).
  ...PLOT_X.map((x, n): RouteDef => ({
    from: 'zygote', to: `plot${n}`, conveyor: true, draw: [],
    waypoints: [ANCHORS.zygote, v(ANCHORS.zygote.x, PLATE_Y, PLOT_Z), v(x, PLATE_Y, PLOT_Z)],
  })),
  // each ward plot -> cityhall (Binder road, radiating south into the pit):
  // rides the wards plate (0.3) to its south edge at z -5, then steps down the
  // pit's north rim to the floor — no long half-buried lerp across the plate.
  ...PLOT_X.map((x, n): RouteDef => ({
    from: `plot${n}`, to: 'cityhall',
    waypoints: [v(x, PLATE_Y, PLOT_Z), v(x, PLATE_Y, -5), v(x, -2, -2), ANCHORS.cityhall],
  })),
  // cityhall -> launcher ramp base: jogs east around the WMS wing (local (0,7),
  // world z 17 on the pit floor) instead of driving through it, then up the rim.
  {
    from: 'cityhall', to: 'launcher',
    waypoints: [ANCHORS.cityhall, v(3.2, -2, 14.5), v(3.2, -2, 22), v(0, 0, 25), ANCHORS.launcher],
  },
  // each ward plot -> surfaceflinger: corridor along z -23 (z -22 clipped the
  // ward Room sheds, world z -22..-20). Draws only the short plot spur; the
  // shared east corridor is built once in TRUNKS.
  ...PLOT_X.map((x, n): RouteDef => ({
    from: `plot${n}`, to: 'surfaceflinger',
    waypoints: [v(x, PLATE_Y, PLOT_Z), v(x, PLATE_Y, -23), ANCHORS.surfaceflinger],
    draw: [v(x, PLATE_Y, PLOT_Z), v(x, PLATE_Y, -23)],
  })),
  // surfaceflinger -> display wall (visual connector only, no named "to" key)
  { from: 'surfaceflinger', to: 'displaywall', waypoints: [ANCHORS.surfaceflinger, DISPLAY_WALL] },
  // launcher -> foundry: traverse the deck flat (starts z 31) at z 33, step off
  // its west edge (x -30) onto bare board, cross to the foundry plate's south
  // (launcher->zygote direct road removed: launches route through City Hall —
  // AMS orders the fork; a direct road taught the opposite.)
  // network -> each ward plot: shared trunk (network plate -> step down at the
  // plate's SW corner -> west along z 0 over the pit) built once in TRUNKS;
  // per-plot branch turns north at board level, then steps up onto the wards
  // plate across the z -5/-6 seam.
  ...PLOT_X.map((x, n): RouteDef => ({
    from: 'network', to: `plot${n}`,
    waypoints: [
      ANCHORS.network, v(46.5, PLATE_Y, 1.5), v(45, 0, 0), v(x, 0, 0),
      v(x, 0, -5), v(x, PLATE_Y, -6), v(x, PLATE_Y, PLOT_Z),
    ],
    draw: [v(x, 0, 0), v(x, 0, -5), v(x, PLATE_Y, -6), v(x, PLATE_Y, PLOT_Z)],
  })),
  // network -> off-board east (the INTERNET road): stays on the network plate
  // (0.3) to the board rim at x 85, then steps down off-board.
  { from: 'network', to: 'offboard-east', waypoints: [ANCHORS.network, v(85, PLATE_Y, 17), OFFBOARD_EAST] },
  // zygote -> cityhall (genealogy: first casting). Conveyor from foundry plate east
  // along the rim, flat to the plate edge at (-45,-5), THEN descends pit's west
  // side to the hall floor — same edge-then-descend pattern as plot->cityhall
  // (a direct (-48,-10)->(-42,0) leg dove through the foundry plate).
  {
    from: 'zygote', to: 'cityhall', conveyor: true,
    waypoints: [ANCHORS.zygote, v(-48, PLATE_Y, -10), v(-45, PLATE_Y, -5), v(-42, -2, 0), ANCHORS.cityhall],
    info: {
      title: 'First casting',
      note: 'system_server is itself a process — the very first fork out of Zygote at boot. Born in the foundry, resides at the center because every Binder road ends here.',
    },
  },
]

// Shared trunk legs, each meshed exactly once (see RouteDef.draw above).
const TRUNKS: { readonly points: readonly THREE.Vector3[]; readonly conveyor?: boolean }[] = [
  // foundry conveyor spine: down to z -25, then east through all 4 plot anchors
  { conveyor: true, points: [ANCHORS.zygote, v(ANCHORS.zygote.x, PLATE_Y, PLOT_Z), v(PLOT_X[3], PLATE_Y, PLOT_Z)] },
  // network trunk: off the plate at (45,0,0), then west along z 0 to the last plot
  { points: [ANCHORS.network, v(46.5, PLATE_Y, 1.5), v(45, 0, 0), v(PLOT_X[0], 0, 0)] },
  // surfaceflinger corridor along z -23, with a final 1-unit jog to the anchor
  { points: [v(PLOT_X[0], PLATE_Y, -23), v(ANCHORS.surfaceflinger.x, PLATE_Y, -23), ANCHORS.surfaceflinger] },
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
  const pad = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W, ROAD_H, ROAD_W), mat)
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
