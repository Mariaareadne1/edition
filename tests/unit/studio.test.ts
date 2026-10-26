import { describe, expect, it } from 'vitest'
import { studioReducer, type StudioState } from '../../src/state/useStudio'

const base: StudioState = { view: 'print', activePlate: 1, tool: 'move', loupeScale: 1, separated: false, trayOpen: false, drawerOpen: false, hint: true }

describe('studio state (editor/presentation only)', () => {
  it('viewing a plate alone puts that plate in hand', () => {
    expect(studioReducer(base, { type: 'view', view: 'ink1' })).toMatchObject({ view: 'ink1', activePlate: 0 })
    expect(studioReducer(base, { type: 'view', view: 'source' })).toMatchObject({ view: 'source', activePlate: 1 })
  })
  it('picking up the other plate while viewing one alone switches the view with it', () => {
    const solo = studioReducer(base, { type: 'view', view: 'ink2' })
    expect(studioReducer(solo, { type: 'plate', plate: 0 })).toMatchObject({ view: 'ink1', activePlate: 0 })
    expect(studioReducer(base, { type: 'plate', plate: 0 })).toMatchObject({ view: 'print', activePlate: 0 })
  })
  it('toggles the loupe and keeps unchanged state identical (no needless re-render)', () => {
    const on = studioReducer(base, { type: 'toggleLoupe' })
    expect(on.tool).toBe('loupe')
    expect(studioReducer(on, { type: 'toggleLoupe' }).tool).toBe('move')
    expect(studioReducer(base, { type: 'separated', on: false })).toBe(base)
  })
})
