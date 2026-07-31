# DroidCity v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive 3D city (PGSimCity-style) that teaches Android internals through 5 animated scenarios: main-thread traffic/ANR, activity lifecycle + rotation, touch-to-pixel frame pipeline, Zygote/LMK process management, and garbage collection.

**Architecture:** Strict two-layer split. `src/sim/` holds pure, immutable, deterministic TypeScript state machines (one per Android concept), fully unit-tested, zero Three.js imports. `src/scenarios/` + `src/scene/` are a thin Three.js rendering layer that reads sim state each frame and animates the city. Scenarios are self-contained districts registered in a switcher; each ships independently.

**Tech Stack:** Vite, TypeScript (strict), Three.js, Vitest. Static deploy to GitHub Pages via Actions.

## Global Constraints

- Project root: `/Users/admin/Projects/Ideas/droidcity` (new git repo, parent dir is not a repo)
- Dependencies: exactly `three` (runtime) + `vite`, `typescript`, `vitest`, `@types/three` (dev). No React, no physics libs, no UI frameworks.
- `src/sim/**` NEVER imports `three`. All sim functions are pure: take state, return new state (immutable, never mutate input).
- All time is simulated milliseconds passed as `dtMs: number`. No `Date.now()`/`performance.now()` inside `src/sim/**` (rendering loop may use it).
- ANR threshold: `5000` ms. Frame budget: `16.67` ms. Constants live in `src/sim/constants.ts`, never inlined.
- Files under 400 lines. Commit messages: conventional commits (`feat:`, `test:`, `chore:`), no attribution footer.
- Every sim module gets tests BEFORE implementation (RED → GREEN). Scene/visual code is verified by loading the dev server, not unit tests.
- Package manager: `npm`.

## File Structure

```
droidcity/
├── index.html                    # entry, root canvas + UI overlay divs
├── vite.config.ts                # base path for GH Pages
├── src/
│   ├── main.ts                   # bootstrap: scene + scenario switcher + render loop
│   ├── sim/
│   │   ├── constants.ts          # ANR_MS, FRAME_BUDGET_MS, etc.
│   │   ├── looper.ts             # MessageQueue/Looper state machine
│   │   ├── lifecycle.ts          # Activity lifecycle state machine
│   │   ├── framePipeline.ts      # touch→pixel stage pipeline
│   │   ├── processes.ts          # Zygote fork + LMK reclaim
│   │   └── heap.ts               # allocation + GC
│   ├── scene/
│   │   ├── city.ts               # renderer/camera/lights/ground bootstrap
│   │   └── builders.ts           # makeBuilding, makeLabel, makeCar helpers
│   ├── scenarios/
│   │   ├── types.ts              # Scenario interface
│   │   ├── mainThread.ts         # scenario 1
│   │   ├── lifecycle.ts          # scenario 2
│   │   ├── touchPipeline.ts      # scenario 3
│   │   ├── zygote.ts             # scenario 4
│   │   └── gc.ts                 # scenario 5
│   └── ui/
│       └── panel.ts              # control panel + narration helpers
├── tests/sim/                    # one test file per sim module
└── .github/workflows/deploy.yml
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `.gitignore`

**Interfaces:**
- Produces: running Vite dev server, `npm test` (vitest), `npm run build` all green.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/admin/Projects/Ideas/droidcity
git init
npm create vite@latest . -- --template vanilla-ts
npm install three
npm install -D vitest @types/three
```

- [ ] **Step 2: Configure**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/droidcity/', // GH Pages repo path
})
```

Add to `package.json` scripts: `"test": "vitest run"`.

Replace `index.html` body content with:
```html
<body>
  <div id="app"></div>
  <div id="switcher"></div>
  <div id="panel"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

Replace `src/main.ts` entirely with:
```ts
document.querySelector<HTMLDivElement>('#app')!.textContent = 'DroidCity booting…'
```
Delete Vite demo files: `src/counter.ts`, `src/typescript.svg`, `public/vite.svg`, `src/style.css` reference if broken.

- [ ] **Step 3: Verify**

Run: `npm run build && npm test`
Expected: build succeeds; vitest reports "no test files found" exit 0 (add `--passWithNoTests` to test script if it exits 1).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold vite + ts + three + vitest"
```

---

### Task 2: Sim constants + Looper state machine

**Files:**
- Create: `src/sim/constants.ts`, `src/sim/looper.ts`
- Test: `tests/sim/looper.test.ts`

**Interfaces:**
- Produces:
```ts
// constants.ts
export const ANR_MS = 5000
export const FRAME_BUDGET_MS = 16.67

// looper.ts
export interface Message { readonly id: number; readonly label: string; readonly costMs: number }
export interface LooperState {
  readonly queue: readonly Message[]
  readonly current: { readonly msg: Message; readonly elapsedMs: number } | null
  readonly processedIds: readonly number[]
  readonly anr: boolean
  readonly nextId: number
}
export function createLooper(): LooperState
export function post(s: LooperState, label: string, costMs: number): LooperState
export function advance(s: LooperState, dtMs: number): LooperState
```

- [ ] **Step 1: Write failing tests**

`tests/sim/looper.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createLooper, post, advance } from '../../src/sim/looper'

describe('looper', () => {
  it('posts messages to queue', () => {
    const s = post(createLooper(), 'click', 4)
    expect(s.queue).toHaveLength(1)
    expect(s.queue[0].label).toBe('click')
  })

  it('does not mutate input state', () => {
    const s0 = createLooper()
    post(s0, 'click', 4)
    expect(s0.queue).toHaveLength(0)
  })

  it('processes a message after its cost elapses', () => {
    let s = post(createLooper(), 'click', 4)
    s = advance(s, 10)
    expect(s.processedIds).toHaveLength(1)
    expect(s.queue).toHaveLength(0)
    expect(s.current).toBeNull()
  })

  it('processes multiple messages within one advance', () => {
    let s = createLooper()
    s = post(s, 'a', 4)
    s = post(s, 'b', 4)
    s = advance(s, 20)
    expect(s.processedIds).toHaveLength(2)
  })

  it('long message occupies current across advances', () => {
    let s = post(createLooper(), 'diskRead', 1000)
    s = advance(s, 100)
    expect(s.current?.msg.label).toBe('diskRead')
    expect(s.current?.elapsedMs).toBe(100)
    expect(s.anr).toBe(false)
  })

  it('flags ANR when one message runs 5000ms+', () => {
    let s = post(createLooper(), 'block', 99999)
    s = advance(s, 5000)
    expect(s.anr).toBe(true)
  })

  it('queue grows behind a blocking message', () => {
    let s = post(createLooper(), 'block', 99999)
    s = advance(s, 100)
    s = post(s, 'tap1', 4)
    s = post(s, 'tap2', 4)
    s = advance(s, 100)
    expect(s.queue).toHaveLength(2)
    expect(s.processedIds).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests, verify FAIL**

Run: `npx vitest run tests/sim/looper.test.ts`
Expected: FAIL: cannot resolve `../../src/sim/looper`.

- [ ] **Step 3: Implement**

`src/sim/constants.ts`:
```ts
export const ANR_MS = 5000
export const FRAME_BUDGET_MS = 16.67
```

`src/sim/looper.ts`:
```ts
import { ANR_MS } from './constants'

export interface Message {
  readonly id: number
  readonly label: string
  readonly costMs: number
}

export interface LooperState {
  readonly queue: readonly Message[]
  readonly current: { readonly msg: Message; readonly elapsedMs: number } | null
  readonly processedIds: readonly number[]
  readonly anr: boolean
  readonly nextId: number
}

export function createLooper(): LooperState {
  return { queue: [], current: null, processedIds: [], anr: false, nextId: 1 }
}

export function post(s: LooperState, label: string, costMs: number): LooperState {
  const msg: Message = { id: s.nextId, label, costMs }
  return { ...s, queue: [...s.queue, msg], nextId: s.nextId + 1 }
}

export function advance(s: LooperState, dtMs: number): LooperState {
  let { queue, current, processedIds } = s
  let remaining = dtMs
  while (remaining > 0) {
    if (!current) {
      if (queue.length === 0) break
      current = { msg: queue[0], elapsedMs: 0 }
      queue = queue.slice(1)
    }
    const need = current.msg.costMs - current.elapsedMs
    const spent = Math.min(need, remaining)
    current = { msg: current.msg, elapsedMs: current.elapsedMs + spent }
    remaining -= spent
    if (current.elapsedMs >= current.msg.costMs) {
      processedIds = [...processedIds, current.msg.id]
      current = null
    }
  }
  const anr = current !== null && current.elapsedMs >= ANR_MS
  return { ...s, queue, current, processedIds, anr }
}
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `npx vitest run tests/sim/looper.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim tests && git commit -m "feat: looper/message-queue sim with ANR detection"
```

---

### Task 3: Scene base, city bootstrap + builders

**Files:**
- Create: `src/scene/city.ts`, `src/scene/builders.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces:
```ts
// city.ts
export interface City {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  start(onFrame: (dtMs: number) => void): void  // starts RAF loop, dtMs capped at 100
}
export function createCity(container: HTMLElement): City

// builders.ts
export function makeBuilding(w: number, h: number, d: number, color: number, label?: string): THREE.Group
export function makeLabel(text: string, scale?: number): THREE.Sprite
export function makeCar(color: number): THREE.Mesh   // small box, 0.6 x 0.4 x 1
```

- [ ] **Step 1: Implement city.ts**

```ts
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface City {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  start(onFrame: (dtMs: number) => void): void
}

export function createCity(container: HTMLElement): City {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0d1117)
  scene.fog = new THREE.Fog(0x0d1117, 60, 140)

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500)
  camera.position.set(18, 16, 18)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(innerWidth, innerHeight)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  container.appendChild(renderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, 2, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const sun = new THREE.DirectionalLight(0xffffff, 1.2)
  sun.position.set(20, 30, 10)
  scene.add(sun)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x161b22 }),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  scene.add(new THREE.GridHelper(200, 100, 0x30363d, 0x21262d))

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  function start(onFrame: (dtMs: number) => void): void {
    let last = performance.now()
    renderer.setAnimationLoop((now) => {
      const dtMs = Math.min(now - last, 100)
      last = now
      onFrame(dtMs)
      controls.update()
      renderer.render(scene, camera)
    })
  }

  return { scene, camera, renderer, start }
}
```

- [ ] **Step 2: Implement builders.ts**

```ts
import * as THREE from 'three'

export function makeLabel(text: string, scale = 1): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.font = 'bold 48px system-ui, sans-serif'
  ctx.fillStyle = '#e6edf3'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 64)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }),
  )
  sprite.scale.set(6 * scale, 1.5 * scale, 1)
  return sprite
}

export function makeBuilding(
  w: number, h: number, d: number, color: number, label?: string,
): THREE.Group {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  )
  body.position.y = h / 2
  body.name = 'body'
  group.add(body)
  if (label) {
    const sprite = makeLabel(label)
    sprite.position.y = h + 1.2
    group.add(sprite)
  }
  return group
}

export function makeCar(color: number): THREE.Mesh {
  const car = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.4, 1),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 }),
  )
  car.position.y = 0.2
  return car
}
```

- [ ] **Step 3: Wire main.ts smoke scene**

```ts
import { createCity } from './scene/city'
import { makeBuilding } from './scene/builders'

const city = createCity(document.querySelector<HTMLDivElement>('#app')!)
city.scene.add(makeBuilding(4, 8, 4, 0x3fb950, 'MainActivity'))
city.start(() => {})
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`, open browser.
Expected: dark city floor with grid, one green building labeled "MainActivity", orbit with mouse works.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: three.js city base + building/label/car builders"
```

---

### Task 4: Scenario framework + switcher UI

**Files:**
- Create: `src/scenarios/types.ts`, `src/ui/panel.ts`
- Modify: `src/main.ts`, `index.html` (style block)

**Interfaces:**
- Produces:
```ts
// scenarios/types.ts
export interface Scenario {
  readonly name: string
  readonly group: THREE.Group          // scene content, added/removed on switch
  readonly panel: HTMLElement          // controls + narration, mounted on switch
  update(dtMs: number): void
  reset(): void
}

// ui/panel.ts
export function makePanel(title: string): { root: HTMLElement; addButton(label: string, onClick: () => void): void; setNarration(text: string): void }
```
- Consumes: `createCity` from Task 3.

- [ ] **Step 1: Implement types.ts**

```ts
import * as THREE from 'three'

export interface Scenario {
  readonly name: string
  readonly group: THREE.Group
  readonly panel: HTMLElement
  update(dtMs: number): void
  reset(): void
}
```

- [ ] **Step 2: Implement panel.ts**

```ts
export interface Panel {
  root: HTMLElement
  addButton(label: string, onClick: () => void): void
  setNarration(text: string): void
}

export function makePanel(title: string): Panel {
  const root = document.createElement('div')
  root.className = 'panel-content'
  const h = document.createElement('h2')
  h.textContent = title
  const buttons = document.createElement('div')
  buttons.className = 'panel-buttons'
  const narration = document.createElement('p')
  narration.className = 'panel-narration'
  root.append(h, buttons, narration)
  return {
    root,
    addButton(label, onClick) {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', onClick)
      buttons.appendChild(b)
    },
    setNarration(text) {
      narration.textContent = text
    },
  }
}
```

- [ ] **Step 3: Rewrite main.ts as switcher**

```ts
import { createCity } from './scene/city'
import type { Scenario } from './scenarios/types'

const city = createCity(document.querySelector<HTMLDivElement>('#app')!)
const switcherEl = document.querySelector<HTMLDivElement>('#switcher')!
const panelEl = document.querySelector<HTMLDivElement>('#panel')!

const scenarios: Scenario[] = [] // populated in later tasks
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
```

- [ ] **Step 4: Add overlay styles to index.html `<head>`**

```html
<style>
  body { margin: 0; overflow: hidden; font-family: system-ui, sans-serif; }
  #switcher { position: fixed; top: 12px; left: 12px; display: flex; gap: 8px; z-index: 10; }
  #panel { position: fixed; bottom: 12px; left: 12px; max-width: 380px; background: rgba(13,17,23,.85); color: #e6edf3; padding: 12px 16px; border-radius: 8px; border: 1px solid #30363d; z-index: 10; }
  #panel h2 { margin: 0 0 8px; font-size: 16px; }
  .panel-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
  .panel-narration { font-size: 13px; color: #8b949e; min-height: 3em; }
  button { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  button:hover { background: #30363d; }
</style>
```

- [ ] **Step 5: Verify + commit**

Run: `npm run dev`. Expected: empty city (no scenarios yet), no console errors. Then:
```bash
git add -A && git commit -m "feat: scenario framework, switcher and control panel UI"
```

---

### Task 5: Scenario 1, Main thread traffic + ANR

**Files:**
- Create: `src/scenarios/mainThread.ts`
- Modify: `src/main.ts` (register scenario)

**Interfaces:**
- Consumes: `createLooper/post/advance` + `LooperState` (Task 2), `makeBuilding/makeCar/makeLabel` (Task 3), `Scenario` + `makePanel` (Task 4).
- Produces: `export function makeMainThreadScenario(): Scenario`

**Visual design:** App building at origin. Straight road (dark plane) leading into it along z-axis. Each queued `Message` = one car waiting on the road; the `current` message = car at the door, sinking slowly into the building as `elapsedMs` grows. Buttons post cheap taps (4ms) or one 8000ms "block main thread" message. ANR = red translucent box flashing over the building + narration.

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three'
import { createLooper, post, advance, type LooperState } from '../sim/looper'
import { makeBuilding, makeCar, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const CAR_SPACING = 1.6
const ROAD_START_Z = 3

export function makeMainThreadScenario(): Scenario {
  const group = new THREE.Group()
  let state: LooperState = createLooper()

  const building = makeBuilding(5, 9, 5, 0x388bfd, 'UI Thread')
  group.add(building)

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 40),
    new THREE.MeshStandardMaterial({ color: 0x21262d }),
  )
  road.rotation.x = -Math.PI / 2
  road.position.set(0, 0.01, ROAD_START_Z + 20)
  group.add(road)

  const roadLabel = makeLabel('MessageQueue', 0.8)
  roadLabel.position.set(3.5, 1, 8)
  group.add(roadLabel)

  const anrOverlay = new THREE.Mesh(
    new THREE.BoxGeometry(6, 10, 6),
    new THREE.MeshBasicMaterial({ color: 0xf85149, transparent: true, opacity: 0 }),
  )
  anrOverlay.position.y = 5
  group.add(anrOverlay)

  const cars = new THREE.Group()
  group.add(cars)
  const carPool = new Map<number, THREE.Mesh>()

  const panel = makePanel('Main Thread = one road into the building')
  panel.addButton('Tap screen (4ms)', () => { state = post(state, 'tap', 4) })
  panel.addButton('Tap x10', () => {
    for (let i = 0; i < 10; i++) state = post(state, 'tap', 4)
  })
  panel.addButton('Block main thread (8s)', () => { state = post(state, 'diskReadOnMain', 8000) })
  panel.setNarration('Every touch, draw and callback is a car on this single road. Post work and watch it flow.')

  function syncCars(): void {
    const wanted = new Set<number>()
    const items = state.current
      ? [state.current.msg, ...state.queue]
      : [...state.queue]
    items.forEach((msg, i) => {
      wanted.add(msg.id)
      let car = carPool.get(msg.id)
      if (!car) {
        car = makeCar(msg.costMs >= 1000 ? 0xf85149 : 0xd29922)
        carPool.set(msg.id, car)
        cars.add(car)
      }
      const isCurrent = state.current?.msg.id === msg.id
      const progress = isCurrent ? state.current!.elapsedMs / msg.costMs : 0
      car.position.z = ROAD_START_Z + i * CAR_SPACING - (isCurrent ? progress * 2 : 0)
      car.position.y = isCurrent ? 0.2 - progress * 0.5 : 0.2
    })
    for (const [id, car] of carPool) {
      if (!wanted.has(id)) {
        cars.remove(car)
        carPool.delete(id)
      }
    }
  }

  let flashT = 0
  return {
    name: 'Main Thread',
    group,
    panel: panel.root,
    update(dtMs) {
      state = advance(state, dtMs)
      syncCars()
      flashT += dtMs
      const mat = anrOverlay.material as THREE.MeshBasicMaterial
      mat.opacity = state.anr ? 0.25 + 0.2 * Math.sin(flashT / 120) : 0
      if (state.anr) {
        panel.setNarration('ANR! One message has held the road for 5+ seconds. The system offers the user "Wait or Close". Fix: move this work off the main thread.')
      } else if (state.queue.length > 3) {
        panel.setNarration(`Traffic jam: ${state.queue.length} messages waiting. Frames rendered late = jank.`)
      }
    },
    reset() {
      state = createLooper()
      syncCars()
    },
  }
}
```

- [ ] **Step 2: Register in main.ts**

Change the scenarios array in `src/main.ts`:
```ts
import { makeMainThreadScenario } from './scenarios/mainThread'

const scenarios: Scenario[] = [makeMainThreadScenario()]
```

- [ ] **Step 3: Verify visually**

Run: `npm run dev`. Expected: blue "UI Thread" building with road. "Tap x10" spawns yellow cars that drain fast. "Block main thread" spawns red car that parks at door; taps queue behind it; after 5s building flashes red + ANR narration.

- [ ] **Step 4: Run full test suite, commit**

```bash
npm test && git add -A && git commit -m "feat: main thread traffic scenario with ANR"
```

---

### Task 6: Lifecycle sim

**Files:**
- Create: `src/sim/lifecycle.ts`
- Test: `tests/sim/lifecycle.test.ts`

**Interfaces:**
- Produces:
```ts
export type Phase = 'destroyed' | 'created' | 'started' | 'resumed' | 'paused' | 'stopped'
export interface ActivityState {
  readonly phase: Phase
  readonly instanceNumber: number        // increments on recreation
  readonly viewModelValue: string | null // survives rotation, dies on finish
  readonly log: readonly string[]        // callback names in order fired
}
export function createActivity(): ActivityState              // phase 'destroyed', instance 0
export function launch(s: ActivityState): ActivityState       // → resumed, logs onCreate/onStart/onResume, sets viewModelValue 'counter=42' if null, instanceNumber+1
export function rotate(s: ActivityState): ActivityState       // full destroy+recreate, viewModel kept, instanceNumber+1
export function finish(s: ActivityState): ActivityState       // → destroyed, viewModel cleared
export function background(s: ActivityState): ActivityState   // resumed → stopped (onPause,onStop)
export function foreground(s: ActivityState): ActivityState   // stopped → resumed (onStart,onResume)
```

- [ ] **Step 1: Write failing tests**

`tests/sim/lifecycle.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createActivity, launch, rotate, finish, background, foreground } from '../../src/sim/lifecycle'

describe('lifecycle', () => {
  it('launch fires onCreate/onStart/onResume', () => {
    const s = launch(createActivity())
    expect(s.phase).toBe('resumed')
    expect(s.log).toEqual(['onCreate', 'onStart', 'onResume'])
    expect(s.instanceNumber).toBe(1)
    expect(s.viewModelValue).toBe('counter=42')
  })

  it('rotate destroys and recreates, keeps ViewModel', () => {
    let s = launch(createActivity())
    s = rotate(s)
    expect(s.phase).toBe('resumed')
    expect(s.instanceNumber).toBe(2)
    expect(s.viewModelValue).toBe('counter=42')
    expect(s.log).toEqual([
      'onCreate', 'onStart', 'onResume',
      'onPause', 'onStop', 'onDestroy',
      'onCreate', 'onStart', 'onResume',
    ])
  })

  it('finish clears ViewModel', () => {
    let s = launch(createActivity())
    s = finish(s)
    expect(s.phase).toBe('destroyed')
    expect(s.viewModelValue).toBeNull()
  })

  it('background/foreground stop and restart without recreation', () => {
    let s = launch(createActivity())
    s = background(s)
    expect(s.phase).toBe('stopped')
    s = foreground(s)
    expect(s.phase).toBe('resumed')
    expect(s.instanceNumber).toBe(1)
  })

  it('rotate on destroyed activity is a no-op', () => {
    const s = rotate(createActivity())
    expect(s.phase).toBe('destroyed')
    expect(s.log).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify FAIL**, `npx vitest run tests/sim/lifecycle.test.ts`, module not found.

- [ ] **Step 3: Implement**

`src/sim/lifecycle.ts`:
```ts
export type Phase = 'destroyed' | 'created' | 'started' | 'resumed' | 'paused' | 'stopped'

export interface ActivityState {
  readonly phase: Phase
  readonly instanceNumber: number
  readonly viewModelValue: string | null
  readonly log: readonly string[]
}

export function createActivity(): ActivityState {
  return { phase: 'destroyed', instanceNumber: 0, viewModelValue: null, log: [] }
}

function fire(s: ActivityState, callbacks: string[], phase: Phase): ActivityState {
  return { ...s, phase, log: [...s.log, ...callbacks] }
}

export function launch(s: ActivityState): ActivityState {
  if (s.phase !== 'destroyed') return s
  const up = fire(s, ['onCreate', 'onStart', 'onResume'], 'resumed')
  return {
    ...up,
    instanceNumber: s.instanceNumber + 1,
    viewModelValue: s.viewModelValue ?? 'counter=42',
  }
}

export function rotate(s: ActivityState): ActivityState {
  if (s.phase !== 'resumed') return s
  const down = fire(s, ['onPause', 'onStop', 'onDestroy'], 'destroyed')
  return launch(down) // viewModelValue non-null → preserved
}

export function finish(s: ActivityState): ActivityState {
  if (s.phase === 'destroyed') return s
  const down = fire(s, ['onPause', 'onStop', 'onDestroy'], 'destroyed')
  return { ...down, viewModelValue: null }
}

export function background(s: ActivityState): ActivityState {
  if (s.phase !== 'resumed') return s
  return fire(s, ['onPause', 'onStop'], 'stopped')
}

export function foreground(s: ActivityState): ActivityState {
  if (s.phase !== 'stopped') return s
  return fire(s, ['onStart', 'onResume'], 'resumed')
}
```

- [ ] **Step 4: Run, verify PASS**, 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: activity lifecycle sim with viewmodel survival"
```

---

### Task 7: Scenario 2, Lifecycle building

**Files:**
- Create: `src/scenarios/lifecycle.ts`
- Modify: `src/main.ts` (register)

**Interfaces:**
- Consumes: Task 6 sim, Task 3 builders, Task 4 framework.
- Produces: `export function makeLifecycleScenario(): Scenario`

**Visual design:** One 3-floor building (floor = box, one per created/started/resumed). Floors light up bottom-to-top as phases advance (emissive green), dim when paused/stopped, whole building collapses (scale y → 0) and rebuilds on rotate. Purple sphere on roof = ViewModel; it floats in place during rebuild. Panel shows callback log tail. Buttons: Launch, Rotate, Home (background), Return (foreground), Finish.

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three'
import { createActivity, launch, rotate, finish, background, foreground, type ActivityState } from '../sim/lifecycle'
import { makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const FLOOR_NAMES = ['onCreate', 'onStart', 'onResume'] as const
const LIT = 0x3fb950
const DIM = 0x21262d

export function makeLifecycleScenario(): Scenario {
  const group = new THREE.Group()
  let state: ActivityState = createActivity()
  let rebuildAnim = 0 // >0 while collapse/rebuild animation runs, counts down ms

  const buildingGroup = new THREE.Group()
  group.add(buildingGroup)
  const floors: THREE.Mesh[] = FLOOR_NAMES.map((name, i) => {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(5, 1.8, 5),
      new THREE.MeshStandardMaterial({ color: DIM, emissive: 0x000000 }),
    )
    floor.position.y = 1 + i * 2
    buildingGroup.add(floor)
    const lbl = makeLabel(name, 0.6)
    lbl.position.set(4.5, 1 + i * 2, 0)
    buildingGroup.add(lbl)
    return floor
  })

  const viewModel = new THREE.Mesh(
    new THREE.SphereGeometry(0.7),
    new THREE.MeshStandardMaterial({ color: 0xbc8cff, emissive: 0xbc8cff, emissiveIntensity: 0.4 }),
  )
  viewModel.position.y = 7.5
  viewModel.visible = false
  group.add(viewModel)
  const vmLabel = makeLabel('ViewModel', 0.6)
  vmLabel.position.y = 9
  vmLabel.visible = false
  group.add(vmLabel)

  const panel = makePanel('Activity lifecycle = floors of a building')
  panel.addButton('Launch', () => { state = launch(state) })
  panel.addButton('Rotate', () => {
    if (state.phase === 'resumed') rebuildAnim = 1200
    state = rotate(state)
  })
  panel.addButton('Home', () => { state = background(state) })
  panel.addButton('Return', () => { state = foreground(state) })
  panel.addButton('Finish', () => { state = finish(state) })
  panel.setNarration('Launch the activity. Each lifecycle callback lights a floor.')

  function litCount(): number {
    switch (state.phase) {
      case 'resumed': return 3
      case 'started': case 'paused': return 2
      case 'created': case 'stopped': return 1
      default: return 0
    }
  }

  return {
    name: 'Lifecycle',
    group,
    panel: panel.root,
    update(dtMs) {
      if (rebuildAnim > 0) {
        rebuildAnim = Math.max(0, rebuildAnim - dtMs)
        // 1200→600ms: collapse to 0; 600→0ms: rebuild to 1
        const t = rebuildAnim > 600 ? (rebuildAnim - 600) / 600 : 1 - rebuildAnim / 600
        buildingGroup.scale.y = t
      } else {
        buildingGroup.scale.y = 1
      }
      const lit = litCount()
      floors.forEach((f, i) => {
        const mat = f.material as THREE.MeshStandardMaterial
        const on = i < lit
        mat.color.setHex(on ? LIT : DIM)
        mat.emissive.setHex(on ? LIT : 0x000000)
        mat.emissiveIntensity = on ? 0.35 : 0
      })
      viewModel.visible = state.viewModelValue !== null
      vmLabel.visible = viewModel.visible
      const tail = state.log.slice(-6).join(' → ')
      if (tail) panel.setNarration(`instance #${state.instanceNumber} · ${tail}${state.viewModelValue ? ' · ViewModel survives on the roof' : ''}`)
    },
    reset() {
      state = createActivity()
      rebuildAnim = 0
    },
  }
}
```

- [ ] **Step 2: Register**, add `makeLifecycleScenario()` to the scenarios array in `src/main.ts`.

- [ ] **Step 3: Verify visually**

Expected: Launch lights 3 floors bottom-up + purple ViewModel sphere appears. Rotate collapses/rebuilds building, sphere never disappears, narration shows full callback chain and `instance #2`. Home dims top floors, Return re-lights. Finish darkens all + sphere gone.

- [ ] **Step 4: Commit**

```bash
npm test && git add -A && git commit -m "feat: lifecycle scenario with rotation rebuild + viewmodel roof"
```

---

### Task 8: Frame pipeline sim

**Files:**
- Create: `src/sim/framePipeline.ts`
- Test: `tests/sim/framePipeline.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Stage { readonly name: string; readonly costMs: number }
export const DEFAULT_STAGES: readonly Stage[]  // input 1, animation 1, measure/layout 2, draw 2, renderThread 3, gpu 3, surfaceFlinger 2  (total 14, under budget)
export interface FrameRun {
  readonly stages: readonly Stage[]
  readonly elapsedMs: number          // progress into the run
  readonly totalMs: number
  readonly done: boolean
  readonly dropped: boolean           // totalMs > FRAME_BUDGET_MS
  readonly currentStageIndex: number  // -1 when done
  readonly stageProgress: number      // 0..1 within current stage
}
export function startFrame(stages?: readonly Stage[]): FrameRun
export function advanceFrame(run: FrameRun, dtMs: number): FrameRun
export function withHeavyDraw(stages: readonly Stage[], drawCostMs: number): readonly Stage[]  // returns copy with 'draw' stage cost replaced
```

- [ ] **Step 1: Write failing tests**

`tests/sim/framePipeline.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { startFrame, advanceFrame, withHeavyDraw, DEFAULT_STAGES } from '../../src/sim/framePipeline'

describe('framePipeline', () => {
  it('default stages fit the 16.67ms budget', () => {
    const run = startFrame()
    expect(run.totalMs).toBeLessThan(16.67)
    expect(run.dropped).toBe(false)
    expect(run.currentStageIndex).toBe(0)
  })

  it('advances through stages in order', () => {
    let run = startFrame()
    run = advanceFrame(run, 1) // input done
    expect(run.currentStageIndex).toBe(1)
    run = advanceFrame(run, 1) // animation done
    expect(run.currentStageIndex).toBe(2)
  })

  it('completes after total cost', () => {
    let run = startFrame()
    run = advanceFrame(run, run.totalMs)
    expect(run.done).toBe(true)
    expect(run.currentStageIndex).toBe(-1)
  })

  it('heavy draw blows the budget and marks dropped', () => {
    const run = startFrame(withHeavyDraw(DEFAULT_STAGES, 20))
    expect(run.totalMs).toBeGreaterThan(16.67)
    expect(run.dropped).toBe(true)
  })

  it('stageProgress is fractional mid-stage', () => {
    let run = startFrame() // input costs 1ms
    run = advanceFrame(run, 0.5)
    expect(run.currentStageIndex).toBe(0)
    expect(run.stageProgress).toBeCloseTo(0.5)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**, module not found.

- [ ] **Step 3: Implement**

`src/sim/framePipeline.ts`:
```ts
import { FRAME_BUDGET_MS } from './constants'

export interface Stage { readonly name: string; readonly costMs: number }

export const DEFAULT_STAGES: readonly Stage[] = [
  { name: 'input', costMs: 1 },
  { name: 'animation', costMs: 1 },
  { name: 'measure/layout', costMs: 2 },
  { name: 'draw', costMs: 2 },
  { name: 'renderThread', costMs: 3 },
  { name: 'gpu', costMs: 3 },
  { name: 'surfaceFlinger', costMs: 2 },
]

export interface FrameRun {
  readonly stages: readonly Stage[]
  readonly elapsedMs: number
  readonly totalMs: number
  readonly done: boolean
  readonly dropped: boolean
  readonly currentStageIndex: number
  readonly stageProgress: number
}

function locate(stages: readonly Stage[], elapsedMs: number): { index: number; progress: number } {
  let acc = 0
  for (let i = 0; i < stages.length; i++) {
    if (elapsedMs < acc + stages[i].costMs) {
      return { index: i, progress: (elapsedMs - acc) / stages[i].costMs }
    }
    acc += stages[i].costMs
  }
  return { index: -1, progress: 0 }
}

export function startFrame(stages: readonly Stage[] = DEFAULT_STAGES): FrameRun {
  const totalMs = stages.reduce((sum, s) => sum + s.costMs, 0)
  return {
    stages,
    elapsedMs: 0,
    totalMs,
    done: false,
    dropped: totalMs > FRAME_BUDGET_MS,
    currentStageIndex: 0,
    stageProgress: 0,
  }
}

export function advanceFrame(run: FrameRun, dtMs: number): FrameRun {
  const elapsedMs = Math.min(run.elapsedMs + dtMs, run.totalMs)
  const done = elapsedMs >= run.totalMs
  const { index, progress } = done ? { index: -1, progress: 0 } : locate(run.stages, elapsedMs)
  return { ...run, elapsedMs, done, currentStageIndex: index, stageProgress: progress }
}

export function withHeavyDraw(stages: readonly Stage[], drawCostMs: number): readonly Stage[] {
  return stages.map((s) => (s.name === 'draw' ? { ...s, costMs: drawCostMs } : s))
}
```

- [ ] **Step 4: Run, verify PASS**, 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: touch-to-pixel frame pipeline sim"
```

---

### Task 9: Scenario 3, Touch to pixel assembly line

**Files:**
- Create: `src/scenarios/touchPipeline.ts`
- Modify: `src/main.ts` (register)

**Interfaces:**
- Consumes: Task 8 sim, Tasks 3-4.
- Produces: `export function makeTouchPipelineScenario(): Scenario`

**Visual design:** 7 small station buildings in a row (one per stage), glowing cyan packet sphere hops station to station as the frame advances (slowed 200x so 14ms reads as ~3s). A vertical bar at the end = the screen; it flashes green when frame lands in budget, red when dropped. Buttons: "Tap (normal frame)", "Tap (heavy draw 20ms)". Budget clock bar above stations fills over 16.67 sim-ms.

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three'
import { startFrame, advanceFrame, withHeavyDraw, DEFAULT_STAGES, type FrameRun } from '../sim/framePipeline'
import { FRAME_BUDGET_MS } from '../sim/constants'
import { makeBuilding, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const SLOWDOWN = 200 // 1 sim-ms rendered over 200 real-ms
const STATION_GAP = 4

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
  panel.setNarration('Tap. The touch packet must pass every station before the deadline, or the frame drops.')

  let resultFlash = 0
  return {
    name: 'Touch → Pixel',
    group,
    panel: panel.root,
    update(dtMs) {
      const screenMat = screen.material as THREE.MeshStandardMaterial
      if (run && !run.done) {
        run = advanceFrame(run, dtMs / SLOWDOWN)
        packet.visible = true
        const i = run.currentStageIndex
        if (i >= 0) {
          const x0 = (i - 3) * STATION_GAP
          packet.position.set(x0 + run.stageProgress * STATION_GAP * 0.8, 4, 0)
          panel.setNarration(`${run.stages[i].name} · ${run.elapsedMs.toFixed(1)} / ${FRAME_BUDGET_MS} ms${run.dropped ? ' · WILL MISS DEADLINE' : ''}`)
        }
        budgetBar.visible = true
        const frac = Math.min(run.elapsedMs / FRAME_BUDGET_MS, 1)
        budgetBar.scale.x = 1 + frac * 20
        ;(budgetBar.material as THREE.MeshBasicMaterial).color.setHex(
          run.elapsedMs > FRAME_BUDGET_MS ? 0xf85149 : 0x3fb950,
        )
        if (run.done) {
          resultFlash = 800
          panel.setNarration(run.dropped
            ? `Frame took ${run.totalMs.toFixed(1)}ms: deadline missed, frame dropped. User sees jank.`
            : `Frame delivered in ${run.totalMs.toFixed(1)}ms, under budget. Smooth.`)
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
    },
  }
}
```

- [ ] **Step 2: Register**, add `makeTouchPipelineScenario()` to scenarios array.

- [ ] **Step 3: Verify visually**

Expected: 7 stations in a row. Normal tap: packet hops all stations in ~3s, budget bar stays green, display flashes green. Heavy draw: packet stalls long at `draw`, bar turns red mid-run, display flashes red, narration says dropped.

- [ ] **Step 4: Commit**

```bash
npm test && git add -A && git commit -m "feat: touch-to-pixel assembly line scenario"
```

---

### Task 10: Process sim, Zygote fork + LMK

**Files:**
- Create: `src/sim/processes.ts`
- Test: `tests/sim/processes.test.ts`

**Interfaces:**
- Produces:
```ts
export type Priority = 'foreground' | 'visible' | 'service' | 'cached'
export const KILL_ORDER: readonly Priority[]  // ['cached','service','visible','foreground'], LMK kills cached first
export interface Proc {
  readonly pid: number
  readonly name: string
  readonly priority: Priority
  readonly memoryMb: number
}
export interface SystemState {
  readonly procs: readonly Proc[]
  readonly nextPid: number
  readonly capacityMb: number
  readonly killedPids: readonly number[]  // cumulative, for animation
}
export function createSystem(capacityMb: number): SystemState
export function usedMb(s: SystemState): number
export function fork(s: SystemState, name: string, priority: Priority, memoryMb: number): SystemState
  // If capacity would overflow, LMK reclaims (kills lowest-priority, oldest-first) until it fits, then forks.
  // Never kills 'foreground'. If still no room, returns state unchanged except nothing forked.
export function setPriority(s: SystemState, pid: number, priority: Priority): SystemState
```

- [ ] **Step 1: Write failing tests**

`tests/sim/processes.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createSystem, fork, setPriority, usedMb } from '../../src/sim/processes'

describe('processes', () => {
  it('forks a process with incrementing pid', () => {
    let s = createSystem(1000)
    s = fork(s, 'com.app.chat', 'foreground', 300)
    expect(s.procs).toHaveLength(1)
    expect(s.procs[0].pid).toBe(1)
    expect(usedMb(s)).toBe(300)
  })

  it('LMK kills cached processes first when memory is tight', () => {
    let s = createSystem(1000)
    s = fork(s, 'chat', 'cached', 400)
    s = fork(s, 'maps', 'service', 400)
    s = fork(s, 'game', 'foreground', 500) // needs 300 reclaimed → kills cached 'chat'
    expect(s.procs.map(p => p.name)).toEqual(['maps', 'game'])
    expect(s.killedPids).toEqual([1])
  })

  it('kills multiple, oldest cached first', () => {
    let s = createSystem(1000)
    s = fork(s, 'a', 'cached', 300)
    s = fork(s, 'b', 'cached', 300)
    s = fork(s, 'c', 'cached', 300)
    s = fork(s, 'big', 'foreground', 800) // must kill a and b and c? 900 used, need 700 free → kill a,b,c
    expect(s.killedPids).toEqual([1, 2, 3])
    expect(s.procs.map(p => p.name)).toEqual(['big'])
  })

  it('never kills foreground; fork fails if only foreground remains', () => {
    let s = createSystem(1000)
    s = fork(s, 'game', 'foreground', 900)
    s = fork(s, 'huge', 'visible', 500) // cannot reclaim → no fork
    expect(s.procs.map(p => p.name)).toEqual(['game'])
  })

  it('setPriority changes kill eligibility', () => {
    let s = createSystem(1000)
    s = fork(s, 'chat', 'foreground', 400)
    s = setPriority(s, 1, 'cached') // user pressed Home
    s = fork(s, 'game', 'foreground', 900)
    expect(s.killedPids).toEqual([1])
  })
})
```

- [ ] **Step 2: Run, verify FAIL**, module not found.

- [ ] **Step 3: Implement**

`src/sim/processes.ts`:
```ts
export type Priority = 'foreground' | 'visible' | 'service' | 'cached'
export const KILL_ORDER: readonly Priority[] = ['cached', 'service', 'visible', 'foreground']

export interface Proc {
  readonly pid: number
  readonly name: string
  readonly priority: Priority
  readonly memoryMb: number
}

export interface SystemState {
  readonly procs: readonly Proc[]
  readonly nextPid: number
  readonly capacityMb: number
  readonly killedPids: readonly number[]
}

export function createSystem(capacityMb: number): SystemState {
  return { procs: [], nextPid: 1, capacityMb, killedPids: [] }
}

export function usedMb(s: SystemState): number {
  return s.procs.reduce((sum, p) => sum + p.memoryMb, 0)
}

function reclaim(s: SystemState, neededMb: number): SystemState {
  let procs = [...s.procs]
  let killed = [...s.killedPids]
  for (const tier of KILL_ORDER) {
    if (tier === 'foreground') break
    // oldest first within a tier = lowest pid first
    const victims = procs.filter(p => p.priority === tier).sort((a, b) => a.pid - b.pid)
    for (const v of victims) {
      if (s.capacityMb - procs.reduce((sum, p) => sum + p.memoryMb, 0) >= neededMb) break
      procs = procs.filter(p => p.pid !== v.pid)
      killed = [...killed, v.pid]
    }
  }
  return { ...s, procs, killedPids: killed }
}

export function fork(s: SystemState, name: string, priority: Priority, memoryMb: number): SystemState {
  let next = s
  if (usedMb(next) + memoryMb > next.capacityMb) {
    next = reclaim(next, memoryMb - (next.capacityMb - usedMb(next)))
  }
  if (usedMb(next) + memoryMb > next.capacityMb) return next // still no room
  const proc: Proc = { pid: next.nextPid, name, priority, memoryMb }
  return { ...next, procs: [...next.procs, proc], nextPid: next.nextPid + 1 }
}

export function setPriority(s: SystemState, pid: number, priority: Priority): SystemState {
  return { ...s, procs: s.procs.map(p => (p.pid === pid ? { ...p, priority } : p)) }
}
```

- [ ] **Step 4: Run, verify PASS**, 5 passed. (Check test 3 math: capacity 1000, a+b+c=900 used, big needs 800 → free is 100, need 700 more; killing a (300) → 400 free, still short; kill b → 700 free, short of 800? 700 < 800 → kill c → 1000 free. All three killed. Correct.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: zygote fork + LMK reclaim sim"
```

---

### Task 11: Scenario 4, Zygote district

**Files:**
- Create: `src/scenarios/zygote.ts`
- Modify: `src/main.ts` (register)

**Interfaces:**
- Consumes: Task 10 sim, Tasks 3-4.
- Produces: `export function makeZygoteScenario(): Scenario`

**Visual design:** Zygote factory building (grey, wide) on the left. Each `fork` slides a new app building out of the factory to its slot in a grid. Building color = priority (foreground green, visible blue, service yellow, cached grey). Memory meter = tall thin bar, fills with `usedMb/capacityMb`, turns red above 80%. LMK kill = building shrinks to 0 and disappears. Buttons: "Launch app (300MB)", "Home (foreground→cached)", "Launch big game (600MB)". Capacity 1500MB.

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three'
import { createSystem, fork, setPriority, usedMb, type SystemState, type Priority } from '../sim/processes'
import { makeBuilding, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const PRIORITY_COLOR: Record<Priority, number> = {
  foreground: 0x3fb950, visible: 0x388bfd, service: 0xd29922, cached: 0x6e7681,
}
const APP_NAMES = ['chat', 'maps', 'camera', 'music', 'mail', 'bank', 'browser']
const CAPACITY_MB = 1500

export function makeZygoteScenario(): Scenario {
  const group = new THREE.Group()
  let state: SystemState = createSystem(CAPACITY_MB)
  let appIndex = 0

  const factory = makeBuilding(8, 4, 6, 0x484f58, 'Zygote')
  factory.position.set(-14, 0, 0)
  group.add(factory)

  const meter = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x3fb950 }),
  )
  meter.position.set(14, 0.5, -6)
  group.add(meter)
  const meterLabel = makeLabel('RAM', 0.7)
  meterLabel.position.set(14, 12, -6)
  group.add(meterLabel)

  const buildings = new Map<number, THREE.Group>() // pid → mesh group
  const dying = new Map<number, THREE.Group>()     // pid → shrinking

  function slotPosition(i: number): THREE.Vector3 {
    return new THREE.Vector3((i % 3) * 6 - 4, 0, Math.floor(i / 3) * 6 - 4)
  }

  const panel = makePanel('Zygote forks apps · LMK evicts by priority')
  panel.addButton('Launch app (300MB)', () => {
    const name = APP_NAMES[appIndex++ % APP_NAMES.length]
    state = fork(state, name, 'foreground', 300)
  })
  panel.addButton('Home (foreground → cached)', () => {
    state = state.procs.reduce(
      (acc, p) => (p.priority === 'foreground' ? setPriority(acc, p.pid, 'cached') : acc),
      state,
    )
  })
  panel.addButton('Launch big game (600MB)', () => { state = fork(state, 'game', 'foreground', 600) })
  panel.setNarration('Zygote is a pre-warmed process factory: every app is forked from it, sharing framework memory.')

  return {
    name: 'Zygote & LMK',
    group,
    panel: panel.root,
    update(dtMs) {
      // spawn/update buildings from state
      state.procs.forEach((p, i) => {
        let b = buildings.get(p.pid)
        if (!b) {
          b = makeBuilding(3, 2 + p.memoryMb / 150, 3, PRIORITY_COLOR[p.priority], p.name)
          b.position.copy(factory.position) // slides out of factory
          buildings.set(p.pid, b)
          group.add(b)
        }
        b.position.lerp(slotPosition(i), Math.min(dtMs / 300, 1))
        const body = b.getObjectByName('body') as THREE.Mesh
        ;(body.material as THREE.MeshStandardMaterial).color.setHex(PRIORITY_COLOR[p.priority])
      })
      // detect kills
      for (const [pid, b] of buildings) {
        if (!state.procs.some(p => p.pid === pid)) {
          buildings.delete(pid)
          dying.set(pid, b)
        }
      }
      for (const [pid, b] of dying) {
        b.scale.y = Math.max(b.scale.y - dtMs / 400, 0)
        if (b.scale.y === 0) {
          group.remove(b)
          dying.delete(pid)
          panel.setNarration('LMK killed a cached process to free memory. Its saved state lets it restore later, this is why onSaveInstanceState matters.')
        }
      }
      const frac = usedMb(state) / CAPACITY_MB
      meter.scale.y = 1 + frac * 10
      meter.position.y = meter.scale.y / 2
      ;(meter.material as THREE.MeshStandardMaterial).color.setHex(frac > 0.8 ? 0xf85149 : 0x3fb950)
    },
    reset() {
      for (const b of [...buildings.values(), ...dying.values()]) group.remove(b)
      buildings.clear()
      dying.clear()
      state = createSystem(CAPACITY_MB)
      appIndex = 0
    },
  }
}
```

- [ ] **Step 2: Register**, add `makeZygoteScenario()` to scenarios array.

- [ ] **Step 3: Verify visually**

Expected: launch 4 apps → buildings slide out of Zygote, all green. Press Home → grey. Launch big game → RAM meter red, oldest grey building shrinks away, narration explains LMK.

- [ ] **Step 4: Commit**

```bash
npm test && git add -A && git commit -m "feat: zygote fork + LMK district scenario"
```

---

### Task 12: Heap/GC sim

**Files:**
- Create: `src/sim/heap.ts`
- Test: `tests/sim/heap.test.ts`

**Interfaces:**
- Produces:
```ts
export interface HeapObject { readonly id: number; readonly sizeKb: number; readonly reachable: boolean }
export interface HeapState {
  readonly objects: readonly HeapObject[]
  readonly capacityKb: number
  readonly nextId: number
  readonly gcCount: number
  readonly lastFreedKb: number
}
export function createHeap(capacityKb: number): HeapState
export function usedKb(s: HeapState): number
export function allocate(s: HeapState, sizeKb: number): { state: HeapState; gcRan: boolean }
  // If it doesn't fit, run gc() first (gcRan true). If still no fit after GC → OutOfMemory: throw Error('OutOfMemoryError')
export function release(s: HeapState, id: number): HeapState        // mark unreachable
export function releaseOldest(s: HeapState, count: number): HeapState // mark oldest N reachable objects unreachable
export function gc(s: HeapState): HeapState                          // sweep unreachable, gcCount+1, lastFreedKb set
```

- [ ] **Step 1: Write failing tests**

`tests/sim/heap.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createHeap, allocate, release, releaseOldest, gc, usedKb } from '../../src/sim/heap'

describe('heap', () => {
  it('allocates while capacity remains', () => {
    const { state, gcRan } = allocate(createHeap(1000), 200)
    expect(usedKb(state)).toBe(200)
    expect(gcRan).toBe(false)
  })

  it('gc sweeps only unreachable objects', () => {
    let s = allocate(createHeap(1000), 200).state
    s = allocate(s, 300).state
    s = release(s, 1)
    s = gc(s)
    expect(usedKb(s)).toBe(300)
    expect(s.lastFreedKb).toBe(200)
    expect(s.gcCount).toBe(1)
    expect(s.objects.map(o => o.id)).toEqual([2])
  })

  it('allocation pressure triggers gc automatically', () => {
    let s = allocate(createHeap(500), 300).state
    s = release(s, 1)
    const result = allocate(s, 400) // 300 used, needs gc to fit
    expect(result.gcRan).toBe(true)
    expect(usedKb(result.state)).toBe(400)
  })

  it('throws OutOfMemoryError when gc cannot free enough', () => {
    const s = allocate(createHeap(500), 400).state // reachable, can't be freed
    expect(() => allocate(s, 300)).toThrow('OutOfMemoryError')
  })

  it('releaseOldest marks oldest N unreachable', () => {
    let s = allocate(createHeap(1000), 100).state
    s = allocate(s, 100).state
    s = allocate(s, 100).state
    s = releaseOldest(s, 2)
    expect(s.objects.filter(o => !o.reachable).map(o => o.id)).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: Run, verify FAIL**, module not found.

- [ ] **Step 3: Implement**

`src/sim/heap.ts`:
```ts
export interface HeapObject { readonly id: number; readonly sizeKb: number; readonly reachable: boolean }

export interface HeapState {
  readonly objects: readonly HeapObject[]
  readonly capacityKb: number
  readonly nextId: number
  readonly gcCount: number
  readonly lastFreedKb: number
}

export function createHeap(capacityKb: number): HeapState {
  return { objects: [], capacityKb, nextId: 1, gcCount: 0, lastFreedKb: 0 }
}

export function usedKb(s: HeapState): number {
  return s.objects.reduce((sum, o) => sum + o.sizeKb, 0)
}

export function gc(s: HeapState): HeapState {
  const survivors = s.objects.filter(o => o.reachable)
  const freed = usedKb(s) - survivors.reduce((sum, o) => sum + o.sizeKb, 0)
  return { ...s, objects: survivors, gcCount: s.gcCount + 1, lastFreedKb: freed }
}

export function allocate(s: HeapState, sizeKb: number): { state: HeapState; gcRan: boolean } {
  let state = s
  let gcRan = false
  if (usedKb(state) + sizeKb > state.capacityKb) {
    state = gc(state)
    gcRan = true
  }
  if (usedKb(state) + sizeKb > state.capacityKb) throw new Error('OutOfMemoryError')
  const obj: HeapObject = { id: state.nextId, sizeKb, reachable: true }
  return { state: { ...state, objects: [...state.objects, obj], nextId: state.nextId + 1 }, gcRan }
}

export function release(s: HeapState, id: number): HeapState {
  return { ...s, objects: s.objects.map(o => (o.id === id ? { ...o, reachable: false } : o)) }
}

export function releaseOldest(s: HeapState, count: number): HeapState {
  const targets = s.objects.filter(o => o.reachable).slice(0, count).map(o => o.id)
  return { ...s, objects: s.objects.map(o => (targets.includes(o.id) ? { ...o, reachable: false } : o)) }
}
```

- [ ] **Step 4: Run, verify PASS**, 5 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: heap allocation + gc sim"
```

---

### Task 13: Scenario 5, GC cleanup crew

**Files:**
- Create: `src/scenarios/gc.ts`
- Modify: `src/main.ts` (register)

**Interfaces:**
- Consumes: Task 12 sim, Tasks 3-4.
- Produces: `export function makeGcScenario(): Scenario`

**Visual design:** One warehouse floor (flat 12×12 platform). Each `HeapObject` = crate (box) on a grid; reachable = solid green, unreachable = fades to translucent grey ("garbage"). GC = orange sweep plane crossing the floor left-to-right over ~1s; garbage crates it passes vanish. Heap meter bar on the side. Buttons: "Allocate 100KB", "Allocate 10 (bitmap burst)", "Drop references (oldest 5)", "Force GC". Auto-GC on pressure happens through the sim; narration reports pause + freed. Capacity 2000KB.

- [ ] **Step 1: Implement**

```ts
import * as THREE from 'three'
import { createHeap, allocate, releaseOldest, gc, usedKb, type HeapState } from '../sim/heap'
import { makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Scenario } from './types'

const CAPACITY_KB = 2000
const GRID = 6 // 6x6 crate slots

export function makeGcScenario(): Scenario {
  const group = new THREE.Group()
  let state: HeapState = createHeap(CAPACITY_KB)
  let sweepX: number | null = null // x position of sweep plane while animating

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(13, 0.3, 13),
    new THREE.MeshStandardMaterial({ color: 0x30363d }),
  )
  floor.position.y = 0.15
  group.add(floor)
  const floorLabel = makeLabel('App Heap', 0.9)
  floorLabel.position.y = 6
  group.add(floorLabel)

  const sweep = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 3, 13),
    new THREE.MeshBasicMaterial({ color: 0xdb6d28, transparent: true, opacity: 0.6 }),
  )
  sweep.position.y = 1.8
  sweep.visible = false
  group.add(sweep)

  const meter = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x3fb950 }),
  )
  meter.position.set(9, 0.5, 0)
  group.add(meter)

  const crates = new Map<number, THREE.Mesh>()

  function slot(i: number): THREE.Vector3 {
    return new THREE.Vector3((i % GRID) * 2 - 5, 0.8, Math.floor(i / GRID) * 2 - 5)
  }

  const panel = makePanel('GC = cleanup crew sweeping the heap floor')

  function tryAllocate(sizeKb: number, times = 1): void {
    try {
      for (let t = 0; t < times; t++) {
        const before = state.gcCount
        const result = allocate(state, sizeKb)
        state = result.state
        if (result.gcRan) {
          sweepX = -7
          panel.setNarration(`Allocation didn't fit: GC #${state.gcCount} ran first, freed ${state.lastFreedKb}KB. On old Android this paused ALL threads; ART keeps pauses sub-ms.`)
          void before
        }
      }
    } catch {
      panel.setNarration('OutOfMemoryError! GC ran but everything is still reachable, nothing to free. This is a leak: references held to objects you no longer need.')
    }
  }

  panel.addButton('Allocate 100KB', () => tryAllocate(100))
  panel.addButton('Bitmap burst (10×100KB)', () => tryAllocate(100, 10))
  panel.addButton('Drop refs (oldest 5)', () => { state = releaseOldest(state, 5) })
  panel.addButton('Force GC', () => {
    state = gc(state)
    sweepX = -7
    panel.setNarration(`GC #${state.gcCount} freed ${state.lastFreedKb}KB.`)
  })
  panel.setNarration('Crates = objects. Green = reachable. Grey = garbage (unreachable), still occupying memory until GC sweeps.')

  return {
    name: 'Garbage Collector',
    group,
    panel: panel.root,
    update(dtMs) {
      // sync crates
      const ids = new Set(state.objects.map(o => o.id))
      state.objects.forEach((o, i) => {
        let crate = crates.get(o.id)
        if (!crate) {
          crate = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 1.4, 1.4),
            new THREE.MeshStandardMaterial({ color: 0x3fb950, transparent: true }),
          )
          crates.set(o.id, crate)
          group.add(crate)
        }
        crate.position.copy(slot(i))
        const mat = crate.material as THREE.MeshStandardMaterial
        mat.color.setHex(o.reachable ? 0x3fb950 : 0x6e7681)
        mat.opacity = o.reachable ? 1 : 0.4
      })
      for (const [id, crate] of crates) {
        if (!ids.has(id)) {
          // swept: only remove once sweep plane has passed its x (or no sweep running)
          if (sweepX === null || crate.position.x < sweepX) {
            group.remove(crate)
            crates.delete(id)
          }
        }
      }
      // sweep animation
      if (sweepX !== null) {
        sweepX += (dtMs / 1000) * 14
        sweep.visible = true
        sweep.position.x = sweepX
        if (sweepX > 7) {
          sweepX = null
          sweep.visible = false
        }
      }
      const frac = usedKb(state) / CAPACITY_KB
      meter.scale.y = 1 + frac * 8
      meter.position.y = meter.scale.y / 2
      ;(meter.material as THREE.MeshStandardMaterial).color.setHex(frac > 0.8 ? 0xf85149 : 0x3fb950)
    },
    reset() {
      for (const c of crates.values()) group.remove(c)
      crates.clear()
      state = createHeap(CAPACITY_KB)
      sweepX = null
      sweep.visible = false
    },
  }
}
```

- [ ] **Step 2: Register**, add `makeGcScenario()` to scenarios array.

- [ ] **Step 3: Verify visually**

Expected: allocate → green crates fill floor + meter rises. Drop refs → 5 crates grey/translucent. Force GC → orange plane sweeps, grey crates vanish, meter drops. Bitmap bursts until full with everything reachable → OOM narration.

- [ ] **Step 4: Commit**

```bash
npm test && git add -A && git commit -m "feat: gc cleanup crew scenario"
```

---

### Task 14: Polish pass, intro overlay + camera framing per scenario

**Files:**
- Modify: `src/scenarios/types.ts`, `src/main.ts`, `index.html`

**Interfaces:**
- Modifies `Scenario`: add `readonly cameraPos: THREE.Vector3` and `readonly cameraTarget: THREE.Vector3` fields. Each scenario factory (Tasks 5,7,9,11,13) gets two added lines in its returned object, values below.

- [ ] **Step 1: Extend Scenario interface**

In `src/scenarios/types.ts` add to the interface:
```ts
  readonly cameraPos: THREE.Vector3
  readonly cameraTarget: THREE.Vector3
```

- [ ] **Step 2: Add camera fields to every scenario**

Add to each returned scenario object:
- mainThread: `cameraPos: new THREE.Vector3(14, 12, 26), cameraTarget: new THREE.Vector3(0, 3, 8)`
- lifecycle: `cameraPos: new THREE.Vector3(12, 8, 14), cameraTarget: new THREE.Vector3(0, 4, 0)`
- touchPipeline: `cameraPos: new THREE.Vector3(0, 14, 30), cameraTarget: new THREE.Vector3(2, 3, 0)`
- zygote: `cameraPos: new THREE.Vector3(2, 18, 24), cameraTarget: new THREE.Vector3(0, 2, 0)`
- gc: `cameraPos: new THREE.Vector3(10, 12, 14), cameraTarget: new THREE.Vector3(0, 1, 0)`
(Each file already imports `* as THREE`.)

- [ ] **Step 3: Fly camera on switch**

In `src/main.ts` `activate()`, after `panelEl.replaceChildren(...)` add:
```ts
  city.camera.position.copy(s.cameraPos)
  city.controls.target.copy(s.cameraTarget)
```
This requires exposing controls: in `src/scene/city.ts` add `controls` to the `City` interface (`controls: OrbitControls`) and to the returned object.

- [ ] **Step 4: Intro overlay**

In `index.html`, add inside `<body>` before `#app`:
```html
<div id="intro">
  <h1>DroidCity</h1>
  <p>A working model of how an Android app runs: as a city. Pick a district up top; press the buttons; watch what the OS does. Early prototype: expect inaccuracies, corrections welcome.</p>
  <button id="intro-close">Explore</button>
</div>
```
Style in the existing `<style>` block:
```html
#intro { position: fixed; inset: 0; display: grid; place-content: center; text-align: center; background: rgba(1,4,9,.8); color: #e6edf3; z-index: 20; padding: 24px; }
#intro p { max-width: 480px; color: #8b949e; }
```
In `src/main.ts`:
```ts
document.querySelector('#intro-close')!.addEventListener('click', () => {
  document.querySelector<HTMLDivElement>('#intro')!.style.display = 'none'
})
```

- [ ] **Step 5: Verify + commit**

All 5 scenarios reachable from switcher, camera reframes on switch, intro shows once.
```bash
npm test && npm run build && git add -A && git commit -m "feat: intro overlay + per-scenario camera framing"
```

---

### Task 15: README + GitHub Pages deploy

**Files:**
- Create: `README.md`, `.github/workflows/deploy.yml`

- [ ] **Step 1: README.md**

```markdown
# DroidCity

How an Android app runs, as an explorable 3D city. Inspired by [PGSimCity](https://nikolays.github.io/PGSimCity/).

**Districts:** Main Thread (Looper traffic + ANR) · Activity Lifecycle (rotation rebuild, ViewModel roof) · Touch→Pixel (frame pipeline, 16.67ms deadline) · Zygote & LMK (process fork + eviction) · Garbage Collector (heap sweep).

Early prototype: the model simplifies aggressively and surely contains inaccuracies. Issues/PRs welcome.

## Dev

    npm install
    npm run dev    # local
    npm test       # sim unit tests
    npm run build  # static build in dist/
```

- [ ] **Step 2: Deploy workflow**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Create repo + push**

```bash
gh repo create droidcity --public --source . --push
```
Then enable Pages (source: GitHub Actions) via `gh api repos/{owner}/droidcity/pages -X POST -f build_type=workflow` (or repo Settings → Pages if API call fails).

- [ ] **Step 4: Verify deployed site loads, commit any fixes**

```bash
git add -A && git commit -m "chore: readme + gh-pages deploy" && git push
```

---

## Self-Review Notes

- **Spec coverage:** 5 chosen scenarios ↔ Tasks 5, 7, 9, 11, 13. Scaffold/framework Tasks 1, 3, 4. Sims Tasks 2, 6, 8, 10, 12 each precede their scenario. Deploy Task 15. Binder/WorkManager/Doze from the original brainstorm are explicitly OUT of v1.
- **Type consistency check done:** `Scenario` fields (`name/group/panel/update/reset`, camera fields added in Task 14), `LooperState.current.elapsedMs`, `makeBuilding` body mesh `name: 'body'` relied on in Tasks 9 & 11, `makePanel` returns `{root, addButton, setNarration}` used identically in all scenarios.
- **Known simplifications (deliberate):** Looper has no delayed messages or sync barriers; frame pipeline is linear (real pipeline overlaps via triple buffering); LMK uses priority+age only (real uses oom_adj scores); GC is stop-the-world visual (ART is mostly concurrent). Each narration hedges accordingly. Upgrade path: v2 districts.
