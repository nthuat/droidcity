// Notifications: an app posts, NotificationManagerService (system_server) owns
// it, SystemUI shows it on the glass. One pending slot per app (real Android
// stacks them; one is enough to teach the pipeline). Pure and immutable.
//
// Deliberately NOT cleared on process death: a notification outlives its
// process. That's the whole point of the PendingIntent it carries.

export interface NotificationState {
  readonly pending: readonly string[]
}

export function createNotifications(): NotificationState {
  return { pending: [] }
}

export function postNotification(s: NotificationState, app: string): NotificationState {
  return s.pending.includes(app) ? s : { pending: [...s.pending, app] }
}

export function dismissNotification(s: NotificationState, app: string): NotificationState {
  return s.pending.includes(app) ? { pending: s.pending.filter(a => a !== app) } : s
}

export function hasNotification(s: NotificationState, app: string): boolean {
  return s.pending.includes(app)
}
