import { describe, expect, it } from 'vitest'
import { createScreen, screenOnHome, screenOnKilled, screenOnPermissionRequest, screenOnPermissionResolved, screenOnRecents, screenOnRecentsDismissed, screenOnResumed, screenOnShade, screenOnShadeDismissed } from '../../src/sim/screen'

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
  it('recents keeps the foreground app underneath', () => {
    const s = screenOnRecents(screenOnResumed(createScreen(), 'chat'))
    expect(s).toEqual({ mode: 'recents', app: 'chat' })
  })
  it('dismissing recents returns to the underlying app', () => {
    const s = screenOnRecents(screenOnResumed(createScreen(), 'chat'))
    expect(screenOnRecentsDismissed(s)).toEqual({ mode: 'app', app: 'chat' })
  })
  it('dismissing recents from home returns home', () => {
    const s = screenOnRecents(createScreen())
    expect(screenOnRecentsDismissed(s)).toEqual({ mode: 'home', app: null })
  })
  it('underlying app dying in recents clears the return target', () => {
    const s = screenOnRecents(screenOnResumed(createScreen(), 'chat'))
    expect(screenOnKilled(s, 'chat')).toEqual({ mode: 'recents', app: null })
  })
  it('shade overlays and dismisses back to the app', () => {
    const s = screenOnShade(screenOnResumed(createScreen(), 'chat'))
    expect(s).toEqual({ mode: 'shade', app: 'chat' })
    expect(screenOnShadeDismissed(s)).toEqual({ mode: 'app', app: 'chat' })
  })
  it('shade from home dismisses home', () => {
    expect(screenOnShadeDismissed(screenOnShade(createScreen()))).toEqual({ mode: 'home', app: null })
  })
  it('permission dialog resolves back to the requesting app', () => {
    const s = screenOnPermissionRequest(screenOnResumed(createScreen(), 'camera'), 'camera')
    expect(s).toEqual({ mode: 'permission', app: 'camera' })
    expect(screenOnPermissionResolved(s)).toEqual({ mode: 'app', app: 'camera' })
  })
  it('requesting app dying under the dialog falls home', () => {
    const s = screenOnPermissionRequest(screenOnResumed(createScreen(), 'camera'), 'camera')
    expect(screenOnKilled(s, 'camera')).toEqual({ mode: 'home', app: null })
  })
})
