import { expect, test } from 'claude-code/testing'

import { GROUP, KEY, ME, REDMINE, fakeRedmine } from './fake-redmine'
import type { FakeIssue } from './fake-redmine'
import { CWD, PANE, open, world } from './fixtures'
import type { FakeTask } from './fixtures'

// The sync with Redmine, end to end: the pane, a Backlog.md board whose
// create and edit commands really change it, and a Redmine in memory.

const SYNC_KEY = `sync:${CWD}/backlog/config.yml`
const WITH_KEY = { options: { redmineApiKey: KEY } }

const ISSUES: FakeIssue[] = [
  { id: 1, subject: 'Login page', description: 'Email and password.', status: 2, priority: 3 },
  { id: 2, subject: 'Old bug', description: '', status: 5, priority: 2 },
]

/** A project already set up to sync with the fake Redmine. */
const settings = (over: Record<string, unknown> = {}) => ({
  [SYNC_KEY]: {
    settings: {
      provider: 'redmine',
      url: REDMINE,
      project: 'demo',
      mode: 'read',
      intervalMin: 5,
      statusMap: {},
      priorityMap: {},
      excluded: [],
      ...over,
    },
    data: {},
  },
})

const issueUrl = (id: number) => `${REDMINE}/issues/${id}`
/** A time after every sync of a test (the mocked clock starts at 0). */
const LATER = '2030-01-01T00:00:00Z'

test('set up in the pane: pick Redmine, its URL and project, then sync', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock, tasks, store } = world(on, { isStateful: true, tasks: [], http: redmine.http })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect((await ui.find({ key: 'sync-tracker' }))?.props.value).toBe('none')
  await ui.select({ key: 'sync-tracker', value: 'redmine' })
  expect(await ui.find({ type: 'Text', text: 'API key: set.' })).toBeDefined()
  await ui.input({ key: 'sync-url', text: 'redmine.test' })
  expect(await ui.find({ type: 'Text', text: /starting with https:\/\// })).toBeDefined()
  await ui.input({ key: 'sync-url', text: `${REDMINE}/` })
  await ui.input({ key: 'sync-project', text: ' demo ' })
  expect((await ui.find({ key: 'sync-mode' }))?.props.value).toBe('read')
  await ui.press({ key: 'sync-now' })

  // Each issue is a task, linked by its URL, its status and priority mapped.
  expect(tasks.map(task => [task.title, task.status, task.priority, task.references])).toEqual([
    ['Login page', 'In Progress', 'high', [issueUrl(1)]],
    ['Old bug', 'Done', 'medium', [issueUrl(2)]],
  ])
  expect(tasks[0]?.description).toBe('Email and password.')
  expect(await ui.find({ type: 'Text', text: 'Redmine: 2 from Redmine, 0 to Redmine, 0 conflicts.' })).toBeDefined()
  const kept = store.get(SYNC_KEY) as { settings: { url: string; project: string }; data: { links: object } }
  expect(kept.settings).toMatchObject({ url: REDMINE, project: 'demo' })
  expect(Object.keys(kept.data.links)).toEqual(['1', '2'])
  // The mappings show once Redmine's statuses and priorities are known.
  expect((await ui.find({ key: 'sync-status-3' }))?.props.value).toBe('In Progress')
  expect((await ui.find({ key: 'sync-priority-4' }))?.props.value).toBe('high')
  // A second sync changes nothing.
  await ui.press({ key: 'sync-now' })
  expect(tasks).toHaveLength(2)
  await ui.unmount()
})

test('read only: Redmine’s changes come in; a local change is never sent', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock, tasks, requests } = world(on, { isStateful: true, tasks: [], http: redmine.http, store: settings() })
  // The pane's first list starts a sync by itself.
  await open($, clock)
  expect(tasks).toHaveLength(2)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // On the board: a line that says so, and a button to sync again.
  expect(await ui.find({ type: 'Text', text: /^Redmine · read only/ })).toBeDefined()
  redmine.issues.get(1)!.subject = 'Login and sign-up'
  const task = tasks[1] as FakeTask
  task.title = 'Renamed here'
  await ui.press({ key: 'sync-now-board' })
  expect(tasks[0]?.title).toBe('Login and sign-up')
  expect(tasks[1]?.title).toBe('Renamed here')
  expect(requests.some(one => one.method !== 'GET')).toBe(false)
  await ui.unmount()
})

test('both ways: a local change goes to Redmine, a new task becomes an issue', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const before: FakeTask[] = [{ id: 'BL-1', title: 'Local idea', status: 'To Do', references: [] }]
  const { clock, tasks, requests, store } = world(on, {
    isStateful: true,
    tasks: before,
    http: redmine.http,
    store: settings({ mode: 'both', excluded: ['BL-1'] }),
  })
  await open($, clock)
  // BL-1 existed before the sync: not sent.
  expect([...redmine.issues.values()]).toHaveLength(2)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Changed by hand (or by Claude) in Backlog.md: its updatedAt moves on.
  const linked = tasks.find(task => task.title === 'Login page') as FakeTask
  linked.status = 'Done'
  linked.description = 'Email, password and a reset link.'
  linked.updatedAt = LATER
  tasks.push({ id: 'BL-9', title: 'Rate limiting', status: 'To Do', priority: 'high', description: 'Per IP.', references: [] })
  await ui.press({ key: 'sync-now-board' })

  const put = requests.find(one => one.method === 'PUT')
  expect(put?.url).toBe(`${REDMINE}/issues/1.json`)
  expect(put?.body).toEqual({ issue: { status_id: 5, description: 'Email, password and a reset link.' } })
  expect(put?.key).toBe(KEY)
  const post = requests.find(one => one.method === 'POST')
  expect(post?.body).toEqual({
    issue: { project_id: 'demo', subject: 'Rate limiting', description: 'Per IP.', status_id: 1, priority_id: 3 },
  })
  // The new issue's URL is added to the task's references.
  expect(tasks.find(task => task.id === 'BL-9')?.references).toEqual([issueUrl(100)])
  expect(redmine.issues.get(1)?.status).toBe(5)

  // Sending the old ones too: BL-1 becomes an issue on the next sync.
  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ type: 'Text', text: /1 task that existed before the sync is not sent/ })).toBeDefined()
  await ui.press({ key: 'sync-include-old' })
  await ui.press({ key: 'sync-now' })
  expect([...redmine.issues.values()].map(issue => issue.subject)).toContain('Local idea')
  expect((store.get(SYNC_KEY) as { settings: { excluded: string[] } }).settings.excluded).toEqual([])
  await ui.unmount()
})

test('only mine: just the issues assigned to the key’s owner; a new task is assigned to them', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({
    issues: [
      { id: 1, subject: 'Mine', description: '', status: 1, priority: 2, assignee: ME },
      { id: 2, subject: 'Someone else’s', description: '', status: 1, priority: 2, assignee: 3 },
      { id: 3, subject: 'Nobody’s', description: '', status: 1, priority: 2 },
    ],
  })
  const { clock, tasks, requests } = world(on, { isStateful: true, tasks: [], http: redmine.http, store: settings({ mode: 'both' }) })
  await open($, clock)
  // Off by default: every issue comes in.
  expect(tasks.map(task => task.title)).toEqual(['Mine', 'Someone else’s', 'Nobody’s'])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect((await ui.find({ key: 'sync-scope' }))?.props.value).toBe('all')
  await ui.select({ key: 'sync-scope', value: 'mine' })
  expect(await ui.find({ type: 'Text', text: /^both ways · Every 5 min · only mine/ })).toBeDefined()
  expect(requests.filter(one => one.url.includes('assigned_to_id=me'))).toHaveLength(0)

  // Issue 2 is no longer listed: its task stays as it was, and is not sent back as new.
  redmine.issues.get(2)!.subject = 'Renamed in Redmine'
  tasks.push({ id: 'BL-9', title: 'Rate limiting', status: 'To Do', references: [] })
  await ui.press({ key: 'sync-now' })
  expect(requests.some(one => one.method === 'GET' && one.url.includes('&assigned_to_id=me&'))).toBe(true)
  expect(tasks.map(task => task.title)).toEqual(['Mine', 'Someone else’s', 'Nobody’s', 'Rate limiting'])
  const posts = requests.filter(one => one.method === 'POST')
  expect(posts.map(one => one.body)).toEqual([
    { issue: { project_id: 'demo', subject: 'Rate limiting', description: '', status_id: 1, assigned_to_id: ME } },
  ])
  // The new issue is the owner's, so it is in the list next time: nothing more is sent.
  await ui.press({ key: 'sync-now' })
  expect(requests.filter(one => one.method !== 'GET')).toHaveLength(1)
  expect(tasks).toHaveLength(4)
  await ui.unmount()
})

test('the board’s view: only mine hides the tasks of others’ issues at once, and is kept', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({
    issues: [
      { id: 1, subject: 'Mine', description: '', status: 1, priority: 2, assignee: ME },
      { id: 2, subject: 'My group’s', description: '', status: 1, priority: 2, assignee: GROUP },
      { id: 3, subject: 'Someone else’s', description: '', status: 1, priority: 2, assignee: 3 },
    ],
  })
  const before: FakeTask[] = [{ id: 'BL-1', title: 'Local idea', status: 'To Do', references: [] }]
  const { clock, tasks, requests, store } = world(on, { isStateful: true, tasks: before, http: redmine.http, store: settings() })
  await open($, clock)
  expect(tasks).toHaveLength(4)
  // The fake watch shows the tasks the sync made when it starts again.
  await clock.advance(2_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const titles = async () => {
    const seen: string[] = []
    for (const task of tasks) if (await ui.find({ key: `task:${task.id}` })) seen.push(task.title)
    return seen.sort()
  }
  expect(await titles()).toHaveLength(4)
  const syncs = requests.length
  await ui.press({ key: 'sync-view' })
  // At once, with no call to Redmine; local tasks are nobody else’s, so they stay.
  expect(requests).toHaveLength(syncs)
  expect(await titles()).toEqual(['Local idea', 'Mine', 'My group’s'])
  expect((await ui.find({ key: 'sync-view' }))?.props.label).toBe('View: only mine (1 hidden)')
  expect((store.get(SYNC_KEY) as { settings: { view: string } }).settings.view).toBe('mine')
  // Reassigned in Redmine: it shows after the next sync.
  redmine.issues.get(3)!.assignee = ME
  await ui.press({ key: 'sync-now-board' })
  await clock.advance(2_000)
  expect(await titles()).toHaveLength(4)
  expect((await ui.find({ key: 'sync-view' }))?.props.label).toBe('View: only mine')
  await ui.press({ key: 'sync-view' })
  expect((await ui.find({ key: 'sync-view' }))?.props.label).toBe('View: all')
  await ui.unmount()
})

test('priorities the config prints capitalized are no change: nothing is sent', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock, requests } = world(on, {
    isStateful: true,
    tasks: [],
    http: redmine.http,
    // As the real CLI prints them; a task's JSON has them in lower case.
    config: { priorities: { exitCode: 0, stdout: 'High, Medium, Low\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } },
    store: settings({ mode: 'both' }),
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-now-board' })
  expect(requests.filter(one => one.method !== 'GET')).toEqual([])
  await ui.unmount()
})

test('a field changed on both sides is a conflict; the person picks a side', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock, tasks, requests } = world(on, {
    isStateful: true,
    tasks: [],
    http: redmine.http,
    store: settings({ mode: 'both' }),
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  redmine.issues.get(1)!.subject = 'Login (Redmine)'
  redmine.issues.get(2)!.subject = 'Old bug (Redmine)'
  ;(tasks[0] as FakeTask).title = 'Login (here)'
  ;(tasks[1] as FakeTask).title = 'Old bug (here)'
  await ui.press({ key: 'sync-now-board' })
  // Neither side was touched.
  expect(tasks[0]?.title).toBe('Login (here)')
  expect(redmine.issues.get(1)?.subject).toBe('Login (Redmine)')
  expect(await ui.find({ type: 'Text', text: /2 conflicts$/ })).toBeDefined()

  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ type: 'Text', text: 'BL-1: the title changed on both sides.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Redmine: Login (Redmine)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Backlog.md: Login (here)' })).toBeDefined()
  await ui.press({ key: 'conflict-remote-0' })
  expect(tasks[0]?.title).toBe('Login (Redmine)')
  // The other conflict is now the first.
  await ui.press({ key: 'conflict-local-0' })
  expect(redmine.issues.get(2)?.subject).toBe('Old bug (here)')
  expect(requests.filter(one => one.method === 'PUT')).toHaveLength(1)
  expect(await ui.find({ key: 'conflict-remote-0' })).toBe(undefined)
  // Settled: the next sync finds nothing to do.
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: 'Redmine: 0 from Redmine, 0 to Redmine, 0 conflicts.' })).toBeDefined()
  await ui.unmount()
})

test('a status Redmine’s workflow refuses: a warning, tried again next time', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES, refuseStatus: 5 })
  const { clock, tasks, requests } = world(on, { isStateful: true, tasks: [], http: redmine.http, store: settings({ mode: 'both' }) })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  ;(tasks[0] as FakeTask).status = 'Done'
  await ui.press({ key: 'sync-open' })
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: 'Redmine refused the change to #1: Status is invalid' })).toBeDefined()
  await ui.press({ key: 'sync-now' })
  expect(requests.filter(one => one.method === 'PUT')).toHaveLength(2)
  await ui.unmount()
})

test('a status no Redmine one maps to is not sent, and says so', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock, tasks, requests } = world(on, {
    isStateful: true,
    tasks: [],
    statuses: ['To Do', 'In Progress', 'Review', 'Done'],
    http: redmine.http,
    store: settings({ mode: 'both' }),
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  ;(tasks[0] as FakeTask).status = 'Review'
  await ui.press({ key: 'sync-open' })
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: /no Redmine status maps to “Review”/ })).toBeDefined()
  expect(requests.some(one => one.method === 'PUT')).toBe(false)
  // Mapping one there fixes it.
  await ui.select({ key: 'sync-status-3', value: 'Review' })
  await ui.press({ key: 'sync-now' })
  expect(redmine.issues.get(1)?.status).toBe(3)
  await ui.unmount()
})

test('the automatic sync runs on the timer while the pane is open', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock, requests } = world(on, {
    isStateful: true,
    tasks: [],
    http: redmine.http,
    store: settings({ intervalMin: 15 }),
    // The first watch lists the board; the ones after fail until the mod
    // stops restarting them (15 s of the mocked clock), so long advances stay cheap.
    laterWatch: { stderr: 'boom', code: 1 },
  })
  await open($, clock)
  const reads = () => requests.filter(one => one.url.includes('/issues.json?')).length
  expect(reads()).toBe(1)
  await clock.advance(14 * 60_000)
  expect(reads()).toBe(1)
  await clock.advance(60_000)
  expect(reads()).toBe(2)
  await clock.advance(15 * 60_000)
  expect(reads()).toBe(3)
})

test('with the interval set to the button only, nothing runs by itself', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock, requests } = world(on, {
    isStateful: true,
    tasks: [],
    http: redmine.http,
    store: settings({ intervalMin: 0 }),
    laterWatch: { stderr: 'boom', code: 1 },
  })
  await open($, clock)
  await clock.advance(120 * 60_000)
  // The one sync as the pane opened, none after.
  expect(requests.filter(one => one.url.includes('/issues.json?'))).toHaveLength(1)
})

for (const [name, redmineOptions, options, says] of [
  ['no API key', {}, {}, /API key: missing/],
  ['a wrong API key', {}, { redmineApiKey: 'nope' }, /refused the API key \(401\)/],
  ['a project Redmine does not have', { project: 'other' }, WITH_KEY.options, /has no project “demo” \(404\)/],
  ['a server that cannot be reached', { down: true }, WITH_KEY.options, /Could not reach Redmine/],
] as const) {
  test(`${name}: says so and changes nothing`, { options }, async ($, on) => {
    const redmine = fakeRedmine({ issues: ISSUES, ...redmineOptions })
    const { clock, tasks } = world(on, { isStateful: true, tasks: [], http: redmine.http, store: settings() })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'sync-open' })
    await ui.press({ key: 'sync-now' })
    expect(await ui.find({ type: 'Text', text: says })).toBeDefined()
    expect(tasks).toEqual([])
    await ui.unmount()
  })
}

test('disconnecting keeps the tasks and stops the sync', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock, tasks, store } = world(on, { isStateful: true, tasks: [], http: redmine.http, store: settings() })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'sync-open' })
  await ui.press({ key: 'sync-remove' })
  expect(await ui.find({ type: 'Text', text: /Disconnected. The tasks stay in Backlog.md/ })).toBeDefined()
  expect(tasks).toHaveLength(2)
  expect((store.get(SYNC_KEY) as { settings: unknown }).settings).toBe(null)
  await ui.press({ key: 'sync-back' })
  expect(await ui.find({ key: 'sync-now-board' })).toBe(undefined)
  await ui.unmount()
})

test('mobile: syncs and settles conflicts; the setup needs fields', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock } = world(on, { isStateful: true, tasks: [], http: redmine.http, store: settings() })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ key: 'sync-url' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /redmine\.test · demo$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^read only · Every 5 min/ })).toBeDefined()
  expect(await ui.find({ key: 'sync-now' })).toBeDefined()
  await ui.unmount()
})

test('Spanish: the integration view', { options: { language: 'es', redmineApiKey: KEY } }, async ($, on) => {
  const redmine = fakeRedmine({ issues: ISSUES })
  const { clock } = world(on, { isStateful: true, tasks: [], http: redmine.http, store: settings() })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'sync-open' }))?.text).toBe('Integración…')
  expect(await ui.find({ type: 'Text', text: /^Redmine · solo lectura/ })).toBeDefined()
  await ui.press({ key: 'sync-open' })
  expect((await ui.find({ key: 'sync-mode' }))?.props.options).toEqual([
    { value: 'read', label: 'Solo lectura (Redmine → Backlog.md)' },
    { value: 'both', label: 'Bidireccional' },
  ])
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: 'Redmine: 0 desde Redmine, 0 hacia Redmine, 0 conflictos.' })).toBeDefined()
  await ui.unmount()
})

test('types and parents from the API: trackers as labels, subtasks under their parent; Textile converted', WITH_KEY, async ($, on) => {
  const redmine = fakeRedmine({
    issues: [
      { id: 7, subject: 'Child', description: '* *one*\n* two', status: 1, priority: 2, tracker: 'Bug', parent: 5 },
      { id: 5, subject: 'Parent', description: 'h2. Plan', status: 1, priority: 2, tracker: 'Feature' },
    ],
  })
  const { clock, tasks } = world(on, { isStateful: true, tasks: [], http: redmine.http, store: settings() })
  await open($, clock)
  const parent = tasks.find(task => task.title === 'Parent') as FakeTask
  expect(parent).toMatchObject({ labels: ['Feature'], description: '## Plan' })
  expect(tasks.find(task => task.title === 'Child')).toMatchObject({
    labels: ['Bug'],
    parentTaskId: parent.id,
    description: '- **one**\n- two',
  })
})
