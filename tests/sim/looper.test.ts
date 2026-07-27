import { describe, it, expect } from 'vitest'
import { createLooper, post, advance } from '../../src/sim/looper'

describe('looper', () => {
  it('posts messages to queue', () => {
    const s = post(createLooper(), 'click', 4)
    expect(s.queue).toHaveLength(1)
    expect(s.queue[0].label).toBe('click')
  })

  it('does not mutate input state', () => {
    const s0 = createLooper()
    post(s0, 'click', 4)
    expect(s0.queue).toHaveLength(0)
  })

  it('processes a message after its cost elapses', () => {
    let s = post(createLooper(), 'click', 4)
    s = advance(s, 10)
    expect(s.processedIds).toHaveLength(1)
    expect(s.queue).toHaveLength(0)
    expect(s.current).toBeNull()
  })

  it('processes multiple messages within one advance', () => {
    let s = createLooper()
    s = post(s, 'a', 4)
    s = post(s, 'b', 4)
    s = advance(s, 20)
    expect(s.processedIds).toHaveLength(2)
  })

  it('long message occupies current across advances', () => {
    let s = post(createLooper(), 'diskRead', 1000)
    s = advance(s, 100)
    expect(s.current?.msg.label).toBe('diskRead')
    expect(s.current?.elapsedMs).toBe(100)
    expect(s.anr).toBe(false)
  })

  it('flags ANR when one message runs 5000ms+', () => {
    let s = post(createLooper(), 'block', 99999)
    s = advance(s, 5000)
    expect(s.anr).toBe(true)
  })

  it('queue grows behind a blocking message', () => {
    let s = post(createLooper(), 'block', 99999)
    s = advance(s, 100)
    s = post(s, 'tap1', 4)
    s = post(s, 'tap2', 4)
    s = advance(s, 100)
    expect(s.queue).toHaveLength(2)
    expect(s.processedIds).toHaveLength(0)
  })
})
