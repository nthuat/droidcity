import { describe, it, expect } from 'vitest'
import { createLauncher, requestLaunch, markRunning, markStopped, APPS } from '../../src/sim/launcher'

describe('launcher', () => {
  it('accepts launch for idle app', () => {
    const r = requestLaunch(createLauncher(), 'chat')
    expect(r.accepted).toBe(true)
    expect(r.state.launching).toEqual(['chat'])
  })
  it('rejects launch while launching or running', () => {
    let { state } = requestLaunch(createLauncher(), 'chat')
    expect(requestLaunch(state, 'chat').accepted).toBe(false)
    state = markRunning(state, 'chat')
    expect(requestLaunch(state, 'chat').accepted).toBe(false)
    expect(state.running).toEqual(['chat'])
    expect(state.launching).toEqual([])
  })
  it('rejects unknown app', () => {
    expect(requestLaunch(createLauncher(), 'nope').accepted).toBe(false)
  })
  it('markStopped frees the app for relaunch', () => {
    let { state } = requestLaunch(createLauncher(), 'maps')
    state = markRunning(state, 'maps')
    state = markStopped(state, 'maps')
    expect(requestLaunch(state, 'maps').accepted).toBe(true)
  })
  it('APPS has the 4 canonical apps', () => {
    expect(APPS).toEqual(['chat', 'maps', 'camera', 'bank'])
  })
})
