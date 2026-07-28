# Android: Power-On → App Launch → Tap → Data → Pixel

Reference of the real flow, then a gap audit against DroidCity's current model.
Written for checking coverage — each numbered item is a checkable unit.

---

## Phase 1 — Boot: power to home screen

1. **Boot ROM** — SoC-internal code; verifies + loads the bootloader from fixed storage. (Microseconds; usually skipped in diagrams.)
2. **Bootloader** (ABL/LK/U-Boot) — initializes minimal hardware, verifies (AVB) and loads the kernel + ramdisk. Fastboot lives here.
3. **Kernel** — Linux boots: CPU/memory init, drivers (storage, display, input, radio), mounts ramdisk, starts PID 0/kernel threads. Android-specific bits: binder driver, ashmem, lmkd hooks, SELinux policy load begins.
4. **init (PID 1)** — first userspace process. Parses `init.rc`: mounts partitions, applies SELinux, starts core daemons:
   - `ueventd` (device nodes), `logd`, `servicemanager` (**Binder name service** — the phone book every Binder client asks), `vold` (storage), HALs (camera, audio, radio…), `surfaceflinger` (yes — SF starts at init stage, not later), `netd`, `zygote`.
5. **Zygote** — started by init. Loads ART, **preloads ~thousands of framework classes + shared resources** into memory, then opens a socket and waits. Every app process will be a `fork()` of this warm template — copy-on-write shares the framework pages.
6. **system_server** — the **first fork of Zygote**. Hosts ~100 system services in one process: ActivityManagerService (AMS)/ActivityTaskManager, WindowManagerService (WMS), PackageManagerService (PMS — scans installed APKs at boot), PowerManager, InputManagerService (InputReader + InputDispatcher threads), JobScheduler, ConnectivityService…
7. **Launcher** — AMS is ready → fires `Intent.CATEGORY_HOME` → the launcher app (itself just an app, forked from Zygote like any other) starts and draws the home screen.
8. **`ACTION_BOOT_COMPLETED`** broadcast → apps with receivers wake up.

Order that matters: init → **Zygote → system_server** (system_server is forked FROM Zygote). SurfaceFlinger runs from init stage, independent of Zygote.

## Phase 2 — Cold app launch: tap icon → first frame

1. **Tap on launcher icon** — actual input pipeline (see Phase 3, steps 1-3) delivers the tap to the launcher app.
2. **`startActivity()`** — launcher makes a **Binder call** to AMS/ATMS in system_server. Nothing is started by the launcher itself.
3. **AMS checks target process.** Exists → skip to 6. Doesn't → :
4. **Starting window** — WMS shows the splash/starting window immediately (this is why apps "appear" fast even when cold).
5. **Zygote fork** — AMS writes to the zygote socket; Zygote `fork()`s. Child becomes the app process: sets process name/UID (sandbox = one Linux UID per app), starts `ActivityThread.main()` → `Looper.prepareMainLooper()` → **the main thread and its MessageQueue exist from here**. Process makes a Binder call back to AMS ("attach").
6. **bindApplication** — AMS → app: create `Application` object, call `Application.onCreate()` (ContentProviders initialize *before* this — classic startup-cost gotcha).
7. **Activity launch** — AMS schedules the activity: `onCreate()` (inflate layout, ViewModel wired), `onStart()`, `onResume()`. `ViewRootImpl` created; window registered with **WMS** (Binder); a Surface is allocated from SurfaceFlinger.
8. **First frame** — Choreographer vsync callback → measure → layout → draw (display list) → **RenderThread** renders via GPU → frame queued to the app's Surface → **SurfaceFlinger** composites all surfaces (with HWC offload when possible) → display. Starting window cross-fades out.

## Phase 3 — Tap in the app → data on screen

**Input:**
1. Kernel `evdev` driver reports touch → **InputReader** thread (system_server) decodes.
2. **InputDispatcher** thread finds the focused window, sends the event over that window's **InputChannel** (socketpair) to the app.
3. App main thread: `ViewRootImpl` → `dispatchTouchEvent()` walks the view tree → your `onClickListener` runs **as a message on the main Looper**.

**Data (cache-then-network, the standard repository pattern):**
4. Click handler asks ViewModel → repository. Repository launches work **off the main thread** (coroutine dispatcher / executor — Room and OkHttp both refuse main-thread by default).
5. **Room query** (SQLite file in `/data/data/<pkg>/databases/`, app-private). ~ms. Returns cached/stale rows → emitted via Flow/LiveData → **main thread** renders the stale list immediately.
6. **Network fetch** — OkHttp: DNS → TCP connect → TLS handshake → request → TTFB wait → body download. Connection pooling/HTTP2 reuse skips the first three on warm connections. Timeouts → retry with backoff. Radio itself is shared hardware; the socket lives in the app process.
7. **Parse + insert** — JSON decoded (worker thread), `INSERT`/`UPSERT` into Room. Room invalidation tracker notices the table changed → the same Flow from step 5 **re-emits fresh rows automatically** (this is why cache-then-network is nearly free with Room+Flow).
8. **UI update** — new list posted to main thread → `submitList`/state update → `invalidate()`.

**Render (every frame, 16.67ms budget @60Hz):**
9. `Choreographer` schedules on next **vsync**: input callbacks → animation callbacks → traversal (measure/layout/draw).
10. Draw records a display list; **RenderThread** turns it into GPU commands (main thread is already free).
11. GPU renders into a buffer from the Surface's BufferQueue (triple buffering absorbs hiccups).
12. **SurfaceFlinger** (own process) latches ready buffers at its vsync offset, composites every visible app's surface (HWC does overlay composition in hardware when it can) → scanout.
13. **Jank** = the app-side work (9-10) missing the vsync train → frame shown twice. **ANR** = main thread's Looper blocked ≥5s for input (different failure: not slow drawing, but a blocked queue).

**Memory (continuous background):**
14. ART GC — generational, mostly **concurrent** (sub-ms pauses), triggered by allocation pressure.
15. **lmkd** — kills whole processes under memory pressure by `oom_adj` score (foreground 0 … cached 900+). Cached apps die first, oldest first-ish. Saved state means a killed app can restore.

---

## DroidCity coverage audit

Legend: ✅ modeled · ⚠️ simplified (acceptable/on purpose) · ❌ missing (candidate)

### Boot
| Real thing | DroidCity | Status |
|---|---|---|
| Bootloader → kernel → init | Boot Row stations 1-3 | ✅ |
| Zygote preloading (warm template) | Foundry narration + fork behavior | ✅ |
| **init forks Zygote; system_server forked FROM Zygote** | Boot Row shows init → system_server as sequential stations; Zygote "already warm" beside it | ⚠️ order blurred — ch1 narration could fix free (ledger noted) |
| servicemanager / Binder name service | — | ❌ (fold into City Hall note?) |
| SurfaceFlinger starts at init stage | SF district exists; boot ch1 doesn't light it | ⚠️ |
| PMS APK scan at boot | — | ❌ minor |
| BOOT_COMPLETED broadcast | — | ❌ minor |
| HALs / drivers | Hardware row (CPU/RAM/DISK) | ⚠️ radio HAL missing; network tower implies it |

### App launch
| Real thing | DroidCity | Status |
|---|---|---|
| Launcher startActivity via Binder to AMS | kiosk → `app:launchRequested` → packet via City Hall | ✅ (Binder two-hop) |
| **Starting window / splash** | — | ❌ good teaching beat: why cold starts *look* fast |
| Zygote socket + fork | Foundry stamp | ✅ |
| ActivityThread.main / Looper created at process start | Ward spawns with road pre-built | ⚠️ fine |
| attach → bindApplication → **Application.onCreate** | — | ❌ ward rise jumps straight to Activity; App-vs-Activity distinction matters (ContentProvider init cost) |
| Activity onCreate/onStart/onResume | Tower floors | ✅ |
| ViewRootImpl + window registered with WMS | — | ❌ City Hall has a WMS wing label only |
| Surface allocated from SF | implicit | ⚠️ |
| First frame via full pipeline | bench → SF → tile | ✅ |

### Tap → data → pixel
| Real thing | DroidCity | Status |
|---|---|---|
| InputReader/InputDispatcher in system_server → InputChannel | — | ❌ ch4 injects `ui:messagePosted` directly; input's *system-side* trip (kernel → City Hall → ward) untold — bench "input" stage is app-side only |
| Click runs as main-Looper message | road cars | ✅ |
| **Work moves OFF main thread for IO** (coroutines/executors) | ward has ONE road; DB/network requests leave from it directly | ❌ biggest conceptual gap: real apps hop main → worker → main; DroidCity implies main thread does IO — the exact anti-pattern the ANR beat warns about |
| Room query, app-private file | Room shed + DISK blink | ✅ |
| Cache-then-network + Flow re-emission | ch3 stale-then-fresh | ✅ (mechanism ⚠️ — Room invalidation/Flow not named) |
| OkHttp phases + retry/backoff | Network Tower phases | ✅ |
| Connection pooling (warm skips dns/tls) | every request runs all phases | ⚠️ |
| Choreographer + vsync scheduling | frames start on message arrival | ⚠️ vsync never mentioned — the "16ms train" narration implies it |
| RenderThread off main | bench station | ✅ |
| BufferQueue / triple buffering | — | ❌ minor (plan's known simplification) |
| SF + HWC composition | SF district | ✅ (HWC ❌ minor) |
| Jank (missed vsync) vs ANR (blocked looper) | ch4 shows both distinctly | ✅ |
| ART concurrent GC | ward GC sweep; narration hedges stop-the-world | ✅ |
| lmkd oom_adj tiers | 4 priorities, cached-first kills | ⚠️ good enough |

### Not modeled at all (out of scope so far, fine for v-next list)
Services / broadcasts / ContentProviders · JobScheduler/WorkManager/Doze · permissions/SELinux · ART JIT/AOT profiles · multi-window · process death + saved-state restore (LMK kills exist, but restore story untold).

---

## Priority recommendations (highest teaching value ÷ effort)

1. **Worker-thread lane in the ward** — second small road ("worker pool") beside the main road; data requests hop main → worker (packet), IO happens from the worker lane, result hops back to main. Kills the "main thread does IO" misread; makes the ANR beat land harder ("this is what happens when you DON'T hop"). Medium effort.
2. **Input's system-side trip** — ch4 step 1 & free-mode: tap starts at hardware row (touch) → City Hall (InputDispatcher) → ward road. Reuses packets + existing districts. Low effort.
3. **Starting window beat in ch2** — when kiosk tapped, ward plot shows a ghost/outline "splash" instantly, real ward rises under it, ghost fades at first frame:composited. Explains why launches feel fast. Low-medium.
4. **Application vs Activity floor** — 4th tower floor at base labeled `Application` lighting before the lifecycle floors (bindApplication). Low effort, fixes a real interview distinction.
5. **Boot order narration fix** — ch1: "init starts Zygote; the foundry's first casting is system_server itself." One line, free. Also light SF district during boot.
6. **Vsync mention** — bench tooltip + ch4 narration: name Choreographer/vsync. Free.

Items 5-6 are narration-only. 1-4 touch code.
