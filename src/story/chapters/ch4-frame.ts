import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

export function makeCh4(ctx: StoryCtx): Chapter {
  return {
    id: 'ch4',
    title: 'The 16ms Race',
    setup: () => {
      ctx.setCityDim(false)
      if (!ctx.wards.wards().some(w => w.app === 'chat')) ctx.launcher.clickKiosk('chat')
    },
    steps: [
      {
        narration: 'Every visible change is a race: 16.67 milliseconds from input to pixel, sixty times a second.',
        focus: 'ward:chat',
        fire: () => ctx.bus.emit('ui:messagePosted', { app: 'chat', label: 'tap' }),
        waitFor: { event: 'frame:submitted' },
      },
      {
        narration: 'The ward builds its part of the frame; SurfaceFlinger composites every ward onto the one screen.',
        focus: 'surfaceflinger',
        waitFor: { event: 'frame:composited' },
      },
      {
        narration: 'Now block the ward\'s main road with one heavy delivery. Messages pile up. After five seconds the system loses patience: ANR.',
        focus: 'ward:chat',
        fire: () => ctx.wards.blockMainThread('chat', 8000),
        waitFor: { event: 'anr' },
      },
      {
        narration: 'That\'s the whole machine: boot, fork, ward, data, frames — and when memory runs out, a ward is demolished and the foundry stamps a new one. The city breathes.',
        focus: 'overview',
        waitFor: { ms: 4000 },
      },
    ],
  }
}
