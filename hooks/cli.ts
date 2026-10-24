// Pure helpers: the backlog command lines, the reader for its JSON stream,
// and the grouping the pane draws. Nothing here touches `$`, so the tests
// can cover it directly.

import type { ThemeKey } from 'claude-code'

import type { Checklist, TaskDetail, TaskSummary } from '../types'
import type { Strings } from './i18n'

export const DEFAULT_STATUSES = ['To Do', 'In Progress', 'Done']
export const DEFAULT_PRIORITIES = ['high', 'medium', 'low']

export const args = {
  version: () => ['--version'],
  statuses: () => ['config', 'get', 'statuses'],
  list: () => ['task', 'list', '--json'],
  watch: () => ['task', 'list', '--json', '--watch'],
  view: (id: string) => ['task', 'view', id, '--json'],
  setStatus: (id: string, status: string) => ['task', 'edit', id, '--status', status],
  create: (title: string) => ['task', 'create', title],
  priorities: () => ['config', 'get', 'priorities'],
  defaultEditor: () => ['config', 'get', 'defaultEditor'],
  defaultStatus: () => ['config', 'get', 'defaultStatus'],
  setDescription: (id: string, text: string) => ['task', 'edit', id, '-d', text],
  setPlan: (id: string, text: string) => ['task', 'edit', id, '--plan', text],
  setTitle: (id: string, title: string) => ['task', 'edit', id, '-t', title],
  setPriority: (id: string, priority: string) => ['task', 'edit', id, '--priority', priority],
  checkCriterion: (id: string, index: number) => ['task', 'edit', id, '--check-ac', String(index)],
  uncheckCriterion: (id: string, index: number) => ['task', 'edit', id, '--uncheck-ac', String(index)],
  addCriterion: (id: string, text: string) => ['task', 'edit', id, '--ac', text],
  removeCriterion: (id: string, index: number) => ['task', 'edit', id, '--remove-ac', String(index)],
  /** Replaces every criterion, in order; a text left unchanged keeps its tick. */
  setCriteria: (id: string, texts: string[]) => [
    'task',
    'edit',
    id,
    ...texts.flatMap(text => ['--acceptance-criteria', text]),
  ],
}

/**
 * The executables to try, in order: the configured path alone when one is
 * set; else `backlog` on PATH, then (on Windows, where a process started
 * without a shell cannot run npm's `backlog.cmd` shim) the native binaries
 * npm and bun install globally.
 */
export function candidates(env: {
  configured?: string
  os?: string
  appData?: string
  userProfile?: string
}): string[] {
  const configured = env.configured?.trim()
  if (configured) return [configured]
  const found = ['backlog']
  if (env.os !== 'Windows_NT') return found
  if (env.appData) {
    const modules = `${env.appData}\\npm\\node_modules`
    for (const arch of ['x64', 'arm64']) {
      found.push(`${modules}\\backlog.md\\node_modules\\backlog.md-windows-${arch}\\backlog.exe`)
      found.push(`${modules}\\backlog.md-windows-${arch}\\backlog.exe`)
    }
  }
  if (env.userProfile) found.push(`${env.userProfile}\\.bun\\bin\\backlog.exe`)
  found.push('backlog.exe')
  return found
}

/** Whether a version (`2.1.301`, `2.1.301-dev.…`) is at least `minimum`. */
export function isAtLeast(version: string | undefined, minimum: string): boolean {
  const parse = (text: string | undefined) => /^(\d+)\.(\d+)\.(\d+)/.exec(text?.trim() ?? '')?.slice(1).map(Number)
  const have = parse(version)
  const need = parse(minimum)
  if (!have || !need) return false
  for (let i = 0; i < 3; i++) {
    const a = have[i] ?? 0
    const b = need[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

/**
 * Splits an editor command as a shell would split its words, quotes kept
 * together: `code --wait`, `"C:\Program Files\Editor\editor.exe" -w`.
 */
export function splitCommand(command: string): string[] {
  const words: string[] = []
  let word = ''
  let quote: string | null = null
  let isWord = false
  for (const c of command.trim()) {
    if (quote) {
      if (c === quote) quote = null
      else word += c
    } else if (c === '"' || c === "'") {
      quote = c
      isWord = true
    } else if (/\s/.test(c)) {
      if (isWord) words.push(word)
      word = ''
      isWord = false
    } else {
      word += c
      isWord = true
    }
  }
  if (isWord) words.push(word)
  return words
}

/**
 * The editor to run, as an argument vector: Backlog.md's `defaultEditor`,
 * else VISUAL, else EDITOR, else Notepad on Windows; undefined when none.
 */
export function pickEditor(env: { configured?: string; visual?: string; editor?: string; os?: string }): string[] | undefined {
  for (const value of [env.configured, env.visual, env.editor]) {
    const text = value?.trim() ?? ''
    if (text === '' || text === 'undefined' || text === 'null') continue
    const argv = splitCommand(text)
    if (argv.length > 0) return argv
  }
  return env.os === 'Windows_NT' ? ['notepad'] : undefined
}

/** Where the text goes while the editor has it: the temp folder. */
export function editorFile(env: { tmpdir?: string; temp?: string; tmp?: string; userProfile?: string; os?: string }, id: string, field: string): string {
  const isWindows = env.os === 'Windows_NT'
  const fallback = isWindows ? (env.userProfile ? `${env.userProfile}\\AppData\\Local\\Temp` : 'C:\\Windows\\Temp') : '/tmp'
  const folder = (env.tmpdir || env.temp || env.tmp || fallback).replace(/[\\/]+$/, '')
  const name = `backlog-pane-${id.replace(/[^\w.-]/g, '_')}-${field}.md`
  return `${folder}${isWindows ? '\\' : '/'}${name}`
}

/** Why a backlog command failed, from its stderr. */
export function classify(stderr: string): 'not-initialized' | 'failed' {
  return /no backlog(\.md)? project found|backlog init/i.test(stderr) ? 'not-initialized' : 'failed'
}

/** The first meaningful line of a command's error output. */
export function errorLine(stderr: string, fallback: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map(one => one.trim())
    .find(one => one !== '' && !/^warning:/i.test(one))
  return line ?? fallback
}

/**
 * A list `backlog config get` prints: `To Do, In Progress, Done`, or with
 * brackets and quotes around it; `fallback` when it prints none.
 */
export function parseList(stdout: string, fallback: string[]): string[] {
  const list = stdout
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(one => one.trim().replace(/^["']|["']$/g, '').trim())
    .filter(one => one !== '' && one !== 'undefined' && one !== 'null')
  return list.length > 0 ? list : fallback
}

/** `backlog config get statuses` prints `To Do, In Progress, Done`. */
export const parseStatuses = (stdout: string) => parseList(stdout, DEFAULT_STATUSES)

/** `backlog config get priorities`; High, Medium, Low when it prints none. */
export const parsePriorities = (stdout: string) => parseList(stdout, DEFAULT_PRIORITIES)

/**
 * The criteria's texts with the one at `index` (1-based, as the CLI counts)
 * replaced, for `args.setCriteria`; undefined when nothing would change.
 */
export function rewriteCriteria(criteria: Checklist[], index: number, text: string): string[] | undefined {
  const next = text.trim()
  const at = criteria.findIndex(item => item.index === index)
  if (at === -1 || next === '' || criteria[at]?.text === next) return undefined
  return criteria.map((item, i) => (i === at ? next : item.text))
}

/** The id `backlog task create` printed (`Created task TASK-3`). */
export function createdId(stdout: string): string | undefined {
  return /Created task (\S+)/.exec(stdout)?.[1]
}

/**
 * Splits a stream of JSON documents written back to back (pretty-printed,
 * so a document spans many lines and a chunk may end anywhere) into whole
 * documents. Braces inside strings and escaped quotes are respected.
 */
export class JsonDocumentReader {
  private buffer = ''
  private depth = 0
  private inString = false
  private escaped = false
  private start = -1

  push(text: string): unknown[] {
    const documents: unknown[] = []
    let i = this.buffer.length
    this.buffer += text
    for (; i < this.buffer.length; i++) {
      const c = this.buffer[i]
      if (this.inString) {
        if (this.escaped) this.escaped = false
        else if (c === '\\') this.escaped = true
        else if (c === '"') this.inString = false
        continue
      }
      if (c === '"') this.inString = true
      else if (c === '{' || c === '[') {
        if (this.depth === 0) this.start = i
        this.depth++
      } else if ((c === '}' || c === ']') && this.depth > 0) {
        this.depth--
        if (this.depth === 0) {
          const raw = this.buffer.slice(this.start, i + 1)
          try {
            documents.push(JSON.parse(raw))
          } catch {
            // A malformed document is dropped; the next one replaces it anyway.
          }
          this.buffer = this.buffer.slice(i + 1)
          i = -1
          this.start = -1
        }
      }
    }
    if (this.depth === 0) this.buffer = ''
    return documents
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const count = (value: unknown): number => (typeof value === 'number' ? value : 0)

function toSummary(raw: Record<string, unknown>): TaskSummary {
  return {
    id: String(raw.id),
    title: text(raw.title) ?? '',
    status: text(raw.status) ?? '',
    priority: text(raw.priority),
    labels: Array.isArray(raw.labels) ? raw.labels.map(String) : [],
    acceptanceCriteriaCompleted: count(raw.acceptanceCriteriaCompleted),
    acceptanceCriteriaCount: count(raw.acceptanceCriteriaCount),
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt),
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The tasks of a `task-list` document, or undefined for any other. */
export function readTaskList(document: unknown): TaskSummary[] | undefined {
  if (!isRecord(document) || document.kind !== 'task-list' || !Array.isArray(document.tasks)) {
    return undefined
  }
  return document.tasks.filter(isRecord).filter(task => task.id !== undefined).map(toSummary)
}

/** The task of a `task-view` document, or undefined for any other. */
export function readTaskView(document: unknown): TaskDetail | undefined {
  if (!isRecord(document) || document.kind !== 'task-view' || !isRecord(document.task)) {
    return undefined
  }
  const task = document.task
  const criteria: Checklist[] = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria.filter(isRecord).map(item => ({
        index: count(item.index),
        text: text(item.text) ?? '',
        checked: item.checked === true,
      }))
    : []
  return {
    ...toSummary(task),
    description: text(task.description),
    acceptanceCriteria: criteria,
    implementationPlan: text(task.implementationPlan),
  }
}

export type Group = {
  status: string
  tasks: TaskSummary[]
  total: number
  isFinal: boolean
  /** Listed in the `closedStatuses` option: shown dim and folded, as the final one. */
  isClosed: boolean
  color: ThemeKey
}

const recency = (task: TaskSummary) => task.updatedAt ?? task.createdAt ?? ''

/** The `closedStatuses` option: status names separated by commas. */
export function parseClosed(option: unknown): string[] {
  if (typeof option !== 'string') return []
  return option
    .split(',')
    .map(one => one.trim())
    .filter(one => one !== '')
}

/** Whether `status` is one of `closed`, whatever the case. */
export const isClosedStatus = (status: string, closed: readonly string[]) =>
  closed.some(one => one.toLowerCase() === status.trim().toLowerCase())

/**
 * Groups tasks by status in the configured order, statuses the config does
 * not list after it. The final status (the config's last) and the closed
 * ones keep only their `doneLimit` most recently changed tasks; `total`
 * still counts them all.
 */
export function groupTasks(
  tasks: TaskSummary[],
  statuses: string[],
  doneLimit: number,
  closed: readonly string[] = [],
): Group[] {
  const order = statuses.length > 0 ? statuses : DEFAULT_STATUSES
  const final = order[order.length - 1]
  const names = [...order]
  for (const task of tasks) if (!names.includes(task.status)) names.push(task.status)
  const colors = statusColors(names, final ?? '', closed)
  return names.map(status => {
    let list = tasks.filter(task => task.status === status)
    const total = list.length
    const isFinal = status === final
    const isClosed = !isFinal && isClosedStatus(status, closed)
    if (isFinal || isClosed) {
      list = [...list].sort((a, b) => recency(b).localeCompare(recency(a))).slice(0, Math.max(0, doneLimit))
    }
    return { status, tasks: list, total, isFinal, isClosed, color: colors.get(status) ?? 'text' }
  })
}

const ROTATION: ThemeKey[] = ['permission', 'planMode', 'ide', 'merged']
const IN_PROGRESS = /in[ -]?progress|en (curso|progreso)|doing|wip/i

/**
 * Each status's colour, by theme key so it follows the person's light or
 * dark theme: the final one `success`, closed ones `inactive`, one named
 * like "In Progress" `warning`, the first of the rest `suggestion`, and the
 * others in turn from ROTATION. `names` is every status shown, in order;
 * `final` the configured last.
 */
export function statusColors(names: string[], final: string, closed: readonly string[] = []): Map<string, ThemeKey> {
  const colors = new Map<string, ThemeKey>()
  let turn = 0
  let isFirstOpen = true
  for (const name of names) {
    if (name === final) colors.set(name, 'success')
    else if (isClosedStatus(name, closed)) colors.set(name, 'inactive')
    else if (IN_PROGRESS.test(name)) colors.set(name, 'warning')
    else if (isFirstOpen) colors.set(name, 'suggestion')
    else colors.set(name, ROTATION[turn++ % ROTATION.length] ?? 'permission')
    if (name !== final && !isClosedStatus(name, closed)) isFirstOpen = false
  }
  return colors
}

/**
 * The statuses ◀ and ▶ lead to from `status`: the nearest ones before and
 * after it in `order` that are not closed. A closed status is never one,
 * but a task in a closed status still moves to the open ones beside it.
 */
export function neighbours(
  order: string[],
  status: string,
  closed: readonly string[] = [],
): { previous?: string; next?: string } {
  const i = order.indexOf(status)
  if (i === -1) return {}
  const final = order[order.length - 1]
  const isOpen = (name: string) => name === final || !isClosedStatus(name, closed)
  const previous = [...order.slice(0, i)].reverse().find(isOpen)
  const next = order.slice(i + 1).find(isOpen)
  return { previous, next }
}

/**
 * Where Backlog.md keeps its config, as it looks for it: in each folder
 * from `cwd` up, `backlog.config.yml`, then `backlog/` or `.backlog/`
 * holding `config.yml` (or `.yaml`). Nearest first, `levels` folders up at
 * most; absolute when `cwd` is (POSIX or Windows), else relative.
 */
export function configCandidates(cwd = '', levels = 12): string[] {
  const names = [
    'backlog.config.yml',
    'backlog.config.yaml',
    'backlog/config.yml',
    'backlog/config.yaml',
    '.backlog/config.yml',
    '.backlog/config.yaml',
  ]
  const sep = /^[A-Za-z]:\\|\\/.test(cwd) && !cwd.includes('/') ? '\\' : '/'
  const root = cwd.startsWith('/') ? '/' : ''
  const parts = cwd.split(/[\\/]+/).filter(part => part !== '')
  const folders: string[] = []
  if (parts.length === 0 && root === '') {
    for (let up = 0; up <= levels; up++) folders.push('../'.repeat(up))
  } else {
    for (let n = parts.length; n >= 0 && folders.length <= levels; n--) {
      const folder = root + parts.slice(0, n).join(sep)
      // A Windows drive alone (`C:`) is its root, `C:\\`.
      if (folder === '' && root === '') break
      folders.push(folder === root ? root : `${folder}${sep}`)
    }
  }
  return folders.flatMap(folder => names.map(name => `${folder}${sep === '/' ? name : name.replace(/\//g, sep)}`))
}

/**
 * The config's text with its `statuses` replaced by `statuses`, as one
 * flow list (`statuses: ["To Do", "Done"]`, the form `backlog init`
 * writes); a block list (`statuses:` then `- To Do` lines) is replaced the
 * same way. Every other line is kept as it was, line endings included.
 * Undefined when the text has no top-level `statuses` key, or has several.
 */
export function rewriteStatuses(config: string, statuses: string[]): string | undefined {
  const eol = config.includes('\r\n') ? '\r\n' : '\n'
  const lines = config.split(/\r?\n/)
  const at = lines.flatMap((line, i) => (/^statuses\s*:/.test(line) ? [i] : []))
  if (at.length !== 1) return undefined
  const start = at[0] ?? 0
  const rest = (lines[start] ?? '').replace(/^statuses\s*:/, '').trim()
  let end = start + 1
  if (rest === '' || rest.startsWith('#')) {
    // A block list: the indented `- item` lines (and blank lines) under it.
    while (end < lines.length && /^(\s+-\s|\s*$)/.test(lines[end] ?? '')) end++
    while (end > start + 1 && (lines[end - 1] ?? '').trim() === '') end--
  } else if (!rest.startsWith('[')) {
    return undefined
  }
  const line = `statuses: [${statuses.map(one => JSON.stringify(one)).join(', ')}]`
  return [...lines.slice(0, start), line, ...lines.slice(end)].join(eol)
}

export type StatusProblem = 'empty' | 'comma' | 'duplicate' | 'too-long'

/**
 * Why `name` cannot be a new status, if it cannot: empty, holding a comma
 * or a quote (`backlog config get statuses` joins them with commas), the
 * same as one there (whatever the case), or longer than 40 characters.
 */
export function statusProblem(name: string, statuses: readonly string[]): StatusProblem | undefined {
  const trimmed = name.trim()
  if (trimmed === '') return 'empty'
  if (/[,"\n\r]/.test(trimmed)) return 'comma'
  if (trimmed.length > 40) return 'too-long'
  if (statuses.some(one => one.toLowerCase() === trimmed.toLowerCase())) return 'duplicate'
  return undefined
}

/** The same lists, compared name by name. */
export const sameStatuses = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((one, i) => one === b[i])

/** Whether a task's priority is high, which the pane marks with "!". */
export const isHighPriority = (priority: string | null | undefined) => priority?.trim().toLowerCase() === 'high'

/** The board as plain text, for surfaces that draw no pane. */
export function summarize(tasks: TaskSummary[], statuses: string[], t: Strings): string {
  if (tasks.length === 0) return t.summaryEmpty
  const lines = [t.summaryCount(tasks.length)]
  for (const group of groupTasks(tasks, statuses, 5)) {
    if (group.total === 0) continue
    lines.push('', `${group.status} (${group.total})`)
    for (const task of group.tasks) lines.push(`  ${task.id}  ${task.title}`)
    if (group.total > group.tasks.length) lines.push(`  ${t.summaryMore(group.total - group.tasks.length)}`)
  }
  return lines.join('\n')
}
