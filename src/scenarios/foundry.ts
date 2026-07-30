import * as THREE from 'three'
import { createSystem, fork, setPriority, usedMb, type Priority, type SystemState } from '../sim/processes'
import { makeBuilding } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const CAPACITY_MB = 1200
const IDLE_RECLAIM_MS = 25000
const STAMP_MS = 400
const DEFAULT_NARRATION = 'Zygote forks every app process from a pre-warmed template — this is why app launch is fast. (Wards are the per-app buildings; this district is the factory only.)'
const KILL_NARRATION_SUFFIX = ' — SIGKILL, no callback, onDestroy never ran.'

// AMS's OomAdjuster ladder, collapsed to our 4 coarse priorities.
const OOM_ADJ: Record<Priority, number> = { foreground: 0, visible: 100, fgservice: 200, service: 500, cached: 900 }

export function makeFoundryScenario(bus: Bus): Scenario & {
  killApp(app: string): void
  setAppPriority(app: string, priority: Priority): void
  stats(): { usedMb: number; capacityMb: number; procs: number; procList: { name: string; memoryMb: number; oomAdj: number }[] }
} {
  const group = new THREE.Group()
  group.userData.info = {
    title: 'Zygote',
    note: 'Warm process template — apps fork from here, not from scratch.',
  }
  let state: SystemState = createSystem(CAPACITY_MB)
  let pendingLaunches: string[] = []

  const factory = makeBuilding(8, 5, 6, 0x78909c, 'Zygote Foundry')
  factory.position.y = 0.3
  factory.userData.info = {
    title: 'Zygote',
    note: 'Every app process is forked from this warm template. The fork shares Zygote\'s pages copy-on-write.',
  }
  group.add(factory)

  // Piston stamp: slides out from the factory front on every fork.
  const stamp = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xd29922 }),
  )
  stamp.position.set(0, 2.5, 3)
  stamp.userData.info = {
    title: 'Fork press',
    note: 'One slam = one clone() — a new process stamped from the warm template.',
  }
  group.add(stamp)
  let stampT = 0

  // Static dressing: blank ward-kit boxes queued south of the factory (the wards
  // are NORTH at z -25; these sit clear of them) + a decorative piston tower.
  // Kit columns at local x -13/-8/-3 (world -78/-73/-68) — the old centered
  // layout's middle column straddled the launcher->zygote road at world x -65.
  // No sim link — purely visual.
  const kitMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.7 })
  const kitGeo = new THREE.BoxGeometry(4, 1, 4)
  const KIT_COL_X = [-13, -8, -3]
  for (let row = 0; row < 2; row++) {
    for (const colX of KIT_COL_X) {
      const kit = new THREE.Mesh(kitGeo, kitMat)
      kit.position.set(colX, 0.8, 3 + row * 5) // local z 3/8 = world -32/-27 — stays on the core band (plate ends at -25)
      kit.userData.info = {
        title: 'Preloaded process templates',
        note: 'Pre-warmed process templates — what a Zygote fork stamps into a live ward. Copy-on-write: each blank shares the framework pages until written.',
      }
      group.add(kit)
    }
  }
  const pistonTower = new THREE.Group()
  const mast = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 6, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.7 }),
  )
  mast.position.y = 3
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x546e7a, roughness: 0.5 }),
  )
  rod.position.set(0, 5, 0.9)
  pistonTower.add(mast, rod)
  pistonTower.position.set(-10, 0.3, -8)
  group.add(pistonTower)

  // WardManager calls this on warm/hot brought-to-front and on Home — named-proc
  // lookup, no-op if the app hasn't forked (or already died).
  function setAppPriority(app: string, priority: Priority): void {
    const proc = state.procs.find(p => p.name === app)
    if (!proc) return
    state = setPriority(state, proc.pid, priority)
  }

  function procTable(): string {
    if (state.procs.length === 0) return 'No processes forked yet.'
    return state.procs.map(p => `${p.name}(${p.priority})`).join(', ')
  }

  const panel = makePanel('Zygote — the foundry every app forks from')
  panel.setNarration(DEFAULT_NARRATION)

  // Forking one hop per frame (instead of synchronously in the event handler) keeps
  // the launchRequested→forked→resumed chain from resolving inside a single call
  // stack — the story player needs a frame between each event to arm its next wait.
  function processFork(app: string): void {
    const preForkProcs = state.procs // for pid→name lookup of anything LMK kills below
    const prevKilled = state.killedPids
    state = fork(state, app, 'foreground', 300)

    const newProc = state.procs.find(p => !preForkProcs.some(b => b.pid === p.pid))
    if (newProc) {
      bus.emit('process:forked', { app: newProc.name, pid: newProc.pid })
      stampT = STAMP_MS
    }
    // killedPids is cumulative — diff against what we saw before this fork to find only the new kills.
    const newlyKilled = state.killedPids.filter(pid => !prevKilled.includes(pid))
    // A fork that had to reclaim memory is exactly the pressure event that
    // triggers onTrimMemory in real Android — signal it before the kills land.
    if (newlyKilled.length > 0) bus.emit('memory:trim', {})
    for (const pid of newlyKilled) {
      const proc = preForkProcs.find(p => p.pid === pid)
      if (proc) bus.emit('process:killed', { app: proc.name, pid })
    }
    panel.setNarration(procTable())
  }

  bus.on('app:launchRequested', ({ app }) => { pendingLaunches.push(app) })
  // PSI crossed 0.85 (main.ts's edge-trigger): real LMK trims every app's memory
  // under pressure whether or not it finds a victim to kill — trim fires
  // unconditionally, the kill only if a cached process exists.
  bus.on('memory:pressure', () => {
    bus.emit('memory:trim', {})
    const victim = oldestCached()
    if (victim) killApp(victim.name)
  })

  function killApp(app: string): void {
    const proc = state.procs.find(p => p.name === app)
    if (!proc) return
    state = { ...state, procs: state.procs.filter(p => p.pid !== proc.pid) }
    bus.emit('process:killed', { app, pid: proc.pid })
    panel.setNarration(procTable() + KILL_NARRATION_SUFFIX)
  }

  function oldestCached(): { name: string } | undefined {
    return state.procs.filter(p => p.priority === 'cached').sort((a, b) => a.pid - b.pid)[0]
  }

  // Models Android's low-memory killer reclaiming cached processes over time —
  // without this, a free-mode city that fills all plots (capacity ÷ per-app cost
  // wards) never frees one, and nothing ever re-launches. Unlike the PSI path
  // above, this idle sweep only trims when it actually has a victim to kill.
  function killOldestCached(): void {
    const victim = oldestCached()
    if (victim) {
      bus.emit('memory:trim', {})
      killApp(victim.name)
    }
  }

  let idleEnabled = true
  let idleReclaimT = 0

  return {
    name: 'Zygote',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(10, 9, 14),
    cameraTarget: new THREE.Vector3(0, 2, 0),
    update(dtMs) {
      if (pendingLaunches.length > 0) {
        const app = pendingLaunches.shift()!
        processFork(app)
      }
      if (idleEnabled) {
        idleReclaimT += dtMs
        if (idleReclaimT >= IDLE_RECLAIM_MS) {
          idleReclaimT = 0
          killOldestCached()
        }
      }
      if (state.killedPids.length > 20) state = { ...state, killedPids: state.killedPids.slice(-20) }
      if (stampT > 0) {
        stampT = Math.max(0, stampT - dtMs)
        const t = stampT / STAMP_MS // 1 → 0 over the animation
        stamp.position.z = 3 + Math.sin(t * Math.PI) * 4 // slides out and back
      } else {
        stamp.position.z = 3
      }
    },
    setIdle(enabled) {
      idleEnabled = enabled
      idleReclaimT = 0
    },
    killApp,
    setAppPriority,
    stats() {
      return {
        usedMb: usedMb(state),
        capacityMb: CAPACITY_MB,
        procs: state.procs.length,
        procList: state.procs.map(p => ({ name: p.name, memoryMb: p.memoryMb, oomAdj: OOM_ADJ[p.priority] })),
      }
    },
  }
}
