// Redmine, the first outside tracker: its REST API (JSON, the key in the
// X-Redmine-API-Key header), read into the sync core's terms and back.
// Pure: register.tsx makes the requests with $.http.fetch.

import type { Change, Fields, RemoteItem } from './sync'

export type RedmineStatus = { id: number; name: string; isClosed: boolean }
export type RedminePriority = { id: number; name: string; isDefault: boolean }

export type RedmineIssue = {
  id: number
  subject: string
  description: string
  statusId: number
  priorityId: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The server's base URL, http or https, no trailing slash; undefined when it is not one. */
export function normalizeUrl(text: string): string | undefined {
  const trimmed = text.trim().replace(/\/+$/, '')
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    return trimmed
  } catch {
    return undefined
  }
}

export const issueUrl = (base: string, id: number | string) => `${base}/issues/${id}`

/** The issue id an issue URL of this server names, if it names one. */
export function issueIdOf(base: string, url: string): number | undefined {
  const match = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/issues/(\\d+)$`).exec(url.trim())
  return match ? Number(match[1]) : undefined
}

export const PAGE = 100

export const urls = {
  /** Every issue of the project, open and closed, not its subprojects', by id; or only the key owner's. */
  issues: (base: string, project: string, offset: number, onlyMine = false) =>
    `${base}/issues.json?project_id=${encodeURIComponent(project)}&subproject_id=!*&status_id=*${onlyMine ? '&assigned_to_id=me' : ''}&sort=id&limit=${PAGE}&offset=${offset}`,
  currentUser: (base: string) => `${base}/users/current.json`,
  project: (base: string, project: string) => `${base}/projects/${encodeURIComponent(project)}.json`,
  statuses: (base: string) => `${base}/issue_statuses.json`,
  priorities: (base: string) => `${base}/enumerations/issue_priorities.json`,
  issue: (base: string, id: number | string) => `${base}/issues/${id}.json`,
  create: (base: string) => `${base}/issues.json`,
}

export const headers = (key: string, body = false): Record<string, string> => ({
  'X-Redmine-API-Key': key,
  Accept: 'application/json',
  ...(body ? { 'Content-Type': 'application/json' } : {}),
})

/** One page of `/issues.json`: its issues, and how many there are in all. */
export function readIssues(text: string): { issues: RedmineIssue[]; total: number } | undefined {
  const doc = parse(text)
  if (!isRecord(doc) || !Array.isArray(doc.issues)) return undefined
  const issues = doc.issues.filter(isRecord).flatMap(raw => {
    const status = isRecord(raw.status) ? raw.status : {}
    const priority = isRecord(raw.priority) ? raw.priority : {}
    if (typeof raw.id !== 'number' || typeof status.id !== 'number') return []
    return [
      {
        id: raw.id,
        subject: typeof raw.subject === 'string' ? raw.subject : '',
        description: typeof raw.description === 'string' ? raw.description : '',
        statusId: status.id,
        priorityId: typeof priority.id === 'number' ? priority.id : null,
      },
    ]
  })
  return { issues, total: typeof doc.total_count === 'number' ? doc.total_count : issues.length }
}

export function readStatuses(text: string): RedmineStatus[] | undefined {
  const doc = parse(text)
  if (!isRecord(doc) || !Array.isArray(doc.issue_statuses)) return undefined
  return doc.issue_statuses
    .filter(isRecord)
    .filter(raw => typeof raw.id === 'number' && typeof raw.name === 'string')
    .map(raw => ({ id: raw.id as number, name: raw.name as string, isClosed: raw.is_closed === true }))
}

export function readPriorities(text: string): RedminePriority[] | undefined {
  const doc = parse(text)
  if (!isRecord(doc) || !Array.isArray(doc.issue_priorities)) return undefined
  return doc.issue_priorities
    .filter(isRecord)
    .filter(raw => typeof raw.id === 'number' && typeof raw.name === 'string')
    .map(raw => ({ id: raw.id as number, name: raw.name as string, isDefault: raw.is_default === true }))
}

/** The id of an issue Redmine answered a create with. */
export function readCreated(text: string): number | undefined {
  const doc = parse(text)
  return isRecord(doc) && isRecord(doc.issue) && typeof doc.issue.id === 'number' ? doc.issue.id : undefined
}

/** The id of the key's owner, from `/users/current.json`. */
export function readCurrentUser(text: string): number | undefined {
  const doc = parse(text)
  return isRecord(doc) && isRecord(doc.user) && typeof doc.user.id === 'number' ? doc.user.id : undefined
}

/** Redmine's own words for a refused write (422 `{ errors: [...] }`), or the status. */
export function readError(status: number, text: string): string {
  const doc = parse(text)
  if (isRecord(doc) && Array.isArray(doc.errors) && doc.errors.length > 0) return doc.errors.map(String).join('; ')
  return `HTTP ${status}`
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

const ACTIVE = /progress|curso|progreso|doing|working|feedback|resolv|review|revision/
const LOW = /^(low|baja?|bajo|minor)$/
const NORMAL = /^(normal|medium|media|medio)$/
const HIGH = /^(high|alta?|alto|urgent|urgente|immediate|inmediata|critical|critica)$/

/**
 * Where each Redmine status lands in Backlog.md, by default: a status of
 * the same name; else a closed one in the final status, an active-sounding
 * one (In Progress, Feedback, Resolved…) in the first such Backlog.md
 * status, the rest in the first status. The person changes any of them.
 */
export function defaultStatusMap(redmine: RedmineStatus[], statuses: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  const final = statuses[statuses.length - 1] ?? ''
  const active = statuses.find(one => ACTIVE.test(fold(one))) ?? statuses[1] ?? statuses[0] ?? ''
  for (const status of redmine) {
    const named = statuses.find(one => fold(one) === fold(status.name))
    map[String(status.id)] = named ?? (status.isClosed ? final : ACTIVE.test(fold(status.name)) ? active : statuses[0] ?? '')
  }
  return map
}

/** Where each Redmine priority lands among Backlog.md's (High, Medium, Low by default). */
export function defaultPriorityMap(redmine: RedminePriority[], priorities: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  const pick = (want: string) => priorities.find(one => one.toLowerCase() === want)
  for (const priority of redmine) {
    const name = fold(priority.name)
    const named = priorities.find(one => fold(one) === name)
    const guess = named ?? (HIGH.test(name) ? pick('high') : NORMAL.test(name) ? pick('medium') : LOW.test(name) ? pick('low') : undefined)
    if (guess) map[String(priority.id)] = guess
  }
  return map
}

/** An issue in Backlog.md's terms. A status the map lacks lands in `fallback`. */
export function toRemoteItem(
  base: string,
  issue: RedmineIssue,
  statusMap: Readonly<Record<string, string>>,
  priorityMap: Readonly<Record<string, string>>,
  fallback: string,
): RemoteItem {
  const fields: Fields = {
    title: issue.subject,
    status: statusMap[String(issue.statusId)] ?? fallback,
    // An unmapped priority (or one set to be left alone, '') is null: the sync leaves priority be.
    // Lower case, as a task's JSON spells it (`backlog config get priorities` prints High).
    priority: issue.priorityId === null ? null : (priorityMap[String(issue.priorityId)] || '').toLowerCase() || null,
    description: issue.description,
  }
  return { key: String(issue.id), url: issueUrl(base, issue.id), fields }
}

/**
 * The Redmine status for a Backlog.md status: the issue's own when it
 * already maps there (no needless change), else the first that does.
 */
export function redmineStatusFor(
  status: string,
  statusMap: Readonly<Record<string, string>>,
  redmine: RedmineStatus[],
  current?: number,
): number | undefined {
  const matches = redmine.filter(one => statusMap[String(one.id)] === status)
  return matches.find(one => one.id === current)?.id ?? matches[0]?.id
}

export function redminePriorityFor(
  priority: string | null | undefined,
  priorityMap: Readonly<Record<string, string>>,
  redmine: RedminePriority[],
  current?: number | null,
): number | undefined {
  if (!priority) return undefined
  const matches = redmine.filter(one => priorityMap[String(one.id)]?.toLowerCase() === priority.toLowerCase())
  return matches.find(one => one.id === current)?.id ?? matches[0]?.id
}

/**
 * The `issue` body of a PUT for a change, and the fields it could not carry
 * (a status or priority no Redmine one maps to).
 */
export function issueBody(
  change: Change,
  maps: { status: Readonly<Record<string, string>>; priority: Readonly<Record<string, string>> },
  lists: { statuses: RedmineStatus[]; priorities: RedminePriority[] },
  current?: { statusId?: number; priorityId?: number | null },
): { issue: Record<string, string | number>; skipped: string[] } {
  const issue: Record<string, string | number> = {}
  const skipped: string[] = []
  if (change.title !== undefined) issue.subject = change.title
  if (change.description !== undefined) issue.description = change.description
  if (change.status !== undefined) {
    const id = redmineStatusFor(change.status, maps.status, lists.statuses, current?.statusId)
    if (id === undefined) skipped.push('status')
    else issue.status_id = id
  }
  if (change.priority !== undefined && change.priority !== null) {
    const id = redminePriorityFor(change.priority, maps.priority, lists.priorities, current?.priorityId)
    if (id === undefined) skipped.push('priority')
    else issue.priority_id = id
  }
  return { issue, skipped }
}
