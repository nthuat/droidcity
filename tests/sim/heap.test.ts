import { describe, it, expect } from 'vitest'
import { createHeap, allocate, release, releaseOldest, gc, usedKb } from '../../src/sim/heap'

describe('heap', () => {
  it('allocates while capacity remains', () => {
    const { state, gcRan } = allocate(createHeap(1000), 200)
    expect(usedKb(state)).toBe(200)
    expect(gcRan).toBe(false)
  })

  it('gc sweeps only unreachable objects', () => {
    let s = allocate(createHeap(1000), 200).state
    s = allocate(s, 300).state
    s = release(s, 1)
    s = gc(s)
    expect(usedKb(s)).toBe(300)
    expect(s.lastFreedKb).toBe(200)
    expect(s.gcCount).toBe(1)
    expect(s.objects.map(o => o.id)).toEqual([2])
  })

  it('allocation pressure triggers gc automatically', () => {
    let s = allocate(createHeap(500), 300).state
    s = release(s, 1)
    const result = allocate(s, 400) // 300 used, needs gc to fit
    expect(result.gcRan).toBe(true)
    expect(usedKb(result.state)).toBe(400)
  })

  it('throws OutOfMemoryError when gc cannot free enough', () => {
    const s = allocate(createHeap(500), 400).state // reachable, can't be freed
    expect(() => allocate(s, 300)).toThrow('OutOfMemoryError')
  })

  it('releaseOldest marks oldest N unreachable', () => {
    let s = allocate(createHeap(1000), 100).state
    s = allocate(s, 100).state
    s = allocate(s, 100).state
    s = releaseOldest(s, 2)
    expect(s.objects.filter(o => !o.reachable).map(o => o.id)).toEqual([1, 2])
  })
})
