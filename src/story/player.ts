import type { Bus, CityEventName } from '../core/bus'

export interface Step {
  readonly narration: string
  readonly focus: string
  readonly fire?: () => void
  readonly waitFor: { event: CityEventName } | { ms: number }
}

export interface Chapter {
  readonly id: string
  readonly title: string
  readonly setup?: () => void
  readonly steps: readonly Step[]
}

export interface PlayerCallbacks {
  onStep(step: Step, index: number, total: number, title: string): void
  onChapterDone(): void
}

export interface Player {
  play(ch: Chapter): void
  pause(): void
  resume(): void
  next(): void
  restartChapter(): void
  stop(): void
  setSpeed(x: 1 | 2): void
  update(dtMs: number): void
  readonly playing: boolean
}

export function createPlayer(bus: Bus, cbs: PlayerCallbacks, opts?: { minStepMs?: number }): Player {
  const minStepMs = opts?.minStepMs ?? 0

  let state = {
    chapter: null as Chapter | null,
    index: -1,
    waitElapsed: 0,
    dwellElapsed: 0,
    paused: false,
    speed: 1 as 1 | 2,
    // Chapter-scoped event buffer: fired-count per event name, and how many of
    // those firings each waiting step has consumed. Events that fire early
    // (during an earlier step's dwell) stay counted and satisfy later steps in
    // order — no per-step arm/unarm race to get wrong.
    buffer: new Map<CityEventName, number>(),
    consumed: new Map<CityEventName, number>(),
    unsubs: [] as (() => void)[],
  }

  function isEventWait(w: Step['waitFor']): w is { event: CityEventName } {
    return 'event' in w
  }

  // Peek-only: is the current step's wait satisfiable right now? Never mutates
  // consumed counts — safe to call repeatedly across ticks.
  function isSatisfied(step: Step): boolean {
    if (isEventWait(step.waitFor)) {
      const name = step.waitFor.event
      return (state.buffer.get(name) ?? 0) > (state.consumed.get(name) ?? 0)
    }
    return state.waitElapsed >= step.waitFor.ms
  }

  // Consumes one buffered firing for an event-wait step. No-op for ms-waits.
  function consumeIfEvent(step: Step): void {
    if (isEventWait(step.waitFor)) {
      const name = step.waitFor.event
      state.consumed.set(name, (state.consumed.get(name) ?? 0) + 1)
    }
  }

  // Single source of truth for "should the current step advance": satisfied
  // wait + minimum dwell elapsed. Called from update() (time/event
  // progression), the bus subscription (same-tick advance while not paused),
  // and resume() (re-check whatever buffered while paused).
  function checkAndAdvance(): void {
    if (!state.chapter || state.paused) return
    const step = state.chapter.steps[state.index]
    if (isSatisfied(step) && state.dwellElapsed >= minStepMs) {
      consumeIfEvent(step)
      advance()
    }
  }

  function subscribeChapterEvents(ch: Chapter) {
    const names = new Set<CityEventName>()
    for (const step of ch.steps) {
      if (isEventWait(step.waitFor)) names.add(step.waitFor.event)
    }
    for (const name of names) {
      state.buffer.set(name, 0)
      state.consumed.set(name, 0)
      state.unsubs.push(bus.on(name, () => {
        state.buffer.set(name, (state.buffer.get(name) ?? 0) + 1)
        if (!state.paused) checkAndAdvance()
      }))
    }
  }

  function unsubscribeAll() {
    for (const unsub of state.unsubs) unsub()
    state.unsubs = []
    state.buffer.clear()
    state.consumed.clear()
  }

  function enterStep() {
    if (!state.chapter || state.index >= state.chapter.steps.length) return

    const step = state.chapter.steps[state.index]
    cbs.onStep(step, state.index, state.chapter.steps.length, state.chapter.title)

    state.waitElapsed = 0
    state.dwellElapsed = 0

    step.fire?.()
  }

  function advance() {
    if (!state.chapter) return

    state.index++

    if (state.index >= state.chapter.steps.length) {
      state.chapter = null
      unsubscribeAll()
      cbs.onChapterDone()
    } else {
      enterStep()
    }
  }

  function play(ch: Chapter) {
    unsubscribeAll()

    state.chapter = ch
    state.index = 0
    state.waitElapsed = 0
    state.dwellElapsed = 0
    state.paused = false

    subscribeChapterEvents(ch)
    ch.setup?.()
    enterStep()
  }

  function pause() {
    state.paused = true
  }

  function resume() {
    if (!state.paused) return
    state.paused = false
    checkAndAdvance()
  }

  function next() {
    if (!state.chapter) return
    const step = state.chapter.steps[state.index]
    if (isSatisfied(step)) consumeIfEvent(step)
    advance()
  }

  function restartChapter() {
    if (state.chapter) {
      const ch = state.chapter
      stop()
      play(ch)
    }
  }

  function stop() {
    unsubscribeAll()
    state.chapter = null
  }

  function setSpeed(x: 1 | 2) {
    state.speed = x
  }

  function update(dtMs: number) {
    if (!state.chapter || state.paused) return

    const step = state.chapter.steps[state.index]
    state.dwellElapsed += dtMs * state.speed
    if (!isEventWait(step.waitFor)) state.waitElapsed += dtMs * state.speed

    checkAndAdvance()
  }

  return {
    play,
    pause,
    resume,
    next,
    restartChapter,
    stop,
    setSpeed,
    update,
    get playing(): boolean {
      return state.chapter !== null
    },
  }
}
