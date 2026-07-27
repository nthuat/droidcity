import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface City {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
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

  return { scene, camera, renderer, controls, start }
}
