import { describe, expect, it } from 'vitest'
import { createNotifications, dismissNotification, hasNotification, postNotification } from '../../src/sim/notifications'

describe('notifications', () => {
  it('starts empty', () => {
    expect(createNotifications().pending).toEqual([])
  })
  it('posts once per app', () => {
    const s = postNotification(postNotification(createNotifications(), 'chat'), 'chat')
    expect(s.pending).toEqual(['chat'])
  })
  it('dismisses', () => {
    const s = postNotification(createNotifications(), 'chat')
    expect(dismissNotification(s, 'chat').pending).toEqual([])
  })
  it('dismiss of absent app is a no-op returning same state', () => {
    const s = postNotification(createNotifications(), 'chat')
    expect(dismissNotification(s, 'maps')).toBe(s)
  })
  it('hasNotification reads pending', () => {
    const s = postNotification(createNotifications(), 'maps')
    expect(hasNotification(s, 'maps')).toBe(true)
    expect(hasNotification(s, 'chat')).toBe(false)
  })
})
