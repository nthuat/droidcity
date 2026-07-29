# DroidCity

**How Android runs, as an explorable 3D city.** Live at **[thuat.dev/droidcity](https://thuat.dev/droidcity/)** · inspired by [PGSimCity](https://nikolays.github.io/PGSimCity/).

[![DroidCity — the machine board from overview](docs/overview.jpg)](https://thuat.dev/droidcity/)

One machine board, laid out as the Android stack itself — read it north to south: hardware → kernel/boot → core processes (Zygote · system_server · SurfaceFlinger) → app wards → the glass. Every running app rises as its own walled ward, and the display at the front edge is a working phone screen: the launcher's icon grid at home, the foreground app's content when one is up. Everything is live — hover any structure for what it teaches, tap an icon on the glass and follow the launch across the board.

**The bands, north to south:** Hardware strip (CPU cores, RAM bank with copy-on-write Zygote pages, disk, radio/NIC mast feeding the network tower, live PSI pressure, memory/storage buses) · Boot Row (bootloader → kernel → init → system_server) · the core-process band — Zygote Foundry (forks every process), City Hall (system_server, cast next door and residing next door: ActivityManager approves launches and writes oom_adj, WindowManager owns the starting window, PackageManager resolves Intents — every Binder road from the wards is a short straight hop down to this band), and SurfaceFlinger (compositor — every frame's last stop before glass) · the app-ward band — apps literally sit on top of the framework · Network Tower at the radio edge (DNS → connect → TLS → TTFB → download, retries with backoff, pooled connections skip the handshakes) · and the Glass at the front: a working phone screen (launcher icon grid → tap → app content) with the launcher process shed beside it.

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
