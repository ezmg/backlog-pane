import { describe, expect, test } from 'claude-code/testing'

import { configCandidates, groupTasks, neighbours, rewriteStatuses, statusProblem } from '../hooks/cli'
import type { TaskSummary } from '../types'
import { PANE, configWith, fail, ok, open, openTask, statusesIn, world } from './fixtures'
import type { FakeTask } from './fixtures'

// Closed statuses (the closedStatuses option), and creating and deleting
// statuses from the pane. Backlog.md has no command that writes statuses,
// so the pane rewrites the statuses line of its config; the fake `backlog`
// here reads its statuses from that fake file, so a write is seen only if
// it landed.

const STATUSES = ['Cancelled', 'To Do', 'In Progress', 'Done']
const TASKS: FakeTask[] = [
  { id: 'BL-1', title: 'Write parser', status: 'In Progress' },
  { id: 'BL-2', title: 'Add login', status: 'To Do' },
  { id: 'BL-3', title: 'Old work', status: 'Done' },
  { id: 'BL-5', title: 'Old idea', status: 'Cancelled' },
]
const CLOSED = { options: { closedStatuses: 'Cancelled, Won’t do' } }

for (const surface of ['vscode', 'mobile'] as const) {
  test(`${surface}: a closed status is folded and dim in the list`, CLOSED, async ($, on) => {
    const { clock } = world(on, { statuses: STATUSES, tasks: TASKS })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    const toggle = await ui.find({ key: 'toggle:Cancelled' })
    expect(toggle?.text).toContain('▸ Cancelled (1)')
    expect(toggle?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: 'Cancelled' }))?.props.color).toBe('inactive')
    expect(await ui.find({ key: 'task:BL-5' })).toBe(undefined)
    await ui.press({ key: 'toggle:Cancelled' })
    expect(await ui.find({ key: 'task:BL-5' })).toBeDefined()
    // Unfolding one leaves the other folded.
    expect(await ui.find({ key: 'task:BL-3' })).toBe(undefined)
    await ui.press({ key: 'toggle:Cancelled' })
    expect(await ui.find({ key: 'task:BL-5' })).toBe(undefined)
    await ui.unmount()
  })
}

test('without the option, a status is an ordinary one', async ($, on) => {
  const { clock } = world(on, { statuses: STATUSES, tasks: TASKS })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'toggle:Cancelled' })).toBe(undefined)
  expect(await ui.find({ key: 'task:BL-5' })).toBeDefined()
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
  test(`${surface}: ◀ and ▶ skip a closed status`, CLOSED, async ($, on) => {
    const { clock, edits } = world(on, { statuses: STATUSES, tasks: TASKS })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-2')
    // To Do is the first open status: no ◀, though Cancelled is before it.
    expect(await ui.find({ key: 'status-prev' })).toBe(undefined)
    expect((await ui.find({ key: 'status-next' }))?.text).toBe('In Progress ▶')
    await ui.press({ key: 'back' })
    // From a cancelled task, ▶ goes back to work.
    await openTask(ui, 'BL-5')
    expect(await ui.find({ key: 'status-prev' })).toBe(undefined)
    await ui.press({ key: 'status-next' })
    expect(edits()).toEqual([['task', 'edit', 'BL-5', '--status', 'To Do']])
    await ui.unmount()
  })
}

test('the status picker still offers a closed status', CLOSED, async ($, on) => {
  const { clock, edits } = world(on, { statuses: STATUSES, tasks: TASKS })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openTask(ui, 'BL-2')
  await ui.select({ key: 'status', value: 'Cancelled' })
  expect(edits()).toEqual([['task', 'edit', 'BL-2', '--status', 'Cancelled']])
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
  test(`${surface}: the statuses view lists each status with its tasks and tags`, CLOSED, async ($, on) => {
    const { clock } = world(on, { statuses: [...STATUSES.slice(0, 3), 'Review', 'Done'], tasks: TASKS })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'statuses-open' })
    expect(await ui.find({ type: 'Text', text: 'Statuses' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1 task$/ })).toBeDefined()
    expect((await ui.find({ key: 'status-closed-0' }))?.text).toBe('[x] Closed')
    expect((await ui.find({ key: 'status-closed-1' }))?.text).toBe('[ ] Closed')
    // The final status is always final: no checkbox.
    expect(await ui.find({ key: 'status-closed-4' })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: '1 task · final' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'no tasks' })).toBeDefined()
    // Only a status no task is in can be deleted: Review, the fourth.
    expect(await ui.find({ key: 'status-remove-3' })).toBeDefined()
    for (const i of [0, 1, 2, 4]) expect(await ui.find({ key: `status-remove-${i}` })).toBe(undefined)
    await ui.press({ key: 'statuses-back' })
    expect(await ui.find({ key: 'statuses-open' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: a new status goes where the position picker says`, async ($, on) => {
    const { clock, files, configPath } = world(on, { statuses: ['To Do', 'In Progress', 'Done'] })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'statuses-open' })
    const picker = await ui.find({ key: 'status-position' })
    expect(picker?.props.options).toEqual([
      { value: '0', label: 'At the start' },
      { value: '1', label: 'After To Do' },
      { value: '2', label: 'After In Progress' },
      { value: '3', label: 'After Done' },
    ])
    // By default, before the final status.
    expect(picker?.props.value).toBe('2')
    await ui.input({ key: 'status-new', text: '  Review  ' })
    expect(statusesIn(files.get(configPath))).toEqual(['To Do', 'In Progress', 'Review', 'Done'])
    expect(await ui.find({ type: 'Text', text: 'Added the status Review.' })).toBeDefined()

    await ui.select({ key: 'status-position', value: '0' })
    await ui.input({ key: 'status-new', text: 'Cancelled' })
    expect(statusesIn(files.get(configPath))).toEqual(['Cancelled', 'To Do', 'In Progress', 'Review', 'Done'])
    // Every other line of the config is kept as it was.
    expect(files.get(configPath)).toBe(configWith(['Cancelled', 'To Do', 'In Progress', 'Review', 'Done']))
    await ui.press({ key: 'statuses-back' })
    await ui.unmount()
  })
}

test('the board gets a column for a new status at once', async ($, on) => {
  const { clock } = world(on)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'statuses-open' })
  await ui.input({ key: 'status-new', text: 'Review' })
  await ui.press({ key: 'statuses-back' })
  await ui.resize({ columns: 80, rows: 12, in: 'board' })
  expect(await ui.find({ key: 'column:Review', in: 'board' })).toBeDefined()
  await ui.unmount()
})

test('a name that is empty, taken, holds a comma or is too long is refused', async ($, on) => {
  const { clock, files, configPath } = world(on)
  const before = files.get(configPath)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'statuses-open' })
  for (const [name, says] of [
    ['  ', 'Type a name for the status.'],
    ['to do', 'There is already a status with that name.'],
    ['Done, sort of', 'A status name cannot hold a comma, a quote or a line break.'],
    ['x'.repeat(41), 'A status name can be 40 characters at most.'],
  ] as const) {
    await ui.input({ key: 'status-new', text: name })
    expect(await ui.find({ type: 'Text', text: says })).toBeDefined()
  }
  expect(files.get(configPath)).toBe(before)
  await ui.unmount()
})

test('a status is deleted after an inline confirm', async ($, on) => {
  const { clock, files, configPath } = world(on, { statuses: ['To Do', 'Review', 'In Progress', 'Done'] })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'statuses-open' })
  await ui.press({ key: 'status-remove-1' })
  expect(await ui.find({ type: 'Text', text: 'Delete the status Review?' })).toBeDefined()
  await ui.press({ key: 'status-remove-no' })
  expect(statusesIn(files.get(configPath))).toEqual(['To Do', 'Review', 'In Progress', 'Done'])
  await ui.press({ key: 'status-remove-1' })
  await ui.press({ key: 'status-remove-yes-1' })
  expect(statusesIn(files.get(configPath))).toEqual(['To Do', 'In Progress', 'Done'])
  expect(await ui.find({ type: 'Text', text: 'Deleted the status Review.' })).toBeDefined()
  await ui.unmount()
})

test('the status new tasks start in is not deleted', async ($, on) => {
  const { clock, files, configPath } = world(on, {
    statuses: ['Backlog', 'To Do', 'In Progress', 'Done'],
    tasks: [{ id: 'BL-1', title: 'x', status: 'In Progress' }],
    config: { defaultStatus: ok('Backlog\n') },
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'statuses-open' })
  await ui.press({ key: 'status-remove-0' })
  await ui.press({ key: 'status-remove-yes-0' })
  expect(await ui.find({ type: 'Text', text: /Backlog is the status new tasks start in/ })).toBeDefined()
  expect(statusesIn(files.get(configPath))).toEqual(['Backlog', 'To Do', 'In Progress', 'Done'])
  await ui.unmount()
})

test('a project keeps at least two statuses', async ($, on) => {
  const { clock, files, configPath } = world(on, { statuses: ['Open', 'Closed'], tasks: [] })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'statuses-open' })
  await ui.press({ key: 'status-remove-0' })
  await ui.press({ key: 'status-remove-yes-0' })
  expect(await ui.find({ type: 'Text', text: 'A project needs at least two statuses.' })).toBeDefined()
  expect(statusesIn(files.get(configPath))).toEqual(['Open', 'Closed'])
  await ui.unmount()
})

test('a config found further up, or as backlog.config.yml, is the one written', async ($, on) => {
  const { clock, files } = world(on, { configPath: '../../backlog.config.yml' })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'statuses-open' })
  await ui.input({ key: 'status-new', text: 'Review' })
  expect(statusesIn(files.get('../../backlog.config.yml'))).toEqual(['To Do', 'In Progress', 'Review', 'Done'])
  await ui.unmount()
})

test('when Backlog.md does not read the change, the config is put back', async ($, on) => {
  const { clock, files, configPath } = world(on, { isConfigElsewhere: true })
  const before = files.get(configPath)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'statuses-open' })
  await ui.input({ key: 'status-new', text: 'Review' })
  expect(files.get(configPath)).toBe(before)
  expect(await ui.find({ type: 'Text', text: /did not read the new statuses/ })).toBeDefined()
  // And the pane still shows the statuses Backlog.md reads.
  expect(await ui.find({ type: 'Text', text: 'Review' })).toBe(undefined)
  await ui.unmount()
})

test('no config: says so and writes nothing', async ($, on) => {
  const { clock, files } = world(on, { configPath: 'elsewhere/config.yml' })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'statuses-open' })
  await ui.input({ key: 'status-new', text: 'Review' })
  expect(await ui.find({ type: 'Text', text: /Could not find the Backlog.md config/ })).toBeDefined()
  expect(files.has('backlog/config.yml')).toBe(false)
  await ui.unmount()
})

test('mobile: statuses can be deleted, not added', async ($, on) => {
  const { clock, files, configPath } = world(on, { statuses: ['To Do', 'Review', 'In Progress', 'Done'] })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.press({ key: 'statuses-open' })
  expect(await ui.find({ key: 'status-new' })).toBe(undefined)
  expect(await ui.find({ key: 'status-position' })).toBe(undefined)
  await ui.press({ key: 'status-remove-1' })
  await ui.press({ key: 'status-remove-yes-1' })
  expect(statusesIn(files.get(configPath))).toEqual(['To Do', 'In Progress', 'Done'])
  await ui.unmount()
})

test('Spanish: the statuses view', { options: { language: 'es', closedStatuses: 'Cancelled' } }, async ($, on) => {
  const { clock } = world(on, { statuses: STATUSES, tasks: TASKS })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'statuses-open' }))?.text).toBe('Estados…')
  await ui.press({ key: 'statuses-open' })
  expect(await ui.find({ type: 'Text', text: 'Estados' })).toBeDefined()
  expect((await ui.find({ key: 'status-closed-0' }))?.text).toBe('[x] Cerrado')
  expect((await ui.find({ key: 'status-colour-0' }))?.props.label).toBe('Color')
  const picker = await ui.find({ key: 'status-position' })
  expect(picker?.props.label).toBe('Posición')
  expect((picker?.props.options as { label: string }[])[0]?.label).toBe('Al principio')
  expect((picker?.props.options as { label: string }[])[1]?.label).toBe('Después de Cancelled')
  expect((await ui.find({ key: 'status-new' }))?.props.placeholder).toBe('Nombre del nuevo estado')
  await ui.input({ key: 'status-new', text: 'Revisión' })
  expect(await ui.find({ type: 'Text', text: 'Estado Revisión añadido.' })).toBeDefined()
  await ui.unmount()
})

const task = (id: string, status: string): TaskSummary => ({
  id,
  title: id,
  status,
  priority: null,
  labels: [],
  references: [],
  acceptanceCriteriaCompleted: 0,
  acceptanceCriteriaCount: 0,
  createdAt: null,
  updatedAt: null,
})

describe('closed statuses', () => {
  test('are folded and limited like the final one, and coloured inactive', async () => {
    const groups = groupTasks([task('A-1', 'Cancelled'), task('A-2', 'Cancelled')], STATUSES, 1, ['cancelled'])
    const cancelled = groups.find(group => group.status === 'Cancelled')
    expect(cancelled).toMatchObject({ isClosed: true, isFinal: false, total: 2, color: 'inactive' })
    expect(cancelled?.tasks).toHaveLength(1)
    // The first open status takes the first colour.
    expect(groups.find(group => group.status === 'To Do')?.color).toBe('suggestion')
    // The final one stays final even if listed.
    expect(groupTasks([], STATUSES, 1, ['Done']).find(group => group.status === 'Done')).toMatchObject({
      isFinal: true,
      isClosed: false,
      color: 'success',
    })
  })

  test('◀ and ▶ skip them', async () => {
    const order = ['To Do', 'In Progress', 'Cancelled', 'Done']
    expect(neighbours(order, 'In Progress', ['Cancelled'])).toEqual({ previous: 'To Do', next: 'Done' })
    expect(neighbours(order, 'Cancelled', ['Cancelled'])).toEqual({ previous: 'In Progress', next: 'Done' })
    expect(neighbours(order, 'Done', ['Cancelled'])).toEqual({ previous: 'In Progress', next: undefined })
    expect(neighbours(order, 'In Progress')).toEqual({ previous: 'To Do', next: 'Cancelled' })
  })
})

describe('the config', () => {
  test('is looked for as Backlog.md does, from the session folder up, nearest first', async () => {
    const found = configCandidates('/work/demo')
    expect(found.slice(0, 6)).toEqual([
      '/work/demo/backlog.config.yml',
      '/work/demo/backlog.config.yaml',
      '/work/demo/backlog/config.yml',
      '/work/demo/backlog/config.yaml',
      '/work/demo/.backlog/config.yml',
      '/work/demo/.backlog/config.yaml',
    ])
    expect(found[6]).toBe('/work/backlog.config.yml')
    expect(found[12]).toBe('/backlog.config.yml')
    expect(found).toHaveLength(18)
  })

  test('on Windows, with its separators, up to the drive', async () => {
    const found = configCandidates('C:\\Users\\me\\proj')
    expect(found[2]).toBe('C:\\Users\\me\\proj\\backlog\\config.yml')
    expect(found[6]).toBe('C:\\Users\\me\\backlog.config.yml')
    expect(found[found.length - 1]).toBe('C:\\.backlog\\config.yaml')
  })

  test('with no folder, relative, a few levels up', async () => {
    const found = configCandidates('', 2)
    expect(found[0]).toBe('backlog.config.yml')
    expect(found[6]).toBe('../backlog.config.yml')
    expect(found).toHaveLength(18)
  })

  test('only its statuses line is rewritten', async () => {
    const config = 'project_name: "x"\r\nstatuses: ["To Do", "Done"] \r\nlabels: []\r\n'
    expect(rewriteStatuses(config, ['To Do', 'Say "hi"', 'Done'])).toBe(
      'project_name: "x"\r\nstatuses: ["To Do", "Say \\"hi\\"", "Done"]\r\nlabels: []\r\n',
    )
  })

  test('a block list is replaced by one flow list', async () => {
    const config = 'statuses:\n  - To Do\n  - Done\n\nlabels: []\n'
    expect(rewriteStatuses(config, ['A', 'B'])).toBe('statuses: ["A", "B"]\n\nlabels: []\n')
  })

  test('a config with no statuses key, or two, is left alone', async () => {
    expect(rewriteStatuses('labels: []\n', ['A'])).toBe(undefined)
    expect(rewriteStatuses('statuses: [a]\nstatuses: [b]\n', ['A'])).toBe(undefined)
    expect(rewriteStatuses('statuses: To Do\n', ['A'])).toBe(undefined)
    // A nested key with the same name is not the project's.
    expect(rewriteStatuses('board:\n  statuses: [a]\n', ['A'])).toBe(undefined)
  })

  test('status names', async () => {
    expect(statusProblem('Review', ['To Do'])).toBe(undefined)
    expect(statusProblem(' ', [])).toBe('empty')
    expect(statusProblem('TO DO', ['To Do'])).toBe('duplicate')
    expect(statusProblem('a,b', [])).toBe('comma')
    expect(statusProblem('say "x"', [])).toBe('comma')
    expect(statusProblem('x'.repeat(41), [])).toBe('too-long')
  })
})

test('a failing statuses read leaves the old statuses shown', async ($, on) => {
  const { clock } = world(on, { config: { statuses: fail('boom') } })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ type: 'Text', text: /^To Do/ })).toBeDefined()
  await ui.unmount()
})
