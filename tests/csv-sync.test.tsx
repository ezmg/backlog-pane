import { expect, test } from 'claude-code/testing'

import { CWD, PANE, open, openTask, world } from './fixtures'
import type { FakeTask } from './fixtures'

// The CSV tracker, end to end: a Redmine export on disk, read when the
// person presses Sync now, into a Backlog.md board whose create and edit
// commands really change it. Nothing is ever written to the file.

const SYNC_KEY = `sync:${CWD}/backlog/config.yml`
// Absolute, as $.fs takes it (the test kit is on Linux; on Windows C:\\… is absolute too).
const FILE = '/home/me/Downloads/issues.csv'

/** A Spanish Redmine's export: semicolons, quoted line breaks, a closing date. */
const EXPORT = [
  '#;Proyecto;Tipo;Estado;Prioridad;Asunto;Asignado a;Cerrada;Descripción',
  '12;Demo;Tarea;Nueva;Normal;Página de acceso;Ana;;"Email y\ncontraseña."',
  '13;Demo;Error;En curso;Alta;Exportar a CSV;Ana;;',
  '14;Demo;Error;Cerrada;Urgente;Fallo al arrancar;Luis;20/10/2026 09:00;Arreglado.',
]
const csv = (lines: string[]) => `${lines.join('\r\n')}\r\n`

/** A project already set up to read FILE. */
const settings = (over: Record<string, unknown> = {}) => ({
  [SYNC_KEY]: {
    settings: {
      provider: 'csv',
      url: '',
      project: '',
      file: FILE,
      mode: 'read',
      onlyMine: false,
      view: 'all',
      intervalMin: 0,
      statusMap: {},
      priorityMap: {},
      excluded: [],
      ...over,
    },
    data: {},
  },
})

test('set up in the pane: pick the CSV tracker and its file, then sync', async ($, on) => {
  const { clock, tasks, files, requests, store } = world(on, { isStateful: true, tasks: [] })
  files.set(FILE, csv(EXPORT))
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  await ui.select({ key: 'sync-tracker', value: 'csv' })
  // No mode, issues or interval to pick: read only, with the button.
  expect(await ui.find({ key: 'sync-mode' })).toBe(undefined)
  expect(await ui.find({ key: 'sync-interval' })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /In Redmine: Issues → CSV/ })).toBeDefined()
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: 'Type the path of the CSV file Redmine exported.' })).toBeDefined()
  await ui.input({ key: 'sync-file', text: ` ${FILE} ` })
  expect(await ui.find({ type: 'Text', text: /^read only · Only with the button/ })).toBeDefined()
  // The file by its name at the top; its whole path in its field.
  expect(await ui.find({ type: 'Text', text: ' · issues.csv' })).toBeDefined()
  expect((await ui.find({ key: 'sync-file' }))?.props.value).toBe(FILE)
  await ui.press({ key: 'sync-now' })

  expect(tasks.map(task => [task.title, task.status, task.priority, task.references])).toEqual([
    ['Página de acceso', 'To Do', 'medium', ['#12']],
    ['Exportar a CSV', 'In Progress', 'high', ['#13']],
    ['Fallo al arrancar', 'Done', 'high', ['#14']],
  ])
  expect(tasks[0]?.description).toBe('Email y\ncontraseña.')
  expect(await ui.find({ type: 'Text', text: 'CSV: 3 issues read, 3 tasks created or updated, 0 conflicts.' })).toBeDefined()
  // The mappings go by name, as the file names them.
  expect((await ui.find({ key: 'sync-status-En curso' }))?.props.value).toBe('In Progress')
  expect((await ui.find({ key: 'sync-priority-Urgente' }))?.props.value).toBe('high')
  expect(requests).toHaveLength(0)
  expect(files.get(FILE)).toBe(csv(EXPORT))
  const kept = store.get(SYNC_KEY) as { settings: { provider: string; file: string } }
  expect(kept.settings).toMatchObject({ provider: 'csv', file: FILE })
  // The same file again changes nothing.
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: 'CSV: 3 issues read, 0 tasks created or updated, 0 conflicts.' })).toBeDefined()
  await ui.unmount()
})

test('a new export: its changes come in, a local change stays, a clash is asked', async ($, on) => {
  const { clock, tasks, files } = world(on, { isStateful: true, tasks: [], store: settings() })
  files.set(FILE, csv(EXPORT))
  await open($, clock)
  // Only with the button: opening the pane reads nothing.
  expect(tasks).toHaveLength(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^CSV · read only/ })).toBeDefined()
  await ui.press({ key: 'sync-now-board' })
  expect(tasks).toHaveLength(3)

  ;(tasks[0] as FakeTask).title = 'Acceso (aquí)'
  ;(tasks[1] as FakeTask).title = 'CSV (aquí)'
  files.set(
    FILE,
    csv([
      EXPORT[0] as string,
      EXPORT[1] as string,
      '13;Demo;Error;Cerrada;Alta;Exportar a CSV y Excel;Ana;24/10/2026 12:00;',
      EXPORT[3] as string,
      '15;Demo;Tarea;Nueva;Baja;Modo oscuro;Ana;;',
    ]),
  )
  await ui.press({ key: 'sync-now-board' })
  // #12 changed only here: kept. #13's title changed on both sides: asked.
  // Its status changed only in the file: taken. #15 is new.
  expect(tasks.map(task => [task.title, task.status])).toEqual([
    ['Acceso (aquí)', 'To Do'],
    ['CSV (aquí)', 'Done'],
    ['Fallo al arrancar', 'Done'],
    ['Modo oscuro', 'To Do'],
  ])
  expect(await ui.find({ type: 'Text', text: /1 conflict$/ })).toBeDefined()

  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ type: 'Text', text: 'BL-2: the title changed on both sides.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'The file: Exportar a CSV y Excel' })).toBeDefined()
  expect((await ui.find({ key: 'conflict-remote-0' }))?.props.label).toBe('Use the file’s')
  await ui.press({ key: 'conflict-local-0' })
  expect(tasks[1]?.title).toBe('CSV (aquí)')
  // Kept: the same file again does not bring the file's title back.
  await ui.press({ key: 'sync-now' })
  expect(tasks[1]?.title).toBe('CSV (aquí)')
  expect(await ui.find({ key: 'conflict-remote-0' })).toBe(undefined)
  await ui.unmount()
})

test('picking the file’s side of a clash takes its value', async ($, on) => {
  const { clock, tasks, files } = world(on, { isStateful: true, tasks: [], store: settings() })
  files.set(FILE, csv(EXPORT))
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-now-board' })
  ;(tasks[0] as FakeTask).title = 'Acceso (aquí)'
  files.set(FILE, csv([EXPORT[0] as string, '12;Demo;Tarea;Nueva;Normal;Acceso (archivo);Ana;;"Email y\ncontraseña."']))
  await ui.press({ key: 'sync-open' })
  await ui.press({ key: 'sync-now' })
  await ui.press({ key: 'conflict-remote-0' })
  expect(tasks[0]?.title).toBe('Acceso (archivo)')
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: 'CSV: 1 issue read, 0 tasks created or updated, 0 conflicts.' })).toBeDefined()
  await ui.unmount()
})

test('Windows-1252, a Redmine URL for the links, and a file with fewer columns', async ($, on) => {
  const { clock, tasks, files } = world(on, {
    isStateful: true,
    tasks: [{ id: 'BL-1', title: 'Old', status: 'To Do', description: 'Mine.', references: ['https://redmine.test/issues/7'] }],
    store: settings({ url: 'https://redmine.test' }),
  })
  const text = '#,Subject\r\n7,Petici\u00f3n con tilde\r\n8,Otra\r\n'
  files.setBytes(FILE, Uint8Array.from([...text].map(char => char.charCodeAt(0))))
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  await ui.press({ key: 'sync-now' })
  // BL-1 already named #7: adopted, its title taken from the file; nothing else touched.
  expect(tasks.map(task => [task.id, task.title, task.status, task.description, task.references])).toEqual([
    ['BL-1', 'Petición con tilde', 'To Do', 'Mine.', ['https://redmine.test/issues/7']],
    ['BL-2', 'Otra', 'To Do', undefined, ['https://redmine.test/issues/8']],
  ])
  expect(
    await ui.find({ type: 'Text', text: 'The file has no column for: status, priority, description. Those are left alone.' }),
  ).toBeDefined()
  await ui.unmount()
})

test('a file that is missing, or is not an issue export, says so and changes nothing', async ($, on) => {
  const { clock, tasks, files } = world(on, { isStateful: true, tasks: [], store: settings() })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  await ui.press({ key: 'sync-now' })
  expect(await ui.find({ type: 'Text', text: new RegExp(`^Could not read ${FILE}: `) })).toBeDefined()
  files.set(FILE, 'Name;Age\nAna;30\n')
  await ui.press({ key: 'sync-now' })
  expect(
    await ui.find({ type: 'Text', text: 'This is not an issue export from Redmine: it has no “#” and “Subject” columns (it has: Name, Age).' }),
  ).toBeDefined()
  expect(tasks).toHaveLength(0)
  await ui.unmount()
})

test('Spanish: the CSV setup', { options: { language: 'es' } }, async ($, on) => {
  const { clock, files } = world(on, { isStateful: true, tasks: [], store: settings() })
  files.set(FILE, csv(EXPORT))
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect((await ui.find({ key: 'sync-file' }))?.props.label).toBe('Archivo CSV')
  await ui.press({ key: 'sync-now' })
  expect(
    await ui.find({ type: 'Text', text: 'CSV: 3 peticiones leídas, 3 tareas creadas o actualizadas, 0 conflictos.' }),
  ).toBeDefined()
  await ui.unmount()
})

test('types and parents: an epic, its story and the story’s tasks, created parents first', async ($, on) => {
  // Newest first, as Redmine lists them: the tasks come before their story.
  const lines = [
    '#;Tipo;Tarea padre;Estado;Prioridad;Asunto;Descripción',
    '31;Tarea;20;Nueva;Normal;[iOS] Status;"Steps:\n# Open\n# *Close*"',
    '30;Tarea;20;En curso;Normal;[Android] Status;',
    '20;Historia de usuario;10;Nueva;Normal;Status;',
    '10;Épica;;Nueva;Alta;Release 3;',
    '40;Tarea;999;Nueva;Normal;Orphan;',
  ]
  const { clock, tasks, files, store } = world(on, { isStateful: true, tasks: [], store: settings() })
  files.set(FILE, csv(lines))
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect((await ui.find({ key: 'sync-structure' }))?.props.value).toBe('on')
  await ui.press({ key: 'sync-now' })

  const by = (title: string) => tasks.find(task => task.title === title) as FakeTask
  expect(by('Release 3')).toMatchObject({ labels: ['Épica'] })
  expect(by('Status')).toMatchObject({ labels: ['Historia de usuario'], parentTaskId: by('Release 3').id })
  expect(by('[iOS] Status')).toMatchObject({ labels: ['Tarea'], parentTaskId: by('Status').id })
  expect(by('[Android] Status').parentTaskId).toBe(by('Status').id)
  // A parent that is not in the file: a task of its own.
  expect(by('Orphan').parentTaskId).toBe(undefined)
  // Textile became Markdown.
  expect(by('[iOS] Status').description).toBe('Steps:\n1. Open\n1. **Close**')

  // The type changes in Redmine: the label follows, other labels stay.
  ;(by('Orphan').labels as string[]).push('mine')
  files.set(FILE, csv([lines[0] as string, '40;Error;999;Nueva;Normal;Orphan;']))
  await ui.press({ key: 'sync-now' })
  expect(by('Orphan').labels).toEqual(['mine', 'Error'])

  // Switched off: nothing more is labelled.
  await ui.select({ key: 'sync-structure', value: 'off' })
  expect((store.get(SYNC_KEY) as { settings: { structure: boolean } }).settings.structure).toBe(false)
  files.set(FILE, csv([lines[0] as string, '40;Tarea;999;Nueva;Normal;Orphan;', '50;Tarea;;Nueva;Normal;Plain;']))
  await ui.press({ key: 'sync-now' })
  expect(by('Orphan').labels).toEqual(['mine', 'Error'])
  expect(by('Plain').labels).toEqual([])
  await ui.unmount()
})

test('a Redmine that keeps Markdown: descriptions are not converted', async ($, on) => {
  const { clock, tasks, files } = world(on, { isStateful: true, tasks: [], store: settings({ textFormat: 'markdown' }) })
  files.set(FILE, csv(['#;Asunto;Descripción', '1;A;"# Title\n*it*"']))
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect((await ui.find({ key: 'sync-format' }))?.props.value).toBe('markdown')
  await ui.press({ key: 'sync-now' })
  expect(tasks[0]?.description).toBe('# Title\n*it*')
  await ui.unmount()
})

test('the task says where it comes from; the integration’s help folds', async ($, on) => {
  const lines = ['#;Tipo;Tarea padre;Estado;Asunto', '20;Historia de usuario;;Nueva;Status', '31;Tarea;20;Nueva;[iOS] Status']
  const { clock, tasks, files } = world(on, { isStateful: true, tasks: [], store: settings() })
  files.set(FILE, csv(lines))
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sync-open' })
  expect(await ui.find({ type: 'Text', text: /^The file’s issues are copied/ })).toBe(undefined)
  await ui.press({ key: 'sync-help' })
  expect(await ui.find({ type: 'Text', text: /^The file’s issues are copied/ })).toBeDefined()
  await ui.press({ key: 'sync-now' })
  await ui.press({ key: 'sync-back' })
  await clock.advance(2_000)
  const child = tasks.find(task => task.title === '[iOS] Status') as FakeTask
  const parent = tasks.find(task => task.title === 'Status') as FakeTask
  await openTask(ui, child.id)
  expect(await ui.find({ type: 'Text', text: `Redmine #31 · Tarea · inside ${parent.id} “Status”` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Read only: what you change here is not sent to Redmine.' })).toBeDefined()
  expect(await ui.find({ key: 'status-next' })).toBeDefined()
  await ui.unmount()
})
