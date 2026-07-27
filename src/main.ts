import * as THREE from 'three'
import { createCity } from './scene/city'
import { createPacketSystem } from './scene/packet'
import { createBus } from './core/bus'
import type { Scenario } from './scenarios/types'
import { makeBootRowScenario } from './scenarios/bootRow'
import { makeFoundryScenario } from './scenarios/foundry'
import { makeCityHallScenario } from './scenarios/cityHall'
import { makeLauncherPlazaScenario } from './scenarios/launcherPlaza'
import { makeNetworkTowerScenario } from './scenarios/networkTower'
import { makeSurfaceFlingerScenario } from './scenarios/surfaceFlinger'
import { createWardManager } from './wards/manager'

export const ANCHORS: Record<string, THREE.Vector3> = {
  boot: new THREE.Vector3(-90, 0, 20),
  zygote: new THREE.Vector3(-55, 0, -45),
  cityhall: new THREE.Vector3(0, 0, -60),
  surfaceflinger: new THREE.Vector3(55, 0, -45),
  network: new THREE.Vector3(90, 0, 20),
  launcher: new THREE.Vector3(0, 0, 85),
}

export const PLOT_ANCHORS: THREE.Vector3[] = [
  new THREE.Vector3(-22, 0, -5),
  new THREE.Vector3(22, 0, -5),
  new THREE.Vector3(-22, 0, 35),
  new THREE.Vector3(22, 0, 35),
]

// One offset per entry in `scenarios` below, same order.
const SCENARIO_OFFSETS: THREE.Vector3[] = [
  ANCHORS.boot, // bootRow
  ANCHORS.zygote, // foundry
  ANCHORS.cityhall, // cityHall
  ANCHORS.launcher, // launcherPlaza
  ANCHORS.network, // networkTower
  ANCHORS.surfaceflinger, // surfaceFlinger
]

const OVERVIEW_POS = new THREE.Vector3(0, 115, 155)
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 10)
const TWEEN_MS = 600
const WARD_CAMERA_OFFSET = new THREE.Vector3(10, 9, 12)
const WARD_TARGET_OFFSET = new THREE.Vector3(0, 2, 0)

const city = createCity(document.querySelector<HTMLDivElement>('#app')!)
const switcherEl = document.querySelector<HTMLDivElement>('#switcher')!
const panelEl = document.querySelector<HTMLDivElement>('#panel')!

const bus = createBus()
const packets = createPacketSystem(city.scene)
// Constructed before any bus.on() below, so its process:forked handler (which spawns
// the ward group synchronously) always runs before main.ts's own handlers.
const wardManager = createWardManager({ bus, scene: city.scene, packets, anchors: ANCHORS, plotAnchors: PLOT_ANCHORS })

// Hides every district (and every live ward) except Boot Row while a boot replay is in
// progress, then restores them on boot:complete.
function setCityDim(dim: boolean): void {
  for (const s of scenarios) {
    if (s === bootRow) continue
    s.group.visible = !dim
  }
  for (const w of wardManager.wards()) {
    const g = wardManager.wardGroupFor(w.app)
    if (g) g.visible = !dim
  }
}

const bootRow = makeBootRowScenario(bus, () => setCityDim(true))
const foundry = makeFoundryScenario(bus)
const cityHall = makeCityHallScenario(bus)
const launcherPlaza = makeLauncherPlazaScenario(bus)
const networkTower = makeNetworkTowerScenario(bus)
const surfaceFlinger = makeSurfaceFlingerScenario(bus)
bus.on('boot:complete', () => setCityDim(false))

const scenarios: Scenario[] = [
  bootRow,
  foundry,
  cityHall,
  launcherPlaza,
  networkTower,
  surfaceFlinger,
]

scenarios.forEach((s, i) => {
  s.group.position.copy(SCENARIO_OFFSETS[i])
  city.scene.add(s.group)
})

// Story-independent packet routing: activity:resumed (ward→cityhall→launcher) and
// frame:submitted (ward→surfaceflinger) are already flown by WardManager itself —
// not duplicated here.
bus.on('app:launchRequested', () => {
  packets.fly([ANCHORS.launcher, ANCHORS.zygote], { color: 0x3fb950 })
})
bus.on('process:forked', ({ app }) => {
  const g = wardManager.wardGroupFor(app)
  if (g) packets.fly([ANCHORS.zygote, g.position], { color: 0x3fb950 })
})
bus.on('data:requested', ({ app, source }) => {
  if (source !== 'network') return
  const g = wardManager.wardGroupFor(app)
  if (g) packets.fly([g.position, ANCHORS.network], { color: 0xd29922 })
})
bus.on('data:fetched', ({ app }) => {
  const g = wardManager.wardGroupFor(app)
  if (g) packets.fly([ANCHORS.network, g.position], { color: 0xd29922 })
})

// Camera fly-to tween state (position + orbit target, eased over TWEEN_MS).
let tweenFromPos = city.camera.position.clone()
let tweenToPos = OVERVIEW_POS.clone()
let tweenFromTarget = city.controls.target.clone()
let tweenToTarget = OVERVIEW_TARGET.clone()
let tweenT = TWEEN_MS // starts "done" — initial camera is set directly below

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function flyTo(pos: THREE.Vector3, target: THREE.Vector3): void {
  tweenFromPos = city.camera.position.clone()
  tweenToPos = pos.clone()
  tweenFromTarget = city.controls.target.clone()
  tweenToTarget = target.clone()
  tweenT = 0
}

function overviewPanel(): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = '<h2>DroidCity</h2><p>Pick a district.</p>'
  return div
}

let activeButton: HTMLButtonElement | null = null
function setActiveButton(b: HTMLButtonElement): void {
  activeButton?.classList.remove('active')
  b.classList.add('active')
  activeButton = b
}

let inOverview = true

function activate(s: Scenario, i: number): void {
  inOverview = false
  for (const sc of scenarios) sc.setIdle(true)
  s.setIdle(false)
  panelEl.replaceChildren(s.panel)
  flyTo(SCENARIO_OFFSETS[i].clone().add(s.cameraPos), SCENARIO_OFFSETS[i].clone().add(s.cameraTarget))
}

const overviewBtn = document.createElement('button')
overviewBtn.textContent = 'Overview'
overviewBtn.addEventListener('click', () => {
  setActiveButton(overviewBtn)
  inOverview = true
  driftAngle = Math.atan2(OVERVIEW_POS.x - OVERVIEW_TARGET.x, OVERVIEW_POS.z - OVERVIEW_TARGET.z)
  for (const sc of scenarios) sc.setIdle(true)
  panelEl.replaceChildren(overviewPanel())
  flyTo(OVERVIEW_POS, OVERVIEW_TARGET)
})
switcherEl.appendChild(overviewBtn)

scenarios.forEach((s, i) => {
  const b = document.createElement('button')
  b.textContent = s.name
  b.addEventListener('click', () => {
    setActiveButton(b)
    activate(s, i)
  })
  switcherEl.appendChild(b)
})

// Start in Overview: camera set directly (no tween needed pre-intro).
setActiveButton(overviewBtn)
panelEl.replaceChildren(overviewPanel())
city.camera.position.copy(OVERVIEW_POS)
city.controls.target.copy(OVERVIEW_TARGET)

// Overview camera drift: slow orbit around OVERVIEW_TARGET, stopped for good on first click/drag.
const driftRadius = Math.hypot(OVERVIEW_POS.x - OVERVIEW_TARGET.x, OVERVIEW_POS.z - OVERVIEW_TARGET.z)
let driftAngle = Math.atan2(OVERVIEW_POS.x - OVERVIEW_TARGET.x, OVERVIEW_POS.z - OVERVIEW_TARGET.z)
let driftStopped = false
const stopDrift = (): void => { driftStopped = true }
city.renderer.domElement.addEventListener('pointerdown', stopDrift, { once: true })
city.renderer.domElement.addEventListener('wheel', stopDrift, { once: true })

// Click picking: Launcher Plaza kiosks launch their app; ward buildings fly the
// camera to their plot and show the ward's panel. Coexists with stopDrift above.
const raycaster = new THREE.Raycaster()
city.renderer.domElement.addEventListener('pointerdown', (ev) => {
  const rect = city.renderer.domElement.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, city.camera)
  const kioskHits = raycaster.intersectObjects(launcherPlaza.kioskMeshes(), false)
  if (kioskHits.length > 0) {
    const app = kioskHits[0].object.userData.app as string | undefined
    if (app) launcherPlaza.clickKiosk(app)
    return
  }
  const hits = raycaster.intersectObjects(city.scene.children, true)
  for (const hit of hits) {
    const app = wardManager.wardAppFromObject(hit.object)
    if (!app) continue
    const g = wardManager.wardGroupFor(app)
    if (g) {
      flyTo(g.position.clone().add(WARD_CAMERA_OFFSET), g.position.clone().add(WARD_TARGET_OFFSET))
      const panel = wardManager.panelFor(app)
      if (panel) panelEl.replaceChildren(panel)
    }
    break
  }
})

city.start((dtMs) => {
  if (tweenT < TWEEN_MS) {
    tweenT = Math.min(tweenT + dtMs, TWEEN_MS)
    const t = smoothstep(tweenT / TWEEN_MS)
    city.camera.position.lerpVectors(tweenFromPos, tweenToPos, t)
    city.controls.target.lerpVectors(tweenFromTarget, tweenToTarget, t)
  } else if (inOverview && !driftStopped) {
    driftAngle += dtMs * 0.00005
    city.camera.position.set(
      OVERVIEW_TARGET.x + driftRadius * Math.sin(driftAngle),
      OVERVIEW_POS.y,
      OVERVIEW_TARGET.z + driftRadius * Math.cos(driftAngle),
    )
  }
  packets.update(dtMs)
  for (const s of scenarios) s.update(dtMs)
  wardManager.update(dtMs)
})

document.querySelector('#intro-close')!.addEventListener('click', () => {
  document.querySelector<HTMLDivElement>('#intro')!.style.display = 'none'
})
