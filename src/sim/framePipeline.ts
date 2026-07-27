import { FRAME_BUDGET_MS } from './constants'

export interface Stage { readonly name: string; readonly costMs: number }

export const DEFAULT_STAGES: readonly Stage[] = [
  { name: 'input', costMs: 1 },
  { name: 'animation', costMs: 1 },
  { name: 'measure/layout', costMs: 2 },
  { name: 'draw', costMs: 2 },
  { name: 'renderThread', costMs: 3 },
  { name: 'gpu', costMs: 3 },
  { name: 'surfaceFlinger', costMs: 2 },
]

export interface FrameRun {
  readonly stages: readonly Stage[]
  readonly elapsedMs: number
  readonly totalMs: number
  readonly done: boolean
  readonly dropped: boolean
  readonly currentStageIndex: number
  readonly stageProgress: number
}

function locate(stages: readonly Stage[], elapsedMs: number): { index: number; progress: number } {
  let acc = 0
  for (let i = 0; i < stages.length; i++) {
    if (elapsedMs < acc + stages[i].costMs) {
      return { index: i, progress: (elapsedMs - acc) / stages[i].costMs }
    }
    acc += stages[i].costMs
  }
  return { index: -1, progress: 0 }
}

export function startFrame(stages: readonly Stage[] = DEFAULT_STAGES): FrameRun {
  const totalMs = stages.reduce((sum, s) => sum + s.costMs, 0)
  return {
    stages,
    elapsedMs: 0,
    totalMs,
    done: false,
    dropped: totalMs > FRAME_BUDGET_MS,
    currentStageIndex: 0,
    stageProgress: 0,
  }
}

export function advanceFrame(run: FrameRun, dtMs: number): FrameRun {
  const elapsedMs = Math.min(run.elapsedMs + dtMs, run.totalMs)
  const done = elapsedMs >= run.totalMs
  const { index, progress } = done ? { index: -1, progress: 0 } : locate(run.stages, elapsedMs)
  return { ...run, elapsedMs, done, currentStageIndex: index, stageProgress: progress }
}

export function withHeavyDraw(stages: readonly Stage[], drawCostMs: number): readonly Stage[] {
  return stages.map((s) => (s.name === 'draw' ? { ...s, costMs: drawCostMs } : s))
}
