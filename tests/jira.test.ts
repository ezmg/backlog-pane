import { describe, expect, test } from 'claude-code/testing'

import {
  browseUrl,
  fieldsBody,
  headers,
  isCloud,
  issueKeyOf,
  issueTypeFor,
  jql,
  readError,
  readPriorities,
  readSearch,
  readStatuses,
  readTransitions,
  toRemoteIssue,
  urls,
} from '../hooks/jira'

// The Jira adapter: Cloud's and Data Center's answers, read into the sync
// core's terms, and the requests built back.

describe('the two kinds of Jira', () => {
  test('Cloud by its host; basic auth there, a bearer elsewhere', async () => {
    expect(isCloud('https://acme.atlassian.net')).toBe(true)
    expect(isCloud('https://jira.acme.test')).toBe(false)
    expect(headers('https://acme.atlassian.net', 'me@x.test', 'tok').Authorization).toBe('Basic bWVAeC50ZXN0OnRvaw==')
    expect(headers('https://jira.acme.test', '', 'tok').Authorization).toBe('Bearer tok')
  })
  test('the search: /search/jql by token on Cloud, /search by position elsewhere', async () => {
    const query = jql('APP', true)
    expect(query).toBe('project = "APP" AND assignee = currentUser() ORDER BY key ASC')
    expect(urls.search('https://acme.atlassian.net', query, { token: 'abc' })).toContain('/rest/api/2/search/jql?jql=')
    expect(urls.search('https://acme.atlassian.net', query, { token: 'abc' })).toContain('&nextPageToken=abc')
    expect(urls.search('https://jira.acme.test', query, { startAt: 200 })).toContain('/rest/api/2/search?jql=')
    expect(urls.search('https://jira.acme.test', query, { startAt: 200 })).toContain('&startAt=200')
    expect(jql('A"B', false)).toBe('project = "AB" ORDER BY key ASC')
  })
  test('issue keys and their pages', async () => {
    expect(browseUrl('https://j.test', 'APP-3')).toBe('https://j.test/browse/APP-3')
    expect(issueKeyOf('https://j.test', 'https://j.test/browse/APP-3')).toBe('APP-3')
    expect(issueKeyOf('https://j.test', 'https://other.test/browse/APP-3')).toBe(undefined)
    expect(issueKeyOf('https://j.test', 'https://j.test/browse/nope')).toBe(undefined)
  })
})

describe('reading answers', () => {
  const issue = (key: string, over: Record<string, unknown> = {}) => ({
    key,
    fields: { summary: key, description: null, status: { id: '3' }, priority: { id: '2' }, assignee: { accountId: 'acc' }, ...over },
  })
  test('a search page and where the next starts', async () => {
    expect(readSearch(JSON.stringify({ issues: [issue('A-1')], nextPageToken: 't2' }))?.next).toEqual({ token: 't2' })
    expect(readSearch(JSON.stringify({ issues: [issue('A-1')], isLast: true }))?.next).toBe(undefined)
    expect(readSearch(JSON.stringify({ startAt: 0, total: 3, issues: [issue('A-1'), issue('A-2')] }))?.next).toEqual({ startAt: 2 })
    expect(readSearch(JSON.stringify({ startAt: 2, total: 3, issues: [issue('A-3')] }))?.next).toBe(undefined)
    expect(readSearch(JSON.stringify({ issues: [issue('A-1', { priority: null, assignee: { name: 'me' } })] }))?.issues).toEqual([
      { key: 'A-1', subject: 'A-1', description: '', statusId: '3', priorityId: null, assigneeId: 'me' },
    ])
    expect(readSearch('<html>')).toBe(undefined)
  })
  test('statuses once each, with their category', async () => {
    const text = JSON.stringify([
      { name: 'Task', statuses: [{ id: '1', name: 'To Do', statusCategory: { key: 'new' } }, { id: '2', name: 'Doing', statusCategory: { key: 'indeterminate' } }] },
      { name: 'Bug', statuses: [{ id: '2', name: 'Doing', statusCategory: { key: 'indeterminate' } }, { id: '9', name: 'Shipped', statusCategory: { key: 'done' } }] },
    ])
    expect(readStatuses(text)).toEqual([
      { id: '1', name: 'To Do', isClosed: false, isActive: false },
      { id: '2', name: 'Doing', isClosed: false, isActive: true },
      { id: '9', name: 'Shipped', isClosed: true, isActive: false },
    ])
  })
  test('priorities as a list or a page; transitions; errors', async () => {
    expect(readPriorities('[{"id":"1","name":"High"}]')).toEqual([{ id: '1', name: 'High', isDefault: false }])
    expect(readPriorities('{"values":[{"id":"3","name":"Medium","isDefault":true}]}')).toEqual([{ id: '3', name: 'Medium', isDefault: true }])
    expect(readTransitions('{"transitions":[{"id":"31","to":{"id":"10002"}}]}')).toEqual([{ id: '31', to: '10002' }])
    expect(readError(400, '{"errorMessages":["Nope"],"errors":{"summary":"Too long"}}')).toBe('Nope; summary: Too long')
    expect(readError(500, '')).toBe('HTTP 500')
  })
})

describe('building requests', () => {
  test('an issue in Backlog.md terms', async () => {
    const issue = { key: 'APP-1', subject: 'S', description: 'D', statusId: '9', priorityId: '2', assigneeId: null }
    expect(toRemoteIssue('https://j.test', issue, { 1: 'To Do' }, { 2: 'High' }, 'To Do')).toEqual({
      key: 'APP-1',
      url: 'https://j.test/browse/APP-1',
      fields: { title: 'S', status: 'To Do', priority: 'high', description: 'D' },
    })
  })
  test('fields for a PUT: no status (that is a transition), a priority by its id', async () => {
    const priorities = [
      { id: '1', name: 'Highest', isDefault: false },
      { id: '2', name: 'High', isDefault: false },
    ]
    const map = { 1: 'High', 2: 'High' }
    expect(fieldsBody({ title: 'T', status: 'Done', priority: 'high' }, map, priorities)).toEqual({
      fields: { summary: 'T', priority: { id: '2' } },
      skipped: [],
    })
    expect(fieldsBody({ priority: 'high' }, map, priorities, '1').fields).toEqual({ priority: { id: '1' } })
    expect(fieldsBody({ priority: 'low' }, map, priorities).skipped).toEqual(['priority'])
  })
  test('the issue type for new tasks: the chosen one, else Task, else the first', async () => {
    const types = [
      { id: '1', name: 'Bug' },
      { id: '2', name: 'Task' },
    ]
    expect(issueTypeFor(types, '1')?.name).toBe('Bug')
    expect(issueTypeFor(types, '')?.name).toBe('Task')
    expect(issueTypeFor([{ id: '5', name: 'Story' }], undefined)?.name).toBe('Story')
  })
})
