import * as THREE from 'three'
import { makeBuilding } from '../scene/builders'
import { makeAntenna } from '../scene/props'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const LIT = 0x484f58
const DIM = 0x21262d
const PULSE_MS = 300
const DEFAULT_NARRATION = 'system_server hosts AMS (Activity Manager), WMS (Window Manager) and PMS (Package Manager). Every app talks to them over Binder IPC — like citizens filing paperwork at city hall.'

export function makeCityHallScenario(bus: Bus): Scenario {
  const group = new THREE.Group()

  const hall = makeBuilding(14, 6, 8, LIT, 'system_server')
  hall.userData.info = {
    title: 'system_server',
    note: 'ActivityManager, WindowManager, PackageManager. All Binder calls route here.',
  }
  group.add(hall)

  const wingNames = ['AMS', 'WMS', 'PMS']
  const wings = wingNames.map((name, i) => {
    const w = makeBuilding(3, 3, 3, LIT, name)
    w.position.set((i - 1) * 6, 0, 7)
    group.add(w)
    return w
  })
  const buildings = [hall, ...wings]

  // Static dressing: antenna on the hall roof + 4 pillar columns at the pit floor's
  // corners. Local y 0 is the pit floor here (anchor y -2 already matches it).
  const antenna = makeAntenna()
  antenna.position.set(0, 6, -3)
  group.add(antenna)

  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.6 })
  const pillarGeo = new THREE.CylinderGeometry(0.6, 0.6, 4, 12)
  const pillarSpots: Array<[number, number]> = [[-40, -10], [40, -10], [-40, 10], [40, 10]]
  for (const [x, z] of pillarSpots) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat)
    pillar.position.set(x, 2, z)
    group.add(pillar)
  }

  // Dark until boot:complete while a replay is in progress; relights one stage at a time.
  let stagesSeen = 0
  let litFrac = 1 // starts fully lit — default city state is already "booted"
  let pulseT = 0

  function paint(): void {
    const emissive = litFrac > 0 ? LIT : 0
    const intensity = 0.15 * litFrac + (pulseT > 0 ? 0.5 * (pulseT / PULSE_MS) : 0)
    for (const b of buildings) {
      const body = b.getObjectByName('body') as THREE.Mesh
      const mat = body.material as THREE.MeshStandardMaterial
      mat.color.setHex(litFrac > 0.99 || pulseT > 0 ? LIT : DIM)
      mat.emissive.setHex(emissive)
      mat.emissiveIntensity = intensity
    }
  }
  paint()

  bus.on('boot:stageDone', () => {
    if (stagesSeen === 0) litFrac = 0 // fresh replay just started
    stagesSeen += 1
    litFrac = Math.min(stagesSeen / 4, 1)
    paint()
  })
  bus.on('boot:complete', () => {
    stagesSeen = 0
    litFrac = 1
    paint()
  })
  bus.on('activity:resumed', () => {
    pulseT = PULSE_MS
  })

  const panel = makePanel('City Hall — system_server')
  panel.setNarration(DEFAULT_NARRATION)

  return {
    name: 'City Hall',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(0, 9, 18),
    cameraTarget: new THREE.Vector3(0, 3, 0),
    update(dtMs) {
      if (pulseT > 0) {
        pulseT = Math.max(0, pulseT - dtMs)
        paint()
      }
    },
    reset() {
      stagesSeen = 0
      litFrac = 1
      pulseT = 0
      paint()
      panel.setNarration(DEFAULT_NARRATION)
    },
    setIdle() {
      // visual only — no ambient behavior beyond the bus-driven boot/pulse reactions
    },
  }
}
