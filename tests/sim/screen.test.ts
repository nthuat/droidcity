import { describe, expect, it } from 'vitest'
import { createScreen, screenOnHome, screenOnKilled, screenOnResumed } from '../../src/sim/screen'

describe('screen state', () => {
  it('starts at home', () => {
    expect(createScreen()).toEqual({ mode: 'home', app: null })
  })
  it('shows the resumed app', () => {
    expect(screenOnResumed(createScreen(), 'chat')).toEqual({ mode: 'app', app: 'chat' })
  })
  it('returns home on home press', () => {
    const s = screenOnResumed(createScreen(), 'chat')
    expect(screenOnHome(s)).toEqual({ mode: 'home', app: null })
  })
  it('falls back to home when the foreground app dies', () => {
    const s = screenOnResumed(createScreen(), 'chat')
    expect(screenOnKilled(s, 'chat')).toEqual({ mode: 'home', app: null })
  })
  it('ignores background app deaths', () => {
    const s = screenOnResumed(createScreen(), 'chat')
    expect(screenOnKilled(s, 'maps')).toBe(s)
  })
})
