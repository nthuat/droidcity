// The live oom_adj table: a tiny dumpsys view of who lmkd takes next.
// Pseudo-rows cover the two processes the city does not simulate as wards.

interface ProcRow { name: string; oomAdj: number }

export interface OomTable {
  refresh(): void
  // Hidden during a boot replay, when the city is dimmed and nothing is running.
  setVisible(visible: boolean): void
}

export function createOomTable(foundry: { stats(): { procList: readonly ProcRow[] } }): OomTable {
  const el = document.createElement('div')
  el.id = 'oom-table'
  document.body.appendChild(el)

  return {
    setVisible(visible) { el.style.display = visible ? '' : 'none' },
    refresh() {
      // Every row, live processes AND the two static ones, goes through ONE
      // sort. Appending the static rows afterwards used to rank launcher (600)
      // below a foreground app (0), which contradicted the title: lmkd walks
      // this list from the top.
      const rows = [
        ...foundry.stats().procList.map(p => ({ name: p.name, score: p.oomAdj, static: false })),
        { name: 'launcher', score: 600, static: true },
        { name: 'system_server', score: -900, static: true },
      ].sort((a, b) => b.score - a.score)
      const line = (score: number | string, name: string, cls = '') =>
        `<div class="oom-row ${cls}"><span>${String(score).padStart(4)}</span><span>${name}</span></div>`
      const victimIdx = rows.findIndex(r => !r.static && r.score >= 900)
      el.innerHTML =
        '<div class="oom-title">oom_adj · kill order</div>'
        + '<div class="oom-sub">first to die, top down</div>'
        + rows.map((r, i) => line(
          r.score,
          r.name,
          [r.static ? 'oom-static' : '', i === victimIdx ? 'oom-victim' : ''].filter(Boolean).join(' '),
        )).join('')
    },
  }
}
