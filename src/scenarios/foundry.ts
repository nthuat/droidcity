import * as THREE from 'three'
import { createSystem, fork, setPriority, usedMb, type SystemState } from '../sim/processes'
import { makeBuilding, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const CAPACITY_MB = 1200
const IDLE_DEMOTE_MS = 10000
const IDLE_RECLAIM_MS = 25000
const STAMP_MS = 400
const DEFAULT_NARRATION = 'Zygote forks every app process from a pre-warmed template — this is why app launch is fast. (Wards are the per-app buildings; this district is the factory only.)'

export function makeFoundryScenario(bus: Bus): Scenario & { demoteAll(): void; killApp(app: string): void } {
  const group = new THREE.Group()
  let state: SystemState = createSystem(CAPACITY_MB)
  let pendingLaunches: string[] = []

  const factory = makeBuilding(8, 5, 6, 0x484f58, 'Zygote Foundry')
  group.add(factory)

  const meter = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x3fb950 }),
  )
  meter.position.set(10, 0.5, 0)
  group.add(meter)
  const meterLabel = makeLabel('RAM', 0.7)
  meterLabel.position.set(10, 8, 0)
  group.add(meterLabel)

  // Piston stamp: slides out from the factory front on every fork.
  const stamp = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0xd29922 }),
  )
  stamp.position.set(0, 2.5, 3)
  group.add(stamp)
  let stampT = 0

  function demoteAll(): void {
    state = state.procs.reduce(
      (acc, p) => (p.priority === 'foreground' ? setPriority(acc, p.pid, 'cached') : acc),
      state,
    )
  }

  function procTable(): string {
    if (state.procs.length === 0) return 'No processes forked yet.'
    return state.procs.map(p => `${p.name}(${p.priority})`).join(', ')
  }

  const panel = makePanel('Zygote Foundry — every app forks from here')
  panel.addButton('Demote all to cached', () => {
    demoteAll()
    panel.setNarration(procTable())
  })
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
    for (const pid of newlyKilled) {
      const proc = preForkProcs.find(p => p.pid === pid)
      if (proc) bus.emit('process:killed', { app: proc.name, pid })
    }
    panel.setNarration(procTable())
  }

  bus.on('app:launchRequested', ({ app }) => { pendingLaunches.push(app) })

  function killApp(app: string): void {
    const proc = state.procs.find(p => p.name === app)
    if (!proc) return
    state = { ...state, procs: state.procs.filter(p => p.pid !== proc.pid) }
    bus.emit('process:killed', { app, pid: proc.pid })
    panel.setNarration(procTable())
  }

  // Models Android's low-memory killer reclaiming cached processes over time —
  // without this, a free-mode city that fills all plots (capacity ÷ per-app cost
  // wards) never frees one, and nothing ever re-launches.
  function killOldestCached(): void {
    const cached = state.procs.filter(p => p.priority === 'cached').sort((a, b) => a.pid - b.pid)
    if (cached.length > 0) killApp(cached[0].name)
  }

  let idleEnabled = true
  let idleT = 0
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
        idleT += dtMs
        if (idleT >= IDLE_DEMOTE_MS) {
          idleT = 0
          demoteAll()
          panel.setNarration(procTable())
        }
        idleReclaimT += dtMs
        if (idleReclaimT >= IDLE_RECLAIM_MS) {
          idleReclaimT = 0
          killOldestCached()
        }
      }
      if (state.killedPids.length > 20) state = { ...state, killedPids: state.killedPids.slice(-20) }
      const frac = usedMb(state) / CAPACITY_MB
      meter.scale.y = 1 + frac * 10
      meter.position.y = meter.scale.y / 2
      ;(meter.material as THREE.MeshStandardMaterial).color.setHex(frac > 0.8 ? 0xf85149 : 0x3fb950)
      if (stampT > 0) {
        stampT = Math.max(0, stampT - dtMs)
        const t = stampT / STAMP_MS // 1 → 0 over the animation
        stamp.position.z = 3 + Math.sin(t * Math.PI) * 4 // slides out and back
      } else {
        stamp.position.z = 3
      }
    },
    reset() {
      state = createSystem(CAPACITY_MB)
      pendingLaunches = []
      idleT = 0
      idleReclaimT = 0
      stampT = 0
      panel.setNarration(DEFAULT_NARRATION)
    },
    setIdle(enabled) {
      idleEnabled = enabled
      idleT = 0
      idleReclaimT = 0
    },
    demoteAll,
    killApp,
  }
}
