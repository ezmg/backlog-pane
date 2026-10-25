import { expect, test } from 'claude-code/testing'

import { CLOUD, EMAIL, ME, SERVER, TOKEN, fakeJira } from './fake-jira'
import type { FakeJiraIssue } from './fake-jira'
import { CWD, PANE, open, world } from './fixtures'
import type { FakeTask } from './fixtures'

// The sync with Jira, end to end: the pane, a Backlog.md board whose create
// and edit commands really change it, and a Jira in memory, Cloud or Data
// Center.

const SYNC_KEY = `sync:${CWD}/backlog/config.yml`
const CLOUD_KEYS = { options: { jiraEmail: EMAIL, jiraApiToken: TOKEN } }
const SERVER_KEYS = { options: { jiraApiToken: TOKEN } }

const ISSUES: FakeJiraIssue[] = [
  { key: 'APP-1', summary: 'Login page', description: 'Email and password.', status: '3', priority: '2', assignee: ME.cloud },
  { key: 'APP-2', summary: 'Old bug', description: null, status: '10002', priority: '3' },
]

/** A project already set up to sync with the fake Jira. */
const settings = (over: Record<string, unknown> = {}) => ({
  [SYNC_KEY]: {
    settings: {
      provider: 'jira',
      url: CLOUD,
      project: 'APP',
      file: '',
      mode: 'read',
      onlyMine: false,
      view: 'all',
      intervalMin: 5,
      statusMap: {},
      priorityMap: {},
      excluded: [],
      ...over,
    },
    data: {},
  },
})

const browse = (key: string, base = CLOUD) => `${base}/browse/${key}`
const LATER = '2030-01-01T00:00:00Z'

test('set up in the pane: pick Jira, its URL and project key, then sync', CLOUD_KEYS, async ($, on) => {
  const fake = fakeJira({ issues: ISSUES })
  const { clock, tasks, requests } = world(on, { isStateful: true, tasks: [], http: fake.http })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  await ui.select({ key: 'sync-tracker', value: 'jira' })
  expect((await ui.find({ key: 'sync-url' }))?.props.label).toBe('Jira URL')
  expect(await ui.find({ type: 'Text', text: 'API token: set.' })).toBeDefined()
  await ui.input({ key: 'sync-url', text: `${CLOUD}/` })
  await ui.input({ key: 'sync-project', text: 'app' })
  await ui.press({ key: 'sync-now' })

  expect(tasks.map(task => [task.title, task.status, task.priority, task.references])).toEqual([
    ['Login page', 'In Progress', 'high', [browse('APP-1')]],
    ['Old bug', 'Done', 'medium', [browse('APP-2')]],
  ])
  expect(tasks[0]?.description).toBe('Email and password.')
  expect(await ui.find({ type: 'Text', text: 'Jira: 2 from Jira, 0 to Jira, 0 conflicts.' })).toBeDefined()
  // Cloud: basic authentication with the email and the token; the enhanced search.
  expect(requests[0]?.auth).toMatch(/^Basic /)
  expect(requests.some(one => one.url.startsWith(`${CLOUD}/rest/api/2/search/jql?jql=`))).toBe(true)
  expect(requests.every(one => one.method === 'GET')).toBe(true)
  // The mappings: In Review is In Progress by its category; Highest is High.
  expect((await ui.find({ key: 'sync-status-10001' }))?.props.value).toBe('In Progress')
  expect((await ui.find({ key: 'sync-priority-1' }))?.props.value).toBe('high')
  expect((await ui.find({ key: 'sync-priority-5' }))?.props.value).toBe('low')
  expect(await ui.find({ type: 'Text', text: 'Jira status → Backlog.md status' })).toBeDefined()
  await ui.unmount()
})

test('both ways: fields by a PUT, the status by a transition, a new task becomes an issue', CLOUD_KEYS, async ($, on) => {
  const fake = fakeJira({ issues: ISSUES })
  const { clock, tasks, requests } = world(on, { isStateful: true, tasks: [], http: fake.http, store: settings({ mode: 'both' }) })
  await open($, clock)
  expect(tasks).toHaveLength(2)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const linked = tasks[0] as FakeTask
  linked.title = 'Login and sign-up'
  linked.status = 'Done'
  linked.updatedAt = LATER
  tasks.push({ id: 'BL-9', title: 'Rate limiting', status: 'In Progress', priority: 'high', description: 'Per IP.', references: [] })
  await ui.press({ key: 'sync-now-board' })

  const put = requests.find(one => one.method === 'PUT')
  expect(put?.url).toBe(`${CLOUD}/rest/api/2/issue/APP-1`)
  expect(put?.body).toEqual({ fields: { summary: 'Login and sign-up' } })
  expect(fake.issues.get('APP-1')?.status).toBe('10002')
  // The new one: created as a Task, then moved along to In Progress.
  const post = requests.find(one => one.method === 'POST' && one.url.endsWith('/rest/api/2/issue'))
  expect(post?.body).toEqual({
    fields: { project: { key: 'APP' }, issuetype: { id: '10001' }, summary: 'Rate limiting', description: 'Per IP.', priority: { id: '2' } },
  })
  expect(fake.issues.get('APP-100')).toMatchObject({ summary: 'Rate limiting', status: '3', type: '10001' })
  expect(tasks.find(task => task.id === 'BL-9')?.references).toEqual([browse('APP-100')])
  expect(await ui.find({ type: 'Text', text: 'Jira: 0 from Jira, 2 to Jira, 0 conflicts.' })).toBeDefined()
  // Nothing left to do.
  const writes = requests.filter(one => one.method !== 'GET').length
  await ui.press({ key: 'sync-now-board' })
  expect(requests.filter(one => one.method !== 'GET')).toHaveLength(writes)
  // The issue type for new tasks can be picked.
  await ui.press({ key: 'sync-open' })
  const types = (await ui.find({ key: 'sync-issue-type' }))?.props.options as { label: string }[]
  expect(types.map(one => one.label)).toEqual([
    'Task, or the first',
    'Task',
    'Bug',
  ])
  await ui.unmount()
})

test('a status the workflow cannot reach from where the issue is: a warning, tried again', CLOUD_KEYS, async ($, on) => {
  const fake = fakeJira({ issues: ISSUES, blocked: ['3>10002'] })
  const { clock, tasks, requests } = world(on, { isStateful: true, tasks: [], http: fake.http, store: settings({ mode: 'both' }) })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  ;(tasks[0] as FakeTask).status = 'Done'
  await ui.press({ key: 'sync-open' })
  await ui.press({ key: 'sync-now' })
  expect(
    await ui.find({ type: 'Text', text: 'BL-1: its Jira workflow has no transition to “Done” from where the issue is, so its status was not sent.' }),
  ).toBeDefined()
  expect(requests.some(one => one.method === 'POST' && one.url.endsWith('/transitions'))).toBe(false)
  // Moved on to In Review in Jira (In Progress here too): from there Done is open.
  fake.issues.get('APP-1')!.status = '10001'
  await ui.press({ key: 'sync-now' })
  expect(fake.issues.get('APP-1')?.status).toBe('10002')
  expect(await ui.find({ type: 'Text', text: 'Jira: 0 from Jira, 1 to Jira, 0 conflicts.' })).toBeDefined()
  await ui.unmount()
})

test('a field changed on both sides is a conflict; each side can win', CLOUD_KEYS, async ($, on) => {
  const fake = fakeJira({ issues: ISSUES })
  const { clock, tasks } = world(on, { isStateful: true, tasks: [], http: fake.http, store: settings({ mode: 'both' }) })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  fake.issues.get('APP-1')!.summary = 'Login (Jira)'
  fake.issues.get('APP-2')!.summary = 'Old bug (Jira)'
  ;(tasks[0] as FakeTask).title = 'Login (here)'
  ;(tasks[1] as FakeTask).title = 'Old bug (here)'
  await ui.press({ key: 'sync-now-board' })
  expect(await ui.find({ type: 'Text', text: /2 conflicts$/ })).toBeDefined()
  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ type: 'Text', text: 'Jira: Login (Jira)' })).toBeDefined()
  expect((await ui.find({ key: 'conflict-remote-0' }))?.props.label).toBe('Use Jira’s')
  await ui.press({ key: 'conflict-remote-0' })
  expect(tasks[0]?.title).toBe('Login (Jira)')
  await ui.press({ key: 'conflict-local-0' })
  expect(fake.issues.get('APP-2')?.summary).toBe('Old bug (here)')
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: 'Jira: 0 from Jira, 0 to Jira, 0 conflicts.' })).toBeDefined()
  await ui.unmount()
})

test('only mine: currentUser() in the JQL, new issues assigned to you, and the board’s view', CLOUD_KEYS, async ($, on) => {
  const fake = fakeJira({ issues: [...ISSUES, { key: 'APP-3', summary: 'Someone else’s', description: '', status: '10000', priority: '3', assignee: 'acc-ana' }] })
  const { clock, tasks, requests } = world(on, { isStateful: true, tasks: [], http: fake.http, store: settings({ mode: 'both' }) })
  await open($, clock)
  expect(tasks).toHaveLength(3)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  // The view, at once: only APP-1 is mine.
  await clock.advance(2_000)
  await ui.press({ key: 'sync-view' })
  expect((await ui.find({ key: 'sync-view' }))?.props.label).toBe('View: only mine (2 hidden)')
  await ui.press({ key: 'sync-view' })

  await ui.press({ key: 'sync-open' })
  await ui.select({ key: 'sync-scope', value: 'mine' })
  tasks.push({ id: 'BL-9', title: 'Rate limiting', status: 'To Do', references: [] })
  await ui.press({ key: 'sync-now' })
  expect(requests.some(one => decodeURIComponent(one.url).includes('AND assignee = currentUser()'))).toBe(true)
  const post = requests.find(one => one.method === 'POST' && one.url.endsWith('/rest/api/2/issue'))
  expect((post?.body as { fields: { assignee: unknown } }).fields.assignee).toEqual({ accountId: ME.cloud })
  // To Do is where a new issue starts: no transition.
  expect(requests.some(one => one.method === 'POST' && one.url.endsWith('/transitions'))).toBe(false)
  await ui.unmount()
})

test('Data Center: a bearer token, /search paged by position, user names', SERVER_KEYS, async ($, on) => {
  const many: FakeJiraIssue[] = Array.from({ length: 5 }, (_, i) => ({
    key: `APP-${i + 1}`,
    summary: `Issue ${i + 1}`,
    description: '',
    status: '10000',
    priority: '3',
    assignee: i === 0 ? ME.server : undefined,
  }))
  const fake = fakeJira({ base: SERVER, issues: many, page: 2 })
  const { clock, tasks, requests } = world(on, {
    isStateful: true,
    tasks: [],
    http: fake.http,
    store: settings({ url: SERVER, mode: 'both', onlyMine: true }),
  })
  await open($, clock)
  expect(requests[0]?.auth).toBe(`Bearer ${TOKEN}`)
  expect(tasks.map(task => task.title)).toEqual(['Issue 1'])
  // Every issue, three pages of two.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  await ui.select({ key: 'sync-scope', value: 'all' })
  await ui.press({ key: 'sync-now' })
  expect(tasks.map(task => task.title)).toEqual(['Issue 1', 'Issue 2', 'Issue 3', 'Issue 4', 'Issue 5'])
  expect(requests.filter(one => one.url.startsWith(`${SERVER}/rest/api/2/search?`)).map(one => new URL(one.url).searchParams.get('startAt'))).toEqual([
    '0',
    '0',
    '2',
    '4',
  ])
  expect(tasks[0]?.references).toEqual([browse('APP-1', SERVER)])
  await ui.unmount()
})

test('no token: says so and reads nothing', async ($, on) => {
  const fake = fakeJira({ issues: ISSUES })
  const { clock, tasks } = world(on, { isStateful: true, tasks: [], http: fake.http, store: settings() })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ type: 'Text', text: /^API token: missing\. Set “Jira API token”/ })).toBeDefined()
  await ui.press({ key: 'sync-now' })
  expect(tasks).toHaveLength(0)
  await ui.unmount()
})

test('a Cloud site with no email says so', { options: { jiraApiToken: TOKEN } }, async ($, on) => {
  const fake = fakeJira({ issues: ISSUES })
  const { clock, tasks } = world(on, { isStateful: true, tasks: [], http: fake.http, store: settings() })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ type: 'Text', text: /^Jira Cloud needs your account’s email too/ })).toBeDefined()
  expect(tasks).toHaveLength(0)
  await ui.unmount()
})

test('a wrong token, and a project Jira does not have', { options: { jiraEmail: EMAIL, jiraApiToken: 'wrong' } }, async ($, on) => {
  const fake = fakeJira({ issues: ISSUES })
  const { clock, tasks } = world(on, { isStateful: true, tasks: [], http: fake.http, store: settings() })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ type: 'Text', text: 'Jira refused the email or the API token (401). Check them in the plugin’s settings.' })).toBeDefined()
  expect(tasks).toHaveLength(0)
  await ui.unmount()
})

test('a project Jira does not have', CLOUD_KEYS, async ($, on) => {
  const fake = fakeJira({ issues: ISSUES })
  const { clock, tasks } = world(on, { isStateful: true, tasks: [], http: fake.http, store: settings({ project: 'NOPE' }) })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ type: 'Text', text: 'Jira has no project “NOPE” (404), or this token cannot see it.' })).toBeDefined()
  expect(tasks).toHaveLength(0)
  await ui.unmount()
})

test('Spanish: Jira’s words', { options: { language: 'es', jiraEmail: EMAIL, jiraApiToken: TOKEN } }, async ($, on) => {
  const fake = fakeJira({ issues: ISSUES })
  const { clock } = world(on, { isStateful: true, tasks: [], http: fake.http, store: settings() })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect((await ui.find({ key: 'sync-project' }))?.props.label).toBe('Clave del proyecto')
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: 'Jira: 0 desde Jira, 0 a Jira, 0 conflictos.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Token de API: configurado.' })).toBeDefined()
  await ui.unmount()
})
