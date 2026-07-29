import * as THREE from 'three'
import { APPS } from '../sim/launcher'
import { makeBuilding, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const SF_VISUAL_MS = 200 // SF_MS=5 sim-ms scaled ×40
const FLASH_MS = 350
const DARK = 0x21262d
const GREEN = 0x3fb950
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

export function makeSurfaceFlingerScenario(bus: Bus): Scenario & { stats(): { composited: number; dropped: number } } {
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

  // Display wall: mounted at the zone's east edge (local x 17 = world x 82, the
  // plan's "display wall at x 82 facing -x"), bigger than the old freestanding board.
  // Local y 0.3 is the plate top here (anchor y 0 matches the flat plate offset).
  const WALL_X = 17
  const WALL_BASE_Y = 0.3
  const WALL_H = 5
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, WALL_H, 10),
    new THREE.MeshStandardMaterial({ color: 0x2b3440 }), // stays dark — it's a screen
  )
  wall.position.set(WALL_X, WALL_BASE_Y + WALL_H / 2, 0)
  wall.userData.info = {
    title: 'Display',
    note: 'One app is on screen at a time — the bright tile. Faint tiles are alive behind it, rendering nothing. Multi-window would light two; not modeled yet. HWC composites overlays in hardware when possible.',
  }
  group.add(wall)
  const wallLabel = makeLabel('Display', 0.7)
  wallLabel.position.set(WALL_X, WALL_BASE_Y + WALL_H + 0.7, 0)
  group.add(wallLabel)

  const tileMeshes: THREE.Mesh[] = APPS.map((app, i) => {
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 2.2, 2.2),
      new THREE.MeshStandardMaterial({ color: DARK }),
    )
    tile.position.set(WALL_X - 0.5, WALL_BASE_Y + WALL_H / 2, (i - 1.5) * 2.4)
    tile.userData.info = TILE_INFO
    group.add(tile)
    const lbl = makeLabel(app, 0.4)
    lbl.position.set(WALL_X - 0.5, WALL_BASE_Y + WALL_H / 2 + 1.4, (i - 1.5) * 2.4)
    group.add(lbl)
    return tile
  })

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
  }
}
