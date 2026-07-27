import * as THREE from 'three'
import { createActivity, launch, rotate, finish, background, foreground, type ActivityState } from '../sim/lifecycle'
import { makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const FLOOR_NAMES = ['onCreate', 'onStart', 'onResume'] as const
const LIT = 0x3fb950
const DIM = 0x21262d
const DEFAULT_NARRATION = 'Launch the activity. Each lifecycle callback lights a floor.'

export function makeLifecycleScenario(): Scenario {
  const group = new THREE.Group()
  let state: ActivityState = createActivity()
  let rebuildAnim = 0 // >0 while collapse/rebuild animation runs, counts down ms

  const buildingGroup = new THREE.Group()
  group.add(buildingGroup)
  const floors: THREE.Mesh[] = FLOOR_NAMES.map((name, i) => {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(5, 1.8, 5),
      new THREE.MeshStandardMaterial({ color: DIM, emissive: 0x000000 }),
    )
    floor.position.y = 1 + i * 2
    buildingGroup.add(floor)
    const lbl = makeLabel(name, 0.6)
    lbl.position.set(4.5, 1 + i * 2, 0)
    buildingGroup.add(lbl)
    return floor
  })

  const viewModel = new THREE.Mesh(
    new THREE.SphereGeometry(0.7),
    new THREE.MeshStandardMaterial({ color: 0xbc8cff, emissive: 0xbc8cff, emissiveIntensity: 0.4 }),
  )
  viewModel.position.y = 7.5
  viewModel.visible = false
  group.add(viewModel)
  const vmLabel = makeLabel('ViewModel', 0.6)
  vmLabel.position.y = 9
  vmLabel.visible = false
  group.add(vmLabel)

  const panel = makePanel('Activity lifecycle = floors of a building')
  panel.addButton('Launch', () => { state = launch(state) })
  panel.addButton('Rotate', () => {
    if (state.phase === 'resumed') rebuildAnim = 1200
    state = rotate(state)
  })
  panel.addButton('Home', () => { state = background(state) })
  panel.addButton('Return', () => { state = foreground(state) })
  panel.addButton('Finish', () => { state = finish(state) })
  panel.setNarration(DEFAULT_NARRATION)

  function litCount(): number {
    switch (state.phase) {
      case 'resumed': return 3
      case 'started': case 'paused': return 2
      case 'created': case 'stopped': return 1
      default: return 0
    }
  }

  let idleEnabled = true
  let idleT = 0
  let idleStep = 0
  const IDLE_STEPS = [launch, rotate, background, foreground, finish]

  return {
    name: 'Lifecycle',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(12, 8, 14),
    cameraTarget: new THREE.Vector3(0, 4, 0),
    update(dtMs) {
      if (idleEnabled) {
        idleT += dtMs
        if (idleT >= 3500) {
          idleT = 0
          if (IDLE_STEPS[idleStep] === rotate && state.phase === 'resumed') rebuildAnim = 1200
          state = IDLE_STEPS[idleStep](state)
          idleStep = (idleStep + 1) % IDLE_STEPS.length
        }
      }
      if (state.log.length > 20) state = { ...state, log: state.log.slice(-20) }
      if (rebuildAnim > 0) {
        rebuildAnim = Math.max(0, rebuildAnim - dtMs)
        // 1200→600ms: collapse to 0; 600→0ms: rebuild to 1
        const t = rebuildAnim > 600 ? (rebuildAnim - 600) / 600 : 1 - rebuildAnim / 600
        buildingGroup.scale.y = t
      } else {
        buildingGroup.scale.y = 1
      }
      const lit = litCount()
      floors.forEach((f, i) => {
        const mat = f.material as THREE.MeshStandardMaterial
        const on = i < lit
        mat.color.setHex(on ? LIT : DIM)
        mat.emissive.setHex(on ? LIT : 0x000000)
        mat.emissiveIntensity = on ? 0.35 : 0
      })
      viewModel.visible = state.viewModelValue !== null
      vmLabel.visible = viewModel.visible
      if (idleEnabled) return
      const tail = state.log.slice(-6).join(' → ')
      if (tail) panel.setNarration(`instance #${state.instanceNumber} · ${tail}${state.viewModelValue ? ' · ViewModel survives on the roof' : ''}`)
    },
    reset() {
      state = createActivity()
      rebuildAnim = 0
      idleT = 0
      idleStep = 0
      panel.setNarration(DEFAULT_NARRATION)
    },
    setIdle(enabled) {
      idleEnabled = enabled
      idleT = 0
    },
  }
}
