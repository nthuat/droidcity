import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Collapse a staging group of many small static meshes into one mesh per
// (material, tooltip-info) pair, draw calls drop from mesh-count to
// bucket-count while shared material instances (glow APIs) stay intact.
// Each mesh's transform is baked into a geometry clone before merging, so
// the returned meshes live in the staging group's local space.
// Tooltip info is resolved the same way the inspector does: nearest tagged
// ancestor within the staging group.
export function mergeStaticGroup(staging: THREE.Object3D): THREE.Mesh[] {
  staging.updateMatrixWorld(true)
  interface Bucket {
    material: THREE.Material
    info: unknown
    geometries: THREE.BufferGeometry[]
  }
  const buckets: Bucket[] = []
  staging.traverse(obj => {
    if (!(obj as THREE.Mesh).isMesh) return
    const mesh = obj as THREE.Mesh
    let info: unknown
    for (let o: THREE.Object3D | null = mesh; o; o = o === staging ? null : o.parent) {
      if (o.userData.info !== undefined) {
        info = o.userData.info
        break
      }
    }
    const material = mesh.material as THREE.Material
    let bucket = buckets.find(b => b.material === material && b.info === info)
    if (!bucket) {
      bucket = { material, info, geometries: [] }
      buckets.push(bucket)
    }
    bucket.geometries.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld))
  })
  return buckets.map(bucket => {
    const merged = mergeGeometries(bucket.geometries)
    for (const g of bucket.geometries) g.dispose()
    const mesh = new THREE.Mesh(merged, bucket.material)
    if (bucket.info !== undefined) mesh.userData.info = bucket.info
    return mesh
  })
}
