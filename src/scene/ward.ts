import * as THREE from 'three'
import { makeLabel } from './builders'

export interface WardMeshes {
  readonly group: THREE.Group
  readonly carsParent: THREE.Group
  readonly floors: readonly THREE.Mesh[]
  readonly appFloor: THREE.Mesh
  readonly providerSlab: THREE.Mesh
  readonly viewModelOrb: THREE.Mesh
  readonly screenPanel: THREE.Mesh
  readonly cratesParent: THREE.Group
  readonly shedGlow: THREE.Mesh
  readonly shedLink: THREE.Mesh
  readonly benchStations: readonly THREE.Mesh[]
  readonly anrOverlay: THREE.Mesh
  readonly serviceAnnex: THREE.Mesh
  readonly wallMesh: THREE.Mesh
  readonly workerParent: THREE.Group
  readonly workerRoad: THREE.Mesh
  readonly stackCards: readonly THREE.Mesh[]
  readonly threadPosts: readonly THREE.Mesh[]
  dispose(): void
}

export const APP_COLORS: Record<string, number> = {
  chat: 0x3fb950,
  maps: 0x388bfd,
  camera: 0xd29922,
  bank: 0xbc8cff,
}

const TOWER_X = -5
const TOWER_Z = -5
const FLOOR_W = 2.5
const FLOOR_H = 0.9
const FLOOR_D = 2.5
const APP_FLOOR_W = 2.8
const APP_FLOOR_D = 2.8
const BENCH_LABELS = ['input', 'animation', 'measure/layout', 'draw', 'renderThread']
const BENCH_GAP = 1.6
const BENCH_NOTES: Record<string, string> = {
  input: 'Choreographer picks up the tap at the next vsync tick.',
  animation: 'Animators tick.',
  'measure/layout': 'Views measure and position themselves.',
  draw: 'Display list recorded — heavy here = jank.',
  renderThread: 'GPU commands issued off the UI thread.',
}

export function buildWardMeshes(app: string): WardMeshes {
  const color = APP_COLORS[app] ?? 0x6e7681
  const disposables: (THREE.Material | THREE.BufferGeometry | THREE.Texture)[] = []
  const trackLabel = (sprite: THREE.Sprite): void => {
    disposables.push(sprite.material)
    if (sprite.material.map) disposables.push(sprite.material.map)
  }

  const group = new THREE.Group()
  group.name = 'ward'
  group.userData.app = app
  // Group-level fallback: covers untagged children (labels/sprites, shedGlow).
  // The inspector's wall-yield logic keys on mesh name 'wardWall', and the wall
  // carries its own info — this fallback never masks either.
  group.userData.info = { title: 'App ward', note: 'One app, one process, one sandbox.' }

  // ContentProvider slab: plinth ring under the Application floor. Providers are
  // instantiated before Application.onCreate — the classic hidden startup tax —
  // so it lights a beat before the appFloor above it. Footprint 3.2 (wider than
  // appFloor's 2.8) at local y -0.05..0.25: the ward group now sits on the plate
  // top (PLOT_ANCHORS y 0.3), so the old -0.3..0 slab would be flush-buried in
  // the plate — instead it pokes above as a visible plinth, with a tiny 0.05
  // sink hiding the plate seam. appFloor's base (local 0) and the plinth top
  // (0.25) are different planes — no z-fight.
  const providerSlabGeo = new THREE.BoxGeometry(3.2, 0.3, 3.2)
  const providerSlabMat = new THREE.MeshStandardMaterial({
    color: 0x8b6c3f, roughness: 0.6, emissive: 0x8b6c3f, emissiveIntensity: 0,
  })
  disposables.push(providerSlabGeo, providerSlabMat)
  const providerSlab = new THREE.Mesh(providerSlabGeo, providerSlabMat)
  providerSlab.name = 'providerSlab'
  providerSlab.position.set(TOWER_X, 0.1, TOWER_Z)
  providerSlab.userData.info = {
    title: 'ContentProviders',
    note: 'Initialize BEFORE Application.onCreate — the classic hidden startup tax.',
  }
  group.add(providerSlab)

  // Application floor: base of the tower, created once at bindApplication —
  // before any Activity exists. Slightly wider than the lifecycle floors above it.
  const appFloorGeo = new THREE.BoxGeometry(APP_FLOOR_W, FLOOR_H, APP_FLOOR_D)
  const appFloorMat = new THREE.MeshStandardMaterial({
    color, roughness: 0.6, emissive: 0xd29922, emissiveIntensity: 0,
  })
  disposables.push(appFloorGeo, appFloorMat)
  const appFloor = new THREE.Mesh(appFloorGeo, appFloorMat)
  appFloor.name = 'appFloor'
  appFloor.position.set(TOWER_X, FLOOR_H / 2, TOWER_Z)
  appFloor.userData.info = {
    title: 'Application',
    note: 'Created once per process at bindApplication — before any Activity.',
  }
  group.add(appFloor)

  // Service annex: small dark building beside the tower. Off by default; manager
  // lights it amber while entry.serviceRunning is true (toggleService).
  const annexGeo = new THREE.BoxGeometry(2, 1.8, 2)
  const annexMat = new THREE.MeshStandardMaterial({
    color: 0x4a5058, roughness: 0.7, emissive: 0xd29922, emissiveIntensity: 0,
  })
  disposables.push(annexGeo, annexMat)
  const serviceAnnex = new THREE.Mesh(annexGeo, annexMat)
  serviceAnnex.name = 'serviceAnnex'
  serviceAnnex.position.set(TOWER_X - 3.2, 0.9, TOWER_Z)
  serviceAnnex.userData.info = {
    title: 'Service',
    note: 'Runs with no UI. Keeps the process off the kill list — oom_adj 500 instead of 900.',
  }
  group.add(serviceAnnex)
  const annexLabel = makeLabel('service', 0.35)
  annexLabel.position.set(TOWER_X - 3.2, 2.4, TOWER_Z)
  trackLabel(annexLabel)
  group.add(annexLabel)

  // Activity tower: 3 lifecycle floors stacked above the Application floor.
  const floors: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.BoxGeometry(FLOOR_W, FLOOR_H, FLOOR_D)
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    disposables.push(geo, mat)
    const floor = new THREE.Mesh(geo, mat)
    floor.name = `floor${i}`
    floor.position.set(TOWER_X, FLOOR_H * (i + 1) + FLOOR_H / 2, TOWER_Z)
    floor.userData.info = { title: 'Activity', note: 'The app’s UI. Floors light with onCreate → onStart → onResume.' }
    group.add(floor)
    floors.push(floor)
  }
  const towerTop = FLOOR_H * 4

  // Back stack: 3 pre-built, hidden translucent plates stacked behind the tower —
  // toggled visible per entry.backStack (no dynamic build/dispose churn per push/pop).
  const stackCards: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.BoxGeometry(2, 0.3, 2)
    const mat = new THREE.MeshStandardMaterial({
      color, transparent: true, opacity: 0.35, emissive: 0xffffff, emissiveIntensity: 0,
    })
    disposables.push(geo, mat)
    const card = new THREE.Mesh(geo, mat)
    card.name = `stackCard${i}`
    // x +2.7 / z -1.4: clear of the bench stations' z row and the providerSlab's
    // east face (slab spans x -6.6..-3.4, bench row at z -8) — no coplanar faces.
    card.position.set(TOWER_X + 2.7, 0.15 + i * 0.3, TOWER_Z - 1.4)
    card.visible = false
    card.userData.info = {
      title: 'Back stack',
      note: 'Activities stack in a task. Back pops the top one; the last pop leaves the process alive — a warm start next time. launchMode singleTop reuses the top instance instead of stacking a new one.',
    }
    group.add(card)
    stackCards.push(card)
  }

  const nameLabel = makeLabel(app, 1)
  nameLabel.position.set(TOWER_X, 8 + FLOOR_H, TOWER_Z)
  trackLabel(nameLabel)
  group.add(nameLabel)

  // View model orb: small purple sphere on the tower roof, hidden by default.
  const orbGeo = new THREE.SphereGeometry(0.3)
  const orbMat = new THREE.MeshStandardMaterial({ color: 0xbc8cff, emissive: 0xbc8cff, emissiveIntensity: 0.5 })
  disposables.push(orbGeo, orbMat)
  const viewModelOrb = new THREE.Mesh(orbGeo, orbMat)
  viewModelOrb.name = 'viewModelOrb'
  viewModelOrb.position.set(TOWER_X, towerTop + 0.3, TOWER_Z)
  viewModelOrb.visible = false
  viewModelOrb.userData.info = { title: 'ViewModel', note: 'UI state that survives rotation — the tower rebuilds, this floats.' }
  group.add(viewModelOrb)

  // Screen panel: tower-top display, dark until lit (frame:composited).
  const panelGeo = new THREE.PlaneGeometry(1.5, 1)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x161b22, emissive: 0x000000, side: THREE.DoubleSide })
  disposables.push(panelGeo, panelMat)
  const screenPanel = new THREE.Mesh(panelGeo, panelMat)
  screenPanel.name = 'screenPanel'
  screenPanel.position.set(TOWER_X, towerTop + 0.5, TOWER_Z + FLOOR_D / 2 + 0.05)
  screenPanel.userData.info = { title: 'App screen', note: 'Lights when SurfaceFlinger composites this app’s frame.' }
  group.add(screenPanel)

  // Road toward the tower, with an empty parent for cars spawned later.
  const roadGeo = new THREE.PlaneGeometry(1, 4)
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x21262d })
  disposables.push(roadGeo, roadMat)
  const road = new THREE.Mesh(roadGeo, roadMat)
  road.name = 'road'
  road.rotation.x = -Math.PI / 2
  road.position.set(0, 0.01, 7)
  road.userData.info = {
    title: 'Main thread',
    note: 'One road: every touch, callback and draw queues here as a car; IO gets posted to the worker pool instead.',
  }
  group.add(road)

  const carsParent = new THREE.Group()
  carsParent.name = 'carsParent'
  carsParent.position.set(0, 0, 7)
  carsParent.userData.info = {
    title: 'Main-thread message',
    note: 'One car per Looper message — the road drains them one at a time.',
  }
  group.add(carsParent)

  // Worker pool: a second, narrower road parallel to the main road — real IO
  // (Room queries, network fetches) runs here, never on the main thread.
  const workerRoadGeo = new THREE.PlaneGeometry(0.6, 4)
  const workerRoadMat = new THREE.MeshStandardMaterial({ color: 0x37474f })
  disposables.push(workerRoadGeo, workerRoadMat)
  const workerRoad = new THREE.Mesh(workerRoadGeo, workerRoadMat)
  workerRoad.name = 'workerRoad'
  workerRoad.rotation.x = -Math.PI / 2
  workerRoad.position.set(1, 0.01, 7)
  workerRoad.userData.info = {
    title: 'Worker pool',
    note: 'IO and heavy work run here — the main thread only posts and receives. Results must post back to the main road — touching views from a worker throws CalledFromWrongThreadException.',
  }
  group.add(workerRoad)

  const workerParent = new THREE.Group()
  workerParent.name = 'workerParent'
  workerParent.position.set(1, 0, 7)
  workerParent.userData.info = {
    title: 'Worker job',
    note: 'IO riding the worker pool, not the main road.',
  }
  group.add(workerParent)

  const workerLabel = makeLabel('workers', 0.35)
  workerLabel.position.set(1, 1.2, 7)
  trackLabel(workerLabel)
  group.add(workerLabel)

  // Thread rack: 6 posts (main, renderThread, binder×2, worker×2) — the ward's
  // real thread inventory, lit per-frame by the manager to show which threads
  // are doing work right now. No post for GC/HeapTaskDaemon — the sweep plane
  // over the heap yard already covers that. Footprint check (local coords):
  // rack sits at x -5.85..-1.35, z -1.8 — north of the tower/provider-slab/
  // annex block (x -8.5..-3.7, z -6.3..-3.7), west of the main road (x -0.5..
  // 0.5, z 2..12) and north of the heap yard (x 2..8, z -8..-2). Clear on all
  // sides; the "between tower and bench" spot suggested at scoping time
  // overlapped the service annex, so this is the actual free patch.
  const THREAD_POST_LABELS = ['main', 'renderThread', 'binder0', 'binder1', 'worker0', 'worker1']
  const THREAD_POST_GAP = 0.9
  const THREAD_POST_W = 0.5
  const THREAD_POST_H = 1.6
  const THREAD_RACK_CENTER_X = -3.6
  const THREAD_RACK_Z = -1.8
  const THREAD_POST_INFO: Record<string, { title: string; note: string }> = {
    main: {
      title: 'Main thread',
      note: 'Services the message road. Owns a private ~8MB stack of call frames — freed on return, no GC needed. Blocks it 5s = ANR.',
    },
    renderThread: {
      title: 'RenderThread',
      note: 'Turns display lists into GPU work off the main thread. Own stack, shares the heap.',
    },
    binder: {
      title: 'Binder pool thread',
      note: 'Incoming IPC lands here — never on your main thread. ~15 of these per process.',
    },
    worker: {
      title: 'Worker thread',
      note: 'IO and heavy work. Every thread: private stack, shared heap — stack frames vanish on return; heap objects wait for GC.',
    },
  }
  const threadPosts: THREE.Mesh[] = []
  const rackStartX = THREAD_RACK_CENTER_X - ((THREAD_POST_LABELS.length - 1) * THREAD_POST_GAP) / 2
  THREAD_POST_LABELS.forEach((label, i) => {
    const geo = new THREE.BoxGeometry(THREAD_POST_W, THREAD_POST_H, THREAD_POST_W)
    const mat = new THREE.MeshStandardMaterial({ color: 0x4c5763, roughness: 0.6 })
    disposables.push(geo, mat)
    const post = new THREE.Mesh(geo, mat)
    post.name = `threadPost_${label}`
    post.position.set(rackStartX + i * THREAD_POST_GAP, THREAD_POST_H / 2, THREAD_RACK_Z)
    const infoKey = label.startsWith('binder') ? 'binder' : label.startsWith('worker') ? 'worker' : label
    post.userData.info = THREAD_POST_INFO[infoKey]
    group.add(post)
    threadPosts.push(post)
  })

  const threadLabel = makeLabel('threads', 0.35)
  threadLabel.position.set(THREAD_RACK_CENTER_X, THREAD_POST_H + 0.6, THREAD_RACK_Z)
  trackLabel(threadLabel)
  group.add(threadLabel)

  // Heap yard: dark plate with an empty parent for crates spawned later.
  const heapGeo = new THREE.PlaneGeometry(6, 6)
  const heapMat = new THREE.MeshStandardMaterial({ color: 0x0d1117 })
  disposables.push(heapGeo, heapMat)
  const heapInfo = {
    title: 'Heap',
    note: 'Allocated objects in this process\'s PRIVATE virtual address space. Tan = reachable, grey = garbage until GC sweeps. Page tables map it onto the RAM bank below.',
  }
  const heapYard = new THREE.Mesh(heapGeo, heapMat)
  heapYard.name = 'heapYard'
  heapYard.rotation.x = -Math.PI / 2
  heapYard.position.set(5, 0.01, -5)
  heapYard.userData.info = heapInfo
  group.add(heapYard)

  const cratesParent = new THREE.Group()
  cratesParent.name = 'cratesParent'
  cratesParent.position.set(5, 0, -5)
  cratesParent.userData.info = heapInfo
  group.add(cratesParent)

  // Room shed with a door plane that flashes on query.
  const shedGeo = new THREE.BoxGeometry(2, 1.5, 2)
  const shedMat = new THREE.MeshStandardMaterial({ color: 0x525b66, roughness: 0.7 })
  disposables.push(shedGeo, shedMat)
  const shed = new THREE.Mesh(shedGeo, shedMat)
  shed.name = 'roomShed'
  shed.position.set(6, 0.75, 4)
  shed.userData.info = {
    title: 'Room DB',
    note: 'App-private database. Fast, local, survives process death. The file itself is on the DISK — mmap\'d pages arrive over the storage bus.',
  }
  group.add(shed)
  const shedLabel = makeLabel('Room DB', 0.35)
  shedLabel.position.set(6, 2.2, 4)
  trackLabel(shedLabel)
  group.add(shedLabel)

  const shedGlowGeo = new THREE.PlaneGeometry(0.8, 1.2)
  const shedGlowMat = new THREE.MeshStandardMaterial({
    color: 0xf0883e, emissive: 0xf0883e, emissiveIntensity: 0, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  })
  disposables.push(shedGlowGeo, shedGlowMat)
  const shedGlow = new THREE.Mesh(shedGlowGeo, shedGlowMat)
  shedGlow.name = 'shedGlow'
  shedGlow.position.set(6, 0.75, 4 + 1.02)
  group.add(shedGlow)

  // Storage link: thin strip from shed to ward edge on the north side where DISK
  // traces land (traces.ts per-plot DISK family climbs from z -68 and approaches
  // from negative-z/north). Strip runs from shed at z 4 to north edge at z -9.
  const linkGeo = new THREE.BoxGeometry(0.4, 0.08, 12.8)
  const linkMat = new THREE.MeshStandardMaterial({
    color: 0x2a3038, roughness: 0.6, emissive: 0x000000, emissiveIntensity: 0,
  })
  disposables.push(linkGeo, linkMat)
  const shedLink = new THREE.Mesh(linkGeo, linkMat)
  shedLink.name = 'shedLink'
  shedLink.position.set(6.4, 0.04, -2.5)
  shedLink.userData.info = {
    title: 'Storage link',
    note: 'The shed\'s SQLite file lives on the DISK — its pages ride the storage bus below.',
  }
  group.add(shedLink)

  // Render bench: 5 mini stations in a row, each with a tiny label.
  const benchStations: THREE.Mesh[] = []
  const benchStartX = -((BENCH_LABELS.length - 1) * BENCH_GAP) / 2
  BENCH_LABELS.forEach((text, i) => {
    const geo = new THREE.BoxGeometry(1, 1.2, 1)
    const mat = new THREE.MeshStandardMaterial({ color: 0x58a6ff, roughness: 0.5 })
    disposables.push(geo, mat)
    const x = benchStartX + i * BENCH_GAP
    const box = new THREE.Mesh(geo, mat)
    box.name = `bench_${text}`
    box.position.set(x, 0.6, -8)
    box.userData.info = { title: `Frame stage: ${text}`, note: BENCH_NOTES[text] }
    group.add(box)
    benchStations.push(box)

    const label = makeLabel(text, 0.25)
    label.position.set(x, 1.6, -8)
    trackLabel(label)
    group.add(label)
  })

  // ANR overlay: translucent red box spanning the whole ward, off by default.
  const anrGeo = new THREE.BoxGeometry(18, 12, 18)
  const anrMat = new THREE.MeshBasicMaterial({ color: 0xf85149, transparent: true, opacity: 0 })
  disposables.push(anrGeo, anrMat)
  const anrOverlay = new THREE.Mesh(anrGeo, anrMat)
  anrOverlay.name = 'anrOverlay'
  anrOverlay.position.y = 6
  anrOverlay.userData.info = {
    title: 'ANR',
    note: 'Blocked main looper. Timers: input 5s · foreground service 20s · broadcast 10s (60s background) · background service 200s.',
  }
  group.add(anrOverlay)

  // Sandbox wall: low curb FRAME marking the ward footprint, used for picking.
  // Was a solid 18×18 slab — its 0.4-alpha tint drew over everything below
  // y 0.35 (roads, cars, shedLink, heapYard, providerSlab). Four edge boxes
  // leave the interior floor untinted. All four share the name 'wardWall'
  // (inspector wall-yield keys on it) and carry userData.app/info for picking.
  const wallInfo = { title: 'Sandbox wall', note: 'Process isolation — no other app can reach inside.' }
  const wallMat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.4 })
  const wallGeoNS = new THREE.BoxGeometry(18, 0.35, 0.6) // north/south edges
  const wallGeoEW = new THREE.BoxGeometry(0.6, 0.35, 16.8) // east/west edges, inset past the corners
  disposables.push(wallMat, wallGeoNS, wallGeoEW)
  const wallEdges: [THREE.BufferGeometry, number, number][] = [
    [wallGeoNS, 0, -8.7], // north
    [wallGeoNS, 0, 8.7], // south
    [wallGeoEW, 8.7, 0], // east
    [wallGeoEW, -8.7, 0], // west
  ]
  const wallMeshes = wallEdges.map(([geo, x, z]) => {
    const edge = new THREE.Mesh(geo, wallMat)
    edge.name = 'wardWall'
    edge.userData.app = app
    edge.userData.info = wallInfo
    edge.position.set(x, 0.175, z)
    group.add(edge)
    return edge
  })
  const wallMesh = wallMeshes[0]

  function dispose(): void {
    for (const d of disposables) d.dispose()
  }

  return {
    group,
    carsParent,
    floors,
    appFloor,
    providerSlab,
    viewModelOrb,
    screenPanel,
    cratesParent,
    shedGlow,
    shedLink,
    benchStations,
    anrOverlay,
    serviceAnnex,
    wallMesh,
    workerParent,
    workerRoad,
    stackCards,
    threadPosts,
    dispose,
  }
}
