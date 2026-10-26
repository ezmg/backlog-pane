// Jira, the second tracker with an API: its REST API v2, the same on Jira
// Cloud and on Jira Data Center / Server, read into the sync core's terms
// and back. Pure: register.tsx makes the requests with $.http.fetch.
//
// v2 rather than v3, because v2 takes and gives the description as text
// (wiki markup), the way Backlog.md keeps it, where v3 wants a JSON
// document. The differences between the two kinds of Jira:
//   - Cloud (*.atlassian.net): basic authentication with the account's
//     email and an API token; the search is /search/jql, paged by token;
//     a person is an accountId.
//   - Data Center / Server: a personal access token as a bearer; the
//     search is /search, paged by position; a person is a user name.
// Statuses do not change by a field: an issue moves along a transition of
// its workflow, and only to the statuses its workflow reaches from where
// it is.

import { toBase64 } from './base64'
import { redminePriorityFor } from './redmine'
import type { RedminePriority, RedmineStatus } from './redmine'
import type { Change, Fields, RemoteItem } from './sync'

export type JiraIssue = {
  key: string
  subject: string
  description: string
  statusId: string
  priorityId: string | null
  assigneeId: string | null
  /** Its issue type (Epic, Story, Task…) and the issue it hangs from (an epic's story, a story's sub-task). */
  type?: string
  parentKey?: string
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

const str = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined)

/** Whether the URL is a Jira Cloud site (which takes an email with the token). */
export function isCloud(base: string): boolean {
  try {
    return /\.(atlassian\.net|jira\.com)$/.test(new URL(base).hostname)
  } catch {
    return false
  }
}

/** An issue's page, which a task's references hold: `…/browse/APP-12`. */
export const browseUrl = (base: string, key: string) => `${base}/browse/${key}`

/** The issue key a URL of this site names, if it names one. */
export function issueKeyOf(base: string, url: string): string | undefined {
  const prefix = `${base}/browse/`
  if (!url.trim().startsWith(prefix)) return undefined
  const key = url.trim().slice(prefix.length)
  return /^[A-Z][A-Z0-9_]*-\d+$/.test(key) ? key : undefined
}

/** A project key as Jira spells it: upper case, letters, digits and underscores. */
export const projectKey = (text: string) => text.trim().toUpperCase()

export const PAGE = 100
const FIELDS = 'summary,status,priority,description,assignee,issuetype,parent'

/** Every issue of the project, or only the token owner's, oldest key first. */
export const jql = (project: string, onlyMine: boolean) =>
  `project = "${project.replace(/["\\]/g, '')}"${onlyMine ? ' AND assignee = currentUser()' : ''} ORDER BY key ASC`

/** Where the next page starts: Cloud's token, or Data Center's position. */
export type Page = { token?: string; startAt?: number }

export const urls = {
  search: (base: string, query: string, page: Page) =>
    isCloud(base)
      ? `${base}/rest/api/2/search/jql?jql=${encodeURIComponent(query)}&fields=${FIELDS}&maxResults=${PAGE}${
          page.token ? `&nextPageToken=${encodeURIComponent(page.token)}` : ''
        }`
      : `${base}/rest/api/2/search?jql=${encodeURIComponent(query)}&fields=${FIELDS}&maxResults=${PAGE}&startAt=${page.startAt ?? 0}`,
  project: (base: string, key: string) => `${base}/rest/api/2/project/${encodeURIComponent(key)}`,
  statuses: (base: string, key: string) => `${base}/rest/api/2/project/${encodeURIComponent(key)}/statuses`,
  priorities: (base: string) => (isCloud(base) ? `${base}/rest/api/2/priority/search?maxResults=100` : `${base}/rest/api/2/priority`),
  myself: (base: string) => `${base}/rest/api/2/myself`,
  issue: (base: string, key: string) => `${base}/rest/api/2/issue/${encodeURIComponent(key)}`,
  issueStatus: (base: string, key: string) => `${base}/rest/api/2/issue/${encodeURIComponent(key)}?fields=status`,
  transitions: (base: string, key: string) => `${base}/rest/api/2/issue/${encodeURIComponent(key)}/transitions`,
  create: (base: string) => `${base}/rest/api/2/issue`,
}

/** Cloud: basic with "email:token"; Data Center: the personal access token as a bearer. */
export function headers(base: string, email: string, token: string, body = false): Record<string, string> {
  const auth = isCloud(base) ? `Basic ${toBase64(new TextEncoder().encode(`${email}:${token}`))}` : `Bearer ${token}`
  return {
    Authorization: auth,
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  }
}

/** A person's id: Cloud's accountId, else Data Center's user name. */
const personOf = (value: unknown) => (isRecord(value) ? (str(value.accountId) ?? str(value.name) ?? str(value.key) ?? null) : null)

/** One page of the search, and where the next starts (none: it was the last). */
export function readSearch(text: string): { issues: JiraIssue[]; next?: Page } | undefined {
  const doc = parse(text)
  if (!isRecord(doc) || !Array.isArray(doc.issues)) return undefined
  const issues = doc.issues.filter(isRecord).flatMap(raw => {
    const fields = isRecord(raw.fields) ? raw.fields : {}
    const status = isRecord(fields.status) ? fields.status : {}
    const priority = isRecord(fields.priority) ? fields.priority : {}
    const type = isRecord(fields.issuetype) ? str(fields.issuetype.name) : undefined
    const parent = isRecord(fields.parent) ? str(fields.parent.key) : undefined
    const key = str(raw.key)
    const statusId = str(status.id)
    if (!key || !statusId) return []
    return [
      {
        key,
        subject: str(fields.summary) ?? '',
        description: str(fields.description) ?? '',
        statusId,
        priorityId: str(priority.id) ?? null,
        assigneeId: personOf(fields.assignee),
        ...(type ? { type } : {}),
        ...(parent ? { parentKey: parent } : {}),
      },
    ]
  })
  // Cloud: a token until the last page. Data Center: a position and a total.
  const token = str(doc.nextPageToken)
  if (token && doc.isLast !== true) return { issues, next: { token } }
  const startAt = typeof doc.startAt === 'number' ? doc.startAt : undefined
  const total = typeof doc.total === 'number' ? doc.total : undefined
  if (startAt !== undefined && total !== undefined && issues.length > 0 && startAt + issues.length < total) {
    return { issues, next: { startAt: startAt + issues.length } }
  }
  return { issues }
}

/**
 * The statuses the project's issue types use, once each. Jira sorts each
 * into a category: To Do (new), In Progress (indeterminate) or Done.
 */
export function readStatuses(text: string): RedmineStatus[] | undefined {
  const doc = parse(text)
  if (!Array.isArray(doc)) return undefined
  const seen = new Map<string, RedmineStatus>()
  for (const type of doc.filter(isRecord)) {
    for (const raw of Array.isArray(type.statuses) ? type.statuses.filter(isRecord) : []) {
      const id = str(raw.id)
      const name = str(raw.name)
      if (!id || !name || seen.has(id)) continue
      const category = isRecord(raw.statusCategory) ? raw.statusCategory.key : undefined
      seen.set(id, { id, name, isClosed: category === 'done', isActive: category === 'indeterminate' })
    }
  }
  return [...seen.values()]
}

/** The priorities: a list on Data Center, `{ values }` from Cloud's search. */
export function readPriorities(text: string): RedminePriority[] | undefined {
  const doc = parse(text)
  const list = Array.isArray(doc) ? doc : isRecord(doc) && Array.isArray(doc.values) ? doc.values : undefined
  if (!list) return undefined
  return list.filter(isRecord).flatMap(raw => {
    const id = str(raw.id)
    const name = str(raw.name)
    return id && name ? [{ id, name, isDefault: raw.isDefault === true }] : []
  })
}

export type IssueType = { id: string; name: string }

/** The project's issue types new tasks can be created as (not sub-tasks). */
export function readIssueTypes(text: string): IssueType[] | undefined {
  const doc = parse(text)
  if (!isRecord(doc) || !Array.isArray(doc.issueTypes)) return undefined
  return doc.issueTypes.filter(isRecord).flatMap(raw => {
    const id = str(raw.id)
    const name = str(raw.name)
    return id && name && raw.subtask !== true ? [{ id, name }] : []
  })
}

/** The issue type for new tasks: the chosen one, else Task (Tarea), else the first. */
export function issueTypeFor(types: IssueType[], chosen: string | undefined): IssueType | undefined {
  return (
    types.find(type => type.id === chosen) ??
    types.find(type => /^(task|tarea)$/i.test(type.name)) ??
    types[0]
  )
}

export const readMyself = (text: string): string | undefined => personOf(parse(text)) ?? undefined

export const readCreated = (text: string): string | undefined => {
  const doc = parse(text)
  return isRecord(doc) ? str(doc.key) : undefined
}

export function readIssueStatus(text: string): string | undefined {
  const doc = parse(text)
  const fields = isRecord(doc) && isRecord(doc.fields) ? doc.fields : {}
  return isRecord(fields.status) ? str(fields.status.id) : undefined
}

/** The transitions open to an issue now: each one's id and the status it leads to. */
export function readTransitions(text: string): { id: string; to: string }[] {
  const doc = parse(text)
  if (!isRecord(doc) || !Array.isArray(doc.transitions)) return []
  return doc.transitions.filter(isRecord).flatMap(raw => {
    const id = str(raw.id)
    const to = isRecord(raw.to) ? str(raw.to.id) : undefined
    return id && to ? [{ id, to }] : []
  })
}

/** Jira's own words for a refused request (`errorMessages`, `errors`), or the status. */
export function readError(status: number, text: string): string {
  const doc = parse(text)
  if (isRecord(doc)) {
    const messages = Array.isArray(doc.errorMessages) ? doc.errorMessages.map(String) : []
    const fields = isRecord(doc.errors) ? Object.entries(doc.errors).map(([field, why]) => `${field}: ${String(why)}`) : []
    if (messages.length + fields.length > 0) return [...messages, ...fields].join('; ')
  }
  return `HTTP ${status}`
}

/** An issue in Backlog.md's terms. A status the map lacks lands in `fallback`. */
export function toRemoteIssue(
  base: string,
  issue: JiraIssue,
  statusMap: Readonly<Record<string, string>>,
  priorityMap: Readonly<Record<string, string>>,
  fallback: string,
): RemoteItem {
  const fields: Fields = {
    title: issue.subject,
    status: statusMap[issue.statusId] ?? fallback,
    priority: issue.priorityId === null ? null : (priorityMap[issue.priorityId] || '').toLowerCase() || null,
    description: issue.description,
  }
  return {
    key: issue.key,
    url: browseUrl(base, issue.key),
    fields,
    ...(issue.type ? { type: issue.type } : {}),
    ...(issue.parentKey ? { parentKey: issue.parentKey } : {}),
  }
}

/**
 * The `fields` of a PUT (or a create) for a change, and the fields it could
 * not carry (a priority no Jira one maps to). The status goes apart, by a
 * transition.
 */
export function fieldsBody(
  change: Change,
  priorityMap: Readonly<Record<string, string>>,
  priorities: RedminePriority[],
  current?: string | null,
): { fields: Record<string, unknown>; skipped: string[] } {
  const fields: Record<string, unknown> = {}
  const skipped: string[] = []
  if (change.title !== undefined) fields.summary = change.title
  if (change.description !== undefined) fields.description = change.description
  if (change.priority !== undefined && change.priority !== null) {
    const id = redminePriorityFor(change.priority, priorityMap, priorities, current)
    if (id === undefined) skipped.push('priority')
    else fields.priority = { id: String(id) }
  }
  return { fields, skipped }
}

/** Who a new issue is assigned to: Cloud by accountId, Data Center by user name. */
export const assigneeField = (base: string, me: string) => (isCloud(base) ? { accountId: me } : { name: me })
