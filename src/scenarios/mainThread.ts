import * as THREE from 'three'
import { createLooper, post, advance, type LooperState } from '../sim/looper'
import { makeBuilding, makeCar, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const CAR_SPACING = 1.6
const ROAD_START_Z = 3
const DEFAULT_NARRATION = 'Every touch, draw and callback is a car on this single road. Post work and watch it flow.'

export function makeMainThreadScenario(): Scenario {
  const group = new THREE.Group()
  let state: LooperState = createLooper()

  const building = makeBuilding(5, 9, 5, 0x388bfd, 'UI Thread')
  group.add(building)

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 40),
    new THREE.MeshStandardMaterial({ color: 0x21262d }),
  )
  road.rotation.x = -Math.PI / 2
  road.position.set(0, 0.01, ROAD_START_Z + 20)
  group.add(road)

  const roadLabel = makeLabel('MessageQueue', 0.8)
  roadLabel.position.set(3.5, 1, 8)
  group.add(roadLabel)

  const anrOverlay = new THREE.Mesh(
    new THREE.BoxGeometry(6, 10, 6),
    new THREE.MeshBasicMaterial({ color: 0xf85149, transparent: true, opacity: 0 }),
  )
  anrOverlay.position.y = 5
  group.add(anrOverlay)

  const cars = new THREE.Group()
  group.add(cars)
  const carPool = new Map<number, THREE.Mesh>()

  const panel = makePanel('Main Thread = one road into the building')
  panel.addButton('Tap screen (4ms)', () => { state = post(state, 'tap', 4) })
  panel.addButton('Tap x10', () => {
    for (let i = 0; i < 10; i++) state = post(state, 'tap', 4)
  })
  panel.addButton('Block main thread (8s)', () => { state = post(state, 'diskReadOnMain', 8000) })
  panel.setNarration(DEFAULT_NARRATION)

  function syncCars(): void {
    const wanted = new Set<number>()
    const items = state.current
      ? [state.current.msg, ...state.queue]
      : [...state.queue]
    items.forEach((msg, i) => {
      wanted.add(msg.id)
      let car = carPool.get(msg.id)
      if (!car) {
        car = makeCar(msg.costMs >= 1000 ? 0xf85149 : 0xd29922)
        carPool.set(msg.id, car)
        cars.add(car)
      }
      const isCurrent = state.current?.msg.id === msg.id
      const progress = isCurrent ? state.current!.elapsedMs / msg.costMs : 0
      car.position.z = ROAD_START_Z + i * CAR_SPACING - (isCurrent ? progress * 2 : 0)
      car.position.y = isCurrent ? 0.2 - progress * 0.5 : 0.2
    })
    for (const [id, car] of carPool) {
      if (!wanted.has(id)) {
        car.geometry.dispose()
        ;(car.material as THREE.Material).dispose()
        cars.remove(car)
        carPool.delete(id)
      }
    }
  }

  let flashT = 0
  let idleEnabled = true
  let idleTapT = 0
  let idleDecodeT = 0
  return {
    name: 'Main Thread',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(14, 12, 26),
    cameraTarget: new THREE.Vector3(0, 3, 8),
    update(dtMs) {
      if (idleEnabled) {
        idleTapT += dtMs
        if (idleTapT >= 900) {
          idleTapT = 0
          state = post(state, 'tap', 4)
        }
        idleDecodeT += dtMs
        if (idleDecodeT >= 6000) {
          idleDecodeT = 0
          state = post(state, 'imageDecode', 300)
        }
      }
      state = advance(state, dtMs)
      syncCars()
      flashT += dtMs
      const mat = anrOverlay.material as THREE.MeshBasicMaterial
      mat.opacity = state.anr ? 0.25 + 0.2 * Math.sin(flashT / 120) : 0
      if (idleEnabled) return
      if (state.anr) {
        panel.setNarration('ANR! One message has held the road for 5+ seconds. The system offers the user "Wait or Close". Fix: move this work off the main thread.')
      } else if (state.queue.length > 3) {
        panel.setNarration(`Traffic jam: ${state.queue.length} messages waiting. Frames rendered late = jank.`)
      } else {
        panel.setNarration(DEFAULT_NARRATION)
      }
    },
    reset() {
      state = createLooper()
      syncCars()
    },
    setIdle(enabled) {
      idleEnabled = enabled
      idleTapT = 0
      idleDecodeT = 0
    },
  }
}
