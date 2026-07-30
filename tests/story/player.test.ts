import { describe, it, expect, vi } from 'vitest'
import { createPlayer, type Chapter } from '../../src/story/player'
import { createBus } from '../../src/core/bus'

function chapter(steps: Chapter['steps']): Chapter {
  return { id: 't', title: 'T', steps }
}

describe('storyPlayer', () => {
  it('arms wait before firing (synchronous emit in fire is caught)', () => {
    const bus = createBus()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep: vi.fn(), onChapterDone: done })
    p.play(chapter([{ narration: 'a', focus: 'boot', fire: () => bus.emit('boot:complete', {}), waitFor: { event: 'boot:complete' } }]))
    expect(done).toHaveBeenCalled()
  })
  it('advances on event across steps', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: vi.fn() })
    p.play(chapter([
      { narration: 'a', focus: 'boot', waitFor: { event: 'boot:stageDone' } },
      { narration: 'b', focus: 'boot', waitFor: { event: 'boot:complete' } },
    ]))
    bus.emit('boot:stageDone', { stage: 'kernel' })
    expect(onStep).toHaveBeenCalledTimes(2)
    expect(p.playing).toBe(true)
  })
  it('ms wait advances via update, scaled by speed', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: vi.fn() })
    p.play(chapter([
      { narration: 'a', focus: 'overview', waitFor: { ms: 1000 } },
      { narration: 'b', focus: 'overview', waitFor: { ms: 1000 } },
    ]))
    p.setSpeed(2)
    p.update(500)
    expect(onStep).toHaveBeenCalledTimes(2)
  })
  it('pause freezes ms waits; resume continues', () => {
    const bus = createBus()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep: vi.fn(), onChapterDone: done })
    p.play(chapter([{ narration: 'a', focus: 'overview', waitFor: { ms: 100 } }]))
    p.pause()
    p.update(1000)
    expect(done).not.toHaveBeenCalled()
    p.resume()
    p.update(100)
    expect(done).toHaveBeenCalled()
  })
  it('event during pause is remembered and applied on resume', () => {
    const bus = createBus()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep: vi.fn(), onChapterDone: done })
    p.play(chapter([{ narration: 'a', focus: 'boot', waitFor: { event: 'boot:complete' } }]))
    p.pause()
    bus.emit('boot:complete', {})
    expect(done).not.toHaveBeenCalled()
    p.resume()
    expect(done).toHaveBeenCalled()
  })
  it('force-advances a step whose event never arrives, and reports it', () => {
    const bus = createBus()
    const stuck: Array<[string, number, string]> = []
    const seen: string[] = []
    const p = createPlayer(bus, {
      onStep: (step) => seen.push(step.narration),
      onChapterDone: () => {},
      onStuckStep: (id, i, ev) => stuck.push([id, i, ev]),
    })
    p.play(chapter([
      { narration: 'a', focus: 'boot', waitFor: { event: 'boot:complete' } },
      { narration: 'b', focus: 'boot', waitFor: { ms: 10 } },
    ]))
    // Nothing ever emits boot:complete; the watchdog must still get us to 'b'.
    for (let i = 0; i < 30; i++) p.update(1000)
    expect(seen).toContain('b')
    expect(stuck).toHaveLength(1)
    expect(stuck[0][2]).toBe('boot:complete')
  })

  it('next force-advances; stop halts; restartChapter replays from step 0', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: done })
    const ch = chapter([
      { narration: 'a', focus: 'boot', waitFor: { event: 'boot:complete' } },
      { narration: 'b', focus: 'boot', waitFor: { ms: 5000 } },
    ])
    p.play(ch)
    p.next()
    expect(onStep).toHaveBeenCalledTimes(2)
    p.restartChapter()
    expect(onStep).toHaveBeenCalledTimes(3) // step 0 again
    p.stop()
    expect(p.playing).toBe(false)
    p.update(10000)
    expect(done).not.toHaveBeenCalled()
  })
  it('restartChapter works when destructured (no this binding)', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: done })
    const ch = chapter([
      { narration: 'a', focus: 'boot', waitFor: { event: 'boot:complete' } },
    ])
    p.play(ch)
    const { restartChapter } = p
    expect(() => restartChapter()).not.toThrow()
    expect(onStep).toHaveBeenCalledTimes(2) // once in initial play, once in restart
  })
  it('pause → emit → next → resume: stale flag cleared, no phantom advance', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: done })
    p.play(chapter([
      { narration: 'a', focus: 'boot', waitFor: { event: 'boot:stageDone' } },
      { narration: 'b', focus: 'boot', waitFor: { event: 'boot:complete' } },
      { narration: 'c', focus: 'boot', waitFor: { event: 'boot:done' } },
    ]))
    // Step 0 entered, subscribed to boot:stageDone
    expect(onStep).toHaveBeenCalledTimes(1)
    p.pause()
    bus.emit('boot:stageDone', {}) // deferred due to pause
    expect(onStep).toHaveBeenCalledTimes(1) // not advanced
    p.next() // force advance to step 1
    expect(onStep).toHaveBeenCalledTimes(2) // step 1 entered
    p.resume() // should not advance past step 1 due to stale flag being cleared
    expect(onStep).toHaveBeenCalledTimes(2) // still at step 1
    bus.emit('boot:complete', {}) // now emit event for step 1
    expect(onStep).toHaveBeenCalledTimes(3) // step 2 entered
  })
  it('early event satisfies a later step without re-emission', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: done })
    p.play(chapter([
      { narration: 'a', focus: 'overview', waitFor: { ms: 1000 } },
      { narration: 'b', focus: 'overview', waitFor: { event: 'boot:complete' } },
    ]))
    // Fires while step 0 (an ms-wait) is still in progress — buffered, not lost.
    bus.emit('boot:complete', {})
    expect(onStep).toHaveBeenCalledTimes(1)
    p.update(1000) // step 0's ms-wait completes, advances into step 1
    expect(onStep).toHaveBeenCalledTimes(2)
    p.update(0) // step 1's wait was already buffered — no re-emission needed
    expect(done).toHaveBeenCalled()
  })
  it('minStepMs holds a satisfied step until dwell elapses', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: vi.fn() }, { minStepMs: 1000 })
    p.play(chapter([
      { narration: 'a', focus: 'boot', waitFor: { event: 'boot:complete' } },
      { narration: 'b', focus: 'boot', waitFor: { ms: 0 } },
    ]))
    bus.emit('boot:complete', {}) // satisfied immediately, but dwell hasn't elapsed
    expect(onStep).toHaveBeenCalledTimes(1)
    p.update(999)
    expect(onStep).toHaveBeenCalledTimes(1)
    p.update(1)
    expect(onStep).toHaveBeenCalledTimes(2)
  })
  it('2x speed halves the dwell needed to advance', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: vi.fn() }, { minStepMs: 1000 })
    p.play(chapter([
      { narration: 'a', focus: 'boot', waitFor: { event: 'boot:complete' } },
      { narration: 'b', focus: 'boot', waitFor: { ms: 0 } },
    ]))
    bus.emit('boot:complete', {})
    p.setSpeed(2)
    p.update(499)
    expect(onStep).toHaveBeenCalledTimes(1)
    p.update(1)
    expect(onStep).toHaveBeenCalledTimes(2)
  })
  it('app-filtered wait consumes only the matching app event', () => {
    const bus = createBus()
    const onStep = vi.fn()
    const done = vi.fn()
    const p = createPlayer(bus, { onStep, onChapterDone: done })
    p.play(chapter([
      { narration: 'a', focus: 'ward:chat', waitFor: { event: 'activity:resumed', app: 'chat' } },
      { narration: 'b', focus: 'ward:chat', waitFor: { ms: 0 } },
    ]))
    bus.emit('activity:resumed', { app: 'mail' })
    expect(onStep).toHaveBeenCalledTimes(1) // wrong app — does not satisfy
    bus.emit('activity:resumed', { app: 'chat' })
    expect(onStep).toHaveBeenCalledTimes(2) // matching app — advances
  })
})
