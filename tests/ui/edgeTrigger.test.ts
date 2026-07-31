import { describe, it, expect } from 'vitest'
import { createEdgeTrigger } from '../../src/ui/hardwareWiring'

describe('createEdgeTrigger', () => {
  it('fires once on an upward cross of hi', () => {
    const trigger = createEdgeTrigger(0.85, 0.7)
    expect(trigger(0.5)).toBe(false)
    expect(trigger(0.9)).toBe(true)
  })
  it('does not refire while staying at or above hi', () => {
    const trigger = createEdgeTrigger(0.85, 0.7)
    expect(trigger(0.9)).toBe(true)
    expect(trigger(0.95)).toBe(false)
    expect(trigger(0.86)).toBe(false)
  })
  it('re-arms once value drops to or below lo, then can fire again', () => {
    const trigger = createEdgeTrigger(0.85, 0.7)
    expect(trigger(0.9)).toBe(true)
    expect(trigger(0.8)).toBe(false) // between lo and hi, still armed=false, no refire
    expect(trigger(0.65)).toBe(false) // crosses lo, re-arms, but this call itself doesn't fire
    expect(trigger(0.9)).toBe(true) // fires again now that it's re-armed
  })
})
