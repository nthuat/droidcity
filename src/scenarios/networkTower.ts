import * as THREE from 'three'
import { NET_PHASES, startRequest, advanceRequest, type NetRequest } from '../sim/netFetch'
import { makeBuilding } from '../scene/builders'
import { makeAntenna } from '../scene/props'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const MAX_QUEUE = 3
const DEFAULT_NARRATION = 'Every network call walks dns → connect → tls → ttfb → download. A failure triggers a retry with backoff.'

// lastPhaseIndex seeds at -2 ("not started") so the very first tick's currentIndex (0, dns)
// reads as a change — NetRequest itself starts at currentIndex 0, so diffing against the raw
// req would miss dns's own emission. -1 is already taken (retrying's "no phase" index).
const NOT_STARTED = -2
interface QueueEntry { readonly req: NetRequest; readonly app: string; readonly lastPhaseIndex: number; readonly pooled: boolean }

// A completed request keeps its app's connection "warm" for 30s of scenario
// clock — the next request skips dns/connect/tls straight to ttfb, mirroring
// HTTP connection pooling/keep-alive.
const POOL_MS = 30_000
const POOL_SKIP_MS = 500 // dns(100) + connect(150) + tls(250) — lands exactly at ttfb

// Small dynamic-text sprite — the shared makeLabel() bakes text once, but the tower-top
// readout needs to change every phase transition, so this keeps its own canvas/texture.
function makePhaseLabel(initial: string): { sprite: THREE.Sprite; setText(t: string): void } {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }))
  sprite.scale.set(6, 1.5, 1)
  // Memoized: the idle branch calls setText('idle') every frame — repainting
  // (and re-uploading a 512×128 texture to the GPU) only on actual change.
  let last = ''
  function setText(t: string): void {
    if (t === last) return
    last = t
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = 'bold 40px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // Chip pill like makeLabel — readable on sky, plates and dark structures.
    const w = ctx.measureText(t).width + 40
    ctx.fillStyle = 'rgba(255,255,255,.92)'
    ctx.beginPath()
    ctx.roundRect(256 - w / 2, 24, w, 80, 20)
    ctx.fill()
    ctx.strokeStyle = 'rgba(31,41,51,.18)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#1f2933'
    ctx.fillText(t, 256, 64)
    texture.needsUpdate = true
  }
  setText(initial)
  return { sprite, setText }
}

export function makeNetworkTowerScenario(bus: Bus): Scenario & { stats(): { queue: number; phase: string } } {
  const group = new THREE.Group()
  group.userData.info = {
    title: 'Network edge',
    note: 'Radio → ISP → internet. Every fetch leaves the device here.',
  }
  let queue: QueueEntry[] = []
  let counter = 0
  let forceFailNext = false
  let clock = 0 // scenario-accumulated sim clock (ms) — never Date.now, so story-speed stays in control
  let pooledUntil: Record<string, number> = {}

  const tower = makeBuilding(3, 10, 3, 0x388bfd, 'Network')
  tower.position.y = 0.3
  tower.userData.info = { title: 'Radio/ISP edge', note: 'dns → connect → tls → ttfb → download. Warm connections skip DNS/connect/TLS — pooling.' }
  group.add(tower)

  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(2.5, 0.4, 8, 24, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x484f58 }),
  )
  // Upright half-torus spanning the eastward road (base on the plate top; the
  // arc opens upward — no z-flip, which would bury it in the plate).
  arch.position.set(6, 0.3, 0)
  arch.rotation.y = Math.PI / 2
  group.add(arch)

  // Static dressing: antenna mast array at the back of the plate + a dish on the
  // tower + a gate arch where the INTERNET road exits the board (world x 84, matching
  // board.ts's edge text). Local y 0.3 is the plate top (anchor y 0 matches it).
  for (const x of [-12, 0, 12]) {
    const mast = makeAntenna()
    mast.position.set(x, 0.3, 15)
    group.add(mast)
  }
  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(0, 1.1, 0.4, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x546e7a, roughness: 0.5, side: THREE.DoubleSide }),
  )
  dish.position.set(0, 10.5, 0) // tower body tops out at 10.3 (base 0.3 + height 10)
  dish.rotation.x = -0.7
  group.add(dish)
  const roadArch = new THREE.Mesh(
    new THREE.TorusGeometry(4, 0.35, 8, 24, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.6 }),
  )
  roadArch.rotation.y = Math.PI / 2
  roadArch.position.set(19, 0.3, 0)
  group.add(roadArch)

  const phaseLabel = makePhaseLabel('idle')
  phaseLabel.sprite.position.set(0, 13, 0) // above the building-name sprite (was colliding at 11.5)
  group.add(phaseLabel.sprite)

  const retryLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.4),
    new THREE.MeshStandardMaterial({ color: 0xf85149, emissive: 0xf85149, emissiveIntensity: 0 }),
  )
  retryLight.position.set(0, 10.5, 1.8)
  retryLight.userData.info = {
    title: 'Retry beacon',
    note: 'Blinks during exponential backoff after a failed request.',
  }
  group.add(retryLight)

  function enqueue(app: string): void {
    if (queue.length >= MAX_QUEUE) {
      bus.emit('data:dropped', { app }) // drop beyond capacity — tell listeners so they don't wait forever
      return
    }
    counter += 1
    const failAt = forceFailNext || counter % 3 === 0 ? 'ttfb' : undefined
    forceFailNext = false
    const pooled = !failAt && (pooledUntil[app] ?? -Infinity) > clock
    const req = pooled ? advanceRequest(startRequest(), POOL_SKIP_MS) : startRequest(failAt ? { failAt } : undefined)
    queue = [...queue, { req, app, lastPhaseIndex: NOT_STARTED, pooled }]
    // Synthetic phase, emitted once at enqueue (not a real NET_PHASES entry) so
    // HUD/story listeners see the pooled skip even before the queue reaches it.
    if (pooled) bus.emit('net:phase', { app, phase: 'pooled' })
  }

  bus.on('data:requested', ({ app, source }) => {
    if (source === 'network') enqueue(app)
  })
  // A killed process loses its warm sockets — more realistic, and it's also
  // what keeps a *stale* pool from a previous instance of `app` (e.g. an ambient
  // launch before Story mode, or a previous Play-All pass) from silently
  // warming a brand-new process's first request.
  // Residual case traced, not "fixed": ch2 → ch3 in Play All still legitimately
  // pools — ch2's own natural fetch (~600ms post-resume) completes and pools
  // 'chat' *while it's still alive*; ch3 runs moments later on that same live
  // process with no kill in between, so its fetch can still land inside the
  // 30s window. That's correct warm-connection behavior, not a bug — ch3's
  // narration was worded to stay true either way (see ch3-data.ts).
  bus.on('process:killed', ({ app }) => {
    if (!(app in pooledUntil)) return
    const { [app]: _dropped, ...rest } = pooledUntil
    pooledUntil = rest
  })

  const panel = makePanel('Network Tower — every fetch is a trip through 5 phases')
  panel.addButton('Send test request', () => bus.emit('data:requested', { app: 'chat', source: 'network' }))
  panel.addButton('Send failing request', () => {
    forceFailNext = true
    bus.emit('data:requested', { app: 'chat', source: 'network' })
  })
  panel.setNarration(DEFAULT_NARRATION)

  let blinkT = 0

  return {
    name: 'Network',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(8, 10, 18),
    cameraTarget: new THREE.Vector3(0, 4, 0),
    update(dtMs) {
      clock += dtMs
      if (queue.length > 0) {
        const head = queue[0]
        const next = advanceRequest(head.req, dtMs)
        // next.currentIndex is -1 both while retrying and once done — comparing against the
        // sentinel-seeded lastPhaseIndex (not the raw previous req) is what catches dns's entry.
        // For a pooled (pre-advanced) entry this sentinel still does the right thing: its
        // first observed index is ttfb (3), not dns — no spurious dns/connect/tls emission.
        const phaseChanged = next.currentIndex !== head.lastPhaseIndex
        queue = [{ req: next, app: head.app, lastPhaseIndex: next.currentIndex, pooled: head.pooled }, ...queue.slice(1)]
        if (phaseChanged) {
          const phase = next.retrying ? 'retry' : next.currentIndex >= 0 ? NET_PHASES[next.currentIndex].name : null
          if (phase) {
            bus.emit('net:phase', { app: head.app, phase })
            const label = head.pooled ? `pooled·${phase}` : phase
            phaseLabel.setText(label)
            panel.setNarration(`${head.app}: ${label}${next.retrying ? ' (retrying after ttfb failure)' : ''}`)
          }
        }
        if (next.done) {
          bus.emit('data:fetched', { app: head.app, ms: next.totalMs })
          pooledUntil = { ...pooledUntil, [head.app]: clock + POOL_MS }
          queue = queue.slice(1)
          phaseLabel.setText(queue.length > 0 ? queue[0].app : 'idle')
          panel.setNarration(queue.length > 0 ? DEFAULT_NARRATION : `${head.app} fetched in ${next.totalMs.toFixed(0)}ms.`)
        }
      } else {
        phaseLabel.setText('idle')
      }
      blinkT += dtMs
      const retrying = queue.length > 0 && queue[0].req.retrying
      ;(retryLight.material as THREE.MeshStandardMaterial).emissiveIntensity = retrying ? 0.4 + 0.4 * Math.sin(blinkT / 100) : 0
    },
    setIdle() {
      // no ambient behavior — network activity is bus/button driven only
    },
    stats() {
      if (queue.length === 0) return { queue: 0, phase: 'idle' }
      const head = queue[0].req
      const phase = head.retrying ? 'retry' : head.currentIndex >= 0 ? NET_PHASES[head.currentIndex].name : 'idle'
      return { queue: queue.length, phase }
    },
  }
}
