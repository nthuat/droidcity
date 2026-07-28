import type { Bus } from '../core/bus'
import { APP_COLORS } from '../scene/ward'

const CORE_COUNT = 4
const RAM_SEGMENTS = 8
const MB_PER_SEGMENT = 150
// Pressure = a smoothed usedMb/capacityMb reading (EMA, since raw fullness
// jitters every fork/kill) plus a spike that bumps on every fork and decays
// over 2s — modeling PSI's "stall" pain rather than exact fullness.
const PRESSURE_SMOOTH_ALPHA = 0.3
const PRESSURE_SPIKE_FRAC = 0.25
const PRESSURE_SPIKE_DECAY_MS = 2000

interface HardwareRow {
  setCoreStates(s: { color: number | null; stuck: boolean; app: string }[]): void
  setRamSegments(s: ({ color: number; app: string } | null)[]): void
  diskBlink(write: boolean): void
  setPressure(frac: number): void
}

interface WardStatsSource {
  wardStats(): { app: string; plot: number; busy: boolean; anr: boolean }[]
}

interface ProcListSource {
  stats(): { usedMb: number; capacityMb: number; procList: { name: string; memoryMb: number }[] }
}

// Mirrors hardwareRow.ts's private CORE_STUCK — the trace glow should read the same
// red as the core slot it feeds when that ward's main thread is ANR'd.
const CORE_STUCK_GLOW = 0xf85149

// Pure edge-trigger: fires once (true) when v crosses hi upward, then stays
// silent (false) until v drops to lo or below, re-arming for the next cross.
// Hysteresis (hi > lo) is what prevents kill-spam from a value oscillating
// right at the threshold.
export function createEdgeTrigger(hi: number, lo: number): (v: number) => boolean {
  let armed = true
  return (v: number): boolean => {
    if (armed && v >= hi) {
      armed = false
      return true
    }
    if (!armed && v <= lo) armed = true
    return false
  }
}

// Live wiring for the hardware row: colors CPU core slots (and their motherboard
// traces) per-frame from ward looper state, fills RAM segments from foundry's proc
// list, and blinks the disk LED on Room read/write bus events. Read-only — never
// touches sim state.
export function attachHardwareWiring(
  bus: Bus,
  hardwareRow: HardwareRow,
  wardManager: WardStatsSource,
  foundry: ProcListSource,
  setCpuTraceGlow: (plot: number, color: number | null) => void,
): { syncCores(): void; syncRam(): void; syncPressure(dtMs: number): void; getPressure(): number; label(): string } {
  let reads = 0
  let writes = 0
  let smoothedFrac = 0
  let spikeT = 0
  let pressureFrac = 0
  bus.on('data:cacheHit', () => { reads++; hardwareRow.diskBlink(false) })
  bus.on('data:fetched', () => { writes++; hardwareRow.diskBlink(true) })
  bus.on('process:forked', () => { spikeT = PRESSURE_SPIKE_DECAY_MS })

  function syncCores(): void {
    const stats = wardManager.wardStats()
    const cores = Array.from({ length: CORE_COUNT }, (_, plot) => {
      const w = stats.find(s => s.plot === plot)
      if (!w) return { color: null, stuck: false, app: '' }
      return { color: w.busy ? (APP_COLORS[w.app] ?? 0x6e7681) : null, stuck: w.anr, app: w.app }
    })
    hardwareRow.setCoreStates(cores)
    cores.forEach((c, plot) => setCpuTraceGlow(plot, c.stuck ? CORE_STUCK_GLOW : c.color))
  }

  function syncRam(): void {
    const segments: ({ color: number; app: string } | null)[] = new Array(RAM_SEGMENTS).fill(null)
    let i = 0
    for (const proc of foundry.stats().procList) {
      const color = APP_COLORS[proc.name] ?? 0x6e7681
      const count = Math.ceil(proc.memoryMb / MB_PER_SEGMENT)
      for (let n = 0; n < count && i < RAM_SEGMENTS; n++, i++) segments[i] = { color, app: proc.name }
    }
    hardwareRow.setRamSegments(segments)
  }

  function syncPressure(dtMs: number): void {
    const f = foundry.stats()
    const raw = f.capacityMb > 0 ? f.usedMb / f.capacityMb : 0
    smoothedFrac += (raw - smoothedFrac) * PRESSURE_SMOOTH_ALPHA
    spikeT = Math.max(0, spikeT - dtMs)
    const spike = spikeT > 0 ? PRESSURE_SPIKE_FRAC * (spikeT / PRESSURE_SPIKE_DECAY_MS) : 0
    pressureFrac = Math.min(1, smoothedFrac + spike)
    hardwareRow.setPressure(pressureFrac)
  }

  function label(): string {
    const busy = wardManager.wardStats().filter(s => s.busy).length
    const f = foundry.stats()
    const psi = `PSI ${Math.round(pressureFrac * 100)}%${pressureFrac >= 0.85 ? '!' : ''}`
    return `CPU ${busy}/${CORE_COUNT} busy · RAM ${f.usedMb}/${f.capacityMb}MB · DISK r:${reads} w:${writes} · ${psi}`
  }

  function getPressure(): number { return pressureFrac }

  return { syncCores, syncRam, syncPressure, getPressure, label }
}
