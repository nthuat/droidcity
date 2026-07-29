# Glass OS Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Model three missing Android concepts the phone-UI glass now makes teachable: notifications (post → status bar → shade → PendingIntent tap), runtime permissions (system dialog on the glass, PMS records), and the named input-dispatch path.

**Architecture:** Two new pure sims (`notifications`, `permissions`) + new screen modes (`shade`, `permission`) in `src/sim/screen.ts`, rendered by the display in surfaceFlinger.ts, wired by main.ts. Sims tested; scene changes verified visually.

## Global Constraints
- Pure sims stay pure; immutability throughout; tests per sim.
- Android green 0x3ddc84 reserved for alive/running. APP_COLORS is the per-app source.
- No coplanar overlaps; overlays sit proud of the screen panel by ≥0.02.
- 108 existing tests keep passing; commit per task.

### Task 1: notifications sim
`src/sim/notifications.ts`: `NotificationState = { readonly pending: readonly string[] }` (app names, one slot per app, newest kept). `createNotifications()`, `postNotification(s, app)` (idempotent), `dismissNotification(s, app)`, `hasNotification(s, app)`. Notifications survive process death (teaching point — no clear-on-kill). Tests: post/dedupe/dismiss/survive-kill semantics (kill just doesn't touch it).

### Task 2: permissions sim
`src/sim/permissions.ts`: `PermissionState = Record<string, 'unasked' | 'granted' | 'denied'>` starting `{ camera: 'unasked' }` (only camera models a dangerous permission). `createPermissions()`, `grantPermission`, `denyPermission`, `needsPrompt(s, app)` — true while not granted (denied re-asks next foreground, roughly real). Tests.

### Task 3: screen modes shade + permission
`screen.ts` mode union grows `'shade' | 'permission'`. `screenOnShade(s)` (keeps underlying app like recents), `screenOnShadeDismissed`, `screenOnPermissionRequest(s, app)` → `{mode:'permission', app}`, `screenOnPermissionResolved(s)` → `{mode:'app', app}`. Kill semantics mirror recents. Tests.

### Task 4: glass rendering
surfaceFlinger.ts: status-bar per-app notification dots (small APP_COLORS chips on the status bar, visible when pending); shade overlay (rows per pending notification: colored bar + app label, tap target); permission overlay (dark sheet + "camera wants CAMERA permission" label + Allow green / Deny gray buttons). Exports: `statusBarMesh()`, `shadeRowMeshes()`, `permissionButtons()`, `setNotifications(apps)`. Tooltips teach NotificationManagerService, channels/importance one-liner, PendingIntent, runtime permissions + PMS.

### Task 5: wiring
main.ts: notification post on `data:fetched` while app ≠ foreground (background sync pattern) → packet ward→cityhall→display; status-bar tap → shade; row tap → dismiss + `clickKiosk(app)` (PendingIntent); Back dismisses shade. Permission: `activity:resumed` for camera while `needsPrompt` → `screenOnPermissionRequest`; Allow/Deny buttons resolve, record, packet display→cityhall (PMS). Icon tooltip gains the input-dispatch sentence (touch controller → kernel → InputDispatcher in system_server → app main thread).

### Task 6: docs
android-flow-reference: Notifications 📖→modeled, permissions shipped note, input path named; changelog entry. README one line.

### Verification
Build+tests each task; deploy once at end; browser: background fetch → dot appears → shade → tap → app foregrounds; camera first launch → dialog → Allow; camera relaunch → no dialog.
