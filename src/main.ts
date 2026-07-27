import * as THREE from 'three'
import { createCity } from './scene/city'
import type { Scenario } from './scenarios/types'
import { makeMainThreadScenario } from './scenarios/mainThread'
import { makeLifecycleScenario } from './scenarios/lifecycle'
import { makeTouchPipelineScenario } from './scenarios/touchPipeline'
import { makeZygoteScenario } from './scenarios/zygote'
import { makeGcScenario } from './scenarios/gc'

const DISTRICT_OFFSETS: THREE.Vector3[] = [
  new THREE.Vector3(-60, 0, 0), // mainThread
  new THREE.Vector3(0, 0, 0), // lifecycle
  new THREE.Vector3(60, 0, 0), // touchPipeline
  new THREE.Vector3(-30, 0, 60), // zygote
  new THREE.Vector3(30, 0, 60), // gc
]

const OVERVIEW_POS = new THREE.Vector3(0, 85, 110)
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 30)
const TWEEN_MS = 600

const city = createCity(document.querySelector<HTMLDivElement>('#app')!)
const switcherEl = document.querySelector<HTMLDivElement>('#switcher')!
const panelEl = document.querySelector<HTMLDivElement>('#panel')!

const scenarios: Scenario[] = [
  makeMainThreadScenario(),
  makeLifecycleScenario(),
  makeTouchPipelineScenario(),
  makeZygoteScenario(),
  makeGcScenario(),
]

scenarios.forEach((s, i) => {
  s.group.position.copy(DISTRICT_OFFSETS[i])
  city.scene.add(s.group)
})

// Camera fly-to tween state (position + orbit target, eased over TWEEN_MS).
let tweenFromPos = city.camera.position.clone()
let tweenToPos = OVERVIEW_POS.clone()
let tweenFromTarget = city.controls.target.clone()
let tweenToTarget = OVERVIEW_TARGET.clone()
let tweenT = TWEEN_MS // starts "done" — initial camera is set directly below

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function flyTo(pos: THREE.Vector3, target: THREE.Vector3): void {
  tweenFromPos = city.camera.position.clone()
  tweenToPos = pos.clone()
  tweenFromTarget = city.controls.target.clone()
  tweenToTarget = target.clone()
  tweenT = 0
}

function overviewPanel(): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = '<h2>DroidCity</h2><p>Pick a district.</p>'
  return div
}

let activeButton: HTMLButtonElement | null = null
function setActiveButton(b: HTMLButtonElement): void {
  activeButton?.classList.remove('active')
  b.classList.add('active')
  activeButton = b
}

let inOverview = true

function activate(s: Scenario, i: number): void {
  inOverview = false
  for (const sc of scenarios) sc.setIdle(true)
  s.setIdle(false)
  panelEl.replaceChildren(s.panel)
  flyTo(DISTRICT_OFFSETS[i].clone().add(s.cameraPos), DISTRICT_OFFSETS[i].clone().add(s.cameraTarget))
}

const overviewBtn = document.createElement('button')
overviewBtn.textContent = 'Overview'
overviewBtn.addEventListener('click', () => {
  setActiveButton(overviewBtn)
  inOverview = true
  for (const sc of scenarios) sc.setIdle(true)
  panelEl.replaceChildren(overviewPanel())
  flyTo(OVERVIEW_POS, OVERVIEW_TARGET)
})
switcherEl.appendChild(overviewBtn)

scenarios.forEach((s, i) => {
  const b = document.createElement('button')
  b.textContent = s.name
  b.addEventListener('click', () => {
    setActiveButton(b)
    activate(s, i)
  })
  switcherEl.appendChild(b)
})

// Start in Overview: camera set directly (no tween needed pre-intro).
setActiveButton(overviewBtn)
panelEl.replaceChildren(overviewPanel())
city.camera.position.copy(OVERVIEW_POS)
city.controls.target.copy(OVERVIEW_TARGET)

// Overview camera drift: slow orbit around OVERVIEW_TARGET, stopped for good on first click/drag.
const driftRadius = Math.hypot(OVERVIEW_POS.x - OVERVIEW_TARGET.x, OVERVIEW_POS.z - OVERVIEW_TARGET.z)
let driftAngle = Math.atan2(OVERVIEW_POS.x - OVERVIEW_TARGET.x, OVERVIEW_POS.z - OVERVIEW_TARGET.z)
let driftStopped = false
city.renderer.domElement.addEventListener('pointerdown', () => { driftStopped = true }, { once: true })

city.start((dtMs) => {
  if (tweenT < TWEEN_MS) {
    tweenT = Math.min(tweenT + dtMs, TWEEN_MS)
    const t = smoothstep(tweenT / TWEEN_MS)
    city.camera.position.lerpVectors(tweenFromPos, tweenToPos, t)
    city.controls.target.lerpVectors(tweenFromTarget, tweenToTarget, t)
  } else if (inOverview && !driftStopped) {
    driftAngle += dtMs * 0.00005
    city.camera.position.set(
      OVERVIEW_TARGET.x + driftRadius * Math.sin(driftAngle),
      OVERVIEW_POS.y,
      OVERVIEW_TARGET.z + driftRadius * Math.cos(driftAngle),
    )
  }
  for (const s of scenarios) s.update(dtMs)
})

document.querySelector('#intro-close')!.addEventListener('click', () => {
  document.querySelector<HTMLDivElement>('#intro')!.style.display = 'none'
})
