import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, ProcessRunResult, RenderSurface } from 'claude-code'

// Nothing sits beneath the plugin under test: the hooks here stand for the
// engine and for a fake `backlog` CLI. Task ids use a custom prefix (BL-),
// so nothing in the mod may assume TASK-.

const PANE = {
  plugin: 'backlog-pane',
  component: 'Pane',
  requestId: 'backlog',
  props: {
    title: 'Backlog',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type FakeTask = { id: string; title: string; status: string; [field: string]: unknown }

const BL1: FakeTask = {
  id: 'BL-1',
  title: 'Write parser',
  status: 'In Progress',
  acceptanceCriteriaCompleted: 1,
  acceptanceCriteriaCount: 2,
}

const TASKS: FakeTask[] = [
  BL1,
  { id: 'BL-2', title: 'Add login', status: 'To Do' },
  { id: 'BL-3', title: 'Old work', status: 'Done', updatedAt: '2026-01-02T00:00:00Z' },
]

const VIEW = {
  schemaVersion: 1,
  kind: 'task-view',
  task: {
    ...BL1,
    description: 'Parse the **stream**.',
    acceptanceCriteria: [
      { index: 1, text: 'Handles chunks', checked: true },
      { index: 2, text: 'Has tests', checked: false },
    ],
    implementationPlan: '1. Read\n2. Split',
  },
}

const ok = (stdout: string): ProcessRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})
const fail = (stderr: string): ProcessRunResult => ({ ...ok(''), exitCode: 1, stderr })

type World = {
  surfaces?: RenderSurface[]
  installed?: boolean
  // What each `--watch` child does: write these stdout/stderr pieces, then
  // exit with `code`. A child that delivered a list and exited is restarted
  // after a backoff on the mocked clock, which the tests never reach unless
  // they advance it, so it stands for a watch that keeps running. (A fake
  // child left suspended mid-stream keeps the kit's acts from settling.)
  watch?: { stdout?: string[]; stderr?: string; code?: number }
  list?: ProcessRunResult
}

function world(on: On, options: World = {}) {
  const runs: string[][] = []
  const fills: { text: string; mode?: string }[] = []
  let spawns = 0
  const clock = mock.clock(on)
  mock.env(on, { OS: 'Linux' })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['desktop'] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('process.run', (_, e) => {
    if (options.installed === false) throw new Error('ENOENT')
    const argv = e.argv.slice(1)
    runs.push(argv)
    const command = argv.join(' ')
    if (command === '--version') return { value: ok('1.55.3') }
    if (command === 'config get statuses') return { value: ok('To Do, In Progress, Done\n') }
    if (command === 'task list --json') {
      return { value: options.list ?? ok(JSON.stringify({ kind: 'task-list', tasks: TASKS })) }
    }
    if (argv[0] === 'task' && argv[1] === 'view') {
      const summary = TASKS.find(one => one.id === argv[2])
      const view = summary?.id === VIEW.task.id ? VIEW : { ...VIEW, task: { ...VIEW.task, ...summary } }
      return { value: ok(JSON.stringify(view, null, 2)) }
    }
    if (argv[0] === 'task' && argv[1] === 'create') return { value: ok('Created task BL-4\nFile: x.md') }
    return { value: ok('Updated task') }
  })
  on('process.spawn', async function* () {
    spawns += 1
    const watch = options.watch ?? {
      stdout: [JSON.stringify({ schemaVersion: 1, kind: 'task-list', tasks: TASKS }, null, 2)],
    }
    for (const text of watch.stdout ?? []) {
      // Cut each document in two, as a pipe may.
      const cut = Math.floor(text.length / 2)
      yield { stream: 'stdout' as const, text: text.slice(0, cut) }
      yield { stream: 'stdout' as const, text: text.slice(cut) }
    }
    if (watch.stderr) yield { stream: 'stderr' as const, text: watch.stderr }
    return { value: { code: watch.code ?? 0, signal: null } }
  })
  return { runs, fills, clock, spawnCount: () => spawns }
}

async function open($: Engine, clock: { settle: () => Promise<void> }) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const answer = await $.command.run({
    command: 'backlog',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  await clock.settle()
  return answer
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the board groups tasks by status and folds the final one`, async ($, on) => {
    const { clock } = world(on)
    expect((await open($, clock)).text).toContain('opened')
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: /^To Do/ })).toBeDefined()
    expect(await ui.find({ key: 'task:BL-1' })).toBeDefined()
    expect((await ui.find({ key: 'task:BL-1' }))?.text).toContain('1/2')
    // Done starts folded: its count shows, its tasks do not.
    expect((await ui.find({ key: 'toggle-done' }))?.text).toContain('(1)')
    expect(await ui.find({ key: 'task:BL-3' })).toBe(undefined)
    await ui.press({ key: 'toggle-done' })
    expect(await ui.find({ key: 'task:BL-3' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: a task shows its description, criteria and plan`, async ($, on) => {
    const { clock, runs } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'task:BL-1' })

    expect(runs).toContainEqual(['task', 'view', 'BL-1', '--json'])
    expect(await ui.find({ type: 'Markdown', text: 'Parse the **stream**.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[x] 1. Handles chunks' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[ ] 2. Has tests' })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /2\. Split/ })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ key: 'task:BL-2' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: status changes and new tasks go through the CLI`, async ($, on) => {
    const { clock, runs } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })

    await ui.input({ key: 'new-task', text: '  Ship it  ' })
    expect(runs).toContainEqual(['task', 'create', 'Ship it'])
    expect(await ui.find({ type: 'Text', text: 'Created BL-4.' })).toBeDefined()

    await ui.press({ key: 'task:BL-1' })
    await ui.select({ key: 'status', value: 'Done' })
    expect(runs).toContainEqual(['task', 'edit', 'BL-1', '--status', 'Done'])
    expect(await ui.find({ type: 'Text', text: 'Moved BL-1 to Done.' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: "Work on this task" drafts the prompt without sending it`, async ($, on) => {
    const { clock, fills } = world(on)
    let submitted = 0
    on('prompt.submit', (_, e) => {
      submitted += 1
      return { text: e.text }
    })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'task:BL-1' })
    await ui.press({ key: 'work' })

    expect(fills).toEqual([
      {
        text: 'Work on BL-1 only. Research the codebase and write an implementation plan in the task. Wait for my approval before coding.',
        mode: 'replace',
      },
    ])
    expect(submitted).toBe(0)
    await ui.unmount()
  })
}

test('a missing CLI says how to install it', async ($, on) => {
  const { clock } = world(on, { installed: false })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Backlog.md CLI not found' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /npm i -g backlog\.md/ })).toBeDefined()
  expect(await ui.find({ key: 'retry' })).toBeDefined()
  await ui.unmount()
})

test('an uninitialized folder suggests backlog init', async ($, on) => {
  const { clock } = world(on, {
    watch: { stderr: 'No Backlog.md project found. Run `backlog init` to initialize.\n', code: 1 },
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'No Backlog.md project in this folder' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /backlog init/ })).toBeDefined()
  await ui.unmount()
})

test('a failing watch is restarted a few times, then offers Retry', async ($, on) => {
  const { clock, spawnCount } = world(on, { watch: { stderr: 'disk on fire\n', code: 1 } })
  await open($, clock)
  for (let i = 0; i < 6; i++) await clock.advance(60_000)
  expect(spawnCount()).toBe(5)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'disk on fire' })).toBeDefined()
  await ui.press({ key: 'retry' })
  expect(spawnCount()).toBe(6)
  await ui.unmount()
})

test('mobile: status buttons instead of a picker, no creation field', async ($, on) => {
  const { clock, runs } = world(on)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Input' })).toBe(undefined)
  await ui.press({ key: 'task:BL-2' })
  await ui.press({ key: 'status-1' })
  expect(runs).toContainEqual(['task', 'edit', 'BL-2', '--status', 'In Progress'])
  await ui.unmount()
})

test('with no surface, /backlog answers with the board as text', async ($, on) => {
  const { clock } = world(on, { surfaces: [] })
  const answer = await open($, clock)
  expect(answer.text).toContain('Backlog: 3 tasks')
  expect(answer.text).toContain('In Progress (1)')
  expect(answer.text).toContain('BL-2  Add login')
})

test('with no surface and no project, /backlog says so', async ($, on) => {
  const { clock } = world(on, {
    surfaces: [],
    list: fail('No Backlog.md project found. Run `backlog init` to initialize.'),
  })
  expect((await open($, clock)).text).toContain('backlog init')
})
