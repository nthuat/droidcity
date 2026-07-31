# DroidCity v3, Start Types, Services, Intents

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Model the concept-atlas 🏙 items: cold/warm/hot starts, Services (process-keeping + oom_adj effect), Intents/broadcasts, plus Chapter 5 "Coming Back" teaching the start-type ladder.

## Global Constraints
- `src/sim/**` UNTOUCHED (launcher reject logic, lifecycle background/foreground already suffice; service state lives in manager entries; priorities via foundry).
- Bus events additive only: `'app:broughtToFront': { app: string; start: 'warm' | 'hot' }`, `'service:changed': { app: string; running: boolean }`, `'broadcast:sent': { action: string }`.
- 78 tests stay green; add tests where noted. Conventional commits, no attribution footer. Disposal discipline for any dynamic mesh.

### Task 1: Warm/hot starts + Home
**Behavior:**
- launcherPlaza.clickKiosk(app): if app RUNNING (its sim rejects) → don't drop: determine start type via a new manager query `activityPhase(app): Phase | null`, phase 'stopped' → warm, 'resumed' → hot; emit `app:broughtToFront{app, start}` + kiosk pulse. (Launcher sim untouched, branch in scenario.)
- manager subscribes broughtToFront: warm → `entry.activity = foreground(entry.activity)` (floors relight 1→3) + also tell foundry the app is foreground again (`foundry.setAppPriority(app,'foreground')`, ADD this public method: setPriority on the named proc); hot → screen flash + brief tower pulse (scale bounce 200ms). BOTH: emit `activity:resumed{app}` (semantics: activity comes to front, story waits unaffected since chapter waits are app-filtered and chapters control their own apps).
- Ward panel gains 'Home' button: `entry.activity = background(entry.activity)` (floors dim to 1) + `foundry.setAppPriority(app, entry.serviceRunning ? 'service' : 'cached')` (serviceRunning arrives Task 2, until then always 'cached'; write it reading a `entry.serviceRunning ?? false`).
- Start-type feedback: ward label line 3 flashes `cold start` (on spawn) / `warm start` / `hot start` for 3s (main.ts label update path; manager exposes lastStartType+timestamp via wardStats extension or callback, simplest: new optional dep callback `onStartType(app, type)`; main flashes label).
- Tests: manager warm path, fork, background via panel logic (call through public API: add `goHome(app)` public method used by panel), emit broughtToFront warm → assert activity:resumed emitted + phase resumed. 1-2 tests.
- Commit `feat: warm and hot starts + home button`.

### Task 2: Services + broadcasts
**Service annex (ward):**
- ward.ts: small annex building (2×1.8×2) beside tower, dark; `serviceAnnex` in WardMeshes; tooltip { title: 'Service', note: 'Runs with no UI. Keeps the process off the kill list, oom_adj 500 instead of 900.' }.
- manager: entry.serviceRunning boolean (default false); public `toggleService(app)`: flips, annex emissive on/off (amber), emits `service:changed`; if ward currently backgrounded (phase stopped) update foundry priority accordingly (service ↔ cached). Panel button 'Start service'/'Stop service' (label flips). oom_adj ward label reflects it via existing foundry stats path automatically.
- Teaching hook: foundry killOldestCached already only kills 'cached', a backgrounded ward WITH service (priority 'service') survives LMK sweeps. No code needed beyond priority, narrate in tooltip + panel narration line when service on: 'Service running: LMK will take cached wards first.'
**Broadcasts:**
- cityHall panel gains button 'Send broadcast' → emit `broadcast:sent{action:'NEWS'}`; main.ts subscribes: packet fan-out cityhall → each living ward (routes.path plotKey fallback); manager subscribes: each non-dying ward `looper = post(looper,'onReceive',6)` + emit ui:messagePosted{label:'onReceive'}.
- boot:complete in free-mode replay: main emits `broadcast:sent{action:'BOOT_COMPLETED'}` once per replay (subscribe boot:complete → emit; wards react as above). City Hall tooltip note appends: 'Intents resolve here: PMS matches them against every app's declared filters.'
- Tests: manager broadcast reaction (emit broadcast:sent → ui:messagePosted per living ward, dying excluded). 1 test.
- Commit `feat: service annex + broadcasts`.

### Task 3: Chapter 5, "Coming Back" + intent narration
- ch2 step 1 narration append: ' That request is an Intent: a typed envelope City Hall knows how to route.'
- New src/story/chapters/ch5-back.ts, id 'ch5', title 'Coming Back'. Setup: ensure chat running (clickKiosk if absent). Steps (waits app-filtered where events carry app):
  1. narration 'Chat is running: this ward cost a full cold start: fork, Application, Activity, first frame. Let's see the cheaper ways back.' focus 'ward:chat', wait {ms 4000}
  2. fire `ctx.wards.goHome('chat')`, 'Home. The Activity stops: floors dim, and the process drops to cached, oom_adj 900. Nothing is destroyed.' focus 'ward:chat', wait {ms 4000}
  3. fire `ctx.launcher.clickKiosk('chat')`, 'Tap again: a WARM start. No fork, no Application, the floors just relight. Milliseconds, not seconds.' focus 'ward:chat', wait {event 'app:broughtToFront'}
  4. fire `ctx.launcher.clickKiosk('chat')`, 'Again, while it's already resumed: a HOT start, nothing to rebuild at all, just bring the window forward.' focus 'ward:chat', wait {event 'app:broughtToFront'}
  5. fire `ctx.wards.toggleService('chat'); ctx.wards.goHome('chat')`, 'Now a Service: the annex lights. Backgrounded WITH a service, the process holds oom_adj 500, the crane takes cached wards first.' focus 'ward:chat', wait {ms 5000}
  6. fire `ctx.killApp('chat')`, 'But nothing is immortal. SIGKILL: and the next tap will be a cold start again… except saved state makes even that cheap.' focus 'ward:chat', wait {ms 4000}
  7. fire `ctx.launcher.clickKiosk('chat')`, 'Fork, restore, resume. Cold, warm, hot: now you know the whole ladder.' focus 'ward:chat', wait {event 'activity:resumed', app 'chat'}
- StoryCtx extends: wards gains goHome/toggleService (already public from T1/T2). Register ch5 in menu + play-all.
- Commit `feat: chapter 5, coming back (start types, services)`.

### Task 4: Docs + deploy
- android-flow-reference.md: atlas 🏙 entries for components(services partial)/cold-warm-hot get '✅ (v3)' notes; add 'Broadcasts modeled minimally' note. README chapter list + districts blurb update.
- build+test, push, Actions success, curl 200.
- Commit `docs: v3 coverage updates`.

## Self-Review
- activity:resumed reuse on warm/hot: chapters are app-filtered + control their apps; launcher markRunning already keyed on it (markRunning no-ops if not launching, safe). Foundry ignores it. HUD unaffected.
- goHome/toggleService on dying/missing ward: guard no-op.
- ch5 step 4 hot start: phase 'resumed' after step 3's warm, correct. Step 7 cold start: plot freed during step 6's 4s wait (600ms demolition), ok; restore badge shows (recentlyKilled).
