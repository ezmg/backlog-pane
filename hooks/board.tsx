// The board's surface module: one column per status, drawn by a `Client`
// on the terminal and the desktop. It holds no `$`: a move or an open is
// posted to the hooks module (`ui.message`), which runs the backlog command.
//
// Every card is one row, so a pointer's cell maps straight to a card: row 0
// of a column is its heading, row 1 its first card. Clicking a card selects
// it; dragging it to another column, or clicking another column while it is
// selected, moves it; clicking it again opens it. With the focus here, ←/→
// move the selected card, ↑/↓ pick another, Enter opens it.

import type { ClientModule } from 'claude-code'

import type { BoardCard, BoardMessage, BoardProps } from '../types'

type Drag = { id: string; from: number; over: number; wasSelected: boolean }
type State = { selected?: string; drag?: Drag }

const MIN_WIDTH = 8

/** The width of one column, from the region's width or the pane's. */
export function columnWidth(props: BoardProps, regionColumns: number): number {
  const room = regionColumns > 0 ? regionColumns : props.width
  return Math.max(MIN_WIDTH, Math.floor(room / Math.max(1, props.columns.length)))
}

/** Where a card is: its column and its row (1 for the first card). */
export function locate(props: BoardProps, id: string | undefined): { column: number; row: number } | undefined {
  if (!id) return undefined
  for (const [column, one] of props.columns.entries()) {
    const at = one.cards.findIndex(card => card.id === id)
    if (at !== -1) return { column, row: at + 1 }
  }
  return undefined
}

/** What lies under a cell: a column, and the card there if any. */
export function hit(
  props: BoardProps,
  width: number,
  x: number,
  y: number,
): { column: number; card?: BoardCard } | undefined {
  const column = Math.floor(x / width)
  // Below the tallest column one blank row is drawn, so every column has
  // an empty cell to drop on.
  const tallest = Math.max(0, ...props.columns.map(one => one.cards.length))
  if (x < 0 || column >= props.columns.length || y < 0 || y > tallest + 1) return undefined
  return { column, card: props.columns[column]?.cards[y - 1] }
}

/** Cuts a text to `width` cells, an ellipsis at the cut. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

const Board: ClientModule<BoardProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = columnWidth(props, surface.columns)
  const state = surface.state ?? {}

  const post = (message: BoardMessage) => surface.post(message)
  const move = (id: string, column: number) => {
    const target = props.columns[column]
    if (target) post({ type: 'move', id, status: target.status })
  }

  // Set again on every call, so each listener sees this call's props; the
  // state is read when the event comes, never captured.
  surface.onPointer(event => {
    const now = surface.state ?? {}
    if (event.type === 'down') {
      if (event.button !== undefined && event.button !== 'left') return
      const at = hit(props, width, event.x, event.y)
      if (!at) return
      if (at.card) {
        const id = at.card.id
        surface.setState({ selected: id, drag: { id, from: at.column, over: at.column, wasSelected: now.selected === id } })
        return
      }
      const from = locate(props, now.selected)
      if (now.selected && from && from.column !== at.column) move(now.selected, at.column)
      return
    }
    const drag = now.drag
    if (!drag) return
    if (event.type === 'move') {
      const at = hit(props, width, event.x, Math.max(0, event.y))
      const over = at ? at.column : drag.from
      if (over !== drag.over) surface.setState({ ...now, drag: { ...drag, over } })
      return
    }
    if (event.type === 'up') {
      surface.setState({ selected: now.selected })
      if (drag.over !== drag.from) move(drag.id, drag.over)
      else if (drag.wasSelected) post({ type: 'open', id: drag.id })
    }
  })

  surface.onKey(event => {
    const now = surface.state ?? {}
    const at = locate(props, now.selected)
    if (!at || !now.selected) {
      const first = props.columns.find(one => one.cards.length > 0)?.cards[0]
      if (first && ['up', 'down', 'left', 'right'].includes(event.key)) surface.setState({ selected: first.id })
      return
    }
    const cards = props.columns[at.column]?.cards ?? []
    if (event.key === 'up' || event.key === 'down') {
      const next = cards[at.row - 1 + (event.key === 'up' ? -1 : 1)]
      if (next) surface.setState({ selected: next.id })
    } else if (event.key === 'left' && at.column > 0) {
      move(now.selected, at.column - 1)
    } else if (event.key === 'right' && at.column < props.columns.length - 1) {
      move(now.selected, at.column + 1)
    } else if (event.key === 'return') {
      post({ type: 'open', id: now.selected })
    }
  })

  const drag = state.drag
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {props.columns.map((column, i) => (
          <Box key={`column:${column.status}`} flexDirection="column" width={width}>
            <Text bold color={column.color} inverse={drag !== undefined && drag.over === i && drag.over !== drag.from}>
              {fit(`${column.status} (${column.total})`, width - 1)}
            </Text>
            {column.cards.map(card => (
              <Text inverse={card.id === state.selected} dimColor={drag?.id === card.id}>
                {card.isHigh ? <Text color="error">!</Text> : ' '} {fit(`${card.id} ${card.title}`, width - 3)}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
      <Text> </Text>
      <Text dimColor>{props.hint}</Text>
    </Box>
  )
}

export default Board
