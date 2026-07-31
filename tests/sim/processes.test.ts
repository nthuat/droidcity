import { describe, it, expect } from 'vitest'
import { createSystem, growProcess, fork, setPriority, usedMb } from '../../src/sim/processes'

describe('processes', () => {
  it('forks a process with incrementing pid', () => {
    let s = createSystem(1000)
    s = fork(s, 'com.app.chat', 'foreground', 300)
    expect(s.procs).toHaveLength(1)
    expect(s.procs[0].pid).toBe(1)
    expect(usedMb(s)).toBe(300)
  })

  it('LMK kills cached processes first when memory is tight', () => {
    let s = createSystem(1000)
    s = fork(s, 'chat', 'cached', 400)
    s = fork(s, 'maps', 'service', 400)
    s = fork(s, 'game', 'foreground', 500) // needs 300 reclaimed → kills cached 'chat'
    expect(s.procs.map(p => p.name)).toEqual(['maps', 'game'])
    expect(s.killedPids).toEqual([1])
  })

  it('kills multiple, oldest cached first', () => {
    let s = createSystem(1000)
    s = fork(s, 'a', 'cached', 300)
    s = fork(s, 'b', 'cached', 300)
    s = fork(s, 'c', 'cached', 300)
    s = fork(s, 'big', 'foreground', 800) // must kill a and b and c? 900 used, need 700 free → kill a,b,c
    expect(s.killedPids).toEqual([1, 2, 3])
    expect(s.procs.map(p => p.name)).toEqual(['big'])
  })

  it('never kills foreground; fork fails if only foreground remains', () => {
    let s = createSystem(1000)
    s = fork(s, 'game', 'foreground', 900)
    s = fork(s, 'huge', 'visible', 500) // cannot reclaim → no fork
    expect(s.procs.map(p => p.name)).toEqual(['game'])
  })

  it('setPriority changes kill eligibility', () => {
    let s = createSystem(1000)
    s = fork(s, 'chat', 'foreground', 400)
    s = setPriority(s, 1, 'cached') // user pressed Home
    s = fork(s, 'game', 'foreground', 900)
    expect(s.killedPids).toEqual([1])
  })
})

describe('growProcess', () => {
  it('grows only the named process, and never past capacity', () => {
    let s = createSystem(1000)
    s = fork(s, 'chat', 'foreground', 300)
    s = fork(s, 'maps', 'cached', 300)
    const grown = growProcess(s, 'chat', 200)
    expect(grown.procs.find(p => p.name === 'chat')!.memoryMb).toBe(500)
    expect(grown.procs.find(p => p.name === 'maps')!.memoryMb).toBe(300)
    // 400MB headroom left: asking for 900 grants only what fits.
    const capped = growProcess(grown, 'chat', 900)
    expect(usedMb(capped)).toBe(1000)
  })
  it('is a no-op for an unknown app', () => {
    const s = fork(createSystem(1000), 'chat', 'foreground', 300)
    expect(growProcess(s, 'nope', 100)).toBe(s)
  })
})
