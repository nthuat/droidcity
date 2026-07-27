export interface BootStage {
  readonly name: string
  readonly durationMs: number
}

export interface BootState {
  readonly elapsedMs: number
  readonly completed: readonly string[]
  readonly done: boolean
}

export const BOOT_STAGES: readonly BootStage[] = [
  { name: 'bootloader', durationMs: 800 },
  { name: 'kernel', durationMs: 1200 },
  { name: 'init', durationMs: 900 },
  { name: 'system_server', durationMs: 1500 },
]

export function createBoot(): BootState {
  return { elapsedMs: 0, completed: [], done: false }
}

export function advanceBoot(s: BootState, dtMs: number): BootState {
  const elapsedMs = s.elapsedMs + dtMs
  const completed: string[] = []
  let acc = 0
  for (const stage of BOOT_STAGES) {
    acc += stage.durationMs
    if (elapsedMs >= acc) completed.push(stage.name)
  }
  return { elapsedMs, completed, done: completed.length === BOOT_STAGES.length }
}
