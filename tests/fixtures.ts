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
  // What every `--watch` child after the first does, when it differs.
  laterWatch?: { stdout?: string[]; stderr?: string; code?: number }
  list?: ProcessRunResult
  create?: ProcessRunResult
  // What every `backlog task edit` answers.
  edit?: ProcessRunResult
  // What `backlog config get <key>` prints, by key.
  config?: Record<string, ProcessRunResult>
  // The project's tasks (TASKS when not given).
  tasks?: FakeTask[]
  // The project's statuses, kept in a fake backlog/config.yml that
  // `backlog config get statuses` reads; and where that file is.
  statuses?: string[]
  configPath?: string
  // Backlog.md reads its statuses from somewhere else than the file the
  // mod finds: a write is never seen.
  isConfigElsewhere?: boolean
  // What $.store holds at the start (the mod's per-project prefs).
  store?: Record<string, unknown>
  // `task create` and `task edit` change what `task list` and `task view`
  // answer, as the real CLI's do (off by default: most tests read a fixed board).
  isStateful?: boolean
  // What answers $.http.fetch: a fake tracker.
  http?: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    status: number
    text: string
  }
  env?: Record<string, string>
  // Claude Code's settings, as `$.settings.read` answers them.
  settings?: Record<string, unknown>
  // The engine's version, as `$.session.version()` answers it.
  version?: string
  // What the prompt box holds, and whether it takes a fill.
  prompt?: string
  isFillRefused?: boolean
  // What the external editor does with the file it is handed: the text it
  // leaves there, or how it fails.
  editor?: { writes?: string; result?: ProcessRunResult; throws?: string }
}

/**
 * The fake file system: one file per path, however the path reaches a hook
 * (on Windows the engine may hand `/tmp/x` on as `\\tmp\\x` or `C:\\tmp\\x`).
 */
/** The session's working folder in every test. */
export const CWD = '/work/demo'

/** Bytes as `$.fs.read(…, { as: 'bytes' })` gives them. */
export { toBase64 } from '../hooks/base64'
import { toBase64 } from '../hooks/base64'

class Files {
  private readonly texts = new Map<string, string>()
  private readonly raw = new Map<string, Uint8Array>()
  // A relative path is under CWD; `..` and `.` are resolved.
  private static key(path: string) {
    const slashed = path.replace(/\\/g, '/').replace(/^[A-Za-z]:(?=\/)/, '')
    const parts: string[] = []
    for (const part of (slashed.startsWith('/') ? slashed : `${CWD}/${slashed}`).split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return `/${parts.join('/')}`.toLowerCase()
  }
  get(path: string) {
    return this.texts.get(Files.key(path))
  }
  /** A file's bytes: those set with setBytes, else its text in UTF-8. */
  bytes(path: string) {
    const text = this.get(path)
    return this.raw.get(Files.key(path)) ?? (text === undefined ? undefined : new TextEncoder().encode(text))
  }
  setBytes(path: string, bytes: Uint8Array) {
    this.raw.set(Files.key(path), bytes)
    this.texts.set(Files.key(path), '')
  }
  set(path: string, text: string) {
    this.texts.set(Files.key(path), text)
  }
  has(path: string) {
    return this.texts.has(Files.key(path))
  }
}

/** The statuses a config's flow `statuses: [...]` line lists, as Backlog.md reads them. */
export function statusesIn(config: string | undefined): string[] {
  const line = /^statuses:\s*(\[.*\])\s*$/m.exec(config ?? '')?.[1]
  if (!line) return []
  try {
    return JSON.parse(line) as string[]
  } catch {
    return []
  }
}

/** A config as `backlog init` writes it, with these statuses. */
export const configWith = (statuses: string[]) =>
  [
    'project_name: "Demo"',
    'default_status: "To Do"',
    `statuses: [${statuses.map(one => JSON.stringify(one)).join(', ')}]`,
    'labels: []',
    'date_format: yyyy-mm-dd',
    '',
  ].join('\n')

export function world(on: On, options: World = {}) {
  const runs: string[][] = []
  const editorRuns: { argv: readonly string[]; timeoutMs?: number }[] = []
  const fills: { text: string; mode?: string }[] = []
  // A copy, so a stateful test changes its own tasks only.
  const tasks: FakeTask[] = (options.tasks ?? TASKS).map(task => ({ ...task }))
  const files = new Files()
  const configPath = options.configPath ?? 'backlog/config.yml'
  files.set(configPath, configWith(options.statuses ?? ['To Do', 'In Progress', 'Done']))
  let spawns = 0
  const clock = mock.clock(on)
  // English unless a test says otherwise: LANG is read before the runtime's
  // own locale, which is the machine's (Spanish on a Spanish Windows).
  mock.env(on, { OS: 'Linux', LANG: 'en_US.UTF-8', ...options.env })
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
    return { isFilled: options.isFillRefused !== true }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  const requests: { method: string; url: string; body?: unknown; key?: string; auth?: string }[] = []
  if (options.http) {
    const http = options.http
    on('http.fetch', (_, e) => {
      const init = e.init ?? {}
      requests.push({
        method: init.method ?? 'GET',
        url: e.url,
        body: init.body ? JSON.parse(init.body) : undefined,
        key: init.headers?.['X-Redmine-API-Key'],
        auth: init.headers?.Authorization,
      })
      const answer = http(e.url, init)
      return {
        value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: answer.text },
      }
    })
  }
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    if (e.as === 'bytes') {
      const bytes = files.bytes(e.path)
      if (bytes === undefined) throw new Error(`ENOENT: ${e.path}`)
      return { value: { base64: toBase64(bytes) } }
    }
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
      // The call rejects, as $.process.run does at its timeout.
      if (editor.throws) return { deny: editor.throws }
      const path = e.argv[e.argv.length - 1] ?? ''
      if (editor.writes !== undefined) files.set(path, editor.writes)
      return { value: editor.result ?? ok('') }
    }
    const argv = e.argv.slice(1)
    runs.push(argv)
    const command = argv.join(' ')
    if (command === '--version') return { value: ok('1.55.3') }
    if (command === 'config get statuses') {
      const listed = options.isConfigElsewhere
        ? (options.statuses ?? ['To Do', 'In Progress', 'Done'])
        : statusesIn(files.get(configPath))
      return { value: ok(`${listed.join(', ')}\n`) }
    }
    if (argv[0] === 'config' && argv[1] === 'get') {
      const answer = options.config?.[argv[2] ?? '']
      if (answer) return { value: answer }
      if (argv[2] === 'priorities') return { value: ok('high, medium, low\n') }
      return { value: ok('') }
    }
    if (command === 'task list --json') {
      return { value: options.list ?? ok(JSON.stringify({ kind: 'task-list', tasks })) }
    }
    if (argv[0] === 'task' && argv[1] === 'view') {
      const summary = tasks.find(one => one.id === argv[2])
      const view = options.isStateful
        ? { ...VIEW, task: { acceptanceCriteria: [], description: null, implementationPlan: null, priority: null, ...summary } }
        : summary?.id === VIEW.task.id
          ? VIEW
          : { ...VIEW, task: { ...VIEW.task, priority: null, ...summary } }
      return { value: ok(JSON.stringify(view, null, 2)) }
    }
    if (argv[0] === 'task' && argv[1] === 'edit' && options.edit) return { value: options.edit }
    if (options.isStateful && argv[0] === 'task' && (argv[1] === 'create' || argv[1] === 'edit')) {
      return { value: applyTaskCommand(tasks, argv) }
    }
    if (argv[0] === 'task' && argv[1] === 'create') return { value: options.create ?? ok('Created task BL-4\nFile: x.md') }
    return { value: ok('Updated task') }
  })
  on('process.spawn', async function* () {
    spawns += 1
    const watch = (spawns > 1 ? options.laterWatch : undefined) ?? options.watch ?? {
      stdout: [JSON.stringify({ schemaVersion: 1, kind: 'task-list', tasks }, null, 2)],
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
  return { runs, edits, editorRuns, fills, files, configPath, store, requests, tasks, clock, spawnCount: () => spawns }
}

/**
 * `task create <title> …` and `task edit <id> …` on a stateful board: the
 * flags the pane and its sync use (-t, -s, --priority, -d, --ref, --add-ref).
 */
function applyTaskCommand(tasks: FakeTask[], argv: string[]): ProcessRunResult {
  const isCreate = argv[1] === 'create'
  let task: FakeTask | undefined
  let i = 3
  if (isCreate) {
    const next = 1 + Math.max(0, ...tasks.map(one => Number(/\d+$/.exec(one.id)?.[0] ?? 0)))
    task = { id: `BL-${next}`, title: argv[2] ?? '', status: 'To Do', references: [] }
    tasks.push(task)
  } else {
    task = tasks.find(one => one.id === argv[2])
    if (!task) return fail(`Task ${argv[2]} not found`)
  }
  for (; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1] ?? ''
    if (flag === '-t') task.title = value
    else if (flag === '-s') task.status = value
    else if (flag === '--priority') task.priority = value.toLowerCase()
    else if (flag === '-d') task.description = value
    else if (flag === '--ref') task.references = [value]
    else if (flag === '--add-ref') task.references = [...((task.references as string[] | undefined) ?? []), value]
  }
  // The real CLI stamps the change, to the minute.
  task.updatedAt = '2030-01-01T00:00:00Z'
  return ok(isCreate ? `Created task ${task.id}\nFile: x.md` : `Updated task ${task.id}`)
}

export async function open($: Engine, clock: { settle: () => Promise<void> }) {
  await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true })
  const answer = await $.command.run({
    command: 'backlog',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  await clock.settle()
  return answer
}

/** The $.store key a project's prefs are kept under: its config's path. */
export const PREFS_KEY = `project:${CWD}/backlog/config.yml`

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
  // Unfold the folded groups (the final status, closed ones) until it shows.
  for (const toggle of await ui.findAll({ type: 'Button', key: undefined })) {
    if (await ui.find({ key: `task:${id}` })) break
    if (toggle.key?.startsWith('toggle:')) await ui.press({ key: toggle.key })
  }
  await ui.press({ key: `task:${id}` })
}
