# DroidCity

**How Android runs, as an explorable 3D city.** Live at **[thuat.dev/droidcity](https://thuat.dev/droidcity/)** · inspired by [PGSimCity](https://nikolays.github.io/PGSimCity/).

[![DroidCity — four app wards running, the phone screen at the front edge](docs/overview.jpg)](https://thuat.dev/droidcity/)

*Four apps running: each is a walled ward on the app band, every Binder road hops one band down to City Hall, and the phone at the front shows the foreground app — with the live `oom_adj` kill order bottom-right.*

One machine board, laid out as the Android stack itself — read it north to south: hardware → kernel/boot → core processes → app wards → the glass. Every running app rises as its own walled ward, and the display at the front edge is a working phone screen. Everything is live: hover any structure for what it teaches, tap an icon on the glass and follow the launch across the board.

## The bands, north to south

| Band | What lives there |
|---|---|
| **Hardware strip** | CPU cores · RAM bank (with copy-on-write Zygote pages) · disk · radio/NIC mast feeding the network tower · live PSI pressure · memory and storage buses |
| **Boot Row** | bootloader → kernel → init → system_server |
| **Core processes** | **Zygote Foundry** forks every process · **City Hall** (system_server) — cast next door and residing next door: ActivityManager approves launches and writes `oom_adj`, WindowManager owns the starting window, PackageManager resolves Intents · **SurfaceFlinger** — every frame's last stop before glass |
| **App wards** | One ward per running app, sitting directly on top of the framework band — so every Binder road is a short hop down to City Hall |
| **Network Tower** (radio edge) | DNS → connect → TLS → TTFB → download, retries with backoff, pooled connections skip the handshakes |
| **The Glass** (front) | The phone screen. The launcher has no building of its own — its body *is* the icon grid on that screen |

## Inside a ward

Every running app is its own walled ward — a sandboxed process containing:

- **Main road** — the Looper, with the ANR watchdog riding it
- **Worker-pool lane** — coroutine/executor IO that posts results back to the main road
- **Thread rack** — main, RenderThread, Binder pool: private stacks, shared heap
- **Service annex** — long-running background work
- **Activity tower** — rises from a ContentProvider slab and Application floor through the lifecycle floors, with a back stack of rooms and a ViewModel on the roof
- **Render bench** — races each frame to SurfaceFlinger
- **Heap yard** — allocations, with GC sweeps traveling through
- **Room DB shed** — cache hits; its file lives on the DISK, reached over the storage bus

Wards rise on launch and are demolished on kill or eviction. `oom_adj` scores and PSI pressure set the LMK kill order; the Zygote foundry stamps out the next one.

## The phone screen is a real UI, not a diagram

- **Home** shows the launcher's icon grid — brand colors, plus a green dot on every app whose process is alive.
- **Tap an icon** and the launch travels for real: touch → InputDispatcher (system_server) → the launcher files an Intent → City Hall approves → Zygote forks → a ward rises → its first frame lands back on the glass.
- **◁ Back** pops the Activity's back stack, then finishes it at the root — the process stays cached.
- **○ Home** backgrounds the foreground app.
- **▢ Recents** shows one task card per live process; tap one to hot-start it.
- **Notifications** — a background fetch posts one: a dot on the status bar, a row in the shade, and tapping it fires the PendingIntent. It outlives the process, so a killed app cold-starts from its own notification.
- **Runtime permissions** — the camera's first launch raises a system dialog the app can neither draw nor auto-accept; Allow/Deny is recorded by PackageManager.

## Story mode

A guided tour through six chapters:

1. **Power On** — the boot sequence
2. **A Ward Is Born** — tap → Intent → fork → first frame
3. **Getting Data** — cache-then-network, stale-while-revalidate
4. **The 16ms Race** — frame pipeline, jank, ANR
5. **Coming Back** — cold/warm/hot starts, services, LMK survival
6. **The Metal** — cores, RAM, disk, PSI pressure → lmkd

Play chapters individually from the Story menu, or **Play all** to chain all six with narration. The whole city runs in slow motion so the action matches the words.

## City controls

- **City: auto/manual** — manual stops all self-driven launches and reclaims, so you drive every event (ideal for watching one app end-to-end)
- **Reset city** — SIGKILLs every ward for an empty grid

The companion reference — the full boot-to-pixel flow, a memory-management deep dive, and an audit of what the city models vs. simplifies — lives in [`docs/android-flow-reference.md`](docs/android-flow-reference.md).

Early prototype — the model simplifies aggressively and surely contains inaccuracies. Issues/PRs welcome.

## Dev

    npm install
    npm run dev     # local
    npm test        # sim + story-player unit tests
    npm run build   # typecheck + static build in dist/
