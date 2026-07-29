import { describe, expect, it } from 'vitest'
import { createPermissions, denyPermission, grantPermission, needsPrompt } from '../../src/sim/permissions'

describe('permissions', () => {
  it('camera starts unasked and needs a prompt', () => {
    expect(needsPrompt(createPermissions(), 'camera')).toBe(true)
  })
  it('apps without a modeled permission never prompt', () => {
    expect(needsPrompt(createPermissions(), 'chat')).toBe(false)
  })
  it('granting silences the prompt for good', () => {
    const s = grantPermission(createPermissions(), 'camera')
    expect(needsPrompt(s, 'camera')).toBe(false)
  })
  it('denying re-asks next time', () => {
    const s = denyPermission(createPermissions(), 'camera')
    expect(needsPrompt(s, 'camera')).toBe(true)
  })
})
