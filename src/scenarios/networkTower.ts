import * as THREE from 'three'
import { NET_PHASES, startRequest, advanceRequest, type NetRequest } from '../sim/netFetch'
import { makeBuilding } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

const MAX_QUEUE = 3
const DEFAULT_NARRATION = 'Every network call walks dns → connect → tls → ttfb → download. A failure triggers a retry with backoff.'

// lastPhaseIndex seeds at -2 ("not started") so the very first tick's currentIndex (0, dns)
// reads as a change — NetRequest itself starts at currentIndex 0, so diffing against the raw
// req would miss dns's own emission. -1 is already taken (retrying's "no phase" index).
const NOT_STARTED = -2
interface QueueEntry { readonly req: NetRequest; readonly app: string; readonly lastPhaseIndex: number }

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
  function setText(t: string): void {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = 'bold 40px system-ui, sans-serif'
    ctx.fillStyle = '#e6edf3'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t, 256, 64)
    texture.needsUpdate = true
  }
  setText(initial)
  return { sprite, setText }
}

export function makeNetworkTowerScenario(bus: Bus): Scenario & { stats(): { queue: number; phase: string } } {
  const group = new THREE.Group()
  let queue: QueueEntry[] = []
  let counter = 0
  let forceFailNext = false

  const tower = makeBuilding(3, 10, 3, 0x388bfd, 'Network')
  group.add(tower)

  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(2.5, 0.4, 8, 24, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x484f58 }),
  )
  arch.position.set(6, 2.5, 0)
  arch.rotation.z = Math.PI
  group.add(arch)

  const phaseLabel = makePhaseLabel('idle')
  phaseLabel.sprite.position.set(0, 11.5, 0)
  group.add(phaseLabel.sprite)

  const retryLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.4),
    new THREE.MeshStandardMaterial({ color: 0xf85149, emissive: 0xf85149, emissiveIntensity: 0 }),
  )
  retryLight.position.set(0, 10.5, 1.8)
  group.add(retryLight)

  function enqueue(app: string): void {
    if (queue.length >= MAX_QUEUE) return // drop beyond capacity
    counter += 1
    const failAt = forceFailNext || counter % 3 === 0 ? 'ttfb' : undefined
    forceFailNext = false
    queue = [...queue, { req: startRequest(failAt ? { failAt } : undefined), app, lastPhaseIndex: NOT_STARTED }]
  }

  bus.on('data:requested', ({ app, source }) => {
    if (source === 'network') enqueue(app)
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
      if (queue.length > 0) {
        const head = queue[0]
        const next = advanceRequest(head.req, dtMs)
        // next.currentIndex is -1 both while retrying and once done — comparing against the
        // sentinel-seeded lastPhaseIndex (not the raw previous req) is what catches dns's entry.
        const phaseChanged = next.currentIndex !== head.lastPhaseIndex
        queue = [{ req: next, app: head.app, lastPhaseIndex: next.currentIndex }, ...queue.slice(1)]
        if (phaseChanged) {
          const phase = next.retrying ? 'retry' : next.currentIndex >= 0 ? NET_PHASES[next.currentIndex].name : null
          if (phase) {
            bus.emit('net:phase', { app: head.app, phase })
            phaseLabel.setText(phase)
            panel.setNarration(`${head.app}: ${phase}${next.retrying ? ' (retrying after ttfb failure)' : ''}`)
          }
        }
        if (next.done) {
          bus.emit('data:fetched', { app: head.app, ms: next.totalMs })
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
    reset() {
      queue = []
      counter = 0
      forceFailNext = false
      blinkT = 0
      phaseLabel.setText('idle')
      panel.setNarration(DEFAULT_NARRATION)
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
