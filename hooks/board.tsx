// The board's surface module: one column per status, drawn by a `Client`
// on the terminal and the desktop. It holds no `$`: a move or an open is
// posted to the hooks module (`ui.message`), which runs the backlog command.
//
// The layout is computed, not measured, so a pointer's cell maps straight
// to a card (`layout`, which the drawing and `hit` share). Each column is
// `width` cells wide, two cells apart. Row 0 is its status (a chip in the
// status's colour) and row 1 is blank; then each card is a rounded box in
// that colour, so a card moved to another column takes that column's
// colour: its border, its title (one line, or two when it does not fit),
// its id and criteria, its border. A dashed slot under the cards of the
// column a card is dragged over marks where it will land.
//
// Clicking a card selects it; clicking it again opens it, and clicking
// another column then moves it there. Dragging a card to another column
// moves it. A card moved by the pointer is let go of, so a later click
// cannot move it again; a click on an empty spot lets go of it too. With
// the focus here, ←/→ move the selected card to the nearest open column
// (closed ones are skipped), ↑/↓ pick another, Enter opens it.

import type { ClientModule } from 'claude-code'

import type { BoardCard, BoardMessage, BoardProps } from '../types'

type Drag = { id: string; from: number; over: number; wasSelected: boolean }
/**
 * `isArmed`: the selected card was picked by a click and has not moved since,
 * so a click on another column moves it there. A drag that moved a card, a
 * move by click, or a click on an empty spot leaves nothing selected; a card
 * picked with the keys is never armed (←/→ move it).
 */
type State = { selected?: string; isArmed?: boolean; drag?: Drag }

const MIN_WIDTH = 12
const GAP = 2
/** Rows above a column's first card: the chip and a blank. */
const HEAD = 2
/** Rows the drop slot takes: a dashed box of one line. */
const SLOT = 3
/** Cells inside a card: the column's width less the card's border and a cell of padding each side. */
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

/** Each card's title lines, its first row and its rows, from the top of its column. */
export type Layout = {
  cards: { lines: string[]; top: number; rows: number }[][]
  /** Rows of every column, the drop slot included: all are as tall as the tallest. */
  height: number
}

export function layout(props: BoardProps, width: number): Layout {
  const inner = innerOf(width)
  let tallest = HEAD
  const cards = props.columns.map(column => {
    let top = HEAD
    const placed = column.cards.map(card => {
      const lines = wrapTitle(card.title, inner - (card.isHigh ? 2 : 0))
      // The border, the title, the id line, the border.
      const rows = lines.length + 3
      const one = { lines, top, rows }
      top += rows
      return one
    })
    tallest = Math.max(tallest, top)
    return placed
  })
  return { cards, height: tallest + SLOT }
}

/** Rows a column takes, the drop slot included. */
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
  const at = placed.cards[column]?.findIndex(one => y >= one.top && y < one.top + one.rows) ?? -1
  return { column, card: at === -1 ? undefined : props.columns[column]?.cards[at] }
}

/** The nearest column from `from` in `step`'s direction that is not closed. */
export function nextOpenColumn(props: BoardProps, from: number, step: 1 | -1): number | undefined {
  for (let i = from + step; i >= 0 && i < props.columns.length; i += step) {
    if (!props.columns[i]?.isClosed) return i
  }
  return undefined
}

/**
 * A card's second line in `width` cells: its id and its criteria done
 * (`BL-1 · 1/2`), closer together (`BL-1 1/2`) when that does not fit, and
 * cut only then; the count is what a narrow column must not lose.
 */
export function cardLine(id: string, criteria: string | null, width: number): string {
  if (!criteria) return fit(id, width)
  for (const line of [`${id} · ${criteria}`, `${id} ${criteria}`]) if (line.length <= width) return line
  return `${fit(id, Math.max(1, width - criteria.length - 1))} ${criteria}`
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
        const wasSelected = now.selected === id && now.isArmed === true
        surface.setState({ selected: id, drag: { id, from: at.column, over: at.column, wasSelected } })
        return
      }
      const from = locate(props, now.selected)
      if (now.selected && now.isArmed && from && from.column !== at.column) move(now.selected, at.column)
      // Moved or not, a click on an empty spot lets go of the card.
      surface.setState({})
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
      if (drag.over !== drag.from) {
        // Moved: let go of it, so the next click cannot move it again.
        surface.setState({})
        move(drag.id, drag.over)
      } else if (drag.wasSelected) {
        surface.setState({})
        post({ type: 'open', id: drag.id })
      } else {
        surface.setState({ selected: drag.id, isArmed: true })
      }
    }
  })

  surface.onKey(event => {
    const now = surface.state ?? {}
    const at = locate(props, now.selected)
    if (!at || !now.selected) {
      // The first card of the first open column that has one, else of any.
      const first = (props.columns.find(one => !one.isClosed && one.cards.length > 0) ??
        props.columns.find(one => one.cards.length > 0))?.cards[0]
      if (first && ['up', 'down', 'left', 'right'].includes(event.key)) surface.setState({ selected: first.id, isArmed: false })
      return
    }
    const cards = props.columns[at.column]?.cards ?? []
    if (event.key === 'up' || event.key === 'down') {
      const next = cards[at.row + (event.key === 'up' ? -1 : 1)]
      if (next) surface.setState({ selected: next.id, isArmed: false })
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
          const label = fit(` ${column.status} `, Math.max(1, width - String(column.total).length - 1))
          return (
            <Box key={`column:${column.status}`} flexDirection="column" width={width} height={height}>
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
                  <Box
                    key={`card:${card.id}`}
                    flexDirection="column"
                    width={width}
                    paddingX={1}
                    borderStyle={isSelected ? 'bold' : 'round'}
                    borderColor={column.color}
                    borderDimColor={isFaded}
                  >
                    {lines.map((line, n) => (
                      <Text inverse={isSelected} dimColor={isFaded} bold={!column.isClosed}>
                        {n === 0 && card.isHigh ? <Text color="error">! </Text> : n > 0 && card.isHigh ? '  ' : ''}
                        {line}
                      </Text>
                    ))}
                    <Text inverse={isSelected} dimColor>
                      {cardLine(card.id, card.criteria, inner)}
                    </Text>
                  </Box>
                )
              })}
              {isTarget ? (
                <Box key="slot" width={width} height={SLOT} borderStyle="dashed" borderColor={column.color} />
              ) : null}
            </Box>
          )
        })}
      </Box>
      <Text dimColor>{props.hint}</Text>
    </Box>
  )
}

export default Board
