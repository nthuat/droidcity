import * as THREE from 'three'

export interface Scenario {
  readonly name: string
  readonly group: THREE.Group
  readonly panel: HTMLElement
  readonly cameraPos: THREE.Vector3
  readonly cameraTarget: THREE.Vector3
  update(dtMs: number): void
  setIdle(enabled: boolean): void
}
