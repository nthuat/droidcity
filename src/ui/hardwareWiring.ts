import type { Bus } from '../core/bus'
import { APP_COLORS } from '../scene/ward'

const CORE_COUNT = 4
const RAM_SEGMENTS = 8
const MB_PER_SEGMENT = 150
const TRACE_PULSE_MS = 500
// A ward that's still forked in foundry but whose WardManager entry has already
// been torn down (a brief race during kill/demolish) reads as "barely there"
// rather than snapping the tank back to full or vanishing outright.
const RAM_FILL_MISSING_WARD = 0.05
// Pressure = a smoothed usedMb/capacityMb reading (EMA, since raw fullness
// jitters every fork/kill) plus a spike that bumps on every fork and decays
// over 2s — modeling PSI's "stall" pain rather than exact fullness.
const PRESSURE_SMOOTH_ALPHA = 0.3
const PRESSURE_SPIKE_FRAC = 0.25
const PRESSURE_SPIKE_DECAY_MS = 2000

interface HardwareRow {
  setCoreStates(s: { color: number | null; stuck: boolean; app: string }[]): void
  setRamSegments(s: ({ color: number; app: string; fill: number; note: string } | null)[]): void
  pulseRam(app: string): void
  diskBlink(write: boolean): void
  setPressure(frac: number): void
}

interface WardStatsSource {
  wardStats(): { app: string; plot: number; busy: boolean; anr: boolean; heapUsedKb: number; heapCapacityKb: number }[]
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
  setRamTraceGlow: (plot: number, color: number | null) => void,
  setDiskTraceGlow: (plot: number, color: number | null) => void,
  setCpuRamBusGlow: (color: number | null) => void,
  setRamDiskBusGlow: (color: number | null) => void,
): { syncCores(dtMs: number): void; syncRam(): void; syncPressure(dtMs: number): void; getPressure(): number; label(): string } {
  let reads = 0
  let writes = 0
  let smoothedFrac = 0
  let spikeT = 0
  let pressureFrac = 0
  // Per-plot pulse timers for the RAM/DISK bus traces, decayed every syncCores
  // call (the existing per-frame path core-glow already runs on) rather than a
  // separate tick — one frame hook, not two.
  const ramPulse: number[] = new Array(CORE_COUNT).fill(0)
  const diskPulse: number[] = new Array(CORE_COUNT).fill(0)
  // RAM↔DISK storage bus pulse: single timer + color, latest event wins on overlap.
  let ramDiskPulseT = 0
  let ramDiskPulseColor = 0x000000

  function plotForApp(app: string): number | null {
    return wardManager.wardStats().find(s => s.app === app)?.plot ?? null
  }

  bus.on('data:cacheHit', ({ app }) => {
    reads++
    hardwareRow.diskBlink(false)
    const plot = plotForApp(app)
    if (plot !== null) diskPulse[plot] = TRACE_PULSE_MS
    // RAM↔DISK bus pulse: page in (cyan)
    ramDiskPulseT = TRACE_PULSE_MS
    ramDiskPulseColor = 0x76e3ea
  })
  bus.on('data:fetched', ({ app }) => {
    writes++
    hardwareRow.diskBlink(true)
    const plot = plotForApp(app)
    if (plot !== null) diskPulse[plot] = TRACE_PULSE_MS
    // RAM↔DISK bus pulse: write-back (orange)
    ramDiskPulseT = TRACE_PULSE_MS
    ramDiskPulseColor = 0xdb6d28
  })
  bus.on('process:forked', ({ app }) => {
    spikeT = PRESSURE_SPIKE_DECAY_MS
    const plot = plotForApp(app)
    if (plot !== null) ramPulse[plot] = TRACE_PULSE_MS
    // RAM↔DISK bus pulse: dex page-in (pale)
    ramDiskPulseT = TRACE_PULSE_MS
    ramDiskPulseColor = 0x9aa7b8
  })
  // GC↔RAM beat: a sweep visibly brightens the app's slabs for a moment before
  // the drained fill level (read on the next syncRam) settles in.
  bus.on('gc:swept', ({ app }) => {
    hardwareRow.pulseRam(app)
    const plot = plotForApp(app)
    if (plot !== null) ramPulse[plot] = TRACE_PULSE_MS
  })
  // Trim has no app payload — every living ward is reclaiming pages, so pulse them all.
  bus.on('memory:trim', () => {
    for (const w of wardManager.wardStats()) ramPulse[w.plot] = TRACE_PULSE_MS
  })

  function syncCores(dtMs: number): void {
    const stats = wardManager.wardStats()
    const byPlot = new Map(stats.map(w => [w.plot, w]))
    const cores = Array.from({ length: CORE_COUNT }, (_, plot) => {
      const w = byPlot.get(plot)
      if (!w) return { color: null, stuck: false, app: '' }
      return { color: w.busy ? (APP_COLORS[w.app] ?? 0x6e7681) : null, stuck: w.anr, app: w.app }
    })
    hardwareRow.setCoreStates(cores)
    cores.forEach((c, plot) => setCpuTraceGlow(plot, c.stuck ? CORE_STUCK_GLOW : c.color))

    // Compute CPU-RAM bus state: collect busy non-ANR wards' colors, but ANR wins over all.
    const busyNonAnrColors: number[] = []
    let anyAnrBusy = false
    for (const w of stats) {
      if (w.anr && w.busy) {
        anyAnrBusy = true
      } else if (w.busy) {
        busyNonAnrColors.push(APP_COLORS[w.app] ?? 0x6e7681)
      }
    }
    let busColor: number | null = null
    if (anyAnrBusy) {
      busColor = CORE_STUCK_GLOW
    } else if (busyNonAnrColors.length === 1) {
      busColor = busyNonAnrColors[0]
    } else if (busyNonAnrColors.length > 1) {
      busColor = 0xffffff
    }
    setCpuRamBusGlow(busColor)

    // Decay RAM↔DISK bus pulse timer
    ramDiskPulseT = Math.max(0, ramDiskPulseT - dtMs)
    setRamDiskBusGlow(ramDiskPulseT > 0 ? ramDiskPulseColor : null)

    for (let plot = 0; plot < CORE_COUNT; plot++) {
      ramPulse[plot] = Math.max(0, ramPulse[plot] - dtMs)
      diskPulse[plot] = Math.max(0, diskPulse[plot] - dtMs)
      const color = APP_COLORS[byPlot.get(plot)?.app ?? ''] ?? 0x6e7681
      setRamTraceGlow(plot, ramPulse[plot] > 0 ? color : null)
      setDiskTraceGlow(plot, diskPulse[plot] > 0 ? color : null)
    }
  }

  function syncRam(): void {
    const heapByApp = new Map(wardManager.wardStats().map(w => [w.app, w]))
    const segments: ({ color: number; app: string; fill: number; note: string } | null)[] = new Array(RAM_SEGMENTS).fill(null)
    let i = 0
    for (const proc of foundry.stats().procList) {
      const color = APP_COLORS[proc.name] ?? 0x6e7681
      const heap = heapByApp.get(proc.name)
      const fill = heap && heap.heapCapacityKb > 0 ? heap.heapUsedKb / heap.heapCapacityKb : RAM_FILL_MISSING_WARD
      const note = heap
        ? `heap ${heap.heapUsedKb}/${heap.heapCapacityKb}KB live — GC sweeps drain this; the 150MB reservation stays until the process dies.`
        : 'heap data unavailable — GC sweeps drain this; the 150MB reservation stays until the process dies.'
      const count = Math.ceil(proc.memoryMb / MB_PER_SEGMENT)
      for (let n = 0; n < count && i < RAM_SEGMENTS; n++, i++) segments[i] = { color, app: proc.name, fill, note }
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
