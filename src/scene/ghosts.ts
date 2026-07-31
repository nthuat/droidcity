import * as THREE from 'three'

// Starting-window splash: a translucent ghost box appears the instant a ward's
// plot is known (process:forked), stands in for the app while the ward rises,
// and fades out on the app's first composited frame. It is why cold launches
// "feel" instant: WMS draws this before the app has drawn anything.

const GHOST_SIZE = { w: 3.2, h: 5, d: 3.2 }
const GHOST_OPACITY = 0.35
const GHOST_FADE_MS = 400

interface StartingGhost { mesh: THREE.Mesh; fading: boolean; fadeMs: number }

export interface Ghosts {
  spawn(app: string, at: THREE.Vector3, visible: boolean): void
  /** Begins the fade; the ghost disposes itself when it reaches zero. */
  fade(app: string): void
  dispose(app: string): void
  update(dtMs: number): void
  setVisible(visible: boolean): void
}

export function createGhosts(scene: THREE.Scene): Ghosts {
  const ghosts = new Map<string, StartingGhost>()

  function dispose(app: string): void {
    const ghost = ghosts.get(app)
    if (!ghost) return
    scene.remove(ghost.mesh)
    ghost.mesh.geometry.dispose()
    ;(ghost.mesh.material as THREE.Material).dispose()
    ghosts.delete(app)
  }

  return {
    dispose,
    spawn(app, at, visible) {
      dispose(app) // guards a re-fork landing before the previous ghost faded
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(GHOST_SIZE.w, GHOST_SIZE.h, GHOST_SIZE.d),
        new THREE.MeshStandardMaterial({
          color: 0xffffff, transparent: true, opacity: GHOST_OPACITY,
          emissive: 0xffffff, emissiveIntensity: 0.3,
        }),
      )
      mesh.position.set(at.x, at.y + GHOST_SIZE.h / 2, at.z)
      mesh.visible = visible
      mesh.userData.info = {
        title: 'Starting window (WMS)',
        note: 'WindowManager shows this splash instantly: the real app is still forking behind it.',
      }
      scene.add(mesh)
      ghosts.set(app, { mesh, fading: false, fadeMs: 0 })
    },
    fade(app) {
      const ghost = ghosts.get(app)
      if (ghost) ghost.fading = true
    },
    update(dtMs) {
      for (const [app, ghost] of [...ghosts]) {
        if (!ghost.fading) continue
        ghost.fadeMs += dtMs
        const mat = ghost.mesh.material as THREE.MeshStandardMaterial
        mat.opacity = GHOST_OPACITY * Math.max(0, 1 - ghost.fadeMs / GHOST_FADE_MS)
        if (ghost.fadeMs >= GHOST_FADE_MS) dispose(app)
      }
    },
    setVisible(visible) {
      for (const ghost of ghosts.values()) ghost.mesh.visible = visible
    },
  }
}
