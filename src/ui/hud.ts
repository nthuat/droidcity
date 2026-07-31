import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'

// Zone labels float above zone content; ward labels sit a touch higher so they
// clear ward roofs without floating into the zone label above the strip.
const ZONE_LABEL_Y_OFFSET = 10
const WARD_LABEL_Y_OFFSET = 11

export interface Hud {
  attach(zone: string, anchor: THREE.Vector3, title: string): void
  setLine(zone: string, text: string): void
  setDimmed(dim: boolean): void
}

// Persistent CSS2D chip per zone: bold title row + a live-updating text row.
export function createHud(scene: THREE.Scene): Hud {
  const zones = new Map<string, { obj: CSS2DObject; lineEl: HTMLDivElement }>()

  function attach(zone: string, anchor: THREE.Vector3, title: string): void {
    const el = document.createElement('div')
    el.className = 'hud-label'
    const titleEl = document.createElement('div')
    titleEl.className = 'hud-label-title'
    titleEl.textContent = title
    const lineEl = document.createElement('div')
    lineEl.className = 'hud-label-line'
    el.append(titleEl, lineEl)

    const obj = new CSS2DObject(el)
    obj.position.set(anchor.x, anchor.y + ZONE_LABEL_Y_OFFSET, anchor.z)
    scene.add(obj)
    zones.set(zone, { obj, lineEl })
  }

  function setLine(zone: string, text: string): void {
    const entry = zones.get(zone)
    if (entry) entry.lineEl.textContent = text
  }

  // Hides every label except 'boot', mirrors setCityDim's district hiding during
  // a boot replay. Toggling .visible (not style.display) plays nice with
  // CSS2DRenderer, which overwrites display every frame based on that flag.
  function setDimmed(dim: boolean): void {
    for (const [zone, { obj }] of zones) {
      if (zone === 'boot') continue
      obj.visible = !dim
    }
  }

  return { attach, setLine, setDimmed }
}

export interface WardLabel {
  readonly obj: CSS2DObject
  setLine(text: string): void
  setStartLine(text: string): void
}

// Small floating tag for one live ward, attached as a child of its group so it
// rises/falls/disposes with the building. Caller must remove `obj` from its
// parent on demolition, CSS2DObject only cleans up its DOM node when explicitly
// removed from its parent, not when an ancestor further up is removed.
// Three rows: a static title (app · pid), a live second line (oom_adj score),
// and a third line main.ts flashes with the last start type (cold/warm/hot)
// for a few seconds, then clears.
export function makeWardLabel(group: THREE.Group, title: string): WardLabel {
  const el = document.createElement('div')
  el.className = 'hud-ward-label'
  const titleEl = document.createElement('div')
  titleEl.textContent = title
  const lineEl = document.createElement('div')
  const startEl = document.createElement('div')
  startEl.className = 'hud-ward-label-start'
  el.append(titleEl, lineEl, startEl)

  const obj = new CSS2DObject(el)
  obj.position.set(0, WARD_LABEL_Y_OFFSET, 0)
  group.add(obj)
  return {
    obj,
    setLine(text) { lineEl.textContent = text },
    setStartLine(text) { startEl.textContent = text },
  }
}
