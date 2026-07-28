import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

export function makeCh5(ctx: StoryCtx): Chapter {
  return {
    id: 'ch5',
    title: 'Coming Back',
    setup: () => {
      ctx.setCityDim(false)
      if (!ctx.wards.wards().some(w => w.app === 'chat')) ctx.launcher.clickKiosk('chat')
    },
    steps: [
      {
        narration: "Chat is running — this ward cost a full cold start: fork, Application, Activity, first frame. Let's see the cheaper ways back.",
        focus: 'ward:chat',
        waitFor: { ms: 4000 },
      },
      {
        narration: 'Home. The Activity stops — floors dim — and the process drops to cached, oom_adj 900. Nothing is destroyed.',
        focus: 'ward:chat',
        fire: () => ctx.wards.goHome('chat'),
        waitFor: { ms: 4000 },
      },
      {
        narration: 'Tap again: a WARM start. No fork, no Application — the floors just relight. Milliseconds, not seconds.',
        focus: 'ward:chat',
        fire: () => ctx.launcher.clickKiosk('chat'),
        waitFor: { event: 'app:broughtToFront', app: 'chat' },
      },
      {
        narration: "Again, while it's already resumed: a HOT start — nothing to rebuild at all, just bring the window forward.",
        focus: 'ward:chat',
        fire: () => ctx.launcher.clickKiosk('chat'),
        waitFor: { event: 'app:broughtToFront', app: 'chat' },
      },
      {
        narration: 'Now a Service: the annex lights. Backgrounded WITH a service, the process holds oom_adj 500 — the crane takes cached wards first.',
        focus: 'ward:chat',
        fire: () => { ctx.wards.toggleService('chat'); ctx.wards.goHome('chat') },
        waitFor: { ms: 5000 },
      },
      {
        narration: "But nothing is immortal. SIGKILL — and the next tap will be a cold start again… except saved state makes even that cheap.",
        focus: 'ward:chat',
        fire: () => ctx.killApp('chat'),
        waitFor: { ms: 4000 },
      },
      {
        narration: 'Fork, restore, resume. Cold, warm, hot — now you know the whole ladder.',
        focus: 'ward:chat',
        fire: () => ctx.launcher.clickKiosk('chat'),
        waitFor: { event: 'activity:resumed', app: 'chat' },
      },
    ],
  }
}
