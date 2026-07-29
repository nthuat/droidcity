import * as THREE from 'three'
import { APPS, createLauncher, requestLaunch, markRunning, markStopped, type LauncherState } from '../sim/launcher'
import { makeBuilding } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

// The launcher's UI now lives ON the glass (surfaceFlinger.ts's icon grid) —
// this scenario keeps the launcher PROCESS: the sim state, launch requests, and
// a small shed by the display. Its icon grid is what the screen draws at home.

const IDLE_LAUNCH_MS = 8000
const RUNNING_COLOR = 0x3ddc84
const DEFAULT_NARRATION = 'The launcher is just an app — its icon grid is drawn on the glass. Tap an icon on the display (or the buttons here) to launch.'

export function makeLauncherPlazaScenario(bus: Bus): Scenario & {
  clickKiosk(app: string): void
  kioskMeshes(): THREE.Object3D[]
  resetApps(): void
  stats(): { running: number }
} {
  const group = new THREE.Group()
  group.userData.info = {
    title: 'Launcher process',
    note: 'Just an app with a privileged view of PMS. Its UI is the icon grid on the glass next door.',
  }
  let state: LauncherState = createLauncher()
  let rotationIdx = 0
  let idleEnabled = true
  let idleT = 0

  // The process shed: the launcher as a resident, not a plaza. Lamp = alive
  // (it effectively always is — oom_adj 600, killed only under extreme pressure).
  const shed = makeBuilding(4, 2.5, 4, 0xa5c48a, 'launcher')
  group.add(shed)
  const shedBody = shed.getObjectByName('body') as THREE.Mesh
  shedBody.userData.info = {
    title: 'Launcher process',
    note: 'The home screen app. When you tap an icon on the glass, THIS process files the Intent with City Hall — the launcher never starts apps itself.',
  }
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 12, 8),
    new THREE.MeshStandardMaterial({ color: RUNNING_COLOR, emissive: RUNNING_COLOR, emissiveIntensity: 0.9 }),
  )
  lamp.position.y = 3.1
  shed.add(lamp)

  function clickKiosk(app: string): void {
    const result = requestLaunch(state, app)
    if (!result.accepted) {
      // Rejected because it's already running: don't drop the tap — this is a
      // brought-to-front request. Sim stays untouched (launcher only tracks
      // running/launching); WardManager owns activity phase and is the only
      // party that can tell warm from hot, so the event carries no start type
      // — manager decides and reports the real type via onStartType.
      if (state.running.includes(app)) {
        bus.emit('app:broughtToFront', { app })
      }
      return
    }
    state = result.state
    bus.emit('app:launchRequested', { app })
  }

  bus.on('activity:resumed', ({ app }) => { state = markRunning(state, app) })
  bus.on('process:killed', ({ app }) => { state = markStopped(state, app) })

  function resetApps(): void {
    state = createLauncher()
    rotationIdx = 0
    panel.setNarration(DEFAULT_NARRATION)
  }

  const panel = makePanel('Launcher — the home screen app')
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
    },
    setIdle(enabled) {
      idleEnabled = enabled
      idleT = 0
    },
    clickKiosk,
    kioskMeshes() { return [] },
    resetApps,
    stats() {
      return { running: state.running.length }
    },
  }
}
