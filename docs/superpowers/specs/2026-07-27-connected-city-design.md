# DroidCity v2 — Connected City Design

**Goal:** Turn the 5 isolated districts into one connected Android system: phone boot → system init → app launch → data loading (network + local DB) → frame on screen. Causality is real (event bus wiring at the scenario layer), stories are guided tours over the live simulation. Architecture matches PGSimCity's proven shape: pure sim + event bus + world layout + tour layer.

**Approved decisions:**
- Format: guided story chapters + free mode (both; free mode is fully causal)
- New districts: Boot chain, Launcher/Home, Network, Database (9 districts total)
- Story: 4 chapters, playable in order ("Play all") or solo
- Existing district button panels preserved in free mode
- Pacing: auto-play + pause/back/next + 1x/2x speed
- Architecture: hybrid — pure sims untouched/extended, typed event bus connects scenarios, StoryPlayer observes bus (never fakes causality)

## Architecture

```
src/
├── sim/            # pure, immutable, no three.js, TDD (unchanged rule)
│   ├── (existing: constants, looper, lifecycle, framePipeline, processes, heap)
│   ├── boot.ts     # NEW: boot stage sequence
│   ├── launcher.ts # NEW: app registry + launch cooldown
│   ├── netFetch.ts # NEW: HTTP request lifecycle (dns→connect→tls→ttfb→download), timeout+retry
│   └── roomDb.ts   # NEW: local DB query + cache table
├── core/
│   └── bus.ts      # NEW: typed event bus (~40 lines): on/once/emit/off/clear
├── scene/
│   ├── (existing: city.ts, builders.ts)
│   └── packet.ts   # NEW: glowing courier mesh that flies district→district along a path
├── scenarios/      # existing 5 minimally refactored to subscribe/emit bus events
│   ├── (existing: mainThread, lifecycle, touchPipeline, zygote, gc)
│   ├── boot.ts     # NEW district
│   ├── launcher.ts # NEW district
│   ├── network.ts  # NEW district
│   └── database.ts # NEW district
├── story/
│   ├── player.ts   # chapter runner (pure logic + thin DOM narration card)
│   └── chapters/   # ch1-boot.ts, ch2-launch.ts, ch3-data.ts, ch4-frame.ts
└── main.ts         # 9-district layout, story UI bar, free-mode switcher (existing)
```

### Event bus

`src/core/bus.ts` — typed pub/sub. Event map (single source of truth):

```ts
export interface CityEvents {
  'boot:stageDone': { stage: string }          // bootloader | kernel | init | system_server
  'boot:complete': {}
  'app:launchRequested': { app: string }
  'process:forked': { app: string; pid: number }
  'activity:resumed': { app: string }
  'data:requested': { app: string; source: 'db' | 'network' }
  'data:cacheHit': { app: string; stale: boolean }
  'data:fetched': { app: string; ms: number }
  'net:phase': { phase: string }               // dns | connect | tls | ttfb | download | retry
  'ui:messagePosted': { label: string }
  'frame:rendered': { dropped: boolean }
  'gc:swept': { freedKb: number }
}
```

API: `on(event, handler): unsubscribe`, `once(event): Promise<payload>`, `emit(event, payload)`, `clear()`. Constructor-injected into scenarios and StoryPlayer (no singleton import — testability).

### Causal chain (free mode)

Click app kiosk in Launcher → `app:launchRequested` → Zygote scenario forks proc (existing sim), emits `process:forked` → Lifecycle scenario launches activity, emits `activity:resumed` → app auto-emits `data:requested` twice (db + network) → Database district answers ~30ms (`data:cacheHit`, stale) → Network district runs full request lifecycle ~1200ms (`net:phase` per stage, then `data:fetched`) → each data arrival posts a message to Main Thread road (`ui:messagePosted`) → frame pipeline runs a frame → `frame:rendered` → app building's screen lights up; later GC sweeps stale objects (`gc:swept`).

Every cross-district hop spawns a packet mesh (scene/packet.ts) flying between district anchors. Packet travel time is visual only; sim timings come from sims.

## New districts + sims

### Boot chain (west edge)
- Sim `boot.ts`: ordered stages `[bootloader 800ms, kernel 1200ms, init 900ms, system_server 1500ms]`; `createBoot()`, `advanceBoot(s, dt)`; stage completion data drives `boot:stageDone`, final → `boot:complete`. State: `{ stages, elapsedMs, currentIndex, done }`.
- Visual: 4 station buildings light up in order; before `boot:complete`, ALL other districts render dimmed/dark ("cold city"). Idle default: already booted (city lit). Chapter 1 resets to dark and replays.

### Launcher/Home (center-south)
- Sim `launcher.ts`: app registry `[chat, maps, camera, bank]`, `requestLaunch(s, app)` → no-op while that app is already launching/running (cooldown until `activity:resumed` for it); tracks running set.
- Visual: plaza with 4 icon kiosks; click kiosk (raycast picking on kiosk meshes — new, small: THREE.Raycaster on pointerdown) emits `app:launchRequested`. Kiosk pulses while launch in flight.

### Network (east edge)
- Sim `netFetch.ts`: request = phases `[dns 100, connect 150, tls 250, ttfb 400, download 300]` (ms), `startRequest()`, `advanceRequest(s, dt)` → current phase, done; deterministic failure injection: `startRequest({ failAt: 'ttfb' })` → timeout → `retry` phase → second attempt succeeds (teaches backoff). Emits `net:phase` transitions, terminal `data:fetched`.
- Visual: radio tower + gateway arch; request packet drives district→tower, hops per phase (phase name labels), returns with payload cube.

### Database (adjacent to app cluster)
- Sim `roomDb.ts`: `query(s, key)` → `{ hit: boolean, ms: 30 }`; cache table seeded so first story query hits (stale=true), post-network `insert(s, key)` freshens. State: `{ tables: Record<string, { fresh: boolean }> }`.
- Visual: warehouse; short packet round-trip; teaches cache-then-network — stale data renders instantly, fresh re-render arrives ~1.2s later.

All 4 sims: pure, immutable, TDD, ~5 tests each. Bus: full unit tests.

## Story system

### StoryPlayer (`story/player.ts`)
Chapter = `{ id, title, steps: Step[] }`.
`Step = { narration: string, focus: DistrictId | 'follow-packet' | 'overview', fire?: (ctx) => void, waitFor: { event: keyof CityEvents } | { ms: number } }`.

Player: fires step's action, tweens camera to focus (existing tween machinery), shows narration card, waits for the bus event (proof the sim actually did it) or timer, auto-advances. Desync impossible: waits are bus-driven.

Controls: ⏮ back = restart current chapter from its first step (chapter reset re-initializes involved districts; per-step rewind is NOT supported — sims don't run backwards), ⏸ pause, ⏭ next (force-complete current wait), speed 1x/2x (scales sim dt multiplier during story). Esc exits to free mode, city continues live.

Player core logic is pure/tested: inject fake bus + fake clock, assert step advancement, waitFor resolution, pause/next semantics. DOM card + camera calls live in a thin adapter.

### Chapters
1. **Power On (~40s):** city dark → boot stations light in sequence → Zygote warms (preload framework) → Launcher plaza lights → "city is awake".
2. **App Launch (~50s):** tap chat kiosk → `app:launchRequested` → Zygote fork → building rises → lifecycle floors light → first frame through pipeline → screen on.
3. **Getting Data (~60s):** `data:requested` → DB packet returns stale data (renders immediately) → network request with phase narration + one timeout/retry beat → fresh data → main-thread message → re-render → GC sweeps old objects.
4. **The 16ms Race (~40s):** touch→pixel pipeline, normal vs heavy-draw frame, jank + ANR framing (existing content, story treatment).

"Play all" chains 1→4. Each solo-playable; solo chapters fast-forward prerequisites silently (e.g. ch3 auto-launches app first, no narration).

## UI changes

- Top bar: existing district buttons + new "▶ Story" dropdown (Play all, Ch 1-4).
- During story: district panels hidden, narration card bottom-center (title, text, step i/N, controls), switcher disabled except Esc.
- Free mode unchanged: district click = fly + panel; idle behaviors continue; launcher kiosks clickable.
- Boot state: on load city is lit (booted); dark-city state only during Chapter 1.

## Testing

- New sims + bus + StoryPlayer core: vitest TDD (target ~30 new tests; 28 existing untouched must stay green).
- Scenario/visual layer: browser-verified (user or Chrome extension when available).
- Existing sim modules unchanged; existing scenarios get bus wiring only (subscribe/emit), behavior behind buttons unchanged.

## Out of scope (v2)

- Visual polish pass (bloom, window textures, props, skybox) — separate round after v2
- Mobile/touch UX, sound, i18n
- Binder/WorkManager/Doze districts (v3 candidates)

## Layout (9 districts)

Existing 5 keep offsets; new 4 placed: Boot (-90, 0, 30), Launcher (0, 0, 110) south-center, Network (90, 0, 30) east, Database (60, 0, 110) near app cluster. Overview camera pulls back to (0, 110, 150), fog far extended to ~450. Exact values tunable at implementation.
