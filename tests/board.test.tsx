import { describe, expect, test } from 'claude-code/testing'

import { cardLine, columnHeight, columnWidth, fit, hit, locate, nextOpenColumn } from '../hooks/board'
import type { BoardProps } from '../types'
import { PANE, open, world } from './fixtures'
import type { FakeTask } from './fixtures'

// The board is laid out 60 cells wide, so each of the three columns (To Do,
// In Progress, Done) is 18 wide with two cells between them: x 0-17, 20-37,
// 40-57. In each column, row 0 is the status chip and row 1 blank; the
// first card (a bordered box) is rows 2-5: border, title, id, border; the
// second rows 6-9; under the last card is room for the drop slot.
const SIZE = { columns: 60, rows: 12, in: 'board' } as const
const TODO = 5
const DOING = 25
const DONE = 45
const FIRST_CARD = 3
const SECOND_CARD = 6
// The drop slot under the one card each column holds at the start.
const SLOT = 6

/** The title row of a card, as the board's module drew it. */
const title = (text: RegExp) => ({ type: 'Text', text, in: 'board' })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: each card is a box bordered in its status's colour, under the status chip`, async ($, on) => {
    const { clock } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    const client = await ui.find({ type: 'Client' })
    expect(client?.key).toBe('board')
    expect(client?.props.module).toBe('hooks/board.tsx')
    // The native list is not drawn beside it.
    expect(await ui.find({ key: 'task:BL-1' })).toBe(undefined)

    await ui.resize(SIZE)
    for (const [status, color, id] of [
      ['To Do', 'suggestion', 'BL-2'],
      ['In Progress', 'warning', 'BL-1'],
      ['Done', 'success', 'BL-3'],
    ] as const) {
      const column = await ui.find({ key: `column:${status}`, in: 'board' })
      expect(column?.props.borderStyle).toBe(undefined)
      expect(column?.props.width).toBe(18)
      const card = await ui.find({ key: `card:${id}`, in: 'board' })
      expect(card?.props.borderStyle).toBe('round')
      expect(card?.props.borderColor).toBe(color)
      // The status is a chip: the status's colour behind it.
      const chip = await ui.find({ type: 'Text', text: new RegExp(`^ ${status} $`), in: 'board' })
      expect(chip?.props.backgroundColor).toBe(color)
      expect(chip?.props.color).toBe('inverseText')
    }
    // Two rows per card: the title, then the id and the criteria done.
    expect(await ui.find(title(/^Write parser$/))).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'BL-1 · 1/2', in: 'board' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'BL-2', in: 'board' })).toBeDefined()
    // High priority: "!" in the error colour, not colour alone.
    expect(await ui.find(title(/^! Add login$/))).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^! $/, in: 'board' }))?.props.color).toBe('error')
    expect(await ui.find({ type: 'Text', text: /Drag a card/, in: 'board' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: dragging a card to another column moves it`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.pointer({ type: 'down', x: TODO, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'move', x: DOING, y: FIRST_CARD, button: 'left', in: 'board' })
    // A dashed slot in the colour of the column under the card shows where it lands.
    const slot = await ui.find({ key: 'slot', in: 'board' })
    expect(slot?.props.borderStyle).toBe('dashed')
    expect(slot?.props.borderColor).toBe('warning')
    await ui.pointer({ type: 'up', x: DOING, y: FIRST_CARD, button: 'left', in: 'board' })
    expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'In Progress']])
    expect(await ui.find({ type: 'Text', text: 'Moved BL-2 to In Progress.' })).toBeDefined()
    // Shown in its new column at once, in that column's colour.
    expect(await ui.find({ type: 'Text', text: ' 2', in: 'board' })).toBeDefined()
    expect((await ui.find({ key: 'card:BL-2', in: 'board' }))?.props.borderColor).toBe('warning')
    expect(await ui.find({ key: 'slot', in: 'board' })).toBe(undefined)
    await ui.unmount()
  })

  test(`${surface}: a drag released where it started, or outside the board, moves nothing`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.pointer({ type: 'down', x: TODO, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'move', x: TODO + 3, y: FIRST_CARD + 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: TODO + 3, y: FIRST_CARD + 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'down', x: TODO, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'move', x: 90, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: 90, y: FIRST_CARD, button: 'left', in: 'board' })
    expect(edits()).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: click a card, then another column, to move it; click it again to open it`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    // Either row of the card selects it.
    await ui.pointer({ type: 'down', x: TODO, y: FIRST_CARD + 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: TODO, y: FIRST_CARD + 1, button: 'left', in: 'board' })
    expect((await ui.find(title(/Add login/)))?.props.inverse).toBe(true)
    // The empty slot under the Done column's card.
    await ui.pointer({ type: 'down', x: DONE, y: SLOT, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DONE, y: SLOT, button: 'left', in: 'board' })
    expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'Done']])

    // BL-1 is selected by its first click and opened by the second.
    await ui.pointer({ type: 'down', x: DOING, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DOING, y: FIRST_CARD, button: 'left', in: 'board' })
    expect(await ui.find({ key: 'back' })).toBe(undefined)
    await ui.pointer({ type: 'down', x: DOING, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DOING, y: FIRST_CARD, button: 'left', in: 'board' })
    expect(await ui.find({ key: 'back' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: 'Parse the **stream**.' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: a dragged card is let go of, so a later click does not move it again`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.pointer({ type: 'down', x: TODO, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'move', x: DOING, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DOING, y: FIRST_CARD, button: 'left', in: 'board' })
    expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'In Progress']])
    expect((await ui.find(title(/Add login/)))?.props.inverse).toBe(false)
    // A click on an empty spot of another column, later.
    await ui.pointer({ type: 'down', x: DONE, y: 11, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DONE, y: 11, button: 'left', in: 'board' })
    // And a click on the moved card: it selects it, it does not open it.
    await ui.pointer({ type: 'down', x: DOING, y: SECOND_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DOING, y: SECOND_CARD, button: 'left', in: 'board' })
    expect(edits()).toHaveLength(1)
    expect(await ui.find({ key: 'back' })).toBe(undefined)
    await ui.unmount()
  })

  test(`${surface}: a card moved by click is let go of too`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.pointer({ type: 'down', x: TODO, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: TODO, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'down', x: DONE, y: SLOT, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DONE, y: SLOT, button: 'left', in: 'board' })
    expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'Done']])
    await ui.pointer({ type: 'down', x: DOING, y: 11, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DOING, y: 11, button: 'left', in: 'board' })
    expect(edits()).toHaveLength(1)
    await ui.unmount()
  })

  test(`${surface}: a click on an empty spot lets go of the selected card`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.pointer({ type: 'down', x: TODO, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: TODO, y: FIRST_CARD, button: 'left', in: 'board' })
    expect((await ui.find(title(/Add login/)))?.props.inverse).toBe(true)
    // An empty spot of its own column: nothing moves, the card is let go of.
    await ui.pointer({ type: 'down', x: TODO, y: SLOT, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: TODO, y: SLOT, button: 'left', in: 'board' })
    expect((await ui.find(title(/Add login/)))?.props.inverse).toBe(false)
    await ui.pointer({ type: 'down', x: DONE, y: SLOT, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DONE, y: SLOT, button: 'left', in: 'board' })
    expect(edits()).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: a card picked with the keys is not moved by a click`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.key({ key: 'down', in: 'board' })
    expect((await ui.find(title(/Add login/)))?.props.inverse).toBe(true)
    await ui.pointer({ type: 'down', x: DONE, y: SLOT, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DONE, y: SLOT, button: 'left', in: 'board' })
    expect(edits()).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: with the focus, ←/→ move the selected card and ↑/↓ change it`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    // The first key selects the first card.
    await ui.key({ key: 'down', in: 'board' })
    expect((await ui.find(title(/Add login/)))?.props.inverse).toBe(true)
    // Its second row is marked with it.
    expect((await ui.find({ type: 'Text', text: 'BL-2', in: 'board' }))?.props.inverse).toBe(true)
    await ui.key({ key: 'left', in: 'board' })
    expect(edits()).toEqual([])
    await ui.key({ key: 'right', in: 'board' })
    expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'In Progress']])
    // BL-2 now sits under BL-1 in In Progress, still selected.
    expect((await ui.find(title(/Add login/)))?.props.inverse).toBe(true)
    await ui.key({ key: 'up', in: 'board' })
    expect((await ui.find(title(/Write parser/)))?.props.inverse).toBe(true)
    await ui.key({ key: 'right', in: 'board' })
    expect(edits()).toContainEqual(['task', 'edit', 'BL-1', '--status', 'Done'])
    await ui.key({ key: 'right', in: 'board' })
    expect(edits()).toHaveLength(2)
    await ui.key({ key: 'return', in: 'board' })
    expect(await ui.find({ key: 'back' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: the second card of a column is two cards down`, async ($, on) => {
    const { clock } = world(on, {
      tasks: [
        { id: 'BL-1', title: 'One', status: 'To Do' },
        { id: 'BL-2', title: 'Two', status: 'To Do' },
      ],
    })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.pointer({ type: 'down', x: TODO, y: SECOND_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: TODO, y: SECOND_CARD, button: 'left', in: 'board' })
    expect((await ui.find(title(/^Two$/)))?.props.inverse).toBe(true)
    expect((await ui.find(title(/^One$/)))?.props.inverse).toBe(false)
    await ui.unmount()
  })

  test(`${surface}: posts that name no shown task or status are ignored`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.post({ type: 'move', id: 'BL-99', status: 'Done' }, { in: 'board' })
    await ui.post({ type: 'move', id: 'BL-2', status: 'Nowhere' }, { in: 'board' })
    await ui.post({ type: 'move', id: 'BL-2', status: 'To Do' }, { in: 'board' })
    await ui.post({ type: 'rm -rf', id: 'BL-2' }, { in: 'board' })
    await ui.post('BL-2', { in: 'board' })
    expect(edits()).toEqual([])
    expect(await ui.find({ key: 'back' })).toBe(undefined)
    await ui.unmount()
  })

  test(`${surface}: once the board has failed, the native list stands in`, async ($, on) => {
    const { clock } = world(on)
    // What the mod's ui.fault hook records when the Client fails. (The kit
    // raises ui.fault for a module that throws; this one does not, so the
    // value is seeded as the hook leaves it, once the session has started.)
    let hasFailed = false
    on('state.get', (_, e, next) =>
      hasFailed && e.key === 'isBoardFailed' ? { value: { value: true, version: 1 } } : next(e),
    )
    await open($, clock)
    hasFailed = true
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Client' })).toBe(undefined)
    expect(await ui.find({ key: 'task:BL-1' })).toBeDefined()
    await ui.unmount()
  })
}

const WITH_CANCELLED: FakeTask[] = [
  { id: 'BL-1', title: 'Write parser', status: 'In Progress' },
  { id: 'BL-2', title: 'Add login', status: 'To Do' },
  { id: 'BL-5', title: 'Old idea', status: 'Cancelled' },
]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: closed statuses are drawn dim and the arrow keys skip them`, { options: { closedStatuses: 'cancelled' } }, async ($, on) => {
    const { clock, edits } = world(on, {
      statuses: ['Cancelled', 'To Do', 'In Progress', 'Done'],
      tasks: WITH_CANCELLED,
    })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    // Four columns in 60 cells, two apart: 13 each.
    await ui.resize(SIZE)
    const card = await ui.find({ key: 'card:BL-5', in: 'board' })
    expect(card?.props.borderColor).toBe('inactive')
    expect(card?.props.borderDimColor).toBe(true)
    expect((await ui.find(title(/^Old idea$/)))?.props.dimColor).toBe(true)
    // The first open status takes the first colour.
    expect((await ui.find({ key: 'card:BL-2', in: 'board' }))?.props.borderColor).toBe('suggestion')

    // The first key selects the first open card, not the closed one.
    await ui.key({ key: 'down', in: 'board' })
    expect((await ui.find(title(/Add login/)))?.props.inverse).toBe(true)
    // ← from To Do: the only column to its left, Cancelled, is closed.
    await ui.key({ key: 'left', in: 'board' })
    expect(edits()).toEqual([])
    await ui.key({ key: 'right', in: 'board' })
    await ui.key({ key: 'right', in: 'board' })
    expect(edits()).toEqual([
      ['task', 'edit', 'BL-2', '--status', 'In Progress'],
      ['task', 'edit', 'BL-2', '--status', 'Done'],
    ])
    await ui.unmount()
  })

  test(`${surface}: a card can still be dragged into a closed status`, { options: { closedStatuses: 'Cancelled' } }, async ($, on) => {
    const { clock, edits } = world(on, {
      statuses: ['Cancelled', 'To Do', 'In Progress', 'Done'],
      tasks: WITH_CANCELLED,
    })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    // Columns of 13, two cells apart: Cancelled 0-12, To Do 15-27.
    await ui.pointer({ type: 'down', x: 17, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'move', x: 3, y: FIRST_CARD, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: 3, y: FIRST_CARD, button: 'left', in: 'board' })
    expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'Cancelled']])
    await ui.unmount()
  })
}

test('Spanish: the board hint', { options: { language: 'es' } }, async ($, on) => {
  const { clock } = world(on)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SIZE)
  expect(await ui.find({ type: 'Text', text: /Arrastra una tarjeta/, in: 'board' })).toBeDefined()
  await ui.unmount()
})

describe('board layout', () => {
  const card = (id: string, title: string, isHigh = false) => ({ id, title, isHigh, criteria: null })
  const props: BoardProps = {
    columns: [
      { status: 'To Do', color: 'suggestion', total: 2, isClosed: false, cards: [card('A-1', 'a'), card('A-2', 'b', true)] },
      { status: 'Won’t do', color: 'inactive', total: 0, isClosed: true, cards: [] },
      { status: 'Done', color: 'success', total: 0, isClosed: false, cards: [] },
    ],
    width: 62,
    hint: '',
  }

  test('columns share the width two cells apart, never under 12 cells', async () => {
    expect(columnWidth(props, 0)).toBe(19)
    expect(columnWidth(props, 50)).toBe(15)
    expect(columnWidth(props, 20)).toBe(12)
  })

  test('columns are as tall as the tallest, plus room for the drop slot', async () => {
    // Chip, blank, two cards of four rows (border, title, id, border), a slot of three.
    expect(columnHeight(props)).toBe(13)
    expect(columnHeight({ ...props, columns: [] })).toBe(5)
  })

  test('a cell maps to a column and a card', async () => {
    const [first, second] = props.columns[0]?.cards ?? []
    // The chip and the blank under it: the column alone.
    expect(hit(props, 20, 3, 0)).toEqual({ column: 0, card: undefined })
    expect(hit(props, 20, 3, 1)).toEqual({ column: 0, card: undefined })
    // Every row of a card, its borders included.
    for (const y of [2, 3, 4, 5]) expect(hit(props, 20, 3, y)).toEqual({ column: 0, card: first })
    for (const y of [6, 7, 8, 9]) expect(hit(props, 20, 3, y)).toEqual({ column: 0, card: second })
    expect(hit(props, 20, 3, 10)).toEqual({ column: 0, card: undefined })
    // The gap after a column belongs to it; the second column starts at 22.
    expect(hit(props, 20, 21, 3)).toEqual({ column: 0, card: first })
    expect(hit(props, 20, 22, 3)).toEqual({ column: 1, card: undefined })
    // Past the last column, and under the columns (the hint), nothing.
    expect(hit(props, 20, 66, 3)).toBe(undefined)
    expect(hit(props, 20, 3, 13)).toBe(undefined)
    expect(hit(props, 20, -1, 3)).toBe(undefined)
    expect(locate(props, 'A-2')).toEqual({ column: 0, row: 1 })
    expect(locate(props, 'A-9')).toBe(undefined)
  })

  test('the arrow keys skip closed columns', async () => {
    expect(nextOpenColumn(props, 0, 1)).toBe(2)
    expect(nextOpenColumn(props, 2, -1)).toBe(0)
    expect(nextOpenColumn(props, 0, -1)).toBe(undefined)
  })

  test('the second line keeps the criteria count in a narrow column', async () => {
    expect(cardLine('BL-1', '1/2', 20)).toBe('BL-1 · 1/2')
    expect(cardLine('TASK-12', '0/2', 11)).toBe('TASK-12 0/2')
    expect(cardLine('TASK-123', '10/12', 11)).toBe('TASK… 10/12')
    expect(cardLine('TASK-123', null, 6)).toBe('TASK-…')
  })

  test('long titles are cut with an ellipsis', async () => {
    expect(fit('Write the parser', 10)).toBe('Write the…')
    expect(fit('short', 10)).toBe('short')
  })
})
