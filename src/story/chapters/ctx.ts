import type { Bus } from '../../core/bus'
import type { WardManager } from '../../wards/manager'

export interface StoryCtx {
  bus: Bus
  bootRow: { replayBoot(): void }
  launcher: { clickKiosk(app: string): void; resetApps(): void }
  wards: WardManager
  setCityDim(dim: boolean): void
  killApp(app: string): void
  // SIGKILL every ward, ch1 opens with "the power is off"; leftover wards (and
  // any launch already mid-fork from auto mode) contradict the boot narration.
  resetCity(): void
  injectTap(app: string): void
  // The background half (ch7): JobScheduler, Doze, and the reclaim ladder all
  // live outside the wards, so the chapter drives them through these.
  jobs: {
    enqueue(constraint: 'network' | 'charging' | 'idle'): void
    setDoze(on: boolean): void
    openWindow(): void
  }
  // Forces memory pressure high enough to make the PSI edge fire, so the
  // chapter can show reclaim-then-kill without waiting for ambient load.
  squeezeMemory(): void
}
