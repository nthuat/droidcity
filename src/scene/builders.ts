import * as THREE from 'three'

export function makeLabel(text: string, scale = 1): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.font = 'bold 48px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // PGSimCity-style label chip: white pill + dark ink — readable on vivid plates,
  // pale board, and dark structures alike (a bare halo failed on dark kiosks).
  const w = ctx.measureText(text).width + 44
  const x0 = 256 - w / 2
  const r = 22
  ctx.fillStyle = 'rgba(255,255,255,.92)'
  ctx.beginPath()
  ctx.roundRect(x0, 22, w, 84, r)
  ctx.fill()
  ctx.strokeStyle = 'rgba(31,41,51,.18)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.fillStyle = '#1f2933'
  ctx.fillText(text, 256, 64)
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }),
  )
  sprite.scale.set(6 * scale, 1.5 * scale, 1)
  return sprite
}

export function makeBuilding(
  w: number, h: number, d: number, color: number, label?: string,
): THREE.Group {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  )
  body.position.y = h / 2
  body.name = 'body'
  group.add(body)
  if (label) {
    const sprite = makeLabel(label)
    sprite.position.y = h + 1.2
    group.add(sprite)
  }
  return group
}

export function makeCar(color: number): THREE.Mesh {
  const car = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.4, 1),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 }),
  )
  car.position.y = 0.2
  return car
}
