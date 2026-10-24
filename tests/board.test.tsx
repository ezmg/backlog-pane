import { describe, expect, test } from 'claude-code/testing'

import { columnWidth, fit, hit, locate } from '../hooks/board'
import type { BoardProps } from '../types'
import { PANE, open, world } from './fixtures'

// The board is laid out 60 cells wide, so each of the three columns (To Do,
// In Progress, Done) is 20 wide: x 0-19, 20-39, 40-59. Row 0 is the
// headings, row 1 the first card of each column.
const SIZE = { columns: 60, rows: 4, in: 'board' } as const
const TODO = 5
const DOING = 25
const DONE = 45

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the board draws one column per status, in theme colours`, async ($, on) => {
    const { clock } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    const client = await ui.find({ type: 'Client' })
    expect(client?.key).toBe('board')
    expect(client?.props.module).toBe('hooks/board.tsx')
    // The native list is not drawn beside it.
    expect(await ui.find({ key: 'task:BL-1' })).toBe(undefined)

    await ui.resize(SIZE)
    expect((await ui.find({ type: 'Text', text: 'To Do (1)', in: 'board' }))?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: 'In Progress (1)', in: 'board' }))?.props.color).toBe('warning')
    expect((await ui.find({ type: 'Text', text: 'Done (1)', in: 'board' }))?.props.color).toBe('success')
    expect(await ui.find({ type: 'Text', text: /BL-1 Write parser/, in: 'board' })).toBeDefined()
    // High priority: "!" in the error colour, not colour alone.
    expect((await ui.find({ type: 'Text', text: /! BL-2 Add login/, in: 'board' })) ?? null).not.toBe(null)
    expect((await ui.find({ type: 'Text', text: /^!$/, in: 'board' }))?.props.color).toBe('error')
    expect(await ui.find({ type: 'Text', text: /Drag a card/, in: 'board' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: dragging a card to another column moves it`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.pointer({ type: 'down', x: TODO, y: 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'move', x: DOING, y: 1, button: 'left', in: 'board' })
    // The column under the card is marked while it is dragged.
    expect((await ui.find({ type: 'Text', text: 'In Progress (1)', in: 'board' }))?.props.inverse).toBe(true)
    await ui.pointer({ type: 'up', x: DOING, y: 1, button: 'left', in: 'board' })
    expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'In Progress']])
    expect(await ui.find({ type: 'Text', text: 'Moved BL-2 to In Progress.' })).toBeDefined()
    // Shown in its new column at once.
    expect(await ui.find({ type: 'Text', text: 'In Progress (2)', in: 'board' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: a drag released where it started, or outside the board, moves nothing`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.pointer({ type: 'down', x: TODO, y: 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'move', x: TODO + 3, y: 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: TODO + 3, y: 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'down', x: TODO, y: 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'move', x: 90, y: 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: 90, y: 1, button: 'left', in: 'board' })
    expect(edits()).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: click a card, then another column, to move it; click it again to open it`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    await ui.pointer({ type: 'down', x: TODO, y: 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: TODO, y: 1, button: 'left', in: 'board' })
    expect((await ui.find({ type: 'Text', text: /BL-2 Add login/, in: 'board' }))?.props.inverse).toBe(true)
    // The blank row under the Done column.
    await ui.pointer({ type: 'down', x: DONE, y: 2, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DONE, y: 2, button: 'left', in: 'board' })
    expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'Done']])

    // BL-1 is selected by its first click and opened by the second.
    await ui.pointer({ type: 'down', x: DOING, y: 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DOING, y: 1, button: 'left', in: 'board' })
    expect(await ui.find({ key: 'back' })).toBe(undefined)
    await ui.pointer({ type: 'down', x: DOING, y: 1, button: 'left', in: 'board' })
    await ui.pointer({ type: 'up', x: DOING, y: 1, button: 'left', in: 'board' })
    expect(await ui.find({ key: 'back' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: 'Parse the **stream**.' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: with the focus, ←/→ move the selected card and ↑/↓ change it`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(SIZE)
    // The first key selects the first card.
    await ui.key({ key: 'down', in: 'board' })
    expect((await ui.find({ type: 'Text', text: /BL-2 Add login/, in: 'board' }))?.props.inverse).toBe(true)
    await ui.key({ key: 'left', in: 'board' })
    expect(edits()).toEqual([])
    await ui.key({ key: 'right', in: 'board' })
    expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'In Progress']])
    // BL-2 now sits under BL-1 in In Progress, still selected.
    expect((await ui.find({ type: 'Text', text: /BL-2 Add login/, in: 'board' }))?.props.inverse).toBe(true)
    await ui.key({ key: 'up', in: 'board' })
    expect((await ui.find({ type: 'Text', text: /BL-1 Write parser/, in: 'board' }))?.props.inverse).toBe(true)
    await ui.key({ key: 'right', in: 'board' })
    expect(edits()).toContainEqual(['task', 'edit', 'BL-1', '--status', 'Done'])
    await ui.key({ key: 'right', in: 'board' })
    expect(edits()).toHaveLength(2)
    await ui.key({ key: 'return', in: 'board' })
    expect(await ui.find({ key: 'back' })).toBeDefined()
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

test('Spanish: the board hint', { options: { language: 'es' } }, async ($, on) => {
  const { clock } = world(on)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize(SIZE)
  expect(await ui.find({ type: 'Text', text: /Arrastra una tarjeta/, in: 'board' })).toBeDefined()
  await ui.unmount()
})

describe('board layout', () => {
  const props: BoardProps = {
    columns: [
      { status: 'To Do', color: 'suggestion', total: 2, cards: [{ id: 'A-1', title: 'a', isHigh: false }, { id: 'A-2', title: 'b', isHigh: true }] },
      { status: 'Done', color: 'success', total: 0, cards: [] },
    ],
    width: 40,
    hint: '',
  }

  test('columns share the width, never under 8 cells', async () => {
    expect(columnWidth(props, 0)).toBe(20)
    expect(columnWidth(props, 30)).toBe(15)
    expect(columnWidth(props, 10)).toBe(8)
  })

  test('a cell maps to a column and a card', async () => {
    expect(hit(props, 20, 3, 2)).toEqual({ column: 0, card: props.columns[0]?.cards[1] })
    expect(hit(props, 20, 25, 1)).toEqual({ column: 1, card: undefined })
    expect(hit(props, 20, 3, 0)).toEqual({ column: 0, card: undefined })
    expect(hit(props, 20, 45, 1)).toBe(undefined)
    // The blank row under the tallest column takes drops; the hint does not.
    expect(hit(props, 20, 25, 3)).toEqual({ column: 1, card: undefined })
    expect(hit(props, 20, 3, 4)).toBe(undefined)
    expect(hit(props, 20, -1, 1)).toBe(undefined)
    expect(locate(props, 'A-2')).toEqual({ column: 0, row: 2 })
    expect(locate(props, 'A-9')).toBe(undefined)
  })

  test('long titles are cut with an ellipsis', async () => {
    expect(fit('BL-1 Write the parser', 10)).toBe('BL-1 Writ…')
    expect(fit('short', 10)).toBe('short')
  })
})
