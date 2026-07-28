import * as THREE from 'three'

export interface InspectorInfo {
  readonly title: string
  readonly note: string
}

export interface Inspector {
  update(clientX: number, clientY: number): void
}

const CURSOR_OFFSET = 14
const VIEWPORT_MARGIN = 8

// Walks the hit object's parent chain to the first tagged ancestor — same
// pattern as WardManager.wardAppFromObject, generalized to any userData.info.
// Three.js raycasting ignores `.visible` entirely, so a toggled-hidden mesh
// (viewModelOrb, a stackCard) still reports hits — walk the full chain and
// bail if the object or ANY ancestor is invisible (don't stop at the first
// info found, keep checking the rest of the chain too).
function infoFromObject(obj: THREE.Object3D): InspectorInfo | null {
  let o: THREE.Object3D | null = obj
  let info: InspectorInfo | null = null
  while (o) {
    if (!o.visible) return null
    info ??= (o.userData.info as InspectorInfo | undefined) ?? null
    o = o.parent
  }
  return info
}

export function createInspector(dom: HTMLElement, camera: THREE.Camera, scene: THREE.Scene): Inspector {
  const tip = document.querySelector<HTMLDivElement>('#inspector-tip')!
  const titleEl = document.createElement('div')
  titleEl.className = 'inspector-tip-title'
  const noteEl = document.createElement('div')
  noteEl.className = 'inspector-tip-note'
  tip.replaceChildren(titleEl, noteEl)

  const raycaster = new THREE.Raycaster()

  function hide(): void {
    tip.classList.remove('open')
  }

  function update(clientX: number, clientY: number): void {
    const rect = dom.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) {
      hide()
      return
    }
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObjects(scene.children, true)
    // The translucent sandbox wall encloses each ward, so it's often the nearest
    // hit — prefer any interior tooltip behind it, fall back to the wall only
    // when the ray reaches nothing else tagged.
    let info: InspectorInfo | null = null
    let wallInfo: InspectorInfo | null = null
    for (const hit of hits) {
      const found = infoFromObject(hit.object)
      if (!found) continue
      if (hit.object.name === 'wardWall') {
        wallInfo ??= found
        continue
      }
      info = found
      break
    }
    info ??= wallInfo
    if (!info) {
      hide()
      return
    }
    titleEl.textContent = info.title
    noteEl.textContent = info.note
    tip.classList.add('open')
    // Position after content is set (so offsetWidth/Height reflect the new text),
    // clamped so the tip never runs off the right/bottom edge.
    const x = Math.min(clientX + CURSOR_OFFSET, window.innerWidth - tip.offsetWidth - VIEWPORT_MARGIN)
    const y = Math.min(clientY + CURSOR_OFFSET, window.innerHeight - tip.offsetHeight - VIEWPORT_MARGIN)
    tip.style.left = `${Math.max(VIEWPORT_MARGIN, x)}px`
    tip.style.top = `${Math.max(VIEWPORT_MARGIN, y)}px`
  }

  return { update }
}
