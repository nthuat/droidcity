import * as THREE from 'three'
import { createHeap, allocate, releaseOldest, gc, usedKb, type HeapState } from '../sim/heap'
import { makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const CAPACITY_KB = 2000
const GRID = 6 // 6x6 crate slots

export function makeGcScenario(): Scenario {
  const group = new THREE.Group()
  let state: HeapState = createHeap(CAPACITY_KB)
  let sweepX: number | null = null // x position of sweep plane while animating

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(13, 0.3, 13),
    new THREE.MeshStandardMaterial({ color: 0x30363d }),
  )
  floor.position.y = 0.15
  group.add(floor)
  const floorLabel = makeLabel('App Heap', 0.9)
  floorLabel.position.y = 6
  group.add(floorLabel)

  const sweep = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 3, 13),
    new THREE.MeshBasicMaterial({ color: 0xdb6d28, transparent: true, opacity: 0.6 }),
  )
  sweep.position.y = 1.8
  sweep.visible = false
  group.add(sweep)

  const meter = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x3fb950 }),
  )
  meter.position.set(9, 0.5, 0)
  group.add(meter)

  const crates = new Map<number, THREE.Mesh>()
  const slots = new Map<number, number>() // objectId -> stable slot index

  function disposeCrate(crate: THREE.Mesh): void {
    crate.geometry.dispose()
    ;(crate.material as THREE.Material).dispose()
  }

  function slot(i: number): THREE.Vector3 {
    return new THREE.Vector3((i % GRID) * 2 - 5, 0.8, Math.floor(i / GRID) * 2 - 5)
  }

  function claimSlot(id: number): number {
    const used = new Set(slots.values())
    let i = 0
    while (used.has(i)) i++
    slots.set(id, i)
    return i
  }

  const panel = makePanel('GC = cleanup crew sweeping the heap floor')

  function tryAllocate(sizeKb: number, times = 1): void {
    try {
      for (let t = 0; t < times; t++) {
        const result = allocate(state, sizeKb)
        state = result.state
        if (result.gcRan) {
          sweepX = -7
          panel.setNarration(`Allocation didn't fit — GC #${state.gcCount} ran first, freed ${state.lastFreedKb}KB. On old Android this paused ALL threads; ART keeps pauses sub-ms.`)
        }
      }
    } catch {
      panel.setNarration('OutOfMemoryError! GC ran but everything is still reachable — nothing to free. This is a leak: references held to objects you no longer need.')
    }
  }

  panel.addButton('Allocate 100KB', () => tryAllocate(100))
  panel.addButton('Bitmap burst (10×100KB)', () => tryAllocate(100, 10))
  panel.addButton('Drop refs (oldest 5)', () => { state = releaseOldest(state, 5) })
  panel.addButton('Force GC', () => {
    state = gc(state)
    sweepX = -7
    panel.setNarration(`GC #${state.gcCount} freed ${state.lastFreedKb}KB.`)
  })
  panel.setNarration('Crates = objects. Green = reachable. Grey = garbage (unreachable) — still occupying memory until GC sweeps.')

  return {
    name: 'Garbage Collector',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(10, 12, 14),
    cameraTarget: new THREE.Vector3(0, 1, 0),
    update(dtMs) {
      // sync crates
      const ids = new Set(state.objects.map(o => o.id))
      state.objects.forEach((o) => {
        let crate = crates.get(o.id)
        if (!crate) {
          crate = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 1.4, 1.4),
            new THREE.MeshStandardMaterial({ color: 0x3fb950, transparent: true }),
          )
          crates.set(o.id, crate)
          group.add(crate)
          claimSlot(o.id)
        }
        crate.position.copy(slot(slots.get(o.id)!))
        const mat = crate.material as THREE.MeshStandardMaterial
        mat.color.setHex(o.reachable ? 0x3fb950 : 0x6e7681)
        mat.opacity = o.reachable ? 1 : 0.4
      })
      for (const [id, crate] of crates) {
        if (!ids.has(id)) {
          // swept: only remove once sweep plane has passed its x (or no sweep running)
          if (sweepX === null || crate.position.x < sweepX) {
            group.remove(crate)
            disposeCrate(crate)
            crates.delete(id)
            slots.delete(id)
          }
        }
      }
      // sweep animation
      if (sweepX !== null) {
        sweepX += (dtMs / 1000) * 14
        sweep.visible = true
        sweep.position.x = sweepX
        if (sweepX > 7) {
          sweepX = null
          sweep.visible = false
        }
      }
      const frac = usedKb(state) / CAPACITY_KB
      meter.scale.y = 1 + frac * 8
      meter.position.y = meter.scale.y / 2
      ;(meter.material as THREE.MeshStandardMaterial).color.setHex(frac > 0.8 ? 0xf85149 : 0x3fb950)
    },
    reset() {
      for (const c of crates.values()) {
        group.remove(c)
        disposeCrate(c)
      }
      crates.clear()
      slots.clear()
      state = createHeap(CAPACITY_KB)
      sweepX = null
      sweep.visible = false
    },
  }
}
