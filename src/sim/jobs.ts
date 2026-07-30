// Deferred work: WorkManager enqueues, JobScheduler (system_server) decides WHEN.
// A job waits for its constraints, and under Doze it waits for a maintenance
// window on top of that — the app never picks the moment. Pure and immutable.

export type JobConstraint = 'network' | 'charging' | 'idle'

export interface Job {
  readonly id: number
  readonly app: string
  readonly constraint: JobConstraint
}

export interface JobsState {
  readonly pending: readonly Job[]
  readonly running: readonly Job[]
  readonly done: number
  readonly nextId: number
  readonly doze: boolean
}

// What the device looks like right now, as far as constraints are concerned.
export interface JobEnv {
  readonly network: boolean
  readonly charging: boolean
  readonly idle: boolean
  // A maintenance window is open — the only time anything runs under Doze.
  readonly window: boolean
}

export function createJobs(): JobsState {
  return { pending: [], running: [], done: 0, nextId: 1, doze: false }
}

export function enqueueJob(s: JobsState, app: string, constraint: JobConstraint): JobsState {
  const job: Job = { id: s.nextId, app, constraint }
  return { ...s, pending: [...s.pending, job], nextId: s.nextId + 1 }
}

export function setDoze(s: JobsState, doze: boolean): JobsState {
  return s.doze === doze ? s : { ...s, doze }
}

function constraintMet(c: JobConstraint, env: JobEnv): boolean {
  if (c === 'network') return env.network
  if (c === 'charging') return env.charging
  return env.idle
}

export function runnableJobs(s: JobsState, env: JobEnv): readonly Job[] {
  // Doze blocks everything outside a maintenance window, constraints or not.
  if (s.doze && !env.window) return []
  return s.pending.filter(j => constraintMet(j.constraint, env))
}

export function dispatchJobs(s: JobsState, env: JobEnv): JobsState {
  const go = runnableJobs(s, env)
  if (go.length === 0) return s
  const ids = new Set(go.map(j => j.id))
  return { ...s, pending: s.pending.filter(j => !ids.has(j.id)), running: [...s.running, ...go] }
}

export function finishJob(s: JobsState, id: number): JobsState {
  if (!s.running.some(j => j.id === id)) return s
  return { ...s, running: s.running.filter(j => j.id !== id), done: s.done + 1 }
}

// Process death takes its jobs with it. Real WorkManager persists and reschedules
// them; here they simply vanish, which is enough to teach "the process dying
// does not mean the work ran".
export function cancelJobsFor(s: JobsState, app: string): JobsState {
  const hit = s.pending.some(j => j.app === app) || s.running.some(j => j.app === app)
  if (!hit) return s
  return { ...s, pending: s.pending.filter(j => j.app !== app), running: s.running.filter(j => j.app !== app) }
}
