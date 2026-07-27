import { createCity } from './scene/city'
import { makeBuilding } from './scene/builders'

const city = createCity(document.querySelector<HTMLDivElement>('#app')!)
city.scene.add(makeBuilding(4, 8, 4, 0x3fb950, 'MainActivity'))
city.start(() => {})
