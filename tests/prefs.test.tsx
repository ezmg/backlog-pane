import { describe, expect, test } from 'claude-code/testing'

import { PALETTE, readPrefs, statusColors } from '../hooks/cli'
import { PANE, PREFS_KEY, open, openTask, world } from './fixtures'
import type { FakeTask } from './fixtures'

// A colour and a "closed" mark per status, chosen in the statuses view and
// kept per project in $.store, since Backlog.md's config has no place for
// them. The board's cards take their status's colour.

const STATUSES = ['Cancelled', 'To Do', 'In Progress', 'Done']
const TASKS: FakeTask[] = [
  { id: 'BL-1', title: 'Write parser', status: 'In Progress' },
  { id: 'BL-2', title: 'Add login', status: 'To Do' },
  { id: 'BL-3', title: 'Old work', status: 'Done' },
  { id: 'BL-5', title: 'Old idea', status: 'Cancelled' },
]
const BOARD = { columns: 80, rows: 12, in: 'board' } as const

for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
  test(`${surface}: a status's colour is picked from the palette and kept for the project`, async ($, on) => {
    const { clock, store } = world(on, { statuses: STATUSES, tasks: TASKS })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'statuses-open' })
    const picker = await ui.find({ key: 'status-colour-1' })
    expect(picker?.props.value).toBe('auto')
    expect((picker?.props.options as { value: string }[]).map(option => option.value)).toEqual(['auto', ...PALETTE])
    await ui.select({ key: 'status-colour-1', value: 'claude' })
    expect(store.get(PREFS_KEY)).toEqual({ colors: { 'To Do': 'claude' } })
    expect((await ui.find({ key: 'status-colour-1' }))?.props.value).toBe('claude')
    // Its swatch shows it at once.
    expect((await ui.findAll({ type: 'Text', text: '■' }))[1]?.props.color).toBe('claude')
    // Automatic goes back to the colour it had: Cancelled, open here, is
    // the first status, so To Do takes the next colour.
    await ui.select({ key: 'status-colour-1', value: 'auto' })
    expect(store.get(PREFS_KEY)).toEqual({ colors: {} })
    expect((await ui.findAll({ type: 'Text', text: '■' }))[1]?.props.color).toBe('planMode')
    await ui.unmount()
  })

  test(`${surface}: "Closed" is a checkbox, kept for the project`, async ($, on) => {
    const { clock, store, edits } = world(on, { statuses: STATUSES, tasks: TASKS })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'statuses-open' })
    expect((await ui.find({ key: 'status-closed-0' }))?.text).toBe('[ ] Closed')
    await ui.press({ key: 'status-closed-0' })
    expect((await ui.find({ key: 'status-closed-0' }))?.text).toBe('[x] Closed')
    expect(store.get(PREFS_KEY)).toEqual({ colors: {}, closed: ['Cancelled'] })
    await ui.press({ key: 'statuses-back' })
    // It now behaves as closed: ◀ from To Do has nowhere to go.
    await openTask(ui, 'BL-2')
    expect(await ui.find({ key: 'status-prev' })).toBe(undefined)
    await ui.press({ key: 'back' })
    await ui.press({ key: 'statuses-open' })
    await ui.press({ key: 'status-closed-0' })
    expect(store.get(PREFS_KEY)).toEqual({ colors: {}, closed: [] })
    expect(edits()).toEqual([])
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: cards take their status's chosen colour, and a moved card its new one`, async ($, on) => {
    const { clock } = world(on, {
      statuses: STATUSES,
      tasks: TASKS,
      store: { [PREFS_KEY]: { colors: { 'To Do': 'claude', 'In Progress': 'merged' } } },
    })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.resize(BOARD)
    expect((await ui.find({ key: 'card:BL-2', in: 'board' }))?.props.borderColor).toBe('claude')
    expect((await ui.find({ type: 'Text', text: /^ To Do $/, in: 'board' }))?.props.backgroundColor).toBe('claude')
    await ui.post({ type: 'move', id: 'BL-2', status: 'In Progress' }, { in: 'board' })
    expect((await ui.find({ key: 'card:BL-2', in: 'board' }))?.props.borderColor).toBe('merged')
    await ui.unmount()
  })
}

test('mobile: the colour cycles with a button; Closed is a checkbox there too', async ($, on) => {
  const { clock, store } = world(on, { statuses: STATUSES, tasks: TASKS })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.press({ key: 'statuses-open' })
  expect((await ui.find({ key: 'status-colour-2' }))?.text).toBe('Colour: Automatic')
  await ui.press({ key: 'status-colour-2' })
  expect((await ui.find({ key: 'status-colour-2' }))?.text).toBe('Colour: Blue')
  await ui.press({ key: 'status-colour-2' })
  expect(store.get(PREFS_KEY)).toEqual({ colors: { 'In Progress': 'ide' } })
  await ui.press({ key: 'status-closed-0' })
  expect(store.get(PREFS_KEY)).toEqual({ colors: { 'In Progress': 'ide' }, closed: ['Cancelled'] })
  await ui.unmount()
})

test('what a project kept is read back in a new session', async ($, on) => {
  const { clock } = world(on, {
    statuses: STATUSES,
    tasks: TASKS,
    store: { [PREFS_KEY]: { colors: { Done: 'error' }, closed: ['Cancelled'] } },
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'toggle:Cancelled' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: 'Done' }))?.props.color).toBe('error')
  await ui.unmount()
})

test('another project keeps its own', async ($, on) => {
  const { clock } = world(on, {
    statuses: STATUSES,
    tasks: TASKS,
    store: { 'project:/elsewhere/backlog/config.yml': { colors: {}, closed: ['Cancelled'] } },
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'toggle:Cancelled' })).toBe(undefined)
  await ui.unmount()
})

test('the closedStatuses option is where a project starts, until a box is ticked', { options: { closedStatuses: 'Cancelled' } }, async ($, on) => {
  const { clock, store } = world(on, { statuses: STATUSES, tasks: TASKS })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'statuses-open' })
  expect((await ui.find({ key: 'status-closed-0' }))?.text).toBe('[x] Closed')
  // Unticking keeps the project's own list, empty.
  await ui.press({ key: 'status-closed-0' })
  expect(store.get(PREFS_KEY)).toEqual({ colors: {}, closed: [] })
  expect((await ui.find({ key: 'status-closed-0' }))?.text).toBe('[ ] Closed')
  await ui.unmount()
})

test('deleting a status forgets its colour and its mark', async ($, on) => {
  const { clock, store } = world(on, {
    statuses: ['To Do', 'Review', 'In Progress', 'Done'],
    tasks: [],
    store: { [PREFS_KEY]: { colors: { Review: 'error', Done: 'ide' }, closed: ['Review'] } },
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'statuses-open' })
  await ui.press({ key: 'status-remove-1' })
  await ui.press({ key: 'status-remove-yes-1' })
  expect(store.get(PREFS_KEY)).toEqual({ colors: { Done: 'ide' }, closed: [] })
  await ui.unmount()
})

test('Spanish: colour names', { options: { language: 'es' } }, async ($, on) => {
  const { clock } = world(on, { statuses: STATUSES, tasks: TASKS })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'statuses-open' })
  const labels = ((await ui.find({ key: 'status-colour-1' }))?.props.options as { label: string }[]).map(
    option => option.label,
  )
  expect(labels.slice(0, 4)).toEqual(['Automático', 'Azul', 'Azul acero', 'Verde azulado'])
  expect((await ui.find({ key: 'status-closed-1' }))?.text).toBe('[ ] Cerrado')
  await ui.unmount()
})

describe('prefs', () => {
  test('only well-formed colours and lists are read back', async () => {
    expect(readPrefs(undefined)).toEqual({ colors: {} })
    expect(readPrefs({ colors: { A: 'claude', B: 'chartreuse', C: 3 }, closed: ['X', 4] })).toEqual({
      colors: { A: 'claude' },
      closed: ['X'],
    })
    expect(readPrefs('junk')).toEqual({ colors: {} })
  })

  test('a chosen colour wins over the automatic one, the final status included', async () => {
    const colors = statusColors(['To Do', 'Review', 'Done'], 'Done', [], { Done: 'claude', 'To Do': 'nope' })
    expect(Object.fromEntries(colors)).toEqual({ 'To Do': 'suggestion', Review: 'planMode', Done: 'claude' })
  })
})
