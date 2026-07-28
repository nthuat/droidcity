# DroidCity Hardware Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Physical hardware layer — CPU (cores lit per ward main-thread activity), RAM bank (segments per running proc), DISK (activity on Room reads/writes) — on a deeper recessed strip behind Boot Row. Sims/story untouched; visuals + read-only stats wiring only.

## Global Constraints
- NO changes to src/sim/**, src/core/**, src/story/**. 71 tests stay green.
- Board grows: depth 120→140; hardware strip z -75..-60, recessed y -0.5 (deeper than boot's -0.2). Back edge text "HARDWARE" moves to z≈-73; boot strip unchanged.
- New district id `hardware` (ANCHORS: (0,0,-68)); switcher button "Hardware"; camera default offset works.
- App colors: chat 0x3fb950, maps 0x388bfd, camera 0xd29922, bank 0xbc8cff (match ward.ts APP_COLORS — import or duplicate consistently).
- Conventional commits, no attribution footer, files <400 lines.

### Task 1: Hardware strip + structures
**Files:** Modify src/scene/board.ts (board 170×140 centered shift: keep existing coords, extend z range to -75; hardware plate 0x263238 at -85..85 × -75..-60, y -0.5; move back-edge silk text), Create src/scenarios/hardwareRow.ts, Modify src/main.ts (register district, ANCHORS.hardware).
- hardwareRow.ts `makeHardwareRowScenario(): Scenario & { setCoreStates(s: {color: number | null; stuck: boolean}[]): void; setRamSegments(s: (number | null)[]): void; diskBlink(write: boolean): void }`:
  - CPU block west (x≈-55): dark housing 14×2×8 + 4 core slot planes on top, dark 0x1c2128 when idle; setCoreStates colors them (emissive 0.7), stuck=red 0xf85149 pulse.
  - RAM bank center (x≈0): 8 upright slabs 2×3×0.8 in a row; setRamSegments colors each (null=grey 0x2a2f36).
  - DISK east (x≈55): cylinder stack (3 platters) + head arm + LED; diskBlink flashes LED (read cyan/write orange 300ms decay).
  - Panel: narration explaining hardware layer; no buttons. setIdle no-op. cameraPos/cameraTarget fields present (dormant).
- [ ] Implement, register (button "Hardware"), build+test 71 green, curl. Commit `feat: hardware row — cpu, ram bank, disk`.

### Task 2: Live wiring
**Files:** Modify src/wards/manager.ts (add `wardStats(): { app: string; plot: number; busy: boolean; anr: boolean }[]` — from each entry's looper.current/anr; ~8 lines), src/scenarios/foundry.ts (stats() gains `procList: { name: string; memoryMb: number }[]`), src/main.ts (+ hud).
- main.ts frame loop (reuse 500ms HUD accumulator for RAM; per-frame for CPU): CPU cores = wardStats by plot index → setCoreStates (color=app color when busy, stuck when anr, null idle). RAM: foundry procList → segments (each proc ⌈memoryMb/150⌉ segments in app color, sequential fill; null rest). DISK: subscribe bus data:cacheHit → diskBlink(false), data:fetched → diskBlink(true).
- HUD: attach hardware zone labels — CPU `${busy}/4 busy`, RAM reuse foundry `${used}/${cap}MB`, DISK `r:${reads} w:${writes}` (counters in main). Either one combined HARDWARE label with 3 lines or three small labels at sub-anchors — implementer's call, note choice.
- [ ] Implement, build+test 71 green, curl. Commit `feat: hardware live wiring — cores, ram segments, disk activity`.

### Task 3: Deploy
- [ ] build+test, push, Actions success, curl 200. User visual gate note.

## Self-Review
- wardStats read-only derived; W8 tests unaffected (new method additive). Board z extension: check fog far 380 still covers z -75 from overview (0,85,105) — distance ~190, fine. Ward plot/pit/platform coords untouched.
