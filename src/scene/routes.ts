import * as THREE from 'three'

// Physical roads + conveyors tying the board's zones together, plus the waypoint
// polylines packets fly along. Mirrors main.ts's ANCHORS / PLOT_ANCHORS values
// (duplicated, not imported, to avoid a main.ts <-> routes.ts import cycle — the
// board layout is fixed by the machine-board plan, low risk of drift).

const ANCHORS: Record<string, THREE.Vector3> = {
  boot: new THREE.Vector3(0, 0, -52),
  zygote: new THREE.Vector3(-65, 0, -20),
  cityhall: new THREE.Vector3(0, -2, 10),
  surfaceflinger: new THREE.Vector3(65, 0, -22),
  network: new THREE.Vector3(65, 0, 17),
  launcher: new THREE.Vector3(0, 3, 40),
}
const PLOT_X = [-33.75, -11.25, 11.25, 33.75]
const PLOT_Z = -25
const PLOT_ANCHORS = PLOT_X.map(x => new THREE.Vector3(x, 0, PLOT_Z))
const OFFBOARD_EAST = new THREE.Vector3(95, 0, 17)
const DISPLAY_WALL = new THREE.Vector3(82, 0, -22)

const ROAD_COLOR = 0x455a64
const EDGE_COLOR = 0x76e3ea
const ROAD_W = 1.6
const ROAD_H = 0.15
const EDGE_W = 0.15
const EDGE_H = 0.05
const CONVEYOR_RAISE = 0.4
const CONVEYOR_COLORS = [0x455a64, 0x37474f]
const CONVEYOR_SEGMENT_LEN = 3
const WAYPOINT_LIFT = 0.5

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z)
}

interface RouteDef {
  readonly from: string
  readonly to: string
  readonly waypoints: readonly THREE.Vector3[]
  readonly conveyor?: boolean
}

const ROUTES: RouteDef[] = [
  // foundry -> each ward plot (conveyor along z -25)
  ...PLOT_X.map((x, n): RouteDef => ({
    from: 'zygote', to: `plot${n}`, conveyor: true,
    waypoints: [ANCHORS.zygote, v(ANCHORS.zygote.x, 0, PLOT_Z), v(x, 0, PLOT_Z)],
  })),
  // each ward plot -> cityhall (Binder road, radiating south into the pit)
  ...PLOT_X.map((x, n): RouteDef => ({
    from: `plot${n}`, to: 'cityhall',
    waypoints: [v(x, 0, PLOT_Z), v(x, 0, -5), v(x, -2, -2), ANCHORS.cityhall],
  })),
  // cityhall -> launcher ramp base
  { from: 'cityhall', to: 'launcher', waypoints: [ANCHORS.cityhall, v(0, -2, 22), v(0, 0, 25), ANCHORS.launcher] },
  // each ward plot -> surfaceflinger (east corridor along z -22)
  ...PLOT_X.map((x, n): RouteDef => ({
    from: `plot${n}`, to: 'surfaceflinger',
    waypoints: [v(x, 0, PLOT_Z), v(x, 0, -22), ANCHORS.surfaceflinger],
  })),
  // surfaceflinger -> display wall (visual connector only, no named "to" key)
  { from: 'surfaceflinger', to: 'displaywall', waypoints: [ANCHORS.surfaceflinger, DISPLAY_WALL] },
  // launcher -> foundry (launch request road: down the ramp, west along z 30, then north)
  {
    from: 'launcher', to: 'zygote',
    waypoints: [ANCHORS.launcher, v(0, 3, 30), v(-30, 3, 30), v(-30, 0, 30), v(ANCHORS.zygote.x, 0, 30), ANCHORS.zygote],
  },
  // network -> each ward plot (corridor along z 0, crossing the pit's east rim)
  ...PLOT_X.map((x, n): RouteDef => ({
    from: 'network', to: `plot${n}`,
    waypoints: [ANCHORS.network, v(45, 0, 0), v(x, 0, 0), v(x, 0, PLOT_Z)],
  })),
  // network -> off-board east (the INTERNET road)
  { from: 'network', to: 'offboard-east', waypoints: [ANCHORS.network, OFFBOARD_EAST] },
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
// lookAt-derived rotation).
function roadSegment(color: number, from: THREE.Vector3, to: THREE.Vector3, raise: number): THREE.Object3D {
  const a = from.clone().setY(from.y + raise)
  const b = to.clone().setY(to.y + raise)
  const len = a.distanceTo(b) || 0.001
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_W, ROAD_H, len),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  )
  road.position.copy(a).lerp(b, 0.5)
  road.position.y -= ROAD_H / 2
  road.lookAt(b)

  const edgeGeo = new THREE.BoxGeometry(EDGE_W, EDGE_H, len)
  const edgeMat = new THREE.MeshStandardMaterial({ color: EDGE_COLOR, emissive: EDGE_COLOR, emissiveIntensity: 0.6 })
  const edgeY = ROAD_H / 2 + EDGE_H / 2
  const edgeX = ROAD_W / 2 - EDGE_W / 2
  const edgeL = new THREE.Mesh(edgeGeo, edgeMat)
  edgeL.position.set(-edgeX, edgeY, 0)
  const edgeR = new THREE.Mesh(edgeGeo, edgeMat)
  edgeR.position.set(edgeX, edgeY, 0)
  road.add(edgeL, edgeR)
  return road
}

// Conveyor leg: subdivided into short alternating-color tiles for a ribbed look,
// raised CONVEYOR_RAISE above the plate.
function conveyorLeg(from: THREE.Vector3, to: THREE.Vector3): THREE.Object3D[] {
  const n = Math.max(1, Math.round(from.distanceTo(to) / CONVEYOR_SEGMENT_LEN))
  const segments: THREE.Object3D[] = []
  for (let i = 0; i < n; i++) {
    const p0 = from.clone().lerp(to, i / n)
    const p1 = from.clone().lerp(to, (i + 1) / n)
    segments.push(roadSegment(CONVEYOR_COLORS[i % 2], p0, p1, CONVEYOR_RAISE))
  }
  return segments
}

function buildRouteMesh(route: RouteDef): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = []
  for (let i = 0; i < route.waypoints.length - 1; i++) {
    const a = route.waypoints[i]
    const b = route.waypoints[i + 1]
    if (route.conveyor) meshes.push(...conveyorLeg(a, b))
    else meshes.push(roadSegment(ROAD_COLOR, a, b, 0))
  }
  return meshes
}

export interface Routes {
  readonly group: THREE.Group
  path(from: string, to: string): THREE.Vector3[]
}

export function buildRoutes(): Routes {
  const group = new THREE.Group()
  group.name = 'routes'
  for (const route of ROUTES) {
    for (const mesh of buildRouteMesh(route)) group.add(mesh)
  }

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
