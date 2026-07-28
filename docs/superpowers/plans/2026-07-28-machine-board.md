# DroidCity Machine Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Rebuild the spatial design PGSimCity-style: one contiguous machine board — colored zone plates tiling edge-to-edge, physical roads/conveyors carrying packets, verticality as architecture (recessed system pit, elevated userspace platform), persistent HUD labels with live counts, dense zone props. Sims, bus, story, WardManager logic UNTOUCHED — this is the visual layer only.

**Tech:** existing + `CSS2DRenderer` from `three/examples/jsm/renderers/CSS2DRenderer.js` (ships inside three — no new dependency).

## Global Constraints

- NO changes to `src/sim/**`, `src/core/**`, `src/story/player.ts`, chapter step/wait structures (narrations may gain no edits; focus ids unchanged). Tests (71) stay green untouched.
- All position changes flow through `ANCHORS` / `PLOT_ANCHORS` in main.ts and per-scenario internal layout. District ids unchanged.
- Every new mesh follows the disposal discipline where dynamic; static board geometry may live for page lifetime.
- Board palette: board floor 0xcfcbc4 (light), plate colors — boot strip 0x37474f, foundry 0x1b4332, ward strip 0x263238, cityhall pit 0x1a237e-tinted dark 0x1c2340, surfaceflinger 0x4a148c-tinted 0x2d1b4e, network 0xe65100-tinted 0x3e2723... FINAL: use these exact plate colors: boot 0x37474f, foundry 0x2e4a3a, wards 0x2b3440, cityhall 0x2a2f55, surfaceflinger 0x3a2a55, network 0x553a2a, launcher 0x374a37. Emissive intensity low (0.15) so plates read as colored floor under dark sky.
- Commit messages conventional, no attribution footer. Files < 400 lines.

## Board Layout (single source: LAYOUT constant in main.ts)

Board: one box 170 × 1 × 120 at y -0.5 (top face y 0), centered (0,0,0), color 0xcfcbc4. Dark sky/fog stays (fog 0x0d1117, near 140 far 380). GridHelper removed (board replaces it).

Zone plates (thin boxes 0.3 high sitting on board, top y 0.3; edge-to-edge, gaps 0):
| Zone | x range | z range | y offset | Notes |
|---|---|---|---|---|
| bootStrip | -85..85 | -60..-45 | recessed: plate y -0.2 | full-width back strip |
| foundry | -85..-45 | -45..5 | 0 | |
| wardStrip | -45..45 | -45..-5 | 0 | 4 plots at x -33.75,-11.25,11.25,33.75 (22.5 pitch), z -25 |
| cityhallPit | -45..45 | -5..25 | recessed pit: floor y -2, sloped rim | Binder hub |
| surfaceflinger | 45..85 | -45..0 | 0 | Display wall at x 82 facing -x |
| network | 45..85 | 0..35 | 0 | road exits +x off board edge |
| launcherPlatform | -30..30 | 25..55 | elevated: platform top y 3 | ramp down into pit rim |

New ANCHORS (zone centers, y 0 — used for camera + packet endpoints): boot (0,0,-52), zygote (-65,0,-20), cityhall (0,-2,10), surfaceflinger (65,0,-22), network (65,0,17), launcher (0,3,40). PLOT_ANCHORS: (-33.75,0,-25), (-11.25,0,-25), (11.25,0,-25), (33.75,0,-25).

Ward footprint stays 18×18 → fits 22.5 pitch with 4.5 gutters. Overview camera (0,85,105) target (0,0,-5); district camera offsets shrink to (0,14,22)/(0,1,0) default (board is compact now). Edge text (canvas-texture planes flat on board, like printed silk-screen): front edge "DROIDCITY · ANDROID USERSPACE" ; right edge beyond network road "INTERNET →" ; back edge "HARDWARE / KERNEL SPACE".

---

### Task 1: Board, plates, re-anchored layout

**Files:** Modify `src/main.ts` (LAYOUT + ANCHORS + PLOT_ANCHORS + camera constants), `src/scene/city.ts` (board floor replaces ground+grid, fog 140/380), Create `src/scene/board.ts` (buildBoard(): Group — board box, 7 plates incl. recessed boot strip/pit floor/pit rim slopes/launcher platform + ramp, 3 silk-screen edge texts via canvas planes)

**Steps:**
- [ ] Implement board.ts per LAYOUT table (exact coords above; pit rim = 4 sloped BoxGeometry wedges or simple stepped boxes; ramp = rotated box from platform front edge down to pit rim).
- [ ] city.ts: remove ground plane + GridHelper; scene.add(buildBoard()) from main (city.ts stays generic — board added in main.ts); fog 0x0d1117, 140, 380.
- [ ] main.ts: new ANCHORS/PLOT_ANCHORS/OVERVIEW (0,85,105)/(0,0,-5); district camera offset default (0,14,22)/(0,1,0) — per-scenario cameraPos/cameraTarget fields now IGNORED by focusCamera (single default frames compact zones fine; delete per-scenario reads, leave fields dormant to avoid touching every scenario).
- [ ] Scenario-internal fixes ONLY where layout breaks: launcherPlaza content must sit on platform top (group y = 3 via anchor — kiosks fine), cityHall building floor at pit floor (group y = -2 via anchor), boot stations spread along the strip (bootRow internal x spacing widen to ~14; stations sit on recessed strip).
- [ ] Verify `npm run build && npm test` (71), curl dev server. Commit `feat: machine board layout — contiguous plates, pit, platform`.

### Task 2: Physical connectors + routed packets

**Files:** Create `src/scene/routes.ts`; Modify `src/main.ts` (packet route table), `src/wards/manager.ts` (its two fly calls take waypoint paths from a routes helper)

**Connector meshes (routes.ts):** `buildRoutes(): { group: THREE.Group; path(from: string, to: string): THREE.Vector3[] }` — physical roads: flat boxes 1.6 wide, 0.15 high, color 0x455a64, edge stripes emissive 0x76e3ea 0.05 high. Routes (poly-lines with corner waypoints, all on plate tops):
- foundry → each ward plot (conveyor: slightly raised 0.4, ribbed look = alternating segment colors): corridor along z -25
- each ward plot → cityhall pit rim (Binder roads, radiating south)
- cityhall → launcher ramp base
- each ward plot → surfaceflinger (east corridor along z -22)
- surfaceflinger → display wall
- launcher → foundry (launch request road, west along z 30 then north)
- network → each ward plot (via corridor z 0 crossing pit rim east)
- network → off-board east (the INTERNET road)
`path(from,to)` returns waypoint arrays for the packet system (y 0.5 above route surface). Unknown pair → straight line fallback [from,to] using ANCHORS.
- [ ] Implement routes.ts; add group in main.
- [ ] main.ts route table + manager fly calls use `routes.path(...)` waypoints (manager: inject `routePath` function via createWardManager deps — small deps addition, default = two-point path; wire in main). Packet durationMs scale with path length (≈ 90ms per unit... use 12ms × distance, min 700).
- [ ] Verify build+test, curl. Commit `feat: physical roads and conveyors — packets travel the board`.

### Task 3: HUD labels with live counts

**Files:** Create `src/ui/hud.ts`; Modify `src/main.ts`, `src/scene/city.ts` (CSS2DRenderer), `index.html` (label styles), small public stats getters: `src/scenarios/foundry.ts` `stats(): { usedMb: number; capacityMb: number; procs: number }`, `src/scenarios/networkTower.ts` `stats(): { queue: number; phase: string }`, `src/scenarios/surfaceFlinger.ts` `stats(): { composited: number }` (add counter), `src/wards/manager.ts` already has wards()

**hud.ts:** `createHud(): { attach(zone: string, anchor: THREE.Vector3, title: string): void; setLine(zone: string, text: string): void }` — CSS2DObject per zone: div `.hud-label` (title row bold + live row). Styles: dark chip rgba(13,17,23,.85), border 1px #30363d, 11px monospace, pointer-events none. CSS2DRenderer: second renderer in city.ts (domElement absolutely positioned, pointer-events none, resized with main), rendered after WebGL each frame.
- [ ] Implement + attach labels: BOOT ROW, ZYGOTE FOUNDRY, WARDS, CITY HALL · BINDER, SURFACEFLINGER, NETWORK, LAUNCHER. Live lines updated each 500ms accumulator in main loop: wards `${n}/4 running`, foundry `RAM ${used}/${cap}MB · ${procs} procs`, network `queue ${q} · ${phase}`, surfaceflinger `${composited} frames`, launcher `${running.length} apps`, cityhall static 'AMS · WMS · PMS', boot static 'bootloader→kernel→init→system_server'.
- [ ] Per-ward floating label: attach on spawn via manager (inject hud setLine? simpler: manager deps gain optional `onWardSpawned/onWardKilled` callbacks; main attaches/removes CSS2D ward labels `${app} · pid ${pid}`). Remove on demolition.
- [ ] Hide HUD container during setCityDim(true) except BOOT ROW.
- [ ] Verify build+test, curl. Commit `feat: persistent HUD zone labels with live counts`.

### Task 4: Zone densification + props

**Files:** Modify `src/scenarios/{bootRow,foundry,cityHall,surfaceFlinger,networkTower,launcherPlaza}.ts`, Create `src/scene/props.ts` (`makeVent()`, `makePipeRun(length)`, `makeTank()`, `makeAntenna()` — tiny primitive clusters, shared geometries module-scope)

Per zone additions (static, cheap, ~5-10 props each):
- bootStrip: pipe runs along strip + 2 tanks (power/clock feel)
- foundry: 2 rows × 3 blank ward-kit boxes (grey 4×1×4) queued at conveyor mouth + piston tower
- cityhallPit: 4 pillar columns at pit corners + antenna on roof
- surfaceflinger: display wall = 4×1 grid of tile planes (existing tiles move onto it, bigger), stack of "frame crate" boxes near conveyor mouth
- network: antenna array (3 masts back of plate), dish on tower, road-end arch at board edge
- launcherPlatform: railing posts around platform edge, kiosk signs glow slightly stronger
- board corners: 2-3 vents each
- [ ] Implement props.ts + placements. Keep per-file line limits; positions relative to each scenario group.
- [ ] Verify build+test, curl. Commit `feat: zone props and densification`.

### Task 5: Deploy + visual gate

- [ ] `npm run build && npm test` (71 green). Push. `gh run list` success. Curl 200.
- [ ] Report: user visual pass REQUIRED — layout coherence, label overlap, packet-road alignment are eyeball judgments.

## Self-Review Notes
- Sims/story untouched: Task 1 only moves anchors + 3 scenario internal offsets; chapter focus ids resolve through same focusCamera path.
- Type consistency: routes.path consumed in main + manager (injected); stats() getters consumed only by hud wiring in main; ward label callbacks optional in manager deps (default no-op) so W8 tests unaffected.
- Known accepted: per-scenario cameraPos fields go dormant (single default framing); packet y-arc reduced visually by roads but fly() unchanged (arcHeight 1 for routed paths — pass in opts at call sites).
