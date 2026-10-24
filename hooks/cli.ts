// Pure helpers: the backlog command lines, the reader for its JSON stream,
// and the grouping the pane draws. Nothing here touches `$`, so the tests
// can cover it directly.

import type { ThemeKey } from 'claude-code'

import type { Checklist, TaskDetail, TaskSummary } from '../types'
import type { Strings } from './i18n'

export const DEFAULT_STATUSES = ['To Do', 'In Progress', 'Done']

export const args = {
  version: () => ['--version'],
  statuses: () => ['config', 'get', 'statuses'],
  list: () => ['task', 'list', '--json'],
  watch: () => ['task', 'list', '--json', '--watch'],
  view: (id: string) => ['task', 'view', id, '--json'],
  setStatus: (id: string, status: string) => ['task', 'edit', id, '--status', status],
  create: (title: string) => ['task', 'create', title],
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

/** `backlog config get statuses` prints `To Do, In Progress, Done`. */
export function parseStatuses(stdout: string): string[] {
  const list = stdout
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(one => one.trim())
    .filter(one => one !== '')
  return list.length > 0 ? list : DEFAULT_STATUSES
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
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
  color: ThemeKey
}

const recency = (task: TaskSummary) => task.updatedAt ?? task.createdAt ?? ''

/**
 * Groups tasks by status in the configured order, statuses the config does
 * not list after it. The final status (the config's last) keeps only its
 * `doneLimit` most recently changed tasks; `total` still counts them all.
 */
export function groupTasks(tasks: TaskSummary[], statuses: string[], doneLimit: number): Group[] {
  const order = statuses.length > 0 ? statuses : DEFAULT_STATUSES
  const final = order[order.length - 1]
  const names = [...order]
  for (const task of tasks) if (!names.includes(task.status)) names.push(task.status)
  const colors = statusColors(names, final ?? '')
  return names.map(status => {
    let list = tasks.filter(task => task.status === status)
    const total = list.length
    const isFinal = status === final
    if (isFinal) {
      list = [...list].sort((a, b) => recency(b).localeCompare(recency(a))).slice(0, Math.max(0, doneLimit))
    }
    return { status, tasks: list, total, isFinal, color: colors.get(status) ?? 'text' }
  })
}

const ROTATION: ThemeKey[] = ['permission', 'planMode', 'ide', 'merged']
const IN_PROGRESS = /in[ -]?progress|en (curso|progreso)|doing|wip/i

/**
 * Each status's colour, by theme key so it follows the person's light or
 * dark theme: the first status `suggestion`, one named like "In Progress"
 * `warning`, the final one `success`, the others in turn from ROTATION.
 * `names` is every status shown, in order; `final` the configured last.
 */
export function statusColors(names: string[], final: string): Map<string, ThemeKey> {
  const colors = new Map<string, ThemeKey>()
  let turn = 0
  names.forEach((name, i) => {
    if (name === final) colors.set(name, 'success')
    else if (IN_PROGRESS.test(name)) colors.set(name, 'warning')
    else if (i === 0) colors.set(name, 'suggestion')
    else colors.set(name, ROTATION[turn++ % ROTATION.length] ?? 'permission')
  })
  return colors
}

/** The statuses before and after `status` in `order`, where there are any. */
export function neighbours(order: string[], status: string): { previous?: string; next?: string } {
  const i = order.indexOf(status)
  if (i === -1) return {}
  return { previous: order[i - 1], next: order[i + 1] }
}

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
