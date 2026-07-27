import * as THREE from 'three'

export interface Scenario {
  readonly name: string
  readonly group: THREE.Group
  readonly panel: HTMLElement
  update(dtMs: number): void
  reset(): void
}
