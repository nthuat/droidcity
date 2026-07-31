import { describe, expect, it } from 'vitest'
import { createReclaim, reclaimPass, resetReclaim } from '../../src/sim/reclaim'

describe('reclaim', () => {
  it('a pass frees memory and grows zram', () => {
    const r = reclaimPass(createReclaim(), 0.5)
    expect(r.freedKb).toBeGreaterThan(0)
    expect(r.state.zramKb).toBeGreaterThan(0)
    expect(r.state.reclaimedKb).toBe(r.freedKb)
  })
  it('finds less on every pass, diminishing returns', () => {
    const first = reclaimPass(createReclaim(), 0.5)
    const second = reclaimPass(first.state, 0.5)
    expect(second.freedKb).toBeLessThan(first.freedKb)
  })
  it('only reports exhausted once kswapd has had its passes', () => {
    let s = createReclaim()
    const flags: boolean[] = []
    for (let i = 0; i < 3; i++) {
      const r = reclaimPass(s, 0.9)
      s = r.state
      flags.push(r.exhausted)
    }
    expect(flags).toEqual([false, false, true])
  })
  it('reset clears the pass budget but keeps compressed pages', () => {
    const r = reclaimPass(createReclaim(), 0.5)
    const after = resetReclaim(r.state)
    expect(after.attempts).toBe(0)
    expect(after.zramKb).toBe(r.state.zramKb)
  })
})
