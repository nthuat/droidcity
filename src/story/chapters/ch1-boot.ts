import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

export function makeCh1(ctx: StoryCtx): Chapter {
  return {
    id: 'ch1',
    title: 'Power On',
    // Empty city: chapter narrates a cold boot — auto-mode wards (or a launch
    // still mid-fork when Play was pressed) would rise while the script is
    // still introducing Zygote.
    setup: () => { ctx.launcher.resetApps(); ctx.resetCity() },
    steps: [
      {
        narration: 'This is Android as a city. Every running app will be a walled ward with its own streets. Right now the power is off.',
        focus: 'overview',
        fire: () => { ctx.setCityDim(true); ctx.bootRow.replayBoot() },
        waitFor: { ms: 700 },
      },
      {
        narration: 'The bootloader wakes first — a tiny program with one job: load the kernel.',
        focus: 'boot',
        waitFor: { event: 'boot:stageDone' },
      },
      {
        narration: 'The kernel takes over: processes, memory, drivers — the laws of physics for everything above.',
        focus: 'boot',
        waitFor: { event: 'boot:stageDone' },
      },
      {
        narration: 'init starts userspace — PID 1. Its first big job: warming the Zygote foundry.',
        focus: 'boot',
        waitFor: { event: 'boot:stageDone' },
      },
      {
        narration: 'system_server ignites — itself the foundry\'s first casting. ActivityManager, WindowManager, PackageManager: city hall opens.',
        focus: 'boot',
        waitFor: { event: 'boot:complete' },
      },
      {
        narration: 'The foundry stays warm — every app you\'ll ever launch is copied from this one pre-loaded process.',
        focus: 'zygote',
        waitFor: { ms: 2500 },
      },
      {
        narration: 'The launcher — your home screen — is just an app itself. The city is awake.',
        focus: 'launcher',
        waitFor: { ms: 2500 },
      },
    ],
  }
}
