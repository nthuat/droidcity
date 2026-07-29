import * as THREE from 'three'
import type { Hud } from './hud'

// Attaches the 7 persistent zone chips at their anchors. Two are static text
// (boot, cityhall); the rest get their live line filled in by updateHudLines.
export function attachZoneLabels(hud: Hud, anchors: Record<string, THREE.Vector3>, wardsAnchor: THREE.Vector3): void {
  hud.attach('boot', anchors.boot, 'BOOT ROW')
  hud.setLine('boot', 'bootloader→kernel→init→system_server')
  hud.attach('zygote', anchors.zygote, 'ZYGOTE FOUNDRY')
  hud.attach('wards', wardsAnchor, 'WARDS')
  hud.attach('cityhall', anchors.cityhall, 'CITY HALL · BINDER')
  hud.setLine('cityhall', 'AMS · WMS · PMS')
  hud.attach('surfaceflinger', anchors.surfaceflinger, 'SURFACEFLINGER')
  hud.attach('network', anchors.network, 'NETWORK')
  hud.attach('launcher', anchors.launcher.clone().add(new THREE.Vector3(-9, 0, 0)), 'LAUNCHER')
}

export function updateHudLines(
  hud: Hud,
  wardCount: number,
  foundry: { stats(): { usedMb: number; capacityMb: number; procs: number } },
  networkTower: { stats(): { queue: number; phase: string } },
  surfaceFlinger: { stats(): { composited: number; dropped: number } },
  launcherPlaza: { stats(): { running: number } },
): void {
  hud.setLine('wards', `${wardCount}/4 running`)
  const f = foundry.stats()
  hud.setLine('zygote', `RAM ${f.usedMb}/${f.capacityMb}MB · ${f.procs} procs`)
  const n = networkTower.stats()
  hud.setLine('network', `queue ${n.queue} · ${n.phase}`)
  const sf = surfaceFlinger.stats()
  hud.setLine('surfaceflinger', `${sf.composited} composited · ${sf.dropped} janky`)
  const l = launcherPlaza.stats()
  hud.setLine('launcher', `${l.running} apps`)
}
