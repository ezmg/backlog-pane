import { describe, expect, test } from 'claude-code/testing'

import {
  defaultPriorityMap,
  defaultStatusMap,
  issueBody,
  issueIdOf,
  normalizeUrl,
  readCreated,
  readCurrentUser,
  readError,
  readIssues,
  readPriorities,
  readStatuses,
  redmineStatusFor,
  toRemoteItem,
  urls,
} from '../hooks/redmine'
import { mergeField, needsRead, othersTasks, plan, readSyncStore } from '../hooks/sync'
import type { Fields, LocalItem, RemoteItem } from '../hooks/sync'

const fields = (over: Partial<Fields> = {}): Fields => ({
  title: 'Login',
  status: 'To Do',
  priority: 'medium',
  description: 'Do it',
  ...over,
})
const remote = (key: string, over: Partial<Fields> = {}): RemoteItem => ({
  key,
  url: `https://r.test/issues/${key}`,
  fields: fields(over),
})
const local = (id: string, over: Partial<Fields> = {}, references: string[] = []): LocalItem => ({
  id,
  references,
  fields: fields(over),
})
const BASE = { mode: 'both' as const, conflicts: [], excluded: [], createsRemote: true }

describe('merging one field', () => {
  test('the same on both sides: nothing', async () => {
    expect(mergeField('a', 'b', 'b', 'both')).toEqual({ agreed: 'b' })
  })
  test('changed on one side: the other takes it', async () => {
    expect(mergeField('a', 'a', 'b', 'both')).toEqual({ toLocal: 'b', agreed: 'b' })
    expect(mergeField('a', 'b', 'a', 'both')).toEqual({ toRemote: 'b', agreed: 'b' })
  })
  test('changed on both, differently: a conflict, nothing moves', async () => {
    expect(mergeField('a', 'b', 'c', 'both')).toEqual({ agreed: 'a', isConflict: true })
  })
  test('read only: the tracker’s change wins; a local change stays local', async () => {
    expect(mergeField('a', 'b', 'c', 'read')).toEqual({ toLocal: 'c', agreed: 'c' })
    expect(mergeField('a', 'b', 'a', 'read')).toEqual({ agreed: 'a' })
  })
  test('a field not read this time counts as unchanged', async () => {
    expect(mergeField('a', undefined, 'b', 'both')).toEqual({ toLocal: 'b', agreed: 'b' })
  })
  test('line endings, trailing space and empty vs null do not count as changes', async () => {
    expect(mergeField('x\r\ny ', 'x\ny', 'x\ny', 'both')).toEqual({ agreed: 'x\ny' })
    expect(mergeField(null, '', null, 'both')).toEqual({ agreed: null })
  })
})

describe('planning a sync', () => {
  test('a new issue becomes a task', async () => {
    const planned = plan({ ...BASE, remote: [remote('1')], local: [], links: {} })
    expect(planned.actions).toEqual([{ kind: 'create-local', key: '1', url: 'https://r.test/issues/1', fields: fields() }])
  })

  test('a linked pair: each side gets what the other changed', async () => {
    const planned = plan({
      ...BASE,
      remote: [remote('1', { title: 'Login page' })],
      local: [local('BL-1', { status: 'In Progress' })],
      links: { '1': { taskId: 'BL-1', base: fields() } },
    })
    expect(planned.actions).toEqual([
      { kind: 'update-local', key: '1', taskId: 'BL-1', change: { title: 'Login page' } },
      { kind: 'update-remote', key: '1', taskId: 'BL-1', change: { status: 'In Progress' } },
    ])
    expect(planned.links['1']?.base).toEqual(fields({ title: 'Login page', status: 'In Progress' }))
  })

  test('the same field changed on both sides is a conflict, the base kept', async () => {
    const planned = plan({
      ...BASE,
      remote: [remote('1', { title: 'From Redmine' })],
      local: [local('BL-1', { title: 'From Backlog' })],
      links: { '1': { taskId: 'BL-1', base: fields() } },
    })
    expect(planned.actions).toEqual([])
    expect(planned.conflicts).toEqual([
      { key: '1', taskId: 'BL-1', field: 'title', local: 'From Backlog', remote: 'From Redmine' },
    ])
    expect(planned.links['1']?.base.title).toBe('Login')
  })

  test('a conflict both sides have settled the same way goes away', async () => {
    const planned = plan({
      ...BASE,
      remote: [remote('1', { title: 'Same' })],
      local: [local('BL-1', { title: 'Same' })],
      links: { '1': { taskId: 'BL-1', base: fields() } },
      conflicts: [{ key: '1', taskId: 'BL-1', field: 'title', local: 'x', remote: 'y' }],
    })
    expect(planned.conflicts).toEqual([])
    expect(planned.links['1']?.base.title).toBe('Same')
  })

  test('read only never writes to the tracker', async () => {
    const planned = plan({
      ...BASE,
      mode: 'read',
      remote: [remote('1', { title: 'New title' })],
      local: [local('BL-1', { status: 'Done' }), local('BL-9')],
      links: { '1': { taskId: 'BL-1', base: fields() } },
    })
    expect(planned.actions).toEqual([{ kind: 'update-local', key: '1', taskId: 'BL-1', change: { title: 'New title' } }])
  })

  test('a task that names the issue in its references is adopted; the tracker wins', async () => {
    const planned = plan({
      ...BASE,
      remote: [remote('1', { status: 'Done' })],
      local: [local('BL-4', {}, ['https://r.test/issues/1'])],
      links: {},
    })
    expect(planned.actions).toEqual([{ kind: 'update-local', key: '1', taskId: 'BL-4', change: { status: 'Done' } }])
  })

  test('new tasks go to the tracker, but not excluded ones, nor in read only', async () => {
    const input = { ...BASE, remote: [], local: [local('BL-1'), local('BL-2')], links: {}, excluded: ['BL-1'] }
    expect(plan(input).actions).toEqual([{ kind: 'create-remote', taskId: 'BL-2', fields: fields() }])
    // A task that names an issue of the tracker not listed this time (only mine) is not new.
    const named = { ...input, excluded: [], local: [local('BL-3', {}, ['https://r.test/issues/9'])] }
    expect(plan({ ...named, ownsRef: ref => ref.startsWith('https://r.test/issues/') }).actions).toEqual([])
    expect(plan({ ...input, mode: 'read' }).actions).toEqual([])
    expect(plan({ ...input, createsRemote: false }).actions).toEqual([])
  })

  test('an issue gone from the list keeps its link; nothing is deleted', async () => {
    const links = { '7': { taskId: 'BL-7', base: fields() } }
    const planned = plan({ ...BASE, remote: [], local: [local('BL-7')], links })
    expect(planned.actions).toEqual([])
    expect(planned.links).toEqual(links)
  })

  test('a tracker priority with nowhere to land leaves priority alone', async () => {
    const planned = plan({
      ...BASE,
      remote: [remote('1', { priority: null })],
      local: [local('BL-1', { priority: 'high' })],
      links: { '1': { taskId: 'BL-1', base: fields() } },
    })
    expect(planned.actions).toEqual([])
    expect(planned.links['1']?.base.priority).toBe('high')
  })

  test('a description is read only when the task changed since the last sync', async () => {
    expect(needsRead('2026-10-24T20:44:00Z', undefined)).toBe(true)
    expect(needsRead('2026-10-24T20:44:00Z', '2026-10-24T20:44:31.000Z')).toBe(true)
    expect(needsRead('2026-10-24T20:43:00Z', '2026-10-24T20:44:31.000Z')).toBe(false)
  })

  test('what the store holds is read back only where well formed', async () => {
    expect(readSyncStore(undefined).settings).toBe(null)
    const kept = readSyncStore({
      settings: { provider: 'redmine', url: 'https://r.test', project: 'p', mode: 'nonsense', intervalMin: -3, statusMap: { 1: 'To Do', 2: 7 } },
      data: { links: { 1: { taskId: 'BL-1', base: fields() } }, warnings: ['w', 3] },
    })
    expect(kept.settings).toMatchObject({ mode: 'read', intervalMin: 5, statusMap: { 1: 'To Do' }, excluded: [] })
    expect(kept.data.warnings).toEqual(['w'])
  })
})

describe('Redmine', () => {
  test('server URLs', async () => {
    expect(normalizeUrl(' https://redmine.example.com/ ')).toBe('https://redmine.example.com')
    expect(normalizeUrl('http://10.0.0.5:3000/redmine')).toBe('http://10.0.0.5:3000/redmine')
    expect(normalizeUrl('ftp://x')).toBe(undefined)
    expect(normalizeUrl('redmine.example.com')).toBe(undefined)
    expect(issueIdOf('https://r.test', 'https://r.test/issues/42')).toBe(42)
    expect(issueIdOf('https://r.test', 'https://other.test/issues/42')).toBe(undefined)
    expect(urls.issues('https://r.test', 'my app', 100)).toBe(
      'https://r.test/issues.json?project_id=my%20app&subproject_id=!*&status_id=*&sort=id&limit=100&offset=100',
    )
    expect(urls.issues('https://r.test', 'demo', 0, true)).toBe(
      'https://r.test/issues.json?project_id=demo&subproject_id=!*&status_id=*&assigned_to_id=me&sort=id&limit=100&offset=0',
    )
    expect(readCurrentUser('{"user":{"id":7}}')).toEqual([7])
    expect(readCurrentUser('{"user":{"id":7,"groups":[{"id":20},{"name":"x"}]}}')).toEqual([7, 20])
    expect(readCurrentUser('{"user":{}}')).toBe(undefined)
  })

  test('its answers are read, and what does not fit is dropped', async () => {
    const page = readIssues(
      JSON.stringify({
        issues: [
          { id: 1, subject: 'A', description: null, status: { id: 2 }, priority: { id: 3 } },
          { id: 2, subject: 'B', status: { id: 1 }, assigned_to: { id: 7, name: 'Me' } },
          { id: 'bad', status: { id: 1 } },
        ],
        total_count: 9,
      }),
    )
    expect(page).toEqual({
      issues: [
        { id: 1, subject: 'A', description: '', statusId: 2, priorityId: 3, assigneeId: null },
        { id: 2, subject: 'B', description: '', statusId: 1, priorityId: null, assigneeId: 7 },
      ],
      total: 9,
    })
    expect(readIssues('<html>')).toBe(undefined)
    expect(readStatuses(JSON.stringify({ issue_statuses: [{ id: 5, name: 'Closed', is_closed: true }] }))).toEqual([
      { id: 5, name: 'Closed', isClosed: true },
    ])
    expect(readPriorities(JSON.stringify({ issue_priorities: [{ id: 2, name: 'Normal', is_default: true }] }))).toEqual([
      { id: 2, name: 'Normal', isDefault: true },
    ])
    expect(readCreated(JSON.stringify({ issue: { id: 77 } }))).toBe(77)
    expect(readError(422, JSON.stringify({ errors: ['Status is invalid', 'Subject cannot be blank'] }))).toBe(
      'Status is invalid; Subject cannot be blank',
    )
    expect(readError(500, 'oops')).toBe('HTTP 500')
  })

  const redmineStatuses = [
    { id: 1, name: 'New', isClosed: false },
    { id: 2, name: 'In Progress', isClosed: false },
    { id: 3, name: 'Resolved', isClosed: false },
    { id: 4, name: 'Feedback', isClosed: false },
    { id: 5, name: 'Closed', isClosed: true },
    { id: 6, name: 'Rejected', isClosed: true },
  ]

  test('statuses land by name, then closed in the final one, active ones in progress', async () => {
    expect(defaultStatusMap(redmineStatuses, ['To Do', 'In Progress', 'Done'])).toEqual({
      1: 'To Do',
      2: 'In Progress',
      3: 'In Progress',
      4: 'In Progress',
      5: 'Done',
      6: 'Done',
    })
    expect(defaultStatusMap(redmineStatuses, ['Por decidir', 'Por hacer', 'En curso', 'Hecho'])).toMatchObject({
      1: 'Por decidir',
      2: 'En curso',
      5: 'Hecho',
    })
  })

  test('priorities land by name, in English or Spanish', async () => {
    const redminePriorities = [
      { id: 1, name: 'Low', isDefault: false },
      { id: 2, name: 'Normal', isDefault: true },
      { id: 3, name: 'High', isDefault: false },
      { id: 4, name: 'Urgente', isDefault: false },
      { id: 5, name: 'Whenever', isDefault: false },
    ]
    expect(defaultPriorityMap(redminePriorities, ['high', 'medium', 'low'])).toEqual({
      1: 'low',
      2: 'medium',
      3: 'high',
      4: 'high',
    })
  })

  test('a priority is lower case, as a task spells it, whatever the config prints', async () => {
    const issue = { id: 3, subject: 'S', description: '', statusId: 1, priorityId: 3, assigneeId: null }
    expect(toRemoteItem('https://r.test', issue, { 1: 'To Do' }, { 3: 'High' }, 'To Do').fields.priority).toBe('high')
  })

  test('an issue in Backlog.md terms', async () => {
    const issue = { id: 3, subject: 'S', description: 'D', statusId: 9, priorityId: 2, assigneeId: null }
    expect(toRemoteItem('https://r.test', issue, { 1: 'To Do' }, { 2: '' }, 'To Do')).toEqual({
      key: '3',
      url: 'https://r.test/issues/3',
      fields: { title: 'S', status: 'To Do', priority: null, description: 'D' },
    })
  })

  test('back to Redmine: the issue’s own status when it maps there, else the first that does', async () => {
    const map = { 2: 'In Progress', 3: 'In Progress', 5: 'Done' }
    expect(redmineStatusFor('In Progress', map, redmineStatuses)).toBe(2)
    expect(redmineStatusFor('In Progress', map, redmineStatuses, 3)).toBe(3)
    expect(redmineStatusFor('Review', map, redmineStatuses)).toBe(undefined)
    const body = issueBody(
      { title: 'T', status: 'Review', priority: 'high' },
      { status: map, priority: { 3: 'high' } },
      { statuses: redmineStatuses, priorities: [{ id: 3, name: 'High', isDefault: false }] },
    )
    expect(body).toEqual({ issue: { subject: 'T', priority_id: 3 }, skipped: ['status'] })
  })
})

describe('the only mine view', () => {
  test('hides the tasks of issues assigned to others, to nobody, or not listed; never local ones', async () => {
    const base = fields()
    const links = {
      1: { taskId: 'BL-1', base },
      2: { taskId: 'BL-2', base },
      3: { taskId: 'BL-3', base },
      4: { taskId: 'BL-4', base },
      5: { taskId: 'BL-5', base },
    }
    const meta = {
      1: { statusId: 1, priorityId: null, assigneeId: 7 },
      2: { statusId: 1, priorityId: null, assigneeId: 20 },
      3: { statusId: 1, priorityId: null, assigneeId: 3 },
      4: { statusId: 1, priorityId: null, assigneeId: null },
    }
    expect([...othersTasks(links, meta, [7, 20])].sort()).toEqual(['BL-3', 'BL-4', 'BL-5'])
  })
})

describe('parents first', () => {
  test('a new task comes after the new task it hangs from, whatever the order in the tracker', async () => {
    const items: RemoteItem[] = [
      { ...remote('3'), parentKey: '2', type: 'Task' },
      { ...remote('2'), parentKey: '1', type: 'Story' },
      { ...remote('9'), parentKey: '404' },
      { ...remote('1'), type: 'Epic' },
    ]
    const planned = plan({ ...BASE, remote: items, local: [], links: {} })
    expect(planned.actions.map(action => action.kind === 'create-local' && [action.key, action.parentKey, action.type])).toEqual([
      ['9', '404', undefined],
      ['1', undefined, 'Epic'],
      ['2', '1', 'Story'],
      ['3', '2', 'Task'],
    ])
  })
})
