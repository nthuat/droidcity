import { describe, it, expect } from 'vitest'
import { startFrame, advanceFrame, withHeavyDraw, DEFAULT_STAGES } from '../../src/sim/framePipeline'

describe('framePipeline', () => {
  it('default stages fit the 16.67ms budget', () => {
    const run = startFrame()
    expect(run.totalMs).toBeLessThan(16.67)
    expect(run.dropped).toBe(false)
    expect(run.currentStageIndex).toBe(0)
  })

  it('advances through stages in order', () => {
    let run = startFrame()
    run = advanceFrame(run, 1) // input done
    expect(run.currentStageIndex).toBe(1)
    run = advanceFrame(run, 1) // animation done
    expect(run.currentStageIndex).toBe(2)
  })

  it('completes after total cost', () => {
    let run = startFrame()
    run = advanceFrame(run, run.totalMs)
    expect(run.done).toBe(true)
    expect(run.currentStageIndex).toBe(-1)
  })

  it('heavy draw blows the budget and marks dropped', () => {
    const run = startFrame(withHeavyDraw(DEFAULT_STAGES, 20))
    expect(run.totalMs).toBeGreaterThan(16.67)
    expect(run.dropped).toBe(true)
  })

  it('stageProgress is fractional mid-stage', () => {
    let run = startFrame() // input costs 1ms
    run = advanceFrame(run, 0.5)
    expect(run.currentStageIndex).toBe(0)
    expect(run.stageProgress).toBeCloseTo(0.5)
  })
})
