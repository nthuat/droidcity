// Runtime permissions: dangerous permissions are granted by the USER at
// runtime through a system dialog, and PMS records the grant. Only the camera
// app models one here (CAMERA). Denied re-asks on the next foreground —
// roughly Android's behavior before "don't ask again". Pure and immutable.

export type PermissionGrant = 'unasked' | 'granted' | 'denied'
export type PermissionState = Readonly<Record<string, PermissionGrant>>

export function createPermissions(): PermissionState {
  return { camera: 'unasked' }
}

export function grantPermission(s: PermissionState, app: string): PermissionState {
  return { ...s, [app]: 'granted' }
}

export function denyPermission(s: PermissionState, app: string): PermissionState {
  return { ...s, [app]: 'denied' }
}

// True while the app models a dangerous permission that isn't granted yet.
export function needsPrompt(s: PermissionState, app: string): boolean {
  const g = s[app]
  return g === 'unasked' || g === 'denied'
}
