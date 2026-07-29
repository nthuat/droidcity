# DroidCity

**How Android runs, as an explorable 3D city.** Live at **[thuat.dev/droidcity](https://thuat.dev/droidcity/)** · inspired by [PGSimCity](https://nikolays.github.io/PGSimCity/).

[![DroidCity — the machine board from overview](docs/overview.jpg)](https://thuat.dev/droidcity/)

One machine board: system districts around the edge, and a plot grid in the middle where every running app rises as its own walled ward. Everything is live — hover any structure for what it teaches, click a kiosk and follow the launch across the board.

**Districts:** Boot Row (bootloader → kernel → init → system_server) · Hardware strip (CPU cores, RAM bank with copy-on-write Zygote pages, disk, radio/NIC mast feeding the network tower, live PSI pressure, memory/storage buses) · Zygote Foundry (forks every process — including system_server, its first casting) · City Hall (system_server: ActivityManager approves launches and writes oom_adj, WindowManager owns the starting window, PackageManager resolves Intents — all Binder roads end here) · Launcher Plaza (tap-to-launch kiosks) · Network Tower (DNS → connect → TLS → TTFB → download, retries with backoff, pooled connections skip the handshakes) · SurfaceFlinger (compositor + display wall: one bright tile — the foreground app; faint tiles are alive and drawing nothing).

**Wards:** every running app is its own walled ward — a sandboxed process with a main road (Looper + ANR watchdog), a worker-pool lane (coroutine/executor IO that posts results back), a thread rack (main, RenderThread, Binder pool — private stacks, shared heap), a service annex (long-running background work), an Activity tower rising from a ContentProvider slab and Application floor through lifecycle floors, with a back stack of rooms and a ViewModel on the roof, a render bench racing each frame to SurfaceFlinger, a heap yard (allocations, traveling GC sweeps), and a Room DB shed (cache hits — its file lives on the DISK). Wards rise on launch and are demolished on kill or eviction; oom_adj scores and PSI pressure set the LMK kill order; the Zygote foundry stamps out the next one.

**Story mode:** a guided tour through six chapters — Power On (boot sequence) · A Ward Is Born (tap → Intent → fork → first frame) · Getting Data (cache-then-network, stale-while-revalidate) · The 16ms Race (frame pipeline, jank, ANR) · Coming Back (cold/warm/hot starts, services, LMK survival) · The Metal (cores, RAM, disk, PSI pressure → lmkd). Play chapters individually from the Story menu or **Play all** to chain all six with narration; the whole city runs in slow motion so the action matches the words.

**City controls:** **City: auto/manual** stops all self-driven launches and reclaims (manual = you drive every event, ideal for watching one app end-to-end); **Reset city** SIGKILLs every ward for an empty grid.

The companion reference — the full boot-to-pixel flow, memory management deep-dive, and an audit of what the city models vs. simplifies — lives in [`docs/android-flow-reference.md`](docs/android-flow-reference.md).

Early prototype — the model simplifies aggressively and surely contains inaccuracies. Issues/PRs welcome.

## Dev

    npm install
    npm run dev     # local
    npm test        # sim + story-player unit tests
    npm run build   # typecheck + static build in dist/
