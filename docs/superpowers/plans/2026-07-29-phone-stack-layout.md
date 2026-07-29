# Phone-Stack Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the board as the Android platform stack read north→south — hardware → kernel/boot → core processes (Zygote · system_server · SurfaceFlinger) → app wards → the glass — and make the Display a working phone UI: launcher icon grid at home, tap an icon to launch, foreground app's content on screen.

**Architecture:** Three phases, each independently shippable. Phase A turns the display into the phone UI and dissolves the kiosk plaza (sim layer untouched — `src/sim/launcher.ts` keeps driving launches). Phase B re-bands the board so City Hall leaves the pit and joins Zygote and SurfaceFlinger in a core-process band directly under the wards. Phase C sweeps narration, stories, docs. Pure sims in `src/sim/` are not touched in any phase; all changes live in scene/scenario/story/glue layers.

**Tech Stack:** Existing — Three.js, Vite, TypeScript strict, Vitest. No new dependencies.

## Global Constraints

- All positions/colors below are exact values — copy verbatim.
- Sims (`src/sim/*`) stay pure and untouched; new screen-state logic is a new pure module with unit tests.
- Never leave two coplanar surfaces overlapping (z-fight rule). Slopes crossing a seam must top out AT the seam, fully over the lower strip (the traces.ts `climbPoints` rule).
- Android green `0x3ddc84` stays reserved for "alive/running" accents.
- Per-app brand colors (single source, exported): chat `0xffb74d`, maps `0x4dd0e1`, camera `0x64b5f6`, bank `0x9575cd`.
- 99 existing tests must keep passing after every task; new pure modules need their own tests.
- Commit after every green task (conventional commits, no attribution footer).

---

## Target layout (the whole point — read before any task)

Board is 170×140, x −85..85, z −75..70. North→south = down the platform stack toward the user's glass:

| Band | z range | plate top | contents |
|---|---|---|---|
| Hardware (dark metal) | −75..−60 | −0.5 | CPU `x −30` · RAM `x 0` · PSI `x 14` · DISK `x 30` · RADIO `x 45` (all unchanged) |
| Kernel / Boot | −60..−45 | −0.2 | bootloader → kernel → init → system_server stations (unchanged) |
| **Core processes** (new band) | −45..−25 | 0.3 | Zygote Foundry west `x −85..−30` · **City Hall center `x −30..30`** (no pit — flat plate) · SurfaceFlinger east `x 30..85` |
| **App wards** | −25..5 | 0.3 | 4 plots, PLOT_X unchanged `[−33.75, −11.25, 11.25, 33.75]`, **PLOT_Z = −10** |
| Network (radio edge) | 5..35, x 45..85 only | 0.3 | Network tower (unchanged internals), anchor `(65, PLATE_Y, 17)` unchanged |
| **The Glass** | south rim | board 0 | Display at `(0, 0, 52)` facing south (+z, toward viewer) · launcher process shed at `(−22, 0, 50)` |

Anchor table after Phase B (`main.ts` ANCHORS and the duplicated copies in `routes.ts`):

```ts
boot: (0, 0, -52)            // unchanged
hardware: (0, 0, -68)        // unchanged
zygote: (-55, PLATE_Y, -35)  // was (-65, PLATE_Y, -20)
cityhall: (0, PLATE_Y, -35)  // was (0, -2, 10) — OUT of the pit, onto the core band
surfaceflinger: (60, PLATE_Y, -35) // was (65, PLATE_Y, -22)
network: (65, PLATE_Y, 17)   // unchanged
launcher: (-22, 0, 50)       // the launcher process shed by the glass (was (0, 3, 40) deck)
displaywall: (0, 0, 52)      // already at the south rim
```

PLOT_ANCHORS: `PLOT_X.map(x => (x, PLATE_Y, -10))`.

Why apps sit "on top of" system_server without stacking meshes: the wards band is the next band south of (= stacked on, in the layer diagram) the core band. Every plot→cityhall Binder road becomes a short straight north hop `(x, 0.3, -10) → (x, 0.3, -35)` — four visible, parallel "framework calls" instead of long pit dives.

---

# Phase A — the Display becomes the phone UI

## Task A1: Pure screen-state module

**Files:**
- Create: `src/sim/screen.ts`
- Test: `test/screen.test.ts` (or wherever existing sim tests live — mirror `launcher` test location)

**Interfaces:**
- Produces: `interface ScreenState { readonly mode: 'home' | 'app'; readonly app: string | null }`, `createScreen(): ScreenState`, `screenOnResumed(s, app): ScreenState`, `screenOnHome(s): ScreenState`, `screenOnKilled(s, app): ScreenState` (killed foreground app → home; killed background app → unchanged). All pure, immutable.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { createScreen, screenOnHome, screenOnKilled, screenOnResumed } from '../src/sim/screen'

describe('screen state', () => {
  it('starts at home', () => {
    expect(createScreen()).toEqual({ mode: 'home', app: null })
  })
  it('shows the resumed app', () => {
    expect(screenOnResumed(createScreen(), 'chat')).toEqual({ mode: 'app', app: 'chat' })
  })
  it('returns home on home press', () => {
    const s = screenOnResumed(createScreen(), 'chat')
    expect(screenOnHome(s)).toEqual({ mode: 'home', app: null })
  })
  it('falls back to home when the foreground app dies', () => {
    const s = screenOnResumed(createScreen(), 'chat')
    expect(screenOnKilled(s, 'chat')).toEqual({ mode: 'home', app: null })
  })
  it('ignores background app deaths', () => {
    const s = screenOnResumed(createScreen(), 'chat')
    expect(screenOnKilled(s, 'maps')).toBe(s)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**
- [ ] **Step 3: Implement `src/sim/screen.ts` minimally (pure functions, spread-based updates)**
- [ ] **Step 4: Run tests — expect PASS (99 + 5)**
- [ ] **Step 5: Commit** `feat: pure screen state — home/app modes for the display UI`

## Task A2: Display renders home grid + app content

**Files:**
- Modify: `src/scenarios/surfaceFlinger.ts` (the wall lives here; tiles already driven by SF state)

**Interfaces:**
- Consumes: `KIOSK_COLORS` — move it to a new tiny export `src/scene/appColors.ts` (`export const APP_COLORS: Record<string, number>`) so surfaceFlinger.ts and launcherPlaza.ts share one source.
- Produces (from `makeSurfaceFlingerScenario`): `screenIconMeshes(): THREE.Mesh[]` (raycast targets, each with `userData.app`), `homeButtonMesh(): THREE.Mesh`, `setScreen(state: ScreenState): void`.

**Design (exact):** The wall (`wallGroup`, world (0,0,52), facing +z) gets a screen face `4.6 h × 9.4 w` divided into:
- Status strip: thin box top, `0x1f2933`, shows nothing dynamic (v1).
- Home mode: 2×2 icon grid — four `1.6×1.6×0.15` boxes, colors from `APP_COLORS`, each with a small `makeLabel(app, 0.35)`; running apps additionally get the green lamp dot (0.18 sphere, `0x3ddc84`) at the icon's corner — the launcher shows which apps are alive, like Recents.
- App mode: one full-screen `4.2×8.6×0.15` panel in the foreground app's `APP_COLORS` hue + emissive 0.35, centered label with the app name; icon grid hidden.
- Nav bar: `0.5×3×0.2` "home pill" box below the screen face, `0x9aa5b1` — the home button.
- The existing 4 SF tiles STAY (they are the compositor's view); the screen face is the panel's view. Both driven from the same events.

- [ ] Step 1: extract `APP_COLORS` to `src/scene/appColors.ts`; import in launcherPlaza (delete its local copy) — build green, commit `refactor: shared APP_COLORS`
- [ ] Step 2: build screen face meshes (home grid, app panel, nav pill) inside `wallGroup`; expose `screenIconMeshes`/`homeButtonMesh`/`setScreen`; `setScreen` toggles grid vs panel visibility and paints the panel; tooltips: icons `'App icon — the home screen is just the launcher app\'s UI.'`, home pill `'Home — backgrounds the foreground app; the launcher\'s UI returns to the glass.'`
- [ ] Step 3: build + visual check (dev server): home grid visible from overview
- [ ] Step 4: Commit `feat: display screen face — launcher icon grid, app panel, home pill`

## Task A3: Wire taps + screen state in main.ts

**Files:**
- Modify: `src/main.ts`

**Design:** Keep `launcherPlaza`'s sim/logic role (it owns `clickKiosk`, idle rotation, launch acceptance) but its 3D kiosks die in A4 — this task only ADDS the new input path.
- Hold `let screen = createScreen()`.
- Events: `bus.on('activity:resumed', ({app}) => { screen = screenOnResumed(screen, app); sf.setScreen(screen) })`; same for `process:killed` → `screenOnKilled`; home button → `wardManager` background-current (find the existing "background the foreground app" path used when another app comes forward; if none exists standalone, emit via `launcherPlaza`'s existing broughtToFront of... — no: home = `wardManager.homePressed()`; check manager for the API used by story ch5's background step and reuse exactly that).
- Raycast: in the existing pointerdown handler, BEFORE ward/district resolution: intersect `sf.screenIconMeshes()` → `launcherPlaza.clickKiosk(app)` + fly the hardware→display tap route (`flyRoute(routes.path('hardware', 'displaywall'), 0xf2cc60)` — input now enters at the glass, not the plaza); intersect `homeButtonMesh()` → home path.

- [ ] Step 1: wire events + raycast, build, manual test: tap icon on screen → app launches → screen shows app panel → home pill → grid returns
- [ ] Step 2: Commit `feat: the glass is the input — taps on display icons launch apps`

## Task A4: Dissolve the kiosk plaza; launcher becomes a process shed by the glass

**Files:**
- Modify: `src/scenarios/launcherPlaza.ts`, `src/scene/board.ts`, `src/main.ts`

**Design:** launcherPlaza keeps ALL logic (sim state, clickKiosk, idle rotation, panel) but its scene group becomes: one small building `makeBuilding(4, 2.5, 4, 0xa5c48a, 'launcher')` at ANCHORS.launcher `(−22, 0, 50)` with tooltip `'The launcher process — just an app with a privileged view of PMS. Its UI is the icon grid on the glass.'` Delete kiosks, posts, deck references. `kioskMeshes()` returns `[]` (main.ts kiosk raycast branch then never hits; leave the branch — screen icons replaced it). board.ts: launcher platform/deck geometry and silk text removed; green plaza plate stays as lawn or shrinks — remove the deck box only, keep the plate.
- Idle auto-launch rotation: keep (it now reads as "the user tapping the glass" — packets fly from the glass).

- [ ] Step 1: strip kiosk/deck geometry, reposition, build, visual check
- [ ] Step 2: run tests (sim untouched — expect green)
- [ ] Step 3: Commit `feat: launcher UI lives on the glass — plaza kiosks dissolved into the display`

---

# Phase B — core-process band (City Hall out of the pit)

## Task B1: Board re-band

**Files:**
- Modify: `src/scene/board.ts`

Exact changes:
- Zone plates (replace current foundry/wards/surfaceflinger set):
  - foundry `(-85..-30, -45..-25, top 0.3)` color unchanged `0x8bbf94`
  - cityhall `(-30..30, -45..-25, top 0.3)` color `0x9aa0cf` — **flat plate; delete every pit slab, pit ring, rim wedge, and the recessed pit floor**
  - surfaceflinger `(30..85, -45..-25, top 0.3)` color `0xb18cbd`
  - wards `(-85..45, -25..5, top 0.3)` color `0x8fc1d1`
  - network `(45..85, 5..35, top 0.3)` unchanged color
- Base slabs: one slab per band top (recessed one PLATE_H below plate tops — existing pattern), z splits at −45 / −25 / 5.
- Silk-screen texts: move `CITY HALL` text onto the core band; add `THE GLASS` at z 48.

- [ ] Step 1: apply, build, visual check (plates only — routes will be broken until B3; that's fine on a branch)
- [ ] Step 2: Commit `feat(board): core-process band — cityhall plate between foundry and SF, no pit`

## Task B2: Scenario moves

**Files:**
- Modify: `src/main.ts` (ANCHORS + SCENARIO_OFFSETS + camera positions), `src/scenarios/cityHall.ts` (local geometry assumed pit — flatten: wings/pillars base at plate 0.3, delete pit-floor offsets), `src/scenarios/zygoteFoundry` (anchor shift only), `src/scenarios/surfaceFlinger.ts` (anchor shift; wallGroup local offset recomputed: world (0,0,52) − new anchor (60,0,−35) → local `(−60, 0, 87)`)

- [ ] Step 1: update ANCHORS table (values from the layout table above) in main.ts AND routes.ts duplicate
- [ ] Step 2: flatten cityHall internals (search for `-2` y offsets), shift SF wall local offset, adjust each scenario's `cameraPos`/`cameraTarget`: cityhall `pos (0, 16, -12) target (0, 0.3, -35)`, zygote `pos (-55, 14, -12) target (-55, 0.3, -35)`, sf `pos (60, 14, -12) target (60, 0.3, -35)`, launcher `pos (-22, 10, 68) target (-22, 0, 50)`
- [ ] Step 3: build + visual check each district button
- [ ] Step 4: Commit `feat: city hall joins the core-process band — zygote's first fork lives beside it`

## Task B3: Routes rewire

**Files:**
- Modify: `src/scene/routes.ts`

Exact route set (waypoints; conveyors marked):
- zygote→plot n (conveyor, TRUNK dedup as today): trunk `[(−55,0.3,−35), (−55,0.3,−22), (33.75,0.3,−22)]` then per-plot spur draw `[]`, packet waypoints `[zygote, (−55,0.3,−22), (x,0.3,−22), (x,0.3,−10)]` — wait: spur `(x,−22)→(x,−10)` must be drawn once per plot: `draw: [(x,0.3,−22),(x,0.3,−10)]`. Corridor z −22 sits between core band edge (−25) and ward north walls (−19): clear.
- plot n→cityhall (Binder): `[(x,0.3,−10), (x,0.3,−28), (clamp(x,−20,20),0.3,−35→ no bend if |x|≤20 else jog at z −28)]` — concretely: for x ±11.25: `[(x,0.3,−10),(x,0.3,−35)]`; for x ±33.75: `[(x,0.3,−10),(x,0.3,−28),(±20,0.3,−28),(±20,0.3,−35)]` (jog inside the ward/core gap; the two jogged roads use distinct z? both at −28 but different x ranges — no overlap).
- cityhall→zygote (First casting, conveyor): `[(−55,0.3,−35),(0,0.3,−35)]` straight along the band — 2-unit y? same plate, straight leg. Keep `info` tooltip.
- plot n→surfaceflinger: corridor z −20? conflicts conveyor −22; use z −18: `[(x,0.3,−10),(x,0.3,−18)]` spur + trunk `[(−33.75,0.3,−18),(60,0.3,−18),(60,0.3,−35→ no: SF anchor (60,−35) is north of corridor — leg (60,0.3,−18)→(60,0.3,−35)]`. Wait — frames flow plots→SF; corridor east then north into SF. Trunk: `[(−33.75,0.3,−18),(60,0.3,−18),(60,0.3,−30)]` (stop at SF south face), spurs `draw [(x,0.3,−10),(x,0.3,−18)]`.
  - CONFLICT CHECK: z −18 corridor crosses the four plot→cityhall north roads (x ±11.25, ±33.75) — perpendicular same-material crossings, roadMat both, same raise → invisible overlap, acceptable (same rule as today's plot-road crossings).
- network→plot n: trunk `[network(65,0.3,17), (46.5,0.3,15), (45,0,14), (PLOT_X[0],0,14)]` then per-plot branch `[(x,0,14),(x,0,7),(x,0.3,5→ slope tops at seam z 5),(x,0.3,−10)]` — wards plate south edge is z 5; slope from board 0 to 0.3 ending AT z 5, then flat north to plot.
- cityhall→launcher: gone as a road? Launch flow now: display tap → launcher shed → cityhall. Road launcher shed→cityhall: `[(−22,0,50),(−22,0,10),(−22,0.3,5),(−22,0.3,−25→ enters core band? no — stop at cityhall south face: (−22,0.3,−25) is the band edge; jog east: (−22,0.3,−28),(0,0.3,−28)? — simplify: [(−22,0,50),(−22,0,10),(−22,0.3,5),(−22,0.3,−28),(−10,0.3,−28),(−10,0.3,−35)]`.
- surfaceflinger→displaywall: `[(60,0.3,−35→ SF anchor),(78,0.3,−30),(78,0.3,33),(74,0,43),(30,0,49),(0,0,52)]` — same rim descent as today, adjusted start.
- network→offboard-east: unchanged.
- hardware→launcher tap route (main.ts uses `routes.path('hardware','launcher')`): replace with `'hardware'→'displaywall'` fallback anchor pair (already works via resolveAnchor) — main.ts change noted in A3.

- [ ] Step 1: rewrite ROUTES/TRUNKS with the exact waypoints above, keeping the RouteDef draw/trunk dedup pattern
- [ ] Step 2: build + visual sweep at overview (no broken/z-fighting legs; check every seam slope tops out at its seam)
- [ ] Step 3: Commit `feat(routes): stack-order roads — short Binder hops from wards down to the core band`

## Task B4: Traces rewire

**Files:**
- Modify: `src/scene/traces.ts`

- Y_PLATE/climb unchanged (bands share plate top 0.3; the climb still crosses hw/boot and boot/plate seams — but the plate it lands on is now the CORE band, and per-plot tails must cross it plus the −25 band seam? NO — both bands top 0.3, seam is cosmetic; flat run continues).
- New constants: `PLOT_Z = -10`; fan jog corridor moves south of the SF corridor (−18) and conveyor (−22): use `JOG_Z0 = -14`, `JOG_STEP = 1` → jogs at −14..−17 (between corridor −18 and ward walls at −19? ward 18-wide at −10 → north edge −19. Jogs −14..−17 are INSIDE the ward footprint z range... ward spans −19..−1; jog at −14 crosses wards!). Fix: jog NORTH of the SF corridor: `JOG_Z0 = -20`? −20..−23 collides conveyor −22. Resolve: move SF corridor to −17, conveyor stays −22, jogs at −19/−20/−21? still tight. FINAL: conveyor −22 (draw), fan jogs `JOG_Z0=-24, STEP=0.6` → −24, −24.6, −25.2, −25.8 (hmm crosses band seam −25, fine — flat same-height plates) — traces run UNDER the conveyor raise (0.4) with 0.06-layer stacks (max top 0.3+0.20+0.08=0.58 vs conveyor deck bottom 0.55: 0.03 overlap for DISK layer!). Adjust CONVEYOR_RAISE 0.4→0.45 in routes.ts (bottom 0.6) → clearance 0.02… make 0.5 for real margin. Record this as an explicit step.
- RAM fork targets: WARD_TRUNK `(0, 0.3, -10)`; ZYGOTE `(-55, 0.3, -35)`.

- [ ] Step 1: apply constants (PLOT_Z −10, JOG_Z0 −24, JOG_STEP 0.6, ZYGOTE/WARD_TRUNK), bump CONVEYOR_RAISE to 0.5 in routes.ts with comment
- [ ] Step 2: build + visual check fans at glancing angle (the historical failure mode — check from low NE like the user's screenshots)
- [ ] Step 3: Commit `feat(traces): fans follow the stack layout — jog corridor north of the ward walls`

## Task B5: Wards + manager coordinates

**Files:**
- Modify: `src/main.ts` (PLOT_ANCHORS z −10), `src/wards/manager.ts` / `visualSync.ts` if they carry plot z constants (grep `-25` duplicates)

- [ ] Step 1: grep for `-25` plot-z duplicates across src/, update each with the new −10 (verify each hit IS a plot z, not a coincidence)
- [ ] Step 2: build + spawn 4 wards in browser, check walls/annex/shed land on the wards band and nothing clips the corridors
- [ ] Step 3: Commit `feat: ward plots ride the app band`

---

# Phase C — narration, stories, docs

## Task C1: Story + text sweep

**Files:**
- Modify: `src/story/chapters/ch1-boot.ts` (last step focus `'launcher'` → `'displaywall'`? focusCamera resolves ANCHORS — add displaywall to ANCHORS in main.ts; narration: "The launcher's icon grid lights the glass — the city is awake."), `ch2-ward.ts` (narration "You tap chat **on the glass**…"), panel narrations in cityHall (delete pit references), launcherPlaza panel text, boot narration mentions
- [ ] Step 1: sweep `grep -ri "pit\|plaza\|kiosk" src/ docs/ README.md`, update each
- [ ] Step 2: run all 6 chapters end-to-end in browser (the ch-hang class of bugs lives here — watch every waitFor)
- [ ] Step 3: Commit `docs+story: stack-layout narration`

## Task C2: README + reference doc + screenshot

- [ ] Step 1: rewrite README Districts paragraph around the stack bands; update `docs/android-flow-reference.md` platform-diagram mapping section (bands now literally mirror the diagram)
- [ ] Step 2: retake `docs/overview.jpg` from the default overview
- [ ] Step 3: Commit `docs: phone-stack layout`

---

## Verification (after each phase)

1. `npm run build && npx vitest run` — green.
2. Browser at deployed site (hard reload): overview sweep for broken links at glancing angles (the recurring z-fight class), tap-to-launch from the glass, home pill, all 6 story chapters, manual mode, Reset city, oom_adj table, 120fps via `?debug`.
3. Screenshot evidence before claiming done (user precedent: "still same" ×3).

## Risks / decisions taken

- **Pit removal** deletes City Hall's sunken drama; the flat band gains the "first casting" adjacency (conveyor straight from Zygote next door). Accepted trade.
- **Fan corridor congestion** (conveyor −22, jogs −24.. −25.8, SF corridor −17): resolved by exact z values + conveyor raise bump; re-check visually, this is the historical bug farm.
- **Launcher deck removal** changes ch1's final shot; C1 rewrites it to end on the glass lighting up — a better closing beat anyway.
- Phase A ships alone (display UI + plaza dissolution) without moving any district — if Phase B slips, the site still improves.
