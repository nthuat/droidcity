import * as THREE from 'three'
import { createCity } from './scene/city'
import { buildBoard } from './scene/board'
import { buildRoutes, pathLength } from './scene/routes'
import { createPacketSystem } from './scene/packet'
import { createHud, makeWardLabel } from './ui/hud'
import { attachZoneLabels, updateHudLines } from './ui/hudWiring'
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { createBus } from './core/bus'
import type { Scenario } from './scenarios/types'
import { makeBootRowScenario } from './scenarios/bootRow'
import { makeFoundryScenario } from './scenarios/foundry'
import { makeCityHallScenario } from './scenarios/cityHall'
import { makeLauncherPlazaScenario } from './scenarios/launcherPlaza'
import { makeNetworkTowerScenario } from './scenarios/networkTower'
import { makeSurfaceFlingerScenario } from './scenarios/surfaceFlinger'
import { createWardManager } from './wards/manager'
import { createPlayer, type Chapter } from './story/player'
import type { StoryCtx } from './story/chapters/ctx'
import { makeCh1 } from './story/chapters/ch1-boot'
import { makeCh2 } from './story/chapters/ch2-ward'
import { makeCh3 } from './story/chapters/ch3-data'
import { makeCh4 } from './story/chapters/ch4-frame'

export const ANCHORS: Record<string, THREE.Vector3> = {
  boot: new THREE.Vector3(0, 0, -52),
  zygote: new THREE.Vector3(-65, 0, -20),
  cityhall: new THREE.Vector3(0, -2, 10),
  surfaceflinger: new THREE.Vector3(65, 0, -22),
  network: new THREE.Vector3(65, 0, 17),
  launcher: new THREE.Vector3(0, 3, 40),
}

const WARDS_ANCHOR = new THREE.Vector3(0, 0, -25)

export const PLOT_ANCHORS: THREE.Vector3[] = [
  new THREE.Vector3(-33.75, 0, -25),
  new THREE.Vector3(-11.25, 0, -25),
  new THREE.Vector3(11.25, 0, -25),
  new THREE.Vector3(33.75, 0, -25),
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

const OVERVIEW_POS = new THREE.Vector3(0, 85, 105)
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, -5)
const TWEEN_MS = 600
const WARD_CAMERA_OFFSET = new THREE.Vector3(10, 9, 12)
const WARD_TARGET_OFFSET = new THREE.Vector3(0, 2, 0)

const city = createCity(document.querySelector<HTMLDivElement>('#app')!)
city.scene.add(buildBoard())
const routes = buildRoutes()
city.scene.add(routes.group)
const switcherEl = document.querySelector<HTMLDivElement>('#switcher')!
const panelEl = document.querySelector<HTMLDivElement>('#panel')!

const bus = createBus()
const packets = createPacketSystem(city.scene)
const hud = createHud(city.scene)
const wardLabels = new Map<string, CSS2DObject>()
// Constructed before any bus.on() below, so its process:forked handler (which spawns
// the ward group synchronously) always runs before main.ts's own handlers.
const wardManager = createWardManager({
  bus, scene: city.scene, packets, anchors: ANCHORS, plotAnchors: PLOT_ANCHORS, routePath: routes.path,
  onWardSpawned(app, pid, group) {
    wardLabels.set(app, makeWardLabel(group, `${app} · pid ${pid}`))
  },
  onWardKilled(app) {
    const label = wardLabels.get(app)
    if (label) label.parent?.remove(label)
    wardLabels.delete(app)
  },
})

// Hides every district (and every live ward) except Boot Row while a boot replay is in
// progress, then restores them on boot:complete.
let dimmed = false
function setCityDim(dim: boolean): void {
  dimmed = dim
  for (const s of scenarios) {
    if (s === bootRow) continue
    s.group.visible = !dim
  }
  for (const w of wardManager.wards()) {
    const g = wardManager.wardGroupFor(w.app)
    if (g) g.visible = !dim
  }
  hud.setDimmed(dim)
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

attachZoneLabels(hud, ANCHORS, WARDS_ANCHOR)
function refreshHud(): void {
  updateHudLines(hud, wardManager.wards().length, foundry, networkTower, surfaceFlinger, launcherPlaza)
}
refreshHud()

scenarios.forEach((s, i) => {
  s.group.position.copy(SCENARIO_OFFSETS[i])
  city.scene.add(s.group)
})

// Story-independent packet routing: activity:resumed (ward→cityhall→launcher) and
// frame:submitted (ward→surfaceflinger) are already flown by WardManager itself —
// not duplicated here. Packets here follow the physical roads (routes.path) rather
// than straight anchor-to-anchor hops; duration scales with the routed distance.
function plotKeyFor(app: string): string | null {
  const w = wardManager.wards().find(entry => entry.app === app)
  return w ? `plot${w.plot}` : null
}

function flyRoute(path: THREE.Vector3[], color: number): void {
  packets.fly(path, { color, arcHeight: 1, durationMs: Math.max(700, 12 * pathLength(path)) })
}

bus.on('app:launchRequested', () => {
  flyRoute(routes.path('launcher', 'zygote'), 0x3fb950)
})
bus.on('process:forked', ({ app }) => {
  const g = wardManager.wardGroupFor(app)
  if (dimmed && g) g.visible = false
  const plotKey = plotKeyFor(app)
  if (plotKey) flyRoute(routes.path('zygote', plotKey), 0x3fb950)
})
bus.on('data:requested', ({ app, source }) => {
  if (source !== 'network') return
  const plotKey = plotKeyFor(app)
  if (plotKey) flyRoute(routes.path(plotKey, 'network'), 0xd29922)
})
bus.on('data:fetched', ({ app }) => {
  const plotKey = plotKeyFor(app)
  if (plotKey) flyRoute(routes.path('network', plotKey), 0xd29922)
})

// Camera fly-to tween state (position + orbit target, eased over TWEEN_MS).
let tweenFromPos = city.camera.position.clone()
let tweenToPos = OVERVIEW_POS.clone()
let tweenFromTarget = city.controls.target.clone()
let tweenToTarget = OVERVIEW_TARGET.clone()
let tweenT = TWEEN_MS // starts "done" — initial camera is set directly below

const HUD_UPDATE_MS = 500
let hudAccMs = 0

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
  if (storyActive) return
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

// --- Story mode -------------------------------------------------------
const DISTRICT_FOCUS_OFFSET = new THREE.Vector3(0, 14, 22)
const DISTRICT_FOCUS_TARGET_OFFSET = new THREE.Vector3(0, 1, 0)

const storyCtx: StoryCtx = {
  bus,
  bootRow: { replayBoot: bootRow.replayBoot },
  launcher: { clickKiosk: launcherPlaza.clickKiosk, resetApps: launcherPlaza.resetApps },
  wards: wardManager,
  setCityDim,
  killApp: foundry.killApp,
}

interface StoryMenuItem {
  readonly label: string
  readonly chapter: Chapter | null
}

const storyMenuItems: StoryMenuItem[] = [
  { label: '1 · Power On', chapter: makeCh1(storyCtx) },
  { label: '2 · A Ward Is Born', chapter: makeCh2(storyCtx) },
  { label: '3 · Getting Data', chapter: makeCh3(storyCtx) },
  { label: '4 · The 16ms Race', chapter: makeCh4(storyCtx) },
]

function focusCamera(focus: string): void {
  if (focus === 'overview') {
    flyTo(OVERVIEW_POS, OVERVIEW_TARGET)
    return
  }
  if (focus.startsWith('ward:')) {
    const g = wardManager.wardGroupFor(focus.slice('ward:'.length))
    const anchor = g ? g.position : ANCHORS.zygote
    const offset = g ? WARD_CAMERA_OFFSET : DISTRICT_FOCUS_OFFSET
    const targetOffset = g ? WARD_TARGET_OFFSET : DISTRICT_FOCUS_TARGET_OFFSET
    flyTo(anchor.clone().add(offset), anchor.clone().add(targetOffset))
    return
  }
  const anchor = ANCHORS[focus]
  if (anchor) flyTo(anchor.clone().add(DISTRICT_FOCUS_OFFSET), anchor.clone().add(DISTRICT_FOCUS_TARGET_OFFSET))
}

function setSwitcherLocked(locked: boolean): void {
  for (const el of switcherEl.children) el.classList.toggle('disabled', locked)
}

const storyCardEl = document.querySelector<HTMLDivElement>('#story-card')!
const storyTitleEl = document.createElement('h2')
const storyNarrationEl = document.createElement('p')
storyNarrationEl.className = 'story-narration'
const storyProgressEl = document.createElement('div')
storyProgressEl.className = 'story-progress'
const storyControlsEl = document.createElement('div')
storyControlsEl.className = 'story-controls'

function mkStoryButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

let playAllMode = false
let playAllQueue: Chapter[] = []
let playAllIdx = 0
// Tracks "a story is on screen" independent of player.playing — the player goes
// idle (playing=false) as soon as the last step's wait resolves, but the card
// stays up showing "Chapter done"; ✕ and Esc must both be able to dismiss it.
let storyActive = false
// True while the story card's ⏸ is showing — freezes the city sim (scenarios,
// wards, packets) so paused time can't outrun the player, which only arms one
// event wait at a time; events firing while paused would be lost forever.
let storyPaused = false

const restartBtn = mkStoryButton('⏮', () => player.restartChapter())
const playPauseBtn = mkStoryButton('⏸', () => {
  if (playPauseBtn.textContent === '⏸') {
    player.pause()
    storyPaused = true
    playPauseBtn.textContent = '▶'
  } else {
    player.resume()
    storyPaused = false
    playPauseBtn.textContent = '⏸'
  }
})
const nextBtn = mkStoryButton('⏭', () => player.next())
const speedBtn = mkStoryButton('1x', () => {
  const next: 1 | 2 = speedBtn.textContent === '1x' ? 2 : 1
  player.setSpeed(next)
  speedBtn.textContent = `${next}x`
})
const closeBtn = mkStoryButton('✕', () => stopStory())
storyControlsEl.append(restartBtn, playPauseBtn, nextBtn, speedBtn, closeBtn)
storyCardEl.append(storyTitleEl, storyNarrationEl, storyProgressEl, storyControlsEl)

function stopStory(): void {
  player.stop()
  playAllMode = false
  storyActive = false
  storyPaused = false
  launcherPlaza.setIdle(true)
  storyCardEl.classList.remove('open')
  panelEl.style.display = ''
  setSwitcherLocked(false)
}

function startStory(chapter: Chapter): void {
  storyActive = true
  storyPaused = false
  launcherPlaza.setIdle(false)
  panelEl.style.display = 'none'
  storyCardEl.classList.add('open')
  setSwitcherLocked(true)
  playPauseBtn.textContent = '⏸'
  player.play(chapter)
}

const player = createPlayer(bus, {
  onStep(step, index, total, title) {
    storyTitleEl.textContent = title
    storyNarrationEl.textContent = step.narration
    storyProgressEl.textContent = `${index + 1}/${total}`
    focusCamera(step.focus)
  },
  onChapterDone() {
    if (playAllMode && playAllIdx < playAllQueue.length - 1) {
      playAllIdx++
      startStory(playAllQueue[playAllIdx])
    } else {
      playAllMode = false
      storyNarrationEl.textContent = 'Chapter done — ✕ to exit'
    }
  },
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && storyActive) stopStory()
})

const storyBarEl = document.querySelector<HTMLDivElement>('#story-bar')!
const storyToggleBtn = document.createElement('button')
storyToggleBtn.textContent = '▶ Story'
const storyMenuEl = document.createElement('div')
storyMenuEl.className = 'story-menu'
storyToggleBtn.addEventListener('click', () => storyMenuEl.classList.toggle('open'))

const playAllBtn = document.createElement('button')
playAllBtn.textContent = 'Play all'
playAllBtn.addEventListener('click', () => {
  storyMenuEl.classList.remove('open')
  playAllQueue = storyMenuItems.map(i => i.chapter).filter((c): c is Chapter => c !== null)
  playAllMode = true
  playAllIdx = 0
  startStory(playAllQueue[0])
})
storyMenuEl.appendChild(playAllBtn)

for (const item of storyMenuItems) {
  const b = document.createElement('button')
  b.textContent = item.label
  if (!item.chapter) {
    b.classList.add('disabled')
  } else {
    const chapter = item.chapter
    b.addEventListener('click', () => {
      storyMenuEl.classList.remove('open')
      playAllMode = false
      startStory(chapter)
    })
  }
  storyMenuEl.appendChild(b)
}

storyBarEl.append(storyToggleBtn, storyMenuEl)

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
  if (!storyPaused) {
    packets.update(dtMs)
    for (const s of scenarios) s.update(dtMs)
    wardManager.update(dtMs)
  }
  player.update(dtMs)
  hudAccMs += dtMs
  if (hudAccMs >= HUD_UPDATE_MS) {
    hudAccMs -= HUD_UPDATE_MS
    refreshHud()
  }
})

document.querySelector('#intro-close')!.addEventListener('click', () => {
  document.querySelector<HTMLDivElement>('#intro')!.style.display = 'none'
})
