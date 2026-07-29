import type { Bus } from '../../core/bus'
import type { WardManager } from '../../wards/manager'

export interface StoryCtx {
  bus: Bus
  bootRow: { replayBoot(): void }
  launcher: { clickKiosk(app: string): void; resetApps(): void }
  wards: WardManager
  setCityDim(dim: boolean): void
  killApp(app: string): void
  // SIGKILL every ward — ch1 opens with "the power is off"; leftover wards (and
  // any launch already mid-fork from auto mode) contradict the boot narration.
  resetCity(): void
  injectTap(app: string): void
}
