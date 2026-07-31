import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

export function makeCh4(ctx: StoryCtx): Chapter {
  return {
    id: 'ch4',
    title: 'The 16ms Race',
    setup: () => {
      ctx.setCityDim(false)
      // wardStats(), not wards(): dying wards must not read as "running" (ch5 pattern).
      if (!ctx.wards.wardStats().some(w => w.app === 'chat')) ctx.launcher.clickKiosk('chat')
    },
    steps: [
      {
        narration: 'Every visible change is a race: 16.67 milliseconds of work per frame, sixty times a second. The tap itself arrived from the touchscreen through system_server\'s InputDispatcher — apps never read hardware directly. Every frame starts on a vsync tick — Choreographer lines the work up against a 16.67ms train timetable.',
        focus: 'ward:chat',
        fire: () => ctx.injectTap('chat'),
        waitFor: { event: 'frame:submitted', app: 'chat' },
      },
      {
        narration: 'The ward builds its part of the frame; SurfaceFlinger composites every ward onto the one screen.',
        focus: 'surfaceflinger',
        waitFor: { event: 'frame:composited', app: 'chat' },
      },
      {
        narration: 'Now a heavy frame — overdraw, deep layouts, a bitmap decode on the UI thread. It misses the train. That\'s jank.',
        focus: 'surfaceflinger',
        fire: () => ctx.wards.runHeavyFrame('chat'),
        waitFor: { event: 'frame:composited', app: 'chat' },
      },
      {
        narration: 'Same pipeline, different toolkit: switch this ward to Compose and the bench relabels to composition → layout → draw. Composition re-runs only the @Composables whose state changed; below draw it is the identical RenderThread → SurfaceFlinger path. The lower half does not care which toolkit drew the frame.',
        focus: 'ward:chat',
        fire: () => ctx.wards.toggleCompose('chat'),
        waitFor: { ms: 5000 },
      },
      {
        narration: 'Some of that work may not be Java at all. A JNI call crosses into the app\'s .so — same process, outside ART: no GC, no exceptions. Every crossing marshals arguments, and whatever it mallocs lands on the native heap, which Force GC can never reclaim. Only process death frees it.',
        focus: 'ward:chat',
        fire: () => ctx.wards.callNative('chat'),
        waitFor: { event: 'jni:called', app: 'chat' },
      },
      {
        narration: 'Now block the ward\'s main road with one heavy delivery. Messages pile up. After five seconds the system loses patience: ANR.',
        focus: 'ward:chat',
        fire: () => ctx.wards.blockMainThread('chat', 8000),
        waitFor: { event: 'anr', app: 'chat' },
        // ANR_MS is 5000 SIM ms and story mode runs the sim at 0.35x: ~14s of
        // wall time on a 60fps machine, and 2-3x that on a software renderer.
        timeoutMs: 60000,
      },
      {
        narration: 'That\'s the whole machine: boot, fork, ward, data, frames — and when memory runs out, a ward is demolished and the foundry stands ready to stamp a new one. The city breathes.',
        focus: 'overview',
        fire: () => ctx.killApp('chat'),
        waitFor: { ms: 4000 },
      },
      {
        narration: 'And when you come back — fork again, saved state restores, as if nothing died. The city breathes.',
        focus: 'ward:chat',
        fire: () => ctx.launcher.clickKiosk('chat'),
        waitFor: { event: 'activity:resumed', app: 'chat' },
      },
    ],
  }
}
