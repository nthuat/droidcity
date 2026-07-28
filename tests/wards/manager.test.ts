import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
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
    appFloor: { material: { emissiveIntensity: 0 } },
    viewModelOrb: { visible: false },
    screenPanel: { material: { emissiveIntensity: 0 } },
    cratesParent: { add() {}, remove() {} },
    shedGlow: { material: { emissiveIntensity: 0 } },
    benchStations: [],
    anrOverlay: { material: { opacity: 0 } },
    serviceAnnex: { material: { emissiveIntensity: 0 } },
    wallMesh: {},
    workerParent: { add() {}, remove() {} },
    workerRoad: {},
    stackCards: [{ visible: false }, { visible: false }, { visible: false }],
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

  it('disposes dynamically created car/crate/sweep meshes on demolition (no GPU leak)', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })

    // 1 in-flight message → 1 car; 3 allocated heap objects → 3 crates.
    deps.bus.emit('data:fetched', { app: 'chat', ms: 10 })
    manager.update(1)
    // Force a GC sweep so the sweep-plane mesh gets created too.
    manager.forceGc('chat')
    manager.update(1)

    const geoDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const matDispose = vi.spyOn(THREE.Material.prototype, 'dispose')

    deps.bus.emit('process:killed', { app: 'chat', pid: 1 })
    manager.update(700)

    expect(manager.wards()).toHaveLength(0)
    // 1 car + 3 crates + 1 sweep plane = 5 dynamically created meshes.
    expect(geoDispose).toHaveBeenCalledTimes(5)
    expect(matDispose).toHaveBeenCalledTimes(5)

    geoDispose.mockRestore()
    matDispose.mockRestore()
  })

  it('disposes a network worker car when its request is dropped (networkTower queue overflow)', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    deps.bus.emit('data:requested', { app: 'chat', source: 'network' })

    const geoDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose')
    const matDispose = vi.spyOn(THREE.Material.prototype, 'dispose')

    deps.bus.emit('data:dropped', { app: 'chat' })

    expect(geoDispose).toHaveBeenCalledTimes(1)
    expect(matDispose).toHaveBeenCalledTimes(1)

    geoDispose.mockRestore()
    matDispose.mockRestore()
  })

  it('on memory:trim, frees exactly the 2 oldest heap objects for a living ward and skips a dying one', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    deps.bus.emit('process:forked', { app: 'maps', pid: 2 })

    // chat: known heap state — 3 objects of 80KB each via the fetched-response path.
    deps.bus.emit('data:fetched', { app: 'chat', ms: 10 })
    manager.update(1)

    // maps: killed but still mid-demolition (600ms) — dying, must be skipped by trim.
    deps.bus.emit('process:killed', { app: 'maps', pid: 2 })

    const swept: { app: string; freedKb: number }[] = []
    deps.bus.on('gc:swept', (p) => swept.push(p))

    deps.bus.emit('memory:trim', {})

    // Only the living ward reacts, and freedKb is the exact size of the 2
    // oldest objects released (80KB each), not just "some" positive number.
    expect(swept).toEqual([{ app: 'chat', freedKb: 160 }])
  })

  it('excludes a dying ward from wardStats immediately on process:killed', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.blockMainThread('chat', 5000)
    manager.update(1) // advance looper so `current` is set (busy)
    expect(manager.wardStats()).toContainEqual(expect.objectContaining({ app: 'chat', busy: true }))

    deps.bus.emit('process:killed', { app: 'chat', pid: 1 })
    // Still mid-demolition (600ms), but wardStats must drop it right away —
    // otherwise its CPU core stays lit/stuck for the whole animation.
    expect(manager.wardStats().some(s => s.app === 'chat')).toBe(false)
  })

  it('warm start: goHome then app:broughtToFront relights the ward and re-emits activity:resumed', () => {
    const deps = makeDeps()
    const setAppPriority = vi.fn()
    const onStartType = vi.fn()
    const manager = createWardManager({ ...deps, setAppPriority, onStartType })
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.update(800) // rise completes -> cold start, activity resumed
    expect(onStartType).toHaveBeenCalledWith('chat', 'cold')

    manager.goHome('chat')
    expect(manager.wardStats().find(s => s.app === 'chat')?.phase).toBe('stopped')
    expect(setAppPriority).toHaveBeenCalledWith('chat', 'cached')

    const resumed: { app: string }[] = []
    deps.bus.on('activity:resumed', p => resumed.push(p))
    deps.bus.emit('app:broughtToFront', { app: 'chat' })

    expect(resumed).toEqual([{ app: 'chat' }])
    expect(manager.wardStats().find(s => s.app === 'chat')?.phase).toBe('resumed')
    expect(setAppPriority).toHaveBeenCalledWith('chat', 'foreground')
    expect(onStartType).toHaveBeenCalledWith('chat', 'warm')
  })

  it('hot start: app:broughtToFront while already resumed re-emits activity:resumed without a phase change', () => {
    const deps = makeDeps()
    const setAppPriority = vi.fn()
    const onStartType = vi.fn()
    const manager = createWardManager({ ...deps, setAppPriority, onStartType })
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.update(800) // resumed via cold start; never backgrounded

    const resumed: { app: string }[] = []
    deps.bus.on('activity:resumed', p => resumed.push(p))
    deps.bus.emit('app:broughtToFront', { app: 'chat' })

    expect(resumed).toEqual([{ app: 'chat' }])
    expect(manager.wardStats().find(s => s.app === 'chat')?.phase).toBe('resumed')
    expect(onStartType).toHaveBeenCalledWith('chat', 'hot')
  })

  it('bug (b): hot start restores foundry priority to foreground, not just warm start', () => {
    const deps = makeDeps()
    const setAppPriority = vi.fn()
    const manager = createWardManager({ ...deps, setAppPriority })
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.update(800) // resumed via cold start; already foreground

    // A hot start must still (re)set foreground priority — otherwise a stale
    // foundry entry (e.g. from a previous idle demote) is never corrected.
    deps.bus.emit('app:broughtToFront', { app: 'chat' })
    expect(setAppPriority).toHaveBeenCalledWith('chat', 'foreground')
  })

  it('single-foreground invariant: resuming app B auto-backgrounds app A (phase, event, foundry priority)', () => {
    const deps = makeDeps()
    const setAppPriority = vi.fn()
    const manager = createWardManager({ ...deps, setAppPriority })
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.update(800) // chat resumed (foreground)
    deps.bus.emit('process:forked', { app: 'maps', pid: 2 })

    const backgrounded: { app: string }[] = []
    deps.bus.on('activity:backgrounded', p => backgrounded.push(p))

    manager.update(800) // maps rise completes -> resumed, must auto-background chat

    expect(backgrounded).toEqual([{ app: 'chat' }])
    expect(manager.wardStats().find(s => s.app === 'chat')?.phase).toBe('stopped')
    expect(manager.wardStats().find(s => s.app === 'maps')?.phase).toBe('resumed')
    expect(setAppPriority).toHaveBeenCalledWith('chat', 'cached')
  })

  it('pushActivity stacks up to max 3, emitting activity:pushed with the new depth and updating wardStats().backStack', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.update(800) // rise completes -> resumed

    const pushed: { app: string; depth: number }[] = []
    deps.bus.on('activity:pushed', p => pushed.push(p))

    manager.pushActivity('chat')
    manager.pushActivity('chat')

    expect(pushed).toEqual([{ app: 'chat', depth: 1 }, { app: 'chat', depth: 2 }])
    expect(manager.wardStats().find(s => s.app === 'chat')?.backStack).toBe(2)

    // Max 3: pushes beyond the 3rd are a no-op.
    manager.pushActivity('chat')
    manager.pushActivity('chat')
    expect(manager.wardStats().find(s => s.app === 'chat')?.backStack).toBe(3)
    expect(pushed).toHaveLength(3)
  })

  it('popActivity to 0 then again finishes the root; a later broughtToFront relaunches it (warm relight)', () => {
    const deps = makeDeps()
    const setAppPriority = vi.fn()
    const onStartType = vi.fn()
    const manager = createWardManager({ ...deps, setAppPriority, onStartType })
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.update(800) // resumed
    manager.pushActivity('chat')
    manager.pushActivity('chat')

    const popped: { app: string; depth: number }[] = []
    deps.bus.on('activity:popped', p => popped.push(p))

    manager.popActivity('chat') // depth 2 -> 1
    manager.popActivity('chat') // depth 1 -> 0
    expect(popped).toEqual([{ app: 'chat', depth: 1 }, { app: 'chat', depth: 0 }])
    expect(manager.wardStats().find(s => s.app === 'chat')?.phase).toBe('resumed')

    manager.popActivity('chat') // backStack already 0 -> finish root
    expect(manager.wardStats().find(s => s.app === 'chat')?.phase).toBe('destroyed')
    expect(setAppPriority).toHaveBeenLastCalledWith('chat', 'cached')
    // Finishing the root is a distinct action from popping — no extra activity:popped.
    expect(popped).toHaveLength(2)

    // Relaunch: ward alive, phase destroyed -> broughtToFront recreates the Activity
    // (warm start), proving launch()'s destroyed-phase path works from this manager.
    const resumed: { app: string }[] = []
    deps.bus.on('activity:resumed', p => resumed.push(p))
    deps.bus.emit('app:broughtToFront', { app: 'chat' })

    expect(resumed).toEqual([{ app: 'chat' }])
    expect(manager.wardStats().find(s => s.app === 'chat')?.phase).toBe('resumed')
    expect(onStartType).toHaveBeenCalledWith('chat', 'warm')
  })

  it('broadcast:sent posts onReceive to each living ward, skipping a dying one', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    deps.bus.emit('process:forked', { app: 'maps', pid: 2 })
    deps.bus.emit('process:killed', { app: 'maps', pid: 2 }) // dying, mid-demolition

    const posted: { app: string; label: string }[] = []
    deps.bus.on('ui:messagePosted', p => posted.push(p))

    deps.bus.emit('broadcast:sent', { action: 'NEWS' })

    expect(posted).toEqual([{ app: 'chat', label: 'onReceive' }])
  })

  it('emits activity:backgrounded on goHome and on the finish-root pop', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.update(800) // resumed

    const backgrounded: { app: string }[] = []
    deps.bus.on('activity:backgrounded', p => backgrounded.push(p))

    manager.goHome('chat')
    expect(backgrounded).toEqual([{ app: 'chat' }])

    // Warm-relight then finish the root via popActivity (backStack already 0).
    deps.bus.emit('app:broughtToFront', { app: 'chat' })
    manager.popActivity('chat')
    expect(backgrounded).toEqual([{ app: 'chat' }, { app: 'chat' }])
  })

  it('a backgrounded ward never submits a frame for a posted message; foreground again and it does', () => {
    const deps = makeDeps()
    const manager = createWardManager(deps)
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.update(800) // resumed

    manager.goHome('chat') // backgrounded — looper still runs, but no frames

    const submitted: { app: string; dropped: boolean }[] = []
    deps.bus.on('frame:submitted', p => submitted.push(p))

    deps.bus.emit('ui:messagePosted', { app: 'chat', label: 'onReceive' })
    manager.update(1000) // long enough for a frame to complete if one had started
    expect(submitted).toHaveLength(0)

    deps.bus.emit('app:broughtToFront', { app: 'chat' }) // warm start -> resumed again
    deps.bus.emit('ui:messagePosted', { app: 'chat', label: 'onReceive' })
    manager.update(1000)
    expect(submitted).toHaveLength(1)
  })

  it('toggleService: backgrounded ward flips foundry priority service<->cached and lights the annex', () => {
    const deps = makeDeps()
    const setAppPriority = vi.fn()
    const manager = createWardManager({ ...deps, setAppPriority })
    deps.bus.emit('process:forked', { app: 'chat', pid: 1 })
    manager.update(800) // resumed
    manager.goHome('chat') // backgrounded -> cached (service not yet running)
    expect(setAppPriority).toHaveBeenLastCalledWith('chat', 'cached')

    const changed: { app: string; running: boolean }[] = []
    deps.bus.on('service:changed', p => changed.push(p))

    expect(manager.toggleService('chat')).toBe(true)
    expect(setAppPriority).toHaveBeenLastCalledWith('chat', 'service')
    expect(changed).toEqual([{ app: 'chat', running: true }])

    expect(manager.toggleService('chat')).toBe(false)
    expect(setAppPriority).toHaveBeenLastCalledWith('chat', 'cached')
    expect(changed[1]).toEqual({ app: 'chat', running: false })
  })
})
