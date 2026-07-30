import * as THREE from 'three'
import { makeBuilding } from '../scene/builders'
import { makeAntenna } from '../scene/props'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const LIT = 0x8a99a5
const DIM = 0x21262d
const PULSE_MS = 300
const DEFAULT_NARRATION =
  'system_server hosts AMS (Activity Manager), WMS (Window Manager) and PMS (Package Manager). Every app talks to them over Binder IPC — like citizens filing paperwork at city hall.\n'
  + 'AMS writes every process\'s oom_adj score — lmkd kills from the bottom up:\n'
  + '  -900 system_server (untouchable)\n'
  + '     0 foreground — the app on screen\n'
  + '   100 visible — e.g. bound to a foreground client\n'
  + '   500 running a service\n'
  + '   600 the launcher (going home must be instant)\n'
  + '   700 the previous app (back-switch is common)\n'
  + '   900+ cached — kill fodder, oldest first'

export function makeCityHallScenario(bus: Bus): Scenario {
  const group = new THREE.Group()
  group.userData.info = {
    title: 'system_server',
    note: 'One process, ~100 services — the operating system\'s civil service.',
  }

  const hall = makeBuilding(14, 6, 8, LIT, 'system_server')
  hall.userData.info = {
    title: 'system_server',
    note: 'ActivityManager, WindowManager, PackageManager. All Binder calls route here. '
      + 'Intents resolve here — PMS matches them against every app\'s declared filters. '
      + 'servicemanager is the phone book: every Binder client asks it for handles.'
      + ' Itself the first process forked from Zygote — function put it at the center, not birthplace.'
      + ' Binder itself: one-copy IPC via mmap; each process runs a ~16-thread binder pool; transactions '
      + 'share a ~1MB buffer — blow it and you get TransactionTooLargeException.',
  }
  group.add(hall)

  // AMS/WMS/PMS wings: each gets its own tooltip and its own pulse tint (below),
  // so the three services read as distinct decision-makers instead of one
  // undifferentiated "system_server" block.
  const wingNames = ['AMS', 'WMS', 'PMS']
  const WING_INFO = [
    { title: 'ActivityManager (AMS)', note: 'Decides who runs: approves launches, schedules lifecycles, writes every oom_adj score. The foundry and wards execute ITS decisions.' },
    { title: 'WindowManager (WMS)', note: 'Owns every window: shows the starting splash the instant you tap, registers app windows, routes input focus.' },
    { title: 'PackageManager (PMS)', note: 'Knows every installed app — resolves your tap\'s Intent against manifests to pick what launches.' },
  ]
  // Pulse tints echo the packet colors already used for each wing's triggering
  // events elsewhere (launch=green, tap/splash=amber, broadcast/resolve=orange)
  // — same PULSE_MS decay curve as the hall's own pulse, just tinted per wing.
  const WING_TINTS = [0x3fb950, 0xf2cc60, 0xd29922]
  const wings = wingNames.map((name, i) => {
    const w = makeBuilding(3, 3, 3, LIT, name)
    w.position.set((i - 1) * 6, 0, 7)
    w.userData.info = WING_INFO[i]
    group.add(w)
    return w
  })
  const wingPulse = [0, 0, 0]

  // Static dressing: antenna on the hall roof + 4 pillar columns at the plate's
  // corners. Local y 0 is the core-band plate top (anchor y 0.3 matches it).
  const antenna = makeAntenna()
  antenna.position.set(0, 6, -3)
  group.add(antenna)

  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.6 })
  const pillarGeo = new THREE.CylinderGeometry(0.6, 0.6, 4, 12)
  // (40,-10) would sit at world z 0 under the network->wards bridge roads
  // (their trunk spans x -33.75..45), so that one pulls in to z -7.5.
  const pillarSpots: Array<[number, number]> = [[-40, -10], [40, -7.5], [-40, 10], [40, 10]]
  for (const [x, z] of pillarSpots) {
    const pillar = new THREE.Mesh(pillarGeo, pillarMat)
    pillar.position.set(x, 2, z)
    group.add(pillar)
  }

  // Dark until boot:complete while a replay is in progress; relights one stage at a time.
  let stagesSeen = 0
  let litFrac = 1 // starts fully lit — default city state is already "booted"
  let pulseT = 0

  function paintBuilding(b: THREE.Group, pulseMs: number, tint: number): void {
    const body = b.getObjectByName('body') as THREE.Mesh
    const mat = body.material as THREE.MeshStandardMaterial
    const pulsing = pulseMs > 0
    mat.color.setHex(litFrac > 0.99 || pulsing ? LIT : DIM)
    mat.emissive.setHex(pulsing ? tint : (litFrac > 0 ? LIT : 0))
    mat.emissiveIntensity = 0.15 * litFrac + (pulsing ? 0.5 * (pulseMs / PULSE_MS) : 0)
  }

  function paint(): void {
    paintBuilding(hall, pulseT, LIT)
    wings.forEach((w, i) => paintBuilding(w, wingPulse[i], WING_TINTS[i]))
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
    wingPulse[0] = PULSE_MS // AMS: schedules the resumed lifecycle
  })
  bus.on('process:killed', () => {
    pulseT = PULSE_MS
    panel.setNarration('Death recipient fired — system_server noticed the process die (linkToDeath).')
  })
  // AMS: approves the launch request (intent-to-run decision) and reacts when
  // an already-running app is brought back to front (no fork, still its call).
  bus.on('app:launchRequested', () => { wingPulse[0] = PULSE_MS })
  bus.on('app:broughtToFront', () => { wingPulse[0] = PULSE_MS })
  // WMS: the ghost splash IS its starting window, shown the instant the ward's
  // plot is known; then it composites the app's first real frame.
  bus.on('process:forked', () => { wingPulse[1] = PULSE_MS })
  bus.on('frame:composited', () => { wingPulse[1] = PULSE_MS })
  // PMS: resolves the tap's Intent against manifests, and fields broadcasts
  // (its own registered-receiver matching is the same resolution machinery).
  bus.on('app:launchRequested', () => { wingPulse[2] = PULSE_MS })
  bus.on('broadcast:sent', () => { wingPulse[2] = PULSE_MS })

  const panel = makePanel('system_server — the city hall of Android')
  panel.addButton('Send broadcast', () => bus.emit('broadcast:sent', { action: 'NEWS' }))
  panel.setNarration(DEFAULT_NARRATION)

  return {
    name: 'system_server',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(0, 9, 18),
    cameraTarget: new THREE.Vector3(0, 3, 0),
    update(dtMs) {
      let dirty = false
      if (pulseT > 0) { pulseT = Math.max(0, pulseT - dtMs); dirty = true }
      for (let i = 0; i < wingPulse.length; i++) {
        if (wingPulse[i] > 0) { wingPulse[i] = Math.max(0, wingPulse[i] - dtMs); dirty = true }
      }
      if (dirty) paint()
    },
    setIdle() {
      // visual only — no ambient behavior beyond the bus-driven boot/pulse reactions
    },
  }
}
