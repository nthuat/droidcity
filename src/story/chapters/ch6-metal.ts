import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

export function makeCh6(ctx: StoryCtx): Chapter {
  return {
    id: 'ch6',
    title: 'The Metal',
    setup: () => {
      ctx.setCityDim(false)
      // A second process guarantees a future LMK victim: once chat takes the
      // foreground in step 2, this ward gets auto-backgrounded to cached (see
      // WardManager.bringToForeground) and stays the oldest cached process
      // through step 6's memory:pressure.
      if (!ctx.wards.wardStats().some(w => w.app === 'maps')) ctx.launcher.clickKiosk('maps')
      // Ensures chat exists (any phase) before step 2 fires again — a cold
      // launch here plus step 2's own clickKiosk both resolve to the same
      // activity:resumed event regardless of which one actually finishes the
      // launch (see ch6-report.md's step-2 trace).
      if (!ctx.wards.wardStats().some(w => w.app === 'chat')) ctx.launcher.clickKiosk('chat')
    },
    steps: [
      {
        narration: 'Below the kernel strip lies the metal: cores, physical RAM, flash. Everything above — wards, City Hall, the foundry — is bookkeeping for these three.',
        focus: 'hardware',
        waitFor: { ms: 5000 },
      },
      {
        narration: 'Chat comes to the front. One core takes its main thread — and the CPU↔RAM bus lights: every instruction it runs streams from physical memory.',
        focus: 'hardware',
        fire: () => ctx.launcher.clickKiosk('chat'),
        waitFor: { event: 'activity:resumed', app: 'chat' },
      },
      {
        narration: 'Room reads. The storage bus pulses cyan — pages come off flash by DMA. The CPU never carries the bytes.',
        focus: 'hardware',
        fire: () => ctx.wards.refreshData('chat'),
        waitFor: { event: 'data:cacheHit', app: 'chat' },
      },
      {
        narration: "The network answer writes back — orange on the storage bus — and fresh objects land in chat's heap. Watch its RAM tank rise.",
        focus: 'hardware',
        waitFor: { event: 'data:fetched', app: 'chat' },
      },
      {
        narration: 'GC sweeps the garbage; the tank drains. Per-process housekeeping — no other ward feels it.',
        focus: 'hardware',
        fire: () => ctx.wards.forceGc('chat'),
        waitFor: { event: 'gc:swept', app: 'chat' },
      },
      {
        narration: 'Now pressure. PSI spikes — every ward sheds what it can, and lmkd takes the oldest cached process. SIGKILL. The RAM slabs go dark.',
        focus: 'hardware',
        fire: () => ctx.bus.emit('memory:pressure', {}),
        waitFor: { event: 'process:killed' },
      },
      {
        narration: 'CPU, RAM, DISK — three pieces of metal. The whole city above exists to share them safely.',
        focus: 'overview',
        waitFor: { ms: 5000 },
      },
    ],
  }
}
