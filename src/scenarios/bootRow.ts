import * as THREE from 'three'
import { createBoot, advanceBoot, BOOT_STAGES, type BootState } from '../sim/boot'
import { makeBuilding } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const LIT = 0x3fb950
const DIM = 0x21262d
const STATION_GAP = 7
// Default city state: already booted (matches the rest of the unified city being "on").
// advanceBoot's 10000ms exceeds the 4400ms total, so this is a one-shot pure computation
// with no events fired — replayBoot() is what drives real-time stage events.
const PRE_BOOTED = advanceBoot(createBoot(), 10000)
const DEFAULT_NARRATION = 'Boot sequence: bootloader → kernel → init → system_server. Each station lights when its stage completes.'

export function makeBootRowScenario(bus: Bus, onReplayStart: () => void): Scenario & { replayBoot(): void } {
  const group = new THREE.Group()
  let state: BootState = PRE_BOOTED
  let replaying = false

  const stations = BOOT_STAGES.map((stage, i) => {
    const b = makeBuilding(4, 3, 4, LIT, stage.name)
    b.position.set((i - 1.5) * STATION_GAP, 0, 0)
    group.add(b)
    return b
  })

  function paint(): void {
    stations.forEach((b, i) => {
      const body = b.getObjectByName('body') as THREE.Mesh
      const on = state.completed.includes(BOOT_STAGES[i].name)
      ;(body.material as THREE.MeshStandardMaterial).color.setHex(on ? LIT : DIM)
    })
  }
  paint()

  const panel = makePanel('Boot Row — bootloader → kernel → init → system_server')

  function replayBoot(): void {
    onReplayStart() // dims the rest of the city while boot runs
    state = createBoot()
    replaying = true
    paint()
    panel.setNarration('Booting…')
  }

  panel.addButton('Replay boot', replayBoot)
  panel.setNarration(DEFAULT_NARRATION)

  return {
    name: 'Boot',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(0, 8, 20),
    cameraTarget: new THREE.Vector3(0, 2, 0),
    update(dtMs) {
      if (!replaying) return
      const prevCompleted = state.completed
      state = advanceBoot(state, dtMs)
      for (const name of state.completed) {
        if (!prevCompleted.includes(name)) bus.emit('boot:stageDone', { stage: name })
      }
      paint()
      if (state.done) {
        replaying = false
        bus.emit('boot:complete', {})
        panel.setNarration('Boot complete — system_server is up, city hall lights on.')
      }
    },
    reset() {
      state = PRE_BOOTED
      replaying = false
      paint()
      panel.setNarration(DEFAULT_NARRATION)
    },
    setIdle() {
      // no ambient behavior — boot only runs on demand via replayBoot()
    },
    replayBoot,
  }
}
