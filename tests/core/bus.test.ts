import { describe, it, expect, vi } from 'vitest'
import { createBus } from '../../src/core/bus'

describe('bus', () => {
  it('delivers payload to subscribers', () => {
    const bus = createBus()
    const fn = vi.fn()
    bus.on('app:launchRequested', fn)
    bus.emit('app:launchRequested', { app: 'chat' })
    expect(fn).toHaveBeenCalledWith({ app: 'chat' })
  })
  it('unsubscribe stops delivery', () => {
    const bus = createBus()
    const fn = vi.fn()
    const off = bus.on('boot:complete', fn)
    off()
    bus.emit('boot:complete', {})
    expect(fn).not.toHaveBeenCalled()
  })
  it('emit with no subscribers is safe', () => {
    expect(() => createBus().emit('gc:swept', { app: 'chat', freedKb: 1 })).not.toThrow()
  })
  it('clear removes all subscribers', () => {
    const bus = createBus()
    const fn = vi.fn()
    bus.on('net:phase', fn)
    bus.clear()
    bus.emit('net:phase', { app: 'chat', phase: 'dns' })
    expect(fn).not.toHaveBeenCalled()
  })
  it('handler errors do not break other subscribers', () => {
    const bus = createBus()
    const good = vi.fn()
    bus.on('frame:composited', () => { throw new Error('boom') })
    bus.on('frame:composited', good)
    bus.emit('frame:composited', { app: 'chat' })
    expect(good).toHaveBeenCalled()
  })
  it('unsubscribing during emit does not skip other handlers', () => {
    const bus = createBus()
    const b = vi.fn()
    const offA = bus.on('anr', () => offA())
    bus.on('anr', b)
    bus.emit('anr', { app: 'chat' })
    expect(b).toHaveBeenCalled()
  })
})
