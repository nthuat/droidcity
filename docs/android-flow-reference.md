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

## Phase 4 — Memory management (continuous)

Two independent layers: **GC works inside one process's heap; lmkd kills whole processes.** Different tools, different scales, often confused.

### ART garbage collector (per-process)
1. **Allocation** — objects land in region-based heap via thread-local allocation buffers (TLABs) — allocation is normally just a pointer bump, no lock.
2. **Collector** — since Android 8: **Concurrent Copying (CC)** collector, generational since Android 10 — most collections are **young-generation** (recently allocated objects die young; sweep is cheap). Full-heap CC runs rarer; compacts regions to fight fragmentation.
3. **Pauses** — CC is concurrent with the app; stop-the-world pauses are sub-ms (a far cry from Dalvik's tens of ms). GC almost never causes jank on modern Android; blaming GC for jank is usually wrong post-Oreo.
4. **Triggers** — allocation pressure (heap grows toward its limit: `dalvik.vm.heapgrowthlimit`, raised by `android:largeHeap`), app going background (compacting GC to shrink footprint), explicit `System.gc()` (a hint).
5. **Reference types** — soft (cleared under pressure), weak (cleared at next GC), phantom (post-mortem cleanup); finalizers/Cleaner run on a dedicated thread — slow finalizers delay reclamation.
6. **OutOfMemoryError** — thrown when the heap can't grow past its limit even after full GC; almost always a leak (something still reachable — Activity held by a static, listener never unregistered).

### System memory pressure: PSI → lmkd → kill
7. **Before killing:** kernel reclaims — drops clean file pages, and swaps anonymous pages to **zram** (compressed RAM swap — Android's "swap" is usually RAM squeezing itself). `kswapd` does this in background.
8. **PSI (Pressure Stall Information)** — `/proc/pressure/memory` reports what % of time tasks stalled waiting for memory (`some` = at least one task, `full` = all). This measures actual pain, not free-byte counts. Modern **lmkd is PSI-driven**: it registers epoll listeners on PSI thresholds (e.g. partial stall over a 1s window) instead of the legacy minfree watermarks.
9. **oom_adj scores** — AMS's `OomAdjuster` continuously computes each process's importance and writes `/proc/<pid>/oom_score_adj` (-1000…1000). The standard ladder:

| Score | Constant | Meaning |
|---|---|---|
| -1000 | NATIVE_ADJ | native daemons — untouchable by lmkd |
| -900 | SYSTEM_ADJ | system_server |
| -800 | PERSISTENT_PROC_ADJ | persistent apps (phone, systemui) |
| 0 | FOREGROUND_APP_ADJ | the app you're looking at |
| 100 | VISIBLE_APP_ADJ | visible but not focused (dialog behind) |
| 200 | PERCEPTIBLE_APP_ADJ | perceptible — foreground service, playing audio |
| 300 | BACKUP_APP_ADJ | mid-backup |
| 500 | SERVICE_ADJ | running a started service |
| 600 | HOME_APP_ADJ | the launcher (kept warm — going home must be instant) |
| 700 | PREVIOUS_APP_ADJ | the app you just left (back-switch is common) |
| 800 | SERVICE_B_ADJ | old/long-running services |
| 900-999 | CACHED_APP_MIN…MAX | cached/empty processes — kill fodder, LRU-ordered within |

10. **The kill** — on a PSI event, lmkd walks from the highest score down, picks the victim (largest RSS as tiebreak within a bucket), **SIGKILL** — no callback, no goodbye. This is why `onDestroy` is never guaranteed and why saved instance state / persistence matter: a cached app's death is silent and routine.
11. **Cooperative layer** — before/alongside kills, AMS sends `onTrimMemory(level)` (ComponentCallbacks2: TRIM_MEMORY_RUNNING_LOW … TRIM_MEMORY_COMPLETE) so apps can drop caches voluntarily; well-behaved apps shrink instead of dying.
12. **Restore** — user returns to a killed app: AMS cold-starts the process again (Zygote fork), Activity gets its `savedInstanceState` Bundle back; with ViewModel + SavedStateHandle + Room, a good app resumes as if nothing happened.

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

### Memory management
| Real thing | DroidCity | Status |
|---|---|---|
| GC per-process, reachable vs garbage, sweep | ward heap yard + sweep plane | ✅ |
| Generational / concurrent copying detail | GC narration hedges "ART keeps pauses sub-ms" | ⚠️ fine at this depth |
| GC on background transition, largeHeap, soft/weak refs | — | ❌ minor |
| OOM = leak (all reachable) | gc OOM narration says exactly this | ✅ |
| **oom_adj score ladder** (0/100/200/500/600/700/900) | 4 coarse priorities (foreground/visible/service/cached) | ⚠️ ladder + HOME/PREVIOUS special slots would teach more; ward panel could show live score |
| **lmkd as its own daemon; SIGKILL, no callback** | foundry does the killing itself; no "no goodbye" beat | ⚠️ narration: onDestroy never guaranteed |
| **PSI pressure signals driving kills** | kills trigger on hard RAM-full arithmetic | ❌ RAM bank could show a pressure gauge (stall %, not just fullness) — kills fire from pressure, not exact fullness |
| zram/kswapd reclaim before killing | — | ❌ minor |
| onTrimMemory cooperative shrink | — | ❌ good beat: wards voluntarily dropping crates under pressure BEFORE lmkd reaches for the crane |
| Silent kill → savedInstanceState restore | LMK demolition exists; restore untold | ❌ ch4 finale could relaunch the killed app and restore instantly |

### Not modeled at all (out of scope so far, fine for v-next list)
Services / broadcasts / ContentProviders · JobScheduler/WorkManager/Doze · permissions/SELinux · ART JIT/AOT profiles · multi-window · process death + saved-state restore (LMK kills exist, but restore story untold).

---

## Concept atlas — what the vertical slice skips

The flow above is one path through the system. These are the concepts an Android engineer is expected to hold that live OUTSIDE that path. Tagged: 🏙 = worth modeling in DroidCity eventually · 📖 = reference-only (doc/interview material, not city material).

**🏙 Binder mechanics** (we use it as "roads via City Hall" but the machine itself): kernel `/dev/binder` driver; **one-copy** transfers via mmap'd receive buffers; each process owns a **binder thread pool** (default max ~16) — incoming calls run on those, not your main thread; `oneway` (async) vs synchronous calls; the **~1MB transaction buffer** shared per process — `TransactionTooLargeException` when a Parcel (e.g. a giant Bundle in `onSaveInstanceState`) blows it; **death recipients** (`linkToDeath`) — how system_server notices an app died; AIDL generates the Parcel marshalling.

**🏙 The four components + Intents**: Activity, **Service** (started vs bound; foreground services with notification), **BroadcastReceiver** (system events; registered vs manifest), **ContentProvider** (data sharing across UIDs; initialized before `Application.onCreate` — startup cost). **Intents**: explicit vs implicit, resolution by PMS against manifest intent-filters. This is THE textbook Android abstraction set and DroidCity models only Activity.

**🏙 Cold / warm / hot start**: doc's Phase 2 is a **cold** start (fork everything). **Warm** = process alive, Activity recreated (no fork, no Application.onCreate). **Hot** = everything alive, just brought to front. Launcher tap on a cached ward should NOT rebuild the ward — instant hot start would teach why cached processes exist (ties directly into oom_adj 700/900 and LMK).

**🏙 ANR ladder** (we model input-ANR only): input dispatch **5s** · foreground service **20s** · broadcast receiver **10s** (foreground) · JobScheduler jobs. Different timers, same disease: a blocked main looper.

**🏙 Tasks & back stack**: tasks (Recents entries), back stack of activities, `launchMode` (standard / singleTop / singleTask / singleInstance), task affinity, predictive back. Explains what "back" actually does — a stack of floors/rooms metaphor fits the tower naturally.

**📖 Install & ART compilation pipeline**: APK (zip: dex, resources, native libs, manifest) → `installd` → **dex2oat**: install-time partial AOT, then **JIT** at runtime with **profile-guided AOT** re-compiles during idle-charge (baseline profiles ship those hot-path profiles with the app for fast first launches). Interpreter → JIT → AOT tiers.

**📖 Compose pipeline** (the doc's render path is View-centric): Compose = declarative UI over the same lower half — **composition → layout → draw** phases per frame, driven by **snapshot state** invalidations (recomposition scopes, skipping via stable types). Below `draw` it joins the exact same RenderThread → SF path. Choreographer/vsync unchanged.

**📖 Notifications**: app posts → **NotificationManagerService** (system_server) → ranking/channels (user-controlled importance since O) → SystemUI renders shade/status bar. PendingIntent = a capability token letting SystemUI fire YOUR intent with YOUR identity later.

**📖 Power management**: wakelocks (PowerManager), **Doze** (deep idle: network off, jobs/alarms deferred to maintenance windows), **App Standby Buckets** (active/working set/frequent/rare/restricted — usage-based throttling), why WorkManager exists (constraint-aware, Doze-respecting deferred work) vs AlarmManager (exact-time, user-visible things).

**📖 Networking below OkHttp**: ConnectivityService picks default network (wifi/cell scoring, VPN), `netd` programs kernel routing/firewall per-UID, DNS via resolver service, radio through RIL/HAL. Network security config + cert validation on the TLS step. Per-UID traffic accounting = how the OS bills data to apps.

**📖 Storage model**: per-app sandbox `/data/data/<pkg>` (the Room shed) · **scoped storage** (MediaStore/SAF for shared files — no more raw sdcard access) · **file-based encryption** (FBE: DE vs CE storage — why direct-boot apps split data) · app-specific external dirs.

**📖 Security model stack**: per-app Linux UID (modeled as ward walls) + **SELinux** domains (even root is confined) + **runtime permissions** (dangerous perms prompted, granted per-UID by PMS) + **app signing** (v2/v3 scheme, Play signing) + hardware **Keystore/StrongBox** (keys never enter app memory) + verified boot (AVB) chaining from Phase 1's bootloader.

**📖 IPC menu beyond Binder**: ContentProvider (structured data), Messenger (Binder-wrapped Handler), shared memory (`ashmem`/`SharedMemory` for big blobs — how providers pass cursors), Unix sockets (Zygote's own command channel is one).

**Priority for DroidCity v3, if extended:** components+Intents (biggest conceptual hole — Services/broadcasts are half of real apps), then cold/warm/hot starts (cheap, reuses everything), then Binder mechanics beat (thread pool + 1MB limit as narration on City Hall), then ANR ladder (narration-only). The 📖 set stays doc-only — city can't carry everything without becoming noise.

---

## Priority recommendations (highest teaching value ÷ effort)

1. **Worker-thread lane in the ward** — second small road ("worker pool") beside the main road; data requests hop main → worker (packet), IO happens from the worker lane, result hops back to main. Kills the "main thread does IO" misread; makes the ANR beat land harder ("this is what happens when you DON'T hop"). Medium effort.
2. **Input's system-side trip** — ch4 step 1 & free-mode: tap starts at hardware row (touch) → City Hall (InputDispatcher) → ward road. Reuses packets + existing districts. Low effort.
3. **Starting window beat in ch2** — when kiosk tapped, ward plot shows a ghost/outline "splash" instantly, real ward rises under it, ghost fades at first frame:composited. Explains why launches feel fast. Low-medium.
4. **Application vs Activity floor** — 4th tower floor at base labeled `Application` lighting before the lifecycle floors (bindApplication). Low effort, fixes a real interview distinction.
5. **Boot order narration fix** — ch1: "init starts Zygote; the foundry's first casting is system_server itself." One line, free. Also light SF district during boot.
6. **Vsync mention** — bench tooltip + ch4 narration: name Choreographer/vsync. Free.

7. **PSI pressure gauge + oom_adj ladder** — RAM bank gets a pressure needle (stall-based, twitching before kills); ward labels/panels show live oom_adj score climbing as the app is demoted (0 → 700 → 900) so the kill order is visibly earned, not arbitrary. Foundry kill narration: "SIGKILL — no callback, onDestroy never ran." Medium effort.
8. **onTrimMemory beat** — under pressure, wards voluntarily shed grey crates (cooperative trim) before lmkd's crane moves. Low effort (bus event + ward reaction).
9. **Kill → restore loop** — after an LMK demolition, relaunching the same app restores instantly (ViewModel orb + saved state framing). Closes the "why persistence matters" arc. Low-medium.

Items 5-6 are narration-only. 1-4, 7-9 touch code.
