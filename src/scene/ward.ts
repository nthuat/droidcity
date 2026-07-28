import * as THREE from 'three'
import { makeLabel } from './builders'

export interface WardMeshes {
  readonly group: THREE.Group
  readonly carsParent: THREE.Group
  readonly floors: readonly THREE.Mesh[]
  readonly viewModelOrb: THREE.Mesh
  readonly screenPanel: THREE.Mesh
  readonly cratesParent: THREE.Group
  readonly shedGlow: THREE.Mesh
  readonly benchStations: readonly THREE.Mesh[]
  readonly anrOverlay: THREE.Mesh
  readonly wallMesh: THREE.Mesh
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
const BENCH_LABELS = ['input', 'animation', 'measure/layout', 'draw', 'renderThread']
const BENCH_GAP = 1.6

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

  // Activity tower: 3 floors stacked bottom-up.
  const floors: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.BoxGeometry(FLOOR_W, FLOOR_H, FLOOR_D)
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    disposables.push(geo, mat)
    const floor = new THREE.Mesh(geo, mat)
    floor.name = `floor${i}`
    floor.position.set(TOWER_X, FLOOR_H * i + FLOOR_H / 2, TOWER_Z)
    group.add(floor)
    floors.push(floor)
  }
  const towerTop = FLOOR_H * 3

  const nameLabel = makeLabel(app, 1)
  nameLabel.position.set(TOWER_X, 8, TOWER_Z)
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
  group.add(viewModelOrb)

  // Screen panel: tower-top display, dark until lit (frame:composited).
  const panelGeo = new THREE.PlaneGeometry(1.5, 1)
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x161b22, emissive: 0x000000, side: THREE.DoubleSide })
  disposables.push(panelGeo, panelMat)
  const screenPanel = new THREE.Mesh(panelGeo, panelMat)
  screenPanel.name = 'screenPanel'
  screenPanel.position.set(TOWER_X, towerTop + 0.5, TOWER_Z + FLOOR_D / 2 + 0.05)
  group.add(screenPanel)

  // Road toward the tower, with an empty parent for cars spawned later.
  const roadGeo = new THREE.PlaneGeometry(1, 10)
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x21262d })
  disposables.push(roadGeo, roadMat)
  const road = new THREE.Mesh(roadGeo, roadMat)
  road.name = 'road'
  road.rotation.x = -Math.PI / 2
  road.position.set(0, 0.01, 7)
  group.add(road)

  const carsParent = new THREE.Group()
  carsParent.name = 'carsParent'
  carsParent.position.set(0, 0, 7)
  group.add(carsParent)

  // Heap yard: dark plate with an empty parent for crates spawned later.
  const heapGeo = new THREE.PlaneGeometry(6, 6)
  const heapMat = new THREE.MeshStandardMaterial({ color: 0x0d1117 })
  disposables.push(heapGeo, heapMat)
  const heapYard = new THREE.Mesh(heapGeo, heapMat)
  heapYard.name = 'heapYard'
  heapYard.rotation.x = -Math.PI / 2
  heapYard.position.set(5, 0.01, -5)
  group.add(heapYard)

  const cratesParent = new THREE.Group()
  cratesParent.name = 'cratesParent'
  cratesParent.position.set(5, 0, -5)
  group.add(cratesParent)

  // Room shed with a door plane that flashes on query.
  const shedGeo = new THREE.BoxGeometry(2, 1.5, 2)
  const shedMat = new THREE.MeshStandardMaterial({ color: 0x30363d, roughness: 0.7 })
  disposables.push(shedGeo, shedMat)
  const shed = new THREE.Mesh(shedGeo, shedMat)
  shed.name = 'roomShed'
  shed.position.set(6, 0.75, 4)
  group.add(shed)

  const shedGlowGeo = new THREE.PlaneGeometry(0.8, 1.2)
  const shedGlowMat = new THREE.MeshStandardMaterial({
    color: 0xf0883e, emissive: 0xf0883e, emissiveIntensity: 0, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  })
  disposables.push(shedGlowGeo, shedGlowMat)
  const shedGlow = new THREE.Mesh(shedGlowGeo, shedGlowMat)
  shedGlow.name = 'shedGlow'
  shedGlow.position.set(6, 0.75, 4 + 1.02)
  group.add(shedGlow)

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
    group.add(box)
    benchStations.push(box)

    const label = makeLabel(text, 0.4)
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
  group.add(anrOverlay)

  // Sandbox wall: translucent border marking the ward footprint, used for picking.
  const wallGeo = new THREE.BoxGeometry(18, 1.2, 18)
  const wallMat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.12 })
  disposables.push(wallGeo, wallMat)
  const wallMesh = new THREE.Mesh(wallGeo, wallMat)
  wallMesh.name = 'wardWall'
  wallMesh.userData.app = app
  wallMesh.position.y = 0.6
  group.add(wallMesh)

  function dispose(): void {
    for (const d of disposables) d.dispose()
  }

  return {
    group,
    carsParent,
    floors,
    viewModelOrb,
    screenPanel,
    cratesParent,
    shedGlow,
    benchStations,
    anrOverlay,
    wallMesh,
    dispose,
  }
}
