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
})
