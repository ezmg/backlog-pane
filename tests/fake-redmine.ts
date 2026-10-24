// A Redmine in memory, answering the REST calls the sync makes, for the
// world's `http` option. It checks the API key, keeps its issues, applies
// PUTs and POSTs, and can refuse a status change as a workflow would.

export const REDMINE = 'https://redmine.test'
export const KEY = 'secret-key'
/** The id of the user who owns KEY. */
export const ME = 7
/** A group the user of KEY is in. */
export const GROUP = 20

export type FakeIssue = {
  id: number
  subject: string
  description: string
  status: number
  priority: number
  assignee?: number
}

export const STATUSES = [
  { id: 1, name: 'New', is_closed: false },
  { id: 2, name: 'In Progress', is_closed: false },
  { id: 3, name: 'Resolved', is_closed: false },
  { id: 5, name: 'Closed', is_closed: true },
  { id: 6, name: 'Rejected', is_closed: true },
]

export const PRIORITIES = [
  { id: 1, name: 'Low', is_default: false },
  { id: 2, name: 'Normal', is_default: true },
  { id: 3, name: 'High', is_default: false },
  { id: 4, name: 'Urgent', is_default: false },
]

export function fakeRedmine(options: { project?: string; issues?: FakeIssue[]; refuseStatus?: number; down?: boolean } = {}) {
  const project = options.project ?? 'demo'
  const issues = new Map((options.issues ?? []).map(issue => [issue.id, { ...issue }]))
  let next = 100
  const json = (status: number, body: unknown) => ({ status, text: JSON.stringify(body) })
  const http = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    if (options.down) throw new Error('getaddrinfo ENOTFOUND redmine.test')
    if (!url.startsWith(REDMINE)) return json(404, {})
    if (init.headers?.['X-Redmine-API-Key'] !== KEY) return { status: 401, text: '' }
    const path = url.slice(REDMINE.length)
    const method = init.method ?? 'GET'
    const body = init.body ? (JSON.parse(init.body) as { issue: Record<string, unknown> }) : undefined
    if (path === `/projects/${project}.json`) return json(200, { project: { id: 1, identifier: project } })
    if (path.startsWith('/projects/')) return json(404, {})
    if (path.startsWith('/users/current.json')) {
      return json(200, { user: { id: ME, login: 'me', ...(path.includes('include=groups') ? { groups: [{ id: GROUP, name: 'Devs' }] } : {}) } })
    }
    if (path === '/issue_statuses.json') return json(200, { issue_statuses: STATUSES })
    if (path === '/enumerations/issue_priorities.json') return json(200, { issue_priorities: PRIORITIES })
    if (path.startsWith('/issues.json?') && method === 'GET') {
      const query = new URLSearchParams(path.slice('/issues.json?'.length))
      if (query.get('project_id') !== project) return json(404, {})
      const offset = Number(query.get('offset') ?? 0)
      const limit = Number(query.get('limit') ?? 25)
      const mine = query.get('assigned_to_id') === 'me'
      const all = [...issues.values()].filter(issue => !mine || issue.assignee === ME || issue.assignee === GROUP).sort((a, b) => a.id - b.id)
      return json(200, {
        issues: all.slice(offset, offset + limit).map(issue => ({
          id: issue.id,
          subject: issue.subject,
          description: issue.description,
          status: { id: issue.status, name: STATUSES.find(one => one.id === issue.status)?.name },
          priority: { id: issue.priority, name: PRIORITIES.find(one => one.id === issue.priority)?.name },
          ...(issue.assignee === undefined ? {} : { assigned_to: { id: issue.assignee, name: `User ${issue.assignee}` } }),
        })),
        total_count: all.length,
        offset,
        limit,
      })
    }
    if (path === '/issues.json' && method === 'POST' && body) {
      const id = next++
      issues.set(id, {
        id,
        subject: String(body.issue.subject ?? ''),
        description: String(body.issue.description ?? ''),
        status: Number(body.issue.status_id ?? 1),
        priority: Number(body.issue.priority_id ?? 2),
        assignee: body.issue.assigned_to_id === undefined ? undefined : Number(body.issue.assigned_to_id),
      })
      return json(201, { issue: { id } })
    }
    const one = /^\/issues\/(\d+)\.json$/.exec(path)
    if (one && method === 'PUT' && body) {
      const issue = issues.get(Number(one[1]))
      if (!issue) return json(404, {})
      if (body.issue.status_id !== undefined && body.issue.status_id === options.refuseStatus) {
        return json(422, { errors: ['Status is invalid'] })
      }
      if (body.issue.subject !== undefined) issue.subject = String(body.issue.subject)
      if (body.issue.description !== undefined) issue.description = String(body.issue.description)
      if (body.issue.status_id !== undefined) issue.status = Number(body.issue.status_id)
      if (body.issue.priority_id !== undefined) issue.priority = Number(body.issue.priority_id)
      return { status: 204, text: '' }
    }
    return json(404, {})
  }
  return { http, issues }
}
