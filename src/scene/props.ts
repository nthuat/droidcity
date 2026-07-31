import * as THREE from 'three'

// Static zone-dressing primitives, tiny clusters of boxes/cylinders that give each
// board plate visual density. Page-lifetime, no disposal (see plan's disposal-
// discipline note): geometries and materials are module-scope singletons shared by
// every instance, since the look never varies per call site.

const GREY_A = 0x37474f
const GREY_B = 0x455a64
const GREY_C = 0x546e7a
const ACCENT = 0x76e3ea

// Hover tooltips, tagged on each builder's root group so every caller (board
// corners, boot strip, network masts, …) is covered without per-site tagging.
const VENT_INFO = { title: 'Cooling vent', note: 'Thermal headroom is a real scheduler input: hot silicon throttles.' }
const TANK_INFO = { title: 'Power cell', note: 'The battery: the budget every wakelock spends.' }
const PIPE_INFO = { title: 'Power/clock lines', note: 'Board plumbing: clocks and rails the SoC lives on.' }
const ANTENNA_INFO = { title: 'Antenna', note: 'Radio hardware: cellular/Wi-Fi PHY.' }

const matA = new THREE.MeshStandardMaterial({ color: GREY_A, roughness: 0.7 })
const matB = new THREE.MeshStandardMaterial({ color: GREY_B, roughness: 0.7 })
const matC = new THREE.MeshStandardMaterial({ color: GREY_C, roughness: 0.6 })
const matAccent = new THREE.MeshStandardMaterial({
  color: GREY_B, emissive: ACCENT, emissiveIntensity: 0.2, roughness: 0.5,
})

// makeVent: a low grate-on-plinth, reads as a floor vent/exhaust grille. Base sits
// at local y 0 so callers can drop it straight onto a plate top.
const ventPlinthGeo = new THREE.BoxGeometry(0.9, 0.15, 0.9)
const ventGrateGeo = new THREE.BoxGeometry(0.7, 0.08, 0.7)

export function makeVent(): THREE.Group {
  const g = new THREE.Group()
  g.userData.info = VENT_INFO
  const plinth = new THREE.Mesh(ventPlinthGeo, matA)
  plinth.position.y = 0.075
  const grate = new THREE.Mesh(ventGrateGeo, matC)
  grate.position.y = 0.19
  g.add(plinth, grate)
  return g
}

// makePipeRun: a horizontal pipe of `length` along local X, on two stub legs. Base
// (leg feet) at local y 0.
const pipeLegGeo = new THREE.BoxGeometry(0.18, 0.3, 0.18)

export function makePipeRun(length: number): THREE.Group {
  const g = new THREE.Group()
  g.userData.info = PIPE_INFO
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, length, 10), matB)
  pipe.rotation.z = Math.PI / 2
  pipe.position.y = 0.45
  g.add(pipe)
  for (const x of [-length / 2 + 0.2, length / 2 - 0.2]) {
    const leg = new THREE.Mesh(pipeLegGeo, matA)
    leg.position.set(x, 0.15, 0)
    g.add(leg)
  }
  return g
}

// makeTank: a squat cylindrical reservoir with a domed cap and an accent band -
// power/coolant tank feel. Base at local y 0.
const tankBodyGeo = new THREE.CylinderGeometry(0.9, 0.9, 2.2, 16)
const tankCapGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.2, 16)
const tankBandGeo = new THREE.CylinderGeometry(0.92, 0.92, 0.15, 16)

export function makeTank(): THREE.Group {
  const g = new THREE.Group()
  g.userData.info = TANK_INFO
  const body = new THREE.Mesh(tankBodyGeo, matA)
  body.position.y = 1.1
  const cap = new THREE.Mesh(tankCapGeo, matC)
  cap.position.y = 2.3
  const band = new THREE.Mesh(tankBandGeo, matAccent)
  band.position.y = 1.1
  g.add(body, cap, band)
  return g
}

// makeAntenna: a thin mast with two cross-bars and a glowing tip. Base at local y 0.
const antennaPoleGeo = new THREE.CylinderGeometry(0.06, 0.06, 4, 8)
const antennaBarGeo = new THREE.BoxGeometry(0.9, 0.05, 0.05)
const antennaTipGeo = new THREE.SphereGeometry(0.14, 10, 8)

export function makeAntenna(): THREE.Group {
  const g = new THREE.Group()
  g.userData.info = ANTENNA_INFO
  const pole = new THREE.Mesh(antennaPoleGeo, matB)
  pole.position.y = 2
  g.add(pole)
  for (const y of [1.2, 2.6]) {
    const bar = new THREE.Mesh(antennaBarGeo, matA)
    bar.position.y = y
    g.add(bar)
  }
  const tip = new THREE.Mesh(antennaTipGeo, matAccent)
  tip.position.y = 4
  g.add(tip)
  return g
}
