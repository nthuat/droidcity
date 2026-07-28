export interface Panel {
  root: HTMLElement
  addButton(label: string, onClick: () => void): HTMLButtonElement
  setNarration(text: string): void
}

export function makePanel(title: string): Panel {
  const root = document.createElement('div')
  root.className = 'panel-content'
  const h = document.createElement('h2')
  h.textContent = title
  const buttons = document.createElement('div')
  buttons.className = 'panel-buttons'
  const narration = document.createElement('p')
  narration.className = 'panel-narration'
  root.append(h, buttons, narration)
  return {
    root,
    addButton(label, onClick) {
      const b = document.createElement('button')
      b.textContent = label
      b.addEventListener('click', onClick)
      buttons.appendChild(b)
      return b
    },
    setNarration(text) {
      narration.textContent = text
    },
  }
}
