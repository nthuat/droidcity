import { describe, expect, it, vi } from 'vitest'
import { createBus } from '../../src/core/bus'
import { createPlayer } from '../../src/story/player'
import type { Chapter } from '../../src/story/player'
import type { StoryCtx } from '../../src/story/chapters/ctx'
import { makeCh1 } from '../../src/story/chapters/ch1-boot'
import { makeCh2 } from '../../src/story/chapters/ch2-ward'
import { makeCh3 } from '../../src/story/chapters/ch3-data'
import { makeCh4 } from '../../src/story/chapters/ch4-frame'
import { makeCh5 } from '../../src/story/chapters/ch5-back'
import { makeCh6 } from '../../src/story/chapters/ch6-metal'
import { makeCh7 } from '../../src/story/chapters/ch7-background'

// A ctx whose every capability is a spy: chapters must only reach for things
// that actually exist on StoryCtx (a typo or a removed hook throws here, not
// in the browser three minutes into a tour).
function stubCtx(): StoryCtx {
  const wards = {
    wardStats: () => [] as never[],
    refreshData: vi.fn(),
    runHeavyFrame: vi.fn(),
    blockMainThread: vi.fn(),
    rotate: vi.fn(),
    forceGc: vi.fn(),
    goHome: vi.fn(),
    toggleService: vi.fn(),
    toggleForegroundService: vi.fn(),
    pushActivity: vi.fn(),
    popActivity: vi.fn(),
    toggleBind: vi.fn(),
    callNative: vi.fn(),
    nativeCrash: vi.fn(),
  }
  return {
    bus: createBus(),
    bootRow: { replayBoot: vi.fn() },
    launcher: { clickKiosk: vi.fn(), resetApps: vi.fn() },
    wards: wards as unknown as StoryCtx['wards'],
    setCityDim: vi.fn(),
    killApp: vi.fn(),
    resetCity: vi.fn(),
    injectTap: vi.fn(),
    jobs: { enqueue: vi.fn(), setDoze: vi.fn(), openWindow: vi.fn() },
    squeezeMemory: vi.fn(),
  }
}

// Drives a chapter to completion: satisfies each step's wait the way the real
// city would (emit the awaited event, or let the clock run), and fails loudly
// if the watchdog ever has to rescue a step.
function playToEnd(chapter: Chapter): { steps: number; stuck: string[] } {
  const bus = createBus()
  const stuck: string[] = []
  let done = false
  let seen = 0
  const player = createPlayer(bus, {
    onStep: () => { seen += 1 },
    onChapterDone: () => { done = true },
    onStuckStep: (_id, _i, ev) => stuck.push(ev),
  })
  player.play(chapter)
  for (const step of chapter.steps) {
    // minStepMs is 0 in this harness, so one tick past any ms wait suffices.
    if ('event' in step.waitFor) {
      const payload = step.waitFor.app ? { app: step.waitFor.app } : {}
      bus.emit(step.waitFor.event, payload as never)
    } else {
      player.update(step.waitFor.ms + 1)
    }
    player.update(16)
  }
  expect(done).toBe(true)
  return { steps: seen, stuck }
}

const CHAPTERS: Array<[string, (ctx: StoryCtx) => Chapter]> = [
  ['ch1', makeCh1], ['ch2', makeCh2], ['ch3', makeCh3], ['ch4', makeCh4],
  ['ch5', makeCh5], ['ch6', makeCh6], ['ch7', makeCh7],
]

describe('story chapters', () => {
  it.each(CHAPTERS)('%s builds, runs every step, and never needs the watchdog', (_id, make) => {
    const ctx = stubCtx()
    const chapter = make(ctx)
    expect(chapter.steps.length).toBeGreaterThan(0)
    chapter.setup?.()
    const { steps, stuck } = playToEnd(chapter)
    expect(steps).toBe(chapter.steps.length)
    expect(stuck).toEqual([])
  })

  it('every step has narration and a focus target', () => {
    for (const [id, make] of CHAPTERS) {
      for (const [i, step] of make(stubCtx()).steps.entries()) {
        expect(step.narration.length, `${id} step ${i + 1} narration`).toBeGreaterThan(20)
        expect(step.focus.length, `${id} step ${i + 1} focus`).toBeGreaterThan(0)
      }
    }
  })
})
