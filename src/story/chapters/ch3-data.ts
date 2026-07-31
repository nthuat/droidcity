import type { Chapter } from '../player'
import type { StoryCtx } from './ctx'

export function makeCh3(ctx: StoryCtx): Chapter {
  return {
    id: 'ch3',
    title: 'Getting Data',
    setup: () => {
      ctx.setCityDim(false)
      // wardStats() (not wards()), wards() includes dying wards, so a chat ward
      // mid-demolition read as "running" and the chapter hung on a launch that
      // never came (same guard as ch5/ch6).
      if (!ctx.wards.wardStats().some(w => w.app === 'chat')) ctx.launcher.clickKiosk('chat')
    },
    steps: [
      {
        narration: 'The app needs messages. It asks two places at once: its own Room database and the network, from the worker pool, never the main thread.',
        focus: 'ward:chat',
        // ward may not exist yet if setup just clicked the kiosk (fork is queued,
        // not synchronous), only refresh if it's already there. Either way the
        // wait below catches it: an explicit refresh here, or the manager's own
        // auto data:requested ~600ms after the ward's natural resume.
        fire: () => {
          if (ctx.wards.wardStats().some(w => w.app === 'chat')) ctx.wards.refreshData('chat')
        },
        waitFor: { event: 'data:requested', app: 'chat' },
      },
      {
        narration: 'The Room shed answers in a few milliseconds: stale data from last session. Show it anyway: stale beats blank.',
        focus: 'ward:chat',
        waitFor: { event: 'data:cacheHit', app: 'chat' },
      },
      {
        narration: "The result rides the ward's main road like any other message. The UI renders the cached view.",
        focus: 'ward:chat',
        // data:cacheHit's own ui:messagePosted fires nested inside the manager's
        // handler for that event, which is always registered before this step's
        // wait can be armed, so a wait on ui:messagePosted here would miss it.
        // frame:submitted is emitted from the ward manager's own tick (never
        // nested in another bus handler), so it can't be outrun the same way.
        waitFor: { event: 'frame:submitted', app: 'chat' },
      },
      {
        narration: 'Meanwhile the real fetch leaves the city: DNS, connect, TLS, first byte, download, unless a warm pooled connection skips the handshakes. Every phase costs time.',
        focus: 'network',
        waitFor: { event: 'net:phase' },
      },
      {
        narration: 'A phase can time out: then OkHttp retries with backoff. There: fresh data, about a second after the cache answered.',
        focus: 'network',
        waitFor: { event: 'data:fetched', app: 'chat' },
      },
      {
        narration: 'Fresh data takes the same road home. Re-render, you saw stale-then-fresh and never a spinner.',
        focus: 'ward:chat',
        // Same reasoning as the cache-hit render step above: wait on frame:submitted,
        // not the ui:messagePosted that data:fetched's handler fires nested.
        waitFor: { event: 'frame:submitted', app: 'chat' },
      },
      {
        narration: "The stale objects are garbage now. The ward's collector sweeps them. Memory is a city that cleans itself.",
        focus: 'ward:chat',
        fire: () => ctx.wards.forceGc('chat'),
        waitFor: { event: 'gc:swept' },
      },
    ],
  }
}
