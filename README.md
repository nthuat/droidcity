# DroidCity

How an Android app runs, as an explorable 3D city. Inspired by [PGSimCity](https://nikolays.github.io/PGSimCity/).

**Districts:** Main Thread (Looper traffic + ANR) · Activity Lifecycle (rotation rebuild, ViewModel roof) · Touch→Pixel (frame pipeline, 16.67ms deadline) · Zygote & LMK (process fork + eviction) · Garbage Collector (heap sweep).

Early prototype — the model simplifies aggressively and surely contains inaccuracies. Issues/PRs welcome.

## Dev

    npm install
    npm run dev    # local
    npm test       # sim unit tests
    npm run build  # static build in dist/
