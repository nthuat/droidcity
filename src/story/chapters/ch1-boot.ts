import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

export function makeCh1(ctx: StoryCtx): Chapter {
  return {
    id: 'ch1',
    title: 'Power On',
    steps: [
      {
        narration: 'This is Android as a city. Every running app will be a walled ward with its own streets. Right now the power is off.',
        focus: 'overview',
        fire: () => { ctx.setCityDim(true); ctx.bootRow.replayBoot() },
        waitFor: { ms: 1500 },
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
        narration: 'init starts userspace — the first civilian process, PID 1.',
        focus: 'boot',
        waitFor: { event: 'boot:stageDone' },
      },
      {
        narration: 'system_server ignites: ActivityManager, WindowManager, PackageManager. City hall is open.',
        focus: 'boot',
        waitFor: { event: 'boot:complete' },
      },
      {
        narration: 'The Zygote foundry is already warm — a process with the whole framework pre-loaded, waiting to be copied.',
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
