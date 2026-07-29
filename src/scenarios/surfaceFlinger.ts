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
  navMeshes(): { back: THREE.Mesh; home: THREE.Mesh; recents: THREE.Mesh }
  recentsCardMeshes(): THREE.Mesh[]
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

  // Compositor's view: one BufferQueue tile per app on the panel's REAR face —
  // where frames physically arrive (the SF road ends behind the screen). On the
  // front they read as stray UI blocks; the front is the phone's face only.
  const tileMeshes: THREE.Mesh[] = APPS.map((app, i) => {
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: DARK }),
    )
    tile.position.set(0.45, WALL_BASE_Y + WALL_H - 0.65, (i - 1.5) * 1.2)
    tile.userData.info = TILE_INFO
    tile.userData.tileApp = app
    wallGroup.add(tile)
    return tile
  })

  // Screen backdrop: the lit LCD area inside the bezel, with a status bar strip
  // on top and a nav strip at the bottom — the phone's face.
  const screenPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 4.0, 8.8),
    new THREE.MeshStandardMaterial({ color: 0x10161d, roughness: 0.4 }),
  )
  screenPanel.position.set(-0.26, 2.65, 0)
  wallGroup.add(screenPanel)
  const statusBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.3, 8.8),
    new THREE.MeshStandardMaterial({ color: 0x2a3542, roughness: 0.4 }),
  )
  statusBar.position.set(-0.3, 4.5, 0)
  statusBar.userData.info = { title: 'Status bar', note: 'SystemUI — also just a process. Not modeled beyond this strip.' }
  wallGroup.add(statusBar)
  const navStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.55, 8.8),
    new THREE.MeshStandardMaterial({ color: 0x1a222c, roughness: 0.4 }),
  )
  navStrip.position.set(-0.3, 0.35, 0)
  wallGroup.add(navStrip)

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
      new THREE.BoxGeometry(0.2, 1.1, 1.1),
      new THREE.MeshStandardMaterial({ color: APP_COLORS[app] ?? APP_COLOR_FALLBACK, roughness: 0.5 }),
    )
    const row = Math.floor(i / 2) // 0 top, 1 bottom
    const col = i % 2
    // Rows leave room for a small name label UNDER each icon (real launcher
    // layout) — labels above overlapped the row on top of them.
    icon.position.set(-0.38, 3.5 - row * 1.7, col === 0 ? -1.6 : 1.6)
    icon.userData.app = app
    icon.userData.info = ICON_INFO
    homeGroup.add(icon)
    iconMeshes.push(icon)
    const lbl = makeLabel(app, 0.26)
    lbl.position.set(-0.38, icon.position.y - 0.78, icon.position.z)
    homeGroup.add(lbl)
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: GREEN, emissive: GREEN, emissiveIntensity: 1 }),
    )
    lamp.position.set(-0.46, icon.position.y + 0.42, icon.position.z + 0.42)
    lamp.visible = false
    homeGroup.add(lamp)
    iconLamps.push(lamp)
  })

  const appPanelMat = new THREE.MeshStandardMaterial({ color: APP_COLOR_FALLBACK, roughness: 0.5 })
  const appPanel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.7, 8.6), appPanelMat)
  appPanel.position.set(-0.38, 2.5, 0)
  appPanel.userData.info = {
    title: 'App content',
    note: 'The foreground app\'s UI — rendered by its ward, composited by SurfaceFlinger, lit on this glass.',
  }
  appPanel.visible = false
  wallGroup.add(appPanel)
  const appPanelLabels: THREE.Sprite[] = APPS.map((app) => {
    const lbl = makeLabel(app, 0.6)
    lbl.position.set(-0.55, 2.5, 0)
    lbl.visible = false
    wallGroup.add(lbl)
    return lbl
  })

  // Android 3-button nav on the glass: Back ◁ · Home ○ · Recents ▢
  const navMat = new THREE.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.4 })
  const backBtn = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 3), navMat)
  backBtn.position.set(-0.4, 0.35, -1.5)
  backBtn.rotation.x = Math.PI / 2 // point the triangle sideways, Android's Back glyph
  backBtn.userData.info = {
    title: 'Back',
    note: 'Pops the top of the foreground app\'s back stack; at the root it finishes the Activity — process stays cached.',
  }
  wallGroup.add(backBtn)
  const homePill = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 16), navMat)
  homePill.rotation.z = Math.PI / 2 // disc face toward the viewer
  homePill.position.set(-0.4, 0.35, 0)
  homePill.userData.info = {
    title: 'Home',
    note: 'Backgrounds the foreground app — the launcher\'s icon grid returns to the glass.',
  }
  wallGroup.add(homePill)
  const recentsBtn = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.36, 0.36), navMat)
  recentsBtn.position.set(-0.4, 0.35, 1.5)
  recentsBtn.userData.info = {
    title: 'Recents',
    note: 'Overview of every live app process. Tap a card to bring it to the front — a hot start.',
  }
  wallGroup.add(recentsBtn)

  // Recents overlay: one card per app, shown only while alive. Tap = hot start.
  const recentsGroup = new THREE.Group()
  recentsGroup.visible = false
  wallGroup.add(recentsGroup)
  const recentsCards: THREE.Mesh[] = APPS.map((app, i) => {
    const card = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 2.4, 1.7),
      new THREE.MeshStandardMaterial({ color: APP_COLORS[app] ?? APP_COLOR_FALLBACK, roughness: 0.5 }),
    )
    card.position.set(-0.38, 2.4, (i - 1.5) * 2.1)
    card.userData.app = app
    card.userData.info = {
      title: `Recents: ${app}`,
      note: 'A live process\'s task card. Tap to bring it to the foreground — hot start, no fork.',
    }
    recentsGroup.add(card)
    const lbl = makeLabel(app, 0.3)
    lbl.position.set(-0.38, 3.85, card.position.z)
    recentsGroup.add(lbl)
    card.userData.cardLabel = lbl
    return card
  })

  let screenState: ScreenState = { mode: 'home', app: null }
  function paintScreen(): void {
    homeGroup.visible = screenState.mode === 'home'
    appPanel.visible = screenState.mode === 'app'
    recentsGroup.visible = screenState.mode === 'recents'
    appPanelLabels.forEach((lbl, i) => { lbl.visible = screenState.mode === 'app' && APPS[i] === screenState.app })
    if (screenState.mode === 'app' && screenState.app) {
      appPanelMat.color.setHex(APP_COLORS[screenState.app] ?? APP_COLOR_FALLBACK)
      appPanelMat.emissive.setHex(APP_COLORS[screenState.app] ?? APP_COLOR_FALLBACK)
      appPanelMat.emissiveIntensity = 0.35
    }
    // Alive lamps mirror the compositor's tile knowledge: any non-dark tile is a
    // live process — the launcher shows which apps are already running.
    iconLamps.forEach((lamp, i) => { lamp.visible = tiles[i].state !== 'dark' })
    // Recents shows only live processes — a dead app has no task card here
    // (simplification: real recents also lists saved tasks of dead processes).
    recentsCards.forEach((card, i) => {
      const alive = tiles[i].state !== 'dark'
      card.visible = alive
      const lbl = card.userData.cardLabel as THREE.Sprite
      lbl.visible = recentsGroup.visible && alive
    })
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
    navMeshes() { return { back: backBtn, home: homePill, recents: recentsBtn } },
    recentsCardMeshes() { return recentsCards },
    setScreen(state) {
      screenState = state
      paintScreen()
    },
  }
}
