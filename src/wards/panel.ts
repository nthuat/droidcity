import { makePanel, type Panel } from '../ui/panel'

const BLOCK_MAIN_THREAD_MS = 8000

export interface WardPanelActions {
  blockMainThread(app: string, ms: number): void
  rotate(app: string): void
  forceGc(app: string): void
  refreshData(app: string): void
}

export function buildWardPanel(app: string, actions: WardPanelActions, narration: string): Panel {
  const panel = makePanel(`${app} — app process`)
  panel.addButton('Block main thread (8s)', () => actions.blockMainThread(app, BLOCK_MAIN_THREAD_MS))
  panel.addButton('Rotate', () => actions.rotate(app))
  panel.addButton('Force GC', () => actions.forceGc(app))
  panel.addButton('Refresh data', () => actions.refreshData(app))
  panel.setNarration(narration)
  return panel
}
