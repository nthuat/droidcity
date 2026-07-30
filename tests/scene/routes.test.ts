import { describe, expect, it, vi } from 'vitest'

// Routes are pure geometry, but buildRoutes() touches three.js materials, so the
// meaningful assertion is the one that actually broke production: every route
// endpoint must resolve to a real anchor. An unresolved one used to throw
// "Cannot read properties of undefined (reading 'clone')" at page load.
describe('routes', () => {
  it('every route resolves both endpoints', async () => {
    const { buildRoutes } = await import('../../src/scene/routes')
    const routes = buildRoutes()
    // path() returns [] only when an endpoint cannot be resolved.
    const pairs: Array<[string, string]> = [
      ['packages', 'cityhall'],
      ['displaywall', 'cityhall'],
      ['launcher', 'cityhall'],
      ['cityhall', 'zygote'],
      ['network', 'plot0'],
      ['plot0', 'surfaceflinger'],
      ['surfaceflinger', 'displaywall'],
      ['hardware', 'displaywall'],
    ]
    for (const [from, to] of pairs) {
      expect(routes.path(from, to), `${from} -> ${to}`).not.toHaveLength(0)
    }
  })
})
