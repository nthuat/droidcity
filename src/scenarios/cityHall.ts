import * as THREE from 'three'
import { makeBuilding } from '../scene/builders'
import { makeAntenna } from '../scene/props'
import { makePanel } from '../ui/panel'
import {
  cancelJobsFor, createJobs, dispatchJobs, enqueueJob, finishJob, setDoze,
  type JobConstraint, type JobEnv, type JobsState,
} from '../sim/jobs'
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

export interface CityHallHooks {
  // Doze gates the ambient city (auto-launches, idle fetches) — main.ts owns
  // those, so the toggle is reported out rather than reached across.
  onDozeChanged?: (doze: boolean) => void
  // A dispatched job runs IN its app's process: main.ts flies the packet.
  onJobDispatched?: (app: string) => void
}

export function makeCityHallScenario(bus: Bus, hooks: CityHallHooks = {}): Scenario & {
  jobStats(): { pending: number; running: number; done: number; doze: boolean }
} {
  const { onDozeChanged, onJobDispatched } = hooks
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

  // Job depot: JobScheduler's queue. WorkManager enqueues here; the SYSTEM
  // decides when each job runs. Sits west of the AMS wing (wings at x -6/0/6,
  // z 7) with its crate apron running north, clear of the antenna at z -3.
  const depot = makeBuilding(4, 2, 3, LIT, 'jobs')
  depot.position.set(-14, 0, 7)
  depot.userData.info = {
    title: 'JobScheduler',
    note: 'WorkManager enqueues work here; the system decides WHEN. A job waits for its constraints (network, charging, idle) — and in Doze, for the next maintenance window. Batching everyone\'s jobs into shared wakeups is the whole point: your app does not get to pick the moment.',
  }
  group.add(depot)

  // Up to 6 visible queue crates: amber = waiting on constraints, green = running.
  const JOB_CRATE_CAP = 6
  const jobCrateGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9)
  const jobCrates = Array.from({ length: JOB_CRATE_CAP }, (_, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xd29922, roughness: 0.7 })
    const crate = new THREE.Mesh(jobCrateGeo, mat)
    crate.position.set(-14 + (i % 3) * 1.2 - 1.2, 0.45, 3.4 - Math.floor(i / 3) * 1.2)
    crate.visible = false
    crate.userData.info = {
      title: 'Queued job',
      note: 'Amber = waiting for its constraints or a maintenance window. Green = dispatched to its app. A job whose process dies goes with it — real WorkManager persists and reschedules it.',
    }
    group.add(crate)
    return crate
  })

  // Doze dome: deep idle over the whole board.
  const dozeDome = new THREE.Mesh(
    new THREE.SphereGeometry(62, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    // Light touch on purpose: enough to read "the device is asleep" without
    // washing the city out — at 0.16 the whole board went grey and unreadable.
    new THREE.MeshStandardMaterial({
      color: 0x6a86ad, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide,
    }),
  )
  dozeDome.position.set(0, 0, 0)
  dozeDome.visible = false
  dozeDome.userData.info = {
    title: 'Doze — deep idle',
    note: 'Screen off and still for a while: network is cut, alarms and jobs are deferred to periodic maintenance windows that get further apart the longer the device stays put. This is why background work must be constraint-based, not clock-based.',
  }
  group.add(dozeDome)

  let jobs: JobsState = createJobs()
  // Timers for jobs in flight (id -> ms remaining) and the open window.
  const jobTimers = new Map<number, number>()
  let windowMs = 0
  const JOB_RUN_MS = 2600
  const WINDOW_MS = 6000

  function jobEnv(): JobEnv {
    // Doze cuts the radio, so a network-constrained job can only run inside a
    // window; 'idle' is exactly what Doze means; charging is user-driven only.
    return { network: !jobs.doze, charging: false, idle: jobs.doze, window: windowMs > 0 }
  }

  function paintJobs(): void {
    const running = jobs.running.length
    jobCrates.forEach((crate, i) => {
      const isRunning = i < running
      const shown = i < Math.min(JOB_CRATE_CAP, running + jobs.pending.length)
      crate.visible = shown
      if (!shown) return
      const mat = crate.material as THREE.MeshStandardMaterial
      const hex = isRunning ? 0x3ddc84 : 0xd29922
      mat.color.setHex(hex)
      mat.emissive.setHex(isRunning ? hex : 0x000000)
      mat.emissiveIntensity = isRunning ? 0.5 : 0
    })
    dozeDome.visible = jobs.doze
  }
  paintJobs()

  bus.on('process:killed', ({ app }) => {
    const next = cancelJobsFor(jobs, app)
    if (next !== jobs) {
      for (const j of jobs.running) if (j.app === app) jobTimers.delete(j.id)
      jobs = next
      paintJobs()
    }
  })

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
  function enqueue(constraint: JobConstraint): void {
    jobs = enqueueJob(jobs, 'chat', constraint)
    paintJobs()
    panel.setNarration(jobs.doze
      ? `Job queued (${constraint}) — Doze is on, so it waits for the next maintenance window.`
      : `Job queued (${constraint}) — runs as soon as the constraint is met.`)
  }
  panel.addButton('Enqueue job (network)', () => enqueue('network'))
  panel.addButton('Enqueue job (charging)', () => enqueue('charging'))
  const dozeBtn = panel.addButton('Doze on', () => {
    jobs = setDoze(jobs, !jobs.doze)
    dozeBtn.textContent = jobs.doze ? 'Doze off' : 'Doze on'
    paintJobs()
    onDozeChanged?.(jobs.doze)
    panel.setNarration(jobs.doze
      ? 'Doze on — radio off, jobs and alarms deferred. Nothing runs until a maintenance window opens.'
      : 'Doze off — the device is awake; constraints alone decide when jobs run.')
  })
  panel.addButton('Maintenance window', () => {
    windowMs = WINDOW_MS
    panel.setNarration('Maintenance window open — deferred work runs now, batched with everyone else\'s.')
  })
  panel.setNarration(DEFAULT_NARRATION)

  return {
    name: 'system_server',
    jobStats() {
      return { pending: jobs.pending.length, running: jobs.running.length, done: jobs.done, doze: jobs.doze }
    },
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

      // Job machinery: window countdown, dispatch, and completion.
      if (windowMs > 0) windowMs = Math.max(0, windowMs - dtMs)
      const dispatched = dispatchJobs(jobs, jobEnv())
      if (dispatched !== jobs) {
        for (const j of dispatched.running) {
          if (!jobTimers.has(j.id)) {
            jobTimers.set(j.id, JOB_RUN_MS)
            onJobDispatched?.(j.app)
          }
        }
        jobs = dispatched
        paintJobs()
      }
      for (const [id, left] of [...jobTimers]) {
        const next = left - dtMs
        if (next <= 0) {
          jobTimers.delete(id)
          jobs = finishJob(jobs, id)
          paintJobs()
        } else {
          jobTimers.set(id, next)
        }
      }
    },
    setIdle() {
      // visual only — no ambient behavior beyond the bus-driven boot/pulse reactions
    },
  }
}
