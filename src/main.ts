import { createCity } from './scene/city'
import type { Scenario } from './scenarios/types'
import { makeMainThreadScenario } from './scenarios/mainThread'
import { makeLifecycleScenario } from './scenarios/lifecycle'
import { makeTouchPipelineScenario } from './scenarios/touchPipeline'
import { makeZygoteScenario } from './scenarios/zygote'
import { makeGcScenario } from './scenarios/gc'

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
let active: Scenario | null = null

function activate(s: Scenario): void {
  if (active) {
    city.scene.remove(active.group)
    active.reset()
  }
  active = s
  city.scene.add(s.group)
  panelEl.replaceChildren(s.panel)
}

for (const s of scenarios) {
  const b = document.createElement('button')
  b.textContent = s.name
  b.addEventListener('click', () => activate(s))
  switcherEl.appendChild(b)
}
if (scenarios.length > 0) activate(scenarios[0])

city.start((dtMs) => active?.update(dtMs))
