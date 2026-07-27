export interface NetPhase {
  readonly name: string
  readonly costMs: number
}

export interface NetRequest {
  readonly elapsedMs: number
  readonly currentIndex: number
  readonly done: boolean
  readonly attempt: number
  readonly failAt: string | null
  readonly retrying: boolean
  readonly totalMs: number
}

export const NET_PHASES: readonly NetPhase[] = [
  { name: 'dns', costMs: 100 },
  { name: 'connect', costMs: 150 },
  { name: 'tls', costMs: 250 },
  { name: 'ttfb', costMs: 400 },
  { name: 'download', costMs: 300 },
]

const RETRY_BACKOFF_MS = 500
const TOTAL_MS = NET_PHASES.reduce((a, p) => a + p.costMs, 0)

export function startRequest(opts?: { failAt?: string }): NetRequest {
  return {
    elapsedMs: 0,
    currentIndex: 0,
    done: false,
    attempt: 1,
    failAt: opts?.failAt ?? null,
    retrying: false,
    totalMs: 0,
  }
}

function failPointMs(failAt: string): number {
  let acc = 0
  for (const p of NET_PHASES) {
    acc += p.costMs
    if (p.name === failAt) return acc
  }
  return Infinity
}

function indexAt(elapsedMs: number): number {
  let acc = 0
  for (let i = 0; i < NET_PHASES.length; i++) {
    acc += NET_PHASES[i].costMs
    if (elapsedMs < acc) return i
  }
  return -1
}

export function advanceRequest(r: NetRequest, dtMs: number): NetRequest {
  if (r.done) return r
  let remaining = dtMs
  let cur = r
  while (remaining > 0 && !cur.done) {
    if (cur.retrying) {
      const spent = Math.min(RETRY_BACKOFF_MS - cur.elapsedMs, remaining)
      remaining -= spent
      const elapsedMs = cur.elapsedMs + spent
      cur =
        elapsedMs >= RETRY_BACKOFF_MS
          ? {
              ...cur,
              retrying: false,
              attempt: 2,
              failAt: null,
              elapsedMs: 0,
              currentIndex: 0,
              totalMs: cur.totalMs + spent,
            }
          : { ...cur, elapsedMs, totalMs: cur.totalMs + spent }
      continue
    }
    const limit = cur.failAt && cur.attempt === 1 ? failPointMs(cur.failAt) : TOTAL_MS
    const spent = Math.min(limit - cur.elapsedMs, remaining)
    remaining -= spent
    const elapsedMs = cur.elapsedMs + spent
    if (elapsedMs >= limit) {
      cur =
        cur.failAt && cur.attempt === 1
          ? {
              ...cur,
              retrying: true,
              elapsedMs: 0,
              currentIndex: -1,
              totalMs: cur.totalMs + spent,
            }
          : {
              ...cur,
              done: true,
              currentIndex: -1,
              elapsedMs,
              totalMs: cur.totalMs + spent,
            }
    } else {
      cur = {
        ...cur,
        elapsedMs,
        currentIndex: indexAt(elapsedMs),
        totalMs: cur.totalMs + spent,
      }
    }
  }
  return cur
}
