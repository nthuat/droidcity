# Four More Concepts Implementation Plan

**Goal:** BroadcastReceiver as a real component · ViewRootImpl ↔ WMS window registration · Compose's composition→layout→draw · multi-window (split screen).

**Order:** broadcasts → window registration → Compose phases → multi-window (last: it breaks the single-foreground invariant the rest of the model assumes).

## Global constraints
- Pure sims stay pure; new state gets tests.
- Android green = alive/running; amber = deferred/waiting; blue = system surface.
- 151 tests keep passing; commit per feature; deploy once at the end.

---

### 1 · BroadcastReceiver
Concepts: manifest-declared vs context-registered receivers · a manifest receiver can **start a dead process** · `onReceive` runs on the main thread with its own ANR timer (10s foreground / 60s background) · implicit broadcasts restricted since O.

- Ward gains a **mailbox** mesh (registered receiver) that lights on delivery.
- City Hall panel: `Send broadcast` (existing, rewired) → fans out to every LIVE ward (context-registered) AND cold-starts one dead app via its manifest receiver, the teaching beat.
- `onReceive` posts a real main-thread message (so blocking it can ANR).
- Tooltips carry the manifest/registered split and the timers.

### 2 · ViewRootImpl ↔ WMS
Concepts: on resume the app calls `WindowManager.addView` → **ViewRootImpl** is created → registers the window with **WMS** → WMS asks **SurfaceFlinger** for a Surface → ViewRootImpl drives every traversal (measure→layout→draw) into it.

- Ward gains a **window token** mast that lights when the window is registered.
- On `activity:resumed`: packet ward → WMS wing, then WMS → SF (surface request), then SF → ward (the Surface).
- On `activity:backgrounded`/kill: token dims (window removed).

### 3 · Compose phases
Concepts: Compose replaces measure/layout/draw with **composition → layout → draw**, driven by snapshot state; recomposition scopes skip unchanged subtrees; below `draw` it joins the same RenderThread → SF path.

- Ward panel toggle: `UI: Views` ⇄ `UI: Compose`.
- In Compose mode the bench stations relabel (`composition`, `layout`, `draw`, `renderThread`) and narration explains skipping.
- The frame sim is unchanged, that IS the point: the lower half is identical.

### 4 · Multi-window
Concepts: split screen shows two apps; since Android 10 **both are RESUMED** (multi-resume); both hold oom_adj 0; SF composites two bright tiles; the display splits.

- `Split screen` toggle on the display (nav strip) or SurfaceFlinger panel.
- Screen renders two half panels; SF lights two bright tiles.
- WardManager: `bringToForeground` keeps a *set* of foreground apps when split is on (max 2), and both get `foreground` priority.
- Off → the most recent stays, the other backgrounds.

## Verification
Build + tests per feature; deploy once; then in the browser: broadcast wakes a dead app · resume lights the window token and flies the surface handshake · Compose toggle relabels the bench · split screen shows two live apps and two bright tiles.
