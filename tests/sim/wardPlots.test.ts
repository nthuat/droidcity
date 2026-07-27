import { describe, it, expect } from 'vitest'
import { createPlots, allocatePlot, releasePlot } from '../../src/sim/wardPlots'

describe('wardPlots', () => {
  it('allocates lowest free slot', () => {
    const a = allocatePlot(createPlots(4), 'chat')
    expect(a.plot).toBe(0)
    const b = allocatePlot(a.state, 'maps')
    expect(b.plot).toBe(1)
  })
  it('release frees slot for reuse, lowest-first', () => {
    let s = allocatePlot(createPlots(4), 'chat').state
    s = allocatePlot(s, 'maps').state
    s = releasePlot(s, 'chat')
    expect(allocatePlot(s, 'bank').plot).toBe(0)
  })
  it('returns -1 when full', () => {
    let s = createPlots(2)
    s = allocatePlot(s, 'a').state
    s = allocatePlot(s, 'b').state
    expect(allocatePlot(s, 'c').plot).toBe(-1)
  })
  it('rejects duplicate app with -1', () => {
    const s = allocatePlot(createPlots(4), 'chat').state
    expect(allocatePlot(s, 'chat').plot).toBe(-1)
  })
  it('does not mutate input', () => {
    const s0 = createPlots(4)
    allocatePlot(s0, 'chat')
    expect(s0.slots).toEqual([null, null, null, null])
  })
})
