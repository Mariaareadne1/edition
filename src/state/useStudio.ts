/**
 * Editor and presentation state for the print room — which plate is in hand,
 * which view is on the table, the loupe, the lifted (separated) plates, the
 * tray and drawer. None of it is part of the print: it never enters the
 * document, the undo history or an export.
 */
import { useCallback, useMemo, useReducer } from 'react'

export type ViewMode = 'print' | 'ink1' | 'ink2' | 'source' | 'compare'
export type Tool = 'move' | 'loupe'
/** device pixels per exported pixel in the loupe */
export type LoupeScale = 1 | 2

export const VIEWS: Array<{ id: ViewMode; label: string; short: string }> = [
  { id: 'print', label: 'Print', short: 'Print' },
  { id: 'ink1', label: 'Plate 1', short: 'P1' },
  { id: 'ink2', label: 'Plate 2', short: 'P2' },
  { id: 'source', label: 'Source', short: 'Source' },
  { id: 'compare', label: 'Split', short: 'Split' },
]

export interface StudioState {
  view: ViewMode
  activePlate: 0 | 1
  tool: Tool
  loupeScale: LoupeScale
  separated: boolean
  /** phone: the tool tray sheet is open */
  trayOpen: boolean
  drawerOpen: boolean
  hint: boolean
}

export type StudioAction =
  | { type: 'view'; view: ViewMode }
  | { type: 'plate'; plate: 0 | 1 }
  | { type: 'tool'; tool: Tool }
  | { type: 'toggleLoupe' }
  | { type: 'loupeScale'; scale: LoupeScale }
  | { type: 'separated'; on: boolean }
  | { type: 'tray'; open: boolean }
  | { type: 'drawer'; open: boolean }
  | { type: 'hint'; on: boolean }

const HINT_KEY = 'edition.hint.drag'

function readHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) !== 'done'
  } catch {
    return true
  }
}

export function studioReducer(s: StudioState, a: StudioAction): StudioState {
  switch (a.type) {
    case 'view':
      // Viewing a plate alone puts that plate in hand, so dragging it works.
      return { ...s, view: a.view, activePlate: a.view === 'ink1' ? 0 : a.view === 'ink2' ? 1 : s.activePlate }
    case 'plate':
      // Picking up the other plate while viewing one alone switches the view with it.
      return { ...s, activePlate: a.plate, view: s.view === 'ink1' || s.view === 'ink2' ? (a.plate === 0 ? 'ink1' : 'ink2') : s.view }
    case 'tool':
      return { ...s, tool: a.tool }
    case 'toggleLoupe':
      return { ...s, tool: s.tool === 'loupe' ? 'move' : 'loupe' }
    case 'loupeScale':
      return { ...s, loupeScale: a.scale }
    case 'separated':
      return s.separated === a.on ? s : { ...s, separated: a.on }
    case 'tray':
      return { ...s, trayOpen: a.open }
    case 'drawer':
      return { ...s, drawerOpen: a.open }
    case 'hint':
      return { ...s, hint: a.on }
  }
}

export function useStudio() {
  const [state, dispatch] = useReducer(studioReducer, undefined, (): StudioState => ({
    view: 'print', activePlate: 1, tool: 'move', loupeScale: 1, separated: false, trayOpen: false, drawerOpen: false, hint: readHint(),
  }))

  const dismissHint = useCallback(() => {
    dispatch({ type: 'hint', on: false })
    try {
      localStorage.setItem(HINT_KEY, 'done')
    } catch {
      /* private mode: the hint simply returns next visit */
    }
  }, [])

  const actions = useMemo(() => ({
    setView: (view: ViewMode) => dispatch({ type: 'view', view }),
    selectPlate: (plate: 0 | 1) => dispatch({ type: 'plate', plate }),
    setTool: (tool: Tool) => dispatch({ type: 'tool', tool }),
    toggleLoupe: () => dispatch({ type: 'toggleLoupe' }),
    setLoupeScale: (scale: LoupeScale) => dispatch({ type: 'loupeScale', scale }),
    setSeparated: (on: boolean) => dispatch({ type: 'separated', on }),
    setTray: (open: boolean) => dispatch({ type: 'tray', open }),
    setDrawer: (open: boolean) => dispatch({ type: 'drawer', open }),
    dismissHint,
  }), [dismissHint])

  return { state, actions }
}

export type Studio = ReturnType<typeof useStudio>
