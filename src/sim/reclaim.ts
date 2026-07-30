// What the kernel does BEFORE anything is killed: kswapd walks the LRU list and
// compresses cold anonymous pages into zram. Slower memory beats a dead
// process — lmkd only steps in when reclaim can no longer keep up. Pure.

export interface ReclaimState {
  readonly zramKb: number
  readonly reclaimedKb: number
  // kswapd passes since the last kill. Each pass finds less to compress, which
  // is exactly why pressure eventually wins.
  readonly attempts: number
}

const MAX_PASSES = 3
const BASE_FREE_KB = 240

export function createReclaim(): ReclaimState {
  return { zramKb: 0, reclaimedKb: 0, attempts: 0 }
}

export interface ReclaimResult {
  readonly state: ReclaimState
  readonly freedKb: number
  // Reclaim can't keep up: the caller must fall through to lmkd.
  readonly exhausted: boolean
}

export function reclaimPass(s: ReclaimState, pressureFrac: number): ReclaimResult {
  const attempts = s.attempts + 1
  // Diminishing returns: pass 1 frees the most, and higher pressure means less
  // cold memory left to find.
  const decay = 1 / attempts
  const freedKb = Math.max(0, Math.round(BASE_FREE_KB * decay * (1 - Math.min(1, pressureFrac) * 0.5)))
  const state: ReclaimState = {
    // Compressed pages live on in zram — roughly half their original size.
    zramKb: s.zramKb + Math.round(freedKb * 0.5),
    reclaimedKb: s.reclaimedKb + freedKb,
    attempts,
  }
  return { state, freedKb, exhausted: attempts >= MAX_PASSES }
}

// After a kill, pressure drops and kswapd gets a fresh budget. zram totals stay
// — those pages are still compressed in RAM.
export function resetReclaim(s: ReclaimState): ReclaimState {
  return { ...s, attempts: 0 }
}
