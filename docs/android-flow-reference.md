# Android: Power-On → App Launch → Tap → Data → Pixel

Reference of the real flow, then a gap audit against DroidCity's current model.
Written for checking coverage — each numbered item is a checkable unit.

---

## Phase 1 — Boot: power to home screen

1. **Boot ROM** — SoC-internal code; verifies + loads the bootloader from fixed storage. (Microseconds; usually skipped in diagrams.)
2. **Bootloader** (ABL/LK/U-Boot) — initializes minimal hardware, verifies (AVB) and loads the kernel + ramdisk. Fastboot lives here.
3. **Kernel** — Linux boots: CPU/memory init, drivers (storage, display, input, radio), mounts ramdisk, starts PID 0/kernel threads. Android-specific bits: binder driver, ashmem, PSI accounting (what lmkd will listen to), SELinux policy load begins.
4. **init (PID 1)** — first userspace process. Parses `init.rc`: mounts partitions, applies SELinux, starts core daemons:
   - `ueventd` (device nodes), `logd`, `servicemanager` (**Binder name service** — the phone book every Binder client asks), `vold` (storage), HALs (camera, audio, radio…), `surfaceflinger` (yes — SF starts at init stage, not later), `netd`, `zygote`.
5. **Zygote** — started by init (usually twice: `zygote64` + `zygote` for 32-bit ABIs). Loads ART, **preloads ~thousands of framework classes + shared resources** into memory, then opens a socket and waits (modern Android can keep an opt-in **USAP pool** of pre-forked blanks, disabled by default in AOSP, to skip even the fork on hot launch paths). Every app process will be a `fork()` of this warm template — copy-on-write shares the framework pages.
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
4. Click handler asks ViewModel → repository. Repository launches work **off the main thread** (coroutine dispatcher / executor — Room refuses the main thread by default; networking on it throws the OS's NetworkOnMainThreadException (StrictMode)).
5. **Room query** (SQLite file in `/data/data/<pkg>/databases/`, app-private). ~ms. Returns cached/stale rows → emitted via Flow/LiveData → **main thread** renders the stale list immediately.
6. **Network fetch** — OkHttp: DNS → TCP connect → TLS handshake → request → TTFB wait → body download. Connection pooling/HTTP2 reuse skips the first three on warm connections. Timeouts → retry with backoff. Radio itself is shared hardware; the socket lives in the app process.
7. **Parse + insert** — JSON decoded (worker thread), `INSERT`/`UPSERT` into Room. Room invalidation tracker notices the table changed → the same Flow from step 5 **re-emits fresh rows automatically** (this is why cache-then-network is nearly free with Room+Flow).
8. **UI update** — new list posted to main thread → `submitList`/state update → `invalidate()`.

**Render (every frame, 16.67ms budget @60Hz):**
9. `Choreographer` schedules on next **vsync**: input callbacks → animation callbacks → traversal (measure/layout/draw).
10. Draw records a display list; **RenderThread** turns it into GPU commands (main thread is already free) — issued via **Skia/HWUI on top of OpenGL ES or Vulkan**.
11. GPU renders into a buffer from the Surface's BufferQueue (triple buffering absorbs hiccups).
12. **SurfaceFlinger** (own process) latches ready buffers at its vsync offset, composites every visible app's surface (HWC does overlay composition in hardware when it can) → scanout.
13. **Jank** = the app-side work (9-10) missing the vsync train → frame shown twice. **ANR** = main thread's Looper blocked ≥5s for input (different failure: not slow drawing, but a blocked queue).

## Phase 4 — Memory management (continuous)

Two independent layers: **GC works inside one process's heap; lmkd kills whole processes.** Different tools, different scales, often confused.

### ART garbage collector (per-process)
1. **Allocation** — objects land in region-based heap via thread-local allocation buffers (TLABs) — allocation is normally just a pointer bump, no lock.
2. **Collector** — since Android 8: **Concurrent Copying (CC)** collector, generational since Android 10 — and Android 13+ replaced CC with the userfaultfd-based Concurrent Mark-Compact (CMC) collector as default — most collections are **young-generation** (recently allocated objects die young; sweep is cheap). Full-heap CC runs rarer; compacts regions to fight fragmentation.
3. **Pauses** — CC is concurrent with the app; stop-the-world pauses are sub-ms (a far cry from Dalvik's tens of ms). GC almost never causes jank on modern Android; blaming GC for jank is usually wrong post-Oreo.
4. **Triggers** — allocation pressure (heap grows toward its limit: `dalvik.vm.heapgrowthlimit`, raised by `android:largeHeap`), app going background (compacting GC to shrink footprint), explicit `System.gc()` (a hint).
5. **Reference types** — soft (cleared under pressure), weak (cleared at next GC), phantom (post-mortem cleanup); finalizers/Cleaner run on a dedicated thread — slow finalizers delay reclamation.
6. **OutOfMemoryError** — thrown when the heap can't grow past its limit even after full GC; almost always a leak (something still reachable — Activity held by a static, listener never unregistered).

### Virtual memory under the heap
- Every process gets a private VIRTUAL address space; page tables translate to physical pages. The ward's heap is the virtual view; the RAM bank is physical.
- **Zygote COW**: fork() copies page TABLES, not pages — framework pages stay shared read-only until written (copy-on-write). One physical copy serves every app. This is why per-process memory is reported as **PSS** (proportional share of shared pages), not raw RSS.
- **mmap / file-backed pages**: APK, dex/oat, libraries are memory-mapped from flash — paged in on demand (page fault → read), evictable for free (clean pages have a backing file). Anonymous pages (heap) have no file — under pressure they go to zram instead.
- **Demand paging**: nothing is resident until touched; cold-start page faults are part of why first launches cost more.

### Stacks vs heap

Every thread owns a private stack — call frames, locals, ~8MB for the Java main thread (1MB typical for others) — allocated on creation, reclaimed frame-by-frame on return. No GC involved: stack memory is free. The heap is the opposite: shared by all threads, garbage-collected. A process's thread inventory at rest: main, RenderThread, ~15 binder pool threads, HeapTaskDaemon/GC threads, JIT, plus whatever worker pools the app spawns (OkHttp dispatcher, coroutine dispatchers). StackOverflowError = one thread's stack exhausted (deep recursion); OutOfMemoryError = the shared heap. Different failures, different memories.

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

(Abbreviated — omits PERSISTENT_SERVICE −700 and HEAVY_WEIGHT 400.)

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
| **init forks Zygote; system_server forked FROM Zygote** | ch1: init "warms the foundry"; system_server "the foundry's first casting" | ✅ (fixed) |
| servicemanager / Binder name service | City Hall tooltip | ✅ (v4, note-level) |
| SurfaceFlinger starts at init stage | SF district un-dims at init stage during boot replay | ✅ (fixed) |
| PMS APK scan at boot | — | ❌ minor |
| BOOT_COMPLETED broadcast | broadcast fan-out fires on boot:complete (v3) | ✅ |
| HALs / drivers | Hardware row (CPU/RAM/DISK) | ⚠️ radio HAL missing; network tower implies it |

### App launch
| Real thing | DroidCity | Status |
|---|---|---|
| Launcher startActivity via Binder to AMS | kiosk → `app:launchRequested` → packet via City Hall | ✅ (Binder two-hop) |
| **Starting window / splash** | ghost splash on plot from fork until first composite | ✅ (fixed) |
| Zygote socket + fork | Foundry stamp | ✅ |
| ActivityThread.main / Looper created at process start | Ward spawns with road pre-built | ⚠️ fine |
| attach → bindApplication → **Application.onCreate** | Application base floor lights at rise-complete, before lifecycle floors | ✅ (fixed) |
| Activity onCreate/onStart/onResume | Tower floors | ✅ |
| ViewRootImpl + window registered with WMS | — | ❌ City Hall has a WMS wing label only |
| Surface allocated from SF | implicit | ⚠️ |
| First frame via full pipeline | bench → SF → tile | ✅ |

### Tap → data → pixel
| Real thing | DroidCity | Status |
|---|---|---|
| InputReader/InputDispatcher in system_server → InputChannel | ch4 + kiosk taps fly hardware → City Hall → ward input packets | ✅ (fixed) |
| Click runs as main-Looper message | road cars | ✅ |
| **Work moves OFF main thread for IO** (coroutines/executors) | worker pool lane in each ward; worker cars per in-flight request | ✅ (fixed) |
| Room query, app-private file | Room shed + DISK blink | ✅ |
| Cache-then-network + Flow re-emission | ch3 stale-then-fresh | ✅ (mechanism ⚠️ — Room invalidation/Flow not named) |
| OkHttp phases + retry/backoff | Network Tower phases | ✅ |
| Connection pooling (warm skips dns/tls) | pooled requests skip to ttfb (30s window, cleared on process kill) | ✅ (v4) |
| Choreographer + vsync scheduling | named in ch4 narration + input-stage tooltip (frame start still message-driven ⚠️) | ✅ (fixed) |
| RenderThread off main | bench station | ✅ |
| BufferQueue / triple buffering | compositor tooltip | ✅ (v4, tooltip-level) |
| SF + HWC composition | SF district + HWC sentence on display-wall tooltip | ✅ (v4) |
| Jank (missed vsync) vs ANR (blocked looper) | ch4 shows both distinctly | ✅ |
| CPU core occupancy per process | core afterglow + app-color mapping + ANR red | ✅ (v5) |
| Single-foreground rendering (one visible app) | bright/faint/dark display tiles + background wards render nothing | ✅ (v5) |

### Memory management
| Real thing | DroidCity | Status |
|---|---|---|
| GC per-process, reachable vs garbage, sweep | ward heap yard + sweep plane | ✅ |
| Generational / concurrent copying detail | GC narration hedges "ART keeps pauses sub-ms" | ⚠️ fine at this depth |
| GC on background transition, largeHeap, soft/weak refs | — | ❌ minor |
| OOM = leak (all reachable) | gc OOM narration says exactly this | ✅ |
| **oom_adj score ladder** (0/100/200/500/600/700/900) | live oom_adj on ward labels (0/100/500/900 — 100 via bound-service visibility inheritance); HOME/PREVIOUS slots unmodeled | ✅ (fixed, partial ladder ⚠️) |
| **lmkd as its own daemon; SIGKILL, no callback** | kill narration: "SIGKILL — no callback, onDestroy never ran" (foundry still plays both AMS and lmkd roles ⚠️) | ✅ (fixed) |
| **PSI pressure signals driving kills** | PSI gauge on RAM bank + HUD %, fork-spike decay | ✅ (v4: kills now PSI-edge-triggered at 85% + fork-reclaim fallback) |
| zram/kswapd reclaim before killing | — | ❌ minor |
| onTrimMemory cooperative shrink | memory:trim event — wards shed crates + sweep on pressure | ✅ (fixed) |
| Silent kill → savedInstanceState restore | ch4 finale relaunches; restored wards rise 2x fast + panel badge | ✅ (fixed) |
| Virtual memory: COW shared framework pages, mmap, PSS | shared slabs in RAM bank + tooltips | ✅ (v3.1; demand paging doc-only) |
| Per-app RAM fill (live heap → physical pages view) | slab tanks fill/drain with ward heap; GC pulse | ✅ (v5) |
| Threads + per-thread stacks | ward thread rack (main/render/binder/worker posts, live-lit) + stacks doc | ✅ (v5.1) |

### Not modeled at all (out of scope so far, fine for v-next list)
JobScheduler/WorkManager/Doze · permissions/SELinux · ART JIT/AOT profiles · multi-window. (Started services, broadcasts-minimal, and kill→restore shipped in v3.)

---

## Concept atlas — what the vertical slice skips

The flow above is one path through the system. These are the concepts an Android engineer is expected to hold that live OUTSIDE that path. Tagged: 🏙 = worth modeling in DroidCity eventually · 📖 = reference-only (doc/interview material, not city material).

**🏙 Binder mechanics** (we use it as "roads via City Hall" but the machine itself): kernel `/dev/binder` driver; **one-copy** transfers via mmap'd receive buffers; each process owns a **binder thread pool** (default max ~16) — incoming calls run on those, not your main thread; `oneway` (async) vs synchronous calls; the **~1MB transaction buffer** shared per process — `TransactionTooLargeException` when a Parcel (e.g. a giant Bundle in `onSaveInstanceState`) blows it; **death recipients** (`linkToDeath`) — how system_server notices an app died; AIDL generates the Parcel marshalling. **v4:** thread pool/1MB buffer/TransactionTooLarge in City Hall tooltips; death-recipient pulse on process death.

**🏙 The four components + Intents**: Activity, **Service** (started vs bound; foreground services with notification), **BroadcastReceiver** (system events; registered vs manifest), **ContentProvider** (data sharing across UIDs; initialized before `Application.onCreate` — startup cost). **Intents**: explicit vs implicit, resolution by PMS against manifest intent-filters. This is THE textbook Android abstraction set and DroidCity models only Activity. **v3:** started Services modeled (ward annex, oom_adj 500 keep-alive, LMK survival); broadcasts minimally (City Hall fan-out, BOOT_COMPLETED); Intents named in ch2 narration. BroadcastReceiver/ContentProvider still doc-only. **v5:** ContentProvider init beat (providers slab lights before Application), bound services with visibility inheritance (oom_adj 100), launchMode singleTop.

**🏙 Cold / warm / hot start**: doc's Phase 2 is a **cold** start (fork everything). **Warm** = process alive, Activity recreated (no fork, no Application.onCreate). **Hot** = everything alive, just brought to front. Launcher tap on a cached ward should NOT rebuild the ward — instant hot start would teach why cached processes exist (ties directly into oom_adj 700/900 and LMK). **v3:** modeled — warm relight, hot pulse, Home button, Chapter 5 ladder.

**🏙 ANR ladder** (we model input-ANR only): input dispatch **5s** · foreground service **20s** (background 200s) · broadcast receiver **10s** foreground / **60s** background · JobScheduler jobs. Different timers, same disease: a blocked main looper. **v4:** timer ladder (incl. background-service 200s) in the ANR overlay tooltip.

**🏙 Tasks & back stack**: tasks (Recents entries), back stack of activities, `launchMode` (standard / singleTop / singleTask / singleInstance), task affinity, predictive back. Explains what "back" actually does — a stack of floors/rooms metaphor fits the tower naturally. **v4:** modeled — push/pop stack cards, Back to finish-root leaves process alive (warm), launchMode still doc-only.

**📖 Install & ART compilation pipeline**: APK (zip: dex, resources, native libs, manifest) → `installd` → **dex2oat**: install-time partial AOT, then **JIT** at runtime with **profile-guided AOT** re-compiles during idle-charge (baseline profiles ship those hot-path profiles with the app for fast first launches). Interpreter → JIT → AOT tiers.

**📖 Compose pipeline** (the doc's render path is View-centric): Compose = declarative UI over the same lower half — **composition → layout → draw** phases per frame, driven by **snapshot state** invalidations (recomposition scopes, skipping via stable types). Below `draw` it joins the exact same RenderThread → SF path. Choreographer/vsync unchanged.

**📖 Fragments**: sub-controllers within an Activity — own lifecycle nested in the Activity's (onViewCreated/onDestroyView), FragmentManager back stack distinct from the task back stack. City metaphor would be rooms within a floor; doc-only for now.

**📖 Notifications**: app posts → **NotificationManagerService** (system_server) → ranking/channels (user-controlled importance since O) → SystemUI renders shade/status bar. PendingIntent = a capability token letting SystemUI fire YOUR intent with YOUR identity later.

**📖 Power management**: wakelocks (PowerManager), **Doze** (deep idle: network off, jobs/alarms deferred to maintenance windows), **App Standby Buckets** (active/working set/frequent/rare/restricted — usage-based throttling), why WorkManager exists (constraint-aware, Doze-respecting deferred work) vs AlarmManager (exact-time, user-visible things).

**📖 Networking below OkHttp**: ConnectivityService picks default network (wifi/cell scoring, VPN), `netd` programs kernel routing/firewall per-UID, DNS via resolver service, radio through RIL/HAL. Network security config + cert validation on the TLS step. Per-UID traffic accounting = how the OS bills data to apps.

**📖 Storage model**: per-app sandbox `/data/data/<pkg>` (the Room shed) · **scoped storage** (MediaStore/SAF for shared files — no more raw sdcard access) · **file-based encryption** (FBE: DE vs CE storage — why direct-boot apps split data) · app-specific external dirs.

**📖 Security model stack**: per-app Linux UID (modeled as ward walls) + **SELinux** domains (even root is confined) + **runtime permissions** (dangerous perms prompted, granted per-UID by PMS) + **app signing** (v2/v3 scheme, Play signing) + hardware **Keystore/StrongBox** (keys never enter app memory) + verified boot (AVB) chaining from Phase 1's bootloader.

**📖 IPC menu beyond Binder**: ContentProvider (structured data), Messenger (Binder-wrapped Handler), shared memory (`ashmem`/`SharedMemory` for big blobs — how providers pass cursors), Unix sockets (Zygote's own command channel is one).

**v4 shipped:** Binder mechanics beats, ANR ladder, tasks & back stack. **v5 (gap sweep) shipped:** ContentProvider init beat, worker→main post-back rule, launchMode singleTop, bound-service tether with visibility inheritance, RAM fill tanks, CPU afterglow, single-foreground display. Remaining doc-only: the 📖 set below plus multi-window, Compose recomposition, predictive back, JobScheduler/Doze.

---

## The official platform diagram, mapped

The developer.android.com platform-architecture diagram (System Apps / Java API Framework / Native C-C++ Libraries + Android Runtime / HAL / Linux Kernel) is the canonical picture most engineers hold in their head. Mapping DroidCity's coverage onto its actual boxes, not just the vertical flow above:

| Diagram box | Status | Where |
|---|---|---|
| **System Apps** (Dialer, Email, Calendar, Camera…) | ✅ | Launcher + app wards (generic apps stand in for the specific system apps) |
| Framework: ActivityManager | ✅ | City Hall AMS |
| Framework: PackageManager | ✅ | Intent resolution + PMS boot APK scan |
| Framework: WindowManager | ⚠️ | Wing label only (City Hall) + doc-only detail |
| Framework: View System | ✅ | Render bench + doc Phase 2/3 |
| Framework: Content Providers | ✅ | Providers slab (v5 init beat) |
| Framework: NotificationManager | 📖 | Concept atlas only |
| Framework: LocationManager | ❌ | Absent |
| Framework: TelephonyManager | ❌ | Absent (radio implied by Network Tower, not the manager itself) |
| Framework: ResourceManager | ⚠️ | One clause in Zygote preload narration |
| Android Runtime: ART | ✅ | GC modeled in depth; CMC/JIT/AOT/baseline profiles doc-only |
| Android Runtime: Core Libraries | ⚠️ | Implied in Zygote preload, not named |
| Native: libc | ❌ | Absent |
| Native: WebKit | ❌ | Absent |
| Native: Media Framework | ❌ | Absent |
| Native: OpenMAX | ❌ | Absent |
| Native: OpenGL ES / Vulkan / Skia | ⚠️ | Render path modeled; APIs now named in Phase 3 step 10 clause above |
| HAL (layer, named at boot) | 📖 | `init` starts HALs (Phase 1, step 4) |
| HAL: audio / Bluetooth / camera / sensors | ❌ | Absent — Hardware row is the physical HW beneath the HAL, not the HAL itself |
| Kernel: Binder driver | ✅ | City Hall roads + Binder mechanics atlas entry |
| Kernel: display driver | ✅ | SurfaceFlinger district + HWC |
| Kernel: shared memory | 📖 | ashmem, IPC atlas entry |
| Kernel: input driver | ✅ | evdev → InputReader/InputDispatcher (Phase 3) |
| Kernel: power management | 📖 | Doze/wakelocks atlas entry |
| Kernel: audio / Bluetooth / camera / USB / wifi drivers | ❌ | Absent (wifi implied by Network Tower) |

Coverage philosophy: DroidCity models the vertical execution slice (tap → framework → runtime → kernel → hardware and memory management) at depth, and deliberately skips the horizontal service stacks (media, audio, telephony, location, peripherals) — each is its own vertical with the same shape: framework manager → native service → HAL → driver.

---

## Priority recommendations — ALL SHIPPED (v3.1)

Items 1-9 below were implemented and deployed; kept as a changelog of what each fixed.

1. ✅ Worker-thread lane in the ward (worker pool road, IO never on main)
2. ✅ Input's system-side trip (touchscreen → City Hall/InputDispatcher → ward packets)
3. ✅ Starting window ghost (splash from launch request to first composite)
4. ✅ Application vs Activity floor (bindApplication base floor)
5. ✅ Boot-order narration + SF lit at init
6. ✅ Vsync/Choreographer named
7. ✅ PSI gauge + live oom_adj ward labels + SIGKILL narration
8. ✅ onTrimMemory cooperative shed (memory:trim)
9. ✅ Kill → restore arc (ch4 finale + fast-rise restore badge; expanded by ch5)

**Open backlog (v5):** bound services · ContentProviders · JIT/AOT/baseline profiles · multi-window · predictive back · launchMode variants · Compose recomposition beat.
