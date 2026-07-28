import * as THREE from 'three'
import { APPS, createLauncher, requestLaunch, markRunning, markStopped, type LauncherState } from '../sim/launcher'
import { makeBuilding } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const PULSE_MS = 300
const RUNNING_COLOR = 0x3fb950
const IDLE_LAUNCH_MS = 8000
const DEFAULT_NARRATION = 'Tap a kiosk to launch its app. Steady green glow = running.'

interface Kiosk {
  readonly app: string
  readonly root: THREE.Group
  readonly body: THREE.Mesh
  pulseT: number
}

export function makeLauncherPlazaScenario(bus: Bus): Scenario & {
  clickKiosk(app: string): void
  kioskMeshes(): THREE.Object3D[]
  resetApps(): void
  stats(): { running: number }
} {
  const group = new THREE.Group()
  let state: LauncherState = createLauncher()
  let rotationIdx = 0
  let idleEnabled = true
  let idleT = 0

  const kiosks: Kiosk[] = APPS.map((app, i) => {
    const root = makeBuilding(3, 3, 3, 0x30363d, app)
    root.position.set((i % 2) * 6 - 3, 0, Math.floor(i / 2) * 6 - 3)
    group.add(root)
    const body = root.getObjectByName('body') as THREE.Mesh
    body.userData.app = app
    return { app, root, body, pulseT: 0 }
  })

  function paint(): void {
    for (const k of kiosks) {
      const mat = k.body.material as THREE.MeshStandardMaterial
      const running = state.running.includes(k.app)
      mat.emissive.setHex(running ? RUNNING_COLOR : 0x000000)
      mat.emissiveIntensity = running ? 0.5 : 0
      const bounce = k.pulseT > 0 ? 1 + 0.25 * Math.sin((k.pulseT / PULSE_MS) * Math.PI) : 1
      k.root.scale.setScalar(bounce)
    }
  }
  paint()

  function clickKiosk(app: string): void {
    const result = requestLaunch(state, app)
    if (!result.accepted) return
    state = result.state
    bus.emit('app:launchRequested', { app })
    const k = kiosks.find(k => k.app === app)
    if (k) k.pulseT = PULSE_MS
  }

  bus.on('activity:resumed', ({ app }) => { state = markRunning(state, app) })
  bus.on('process:killed', ({ app }) => { state = markStopped(state, app) })

  function resetApps(): void {
    state = createLauncher()
    for (const k of kiosks) k.pulseT = 0
    rotationIdx = 0
    paint()
    panel.setNarration(DEFAULT_NARRATION)
  }

  const panel = makePanel('Launcher Plaza — tap a kiosk to launch')
  for (const app of APPS) {
    panel.addButton(`Open ${app}`, () => clickKiosk(app))
  }
  panel.addButton('Reset apps', resetApps)
  panel.setNarration(DEFAULT_NARRATION)

  return {
    name: 'Launcher',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(0, 8, 16),
    cameraTarget: new THREE.Vector3(0, 1, 0),
    update(dtMs) {
      if (idleEnabled) {
        idleT += dtMs
        if (idleT >= IDLE_LAUNCH_MS) {
          idleT = 0
          clickKiosk(APPS[rotationIdx])
          rotationIdx = (rotationIdx + 1) % APPS.length
        }
      }
      for (const k of kiosks) {
        if (k.pulseT > 0) k.pulseT = Math.max(0, k.pulseT - dtMs)
      }
      paint()
    },
    reset() {
      resetApps()
      idleT = 0
    },
    setIdle(enabled) {
      idleEnabled = enabled
      idleT = 0
    },
    clickKiosk,
    kioskMeshes() { return kiosks.map(k => k.body) },
    resetApps,
    stats() {
      return { running: state.running.length }
    },
  }
}
