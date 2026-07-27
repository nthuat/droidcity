import { describe, it, expect } from 'vitest'
import { startRequest, advanceRequest, NET_PHASES } from '../../src/sim/netFetch'

describe('netFetch', () => {
  it('phases total 1200ms in canonical order', () => {
    expect(NET_PHASES.reduce((a, p) => a + p.costMs, 0)).toBe(1200)
    expect(NET_PHASES.map(p => p.name)).toEqual(['dns', 'connect', 'tls', 'ttfb', 'download'])
  })
  it('advances through phases in order', () => {
    let r = startRequest()
    expect(r.currentIndex).toBe(0)
    r = advanceRequest(r, 100)
    expect(r.currentIndex).toBe(1)
    r = advanceRequest(r, 1100)
    expect(r.done).toBe(true)
    expect(r.currentIndex).toBe(-1)
  })
  it('happy path totalMs is 1200', () => {
    expect(advanceRequest(startRequest(), 5000).totalMs).toBe(1200)
  })
  it('failAt triggers retry then succeeds on attempt 2', () => {
    let r = startRequest({ failAt: 'ttfb' })
    r = advanceRequest(r, 900)
    expect(r.retrying).toBe(true)
    expect(r.attempt).toBe(1)
    r = advanceRequest(r, 500)
    expect(r.retrying).toBe(false)
    expect(r.attempt).toBe(2)
    expect(r.currentIndex).toBe(0)
    r = advanceRequest(r, 1200)
    expect(r.done).toBe(true)
  })
  it('does not mutate input', () => {
    const r0 = startRequest()
    advanceRequest(r0, 1000)
    expect(r0.elapsedMs).toBe(0)
  })
})
