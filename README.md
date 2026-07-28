# DroidCity

How an Android app runs, as an explorable 3D city. Inspired by [PGSimCity](https://nikolays.github.io/PGSimCity/).

**Districts:** Boot Row (bootloader → kernel → init → system_server) · Hardware strip (CPU cores, RAM segments, disk LED, live PSI pressure) · Zygote (foundry that forks new processes) · City Hall (ActivityManager/WindowManager/PackageManager) · Launcher Plaza (tap-to-launch kiosks) · Network Tower (DNS→connect→TLS→TTFB→download, retries with backoff) · SurfaceFlinger (compositor, one frame at a time).

**Wards:** every running app is its own walled ward — a process with a main road (Looper + ANR watchdog), a worker pool lane (coroutine/executor IO), a service annex (long-running background work), an Activity tower (lifecycle floors, rotation rebuild, back stack of rooms, ViewModel roof), a heap yard (allocations, GC sweeps), and a Room DB shed (cache hits, pooled connection reuse). Wards rise when launched and are demolished on kill or eviction; oom_adj scores and PSI pressure drive the LMK kill order; the Zygote foundry stamps out the next one.

**Story mode:** a guided tour through six chapters — Power On (boot sequence), A Ward Is Born (launch → fork → first frame), Getting Data (cache-then-network, stale-while-revalidate), The 16ms Race (frame pipeline + ANR), Coming Back (cold/warm/hot starts, services, LMK survival), The Metal (CPU cores, RAM, disk, PSI pressure → LMK). Play them individually from the Story menu or hit **Play all** to chain all six with narration.

**City controls:** the switcher's **City: auto/manual** toggle stops all self-driven launches and reclaims (manual = you drive every event); **Reset city** SIGKILLs every ward for an empty grid.

Early prototype — the model simplifies aggressively and surely contains inaccuracies. Issues/PRs welcome.

## Dev

    npm install
    npm run dev     # local
    npm test        # sim + story-player unit tests
    npm run build   # typecheck + static build in dist/
