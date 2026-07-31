# DroidCity v2, Ward City Design (supersedes flat-district design)

**Goal:** One city = the Android OS. System infrastructure = fixed districts. Every running app = a **ward** cloned from Zygote, a live mini-neighborhood containing that app's own internals (main-thread road, Activity tower, heap yard, Room shed). Network and DB flows run per-app, inside/from the ward. Guided story chapters play over the live simulation.

**Approved decisions (carried from earlier rounds):**
- Guided story chapters (4) + fully causal free mode; auto-play + pause/back/next + 1x/2x
- Architecture: pure sims + typed event bus + tour observes bus (PGSimCity shape)
- NEW this revision: hierarchical world model, system districts + dynamic app wards (user's model, validated against real Android: app = process = own heap/looper/sandbox/Room)

## World model

### System districts (fixed)
| District | Represents | Notes |
|---|---|---|
| Boot Row (west edge) | bootloader → kernel → init → system_server power-up | 4 stations; kernel lives here as a station (city's ground rules), no separate kernel district |
| Zygote Foundry (northwest) | Zygote process | stamps ward kits; pre-warmed framework |
| City Hall (north center) | system_server: AMS/WMS/PMS | all ward↔system traffic routes through it = **Binder**; lights up when boot completes |
| Launcher Plaza (south center) | home screen | 4 app kiosks (chat, maps, camera, bank); kiosk click = launch request |
| Network Tower (east edge) | radio/ISP edge | shared infra; each request tagged with owning app |
| SurfaceFlinger + Display (northeast) | compositor + screen | wards ship finished frames here; Display billboard shows lit tile per visible app |

### Ward plots (center, 2×2 grid = max 4 wards)
A ward spawns when Zygote forks an app and is demolished when LMK kills it (RAM capacity 1200MB, 300MB/app → LMK keeps at most 4, naturally matching plots). Ward contents (miniature versions of v1 districts):

- **Main-thread road**, own looper sim; message cars queue at the ward's door; per-ward ANR overlay
- **Activity tower**, lifecycle floors (onCreate/onStart/onResume), ViewModel orb on roof, screen panel on top that lights when the app's frame is composited
- **Heap yard**, crate grid + per-ward GC sweep
- **Room shed**, the app's private DB; cache crates; stale/fresh state
- **Render bench**, app-side frame stages (input→…→renderThread); finished frame packet flies to SurfaceFlinger district

Semantics: heap, looper, lifecycle, Room, render stages are per-process, one sim instance per ward. This is real Android (process isolation); the ward walls ARE the sandbox.

## Architecture

```
src/
├── sim/            # pure, immutable, no three.js, TDD, UNCHANGED modules, now instantiated per ward
│   ├── existing: constants, looper, lifecycle, framePipeline, processes, heap
│   ├── boot.ts     # NEW (as before)
│   ├── launcher.ts # NEW (as before)
│   ├── netFetch.ts # NEW (as before; requests carry app tag at scenario layer)
│   ├── roomDb.ts   # NEW (as before; one DbState per ward)
│   └── wardPlots.ts# NEW: pure plot allocation (assign/free lowest plot index, capacity 4)
├── core/bus.ts     # NEW typed event bus; app-scoped events carry { app }
├── scene/
│   ├── city.ts, builders.ts (existing)
│   ├── packet.ts   # NEW courier meshes (straight or via-City-Hall two-hop routes)
│   └── ward.ts     # NEW: buildWardMeshes(app) → ward group (road, tower, yard, shed, bench)
├── wards/
│   └── manager.ts  # NEW WardManager: spawn/demolish wards, own sim instances per ward,
│                   # routes app-scoped bus events to the right ward, per-ward idle + panel
├── scenarios/      # system districts only: boot, zygote (refactor of existing), launcher,
│                   # network, surfaceflinger (new), cityhall (visual, thin)
├── story/
│   ├── player.ts   # chapter runner (unchanged design from prior revision)
│   └── chapters/   # ch1-boot, ch2-launch, ch3-data, ch4-frame, retold in ward terms
└── main.ts         # layout, picking (kiosks + wards), story UI, packet routing table
```

### Event bus (`core/bus.ts`)
```ts
export interface CityEvents {
  'boot:stageDone': { stage: string }
  'boot:complete': Record<string, never>
  'app:launchRequested': { app: string }
  'process:forked': { app: string; pid: number }
  'process:killed': { app: string; pid: number }        // LMK → ward demolition
  'activity:resumed': { app: string }
  'data:requested': { app: string; source: 'db' | 'network' }
  'data:cacheHit': { app: string; stale: boolean }
  'data:fetched': { app: string; ms: number }
  'net:phase': { app: string; phase: string }
  'ui:messagePosted': { app: string; label: string }
  'frame:submitted': { app: string; dropped: boolean }  // ward render bench → SurfaceFlinger
  'frame:composited': { app: string }                   // SurfaceFlinger → Display tile + ward screen light
  'gc:swept': { app: string; freedKb: number }
  'anr': { app: string }
}
```
API: `on/emit/clear`, constructor-injected. App-scoped events routed by WardManager to the owning ward's sim instances.

### Causal chain (free mode)
Kiosk click → `app:launchRequested` → Zygote Foundry forks (processes sim, city-level) → `process:forked` → **WardManager spawns ward** (plot from wardPlots sim, fresh looper/lifecycle/heap/roomDb/framePipeline instances) → ward's lifecycle launches → `activity:resumed` (packet: ward → City Hall → launcher, Binder route) → ward requests data → own Room shed answers stale (`data:cacheHit`), Network Tower fetch per phases (`net:phase`… `data:fetched`, packet ward→tower→ward) → results become messages on the ward's road (`ui:messagePosted`) → render bench runs app-side stages → `frame:submitted` (packet ward→SurfaceFlinger) → compositor → `frame:composited` → Display tile + ward's screen panel light. Fresh data re-render repeats the tail. GC sweeps ward heap (`gc:swept`). RAM pressure → LMK kills oldest cached app → `process:killed` → ward demolition animation (building shrink, plot freed).

Packets are decorative; sims never wait on packet arrival. Binder two-hop (via City Hall) applied to: launch chain and lifecycle signals only (teaching beat, not every message).

### WardManager (`wards/manager.ts`)
- `spawnWard(app, pid)`: allocate plot (wardPlots sim), build meshes (scene/ward.ts), create sim instances, subscribe app-filtered bus events, start per-ward idle (light taps every ~2s, periodic allocs, occasional rotate)
- `demolishWard(app)`: shrink animation, dispose ALL ward GPU resources (established disposal precedent), free plot, drop subscriptions
- `wardPanel(app)`: panel for free mode, Block main thread (8s), Rotate, Force GC, Refresh data (re-fires data:requested), per-app narration incl. ANR
- Pure logic split for TDD: plot allocation (`sim/wardPlots.ts`) and ward event-routing bookkeeping tested without three.js; mesh building browser-verified
- Existing scenario files for mainThread/lifecycle/touchPipeline/gc are RETIRED (deleted), their sim modules live on per-ward; their visual code is adapted into `scene/ward.ts` at miniature scale. Zygote scenario refactors into the Foundry system district (keeps processes sim + LMK, now emits process:killed).

### Interaction model (free mode)
- Click kiosk → launch app (ward spawns)
- Click a ward (raycast on ward group) → camera to ward + ward panel
- Click system district button/mesh → its panel (Boot: replay boot; Zygote: RAM meter, LMK log; Network: test request; SurfaceFlinger: show per-app tiles; Launcher: kiosks)
- Overview default; idle: launcher auto-opens apps up to capacity, LMK cycles them, city self-plays

## Story chapters (retold in ward terms)
1. **Power On (~40s):** dark city → Boot Row stations light → City Hall opens → Zygote Foundry warms → Launcher Plaza lights.
2. **A Ward Is Born (~50s):** kiosk tap → Foundry stamps ward kit → ward rises on plot (construction animation) → Activity tower floors light → first frame: bench → SurfaceFlinger → Display tile on. Narration: fork, process isolation, why ward walls exist.
3. **Getting Data (~60s):** ward asks own Room shed (stale, instant, renders) → Network Tower round-trip with phase narration + one timeout/retry → fresh data re-render → ward GC sweeps stale crates. Cache-then-network spatially: short in-ward trip vs long tower trip.
4. **The 16ms Race (~45s):** ward render bench normal vs heavy frame → dropped frame at SurfaceFlinger → block ward's main road → ANR over the ward → finale overview: several wards alive, LMK demolishes one, Zygote stamps another, "the city breathes".

Solo chapters fast-forward prerequisites silently (ch3/ch4 auto-launch an app if no ward alive). Play-all chains 1→4.

## UI
- Top bar: Overview + system district buttons + "▶ Story" dropdown. Ward access by clicking wards (no fixed buttons, wards are dynamic).
- Story: narration card bottom-center (title, text, i/N, ⏮ ⏸ ⏭ 1x/2x ✕/Esc), switcher disabled during story.
- During Chapter 1 the city starts dark (setCityDim); free-mode default is booted/lit.

## Testing
- Unchanged sims keep their 28 tests. New TDD: bus, boot, launcher, netFetch, roomDb, wardPlots, StoryPlayer core, WardManager routing bookkeeping (~40 new tests target).
- Visual/scene layer browser-verified (human or Chrome extension).

## Out of scope (v2)
- Visual polish pass (bloom/textures/props), sound, mobile touch UX
- Multi-window/split-screen, Binder deep-dive district, WorkManager/Doze (v3)

## Layout sketch
Boot Row (-90, 0, 20) west · Zygote Foundry (-55, 0, -45) NW · City Hall (0, 0, -60) N · SurfaceFlinger+Display (55, 0, -45) NE · Network Tower (90, 0, 20) east · Launcher Plaza (0, 0, 85) south · Ward plots 2×2 grid centered origin: (-22,0,-5), (22,0,-5), (-22,0,35), (22,0,35). Overview camera (0, 115, 155), fog 150→450, ground 300×300. Values tunable at implementation.
