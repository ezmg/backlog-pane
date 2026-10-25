// A Jira in memory, answering the REST v2 calls the sync makes, for the
// world's `http` option: Cloud (basic auth, /search/jql paged by token,
// accountIds) or Data Center (a bearer token, /search paged by position,
// user names). Statuses change only by a transition its workflow allows.

import { toBase64 } from '../hooks/base64'

export const CLOUD = 'https://acme.atlassian.net'
export const SERVER = 'https://jira.acme.test'
export const EMAIL = 'me@acme.test'
export const TOKEN = 'jira-token'
/** Who owns TOKEN: an accountId on Cloud, a user name on Data Center. */
export const ME = { cloud: 'acc-me', server: 'me' }

export type FakeJiraIssue = {
  key: string
  summary: string
  description: string | null
  status: string
  priority: string | null
  assignee?: string
  type?: string
}

export const STATUSES = [
  { id: '10000', name: 'To Do', statusCategory: { key: 'new' } },
  { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  { id: '10001', name: 'In Review', statusCategory: { key: 'indeterminate' } },
  { id: '10002', name: 'Done', statusCategory: { key: 'done' } },
]

export const PRIORITIES = [
  { id: '1', name: 'Highest' },
  { id: '2', name: 'High' },
  { id: '3', name: 'Medium', isDefault: true },
  { id: '4', name: 'Low' },
  { id: '5', name: 'Lowest' },
]

export const TYPES = [
  { id: '10001', name: 'Task', subtask: false },
  { id: '10002', name: 'Bug', subtask: false },
  { id: '10003', name: 'Sub-task', subtask: true },
]

export function fakeJira(
  options: {
    base?: string
    project?: string
    issues?: FakeJiraIssue[]
    /** Transitions the workflow lacks, as "from>to" status ids. */
    blocked?: string[]
    /** Issues per page, whatever maxResults asks. */
    page?: number
  } = {},
) {
  const base = options.base ?? CLOUD
  const isCloud = base === CLOUD
  const project = options.project ?? 'APP'
  const issues = new Map((options.issues ?? []).map(issue => [issue.key, { ...issue }]))
  let next = 100
  const me = isCloud ? ME.cloud : ME.server
  const auth = isCloud ? `Basic ${toBase64(new TextEncoder().encode(`${EMAIL}:${TOKEN}`))}` : `Bearer ${TOKEN}`
  const json = (status: number, body: unknown) => ({ status, text: JSON.stringify(body) })
  const person = (id: string | undefined) => (id === undefined ? null : isCloud ? { accountId: id } : { name: id })
  const shape = (issue: FakeJiraIssue) => ({
    id: issue.key.replace(/\D/g, ''),
    key: issue.key,
    fields: {
      summary: issue.summary,
      description: issue.description,
      status: STATUSES.find(one => one.id === issue.status),
      priority: issue.priority === null ? null : PRIORITIES.find(one => one.id === issue.priority),
      assignee: person(issue.assignee),
    },
  })
  const http = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    if (!url.startsWith(base)) return json(404, {})
    if (init.headers?.Authorization !== auth) return { status: 401, text: '' }
    const parsed = new URL(url)
    const path = parsed.pathname
    const query = parsed.searchParams
    const method = init.method ?? 'GET'
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    if (path === `/rest/api/2/project/${project}`) return json(200, { key: project, issueTypes: TYPES })
    if (path.startsWith('/rest/api/2/project/') && path.endsWith('/statuses')) {
      return path === `/rest/api/2/project/${project}/statuses`
        ? json(200, [
            { name: 'Task', statuses: STATUSES },
            { name: 'Bug', statuses: STATUSES.slice(0, 2) },
          ])
        : json(404, { errorMessages: ['No project could be found'] })
    }
    if (path.startsWith('/rest/api/2/project/')) return json(404, { errorMessages: ['No project could be found'] })
    if (path === '/rest/api/2/priority/search' && isCloud) return json(200, { values: PRIORITIES, isLast: true })
    if (path === '/rest/api/2/priority' && !isCloud) return json(200, PRIORITIES)
    if (path === '/rest/api/2/myself') return json(200, isCloud ? { accountId: me } : { name: me, key: 'JIRAUSER1' })
    const search = isCloud ? '/rest/api/2/search/jql' : '/rest/api/2/search'
    if (path === search && method === 'GET') {
      const jql = query.get('jql') ?? ''
      if (!jql.startsWith(`project = "${project}"`)) return json(400, { errorMessages: ['The project does not exist.'] })
      const mine = jql.includes('assignee = currentUser()')
      const all = [...issues.values()]
        .filter(issue => !mine || issue.assignee === me)
        .sort((a, b) => Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]))
      const size = Math.min(options.page ?? 100, Number(query.get('maxResults') ?? 50))
      const at = isCloud ? Number(query.get('nextPageToken') ?? 0) : Number(query.get('startAt') ?? 0)
      const slice = all.slice(at, at + size).map(shape)
      return isCloud
        ? json(200, { issues: slice, ...(at + size < all.length ? { nextPageToken: String(at + size) } : { isLast: true }) })
        : json(200, { startAt: at, maxResults: size, total: all.length, issues: slice })
    }
    if (path === '/rest/api/2/issue' && method === 'POST' && body) {
      const fields = body.fields as Record<string, unknown>
      const type = (fields.issuetype as { id?: string } | undefined)?.id
      if (!type) return json(400, { errors: { issuetype: 'Specify an issue type' } })
      if ((fields.project as { key?: string }).key !== project) return json(400, { errors: { project: 'project is required' } })
      const assignee = fields.assignee as { accountId?: string; name?: string } | undefined
      const key = `${project}-${next++}`
      issues.set(key, {
        key,
        summary: String(fields.summary ?? ''),
        description: (fields.description as string | undefined) ?? null,
        status: '10000',
        priority: (fields.priority as { id?: string } | undefined)?.id ?? '3',
        assignee: assignee?.accountId ?? assignee?.name,
        type,
      })
      return json(201, { id: key.replace(/\D/g, ''), key, self: `${base}/rest/api/2/issue/${key}` })
    }
    const one = /^\/rest\/api\/2\/issue\/([A-Z]+-\d+)(\/transitions)?$/.exec(path)
    const issue = one ? issues.get(one[1] as string) : undefined
    if (one && !issue) return json(404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'] })
    if (one && issue && one[2]) {
      const open = STATUSES.filter(status => status.id !== issue.status && !options.blocked?.includes(`${issue.status}>${status.id}`))
      if (method === 'GET') return json(200, { transitions: open.map(status => ({ id: `t${status.id}`, name: status.name, to: status })) })
      const id = (body?.transition as { id?: string } | undefined)?.id
      const to = open.find(status => `t${status.id}` === id)
      if (!to) return json(400, { errorMessages: ['Transition id is not valid for this issue.'] })
      issue.status = to.id
      return { status: 204, text: '' }
    }
    if (one && issue && method === 'GET') return json(200, shape(issue))
    if (one && issue && method === 'PUT' && body) {
      const fields = body.fields as Record<string, unknown>
      if ('status' in fields) return json(400, { errors: { status: 'Field cannot be set. It is not on the appropriate screen.' } })
      if (fields.summary !== undefined) issue.summary = String(fields.summary)
      if (fields.description !== undefined) issue.description = fields.description as string
      if (fields.priority !== undefined) issue.priority = (fields.priority as { id: string }).id
      return { status: 204, text: '' }
    }
    return json(404, {})
  }
  return { http, issues }
}
