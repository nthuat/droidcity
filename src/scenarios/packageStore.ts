import * as THREE from 'three'
import { APPS } from '../sim/launcher'
import { APP_COLORS, APP_COLOR_FALLBACK } from '../scene/appColors'
import { makeBuilding, makeLabel } from '../scene/builders'
import { makePanel } from '../ui/panel'
import type { Bus } from '../core/bus'
import type { Scenario } from './types'

// Installed packages: the APK archive under /data/app plus the compiler that
// turns dex into machine code. Every launch starts here — PMS resolves the
// Intent against these manifests, and the process mmaps its code out of them.

const SCAN_PULSE_MS = 700
const RESOLVE = 0xd29922 // matches the PMS wing's pulse tint

const DEFAULT_NARRATION = 'Installed packages live here. An APK is a zip: dex bytecode, resources, native libs, and the manifest. PackageManager scans every manifest at boot and keeps the package database — that database is what resolves your tap into "launch THIS component".'

export function makePackageStoreScenario(bus: Bus): Scenario & {
  pulseResolve(app: string): void
} {
  const group = new THREE.Group()
  group.userData.info = {
    title: 'Installed packages',
    note: 'The /data/app archive. Code and resources are read from these files; each app\'s private data lives elsewhere, in /data/data/<pkg> — the Room shed inside its ward.',
  }

  // One shelf per installed app, in brand colors so they read as the same apps
  // as the icons on the glass.
  const shelves = APPS.map((app, i) => {
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.6, 2.4),
      new THREE.MeshStandardMaterial({ color: APP_COLORS[app] ?? APP_COLOR_FALLBACK, roughness: 0.65 }),
    )
    shelf.position.set((i % 2) * 4.6 - 2.3, 0.8, Math.floor(i / 2) * 3.4 - 1.7)
    shelf.userData.info = {
      title: `${app}.apk`,
      note: 'A zip: classes.dex, resources, lib/<abi>/*.so, and AndroidManifest.xml. The manifest is the app\'s public contract — components, permissions requested, and the intent-filters PMS matches your tap against.',
    }
    group.add(shelf)
    const lbl = makeLabel(`${app}.apk`, 0.42)
    lbl.position.set(shelf.position.x, 2.1, shelf.position.z)
    group.add(lbl)
    return shelf
  })

  // dex2oat: install-time AOT, then JIT + profile-guided recompiles at idle.
  const compiler = makeBuilding(4, 2.6, 3.4, 0x8a99a5, 'dex2oat')
  compiler.position.set(8.5, 0, 0)
  const compilerBody = compiler.getObjectByName('body') as THREE.Mesh
  compilerBody.userData.info = {
    title: 'dex2oat — the compiler',
    note: 'At install it partially ahead-of-time compiles dex to native code (.odex/.vdex). At runtime ART interprets, then JITs the hot paths, and recompiles them AOT while the device is idle and charging — profile-guided. Baseline profiles shipped with the app give a fast FIRST launch, before any profile exists.',
  }
  group.add(compiler)

  const shelfMats = shelves.map(s => s.material as THREE.MeshStandardMaterial)
  const pulse = shelves.map(() => 0)

  function pulseResolve(app: string): void {
    const i = APPS.indexOf(app)
    if (i >= 0) pulse[i] = SCAN_PULSE_MS
  }

  // A launch request is a PMS lookup: the matching package lights up.
  bus.on('app:launchRequested', ({ app }) => pulseResolve(app))
  // A fork mmaps that package's code into the new process.
  bus.on('process:forked', ({ app }) => pulseResolve(app))

  const panel = makePanel('Installed packages — /data/app')
  panel.setNarration(DEFAULT_NARRATION)

  function paint(): void {
    shelfMats.forEach((mat, i) => {
      const lit = pulse[i] > 0
      mat.emissive.setHex(lit ? RESOLVE : 0x000000)
      mat.emissiveIntensity = lit ? (pulse[i] / SCAN_PULSE_MS) * 0.8 : 0
    })
  }
  paint()

  return {
    name: 'Packages',
    group,
    panel: panel.root,
    cameraPos: new THREE.Vector3(0, 10, 16),
    cameraTarget: new THREE.Vector3(0, 1, 0),
    update(dtMs) {
      let dirty = false
      for (let i = 0; i < pulse.length; i++) {
        if (pulse[i] > 0) { pulse[i] = Math.max(0, pulse[i] - dtMs); dirty = true }
      }
      if (dirty) paint()
    },
    setIdle() {
      // no ambient behavior — purely bus-driven
    },
    pulseResolve,
  }
}
