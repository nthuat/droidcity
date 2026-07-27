import { describe, it, expect, vi } from 'vitest'
import { createBus } from '../../src/core/bus'
import { createWardManager } from '../../src/wards/manager'
import type { WardMeshes } from '../../src/scene/ward'

// Loose duck-typed fake — no real three objects needed, manager only touches
// these specific properties on the spawn/update/demolish path.
function fakeMeshes(): WardMeshes {
  return {
    group: {
      userData: {},
      position: { copy() {} },
      scale: {},
    },
    carsParent: { add() {}, remove() {} },
    floors: [],
    viewModelOrb: { visible: false },
    screenPanel: { material: { emissiveIntensity: 0 } },
    cratesParent: { add() {}, remove() {} },
    shedGlow: { material: { emissiveIntensity: 0 } },
    benchStations: [],
    anrOverlay: { material: { opacity: 0 } },
    wallMesh: {},
    dispose: vi.fn(),
  } as unknown as WardMeshes
}

function makeDeps() {
  return {
    bus: createBus(),
    scene: { add: vi.fn(), remove: vi.fn() } as unknown as import('three').Scene,
    packets: { fly: vi.fn(), update: vi.fn(), activeCount: () => 0 } as unknown as import('../../src/scene/packet').PacketSystem,
    anchors: { cityhall: {}, launcher: {}, surfaceflinger: {}, network: {} } as unknown as Record<string, import('three').Vector3>,
    plotAnchors: [{}, {}, {}, {}] as unknown as readonly import('three').Vector3[],
    buildMeshes: () => fakeMeshes(),
  }
}

describe('WardManager', () => {
  it('spawns a ward on process:forked', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    expect(manager.wards()).toHaveLength(1)
    expect(manager.wards()[0]).toMatchObject({ app: 'chat', pid: 1, plot: 0 })
  })

  it('demolishes and removes the ward on process:killed after the animation elapses', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    deps.bus.emit('process:killed', { app: 'chat', pid: 1 })
    manager.update(700)
    expect(manager.wards()).toHaveLength(0)
  })

  it('ignores a duplicate process:forked for the same app', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    deps.bus.emit('process:forked', { app: 'chat', pid: 2 })
    expect(manager.wards()).toHaveLength(1)
    expect(manager.wards()[0].pid).toBe(1)
  })

  it('routes data:cacheHit only to the owning ward', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    deps.bus.emit('process:forked', { app: 'maps', pid: 2 })

    const posted: { app: string; label: string }[] = []
    deps.bus.on('ui:messagePosted', (p) => posted.push(p))

    deps.bus.emit('data:cacheHit', { app: 'chat', stale: false })

    expect(posted).toHaveLength(1)
    expect(posted[0].app).toBe('chat')
  })
})
