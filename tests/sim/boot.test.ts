import { describe, it, expect } from 'vitest'
import { createBoot, advanceBoot, BOOT_STAGES } from '../../src/sim/boot'

describe('boot', () => {
  it('has 4 stages totaling 4400ms', () => {
    expect(BOOT_STAGES.map(s => s.name)).toEqual(['bootloader', 'kernel', 'init', 'system_server'])
    expect(BOOT_STAGES.reduce((a, s) => a + s.durationMs, 0)).toBe(4400)
  })
  it('completes stages in order as time passes', () => {
    let s = advanceBoot(createBoot(), 800)
    expect(s.completed).toEqual(['bootloader'])
    s = advanceBoot(s, 1200)
    expect(s.completed).toEqual(['bootloader', 'kernel'])
    expect(s.done).toBe(false)
  })
  it('one large advance completes everything', () => {
    const s = advanceBoot(createBoot(), 10000)
    expect(s.completed).toHaveLength(4)
    expect(s.done).toBe(true)
  })
  it('mid-stage advance completes nothing new', () => {
    expect(advanceBoot(createBoot(), 500).completed).toEqual([])
  })
  it('does not mutate input', () => {
    const s0 = createBoot()
    advanceBoot(s0, 5000)
    expect(s0.elapsedMs).toBe(0)
  })
})
