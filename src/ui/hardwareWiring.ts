import type { Bus } from '../core/bus'
import { APP_COLORS } from '../scene/ward'

const CORE_COUNT = 4
const RAM_SEGMENTS = 8
const MB_PER_SEGMENT = 150

interface HardwareRow {
  setCoreStates(s: { color: number | null; stuck: boolean }[]): void
  setRamSegments(s: (number | null)[]): void
  diskBlink(write: boolean): void
}

interface WardStatsSource {
  wardStats(): { app: string; plot: number; busy: boolean; anr: boolean }[]
}

interface ProcListSource {
  stats(): { usedMb: number; capacityMb: number; procList: { name: string; memoryMb: number }[] }
}

// Live wiring for the hardware row: colors CPU core slots per-frame from ward
// looper state, fills RAM segments from foundry's proc list, and blinks the disk
// LED on Room read/write bus events. Read-only — never touches sim state.
export function attachHardwareWiring(
  bus: Bus,
  hardwareRow: HardwareRow,
  wardManager: WardStatsSource,
  foundry: ProcListSource,
): { syncCores(): void; syncRam(): void; label(): string } {
  let reads = 0
  let writes = 0
  bus.on('data:cacheHit', () => { reads++; hardwareRow.diskBlink(false) })
  bus.on('data:fetched', () => { writes++; hardwareRow.diskBlink(true) })

  function syncCores(): void {
    const stats = wardManager.wardStats()
    const cores = Array.from({ length: CORE_COUNT }, (_, plot) => {
      const w = stats.find(s => s.plot === plot)
      if (!w) return { color: null, stuck: false }
      return { color: w.busy ? (APP_COLORS[w.app] ?? 0x6e7681) : null, stuck: w.anr }
    })
    hardwareRow.setCoreStates(cores)
  }

  function syncRam(): void {
    const segments: (number | null)[] = new Array(RAM_SEGMENTS).fill(null)
    let i = 0
    for (const proc of foundry.stats().procList) {
      const color = APP_COLORS[proc.name] ?? 0x6e7681
      const count = Math.ceil(proc.memoryMb / MB_PER_SEGMENT)
      for (let n = 0; n < count && i < RAM_SEGMENTS; n++, i++) segments[i] = color
    }
    hardwareRow.setRamSegments(segments)
  }

  function label(): string {
    const busy = wardManager.wardStats().filter(s => s.busy).length
    const f = foundry.stats()
    return `CPU ${busy}/${CORE_COUNT} busy · RAM ${f.usedMb}/${f.capacityMb}MB · DISK r:${reads} w:${writes}`
  }

  return { syncCores, syncRam, label }
}
