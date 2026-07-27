import * as THREE from 'three'
import { startFrame, advanceFrame, withHeavyDraw, DEFAULT_STAGES, type FrameRun } from '../sim/framePipeline'
import { FRAME_BUDGET_MS } from '../sim/constants'
import { makeBuilding, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const SLOWDOWN = 200 // 1 sim-ms rendered over 200 real-ms
const STATION_GAP = 4
const DEFAULT_NARRATION = 'Tap. The touch packet must pass every station before the deadline, or the frame drops.'

export function makeTouchPipelineScenario(): Scenario {
  const group = new THREE.Group()
  let run: FrameRun | null = null

  const stations: THREE.Group[] = DEFAULT_STAGES.map((stage, i) => {
    const b = makeBuilding(2.5, 3 + (i % 2), 2.5, 0x388bfd, stage.name)
    b.position.x = (i - 3) * STATION_GAP
    group.add(b)
    return b
  })

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 6, 4),
    new THREE.MeshStandardMaterial({ color: 0x21262d }),
  )
  screen.position.set(4 * STATION_GAP, 3, 0)
  group.add(screen)
  const screenLabel = makeLabel('Display', 0.8)
  screenLabel.position.set(4 * STATION_GAP, 7, 0)
  group.add(screenLabel)

  const packet = new THREE.Mesh(
    new THREE.SphereGeometry(0.5),
    new THREE.MeshStandardMaterial({ color: 0x76e3ea, emissive: 0x76e3ea, emissiveIntensity: 0.8 }),
  )
  packet.visible = false
  group.add(packet)

  const budgetBar = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.4, 0.4),
    new THREE.MeshBasicMaterial({ color: 0x3fb950 }),
  )
  budgetBar.position.set(0, 8, 0)
  budgetBar.visible = false
  group.add(budgetBar)

  const panel = makePanel('One frame = an assembly line with a 16.67ms deadline')
  panel.addButton('Tap (normal frame)', () => { run = startFrame() })
  panel.addButton('Tap (heavy draw 20ms)', () => { run = startFrame(withHeavyDraw(DEFAULT_STAGES, 20)) })
  panel.setNarration(DEFAULT_NARRATION)

  let resultFlash = 0
  let idleEnabled = true
  let idleT = 0
  let idleFrameCount = 0
  return {
    name: 'Touch → Pixel',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(0, 14, 30),
    cameraTarget: new THREE.Vector3(2, 3, 0),
    update(dtMs) {
      if (idleEnabled) {
        idleT += dtMs
        if (idleT >= 2500 && (!run || run.done)) {
          idleT = 0
          idleFrameCount++
          run = idleFrameCount % 4 === 0 ? startFrame(withHeavyDraw(DEFAULT_STAGES, 20)) : startFrame()
        }
      }
      const screenMat = screen.material as THREE.MeshStandardMaterial
      if (run && !run.done) {
        run = advanceFrame(run, dtMs / SLOWDOWN)
        packet.visible = true
        const i = run.currentStageIndex
        if (i >= 0) {
          const x0 = (i - 3) * STATION_GAP
          packet.position.set(x0 + run.stageProgress * STATION_GAP * 0.8, 4, 0)
          if (!idleEnabled) panel.setNarration(`${run.stages[i].name} · ${run.elapsedMs.toFixed(1)} / ${FRAME_BUDGET_MS} ms${run.dropped ? ' · WILL MISS DEADLINE' : ''}`)
        }
        budgetBar.visible = true
        const frac = Math.min(run.elapsedMs / FRAME_BUDGET_MS, 1)
        budgetBar.scale.x = 1 + frac * 20
        ;(budgetBar.material as THREE.MeshBasicMaterial).color.setHex(
          run.elapsedMs > FRAME_BUDGET_MS ? 0xf85149 : 0x3fb950,
        )
        if (run.done) {
          resultFlash = 800
          if (!idleEnabled) panel.setNarration(run.dropped
            ? `Frame took ${run.totalMs.toFixed(1)}ms — deadline missed, frame dropped. User sees jank.`
            : `Frame delivered in ${run.totalMs.toFixed(1)}ms — under budget. Smooth.`)
        }
      } else {
        packet.visible = false
      }
      if (resultFlash > 0 && run) {
        resultFlash -= dtMs
        screenMat.emissive.setHex(run.dropped ? 0xf85149 : 0x3fb950)
        screenMat.emissiveIntensity = Math.max(resultFlash / 800, 0)
      } else {
        screenMat.emissiveIntensity = 0
      }
      stations.forEach((s, i) => {
        const body = s.getObjectByName('body') as THREE.Mesh
        const mat = body.material as THREE.MeshStandardMaterial
        const active = run !== null && !run.done && run.currentStageIndex === i
        mat.emissive.setHex(active ? 0x76e3ea : 0x000000)
        mat.emissiveIntensity = active ? 0.5 : 0
      })
    },
    reset() {
      run = null
      packet.visible = false
      budgetBar.visible = false
      resultFlash = 0
      idleT = 0
      idleFrameCount = 0
      panel.setNarration(DEFAULT_NARRATION)
    },
    setIdle(enabled) {
      idleEnabled = enabled
      idleT = 0
    },
  }
}
