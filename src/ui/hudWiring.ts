import * as THREE from 'three'
import type { Hud } from './hud'

// Attaches the 7 persistent zone chips at their anchors. Two are static text
// (boot, cityhall); the rest get their live line filled in by updateHudLines.
//
// Chip text is the REAL Android name, not the city metaphor: these labels are
// the vocabulary a visitor should leave with. 'CITY HALL' and 'WARDS' were the
// only two metaphor chips on a board that otherwise reads system_server /
// zygote / SurfaceFlinger, inconsistent, and the weaker of the two names. The
// metaphor lives on in tooltips, panel narration, and the story chapters.
export function attachZoneLabels(hud: Hud, anchors: Record<string, THREE.Vector3>, wardsAnchor: THREE.Vector3): void {
  hud.attach('boot', anchors.boot, 'BOOT ROW')
  hud.setLine('boot', 'bootloader→kernel→init→system_server')
  hud.attach('zygote', anchors.zygote, 'ZYGOTE')
  hud.attach('wards', wardsAnchor, 'APP PROCESSES')
  hud.attach('cityhall', anchors.cityhall, 'SYSTEM_SERVER')
  hud.setLine('cityhall', 'AMS · WMS · PMS: all Binder ends here')
  hud.attach('surfaceflinger', anchors.surfaceflinger, 'SURFACEFLINGER')
  hud.attach('network', anchors.network, 'NETWORK')
  hud.attach('launcher', anchors.launcher.clone().add(new THREE.Vector3(-9, 0, 0)), 'LAUNCHER')
}

export function updateHudLines(
  hud: Hud,
  wardCount: number,
  foundry: { stats(): { usedMb: number; capacityMb: number; procs: number } },
  cityHall: { jobStats(): { pending: number; running: number; done: number; doze: boolean } },
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
  const j = cityHall.jobStats()
  hud.setLine('cityhall', j.doze
    ? `DOZE · jobs ${j.pending} deferred · ${j.done} done`
    : `AMS · WMS · PMS · jobs ${j.pending}/${j.running}/${j.done}`)
}
