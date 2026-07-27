import { describe, it, expect } from 'vitest'
import { createActivity, launch, rotate, finish, background, foreground } from '../../src/sim/lifecycle'

describe('lifecycle', () => {
  it('launch fires onCreate/onStart/onResume', () => {
    const s = launch(createActivity())
    expect(s.phase).toBe('resumed')
    expect(s.log).toEqual(['onCreate', 'onStart', 'onResume'])
    expect(s.instanceNumber).toBe(1)
    expect(s.viewModelValue).toBe('counter=42')
  })

  it('rotate destroys and recreates, keeps ViewModel', () => {
    let s = launch(createActivity())
    s = rotate(s)
    expect(s.phase).toBe('resumed')
    expect(s.instanceNumber).toBe(2)
    expect(s.viewModelValue).toBe('counter=42')
    expect(s.log).toEqual([
      'onCreate', 'onStart', 'onResume',
      'onPause', 'onStop', 'onDestroy',
      'onCreate', 'onStart', 'onResume',
    ])
  })

  it('finish clears ViewModel', () => {
    let s = launch(createActivity())
    s = finish(s)
    expect(s.phase).toBe('destroyed')
    expect(s.viewModelValue).toBeNull()
  })

  it('background/foreground stop and restart without recreation', () => {
    let s = launch(createActivity())
    s = background(s)
    expect(s.phase).toBe('stopped')
    s = foreground(s)
    expect(s.phase).toBe('resumed')
    expect(s.instanceNumber).toBe(1)
  })

  it('rotate on destroyed activity is a no-op', () => {
    const s = rotate(createActivity())
    expect(s.phase).toBe('destroyed')
    expect(s.log).toEqual([])
  })
})
