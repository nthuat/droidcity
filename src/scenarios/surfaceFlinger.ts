import * as THREE from 'three'
import { APPS } from '../sim/launcher'
import { APP_COLORS, APP_COLOR_FALLBACK } from '../scene/appColors'
import type { ScreenState } from '../sim/screen'
import { makeBuilding, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const SF_VISUAL_MS = 200 // SF_MS=5 sim-ms scaled ×40
const FLASH_MS = 350
const DARK = 0x21262d
const GREEN = 0x3ddc84 // Android brand green
const FAINT_GREEN = 0x1b3524
const RED = 0xf85149
const DEFAULT_NARRATION = 'SurfaceFlinger composites every submitted frame onto the display, one at a time.'

interface QueueEntry { readonly app: string; readonly dropped: boolean }
// Real Android: one foreground app renders; everything else behind it is alive
// but draws nothing. 'bright' = the single most-recent activity:resumed app,
// 'faint' = alive but not on screen, 'dark' = killed or never started.
type TileVisualState = 'bright' | 'faint' | 'dark'
interface TileState { state: TileVisualState; flashT: number; flashRed: boolean }
const BRIGHT_INTENSITY = 0.45
const FAINT_INTENSITY = 0.04

const TILE_INFO = {
  title: 'App layer',
  note: 'One BufferQueue per app. Bright = on screen; faint = alive behind it, drawing nothing.',
}

export function makeSurfaceFlingerScenario(bus: Bus): Scenario & {
  stats(): { composited: number; dropped: number }
  screenIconMeshes(): THREE.Mesh[]
  homeButtonMesh(): THREE.Mesh
  setScreen(state: ScreenState): void
} {
  const group = new THREE.Group()
  group.userData.info = {
    title: 'SurfaceFlinger district',
    note: 'Frames queue here as buffers before compositing.',
  }
  let totalComposited = 0
  let totalDropped = 0

  const compositor = makeBuilding(5, 6, 5, 0x8a99a5, 'SurfaceFlinger')
  compositor.position.y = 0.3
  compositor.userData.info = {
    title: 'SurfaceFlinger',
    note: 'One compositor for every ward; tiles = apps on screen. Frames arrive through BufferQueues — triple buffering absorbs hiccups. Real SF latches at every vsync (60/s while anything animates); here frames are event-driven, so the counter only ticks when an app actually draws.',
  }
  group.add(compositor)

  // Display wall: the phone's screen — front and center at the board's south rim
  // (world (0, 0, 58), local offset from this group's anchor (60, 0, -35)),
  // facing the default camera: you look at the city, the screen looks back.
  // Built inside this scenario because SF's state machine drives the tiles;
  // routes.ts's surfaceflinger->displaywall road carries the compositor->panel leg.
  const WALL_BASE_Y = 0
  const WALL_H = 5
  const wallGroup = new THREE.Group()
  // World (0, 0, 58): group anchor is (60, 0, -35) after the core-band move.
  wallGroup.position.set(-60, 0, 93)
  wallGroup.rotation.y = Math.PI / 2 // screen normal (local -x) -> world +z, toward the viewer
  wallGroup.rotation.z = -0.16 // lean the top back ~9° toward the elevated overview camera
  // 2x: at 5x10 the phone screen read as a distant sliver from overview — it is
  // the one thing the whole board exists to light, so it gets billboard scale.
  wallGroup.scale.setScalar(2)
  group.add(wallGroup)
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, WALL_H, 10),
    new THREE.MeshStandardMaterial({ color: 0x2b3440 }), // stays dark — it's a screen
  )
  wall.position.set(0, WALL_BASE_Y + WALL_H / 2, 0)
  wall.userData.info = {
    title: 'Display',
    note: 'One app is on screen at a time — the bright tile. Faint tiles are alive behind it, rendering nothing. Multi-window would light two; not modeled yet. HWC composites overlays in hardware when possible.',
  }
  wallGroup.add(wall)
  const wallLabel = makeLabel('Display', 0.7)
  wallLabel.position.set(0, WALL_BASE_Y + WALL_H + 0.7, 0)
  wallGroup.add(wallLabel)

  // Compositor's view: one small BufferQueue tile per app, in a row across the
  // wall's top edge (the phone-UI screen face below is the panel's view).
  const tileMeshes: THREE.Mesh[] = APPS.map((app, i) => {
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: DARK }),
    )
    tile.position.set(-0.45, WALL_BASE_Y + WALL_H - 0.65, (i - 1.5) * 1.2)
    tile.userData.info = TILE_INFO
    tile.userData.tileApp = app
    wallGroup.add(tile)
    return tile
  })

  // ---- The phone UI on the glass ----
  // Home mode: the launcher's icon grid (2x2, brand colors, green lamp = alive).
  // App mode: the foreground app's content fills the screen. Nav pill = Home.
  const ICON_INFO = {
    title: 'App icon',
    note: 'The home screen is just the launcher app\'s UI, drawn on this glass. Tap to launch.',
  }
  const homeGroup = new THREE.Group()
  wallGroup.add(homeGroup)
  const iconMeshes: THREE.Mesh[] = []
  const iconLamps: THREE.Mesh[] = []
  APPS.forEach((app, i) => {
    const icon = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 1.3, 1.3),
      new THREE.MeshStandardMaterial({ color: APP_COLORS[app] ?? APP_COLOR_FALLBACK, roughness: 0.5 }),
    )
    const row = Math.floor(i / 2) // 0 top, 1 bottom
    const col = i % 2
    icon.position.set(-0.42, 2.75 - row * 1.6, col === 0 ? -1.1 : 1.1)
    icon.userData.app = app
    icon.userData.info = ICON_INFO
    homeGroup.add(icon)
    iconMeshes.push(icon)
    const lbl = makeLabel(app, 0.32)
    lbl.position.set(-0.42, icon.position.y + 0.95, icon.position.z)
    homeGroup.add(lbl)
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 1 }),
    )
    lamp.position.set(-0.5, icon.position.y + 0.55, icon.position.z + 0.55)
    lamp.visible = false
    homeGroup.add(lamp)
    iconLamps.push(lamp)
  })

  const appPanelMat = new THREE.MeshStandardMaterial({ color: APP_COLOR_FALLBACK, roughness: 0.5 })
  const appPanel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 8.6), appPanelMat)
  appPanel.position.set(-0.42, 2.15, 0)
  appPanel.userData.info = {
    title: 'App content',
    note: 'The foreground app\'s UI — rendered by its ward, composited by SurfaceFlinger, lit on this glass.',
  }
  appPanel.visible = false
  wallGroup.add(appPanel)
  const appPanelLabels: THREE.Sprite[] = APPS.map((app) => {
    const lbl = makeLabel(app, 0.6)
    lbl.position.set(-0.5, 2.15, 0)
    lbl.visible = false
    wallGroup.add(lbl)
    return lbl
  })

  const homePill = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.28, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.4 }),
  )
  homePill.position.set(-0.42, 0.42, 0)
  homePill.userData.info = {
    title: 'Home',
    note: 'Backgrounds the foreground app — the launcher\'s icon grid returns to the glass.',
  }
  wallGroup.add(homePill)

  let screenState: ScreenState = { mode: 'home', app: null }
  function paintScreen(): void {
    homeGroup.visible = screenState.mode === 'home'
    appPanel.visible = screenState.mode === 'app'
    appPanelLabels.forEach((lbl, i) => { lbl.visible = screenState.mode === 'app' && APPS[i] === screenState.app })
    if (screenState.mode === 'app' && screenState.app) {
      appPanelMat.color.setHex(APP_COLORS[screenState.app] ?? APP_COLOR_FALLBACK)
      appPanelMat.emissive.setHex(APP_COLORS[screenState.app] ?? APP_COLOR_FALLBACK)
      appPanelMat.emissiveIntensity = 0.35
    }
    // Alive lamps mirror the compositor's tile knowledge: any non-dark tile is a
    // live process — the launcher shows which apps are already running.
    iconLamps.forEach((lamp, i) => { lamp.visible = tiles[i].state !== 'dark' })
  }

  // Frame crates stacked near the conveyor mouth (west side, where ward packets
  // arrive at this zone's anchor).
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.7 })
  const crateGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4)
  const cratePositions: Array<[number, number, number]> = [
    [-7, 1.0, -6], [-7, 2.4, -6], [-5.3, 1.0, -6.6],
  ]
  for (const [x, y, z] of cratePositions) {
    const crate = new THREE.Mesh(crateGeo, crateMat)
    crate.position.set(x, y, z)
    group.add(crate)
  }

  const tiles: TileState[] = APPS.map(() => ({ state: 'dark', flashT: 0, flashRed: false }))
  // The single app currently holding the bright tile (the real foreground app).
  let brightApp: string | null = null

  function setFaint(app: string): void {
    const i = APPS.indexOf(app)
    if (i < 0 || tiles[i].state === 'dark') return
    tiles[i].state = 'faint'
  }

  let queue: QueueEntry[] = []
  let busyMs = 0

  bus.on('frame:submitted', ({ app, dropped }) => {
    if (queue.length >= 8) return // generous backlog cap — SF still drains one at a time
    queue = [...queue, { app, dropped }]
  })
  bus.on('activity:resumed', ({ app }) => {
    if (brightApp && brightApp !== app) setFaint(brightApp)
    const i = APPS.indexOf(app)
    if (i >= 0) tiles[i].state = 'bright'
    brightApp = app
  })
  bus.on('activity:backgrounded', ({ app }) => {
    setFaint(app)
    if (brightApp === app) brightApp = null
  })
  bus.on('process:killed', ({ app }) => {
    const i = APPS.indexOf(app)
    if (i < 0) return
    tiles[i].state = 'dark'
    tiles[i].flashT = 0
    if (brightApp === app) brightApp = null
  })

  const panel = makePanel('SurfaceFlinger — the compositor that hands frames to the display')
  panel.setNarration(DEFAULT_NARRATION)

  function paint(): void {
    const compositorBody = compositor.getObjectByName('body') as THREE.Mesh
    const compositorMat = compositorBody.material as THREE.MeshStandardMaterial
    compositorMat.emissive.setHex(busyMs > 0 ? 0x388bfd : 0x000000)
    compositorMat.emissiveIntensity = busyMs > 0 ? 0.5 : 0
    tiles.forEach((t, i) => {
      const mat = tileMeshes[i].material as THREE.MeshStandardMaterial
      const flashFrac = t.flashT > 0 ? t.flashT / FLASH_MS : 0
      if (flashFrac > 0) {
        // Composite flash overlays whatever's underneath, same as before.
        const color = t.flashRed ? RED : GREEN
        mat.color.setHex(color)
        mat.emissive.setHex(color)
        mat.emissiveIntensity = flashFrac
        return
      }
      if (t.state === 'dark') {
        mat.color.setHex(DARK)
        mat.emissive.setHex(0x000000)
        mat.emissiveIntensity = 0
        return
      }
      // Bright vs faint must differ in BASE color too — under scene lighting the
      // diffuse green dominates, so an emissive-only delta made every running
      // app's tile look identically lit ("3 apps on screen at once").
      const bright = t.state === 'bright'
      mat.color.setHex(bright ? GREEN : FAINT_GREEN)
      mat.emissive.setHex(GREEN)
      mat.emissiveIntensity = bright ? BRIGHT_INTENSITY : FAINT_INTENSITY
    })
    paintScreen()
  }
  paint()

  return {
    name: 'SurfaceFlinger',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(0, 9, 16),
    cameraTarget: new THREE.Vector3(0, 3, 0),
    update(dtMs) {
      for (const t of tiles) {
        if (t.flashT > 0) t.flashT = Math.max(0, t.flashT - dtMs)
      }
      if (busyMs > 0) {
        busyMs = Math.max(0, busyMs - dtMs)
        if (busyMs === 0 && queue.length > 0) {
          const head = queue[0]
          queue = queue.slice(1)
          bus.emit('frame:composited', { app: head.app })
          totalComposited += 1
          if (head.dropped) totalDropped += 1
          const i = APPS.indexOf(head.app)
          if (i >= 0) {
            tiles[i].flashT = FLASH_MS
            tiles[i].flashRed = head.dropped
          }
          panel.setNarration(`${head.app} composited${head.dropped ? ' — frame had been dropped upstream' : ''}.`)
        }
      } else if (queue.length > 0) {
        busyMs = SF_VISUAL_MS
      }
      paint()
    },
    setIdle() {
      // no ambient behavior — composited frames come only from frame:submitted events
    },
    stats() {
      return { composited: totalComposited, dropped: totalDropped }
    },
    screenIconMeshes() { return iconMeshes },
    homeButtonMesh() { return homePill },
    setScreen(state) {
      screenState = state
      paintScreen()
    },
  }
}
