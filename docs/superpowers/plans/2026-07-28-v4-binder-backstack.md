# DroidCity v4 — Binder Mechanics, Back Stack, Pool/PSI Realism

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Ship the v4 backlog from `docs/android-flow-reference.md`: Binder mechanics beats, tasks & back stack, ANR ladder, connection-pooling warm-skip, PSI-driven LMK trigger, servicemanager/HWC/BufferQueue notes.

## Global Constraints
- `src/sim/**` UNTOUCHED. Bus additions additive only: `'memory:pressure': Record<string, never>`, `'activity:pushed': { app: string; depth: number }`, `'activity:popped': { app: string; depth: number }`.
- Tests stay green (82) + new ones noted. Conventional commits, no attribution footer. Disposal discipline. Files <400 lines.

### Task 1: Tooltip/narration batch — Binder, servicemanager, HWC, ANR ladder
- cityHall.ts tooltips: main building note append ' servicemanager is the phone book: every Binder client asks it for handles.'; add wing/mailroom tooltips or extend existing: { title: 'Binder', note: 'One-copy IPC via mmap. Each process runs a ~16-thread binder pool; transactions share a ~1MB buffer — blow it and you get TransactionTooLargeException.' } on an appropriate mesh (add a small mailbox prop if no mesh fits).
- Death recipients: cityHall subscribes `process:killed` → brief red pulse + narration line 'Death recipient fired — system_server noticed the process die (linkToDeath).' (subscription exists for pulse? check — activity:resumed pulses; add killed handler.)
- ward.ts anrOverlay tooltip: { title: 'ANR', note: 'Blocked main looper. Timers: input 5s · foreground service 20s · broadcast 10s (60s background).' }
- surfaceFlinger.ts: compositor tooltip note append ' Frames arrive through BufferQueues — triple buffering absorbs hiccups.'; display wall note append ' HWC composites overlays in hardware when it can — GPU only when it must.'
- ch2 Binder-hop step (activity:resumed wait) narration append: ' That hop was a Binder call — one copy, straight into system_server\'s thread pool.'
- Commit `feat: binder + compositor teaching beats`.

### Task 2: Tasks & back stack
- manager entry gains `backStack: number` (0 = just the root activity). Public `pushActivity(app)` (max 3: no-op beyond) and `popActivity(app)`: pop at 0 → finish root: `entry.activity = finish(entry.activity)` → floors dark, phase destroyed, ward stays (process alive = warm-start material; foundry priority → cached via existing goHome-style call). Push/pop emit activity:pushed/popped.
- Visual: stacked translucent cards behind tower (one 2×0.3×2 plate per stacked activity, x offset behind tower, stack up). Built/disposed dynamically per push/pop (disposal discipline) OR pre-built 3 hidden plates toggled visible — PREFER pre-built hidden (no dynamic churn), part of buildWardMeshes + disposables; WardMeshes gains `stackCards: readonly THREE.Mesh[]` (3).
- Tooltips: stackCards { title: 'Back stack', note: 'Activities stack in a task. Back pops the top one; the last pop leaves the process alive — a warm start next time.' }
- Panel buttons: 'Open screen' (push), 'Back' (pop). Ward label unaffected.
- Relaunch of finished-root ward (phase destroyed, ward alive): broughtToFront path expects stopped/resumed — extend manager onBroughtToFront: phase 'destroyed' (ward alive) → `entry.activity = launch(entry.activity)` (warm start WITH Activity recreate — narrate via onStartType 'warm'). launcherPlaza accept path: requestLaunch rejects only launching/running — after finish-root the launcher still lists app running? markStopped only fires on process:killed — launcher thinks running → clickKiosk emits broughtToFront ✓ reaches manager ✓. Trace in report.
- Tests (+2): push/pop counts + events; pop-at-0 finishes root (phase destroyed, ward alive) and relaunch via broughtToFront relights.
- Commit `feat: tasks and back stack in wards`.

### Task 3: Connection pooling + PSI-driven LMK
- networkTower.ts: per-app pooledUntil map (accumulated scenario clock, no Date.now). After a request completes for app: pooled for 30_000 sim-ms. Next request from pooled app: enqueue with `startRequest()` pre-advanced 500 sim-ms (`advanceRequest(startRequest(), 500)` — skips dns/connect/tls, starts at ttfb) + phase label prefix 'pooled·'; emit net:phase{phase:'pooled'} once at enqueue so HUD/story see it. failAt requests unaffected (counter path unchanged — apply pre-advance only when no failAt).
- PSI-driven LMK: main.ts (hardwareWiring owns smoothed pressure): when smoothed pressure crosses 0.85 upward (edge-trigger, rearm below 0.7), emit `memory:pressure`. foundry subscribes: emit memory:trim, then killOldestCached (existing idle 25s cached-kill stays as fallback). HUD HARDWARE chip: pressure ≥85% renders 'PSI nn%!' red styling if cheap (skip styling if fiddly).
- Tooltip: network tower note append ' Warm connections skip DNS/connect/TLS — pooling.'
- Tests: bus-level only (+1): emit memory:pressure with 2 procs (1 cached) → process:killed emitted for cached one (foundry test file? foundry has no test file — put in tests/wards/manager.test.ts style? foundry is scenario w/ three.js... construct with real bus in a new tests/scenarios/foundry.test.ts IF it imports three — it does (meshes). Skip unit test; note visual/manual verification. Instead add pressure edge-trigger pure helper in hardwareWiring exported + tiny test if trivial; else skip tests entirely with note.)
- Commit `feat: connection pooling + psi-driven lmk trigger`.

### Task 4: Docs + deploy
- android-flow-reference.md: audit rows updated (connection pooling ✅, PSI-driven kills ✅, BufferQueue/HWC ✅ tooltip-level, servicemanager ✅ note, Binder mechanics 🏙 → shipped-partial note, tasks & back stack 🏙 → shipped note, ANR ladder → shipped note); v4 backlog line rewritten to remaining (bound services, ContentProviders, JIT/AOT, multi-window, predictive back animation).
- README: ward blurb + back stack mention.
- build+test, push, Actions success, curl 200.
- Commit `docs: v4 shipped`.

## Self-Review
- finish() from destroyed phase is a no-op (sim guard) — pop-at-0 path calls finish only when phase not destroyed; trace in Task 2.
- activity:pushed/popped consumed by nobody initially (forward hooks) — fine.
- Pooled pre-advance never yields attempt-1 dns emission — phase-diff sentinel starts at NOT_STARTED → first observed index is ttfb; emit synthetic 'pooled' phase covers narrative. netFetch sim untouched.
- memory:pressure edge-trigger prevents kill-spam; rearm hysteresis 0.7.
