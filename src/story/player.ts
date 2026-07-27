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

export function createPlayer(bus: Bus, cbs: PlayerCallbacks): Player {
  let state = {
    chapter: null as Chapter | null,
    index: -1,
    waitElapsed: 0,
    paused: false,
    speed: 1 as 1 | 2,
    pendingEventArrived: false,
    unsub: null as (() => void) | null,
  }

  function isEventWait(w: Step['waitFor']): w is { event: CityEventName } {
    return 'event' in w
  }

  function enterStep() {
    if (!state.chapter || state.index >= state.chapter.steps.length) return

    const step = state.chapter.steps[state.index]
    cbs.onStep(step, state.index, state.chapter.steps.length, state.chapter.title)

    // Clear pending flag at step entry to avoid stale events from before
    state.pendingEventArrived = false

    // Arm wait subscription BEFORE firing
    if (isEventWait(step.waitFor)) {
      state.unsub = bus.on(step.waitFor.event, () => {
        if (state.paused) {
          state.pendingEventArrived = true
        } else {
          advance()
        }
      })
    } else {
      state.waitElapsed = 0
    }

    // Fire after subscription is armed
    step.fire?.()
  }

  function advance() {
    if (!state.chapter) return

    // Clean up previous subscription
    if (state.unsub) {
      state.unsub()
      state.unsub = null
    }

    state.index++

    if (state.index >= state.chapter.steps.length) {
      state.chapter = null
      cbs.onChapterDone()
    } else {
      enterStep()
    }
  }

  function play(ch: Chapter) {
    state.chapter = ch
    state.index = 0
    state.waitElapsed = 0
    state.paused = false
    state.pendingEventArrived = false

    ch.setup?.()
    enterStep()
  }

  function pause() {
    state.paused = true
  }

  function resume() {
    if (!state.paused) return
    state.paused = false

    if (state.pendingEventArrived) {
      state.pendingEventArrived = false
      advance()
    }
  }

  function next() {
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
    if (state.unsub) {
      state.unsub()
      state.unsub = null
    }
    state.chapter = null
  }

  function setSpeed(x: 1 | 2) {
    state.speed = x
  }

  function update(dtMs: number) {
    if (!state.chapter || state.paused) return

    const step = state.chapter.steps[state.index]
    if (isEventWait(step.waitFor)) return

    state.waitElapsed += dtMs * state.speed

    if (state.waitElapsed >= step.waitFor.ms) {
      advance()
    }
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
