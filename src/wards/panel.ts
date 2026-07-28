import { makePanel, type Panel } from '../ui/panel'

const BLOCK_MAIN_THREAD_MS = 8000

export interface WardPanelActions {
  blockMainThread(app: string, ms: number): void
  rotate(app: string): void
  forceGc(app: string): void
  refreshData(app: string): void
  goHome(app: string): void
  // Returns the new running state so the button label can flip without the
  // panel re-querying the manager.
  toggleService(app: string): boolean
}

export function buildWardPanel(
  app: string,
  actions: WardPanelActions,
  narration: string,
  serviceRunning: boolean,
): Panel {
  const panel = makePanel(`${app} — app process`)
  panel.addButton('Block main thread (8s)', () => actions.blockMainThread(app, BLOCK_MAIN_THREAD_MS))
  panel.addButton('Rotate', () => actions.rotate(app))
  panel.addButton('Force GC', () => actions.forceGc(app))
  panel.addButton('Refresh data', () => actions.refreshData(app))
  const serviceBtn = panel.addButton(serviceRunning ? 'Stop service' : 'Start service', () => {
    const running = actions.toggleService(app)
    serviceBtn.textContent = running ? 'Stop service' : 'Start service'
  })
  panel.addButton('Home', () => actions.goHome(app))
  panel.setNarration(narration)
  return panel
}
