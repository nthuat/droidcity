// The order the post claims: under memory pressure the kernel reclaims FIRST
// (kswapd compressing cold pages into zram) and lmkd only kills once reclaim
// can no longer keep up. Extracted from main.ts so that order is testable
// rather than asserted.
import { reclaimPass, resetReclaim, type ReclaimState } from './reclaim'

export interface LadderStep {
  readonly state: ReclaimState
  readonly freedKb: number
  // True only when reclaim is exhausted: the caller emits memory:pressure and
  // lmkd picks a victim off the oom_adj ladder.
  readonly kill: boolean
}

export function stepPressureLadder(s: ReclaimState, pressureFrac: number): LadderStep {
  const pass = reclaimPass(s, pressureFrac)
  if (!pass.exhausted) {
    return { state: pass.state, freedKb: pass.freedKb, kill: false }
  }
  // After a kill, pressure drops and kswapd gets a fresh budget.
  return { state: resetReclaim(pass.state), freedKb: pass.freedKb, kill: true }
}
