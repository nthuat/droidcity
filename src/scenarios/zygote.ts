import * as THREE from 'three'
import { createSystem, fork, setPriority, usedMb, type SystemState, type Priority } from '../sim/processes'
import { makeBuilding, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const PRIORITY_COLOR: Record<Priority, number> = {
  foreground: 0x3fb950, visible: 0x388bfd, service: 0xd29922, cached: 0x6e7681,
}
const APP_NAMES = ['chat', 'maps', 'camera', 'music', 'mail', 'bank', 'browser']
const CAPACITY_MB = 1500
const DEFAULT_NARRATION = 'Zygote is a pre-warmed process factory: every app is forked from it, sharing framework memory.'

export function makeZygoteScenario(): Scenario {
  const group = new THREE.Group()
  let state: SystemState = createSystem(CAPACITY_MB)
  let appIndex = 0

  const factory = makeBuilding(8, 4, 6, 0x484f58, 'Zygote')
  factory.position.set(-14, 0, 0)
  group.add(factory)

  const meter = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x3fb950 }),
  )
  meter.position.set(14, 0.5, -6)
  group.add(meter)
  const meterLabel = makeLabel('RAM', 0.7)
  meterLabel.position.set(14, 12, -6)
  group.add(meterLabel)

  const buildings = new Map<number, THREE.Group>() // pid → mesh group
  const dying = new Map<number, THREE.Group>()     // pid → shrinking

  function disposeBuilding(b: THREE.Group): void {
    b.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      } else if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose()
        obj.material.dispose()
      }
    })
  }

  function slotPosition(i: number): THREE.Vector3 {
    return new THREE.Vector3((i % 3) * 6 - 4, 0, Math.floor(i / 3) * 6 - 4)
  }

  const panel = makePanel('Zygote forks apps · LMK evicts by priority')
  panel.addButton('Launch app (300MB)', () => {
    const name = APP_NAMES[appIndex++ % APP_NAMES.length]
    state = fork(state, name, 'foreground', 300)
  })
  panel.addButton('Home (foreground → cached)', () => {
    state = state.procs.reduce(
      (acc, p) => (p.priority === 'foreground' ? setPriority(acc, p.pid, 'cached') : acc),
      state,
    )
  })
  panel.addButton('Launch big game (600MB)', () => { state = fork(state, 'game', 'foreground', 600) })
  panel.setNarration(DEFAULT_NARRATION)

  return {
    name: 'Zygote & LMK',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(2, 18, 24),
    cameraTarget: new THREE.Vector3(0, 2, 0),
    update(dtMs) {
      // spawn/update buildings from state
      state.procs.forEach((p, i) => {
        let b = buildings.get(p.pid)
        if (!b) {
          b = makeBuilding(3, 2 + p.memoryMb / 150, 3, PRIORITY_COLOR[p.priority], p.name)
          b.position.copy(factory.position) // slides out of factory
          buildings.set(p.pid, b)
          group.add(b)
        }
        b.position.lerp(slotPosition(i), Math.min(dtMs / 300, 1))
        const body = b.getObjectByName('body') as THREE.Mesh
        ;(body.material as THREE.MeshStandardMaterial).color.setHex(PRIORITY_COLOR[p.priority])
      })
      // detect kills
      for (const [pid, b] of buildings) {
        if (!state.procs.some(p => p.pid === pid)) {
          buildings.delete(pid)
          dying.set(pid, b)
        }
      }
      for (const [pid, b] of dying) {
        b.scale.y = Math.max(b.scale.y - dtMs / 400, 0)
        if (b.scale.y === 0) {
          disposeBuilding(b)
          group.remove(b)
          dying.delete(pid)
          panel.setNarration('LMK killed a cached process to free memory. Its saved state lets it restore later — this is why onSaveInstanceState matters.')
        }
      }
      const frac = usedMb(state) / CAPACITY_MB
      meter.scale.y = 1 + frac * 10
      meter.position.y = meter.scale.y / 2
      ;(meter.material as THREE.MeshStandardMaterial).color.setHex(frac > 0.8 ? 0xf85149 : 0x3fb950)
    },
    reset() {
      for (const b of [...buildings.values(), ...dying.values()]) {
        disposeBuilding(b)
        group.remove(b)
      }
      buildings.clear()
      dying.clear()
      state = createSystem(CAPACITY_MB)
      appIndex = 0
      panel.setNarration(DEFAULT_NARRATION)
    },
  }
}
