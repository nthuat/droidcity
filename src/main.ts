import * as THREE from 'three'
import { createCity } from './scene/city'
import { buildBoard } from './scene/board'
import { buildRoutes, pathLength } from './scene/routes'
import { buildTraces } from './scene/traces'
import { createPacketSystem } from './scene/packet'
import { createHud, makeWardLabel, type WardLabel } from './ui/hud'
import { createInspector } from './ui/inspector'
import { attachZoneLabels, updateHudLines } from './ui/hudWiring'
import { attachHardwareWiring, createEdgeTrigger } from './ui/hardwareWiring'
import { createBus } from './core/bus'
import type { Scenario } from './scenarios/types'
import { makeBootRowScenario } from './scenarios/bootRow'
import { makeHardwareRowScenario } from './scenarios/hardwareRow'
import { makeFoundryScenario } from './scenarios/foundry'
import { makeCityHallScenario } from './scenarios/cityHall'
import { makeLauncherPlazaScenario } from './scenarios/launcherPlaza'
import { makeNetworkTowerScenario } from './scenarios/networkTower'
import { makeSurfaceFlingerScenario } from './scenarios/surfaceFlinger'
import { createScreen, screenOnHome, screenOnKilled, screenOnPermissionRequest, screenOnPermissionResolved, screenOnRecents, screenOnRecentsDismissed, screenOnResumed, screenOnShade, screenOnShadeDismissed } from './sim/screen'
import { createNotifications, dismissNotification, postNotification } from './sim/notifications'
import { createPermissions, denyPermission, grantPermission, needsPrompt } from './sim/permissions'
import { createWardManager } from './wards/manager'
import { createPlayer, type Chapter } from './story/player'
import type { StoryCtx } from './story/chapters/ctx'
import { makeCh1 } from './story/chapters/ch1-boot'
import { makeCh2 } from './story/chapters/ch2-ward'
import { makeCh3 } from './story/chapters/ch3-data'
import { makeCh4 } from './story/chapters/ch4-frame'
import { makeCh5 } from './story/chapters/ch5-back'
import { makeCh6 } from './story/chapters/ch6-metal'

export const ANCHORS: Record<string, THREE.Vector3> = {
  boot: new THREE.Vector3(0, 0, -52),
  hardware: new THREE.Vector3(0, 0, -68),
  zygote: new THREE.Vector3(-55, 0, -35),
  cityhall: new THREE.Vector3(0, 0.3, -35),
  surfaceflinger: new THREE.Vector3(60, 0, -35),
  network: new THREE.Vector3(65, 0, 17),
  launcher: new THREE.Vector3(0, 0, 48.5),
  displaywall: new THREE.Vector3(0, 0, 58),
}

const WARDS_ANCHOR = new THREE.Vector3(0, 5, -10)
const HUD_UPDATE_MS = 500
const START_TYPE_FLASH_MS = 3000

// y 0.3 = wards plate top (board.ts) — at y 0 the wards' lower 0.3 sat buried in the plate.
export const PLOT_ANCHORS: THREE.Vector3[] = [
  new THREE.Vector3(-33.75, 0.3, -10),
  new THREE.Vector3(-11.25, 0.3, -10),
  new THREE.Vector3(11.25, 0.3, -10),
  new THREE.Vector3(33.75, 0.3, -10),
]

// One offset per entry in `scenarios` below, same order.
const SCENARIO_OFFSETS: THREE.Vector3[] = [
  ANCHORS.boot, // bootRow
  ANCHORS.hardware, // hardwareRow
  ANCHORS.zygote, // foundry
  ANCHORS.cityhall, // cityHall
  ANCHORS.launcher, // launcherPlaza
  ANCHORS.network, // networkTower
  ANCHORS.surfaceflinger, // surfaceFlinger
]

const OVERVIEW_POS = new THREE.Vector3(0, 85, 105)
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, -5)
const TWEEN_MS_MIN = 800
const TWEEN_MS_MAX = 2200
const TWEEN_MS_PER_UNIT = 12
const WARD_CAMERA_OFFSET = new THREE.Vector3(10, 9, 12)
const WARD_TARGET_OFFSET = new THREE.Vector3(0, 2, 0)

const city = createCity(document.querySelector<HTMLDivElement>('#app')!)
city.scene.add(buildBoard())
const routes = buildRoutes()
city.scene.add(routes.group)
const traces = buildTraces()
city.scene.add(traces.group)

// Hardware component world positions — mirrors hardwareRow.ts's private RAM_X/DISK_X
// plus ANCHORS.hardware's z and board.ts's hardware-strip plate top (-0.5). Duplicated
// as plain numbers (not imported) for the same reason ANCHORS/PLOT_ANCHORS are
// duplicated between main.ts and routes.ts (see routes.ts's header) — these two points
// are used only for the small-packet flights below.
const RAM_POS = new THREE.Vector3(0, -0.5, -68)
const DISK_POS = new THREE.Vector3(30, -0.5, -68)
const HW_PACKET_MS = 600
const HW_PACKET_ARC = 0.5
const switcherEl = document.querySelector<HTMLDivElement>('#switcher')!
const panelEl = document.querySelector<HTMLDivElement>('#panel')!

// Live oom_adj table (kill-order view, like a tiny dumpsys): pseudo-rows for the
// untouchable/system tiers plus one row per live proc, sorted so the next LMK
// victim sits on top. Updated on the 500ms HUD tick.
const oomTableEl = document.createElement('div')
oomTableEl.id = 'oom-table'
document.body.appendChild(oomTableEl)
function refreshOomTable(): void {
  const procs = foundry.stats().procList
  const rows = procs
    .map(p => ({ name: p.name, score: p.oomAdj }))
    .sort((a, b) => b.score - a.score)
  const line = (score: number | string, name: string, cls = '') =>
    `<div class="oom-row ${cls}"><span>${String(score).padStart(4)}</span><span>${name}</span></div>`
  oomTableEl.innerHTML =
    '<div class="oom-title">oom_adj · kill order</div>'
    + rows.map((r, i) => line(r.score, r.name, i === 0 && r.score >= 900 ? 'oom-victim' : '')).join('')
    + line(600, 'launcher', 'oom-static')
    + line(-900, 'system_server', 'oom-static')
}

const bus = createBus()
// Tracks "a story is on screen" independent of player.playing — the player goes
// idle (playing=false) as soon as the last step's wait resolves, but the card
// stays up showing "Chapter done"; ✕ and Esc must both be able to dismiss it.
// Declared early: refreshHud (called before story mode is set up) reads it.
let storyActive = false
const packets = createPacketSystem(city.scene)
const hud = createHud(city.scene)
const wardLabels = new Map<string, WardLabel>()
// Wall-clock (not sim-time) expiry per app for the ward label's start-type flash
// — this is pure UI feedback, not part of the simulation, so it shouldn't be
// affected by story-mode's sim-time slowdown. Cleared by the 500ms HUD tick.
const startTypeExpiry = new Map<string, number>()
// Foundry constructed first so WardManager can call its setAppPriority on
// warm/hot brought-to-front and on Home.
const foundry = makeFoundryScenario(bus)
// Constructed before any bus.on() below, so its process:forked handler (which spawns
// the ward group synchronously) always runs before main.ts's own handlers.
const wardManager = createWardManager({
  bus, scene: city.scene, packets, anchors: ANCHORS, plotAnchors: PLOT_ANCHORS, routePath: routes.path,
  setAppPriority: foundry.setAppPriority,
  // Kill→retap race: a fork that lands while the old ward still holds its plot
  // gets its ward spawn dropped — kill the orphan proc so process:killed flows
  // (launcher markStopped revives the kiosk, foundry frees RAM/PSI).
  onSpawnDropped(app) { foundry.killApp(app) },
  onStartType(app, type) {
    wardLabels.get(app)?.setStartLine(`${type} start`)
    startTypeExpiry.set(app, Date.now() + START_TYPE_FLASH_MS)
  },
  onWardSpawned(app, pid, group) {
    wardLabels.set(app, makeWardLabel(group, `${app} · pid ${pid}`))
  },
  onWardKilled(app) {
    const label = wardLabels.get(app)
    if (label) label.obj.parent?.remove(label.obj)
    wardLabels.delete(app)
    startTypeExpiry.delete(app)
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
  for (const ghost of startingGhosts.values()) ghost.mesh.visible = !dim
  oomTableEl.style.display = dim ? 'none' : ''
  hud.setDimmed(dim)
}

// Starting-window splash: a translucent ghost box appears the instant a ward's plot
// is known (process:forked), stands in for the app while the ward rises, and fades
// out on the app's first composited frame — teaches why cold launches "feel" instant
// (WMS shows the splash long before the real Activity is ready).
const GHOST_SIZE = { w: 5, h: 6, d: 5 }
const GHOST_OPACITY = 0.25
const GHOST_FADE_MS = 400
interface StartingGhost { mesh: THREE.Mesh; fading: boolean; fadeMs: number }
const startingGhosts = new Map<string, StartingGhost>()

function disposeGhost(app: string): void {
  const ghost = startingGhosts.get(app)
  if (!ghost) return
  city.scene.remove(ghost.mesh)
  ghost.mesh.geometry.dispose()
  ;(ghost.mesh.material as THREE.Material).dispose()
  startingGhosts.delete(app)
}

function spawnGhost(app: string): void {
  disposeGhost(app) // guards a re-fork landing before the previous ghost finished fading
  const g = wardManager.wardGroupFor(app)
  if (!g) return
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(GHOST_SIZE.w, GHOST_SIZE.h, GHOST_SIZE.d),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: GHOST_OPACITY,
      emissive: 0xffffff, emissiveIntensity: 0.3,
    }),
  )
  mesh.position.set(g.position.x, g.position.y + GHOST_SIZE.h / 2, g.position.z)
  mesh.visible = !dimmed
  mesh.userData.info = { title: 'Starting window (WMS)', note: 'WindowManager shows this splash instantly — the real app is still forking behind it.' }
  city.scene.add(mesh)
  startingGhosts.set(app, { mesh, fading: false, fadeMs: 0 })
}

function updateGhosts(dtMs: number): void {
  for (const [app, ghost] of [...startingGhosts]) {
    if (!ghost.fading) continue
    ghost.fadeMs += dtMs
    const mat = ghost.mesh.material as THREE.MeshStandardMaterial
    mat.opacity = GHOST_OPACITY * Math.max(0, 1 - ghost.fadeMs / GHOST_FADE_MS)
    if (ghost.fadeMs >= GHOST_FADE_MS) disposeGhost(app)
  }
}

const bootRow = makeBootRowScenario(bus, () => setCityDim(true))
const hardwareRow = makeHardwareRowScenario()
const cityHall = makeCityHallScenario(bus)
const launcherPlaza = makeLauncherPlazaScenario(bus)
// Subscription order matters: wardManager (constructed above) gets data:requested
// first — the worker car must exist before a full queue's nested, synchronous
// data:dropped tries to remove it.
const networkTower = makeNetworkTowerScenario(bus)
const surfaceFlinger = makeSurfaceFlingerScenario(bus)
bus.on('boot:complete', () => setCityDim(false))
// bootRow's update() only emits boot:complete from its replaying branch (see
// bootRow.ts) — the pre-booted first-load state never calls update() with
// replaying=true, so this never fires before a story/panel-triggered replay.
// Acceptable: "the OS finished booting" is only newsworthy the first time a
// replay actually runs in this session.
bus.on('boot:complete', () => bus.emit('broadcast:sent', { action: 'BOOT_COMPLETED' }))
// SF starts at init stage in real Android (not later), so un-dim it early during boot replay
bus.on('boot:stageDone', ({ stage }) => {
  if (stage === 'init' && dimmed) {
    surfaceFlinger.group.visible = true
  }
})

const scenarios: Scenario[] = [
  bootRow,
  hardwareRow,
  foundry,
  cityHall,
  launcherPlaza,
  networkTower,
  surfaceFlinger,
]

attachZoneLabels(hud, ANCHORS, WARDS_ANCHOR)
// Single combined HARDWARE chip (CPU/RAM/DISK on one line) rather than three
// sub-labels — matches the other zone chips' one-title/one-line shape.
hud.attach('hardware', ANCHORS.hardware, 'HARDWARE')
// Subscription order matters: hwWiring's process:forked handler looks up the
// app's plot via wardStats(), so wardManager's onForked (subscribed at
// construction, above) must have spawned the ward first.
const hwWiring = attachHardwareWiring(
  bus, hardwareRow, wardManager, foundry,
  traces.setCpuTraceGlow, traces.setRamTraceGlow, traces.setDiskTraceGlow, traces.setCpuRamBusGlow, traces.setRamDiskBusGlow,
)
// PSI-driven LMK: crossing 0.85 upward (edge-triggered, rearms below 0.7) fires
// memory:pressure — foundry reclaims a cached process in response.
const pressureTrigger = createEdgeTrigger(0.85, 0.7)
function refreshHud(): void {
  updateHudLines(hud, wardManager.wards().length, foundry, networkTower, surfaceFlinger, launcherPlaza)
  refreshOomTable()
  hwWiring.syncRam()
  hwWiring.syncPressure(HUD_UPDATE_MS)
  // Gated while a story is open (paused implies storyActive too): an ambient
  // PSI kill mid-chapter would pre-consume a chapter's process:killed wait.
  // ch6's own explicit ctx.bus.emit('memory:pressure') is unaffected.
  if (!storyActive && pressureTrigger(hwWiring.getPressure())) bus.emit('memory:pressure', {})
  hud.setLine('hardware', hwWiring.label())
  const procList = foundry.stats().procList
  const now = Date.now()
  for (const w of wardManager.wards()) {
    const oomAdj = procList.find(p => p.name === w.app)?.oomAdj
    wardLabels.get(w.app)?.setLine(`oom_adj ${oomAdj ?? '?'}`)
    const expiry = startTypeExpiry.get(w.app)
    if (expiry !== undefined && now >= expiry) {
      wardLabels.get(w.app)?.setStartLine('')
      startTypeExpiry.delete(w.app)
    }
  }
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

// Launcher never talks to Zygote — it files the request with AMS (city hall),
// which is the one that tells Zygote to fork. Flown as two concatenated legs
// (same pattern WardManager uses for ward->cityhall->launcher) so it reads as
// one continuous packet, not two independent flights.
bus.on('app:launchRequested', () => {
  const toCityhall = routes.path('launcher', 'cityhall')
  const toZygote = routes.path('cityhall', 'zygote')
  flyRoute([...toCityhall, ...toZygote.slice(1)], 0x3fb950)
})

// The glass mirrors the foreground: launcher grid at home, the resumed app's
// panel otherwise (src/sim/screen.ts holds the pure state).
let screen = createScreen()
function syncScreen(next: ReturnType<typeof createScreen>): void {
  screen = next
  surfaceFlinger.setScreen(screen)
}
// NotificationManagerService's ledger + PMS's permission records (pure sims).
let notifs = createNotifications()
let perms = createPermissions()
// Apps already asked during THIS foreground session: WardManager emits
// activity:resumed several times per launch (rise, foreground, hot start), and
// without this an already-open dialog got clobbered — or a denied app was
// re-prompted on every one of those events.
const promptedThisVisit = new Set<string>()
bus.on('activity:resumed', ({ app }) => {
  // A dialog already up for this app stays up — the app is underneath it.
  if (screen.mode === 'permission' && screen.app === app) return
  syncScreen(screenOnResumed(screen, app))
  // Runtime permission: the system throws its dialog over the app's first
  // foreground moment (camera models the dangerous CAMERA permission).
  if (needsPrompt(perms, app) && !promptedThisVisit.has(app)) {
    promptedThisVisit.add(app)
    syncScreen(screenOnPermissionRequest(screen, app))
  }
})
bus.on('activity:backgrounded', ({ app }) => {
  promptedThisVisit.delete(app) // next foreground visit may ask again
  if (screen.mode === 'app' && screen.app === app) syncScreen(screenOnHome(screen))
})
bus.on('process:killed', ({ app }) => {
  promptedThisVisit.delete(app)
  syncScreen(screenOnKilled(screen, app))
})
bus.on('process:forked', ({ app }) => {
  const g = wardManager.wardGroupFor(app)
  if (dimmed && g) g.visible = false
  const plotKey = plotKeyFor(app)
  if (plotKey) flyRoute(routes.path('zygote', plotKey), 0x3fb950)
  // A re-fork landing while the old instance is still demolishing gets its plot
  // request dropped by the manager (old entry stays in its map under the same
  // app key, still `dying`) — wardStats() excludes dying entries, so this only
  // spawns a ghost for a fork that actually produced a live ward.
  if (wardManager.wardStats().some(w => w.app === app)) spawnGhost(app)
  // Memory pages get handed to the new process: RAM -> plot.
  if (g) packets.fly([RAM_POS, g.position], { color: 0xbc8cff, durationMs: HW_PACKET_MS, arcHeight: HW_PACKET_ARC })
})
// First composited frame only — updateGhosts flips `fading` once, so later
// frame:composited events for the same app are no-ops (ghost already gone).
// (SurfaceFlinger's own submit queue isn't purged on kill either, so a killed
// app's already-queued frame can still composite late — harmless here since
// disposeGhost already ran via process:killed below, making this a no-op.)
bus.on('frame:composited', ({ app }) => {
  const ghost = startingGhosts.get(app)
  if (ghost) ghost.fading = true
})
// Edge case: app backgrounded before its first frame ever composited — no
// composite will come while stopped, so the ghost would stand forever.
bus.on('activity:backgrounded', ({ app }) => disposeGhost(app))
// Edge case: app killed before its first frame ever composited — the fade trigger
// above never fires, so drop the ghost immediately instead of leaving it stuck.
bus.on('process:killed', ({ app }) => {
  disposeGhost(app)
  // Freed pages return to RAM: plot -> RAM. wardGroupFor still resolves here —
  // the manager keeps the entry (and its group) alive through the demolition
  // animation, only deleting it once that finishes (see wards/manager.ts).
  const g = wardManager.wardGroupFor(app)
  if (g) packets.fly([g.position, RAM_POS], { color: 0x6e7681, durationMs: HW_PACKET_MS, arcHeight: HW_PACKET_ARC })
})
// Radio feed lights while the tower is actually pipelining a request: on for the
// request, refreshed on the response, decays via the timeout below.
let radioGlowTimer: number | undefined
function pulseRadio(): void {
  hardwareRow.radioBlink()
  traces.setRadioFeedGlow(0x3ddc84)
  clearTimeout(radioGlowTimer)
  radioGlowTimer = window.setTimeout(() => traces.setRadioFeedGlow(null), 600)
}
bus.on('data:requested', ({ app, source }) => {
  if (source !== 'network') return
  const plotKey = plotKeyFor(app)
  if (plotKey) flyRoute(routes.path(plotKey, 'network'), 0xd29922)
  pulseRadio()
})
bus.on('data:fetched', ({ app }) => {
  const plotKey = plotKeyFor(app)
  if (plotKey) flyRoute(routes.path('network', plotKey), 0xd29922)
  pulseRadio()
  // Background sync pattern: data arriving while the app is NOT on screen
  // posts a notification — ward -> NotificationManagerService (City Hall) ->
  // the glass. Foreground apps just show the data.
  if (screen.app !== app) {
    notifs = postNotification(notifs, app)
    surfaceFlinger.setNotifications(notifs.pending)
    if (plotKey) {
      const toHall = routes.path(plotKey, 'cityhall')
      const toGlass = routes.path('cityhall', 'displaywall')
      flyRoute([...toHall, ...toGlass.slice(1)], 0xf2cc60)
    }
  }
})
// Room cache hit: plot -> DISK -> plot, a quick round-trip pair (both hops fired
// immediately — no timers — reading as one flight there and one back).
// System.loadLibrary at process start: the .so's pages are mmap'd off the DISK
// into this process — a real disk read, before any of the app's code runs.
bus.on('process:forked', ({ app }) => {
  const g = wardManager.wardGroupFor(app)
  if (!g) return
  hardwareRow.diskBlink(false)
  packets.fly([DISK_POS, g.position], { color: 0x8d7b6b, durationMs: HW_PACKET_MS, arcHeight: HW_PACKET_ARC })
})
bus.on('data:cacheHit', ({ app }) => {
  const g = wardManager.wardGroupFor(app)
  if (!g) return
  packets.fly([g.position, DISK_POS], { color: 0x76e3ea, durationMs: HW_PACKET_MS, arcHeight: HW_PACKET_ARC })
  packets.fly([DISK_POS, g.position], { color: 0x76e3ea, durationMs: HW_PACKET_MS, arcHeight: HW_PACKET_ARC })
})
// Broadcast fan-out: cityhall -> every living ward's plot. wardManager reacts
// to the same event itself (posts onReceive per ward); this just visualizes
// the Binder hop for each one.
bus.on('broadcast:sent', () => {
  for (const w of wardManager.wardStats()) {
    flyRoute(routes.path('cityhall', `plot${w.plot}`), 0x58a6ff)
  }
})

// Input's system-side trip: a tap starts at hardware and is dispatched by
// system_server's InputDispatcher before an app ever sees it. Flies that leg
// immediately, then — after a browser-layer delay (story logic itself stays
// event-driven, no Date-dependent timers there) — flies the dispatcher→ward leg
// (only once the ward's plot is known; a cold run can fire this in the same
// tick as the launch, before the fork lands) and posts the app-side message.
// Two-stage flight matches reality: dispatcher hop, then app hop.
const INJECT_TAP_DELAY_MS = 1200
// Single-slot pending timer: cleared before arming a new one, and by every
// story stop/start/restart path (see stopStory/startStory/restartBtn) so a
// stray late-firing timer from a closed or replayed chapter can't inject a
// ui:messagePosted that pre-satisfies a *different* session's buffered wait.
let injectTapTimer: ReturnType<typeof window.setTimeout> | undefined
function clearInjectTapTimer(): void {
  if (injectTapTimer === undefined) return
  window.clearTimeout(injectTapTimer)
  injectTapTimer = undefined
}
function injectTap(app: string): void {
  flyRoute(routes.path('hardware', 'cityhall'), 0xf2cc60)
  clearInjectTapTimer()
  injectTapTimer = window.setTimeout(() => {
    injectTapTimer = undefined
    const plotKey = plotKeyFor(app)
    if (plotKey) flyRoute(routes.path('cityhall', plotKey), 0xf2cc60)
    bus.emit('ui:messagePosted', { app, label: 'tap' })
  }, INJECT_TAP_DELAY_MS)
}

// Camera fly-to tween state (position + orbit target, eased over tweenDurationMs).
let tweenFromPos = city.camera.position.clone()
let tweenToPos = OVERVIEW_POS.clone()
let tweenFromTarget = city.controls.target.clone()
let tweenToTarget = OVERVIEW_TARGET.clone()
let tweenDurationMs = 0
let tweenT = 0 // starts "done" (0 >= 0) — initial camera is set directly below

let hudAccMs = 0
const INSPECTOR_UPDATE_MS = 80
let inspectorAccMs = 0

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

// Longer flights get more tween time so the camera doesn't whip across the
// whole map in the same 600ms as a short hop — clamped so short hops stay
// snappy and long ones don't drag on forever.
function flyTo(pos: THREE.Vector3, target: THREE.Vector3): void {
  tweenFromPos = city.camera.position.clone()
  tweenToPos = pos.clone()
  tweenFromTarget = city.controls.target.clone()
  tweenToTarget = target.clone()
  const distance = tweenFromPos.distanceTo(tweenToPos)
  tweenDurationMs = THREE.MathUtils.clamp(distance * TWEEN_MS_PER_UNIT, TWEEN_MS_MIN, TWEEN_MS_MAX)
  tweenT = 0
}

function overviewPanel(): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = '<h2>DroidCity</h2><p>Pick a district.</p>'
    + '<p class="panel-narration"><a href="https://github.com/nthuat/droidcity" target="_blank" rel="noopener">GitHub</a>'
    + ' · <a href="https://github.com/nthuat/droidcity/blob/main/docs/android-flow-reference.md" target="_blank" rel="noopener">reference</a>'
    + ' · inspired by <a href="https://nikolays.github.io/PGSimCity/" target="_blank" rel="noopener">PGSimCity</a></p>'
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

// Population controls: watch one app's flow in an empty city, then grow it
// manually. Manual mode only touches launcher/foundry idle (auto-launch,
// auto-reclaim) — per-ward idle and every event flow are untouched.
let cityManual = false
const divider = document.createElement('span')
divider.className = 'switcher-divider'
switcherEl.appendChild(divider)

const cityModeBtn = document.createElement('button')
cityModeBtn.textContent = 'City: auto'
cityModeBtn.title = 'Manual: nothing launches or dies on its own — you drive every event'
cityModeBtn.addEventListener('click', () => {
  cityManual = !cityManual
  cityModeBtn.textContent = cityManual ? 'City: manual' : 'City: auto'
  launcherPlaza.setIdle(!cityManual)
  foundry.setIdle(!cityManual)
})
switcherEl.appendChild(cityModeBtn)

const resetCityBtn = document.createElement('button')
resetCityBtn.textContent = 'Reset city'
resetCityBtn.title = 'SIGKILL every ward — empty plots, fresh start'
resetCityBtn.addEventListener('click', () => {
  if (storyActive) return // also .disabled via setSwitcherLocked while a story is open
  for (const p of foundry.stats().procList) foundry.killApp(p.name)
})
switcherEl.appendChild(resetCityBtn)

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
  // Taps on the glass: the display IS the input surface. Icon -> launch
  // (touch enters via hardware, the launcher files the Intent), pill -> Home.
  const iconHits = raycaster.intersectObjects(surfaceFlinger.screenIconMeshes(), false)
  if (iconHits.length > 0) {
    const app = iconHits[0].object.userData.app as string | undefined
    if (app) {
      flyRoute(routes.path('hardware', 'displaywall'), 0xf2cc60)
      launcherPlaza.clickKiosk(app)
    }
    return
  }
  // Permission dialog is modal: its two buttons — or Back, which counts as a
  // denial — are the only answers while it's up.
  if (screen.mode === 'permission') {
    const pb = surfaceFlinger.permissionButtons()
    const permHits = raycaster.intersectObjects([pb.allow, pb.deny], false)
    const backHit = raycaster.intersectObjects([surfaceFlinger.navMeshes().back], false).length > 0
    if ((permHits.length > 0 || backHit) && screen.app) {
      const grantApp = screen.app
      if (permHits.length > 0 && permHits[0].object === pb.allow) {
        perms = grantPermission(perms, grantApp)
      } else {
        perms = denyPermission(perms, grantApp)
      }
      // The answer is recorded by PMS in system_server.
      flyRoute(routes.path('launcher', 'cityhall'), 0x9aa0cf)
      syncScreen(screenOnPermissionResolved(screen))
    }
    return
  }
  // Shade rows: tap = SystemUI fires the PendingIntent.
  if (screen.mode === 'shade') {
    const rowHits = raycaster.intersectObjects(surfaceFlinger.shadeRowMeshes(), false)
    if (rowHits.length > 0) {
      const app = rowHits[0].object.userData.app as string | undefined
      if (app) {
        notifs = dismissNotification(notifs, app)
        surfaceFlinger.setNotifications(notifs.pending)
        launcherPlaza.clickKiosk(app)
      }
      return
    }
  }
  const barHits = raycaster.intersectObjects([surfaceFlinger.statusBarMesh()], false)
  if (barHits.length > 0) {
    syncScreen(screen.mode === 'shade' ? screenOnShadeDismissed(screen) : screenOnShade(screen))
    return
  }
  // Recents cards (only visible in recents mode): tap = hot start / bring to front.
  if (screen.mode === 'recents') {
    const cardHits = raycaster.intersectObjects(surfaceFlinger.recentsCardMeshes(), false)
    if (cardHits.length > 0) {
      const app = cardHits[0].object.userData.app as string | undefined
      if (app) launcherPlaza.clickKiosk(app) // running -> broughtToFront -> resumed flips the screen
      return
    }
  }
  const nav = surfaceFlinger.navMeshes()
  const navHits = raycaster.intersectObjects([nav.back, nav.home, nav.recents], false)
  if (navHits.length > 0) {
    const btn = navHits[0].object
    if (btn === nav.home) {
      if (screen.mode === 'app' && screen.app) wardManager.goHome(screen.app)
      else if (screen.mode === 'recents' || screen.mode === 'shade') {
        const under = screen.app
        syncScreen(screenOnHome(screen))
        if (under) wardManager.goHome(under)
      }
    } else if (btn === nav.back) {
      if (screen.mode === 'recents') syncScreen(screenOnRecentsDismissed(screen))
      else if (screen.mode === 'shade') syncScreen(screenOnShadeDismissed(screen))
      // (Permission mode never reaches here — its modal block above intercepts.)
      // popActivity pops the stack, or at the root finishes the Activity —
      // which emits activity:backgrounded and drops the screen to home.
      else if (screen.mode === 'app' && screen.app) wardManager.popActivity(screen.app)
    } else {
      syncScreen(screenOnRecents(screen))
    }
    return
  }
  const kioskHits = raycaster.intersectObjects(launcherPlaza.kioskMeshes(), false)
  if (kioskHits.length > 0) {
    const app = kioskHits[0].object.userData.app as string | undefined
    if (app) {
      // Every tap enters via hardware + system_server, even a launcher icon tap —
      // visualize that leg alongside the existing launcher→zygote launch request.
      flyRoute(routes.path('hardware', 'launcher'), 0xf2cc60)
      launcherPlaza.clickKiosk(app)
    }
    return
  }
  const hits = raycaster.intersectObjects(city.scene.children, true)
  for (const hit of hits) {
    // The display belongs to the SF scenario group, but clicking the phone
    // should bring you face-to-face with the phone — not fly to SurfaceFlinger.
    let d: THREE.Object3D | null = hit.object
    while (d) {
      if (d.userData.displayWall) {
        flyTo(new THREE.Vector3(0, 18, 80), new THREE.Vector3(0, 2, 54))
        return
      }
      d = d.parent
    }
    const app = wardManager.wardAppFromObject(hit.object)
    // wardStats() excludes dying wards — clicking a mid-demolition ward must not
    // fly/open a panel for it; fall through to district resolution instead.
    if (app && wardManager.wardStats().some(w => w.app === app)) {
      const g = wardManager.wardGroupFor(app)
      if (g) {
        flyTo(g.position.clone().add(WARD_CAMERA_OFFSET), g.position.clone().add(WARD_TARGET_OFFSET))
        const panel = wardManager.panelFor(app)
        if (panel) panelEl.replaceChildren(panel)
      }
      return
    }
    // District buildings behave like their switcher buttons: clicking City Hall,
    // the foundry, the tower etc. flies there and opens that district's panel.
    let o: THREE.Object3D | null = hit.object
    while (o) {
      const i = scenarios.findIndex(s => s.group === o)
      if (i >= 0) {
        activate(scenarios[i], i)
        return
      }
      o = o.parent
    }
  }
})

// Hover inspector: cursor-following tooltip for any mesh tagged with userData.info
// (see ward.ts / scenarios/*.ts). Tracks the latest pointer position here; the
// actual raycast + tooltip update is throttled in the frame loop below, and
// skipped while a pointer is down so it doesn't fight orbit-drag.
const inspector = createInspector(city.renderer.domElement, city.camera, city.scene)
let pointerIsDown = false
let lastPointerX = 0
let lastPointerY = 0
let hasHoverPointer = false
// Last raycast position — with a still pointer and a still camera the hover
// result can't change, so the 80ms tick skips the raycast entirely.
let lastCastX = -1
let lastCastY = -1
city.renderer.domElement.addEventListener('pointerdown', () => { pointerIsDown = true })
addEventListener('pointerup', () => { pointerIsDown = false })
city.renderer.domElement.addEventListener('pointermove', (ev) => {
  lastPointerX = ev.clientX
  lastPointerY = ev.clientY
  hasHoverPointer = true
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
  resetCity() { for (const p of foundry.stats().procList) foundry.killApp(p.name) },
  injectTap,
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
  { label: '5 · Coming Back', chapter: makeCh5(storyCtx) },
  { label: '6 · The Metal', chapter: makeCh6(storyCtx) },
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
  for (const el of switcherEl.children) {
    el.classList.toggle('disabled', locked)
    // .disabled class only kills pointer-events — keyboard Enter on a focused
    // button bypassed it; real disabled covers both.
    if (el instanceof HTMLButtonElement) el.disabled = locked
  }
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
// (storyActive is declared near the top of the file — refreshHud needs it.)
// True while the story card's ⏸ is showing — freezes the city sim (scenarios,
// wards, packets) so paused time can't outrun the player, which only arms one
// event wait at a time; events firing while paused would be lost forever.
let storyPaused = false
// Story steps hold ≥3.5s for readability but chained sim events (fork→rise→
// resume→data→frame) finish in ~4s of realtime — resolving mid-dwell and
// leaving later steps narrating action that already happened. Slow the sim
// during chapters so it takes roughly as long as the narration.
const STORY_SIM_SCALE = 0.35
let storySpeed: 1 | 2 = 1

// restartChapter() calls the player directly (bypasses startStory/stopStory
// below), so the pending injectTap timer needs its own explicit clear here too.
const restartBtn = mkStoryButton('⏮', () => {
  clearInjectTapTimer()
  player.restartChapter()
})
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
  storySpeed = next
  speedBtn.textContent = `${next}x`
})
const closeBtn = mkStoryButton('✕', () => stopStory())
storyControlsEl.append(restartBtn, playPauseBtn, nextBtn, speedBtn, closeBtn)
storyCardEl.append(storyTitleEl, storyNarrationEl, storyProgressEl, storyControlsEl)

function stopStory(): void {
  clearInjectTapTimer()
  player.stop()
  playAllMode = false
  storyActive = false
  storyPaused = false
  if (!cityManual) {
    launcherPlaza.setIdle(true)
    foundry.setIdle(true)
  }
  wardManager.setIdle(true)
  storyCardEl.classList.remove('open')
  panelEl.style.display = ''
  setSwitcherLocked(false)
}

function startStory(chapter: Chapter): void {
  clearInjectTapTimer()
  storyActive = true
  storyPaused = false
  launcherPlaza.setIdle(false)
  wardManager.setIdle(false)
  // foundry idle too — its 25s cached-reclaim would otherwise fire mid-chapter,
  // pre-consuming ch6's process:killed wait with a kill the narration didn't cause.
  foundry.setIdle(false)
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
}, { minStepMs: 3500 })

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

// ?debug readout: fps/draws/tris, refreshed by the existing 500ms HUD tick.
// Zero cost without the param — debugEl is null and frameCount++ is all that runs.
const debugEl = new URLSearchParams(location.search).has('debug')
  ? document.body.appendChild(Object.assign(document.createElement('div'), {
      style: 'position:fixed;left:8px;bottom:8px;font:11px monospace;color:#57606a;z-index:99;pointer-events:none',
    }))
  : null
let frameCount = 0

city.start((dtMs) => {
  frameCount++
  if (tweenT < tweenDurationMs) {
    tweenT = Math.min(tweenT + dtMs, tweenDurationMs)
    const t = smoothstep(tweenT / tweenDurationMs)
    city.camera.position.lerpVectors(tweenFromPos, tweenToPos, t)
    city.controls.target.lerpVectors(tweenFromTarget, tweenToTarget, t)
  } else if (inOverview && !driftStopped && !storyActive) {
    driftAngle += dtMs * 0.00005
    city.camera.position.set(
      OVERVIEW_TARGET.x + driftRadius * Math.sin(driftAngle),
      OVERVIEW_POS.y,
      OVERVIEW_TARGET.z + driftRadius * Math.cos(driftAngle),
    )
  }
  if (!storyPaused) {
    const simDt = storyActive ? dtMs * STORY_SIM_SCALE * storySpeed : dtMs
    packets.update(simDt)
    for (const s of scenarios) s.update(simDt)
    wardManager.update(simDt)
    hwWiring.syncCores(simDt)
    updateGhosts(simDt)
  }
  player.update(dtMs)
  inspectorAccMs += dtMs
  if (inspectorAccMs >= INSPECTOR_UPDATE_MS) {
    inspectorAccMs -= INSPECTOR_UPDATE_MS
    const cameraMoving = tweenT < tweenDurationMs || (inOverview && !driftStopped && !storyActive)
    if (hasHoverPointer && !pointerIsDown
      && (lastPointerX !== lastCastX || lastPointerY !== lastCastY || cameraMoving)) {
      inspector.update(lastPointerX, lastPointerY)
      lastCastX = lastPointerX
      lastCastY = lastPointerY
    }
  }
  hudAccMs += dtMs
  if (hudAccMs >= HUD_UPDATE_MS) {
    hudAccMs -= HUD_UPDATE_MS
    refreshHud()
    if (debugEl) {
      const info = city.renderer.info.render
      debugEl.textContent =
        `${Math.round(frameCount * 1000 / HUD_UPDATE_MS)}fps · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris`
      frameCount = 0
    }
  }
})

document.querySelector('#intro-close')!.addEventListener('click', () => {
  document.querySelector<HTMLDivElement>('#intro')!.style.display = 'none'
})
