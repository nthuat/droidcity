import * as THREE from 'three'
import { APPS, createLauncher, requestLaunch, markRunning, markStopped, type LauncherState } from '../sim/launcher'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

// The launcher's UI lives ON the glass (surfaceFlinger.ts's icon grid) — this
// scenario keeps only the launcher PROCESS: sim state, launch requests, panel.

const IDLE_LAUNCH_MS = 8000
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

  // No building of its own: the launcher's only visible body IS its UI on the
  // glass (icon grid). A separate shed was a redundant third representation.

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
