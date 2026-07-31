import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

export interface City {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  cssRenderer: CSS2DRenderer
  controls: OrbitControls
  start(onFrame: (dtMs: number) => void): void
}

export function createCity(container: HTMLElement): City {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xe9e7e2)
  scene.fog = new THREE.Fog(0xe9e7e2, 140, 380)

  // near 1.5 (not 0.1): nothing sits closer than ~8 units, and the tighter range
// buys ~25x depth precision, glancing-angle sub-0.1 separations (traces over
// plates) were quantizing into flickering dashes at distance.
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1.5, 500)
  camera.position.set(18, 16, 18)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(innerWidth, innerHeight)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  container.appendChild(renderer.domElement)

  // Second, HTML-based renderer for persistent HUD labels, overlaid on the same
  // container, sized with the WebGL canvas, ignored by pointer events so orbit
  // controls / raycasting under it keep working.
  container.style.position = container.style.position || 'relative'
  const cssRenderer = new CSS2DRenderer()
  cssRenderer.setSize(innerWidth, innerHeight)
  cssRenderer.domElement.style.position = 'absolute'
  cssRenderer.domElement.style.top = '0'
  cssRenderer.domElement.style.left = '0'
  cssRenderer.domElement.style.pointerEvents = 'none'
  container.appendChild(cssRenderer.domElement)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, 2, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 0.9))
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(20, 30, 10)
  scene.add(sun)

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    cssRenderer.setSize(innerWidth, innerHeight)
  })

  function start(onFrame: (dtMs: number) => void): void {
    let last = performance.now()
    renderer.setAnimationLoop((now) => {
      const dtMs = Math.min(now - last, 100)
      last = now
      onFrame(dtMs)
      controls.update()
      renderer.render(scene, camera)
      cssRenderer.render(scene, camera)
    })
  }

  return { scene, camera, renderer, cssRenderer, controls, start }
}
