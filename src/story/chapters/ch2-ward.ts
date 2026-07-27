import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

export function makeCh2(ctx: StoryCtx): Chapter {
  return {
    id: 'ch2',
    title: 'A Ward Is Born',
    setup: () => { ctx.setCityDim(false); ctx.launcher.resetApps(); ctx.killApp('chat') },
    steps: [
      {
        narration: "First the system clears a plot — if chat was already running, its ward is torn down. Processes are disposable; that's the design.",
        focus: 'launcher',
        waitFor: { ms: 2000 },
      },
      {
        narration: "You tap chat. The launcher doesn't start apps — it files a request with the system.",
        focus: 'launcher',
        fire: () => ctx.launcher.clickKiosk('chat'),
        waitFor: { event: 'app:launchRequested' },
      },
      {
        narration: "The foundry forks: Zygote is copied in milliseconds, framework and all. That's why launches are fast.",
        focus: 'zygote',
        waitFor: { event: 'process:forked' },
      },
      {
        narration: 'A new ward rises — its own process, own memory, own main road. The walls are the sandbox: no other app can reach inside.',
        focus: 'ward:chat',
        waitFor: { event: 'activity:resumed' },
      },
      {
        narration: 'Inside the ward, the Activity tower lights floor by floor — onCreate, onStart, onResume — and the render bench builds the first frame.',
        focus: 'ward:chat',
        waitFor: { event: 'frame:submitted' },
      },
      {
        narration: 'The frame ships to SurfaceFlinger — the one compositor for every ward — and lands on the display.',
        focus: 'surfaceflinger',
        waitFor: { event: 'frame:composited' },
      },
      {
        narration: "The app is on screen. But its ward has no data yet — that's the next chapter.",
        focus: 'ward:chat',
        waitFor: { ms: 2500 },
      },
    ],
  }
}
