import type { Bus } from '../../core/bus'
import type { WardManager } from '../../wards/manager'

export interface StoryCtx {
  bus: Bus
  bootRow: { replayBoot(): void }
  launcher: { clickKiosk(app: string): void; resetApps(): void }
  wards: WardManager
  setCityDim(dim: boolean): void
  killApp(app: string): void
  injectTap(app: string): void
}
