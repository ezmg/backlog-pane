import { describe, expect, test } from 'claude-code/testing'

import {
  JsonDocumentReader,
  args,
  candidates,
  classify,
  createdId,
  editorFile,
  errorLine,
  groupTasks,
  isAtLeast,
  isHighPriority,
  parseList,
  parsePriorities,
  parseStatuses,
  pickEditor,
  readTaskList,
  readTaskView,
  rewriteCriteria,
  splitCommand,
  statusColors,
  summarize,
} from '../hooks/cli'
import { strings } from '../hooks/i18n'
import type { TaskSummary } from '../types'

const task = (id: string, status: string, updatedAt: string | null = null): TaskSummary => ({
  id,
  title: `Title of ${id}`,
  status,
  priority: null,
  labels: [],
  acceptanceCriteriaCompleted: 0,
  acceptanceCriteriaCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt,
})

describe('JsonDocumentReader', () => {
  test('splits pretty-printed documents written back to back', async () => {
    const one = JSON.stringify({ kind: 'task-list', tasks: [{ id: 'A-1' }] }, null, 2)
    const two = JSON.stringify({ kind: 'task-list', tasks: [] }, null, 2)
    const reader = new JsonDocumentReader()
    expect(reader.push(`${one}\n${two}\n`)).toHaveLength(2)
  })

  test('joins a document cut across chunks at any point', async () => {
    const doc = JSON.stringify({ kind: 'task-list', tasks: [{ id: 'A-1', title: 'x' }] }, null, 2)
    for (let cut = 1; cut < doc.length; cut += 7) {
      const reader = new JsonDocumentReader()
      expect(reader.push(doc.slice(0, cut))).toHaveLength(0)
      expect(reader.push(doc.slice(cut))).toEqual([JSON.parse(doc)])
    }
  })

  test('ignores braces and escaped quotes inside strings', async () => {
    const doc = JSON.stringify({ kind: 'task-list', tasks: [{ id: 'A-1', title: 'a } b { "c" \\' }] })
    const reader = new JsonDocumentReader()
    expect(reader.push(doc.slice(0, 30))).toHaveLength(0)
    const [parsed] = reader.push(doc.slice(30))
    expect(readTaskList(parsed)?.[0]?.title).toBe('a } b { "c" \\')
  })
})

describe('parsing', () => {
  test('reads a task list and a task view', async () => {
    expect(readTaskList({ kind: 'task-list', tasks: [{ id: 'BL-7', title: 't', status: 'To Do' }] })).toMatchObject([
      { id: 'BL-7', status: 'To Do', labels: [] },
    ])
    expect(readTaskList({ kind: 'task-view', task: {} })).toBe(undefined)
    const view = readTaskView({
      kind: 'task-view',
      task: {
        id: 'BL-7',
        title: 't',
        status: 'Done',
        description: 'd',
        implementationPlan: null,
        acceptanceCriteria: [{ index: 1, text: 'works', checked: true }],
      },
    })
    expect(view).toMatchObject({ id: 'BL-7', description: 'd', implementationPlan: null })
    expect(view?.acceptanceCriteria).toEqual([{ index: 1, text: 'works', checked: true }])
  })

  test('reads statuses, created ids and errors', async () => {
    expect(parseStatuses('To Do, In Progress, Done\n')).toEqual(['To Do', 'In Progress', 'Done'])
    expect(parseStatuses('')).toEqual(['To Do', 'In Progress', 'Done'])
    expect(parsePriorities('high, medium, low\n')).toEqual(['high', 'medium', 'low'])
    expect(parsePriorities('')).toEqual(['high', 'medium', 'low'])
    expect(parsePriorities('undefined\n')).toEqual(['high', 'medium', 'low'])
    expect(parseList('[ "P1", \'P2\' ]', [])).toEqual(['P1', 'P2'])
    expect(createdId('Created task BL-12\nFile: x.md')).toBe('BL-12')
    expect(classify('No Backlog.md project found. Run `backlog init` to initialize.')).toBe('not-initialized')
    expect(classify('boom')).toBe('failed')
    expect(errorLine('Warning: remoteOperations\nreal problem\n', 'x')).toBe('real problem')
  })
})

describe('commands', () => {
  test('every write is a backlog command, passed as separate arguments', async () => {
    expect(args.setStatus('BL-7', 'In Progress')).toEqual(['task', 'edit', 'BL-7', '--status', 'In Progress'])
    expect(args.create('Fix "login" & co')).toEqual(['task', 'create', 'Fix "login" & co'])
    expect(args.watch()).toEqual(['task', 'list', '--json', '--watch'])
  })

  test('the editing commands, as verified against backlog.md 1.55.3', async () => {
    expect(args.setTitle('BL-7', 'New "name"')).toEqual(['task', 'edit', 'BL-7', '-t', 'New "name"'])
    expect(args.setPriority('BL-7', 'high')).toEqual(['task', 'edit', 'BL-7', '--priority', 'high'])
    expect(args.checkCriterion('BL-7', 2)).toEqual(['task', 'edit', 'BL-7', '--check-ac', '2'])
    expect(args.uncheckCriterion('BL-7', 2)).toEqual(['task', 'edit', 'BL-7', '--uncheck-ac', '2'])
    expect(args.addCriterion('BL-7', 'a, b\nc')).toEqual(['task', 'edit', 'BL-7', '--ac', 'a, b\nc'])
    expect(args.removeCriterion('BL-7', 3)).toEqual(['task', 'edit', 'BL-7', '--remove-ac', '3'])
    expect(args.setCriteria('BL-7', ['one', 'two'])).toEqual([
      'task', 'edit', 'BL-7', '--acceptance-criteria', 'one', '--acceptance-criteria', 'two',
    ])
    expect(args.priorities()).toEqual(['config', 'get', 'priorities'])
  })

  test('rewriting one criterion keeps the others in order', async () => {
    const criteria = [
      { index: 1, text: 'one', checked: true },
      { index: 2, text: 'two', checked: false },
    ]
    expect(rewriteCriteria(criteria, 2, ' deux ')).toEqual(['one', 'deux'])
    expect(rewriteCriteria(criteria, 1, 'uno\nmás')).toEqual(['uno\nmás', 'two'])
    expect(rewriteCriteria(criteria, 2, 'two')).toBe(undefined)
    expect(rewriteCriteria(criteria, 2, '  ')).toBe(undefined)
    expect(rewriteCriteria(criteria, 9, 'x')).toBe(undefined)
  })

  test('candidates: the configured path alone, else PATH then the Windows globals', async () => {
    expect(candidates({ configured: ' /opt/backlog ' })).toEqual(['/opt/backlog'])
    expect(candidates({ os: 'Darwin' })).toEqual(['backlog'])
    const windows = candidates({ os: 'Windows_NT', appData: 'C:\\A', userProfile: 'C:\\U' })
    expect(windows[0]).toBe('backlog')
    expect(windows).toContain('C:\\A\\npm\\node_modules\\backlog.md\\node_modules\\backlog.md-windows-x64\\backlog.exe')
    expect(windows).toContain('C:\\U\\.bun\\bin\\backlog.exe')
  })
})

describe('grouping', () => {
  test('follows the configured order, then statuses the config lacks', async () => {
    const groups = groupTasks([task('A-1', 'Review'), task('A-2', 'To Do')], ['To Do', 'Done'], 5)
    expect(groups.map(group => group.status)).toEqual(['To Do', 'Done', 'Review'])
    expect(groups[1]?.isFinal).toBe(true)
  })

  test('keeps only the most recent tasks of the final status', async () => {
    const done = [
      task('A-1', 'Done', '2026-01-01T00:00:00Z'),
      task('A-2', 'Done', '2026-03-01T00:00:00Z'),
      task('A-3', 'Done', '2026-02-01T00:00:00Z'),
    ]
    const [, final] = groupTasks(done, ['To Do', 'Done'], 2)
    expect(final?.tasks.map(one => one.id)).toEqual(['A-2', 'A-3'])
    expect(final?.total).toBe(3)
  })

  test('summarizes the board as text', async () => {
    const text = summarize([task('A-1', 'To Do'), task('A-2', 'Done')], ['To Do', 'Done'], strings('en'))
    expect(text).toContain('Backlog: 2 tasks')
    expect(text).toContain('To Do (1)')
    expect(text).toContain('A-2  Title of A-2')
    expect(summarize([task('A-1', 'To Do')], ['To Do'], strings('es'))).toContain('Backlog: 1 tarea')
    expect(summarize([], ['To Do'], strings('es'))).toContain('todavía no hay tareas')
  })
})

describe('colours', () => {
  test('theme keys by place: first, in progress, final, the rest in turn', async () => {
    const colors = statusColors(['Backlog', 'Ready', 'In Progress', 'Review', 'QA', 'Blocked', 'Later', 'Done', 'Odd'], 'Done')
    expect(Object.fromEntries(colors)).toEqual({
      Backlog: 'suggestion',
      Ready: 'permission',
      'In Progress': 'warning',
      Review: 'planMode',
      QA: 'ide',
      Blocked: 'merged',
      Later: 'permission',
      Done: 'success',
      Odd: 'planMode',
    })
    expect(Object.fromEntries(statusColors(['To Do', 'In Progress', 'Done'], 'Done'))).toEqual({
      'To Do': 'suggestion',
      'In Progress': 'warning',
      Done: 'success',
    })
    expect(statusColors(['Por hacer', 'En curso', 'Hecho'], 'Hecho').get('En curso')).toBe('warning')
  })

  test('groups carry their colour', async () => {
    const groups = groupTasks([task('A-1', 'Review')], ['To Do', 'In Progress', 'Done'], 5)
    expect(groups.map(group => group.color)).toEqual(['suggestion', 'warning', 'success', 'permission'])
  })

  test('high priority, whatever the case', async () => {
    expect(isHighPriority('high')).toBe(true)
    expect(isHighPriority(' High ')).toBe(true)
    expect(isHighPriority('medium')).toBe(false)
    expect(isHighPriority(null)).toBe(false)
  })
})

describe('long text', () => {
  test('versions compare by release', async () => {
    expect(isAtLeast('2.1.301', '2.1.301')).toBe(true)
    expect(isAtLeast('2.1.310', '2.1.301')).toBe(true)
    expect(isAtLeast('2.2.0', '2.1.301')).toBe(true)
    expect(isAtLeast('2.1.296', '2.1.301')).toBe(false)
    expect(isAtLeast('2.1.301-dev.20260920.t101500.sha1a2b3c4', '2.1.301')).toBe(true)
    expect(isAtLeast('dev', '2.1.301')).toBe(false)
    expect(isAtLeast(undefined, '2.1.301')).toBe(false)
  })

  test('editor commands split like shell words', async () => {
    expect(splitCommand('code --wait')).toEqual(['code', '--wait'])
    expect(splitCommand('  "C:\\Program Files\\Code\\Code.exe"  --wait ')).toEqual([
      'C:\\Program Files\\Code\\Code.exe',
      '--wait',
    ])
    expect(splitCommand("emacsclient -a '' -c")).toEqual(['emacsclient', '-a', '', '-c'])
    expect(splitCommand('')).toEqual([])
  })

  test('the editor: defaultEditor, VISUAL, EDITOR, then Notepad on Windows', async () => {
    expect(pickEditor({ configured: 'code --wait\n', visual: 'vim', editor: 'nano' })).toEqual(['code', '--wait'])
    expect(pickEditor({ configured: 'undefined', visual: 'vim', editor: 'nano' })).toEqual(['vim'])
    expect(pickEditor({ configured: '', editor: 'nano' })).toEqual(['nano'])
    expect(pickEditor({ os: 'Windows_NT' })).toEqual(['notepad'])
    expect(pickEditor({ os: 'Darwin' })).toBe(undefined)
  })

  test('the temp file, by platform', async () => {
    expect(editorFile({ tmpdir: '/var/folders/x/T/' }, 'BL-7', 'plan')).toBe('/var/folders/x/T/backlog-pane-BL-7-plan.md')
    expect(editorFile({}, 'proj/7', 'description')).toBe('/tmp/backlog-pane-proj_7-description.md')
    expect(editorFile({ os: 'Windows_NT', temp: 'C:\\T' }, 'BL-7', 'plan')).toBe('C:\\T\\backlog-pane-BL-7-plan.md')
    expect(editorFile({ os: 'Windows_NT', userProfile: 'C:\\Users\\me' }, 'BL-7', 'plan')).toBe(
      'C:\\Users\\me\\AppData\\Local\\Temp\\backlog-pane-BL-7-plan.md',
    )
  })
})
