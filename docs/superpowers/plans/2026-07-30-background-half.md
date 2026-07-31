# The Background Half Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Model the three biggest remaining Android concepts, which share one machine: **deferred work** (WorkManager/JobScheduler + Doze), **reclaim before the kill** (kswapd/zram between PSI and LMK), and **foreground services** (the FGS notification + its own ANR timer).

**Architecture:** Two new pure sims (`jobs`, `reclaim`) with tests; a job depot inside the City Hall scenario; a zram/reclaim stage on the hardware strip's PSI block; FGS as a flag on the existing ward service annex that posts through the notification pipeline already built. No changes to the board layout.

## Global Constraints

- Pure sims (`src/sim/*`) stay pure and immutable; every new sim gets unit tests.
- Android green `0x3ddc84` = alive/running. Amber `0xd29922` = deferred/waiting. Red `0xf85149` = kill.
- No coplanar overlaps; new geometry clears existing footprints (see ward.ts position map).
- 123 existing tests keep passing; commit per task; deploy once at the end.
- Doze must be reversible and must not deadlock story mode: story chapters run with idle disabled, so Doze is a manual toggle only, and `stopStory()` clears it.

---

### Task 1: jobs sim (`src/sim/jobs.ts`)

**Interfaces produced:**
```ts
export type JobConstraint = 'network' | 'charging' | 'idle'
export interface Job { readonly id: number; readonly app: string; readonly constraint: JobConstraint }
export interface JobsState {
  readonly pending: readonly Job[]   // waiting for constraints (or for a maintenance window)
  readonly running: readonly Job[]   // dispatched to their app
  readonly done: number
  readonly nextId: number
  readonly doze: boolean             // device idle: nothing dispatches except in a window
}
createJobs(): JobsState
enqueueJob(s, app, constraint): JobsState
setDoze(s, doze: boolean): JobsState
// Dispatch: constraints satisfied AND (not doze OR a maintenance window is open).
runnableJobs(s, env: { network: boolean; charging: boolean; idle: boolean; window: boolean }): readonly Job[]
dispatchJobs(s, env): JobsState        // moves runnable pending -> running
finishJob(s, id): JobsState            // running -> done++
cancelJobsFor(s, app): JobsState       // process death cancels its jobs (they're rescheduled by WM in reality)
```
- [ ] Step 1: tests, enqueue queues; a `network` job with `network:false` is not runnable; under Doze nothing is runnable until `window:true`; dispatch moves pending→running; finish increments done; cancelJobsFor drops both pending and running for that app; ids increase.
- [ ] Step 2: run tests → FAIL
- [ ] Step 3: implement (pure, spread updates)
- [ ] Step 4: tests PASS
- [ ] Step 5: commit `feat: pure jobs sim, constraints, Doze windows, per-app cancel`

### Task 2: reclaim sim (`src/sim/reclaim.ts`)

Models the step the city currently skips: under pressure the kernel reclaims *before* anything dies.

```ts
export interface ReclaimState {
  readonly zramKb: number        // pages compressed into zram
  readonly reclaimedKb: number   // running total handed back
  readonly attempts: number      // kswapd passes since the last kill
}
createReclaim(): ReclaimState
// One kswapd pass: compresses a slice of the ward heaps into zram and returns
// how much it handed back. Returns null when reclaim can't keep up any more
// (attempts >= MAX_PASSES), which is the signal that lmkd must kill.
reclaimPass(s, pressureFrac: number): { state: ReclaimState; freedKb: number; exhausted: boolean }
resetReclaim(s): ReclaimState   // after a kill, pressure drops and the counter clears
```
- [ ] Step 1: tests, a pass frees > 0 and grows zram; freed shrinks as attempts accumulate (diminishing returns); `exhausted` true only after MAX_PASSES; reset clears attempts but keeps totals.
- [ ] Step 2–4: RED → implement → GREEN
- [ ] Step 5: commit `feat: pure reclaim sim, kswapd passes into zram before any kill`

### Task 3: job depot in City Hall

**Files:** `src/scenarios/cityHall.ts`

- A depot block beside the AMS/WMS/PMS wings (local position clear of the three wing meshes, check existing `position.set` calls first), tooltip: *"JobScheduler: WorkManager enqueues here. Jobs wait for their constraints (network, charging, idle) and, in Doze, for the next maintenance window. The system batches them; your app does not choose when."*
- Pending jobs render as amber crates stacked on the depot apron (cap 6 visible, one per pending job); running jobs light green.
- A **Doze dome**: a large translucent hemisphere over the board's center, visible only while Doze is on, tooltip: *"Doze: deep idle. Network off, alarms and jobs deferred to periodic maintenance windows that get further apart the longer the device stays still."*
- Exports: `enqueueJob(app, constraint)`, `setDoze(on)`, `openWindow()`, `stats(): { pending: number; running: number; done: number; doze: boolean }`, `dozeDomeMesh()`.
- Panel buttons: `Enqueue job (network)`, `Enqueue job (charging)`, `Doze on/off`, `Maintenance window`.
- [ ] Steps: build geometry → wire panel → verify visually → commit `feat: job depot in system_server, JobScheduler queue, Doze dome, maintenance windows`

### Task 4: reclaim stage on the hardware strip

**Files:** `src/scenarios/hardwareRow.ts`

- A **zram block** west of PSI (x between RAM's east edge 11.8 and PSI_X 14 is too tight → place at `x = 20`, clear of DISK at 30), tooltip: *"zram, a compressed swap file in RAM. Under pressure kswapd compresses cold pages here instead of killing: slower memory beats a dead process."*
- Its fill height tracks `zramKb`; a blue pulse per reclaim pass.
- Exports: `setZram(frac)`, `pulseReclaim()`.
- [ ] Steps: build → export → commit `feat: zram block on the hardware strip`

### Task 5: wire the pressure ladder in main.ts

Current: PSI edge → `memory:pressure` → foundry kills the top `oom_adj`.
New ladder, in order:
1. PSI edge fires → run `reclaimPass`. Pulse the zram block, blink the RAM bank, narrate "kswapd reclaimed NNN KB into zram".
2. Only when `exhausted` → emit `memory:pressure` (the existing kill path), then `resetReclaim`.
- Also: `bus.on('process:killed')` → `cancelJobsFor(app)`; job dispatch tick (every HUD tick) calls `dispatchJobs` with env `{ network: !doze, charging: false, idle: doze, window: windowOpenMs > 0 }`; dispatched jobs fly a packet City Hall → ward and finish after a visible delay, incrementing `done`.
- Doze must gate the ambient auto-launch and network idle behavior: while Doze is on, `launcherPlaza.setIdle(false)` and the network tower's idle fetches stop, that IS the concept.
- [ ] Steps: wire → verify in browser (enqueue under Doze → nothing runs → open a window → it runs) → commit `feat: reclaim-then-kill ladder + job dispatch under Doze`

### Task 6: foreground service

**Files:** `src/wards/manager.ts`, `src/wards/panel.ts`, `src/wards/entry.ts`, `src/scenarios/*` as needed

- `entry.fgs: boolean`. `promoteToForegroundService(app)` requires `serviceRunning` (else panel message "start the service first"), sets `fgs`, posts a notification through the existing pipeline (`postNotification`), and raises the foundry priority so the ward outranks cached wards under LMK (use the existing `setAppPriority` with the foreground-service tier).
- The service annex renders brighter + a green lamp while FGS; the notification row on the glass is **non-dismissable** while it holds (tap still opens the app), tooltip names the rule: *"A foreground service must show a notification, and the user can't swipe it away. It also gets the 20s ANR timer instead of 200s."*
- Panel button `Promote to FGS` / `Demote`.
- [ ] Steps: sim-free (visual + priority) but add a manager test: promote without a running service is rejected; promote sets fgs and posts; demote clears.
- [ ] Commit `feat: foreground services, mandatory notification, LMK survival, 20s ANR timer`

### Task 7: docs + README

- `docs/android-flow-reference.md`: move WorkManager/JobScheduler/Doze and power-management entries from 📖 to 🏙 *(modeled)* with a Background-Half note; flip the `zram/kswapd reclaim before killing` audit row from ❌ to ✅; add FGS to the components entry; changelog line.
- README: new bullets under the ward list (FGS) and a short "Background work" section (job depot, Doze, reclaim-before-kill).
- [ ] Commit `docs: background half, jobs, Doze, reclaim, foreground services`

## Verification

- `npm run build && npx vitest run` after every task (expect 123 + new).
- Deploy once at the end; then in the browser: enqueue two jobs → Doze on → they stay amber → maintenance window → they run green and `done` ticks; hold PSI high → narration shows kswapd/zram passes before any kill, and the kill only lands after reclaim is exhausted; start a service → promote to FGS → notification appears and can't be dismissed, ward survives a pressure round that kills a cached ward.
