# DroidCity v2 — Connected City Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect all districts into one live Android system (boot → launch → data → frame) via a typed event bus, add 4 new districts (Boot, Launcher, Network, Database), and a 4-chapter guided story player over the live sim.

**Architecture:** Spec: `docs/superpowers/specs/2026-07-27-connected-city-design.md`. Pure sims (src/sim, TDD) + typed bus (src/core/bus.ts) + scenarios subscribe/emit bus events + packet meshes visualize hops + StoryPlayer observes bus (never fakes). Existing 28 tests must stay green throughout.

**Tech Stack:** existing (Vite, TS strict, Three.js, Vitest). No new dependencies.

## Global Constraints

- `src/sim/**` and `src/core/bus.ts` NEVER import `three`. Pure immutable functions — never mutate input state.
- No `Date.now()`/`performance.now()` in sim/core/story-player logic — time arrives as `dtMs`.
- All bus event names/payloads come from the `CityEvents` interface in `src/core/bus.ts` — never stringly-typed elsewhere.
- Scenario factories change signature to `make*Scenario(bus: Bus)`. All subscriptions created inside the factory; scenarios emit/subscribe only events listed for them in this plan.
- TDD for: bus, boot, launcher, netFetch, roomDb sims, StoryPlayer core. RED before GREEN. Existing 28 tests stay green every task.
- No new deps. Commit messages conventional, no attribution footer. Files < 400 lines.
- District ids (canonical, used for focus/anchors): `boot, launcher, network, database, mainThread, lifecycle, touchPipeline, zygote, gc, overview`.

## File Structure

Created: `src/core/bus.ts`, `src/sim/boot.ts`, `src/sim/launcher.ts`, `src/sim/netFetch.ts`, `src/sim/roomDb.ts`, `src/scene/packet.ts`, `src/scenarios/{boot,launcher,network,database}.ts`, `src/story/player.ts`, `src/story/chapters/{ch1-boot,ch2-launch,ch3-data,ch4-frame}.ts`, tests for each TDD module.
Modified: all 5 existing scenarios (bus wiring), `src/main.ts` (layout, packets, story UI), `src/scenarios/types.ts` (bus-aware, screen-light hook), `index.html` (story bar + narration card styles).

---

### Task 1: Typed event bus

**Files:** Create `src/core/bus.ts`; Test `tests/core/bus.test.ts`

**Interfaces — Produces (everything downstream imports this):**
```ts
export interface CityEvents {
  'boot:stageDone': { stage: string }
  'boot:complete': Record<string, never>
  'app:launchRequested': { app: string }
  'process:forked': { app: string; pid: number }
  'activity:resumed': { app: string }
  'data:requested': { app: string; source: 'db' | 'network' }
  'data:cacheHit': { app: string; stale: boolean }
  'data:fetched': { app: string; ms: number }
  'net:phase': { phase: string }
  'ui:messagePosted': { label: string }
  'frame:rendered': { dropped: boolean }
  'gc:swept': { freedKb: number }
}
export type CityEventName = keyof CityEvents
export interface Bus {
  on<K extends CityEventName>(event: K, fn: (p: CityEvents[K]) => void): () => void
  emit<K extends CityEventName>(event: K, payload: CityEvents[K]): void
  clear(): void
}
export function createBus(): Bus
```

- [ ] **Step 1: Failing tests** — `tests/core/bus.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { createBus } from '../../src/core/bus'

describe('bus', () => {
  it('delivers payload to subscribers', () => {
    const bus = createBus()
    const fn = vi.fn()
    bus.on('app:launchRequested', fn)
    bus.emit('app:launchRequested', { app: 'chat' })
    expect(fn).toHaveBeenCalledWith({ app: 'chat' })
  })
  it('unsubscribe stops delivery', () => {
    const bus = createBus()
    const fn = vi.fn()
    const off = bus.on('boot:complete', fn)
    off()
    bus.emit('boot:complete', {})
    expect(fn).not.toHaveBeenCalled()
  })
  it('emit with no subscribers is safe', () => {
    expect(() => createBus().emit('gc:swept', { freedKb: 1 })).not.toThrow()
  })
  it('clear removes all subscribers', () => {
    const bus = createBus()
    const fn = vi.fn()
    bus.on('net:phase', fn)
    bus.clear()
    bus.emit('net:phase', { phase: 'dns' })
    expect(fn).not.toHaveBeenCalled()
  })
  it('handler errors do not break other subscribers', () => {
    const bus = createBus()
    const good = vi.fn()
    bus.on('frame:rendered', () => { throw new Error('boom') })
    bus.on('frame:rendered', good)
    bus.emit('frame:rendered', { dropped: false })
    expect(good).toHaveBeenCalled()
  })
})
```
- [ ] **Step 2: Run, verify FAIL** — `npx vitest run tests/core/bus.test.ts` → module not found.
- [ ] **Step 3: Implement** — `src/core/bus.ts`:
```ts
// CityEvents interface exactly as above, then:
type Handler = (payload: never) => void

export function createBus(): Bus {
  const handlers = new Map<CityEventName, Set<Handler>>()
  return {
    on(event, fn) {
      let set = handlers.get(event)
      if (!set) {
        set = new Set()
        handlers.set(event, set)
      }
      set.add(fn as Handler)
      return () => { set!.delete(fn as Handler) }
    },
    emit(event, payload) {
      const set = handlers.get(event)
      if (!set) return
      for (const fn of [...set]) {
        try {
          ;(fn as (p: typeof payload) => void)(payload)
        } catch (err) {
          console.error(`bus handler error for ${event}:`, err)
        }
      }
    },
    clear() { handlers.clear() },
  }
}
```
- [ ] **Step 4: Run, verify PASS** (5 new; 33 total green).
- [ ] **Step 5: Commit** — `feat: typed city event bus`

---

### Task 2: Boot sim

**Files:** Create `src/sim/boot.ts`; Test `tests/sim/boot.test.ts`

**Interfaces — Produces:**
```ts
export interface BootStage { readonly name: string; readonly durationMs: number }
export const BOOT_STAGES: readonly BootStage[] // bootloader 800, kernel 1200, init 900, system_server 1500
export interface BootState {
  readonly elapsedMs: number
  readonly completed: readonly string[]  // stage names completed, in order
  readonly done: boolean
}
export function createBoot(): BootState
export function advanceBoot(s: BootState, dtMs: number): BootState
```

- [ ] **Step 1: Failing tests** — `tests/sim/boot.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createBoot, advanceBoot, BOOT_STAGES } from '../../src/sim/boot'

describe('boot', () => {
  it('has 4 stages totaling 4400ms', () => {
    expect(BOOT_STAGES.map(s => s.name)).toEqual(['bootloader', 'kernel', 'init', 'system_server'])
    expect(BOOT_STAGES.reduce((a, s) => a + s.durationMs, 0)).toBe(4400)
  })
  it('completes stages in order as time passes', () => {
    let s = advanceBoot(createBoot(), 800)
    expect(s.completed).toEqual(['bootloader'])
    s = advanceBoot(s, 1200)
    expect(s.completed).toEqual(['bootloader', 'kernel'])
    expect(s.done).toBe(false)
  })
  it('one large advance completes everything', () => {
    const s = advanceBoot(createBoot(), 10000)
    expect(s.completed).toHaveLength(4)
    expect(s.done).toBe(true)
  })
  it('mid-stage advance completes nothing new', () => {
    const s = advanceBoot(createBoot(), 500)
    expect(s.completed).toEqual([])
  })
  it('does not mutate input', () => {
    const s0 = createBoot()
    advanceBoot(s0, 5000)
    expect(s0.elapsedMs).toBe(0)
  })
})
```
- [ ] **Step 2: RED** — module not found.
- [ ] **Step 3: Implement**:
```ts
export const BOOT_STAGES: readonly BootStage[] = [
  { name: 'bootloader', durationMs: 800 },
  { name: 'kernel', durationMs: 1200 },
  { name: 'init', durationMs: 900 },
  { name: 'system_server', durationMs: 1500 },
]

export function createBoot(): BootState {
  return { elapsedMs: 0, completed: [], done: false }
}

export function advanceBoot(s: BootState, dtMs: number): BootState {
  const elapsedMs = s.elapsedMs + dtMs
  const completed: string[] = []
  let acc = 0
  for (const stage of BOOT_STAGES) {
    acc += stage.durationMs
    if (elapsedMs >= acc) completed.push(stage.name)
  }
  return { elapsedMs, completed, done: completed.length === BOOT_STAGES.length }
}
```
- [ ] **Step 4: GREEN** (38 total). **Step 5: Commit** — `feat: boot stage sim`

---

### Task 3: Launcher sim

**Files:** Create `src/sim/launcher.ts`; Test `tests/sim/launcher.test.ts`

**Interfaces — Produces:**
```ts
export const APPS: readonly string[] // ['chat', 'maps', 'camera', 'bank']
export interface LauncherState {
  readonly launching: readonly string[]
  readonly running: readonly string[]
}
export function createLauncher(): LauncherState
export function requestLaunch(s: LauncherState, app: string): { state: LauncherState; accepted: boolean }
export function markRunning(s: LauncherState, app: string): LauncherState  // launching → running
export function markStopped(s: LauncherState, app: string): LauncherState  // removes from both
```

- [ ] **Step 1: Failing tests**:
```ts
import { describe, it, expect } from 'vitest'
import { createLauncher, requestLaunch, markRunning, markStopped, APPS } from '../../src/sim/launcher'

describe('launcher', () => {
  it('accepts launch for idle app', () => {
    const r = requestLaunch(createLauncher(), 'chat')
    expect(r.accepted).toBe(true)
    expect(r.state.launching).toEqual(['chat'])
  })
  it('rejects launch while launching or running', () => {
    let { state } = requestLaunch(createLauncher(), 'chat')
    expect(requestLaunch(state, 'chat').accepted).toBe(false)
    state = markRunning(state, 'chat')
    expect(requestLaunch(state, 'chat').accepted).toBe(false)
    expect(state.running).toEqual(['chat'])
    expect(state.launching).toEqual([])
  })
  it('rejects unknown app', () => {
    expect(requestLaunch(createLauncher(), 'nope').accepted).toBe(false)
  })
  it('markStopped frees the app for relaunch', () => {
    let { state } = requestLaunch(createLauncher(), 'maps')
    state = markRunning(state, 'maps')
    state = markStopped(state, 'maps')
    expect(requestLaunch(state, 'maps').accepted).toBe(true)
  })
  it('APPS has the 4 canonical apps', () => {
    expect(APPS).toEqual(['chat', 'maps', 'camera', 'bank'])
  })
})
```
- [ ] **Step 2: RED.** **Step 3: Implement**:
```ts
export const APPS: readonly string[] = ['chat', 'maps', 'camera', 'bank']

export function createLauncher(): LauncherState {
  return { launching: [], running: [] }
}

export function requestLaunch(s: LauncherState, app: string): { state: LauncherState; accepted: boolean } {
  const busy = s.launching.includes(app) || s.running.includes(app)
  if (!APPS.includes(app) || busy) return { state: s, accepted: false }
  return { state: { ...s, launching: [...s.launching, app] }, accepted: true }
}

export function markRunning(s: LauncherState, app: string): LauncherState {
  if (!s.launching.includes(app)) return s
  return { launching: s.launching.filter(a => a !== app), running: [...s.running, app] }
}

export function markStopped(s: LauncherState, app: string): LauncherState {
  return { launching: s.launching.filter(a => a !== app), running: s.running.filter(a => a !== app) }
}
```
- [ ] **Step 4: GREEN** (43). **Step 5: Commit** — `feat: launcher app registry sim`

---

### Task 4: Network fetch sim

**Files:** Create `src/sim/netFetch.ts`; Test `tests/sim/netFetch.test.ts`

**Interfaces — Produces:**
```ts
export interface NetPhase { readonly name: string; readonly costMs: number }
export const NET_PHASES: readonly NetPhase[] // dns 100, connect 150, tls 250, ttfb 400, download 300 (total 1200)
export interface NetRequest {
  readonly elapsedMs: number       // within current attempt
  readonly currentIndex: number    // -1 when done or failed-awaiting-retry
  readonly done: boolean
  readonly attempt: number         // 1 or 2
  readonly failAt: string | null   // phase name that times out on attempt 1
  readonly retrying: boolean       // true between failure and attempt-2 start
  readonly totalMs: number         // cumulative real cost incl. failed attempt
}
export function startRequest(opts?: { failAt?: string }): NetRequest
export function advanceRequest(r: NetRequest, dtMs: number): NetRequest
```
Semantics: phases run in order. If `failAt` set and attempt 1 reaches END of that phase, request enters `retrying` (currentIndex -1) for `RETRY_BACKOFF_MS = 500`, then attempt 2 starts from phase 0 with failure cleared. `done` only after a full successful pass.

- [ ] **Step 1: Failing tests**:
```ts
import { describe, it, expect } from 'vitest'
import { startRequest, advanceRequest, NET_PHASES } from '../../src/sim/netFetch'

describe('netFetch', () => {
  it('phases total 1200ms', () => {
    expect(NET_PHASES.reduce((a, p) => a + p.costMs, 0)).toBe(1200)
    expect(NET_PHASES.map(p => p.name)).toEqual(['dns', 'connect', 'tls', 'ttfb', 'download'])
  })
  it('advances through phases in order', () => {
    let r = startRequest()
    expect(r.currentIndex).toBe(0)
    r = advanceRequest(r, 100)
    expect(r.currentIndex).toBe(1)
    r = advanceRequest(r, 1100)
    expect(r.done).toBe(true)
    expect(r.currentIndex).toBe(-1)
  })
  it('happy path totalMs is 1200', () => {
    const r = advanceRequest(startRequest(), 5000)
    expect(r.totalMs).toBe(1200)
  })
  it('failAt triggers retry then succeeds on attempt 2', () => {
    let r = startRequest({ failAt: 'ttfb' })
    r = advanceRequest(r, 900) // dns+connect+tls+ttfb = 900 → failure point reached
    expect(r.retrying).toBe(true)
    expect(r.attempt).toBe(1)
    r = advanceRequest(r, 500) // backoff elapses → attempt 2 begins
    expect(r.retrying).toBe(false)
    expect(r.attempt).toBe(2)
    expect(r.currentIndex).toBe(0)
    r = advanceRequest(r, 1200)
    expect(r.done).toBe(true)
  })
  it('does not mutate input', () => {
    const r0 = startRequest()
    advanceRequest(r0, 1000)
    expect(r0.elapsedMs).toBe(0)
  })
})
```
- [ ] **Step 2: RED.** **Step 3: Implement**:
```ts
export const NET_PHASES: readonly NetPhase[] = [
  { name: 'dns', costMs: 100 },
  { name: 'connect', costMs: 150 },
  { name: 'tls', costMs: 250 },
  { name: 'ttfb', costMs: 400 },
  { name: 'download', costMs: 300 },
]
const RETRY_BACKOFF_MS = 500
const TOTAL_MS = NET_PHASES.reduce((a, p) => a + p.costMs, 0)

export function startRequest(opts?: { failAt?: string }): NetRequest {
  return { elapsedMs: 0, currentIndex: 0, done: false, attempt: 1, failAt: opts?.failAt ?? null, retrying: false, totalMs: 0 }
}

function failPointMs(failAt: string): number {
  let acc = 0
  for (const p of NET_PHASES) {
    acc += p.costMs
    if (p.name === failAt) return acc
  }
  return Infinity
}

function indexAt(elapsedMs: number): number {
  let acc = 0
  for (let i = 0; i < NET_PHASES.length; i++) {
    acc += NET_PHASES[i].costMs
    if (elapsedMs < acc) return i
  }
  return -1
}

export function advanceRequest(r: NetRequest, dtMs: number): NetRequest {
  if (r.done) return r
  let remaining = dtMs
  let cur = r
  while (remaining > 0 && !cur.done) {
    if (cur.retrying) {
      const wait = RETRY_BACKOFF_MS - cur.elapsedMs
      const spent = Math.min(wait, remaining)
      remaining -= spent
      const elapsedMs = cur.elapsedMs + spent
      cur = elapsedMs >= RETRY_BACKOFF_MS
        ? { ...cur, retrying: false, attempt: 2, failAt: null, elapsedMs: 0, currentIndex: 0, totalMs: cur.totalMs + spent }
        : { ...cur, elapsedMs, totalMs: cur.totalMs + spent }
      continue
    }
    const limit = cur.failAt && cur.attempt === 1 ? failPointMs(cur.failAt) : TOTAL_MS
    const spent = Math.min(limit - cur.elapsedMs, remaining)
    remaining -= spent
    const elapsedMs = cur.elapsedMs + spent
    if (elapsedMs >= limit) {
      cur = cur.failAt && cur.attempt === 1
        ? { ...cur, retrying: true, elapsedMs: 0, currentIndex: -1, totalMs: cur.totalMs + spent }
        : { ...cur, done: true, currentIndex: -1, elapsedMs, totalMs: cur.totalMs + spent }
    } else {
      cur = { ...cur, elapsedMs, currentIndex: indexAt(elapsedMs), totalMs: cur.totalMs + spent }
    }
  }
  return cur
}
```
- [ ] **Step 4: GREEN** (48). **Step 5: Commit** — `feat: network request lifecycle sim with retry`

---

### Task 5: Room DB sim

**Files:** Create `src/sim/roomDb.ts`; Test `tests/sim/roomDb.test.ts`

**Interfaces — Produces:**
```ts
export const DB_QUERY_MS = 30
export interface DbState { readonly tables: Readonly<Record<string, { readonly fresh: boolean }>> }
export function createDb(): DbState              // seeded: { feed: { fresh: false } }
export function query(s: DbState, key: string): { hit: boolean; fresh: boolean }
export function insert(s: DbState, key: string): DbState  // creates/updates key as fresh
```

- [ ] **Step 1: Failing tests**:
```ts
import { describe, it, expect } from 'vitest'
import { createDb, query, insert, DB_QUERY_MS } from '../../src/sim/roomDb'

describe('roomDb', () => {
  it('seeded feed table hits as stale', () => {
    expect(query(createDb(), 'feed')).toEqual({ hit: true, fresh: false })
  })
  it('misses unknown key', () => {
    expect(query(createDb(), 'nope')).toEqual({ hit: false, fresh: false })
  })
  it('insert makes key fresh, immutably', () => {
    const s0 = createDb()
    const s1 = insert(s0, 'feed')
    expect(query(s1, 'feed')).toEqual({ hit: true, fresh: true })
    expect(query(s0, 'feed').fresh).toBe(false)
  })
  it('query cost constant is 30ms', () => {
    expect(DB_QUERY_MS).toBe(30)
  })
})
```
- [ ] **Step 2: RED.** **Step 3: Implement**:
```ts
export const DB_QUERY_MS = 30

export function createDb(): DbState {
  return { tables: { feed: { fresh: false } } }
}

export function query(s: DbState, key: string): { hit: boolean; fresh: boolean } {
  const t = s.tables[key]
  return t ? { hit: true, fresh: t.fresh } : { hit: false, fresh: false }
}

export function insert(s: DbState, key: string): DbState {
  return { tables: { ...s.tables, [key]: { fresh: true } } }
}
```
- [ ] **Step 4: GREEN** (52). **Step 5: Commit** — `feat: room db cache sim`

---

### Task 6: Packet system + layout expansion

**Files:** Create `src/scene/packet.ts`; Modify `src/main.ts`, `src/scene/city.ts`

**Interfaces — Produces:**
```ts
// packet.ts
export interface PacketSystem {
  fly(from: THREE.Vector3, to: THREE.Vector3, opts?: { color?: number; durationMs?: number; arcHeight?: number }): void
  update(dtMs: number): void
  activeCount(): number
}
export function createPacketSystem(scene: THREE.Scene): PacketSystem
```
```ts
// main.ts — Produces for later tasks:
export const DISTRICT_ANCHORS: Record<string, THREE.Vector3>
// boot (-90,0,30), launcher (0,0,110), network (90,0,30), database (60,0,110),
// mainThread (-60,0,0), lifecycle (0,0,0), touchPipeline (60,0,0), zygote (-30,0,60), gc (30,0,60)
```

- [ ] **Step 1: Implement packet.ts** — sphere (radius 0.6, emissive, color per opts, default 0x76e3ea), flies `from`→`to` over `durationMs` (default 900) on a parabolic arc (`arcHeight` default 8, y = lerp + arcHeight·4t(1−t)); geometry/material shared across packets (create once module-scope? No — per system instance), disposed when packet lands; update() advances all active, removes finished. ~60 lines:
```ts
import * as THREE from 'three'

interface ActivePacket { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; durationMs: number; arcHeight: number }

export function createPacketSystem(scene: THREE.Scene): PacketSystem {
  const geometry = new THREE.SphereGeometry(0.6)
  const active: ActivePacket[] = []
  return {
    fly(from, to, opts = {}) {
      const material = new THREE.MeshStandardMaterial({
        color: opts.color ?? 0x76e3ea, emissive: opts.color ?? 0x76e3ea, emissiveIntensity: 0.8,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.copy(from)
      scene.add(mesh)
      active.push({ mesh, from: from.clone(), to: to.clone(), t: 0, durationMs: opts.durationMs ?? 900, arcHeight: opts.arcHeight ?? 8 })
    },
    update(dtMs) {
      for (let i = active.length - 1; i >= 0; i--) {
        const p = active[i]
        p.t = Math.min(p.t + dtMs / p.durationMs, 1)
        p.mesh.position.lerpVectors(p.from, p.to, p.t)
        p.mesh.position.y += p.arcHeight * 4 * p.t * (1 - p.t) + 2
        if (p.t >= 1) {
          scene.remove(p.mesh)
          ;(p.mesh.material as THREE.Material).dispose()
          active.splice(i, 1)
        }
      }
    },
    activeCount() { return active.length },
  }
}
```
- [ ] **Step 2: Expand layout in main.ts** — export `DISTRICT_ANCHORS` with the 9 vectors above (existing 5 keep current offsets; rename usage of DISTRICT_OFFSETS array to derive from the record, order: mainThread, lifecycle, touchPipeline, zygote, gc + 4 new). Overview constants become `OVERVIEW_POS (0,110,150)`, `OVERVIEW_TARGET (0,0,40)`. Create `const packets = createPacketSystem(city.scene)` and call `packets.update(dtMs)` in the frame loop. Instantiate bus: `const bus = createBus()` — pass to all scenario factories (they don't accept it yet; that lands per-scenario in Tasks 7-12; for THIS task only wire layout/packets/fog, leave factories untouched and keep old offsets array temporarily mapped from the record).
- [ ] **Step 3: Fog** — `src/scene/city.ts`: `new THREE.Fog(0x0d1117, 150, 450)`; ground plane 300×300, grid 300/150.
- [ ] **Step 4: Verify** — `npm run build && npm test` green (52). **Step 5: Commit** — `feat: packet system + 9-district layout`

---

### Task 7: Boot district scenario + cold-city dimming

**Files:** Create `src/scenarios/boot.ts`; Modify `src/main.ts`

**Interfaces:**
- Consumes: `createBoot/advanceBoot/BOOT_STAGES` (Task 2), `Bus` (Task 1), builders, Scenario, makePanel.
- Produces: `makeBootScenario(bus: Bus): Scenario & { replayBoot(): void; isBooted(): boolean }` — extended type exported as `BootScenario`. Emits `boot:stageDone` per newly completed stage, `boot:complete` once. Default state: fully booted (idle city is lit). `replayBoot()` resets sim to dark and runs again (used by Chapter 1 and its panel button "Replay boot").
- Produces in main.ts: `setCityDim(dim: boolean)` — sets a shared dim multiplier: iterates all OTHER district groups, toggling visible on a THREE.Group child overlay? NO — simplest: main.ts keeps `dimmed: Set<string>` and scales each non-boot district group's building emissive via traversal ONCE per toggle: when dim, set `group.visible = false` for all districts except boot; when lit, restore `visible = true`. Boot district + ground always visible.

- [ ] **Step 1: Implement scenario** — 4 station buildings in a row (grey 0x484f58, w3 h3 d3, gap 5), labels = stage names; light up (emissive green like lifecycle floors) as `completed` grows; panel: title 'Boot = the city waking up', button 'Replay boot' → `replayBoot()`; narration shows last completed stage. update(): if not done, `state = advanceBoot(state, dtMs)`; diff `completed` vs `emitted` set → `bus.emit('boot:stageDone', {stage})` per new stage; on done-once → `bus.emit('boot:complete', {})`. Default construction: `state = advanceBoot(createBoot(), 10000)` (pre-booted, no events emitted for the pre-boot — initialize `emitted` from completed). `replayBoot()`: `state = createBoot()`, clear emitted set. setIdle: no idle behavior (booted city is its idle).
- [ ] **Step 2: main.ts wiring** — register boot district at its anchor; implement `setCityDim`; subscribe: `bus.on('boot:stageDone', ...)` not needed here; instead when `replayBoot` path used, chapters call setCityDim — for FREE MODE 'Replay boot' button also dim: main subscribes `bus.on('boot:complete', () => setCityDim(false))` and boot scenario's replayBoot triggers dim via a callback param passed into factory: `makeBootScenario(bus, onReplay: () => void)` where main passes `() => setCityDim(true)`.
- [ ] **Step 3: Verify** build+test green; dev-server curl check. **Step 4: Commit** — `feat: boot district with replayable cold-city sequence`

---

### Task 8: Launcher district + kiosk picking

**Files:** Create `src/scenarios/launcher.ts`; Modify `src/main.ts`

**Interfaces:**
- Consumes: `createLauncher/requestLaunch/markRunning/markStopped/APPS` (Task 3), Bus, builders, makePanel.
- Produces: `makeLauncherScenario(bus: Bus): Scenario & { kioskMeshes(): THREE.Object3D[] }`. Emits `app:launchRequested{app}` when a kiosk is clicked (or panel button pressed). Subscribes `activity:resumed{app}` → markRunning; nothing emits stops in v2 — markStopped unused by wiring (dead-end acceptable, panel 'Reset apps' button uses it).
- main.ts produces: raycast picking — on `pointerdown` on canvas, raycast against `launcherScenario.kioskMeshes()`; hit → scenario's `clickKiosk(name)` public method.

- [ ] **Step 1: Implement scenario** — plaza floor 14×14 (0x1c2128), 4 kiosk buildings (2×2.5×2) in 2×2 grid, each labeled with app name, `userData.app = name` on the body mesh. `clickKiosk(app)`: `const r = requestLaunch(state, app)`; if accepted → `state = r.state; bus.emit('app:launchRequested', { app })`, kiosk pulse animation (scale bounce via per-kiosk anim timer in update). Subscribe `activity:resumed` → `state = markRunning(state, app)`, kiosk gets steady emissive (running indicator). Panel: buttons 'Open chat/maps/camera/bank' calling clickKiosk + 'Reset apps' (markStopped all + notify... just resets local state). setIdle: idle occasionally (every 12s) auto-opens a random-by-rotation app IF none launching (drives whole causal chain ambiently once wiring lands in Task 12).
- [ ] **Step 2: main.ts** — raycaster on pointerdown (reuse existing pointerdown listener spot; new listener fine): `raycaster.setFromCamera(ndc, camera)`, intersect kioskMeshes, on hit call `launcherScenario.clickKiosk(hit.userData.app)`.
- [ ] **Step 3: Verify** build+test; curl. **Step 4: Commit** — `feat: launcher district with clickable app kiosks`

---

### Task 9: Network district scenario

**Files:** Create `src/scenarios/network.ts`; Modify `src/main.ts` (register)

**Interfaces:**
- Consumes: `startRequest/advanceRequest/NET_PHASES` (Task 4), Bus, builders, makePanel.
- Produces: `makeNetworkScenario(bus: Bus): Scenario`. Subscribes `data:requested` where `source === 'network'` → starts a request (queue if one in flight — max queue 3, drop beyond). Emits `net:phase{phase}` on each phase transition (including 'retry'), and `data:fetched{app, ms: totalMs}` on completion. Every 3rd request auto-injects `failAt: 'ttfb'` (deterministic counter) so retries visibly happen.
- Visual: radio tower (thin tall box 1×12×1 + sphere on top, red blinking light), gateway arch (two pillars + lintel). Phase progress = label sprite above tower showing current phase name + a small progress bar mesh. Request packet visual handled by main.ts wiring (Task 12) — this scenario only renders tower-local state.

- [ ] **Step 1: Implement** — per interface above; internal: `{ req: NetRequest; app: string } | null` + queue array; update(): advance, detect index/attempt changes vs previous → emit `net:phase`; on done → emit `data:fetched`, pop queue. Panel: 'Send test request', 'Send failing request' buttons; narration mirrors phase (only when NOT idle-driven — panel-triggered requests set a flag to enable narration). setIdle: no ambient of its own (requests arrive via bus).
- [ ] **Step 2: Register** in main.ts at anchor. **Step 3: Verify.** **Step 4: Commit** — `feat: network district with request lifecycle`

---

### Task 10: Database district scenario

**Files:** Create `src/scenarios/database.ts`; Modify `src/main.ts` (register)

**Interfaces:**
- Consumes: `createDb/query/insert/DB_QUERY_MS` (Task 5), Bus, builders, makePanel.
- Produces: `makeDatabaseScenario(bus: Bus): Scenario`. Subscribes `data:requested` where `source === 'db'` → after DB_QUERY_MS sim-time (accumulator), emits `data:cacheHit{app, stale: !fresh}` (on miss: still emits with `stale: true` — miss ≙ nothing useful, chapter narration explains; keep payload simple). Subscribes `data:fetched` → `db = insert(db, 'feed')` (network freshens cache).
- Visual: warehouse building (6×3×5, 0x8957e5 purple tint), 'Room DB' label, small crate stack that gains a glowing crate when insert happens, brief door-flash on query.

- [ ] **Step 1: Implement** per above. Panel: 'Query cache' button + narration showing hit/fresh state. setIdle: none (bus-driven).
- [ ] **Step 2: Register.** **Step 3: Verify.** **Step 4: Commit** — `feat: database district with cache freshness`

---

### Task 11: Bus wiring of existing 5 scenarios

**Files:** Modify `src/scenarios/{mainThread,lifecycle,touchPipeline,zygote,gc}.ts`, `src/main.ts`

**Interfaces — factory signatures become:**
```ts
makeMainThreadScenario(bus: Bus): Scenario
makeLifecycleScenario(bus: Bus): Scenario
makeTouchPipelineScenario(bus: Bus): Scenario
makeZygoteScenario(bus: Bus): Scenario
makeGcScenario(bus: Bus): Scenario
```
**Wiring (each scenario internally):**
- zygote: subscribe `app:launchRequested{app}` → `state = fork(state, app, 'foreground', 300)`; find new proc pid → `bus.emit('process:forked', { app, pid })`. (Existing idle fork keeps running but idle forks do NOT emit — only bus-triggered ones do; track via the subscription path.)
- lifecycle: subscribe `process:forked{app}` → if phase 'destroyed': `state = launch(state)`, then `bus.emit('activity:resumed', { app })`; if activity already resumed (occupied by prior app), finish-then-launch. After emitting resumed, start 600ms accumulator → on expiry emit `data:requested{app, source:'db'}` AND `data:requested{app, source:'network'}`. Subscribe `frame:rendered` → pulse a small screen mesh on the roof? NO — keep: top floor emissive flash 300ms.
- mainThread: subscribe `data:cacheHit` → `state = post(state, 'dbResult', 4)`, emit `ui:messagePosted{label:'dbResult'}`; subscribe `data:fetched` → `state = post(state, 'netResult', 16)`, emit `ui:messagePosted{label:'netResult'}`.
- touchPipeline: subscribe `ui:messagePosted` → if `!run || run.done`: start normal frame, and on that frame's completion emit `frame:rendered{dropped}` (emit for ALL completed frames including idle/button ones — single emit point in the done-transition branch).
- gc: subscribe `data:fetched` → allocate 3×80KB (silent, catch OOM). In the existing sweep-completion point (sweepX crosses 7): emit `gc:swept{freedKb: state.lastFreedKb}`.
- main.ts packet hops — subscribe once, launching packets between DISTRICT_ANCHORS (duration 900, arc 8):
  `app:launchRequested`: launcher→zygote (0x3fb950); `process:forked`: zygote→lifecycle (0x3fb950); `data:requested` source db: lifecycle→database (0xbc8cff) / source network: lifecycle→network (0xd29922); `data:cacheHit`: database→mainThread (0xbc8cff); `data:fetched`: network→mainThread (0xd29922); `ui:messagePosted`: mainThread→touchPipeline (0x76e3ea).
- TIMING CAVEAT (accepted simplification): sim reactions fire immediately on bus events; packets are decorative and may still be mid-flight — do not gate sim on packet arrival.

- [ ] **Step 1: Wire each scenario** per list (5 small edits, factory signature + subscriptions; unsubscribe functions stored but never called — scenarios live for page lifetime).
- [ ] **Step 2: main.ts** — pass bus to all factories; add packet-hop subscriptions.
- [ ] **Step 3: Verify** — build+test green (52); curl. Manual causality check impossible headless — note pending.
- [ ] **Step 4: Commit** — `feat: bus wiring — full causal chain across districts`

---

### Task 12: StoryPlayer core (TDD)

**Files:** Create `src/story/player.ts`; Test `tests/story/player.test.ts`

**Interfaces — Produces:**
```ts
export interface Step {
  readonly narration: string
  readonly focus: string                       // district id | 'overview'
  readonly fire?: () => void
  readonly waitFor: { event: CityEventName } | { ms: number }
}
export interface Chapter {
  readonly id: string
  readonly title: string
  readonly setup?: () => void                  // e.g. dim city, fast-forward prereqs
  readonly steps: readonly Step[]
}
export interface PlayerCallbacks {
  onStep(step: Step, index: number, total: number, title: string): void
  onChapterDone(): void
}
export interface Player {
  play(ch: Chapter): void
  pause(): void
  resume(): void
  next(): void            // force-complete current wait
  restartChapter(): void
  stop(): void
  setSpeed(x: 1 | 2): void
  update(dtMs: number): void
  readonly playing: boolean
}
export function createPlayer(bus: Bus, cbs: PlayerCallbacks): Player
```
Semantics: `play` runs setup, enters step 0: calls `onStep`, fires `fire`, arms wait. ms-waits count via `update(dtMs * speed)`; event-waits resolve on bus emit (subscription armed BEFORE `fire` runs — no lost-event race). When wait resolves → advance to next step or `onChapterDone`. `pause` freezes ms-waits and defers event-arrival advancement until resume (event during pause is remembered). `next` force-advances. `stop` cancels subscriptions, playing=false. `restartChapter` = stop + play(same chapter).

- [ ] **Step 1: Failing tests** (fake bus = real createBus; no three.js needed):
```ts
import { describe, it, expect, vi } from 'vitest'
import { createPlayer, type Chapter } from '../../src/story/player'
import { createBus } from '../../src/core/bus'

function chapter(steps: Chapter['steps']): Chapter {
  return { id: 'test', title: 'Test', steps }
}

describe('storyPlayer', () => {
  it('runs setup and enters step 0, firing action after arming wait', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: vi.fn() })
    const fire = vi.fn(() => bus.emit('boot:complete', {})) // emits synchronously — must still be caught
    p.play(chapter([{ narration: 'a', focus: 'boot', fire, waitFor: { event: 'boot:complete' } }]))
    expect(onStep).toHaveBeenCalledTimes(1)
    expect(fire).toHaveBeenCalled()
  })
  it('advances on event and completes chapter', () => {
    const bus = createBus()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep: vi.fn(), onChapterDone: done })
    p.play(chapter([{ narration: 'a', focus: 'boot', waitFor: { event: 'boot:complete' } }]))
    bus.emit('boot:complete', {})
    expect(done).toHaveBeenCalled()
    expect(p.playing).toBe(false)
  })
  it('ms wait advances via update, scaled by speed', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: vi.fn() })
    p.play(chapter([
      { narration: 'a', focus: 'overview', waitFor: { ms: 1000 } },
      { narration: 'b', focus: 'overview', waitFor: { ms: 1000 } },
    ]))
    p.setSpeed(2)
    p.update(500) // 500*2 = 1000 → step 1
    expect(onStep).toHaveBeenCalledTimes(2)
  })
  it('pause freezes ms waits; resume continues', () => {
    const bus = createBus()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep: vi.fn(), onChapterDone: done })
    p.play(chapter([{ narration: 'a', focus: 'overview', waitFor: { ms: 100 } }]))
    p.pause()
    p.update(1000)
    expect(done).not.toHaveBeenCalled()
    p.resume()
    p.update(100)
    expect(done).toHaveBeenCalled()
  })
  it('event during pause is remembered and applied on resume', () => {
    const bus = createBus()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep: vi.fn(), onChapterDone: done })
    p.play(chapter([{ narration: 'a', focus: 'boot', waitFor: { event: 'boot:complete' } }]))
    p.pause()
    bus.emit('boot:complete', {})
    expect(done).not.toHaveBeenCalled()
    p.resume()
    expect(done).toHaveBeenCalled()
  })
  it('next force-advances; stop halts everything', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: done })
    p.play(chapter([
      { narration: 'a', focus: 'boot', waitFor: { event: 'boot:complete' } },
      { narration: 'b', focus: 'boot', waitFor: { ms: 5000 } },
    ]))
    p.next()
    expect(onStep).toHaveBeenCalledTimes(2)
    p.stop()
    expect(p.playing).toBe(false)
    p.update(10000)
    expect(done).not.toHaveBeenCalled()
  })
})
```
- [ ] **Step 2: RED.** **Step 3: Implement** (~90 lines: closure state `{ chapter, index, waitElapsed, paused, speed, pendingEvent, unsub }`; `enterStep(i)`: onStep → arm wait (event: `unsub = bus.on(e, handler)`; handler: if paused set pendingEvent else advance) → fire?.(); advance(): unsub, index+1 or onChapterDone+cleanup). Careful: arm subscription before calling fire (test 1).
- [ ] **Step 4: GREEN** (58 total). **Step 5: Commit** — `feat: story player core`

---

### Task 13: Chapters 1+2 + story UI

**Files:** Create `src/story/chapters/ch1-boot.ts`, `src/story/chapters/ch2-launch.ts`; Modify `src/main.ts`, `index.html`

**Interfaces:**
- Chapter factories: `makeCh1(ctx): Chapter`, `makeCh2(ctx): Chapter` where `ctx = { bus: Bus, boot: BootScenario, launcher: ReturnType<typeof makeLauncherScenario>, setCityDim(d: boolean): void }` — exported as `StoryCtx` from `src/story/chapters/ctx.ts` (create this tiny file here).
- main.ts produces: story bar UI (dropdown '▶ Story': Play all, Chapter 1-4 — ch3/ch4 entries added Task 14), narration card `#story-card` (hidden by default), player instance wired: `onStep` → set card text (title, narration, `i/N`), fly camera to `DISTRICT_ANCHORS[focus] + district cameraPos` (reuse existing per-district framing; focus 'overview' → overview), disable district switcher buttons during story; controls in card: ⏮ restartChapter, ⏸/▶ pause-resume, ⏭ next, 1x/2x toggle, ✕ stop (also Esc key). `onChapterDone` → if playing "Play all" advance to next chapter, else show "Chapter done — ✕ to exit or ▶ next chapter".

**Chapter 1 (Power On)** steps (narrations verbatim):
1. focus overview, fire: `ctx.setCityDim(true); ctx.boot.replayBoot()`, wait `{ms: 1500}` — "This is Android as a city. Right now the power is off. Let's boot it."
2. focus boot, wait `{event:'boot:stageDone'}` — "The bootloader wakes first — tiny program, one job: load the kernel."
3. focus boot, wait `{event:'boot:stageDone'}` — "The kernel takes over: processes, memory, drivers — the city's laws of physics."
4. focus boot, wait `{event:'boot:stageDone'}` — "init starts userspace — the first civilian process, PID 1."
5. focus boot, wait `{event:'boot:complete'}` — "system_server ignites: ActivityManager, WindowManager, PackageManager — city hall opens."
6. focus zygote, fire none, wait `{ms: 2500}` — "Zygote is already warm: a pre-loaded process with the framework in memory, waiting to be copied."
7. focus launcher, wait `{ms: 2500}` — "The launcher — your home screen — is itself just an app. The city is awake." (setup of ch1 already lit city on boot:complete via main's subscription)

**Chapter 2 (App Launch)** steps:
1. focus launcher, fire: `ctx.launcher.clickKiosk('chat')`, wait `{event:'app:launchRequested'}` — "You tap the chat icon. The launcher doesn't start the app — it asks the system to."
2. focus zygote, wait `{event:'process:forked'}` — "Zygote forks: the warm process is copied in milliseconds. That's why apps start fast."
3. focus lifecycle, wait `{event:'activity:resumed'}` — "The new process builds your Activity: onCreate → onStart → onResume, floor by floor."
4. focus touchPipeline, wait `{event:'frame:rendered'}` — "Nothing is on screen until a frame runs the full pipeline before the 16.67ms deadline."
5. focus lifecycle, wait `{ms: 2500}` — "First frame delivered. The app is on screen — but it has no data yet. That's the next chapter."
Chapter 2 `setup`: if city dimmed → setCityDim(false); ensure chat not already running (`launcher` panel reset logic exposed as `ctx.launcher.resetApps()` — add this public method in this task, calls markStopped for all).

- [ ] **Step 1: ctx.ts + both chapter files** (pure data + fire closures).
- [ ] **Step 2: main.ts story UI + card styles in index.html** (`#story-bar` dropdown top-right; `#story-card` bottom-center, ~520px, title + text + step counter + 5 control buttons; `.active` styles reused).
- [ ] **Step 3: Verify** build+test green; curl. **Step 4: Commit** — `feat: story chapters 1-2 + story UI`

---

### Task 14: Chapters 3+4, Play all, README

**Files:** Create `src/story/chapters/ch3-data.ts`, `ch4-frame.ts`; Modify `src/main.ts`, `README.md`

**Interfaces:** `makeCh3(ctx)`, `makeCh4(ctx)` — ctx unchanged plus `ctx.mainThread`/`ctx.touchPipeline` NOT needed: chapters fire via bus emits and launcher only. Extend `StoryCtx` with `bus` uses only.

**Chapter 3 (Getting Data)** — setup: ensure chat running (if not: `launcher.clickKiosk('chat')` and fast-forward — wait handled by first step's event). Steps:
1. focus lifecycle, wait `{event:'data:requested'}` — "The app needs your messages. It asks two places at once: the local database and the network."
2. focus database, wait `{event:'data:cacheHit'}` — "Room answers in ~30ms — but the data is stale, from your last session. Show it anyway: stale beats blank."
3. focus mainThread, wait `{event:'ui:messagePosted'}` — "The result rides the main thread road like any other message. UI renders the cached view."
4. focus network, wait `{event:'net:phase'}` — "Meanwhile the real fetch: DNS, connect, TLS handshake, waiting for first byte, download. Every phase costs."
5. focus network, wait `{event:'data:fetched'}` — "If a phase times out, OkHttp retries with backoff. There it is — fresh data, ~1.2 seconds after the cache answered."
6. focus mainThread, wait `{event:'ui:messagePosted'}` — "Fresh data takes the same road. The UI re-renders — you saw stale-then-fresh, and never a spinner."
7. focus gc, wait `{event:'gc:swept'}` — "The stale objects are garbage now. The collector sweeps them. Memory is a city that cleans itself."
(gc:swept requires gc district's sweep to run; gc allocates on data:fetched and its idle release+pressure eventually sweeps — to bound the wait, ch3 fire on step 7: `bus`-independent — give gc scenario a public `forceSweep()` method (calls gc sim + starts sweep visual + emits gc:swept); add that public method in this task.)

**Chapter 4 (The 16ms Race)** — reuses touchPipeline: setup none. Steps:
1. focus touchPipeline, fire: emit `ui:messagePosted{label:'tap'}` via bus, wait `{event:'frame:rendered'}` — "Every visible change is a race: 16.67 milliseconds from input to pixel, 60 times a second."
2. focus touchPipeline, fire: touchPipeline needs heavy-frame trigger — add public `runHeavyFrame()` (this task), wait `{event:'frame:rendered'}` — "Overdraw, deep layouts, bitmap decodes on the UI thread — the frame misses its train. That's jank."
3. focus mainThread, fire: mainThread public `injectBlock(8000)` (add this task — posts the 8s message like its button), wait `{ms: 6000}` — "Block the main thread long enough and the system loses patience: ANR — Application Not Responding."
4. focus overview, wait `{ms: 3000}` — "That's the whole machine: boot, fork, lifecycle, data, frames. One connected city, sixty deadlines a second."

- [ ] **Step 1: Public methods** — `gc.forceSweep()`, `touchPipeline.runHeavyFrame()`, `mainThread.injectBlock(ms)` (each ~3 lines, reusing button logic).
- [ ] **Step 2: Chapter files + register ch3/ch4 + Play all** (onChapterDone chains array of chapters when playAll flag set).
- [ ] **Step 3: README** — update districts list + story feature paragraph.
- [ ] **Step 4: Verify** build+test green. **Step 5: Commit** — `feat: story chapters 3-4 + play all`

---

### Task 15: Deploy + live verification

**Files:** none new.

- [ ] **Step 1:** `npm run build && npm test` full green (58 expected).
- [ ] **Step 2:** `git push` → wait for Actions → `gh run list --limit 1` success.
- [ ] **Step 3:** `curl -s -o /dev/null -w '%{http_code}' https://thuat.dev/droidcity/` → 200.
- [ ] **Step 4:** Report: visual + story playthrough verification pending human (or Chrome extension if connected).

---

## Self-Review Notes

- Spec coverage: bus ↔ T1; 4 sims ↔ T2-5; packet+layout ↔ T6; 4 districts ↔ T7-10; causal wiring ↔ T11; player ↔ T12; chapters+UI ↔ T13-14; deploy ↔ T15. Spec's `once()` on Bus dropped (player uses on/unsub — YAGNI). Spec's netFetch `failAt` opts + deterministic every-3rd failure ↔ T9. Cache-then-network ↔ ch3.
- Type consistency: `CityEvents` payloads match every emit/subscribe listed in T7-T11 and chapter waits in T13-14. `BootScenario` extended type consumed by ctx (T13). `clickKiosk`/`resetApps` (T8/T13), `forceSweep`/`runHeavyFrame`/`injectBlock` (T14) — all public-method names consistent where produced/consumed.
- Known simplifications: packets decorative (sims don't wait for arrival); event-wait steps can complete before their packet lands (acceptable — narration covers); unsubs never called (page-lifetime scenarios); launcher markStopped only via Reset/ch2 setup.
