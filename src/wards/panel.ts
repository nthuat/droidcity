import { makePanel, type Panel } from '../ui/panel'

const BLOCK_MAIN_THREAD_MS = 8000

export interface WardPanelActions {
  blockMainThread(app: string, ms: number): void
  rotate(app: string): void
  forceGc(app: string): void
  callNative(app: string): void
  nativeCrash(app: string): void
  refreshData(app: string): void
  goHome(app: string): void
  toggleService(app: string): boolean
  toggleForegroundService(app: string): boolean
  pushActivity(app: string, mode?: 'standard' | 'singleTop'): void
  popActivity(app: string): void
  toggleBind(app: string): void
}

export interface WardPanel extends Panel {
  // Manager calls this every frame (alongside setNarration) so the button
  // label reflects entry.serviceRunning even when toggled programmatically
  // (e.g. a story chapter calling ctx.wards.toggleService directly) rather
  // than via this panel's own click handler.
  syncService(running: boolean): void
  // Same idea for the bind button: reflects boundTo / the current "next
  // living ward" target even when bind state changes off-panel (e.g. a ward
  // it was bound to dying).
  syncBind(boundTo: string | null, nextTarget: string | null): void
}

export function buildWardPanel(
  app: string,
  actions: WardPanelActions,
  narration: string,
  serviceRunning: boolean,
): WardPanel {
  const panel = makePanel(`${app} — app process`)
  panel.addButton('Block main thread (8s)', () => actions.blockMainThread(app, BLOCK_MAIN_THREAD_MS))
  panel.addButton('Rotate', () => actions.rotate(app))
  panel.addButton('Open screen', () => actions.pushActivity(app))
  panel.addButton('Open (singleTop)', () => actions.pushActivity(app, 'singleTop'))
  panel.addButton('Back', () => actions.popActivity(app))
  panel.addButton('Force GC', () => actions.forceGc(app))
  panel.addButton('JNI → native', () => actions.callNative(app))
  panel.addButton('Native crash (SIGSEGV)', () => actions.nativeCrash(app))
  panel.addButton('Refresh data', () => actions.refreshData(app))
  const serviceBtn = panel.addButton(serviceRunning ? 'Stop service' : 'Start service', () => actions.toggleService(app))
  panel.addButton('Promote to FGS', () => actions.toggleForegroundService(app))
  const bindBtn = panel.addButton('Bind to —', () => actions.toggleBind(app))
  panel.addButton('Home', () => actions.goHome(app))
  panel.setNarration(narration)
  return {
    ...panel,
    syncService(running) {
      const label = running ? 'Stop service' : 'Start service'
      if (serviceBtn.textContent !== label) serviceBtn.textContent = label
    },
    syncBind(boundTo, nextTarget) {
      const label = boundTo ? 'Unbind' : `Bind to ${nextTarget ?? '—'}`
      if (bindBtn.textContent !== label) bindBtn.textContent = label
    },
  }
}
