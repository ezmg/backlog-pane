// The world beneath the mod in every pane test. Nothing sits beneath the
// plugin under test: the hooks here stand for the engine and for a fake
// `backlog` CLI. Task ids use a custom prefix (BL-), so nothing in the mod
// may assume TASK-.

import { mock } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On, ProcessRunResult, RenderSurface } from 'claude-code'

export const PANE = {
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

export type FakeTask = { id: string; title: string; status: string; [field: string]: unknown }

export const BL1: FakeTask = {
  id: 'BL-1',
  title: 'Write parser',
  status: 'In Progress',
  priority: 'medium',
  acceptanceCriteriaCompleted: 1,
  acceptanceCriteriaCount: 2,
}

export const TASKS: FakeTask[] = [
  BL1,
  { id: 'BL-2', title: 'Add login', status: 'To Do', priority: 'high' },
  { id: 'BL-3', title: 'Old work', status: 'Done', updatedAt: '2026-01-02T00:00:00Z' },
]

export const VIEW = {
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

export const ok = (stdout: string): ProcessRunResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})
export const fail = (stderr: string): ProcessRunResult => ({ ...ok(''), exitCode: 1, stderr })

export type World = {
  surfaces?: RenderSurface[]
  installed?: boolean
  // What each `--watch` child does: write these stdout/stderr pieces, then
  // exit with `code`. A child that delivered a list and exited is restarted
  // after a backoff on the mocked clock, which the tests never reach unless
  // they advance it, so it stands for a watch that keeps running. (A fake
  // child left suspended mid-stream keeps the kit's acts from settling.)
  watch?: { stdout?: string[]; stderr?: string; code?: number }
  list?: ProcessRunResult
  create?: ProcessRunResult
  // What `backlog config get <key>` prints, by key.
  config?: Record<string, ProcessRunResult>
  env?: Record<string, string>
  // Claude Code's settings, as `$.settings.read` answers them.
  settings?: Record<string, unknown>
  // The engine's version, as `$.session.version()` answers it.
  version?: string
  // What the prompt box holds.
  prompt?: string
  // What the external editor does with the file it is handed: the text it
  // leaves there, or how it fails.
  editor?: { writes?: string; result?: ProcessRunResult; throws?: string }
}

export function world(on: On, options: World = {}) {
  const runs: string[][] = []
  const editorRuns: { argv: readonly string[]; timeoutMs?: number }[] = []
  const fills: { text: string; mode?: string }[] = []
  const files = new Map<string, string>()
  let spawns = 0
  const clock = mock.clock(on)
  mock.env(on, { OS: 'Linux', ...options.env })
  on('settings.read', () => ({ value: options.settings ?? {} }))
  on('session.version', () => {
    const version = options.version ?? '2.1.310'
    return { value: { version, base: version } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['desktop'] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('prompt.read', () => ({ value: { text: options.prompt ?? '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('process.run', (_, e) => {
    if (options.installed === false) throw new Error('ENOENT')
    if (e.argv[0] !== 'backlog') {
      // The external editor: the file is its last argument.
      editorRuns.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs })
      const editor = options.editor ?? {}
      if (editor.throws) throw new Error(editor.throws)
      const path = e.argv[e.argv.length - 1] ?? ''
      if (editor.writes !== undefined) files.set(path, editor.writes)
      return { value: editor.result ?? ok('') }
    }
    const argv = e.argv.slice(1)
    runs.push(argv)
    const command = argv.join(' ')
    if (command === '--version') return { value: ok('1.55.3') }
    if (command === 'config get statuses') return { value: ok('To Do, In Progress, Done\n') }
    if (argv[0] === 'config' && argv[1] === 'get') {
      const answer = options.config?.[argv[2] ?? '']
      if (answer) return { value: answer }
      if (argv[2] === 'priorities') return { value: ok('high, medium, low\n') }
      return { value: ok('') }
    }
    if (command === 'task list --json') {
      return { value: options.list ?? ok(JSON.stringify({ kind: 'task-list', tasks: TASKS })) }
    }
    if (argv[0] === 'task' && argv[1] === 'view') {
      const summary = TASKS.find(one => one.id === argv[2])
      const view = summary?.id === VIEW.task.id ? VIEW : { ...VIEW, task: { ...VIEW.task, ...summary } }
      return { value: ok(JSON.stringify(view, null, 2)) }
    }
    if (argv[0] === 'task' && argv[1] === 'create') return { value: options.create ?? ok('Created task BL-4\nFile: x.md') }
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
  /** The `task edit` commands run so far. */
  const edits = () => runs.filter(argv => argv[0] === 'task' && argv[1] === 'edit')
  return { runs, edits, editorRuns, fills, files, clock, spawnCount: () => spawns }
}

export async function open($: Engine, clock: { settle: () => Promise<void> }) {
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

export type Drawing = Mounted<RenderSurface, 'Pane'>
type BoardDrawing = Mounted<'terminal' | 'desktop', 'Pane'>

/**
 * Opens a task the way the surface offers it: on the terminal and the
 * desktop the board's Client posts an open, elsewhere its row in the list.
 */
export async function openTask(ui: Drawing, id: string) {
  if (await ui.find({ type: 'Client' })) {
    await (ui as BoardDrawing).post({ type: 'open', id }, { in: 'board' })
    return
  }
  if (!(await ui.find({ key: `task:${id}` }))) await ui.press({ key: 'toggle-done' })
  await ui.press({ key: `task:${id}` })
}
