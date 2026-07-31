import { describe, expect, it } from 'vitest'
import { createReclaim } from '../../src/sim/reclaim'
import { stepPressureLadder } from '../../src/sim/pressureLadder'

describe('pressure ladder', () => {
  it('reclaims before it kills, and only kills once reclaim is exhausted', () => {
    let s = createReclaim()
    const kills: boolean[] = []
    const freed: number[] = []
    for (let i = 0; i < 3; i++) {
      const step = stepPressureLadder(s, 0.9)
      s = step.state
      kills.push(step.kill)
      freed.push(step.freedKb)
    }
    // The claim, asserted: two reclaim passes happen first, the kill is third.
    expect(kills).toEqual([false, false, true])
    expect(freed[0]).toBeGreaterThan(0)
    expect(freed[1]).toBeLessThan(freed[0]) // diminishing returns
    expect(s.zramKb).toBeGreaterThan(0) // pages really went into zram
  })

  it('gives kswapd a fresh budget after a kill', () => {
    let s = createReclaim()
    for (let i = 0; i < 3; i++) s = stepPressureLadder(s, 0.9).state
    expect(s.attempts).toBe(0)
    const next = stepPressureLadder(s, 0.9)
    expect(next.kill).toBe(false) // the cycle starts over with reclaim, not a kill
  })
})
