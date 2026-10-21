import { it } from 'vitest'
import { separate } from '../src/engine/separations'
import { renderSheet, sheetLayout } from '../src/engine/render'
import { paintSample } from '../src/engine/sample'
import { DEFAULT_SETTINGS as S } from '../src/state/document'

it('bench', () => {
  let t = performance.now()
  const src = paintSample(1600, 2000)
  console.log('paint 1600x2000', Math.round(performance.now() - t), 'ms')
  t = performance.now()
  const maps = separate(src, 1600, 2000, S.paper.color, S.inks, S.separation)
  console.log('separate', Math.round(performance.now() - t), 'ms')
  for (const L of [900, 1400, 3508]) {
    const layout = sheetLayout(1600, 2000, L, S.paper.margin)
    t = performance.now()
    renderSheet({ maps, source: src }, S, 'print', layout)
    console.log(`render print ${layout.width}x${layout.height}`, Math.round(performance.now() - t), 'ms')
  }
}, 120000)
