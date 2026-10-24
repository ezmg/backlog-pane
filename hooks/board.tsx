// The board's surface module: one column per status, drawn by a `Client`
// on the terminal and the desktop. It holds no `$`: a move or an open is
// posted to the hooks module (`ui.message`), which runs the backlog command.
//
// The layout is computed, not measured, so a pointer's cell maps straight
// to a card (`layout`, which the drawing and `hit` share). Each column is a
// rounded box `width` cells wide, one cell apart. Inside its border, row 0
// is the status (a chip in its colour) and row 1 is blank; then each card
// takes its title (one line, or two when it does not fit), its id and
// criteria, and a blank; one more empty slot, the drop target, closes
// every column. Clicking a card selects it; dragging it to another column,
// or clicking another column while it is selected, moves it; clicking it
// again opens it. With the focus here, ←/→ move the selected card to the
// nearest open column (closed ones are skipped), ↑/↓ pick another, Enter
// opens it.

import type { ClientModule } from 'claude-code'

import type { BoardCard, BoardMessage, BoardProps } from '../types'

type Drag = { id: string; from: number; over: number; wasSelected: boolean }
type State = { selected?: string; drag?: Drag }

const MIN_WIDTH = 12
const GAP = 1
/** Rows inside a column's border above its first card: the chip and a blank. */
const HEAD = 2
/** Rows the drop slot takes. */
const SLOT = 2
/** Cells inside a column: its width less the border and a cell of padding each side. */
const innerOf = (width: number) => Math.max(1, width - 4)

/** The width of one column, from the region's width or the pane's. */
export function columnWidth(props: BoardProps, regionColumns: number): number {
  const room = regionColumns > 0 ? regionColumns : props.width
  const count = Math.max(1, props.columns.length)
  return Math.max(MIN_WIDTH, Math.floor((room - GAP * (count - 1)) / count))
}

/**
 * A title in at most two lines of `width` cells, cut at a space where one
 * falls, the second line ending in an ellipsis if the title goes on.
 */
export function wrapTitle(text: string, width: number): string[] {
  if (text.length <= width) return [text]
  const space = text.lastIndexOf(' ', width)
  const cut = space > width / 3 ? space : width
  return [text.slice(0, cut).trimEnd(), fit(text.slice(cut).trimStart(), width)]
}

/** Each card's title lines and first row, from the top of the column's inside. */
export type Layout = {
  cards: { lines: string[]; top: number; rows: number }[][]
  /** Rows of every column, its border included: all are as tall as the tallest. */
  height: number
}

export function layout(props: BoardProps, width: number): Layout {
  const inner = innerOf(width)
  let tallest = HEAD
  const cards = props.columns.map(column => {
    let top = HEAD
    const placed = column.cards.map(card => {
      const lines = wrapTitle(card.title, inner - (card.isHigh ? 2 : 0))
      // The title, the id line and a blank.
      const rows = lines.length + 2
      const one = { lines, top, rows }
      top += rows
      return one
    })
    tallest = Math.max(tallest, top)
    return placed
  })
  return { cards, height: 2 + tallest + SLOT }
}

/** Rows a column takes, its border included. */
export const columnHeight = (props: BoardProps, width = 40) => layout(props, width).height

/** Where a card is: its column and its place (0 for the first card). */
export function locate(props: BoardProps, id: string | undefined): { column: number; row: number } | undefined {
  if (!id) return undefined
  for (const [column, one] of props.columns.entries()) {
    const at = one.cards.findIndex(card => card.id === id)
    if (at !== -1) return { column, row: at }
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
  const column = Math.floor(x / (width + GAP))
  const placed = layout(props, width)
  if (x < 0 || column >= props.columns.length || y < 0 || y >= placed.height) return undefined
  // From the top of the column's inside, under its border.
  const row = y - 1
  const at = placed.cards[column]?.findIndex(one => row >= one.top && row < one.top + one.rows) ?? -1
  return { column, card: at === -1 ? undefined : props.columns[column]?.cards[at] }
}

/** The nearest column from `from` in `step`'s direction that is not closed. */
export function nextOpenColumn(props: BoardProps, from: number, step: 1 | -1): number | undefined {
  for (let i = from + step; i >= 0 && i < props.columns.length; i += step) {
    if (!props.columns[i]?.isClosed) return i
  }
  return undefined
}

/** Cuts a text to `width` cells, an ellipsis at the cut. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

const Board: ClientModule<BoardProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = columnWidth(props, surface.columns)
  const placed = layout(props, width)
  const height = placed.height
  const inner = innerOf(width)
  const state = surface.state ?? {}

  const post = (message: BoardMessage) => surface.post(message)
  const move = (id: string, column: number | undefined) => {
    const target = column === undefined ? undefined : props.columns[column]
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
      const at = hit(props, width, event.x, Math.min(Math.max(0, event.y), height - 1))
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
      // The first card of the first open column that has one, else of any.
      const first = (props.columns.find(one => !one.isClosed && one.cards.length > 0) ??
        props.columns.find(one => one.cards.length > 0))?.cards[0]
      if (first && ['up', 'down', 'left', 'right'].includes(event.key)) surface.setState({ selected: first.id })
      return
    }
    const cards = props.columns[at.column]?.cards ?? []
    if (event.key === 'up' || event.key === 'down') {
      const next = cards[at.row + (event.key === 'up' ? -1 : 1)]
      if (next) surface.setState({ selected: next.id })
    } else if (event.key === 'left') {
      move(now.selected, nextOpenColumn(props, at.column, -1))
    } else if (event.key === 'right') {
      move(now.selected, nextOpenColumn(props, at.column, 1))
    } else if (event.key === 'return') {
      post({ type: 'open', id: now.selected })
    }
  })

  const drag = state.drag
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={GAP}>
        {props.columns.map((column, i) => {
          const isTarget = drag !== undefined && drag.over === i && drag.over !== drag.from
          const label = fit(` ${column.status} `, Math.max(1, inner - String(column.total).length - 1))
          return (
            <Box
              key={`column:${column.status}`}
              flexDirection="column"
              width={width}
              height={height}
              paddingX={1}
              borderStyle={isTarget ? 'double' : 'round'}
              borderColor={isTarget ? 'suggestion' : column.color}
              borderDimColor={column.isClosed && !isTarget}
            >
              <Text>
                <Text backgroundColor={column.color} color="inverseText" bold>
                  {label}
                </Text>
                <Text dimColor> {column.total}</Text>
              </Text>
              <Text> </Text>
              {column.cards.map((card, k) => {
                const isSelected = card.id === state.selected
                const isFaded = column.isClosed || drag?.id === card.id
                const lines = placed.cards[i]?.[k]?.lines ?? [card.title]
                return (
                  <Box key={`card:${card.id}`} flexDirection="column">
                    {lines.map((line, n) => (
                      <Text inverse={isSelected} dimColor={isFaded} bold={!column.isClosed}>
                        {n === 0 && card.isHigh ? <Text color="error">! </Text> : n > 0 && card.isHigh ? '  ' : ''}
                        {line}
                      </Text>
                    ))}
                    <Text inverse={isSelected} dimColor>
                      {fit(card.meta, inner)}
                    </Text>
                    <Text> </Text>
                  </Box>
                )
              })}
              <Text dimColor>{isTarget ? fit('┄'.repeat(inner), inner) : ' '}</Text>
            </Box>
          )
        })}
      </Box>
      <Text dimColor>{props.hint}</Text>
    </Box>
  )
}

export default Board
