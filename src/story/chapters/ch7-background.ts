import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

// The half of Android that runs when you are not looking: work the system
// defers, notifications it posts on the app's behalf, the promise a foreground
// service makes, and what the kernel tries before anything dies.
export function makeCh7(ctx: StoryCtx): Chapter {
  return {
    id: 'ch7',
    title: 'While You Sleep',
    setup: () => {
      ctx.setCityDim(false)
      ctx.jobs.setDoze(false)
      // Two live wards: chat does the background work, maps is the cached
      // process that LMK will take once reclaim runs out of room.
      if (!ctx.wards.wardStats().some(w => w.app === 'maps')) ctx.launcher.clickKiosk('maps')
      if (!ctx.wards.wardStats().some(w => w.app === 'chat')) ctx.launcher.clickKiosk('chat')
    },
    steps: [
      {
        narration: 'Everything so far happened because you tapped. Now the other half: what the system does while you look away. Your app asks for work; it does not get to choose when that work runs.',
        focus: 'cityhall',
        waitFor: { ms: 4500 },
      },
      {
        narration: 'WorkManager enqueues a job at the depot beside AMS. It carries constraints — this one needs a network. It sits there, amber, until the system says go.',
        focus: 'cityhall',
        fire: () => ctx.jobs.enqueue('network'),
        waitFor: { ms: 5000 },
      },
      {
        narration: 'The screen goes off and the device sits still: Doze. The radio goes quiet, alarms slip, and every deferred job waits — batched with everyone else\'s for a maintenance window that gets further apart the longer nothing moves.',
        focus: 'overview',
        fire: () => ctx.jobs.setDoze(true),
        waitFor: { ms: 6000 },
      },
      {
        narration: 'A maintenance window opens. Now the queue drains: the job dispatches into its own app\'s process — a job is not a thread the system owns, it is your code, in your ward.',
        focus: 'cityhall',
        fire: () => ctx.jobs.openWindow(),
        waitFor: { ms: 6000 },
      },
      {
        narration: 'Data arrives while chat is off screen, so the app does not draw it — it posts a notification. NotificationManagerService in system_server owns it from there, and SystemUI paints it on the glass. The PendingIntent it carries will outlive the process that made it.',
        focus: 'displaywall',
        fire: () => ctx.wards.refreshData('chat'),
        waitFor: { event: 'data:fetched', app: 'chat' },
      },
      {
        narration: 'Some work cannot wait for a window — music, navigation, a call. Promote the service and it goes foreground: it must show an ongoing notification you cannot swipe away, and in exchange it takes oom_adj 200 and outranks every cached process.',
        focus: 'ward:chat',
        fire: () => {
          ctx.wards.toggleService('chat')
          ctx.wards.toggleForegroundService('chat')
        },
        waitFor: { event: 'service:foreground', app: 'chat' },
      },
      {
        narration: 'Not all wake-ups are jobs. A broadcast goes out and every live app with a registered receiver gets onReceive — on the MAIN thread, with 10 seconds to return. And a manifest-declared receiver does not need the app to be running at all: the system starts a dead process purely to deliver. That is how an app you never opened ends up in the process list.',
        focus: 'cityhall',
        fire: () => ctx.bus.emit('broadcast:sent', { action: 'NEWS_MANIFEST' }),
        waitFor: { ms: 5500 },
      },
      {
        narration: 'Now squeeze memory. Nothing dies yet: kswapd walks the cold pages and compresses them into zram. Slower memory beats a dead process — watch the zram block fill on the hardware strip.',
        focus: 'hardware',
        fire: () => ctx.squeezeMemory(),
        waitFor: { ms: 5000 },
      },
      {
        narration: 'Squeeze again, and again. Each pass finds less to compress. When reclaim can no longer keep up, lmkd finally gets its turn — and it takes the cached ward, not the one holding a foreground service.',
        focus: 'overview',
        fire: () => {
          ctx.squeezeMemory()
          ctx.squeezeMemory()
        },
        waitFor: { event: 'process:killed' },
        // Reclaim runs three passes before lmkd is allowed to kill, and the
        // demolition animation follows — generous on slow renderers.
        timeoutMs: 40000,
      },
      {
        narration: 'That is the bargain the whole city runs on: the system decides when your background work happens, the user decides what may run in front of them, and the kernel exhausts every cheaper option before it takes a process away.',
        focus: 'overview',
        fire: () => ctx.jobs.setDoze(false),
        waitFor: { ms: 5000 },
      },
    ],
  }
}
