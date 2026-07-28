import { makePanel, type Panel } from '../ui/panel'

const BLOCK_MAIN_THREAD_MS = 8000

export interface WardPanelActions {
  blockMainThread(app: string, ms: number): void
  rotate(app: string): void
  forceGc(app: string): void
  refreshData(app: string): void
  goHome(app: string): void
  toggleService(app: string): boolean
}

export interface WardPanel extends Panel {
  // Manager calls this every frame (alongside setNarration) so the button
  // label reflects entry.serviceRunning even when toggled programmatically
  // (e.g. a story chapter calling ctx.wards.toggleService directly) rather
  // than via this panel's own click handler.
  syncService(running: boolean): void
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
  panel.addButton('Force GC', () => actions.forceGc(app))
  panel.addButton('Refresh data', () => actions.refreshData(app))
  const serviceBtn = panel.addButton(serviceRunning ? 'Stop service' : 'Start service', () => actions.toggleService(app))
  panel.addButton('Home', () => actions.goHome(app))
  panel.setNarration(narration)
  return {
    ...panel,
    syncService(running) {
      serviceBtn.textContent = running ? 'Stop service' : 'Start service'
    },
  }
}
