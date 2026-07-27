import * as THREE from 'three'

export interface PacketSystem {
  fly(path: readonly THREE.Vector3[], opts?: { color?: number; durationMs?: number; arcHeight?: number }): void
  // path of 2+ waypoints; duration split evenly per leg; arc per leg
  update(dtMs: number): void
  activeCount(): number
}

interface ActivePacket {
  mesh: THREE.Mesh
  path: readonly THREE.Vector3[]
  t: number
  durationMs: number
  arcHeight: number
}

export function createPacketSystem(scene: THREE.Scene): PacketSystem {
  const geometry = new THREE.SphereGeometry(0.6)
  const active: ActivePacket[] = []
  return {
    fly(path, opts = {}) {
      if (path.length < 2) return
      const material = new THREE.MeshStandardMaterial({
        color: opts.color ?? 0x76e3ea,
        emissive: opts.color ?? 0x76e3ea,
        emissiveIntensity: 0.8,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.copy(path[0])
      scene.add(mesh)
      active.push({
        mesh,
        path: path.map(p => p.clone()),
        t: 0,
        durationMs: opts.durationMs ?? 900 * (path.length - 1),
        arcHeight: opts.arcHeight ?? 6,
      })
    },
    update(dtMs) {
      for (let i = active.length - 1; i >= 0; i--) {
        const p = active[i]
        p.t = Math.min(p.t + dtMs / p.durationMs, 1)
        const legs = p.path.length - 1
        const scaled = p.t * legs
        const leg = Math.min(Math.floor(scaled), legs - 1)
        const lt = scaled - leg
        p.mesh.position.lerpVectors(p.path[leg], p.path[leg + 1], lt)
        p.mesh.position.y += p.arcHeight * 4 * lt * (1 - lt) + 2
        if (p.t >= 1) {
          scene.remove(p.mesh)
          ;(p.mesh.material as THREE.Material).dispose()
          active.splice(i, 1)
        }
      }
    },
    activeCount() { return active.length },
  }
}
