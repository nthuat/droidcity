import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

export function makeCh2(ctx: StoryCtx): Chapter {
  return {
    id: 'ch2',
    title: 'A Process Is Born',
    setup: () => { ctx.setCityDim(false); ctx.launcher.resetApps(); ctx.killApp('chat') },
    steps: [
      {
        narration: "First the system clears a plot: if chat was already running, its ward is torn down. Processes are disposable; that's the design.",
        focus: 'displaywall',
        waitFor: { ms: 2000 },
      },
      {
        narration: "You tap chat on the glass. That touch is not the app's to read: it goes touch controller → kernel input driver → InputDispatcher in system_server, which hands it to the focused window, the launcher. And the launcher doesn't start apps either. It files an Intent: a typed envelope the system knows how to route.",
        focus: 'displaywall',
        fire: () => ctx.launcher.clickKiosk('chat'),
        waitFor: { event: 'app:launchRequested' },
      },
      {
        narration: 'Before anything starts, PackageManager has to answer "start WHAT?" It matches your Intent against the manifests it scanned at boot, the installed packages sitting in /data/app. The winning package is the one that gets a process.',
        focus: 'packages',
        waitFor: { ms: 4500 },
      },
      {
        narration: "The foundry forks: Zygote is copied in milliseconds, framework and all. That's why launches are fast, on AMS's order; the launcher never talks to Zygote directly.",
        focus: 'zygote',
        waitFor: { event: 'process:forked', app: 'chat' },
      },
      {
        narration: 'The new process needs code. Its dex was already compiled to native by dex2oat at install time, and those pages plus the app\'s .so libraries are mmap\'d straight off the DISK, nothing is copied into the process, it just maps the file. Anything dex2oat left out gets JIT-compiled later, and re-optimized while the device is idle and charging.',
        focus: 'packages',
        waitFor: { ms: 5000 },
      },
      {
        narration: 'A new ward rises: its own process, own memory, own main road. The walls are the sandbox: no other app can reach inside. A splash, the starting window, covered the wait; that\'s why launches feel instant. That hop was a Binder call, one copy, straight into system_server\'s thread pool. Providers wake even before Application, the classic startup tax.',
        focus: 'ward:chat',
        waitFor: { event: 'activity:resumed', app: 'chat' },
      },
      {
        narration: 'The Activity is not the window. addView creates a ViewRootImpl, which registers the window with WindowManager, and WMS asks SurfaceFlinger for the Surface the app will draw into. Watch the token light on the ward: that handshake is what turns "a running process" into "something on screen".',
        focus: 'cityhall',
        waitFor: { ms: 4500 },
      },
      {
        narration: 'Inside the ward, the Activity tower lights floor by floor, onCreate, onStart, onResume, and the render bench builds the first frame.',
        focus: 'ward:chat',
        waitFor: { event: 'frame:submitted', app: 'chat' },
      },
      {
        narration: 'The frame ships to SurfaceFlinger: the one compositor for every ward, and lands on the display.',
        focus: 'surfaceflinger',
        waitFor: { event: 'frame:composited', app: 'chat' },
      },
      {
        narration: 'The app is on screen: and its ward is already reaching for data. Next chapter follows that trail.',
        focus: 'ward:chat',
        waitFor: { ms: 2500 },
      },
    ],
  }
}
