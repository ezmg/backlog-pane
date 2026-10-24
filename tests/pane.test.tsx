import { expect, test } from 'claude-code/testing'

import { PANE, fail, open, openTask, world } from './fixtures'

for (const surface of ['vscode', 'mobile'] as const) {
  test(`${surface}: the list groups tasks by status and folds the final one`, async ($, on) => {
    const { clock } = world(on)
    expect((await open($, clock)).text).toContain('opened')
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Client' })).toBe(undefined)

    expect(await ui.find({ type: 'Text', text: /^To Do/ })).toBeDefined()
    expect(await ui.find({ key: 'task:BL-1' })).toBeDefined()
    expect((await ui.find({ key: 'task:BL-1' }))?.text).toContain('1/2')
    // Done starts folded: its count shows, its tasks do not.
    expect((await ui.find({ key: 'toggle-done' }))?.text).toContain('(1)')
    expect(await ui.find({ key: 'task:BL-3' })).toBe(undefined)
    await ui.press({ key: 'toggle-done' })
    expect(await ui.find({ key: 'task:BL-3' })).toBeDefined()
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
  test(`${surface}: a task shows its description, criteria and plan`, async ($, on) => {
    const { clock, runs } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')

    expect(runs).toContainEqual(['task', 'view', 'BL-1', '--json'])
    expect(await ui.find({ type: 'Markdown', text: 'Parse the **stream**.' })).toBeDefined()
    expect((await ui.find({ key: 'criterion-check-1' }))?.text).toBe('[x] 1. Handles chunks')
    expect((await ui.find({ key: 'criterion-check-2' }))?.text).toBe('[ ] 2. Has tests')
    expect(await ui.find({ type: 'Markdown', text: /2\. Split/ })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: 'Parse the **stream**.' })).toBe(undefined)
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: status changes and new tasks go through the CLI`, async ($, on) => {
    const { clock, runs } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })

    // The field shows only after "+ New task", and goes again once created.
    expect(await ui.find({ type: 'Input' })).toBe(undefined)
    await ui.press({ key: 'new-task-open' })
    expect((await ui.find({ key: 'new-task' }))?.props.autoFocus).toBe(true)
    await ui.input({ key: 'new-task', text: '  Ship it  ' })
    expect(runs).toContainEqual(['task', 'create', 'Ship it'])
    expect(await ui.find({ type: 'Text', text: 'Created BL-4.' })).toBeDefined()
    expect(await ui.find({ key: 'new-task' })).toBe(undefined)
    expect((await ui.find({ key: 'new-task-open' }))?.text).toBe('+ New task')

    await openTask(ui, 'BL-1')
    await ui.select({ key: 'status', value: 'Done' })
    expect(runs).toContainEqual(['task', 'edit', 'BL-1', '--status', 'Done'])
    expect(await ui.find({ type: 'Text', text: 'Moved BL-1 to Done.' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: "Work on this task" drafts the prompt without sending it`, async ($, on) => {
    const { clock, fills } = world(on)
    let submitted = 0
    on('prompt.submit', (_, e) => {
      submitted += 1
      return { text: e.text }
    })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    await ui.press({ key: 'work' })

    expect(fills).toEqual([
      {
        text: 'Work on BL-1 only. Research the codebase and write an implementation plan in the task. Wait for my approval before coding.',
        mode: 'replace',
      },
    ])
    expect(submitted).toBe(0)
    await ui.unmount()
  })
}

for (const surface of ['vscode', 'mobile'] as const) {
  test(`${surface}: statuses are coloured by theme key and high priority is marked "!"`, async ($, on) => {
    const { clock } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^To Do/ }))?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: /^In Progress/ }))?.props.color).toBe('warning')
    expect((await ui.find({ type: 'Text', text: 'Done' }))?.props.color).toBe('success')
    const row = await ui.find({ key: 'task:BL-2' })
    expect(row?.text).toContain('! BL-2 Add login')
    expect((await ui.find({ type: 'Text', text: '! ' }))?.props.color).toBe('error')
    expect((await ui.find({ key: 'task:BL-1' }))?.text).not.toContain('!')
    await ui.press({ key: 'task:BL-2' })
    expect((await ui.find({ type: 'Text', text: 'To Do' }))?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: '! high priority' }))?.props.color).toBe('error')
    await ui.unmount()
  })
}

for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
  test(`${surface}: ◀ and ▶ move a task to the previous or next status (h, l)`, async ($, on) => {
    const { clock, runs } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    const previous = await ui.find({ key: 'status-prev' })
    const next = await ui.find({ key: 'status-next' })
    expect(previous?.text).toBe('◀ To Do')
    expect(previous?.props.hotkey).toBe('h')
    expect(next?.text).toBe('Done ▶')
    expect(next?.props.hotkey).toBe('l')
    await ui.press({ key: 'status-next' })
    expect(runs).toContainEqual(['task', 'edit', 'BL-1', '--status', 'Done'])
    await ui.press({ key: 'status-prev' })
    expect(runs).toContainEqual(['task', 'edit', 'BL-1', '--status', 'To Do'])
    await ui.unmount()
  })

  test(`${surface}: the first and last statuses have one arrow`, async ($, on) => {
    const { clock } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-2')
    expect(await ui.find({ key: 'status-prev' })).toBe(undefined)
    expect((await ui.find({ key: 'status-next' }))?.text).toBe('In Progress ▶')
    await ui.press({ key: 'back' })
    await openTask(ui, 'BL-3')
    expect((await ui.find({ key: 'status-prev' }))?.text).toBe('◀ In Progress')
    expect(await ui.find({ key: 'status-next' })).toBe(undefined)
    await ui.unmount()
  })
}

test('Spanish: the pane, the command and the draft', { options: { language: 'es' } }, async ($, on) => {
  const { clock, fills } = world(on)
  expect((await open($, clock)).text).toBe('Panel de Backlog abierto.')
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Text', text: /^To Do/ })).toBeDefined()
  await ui.press({ key: 'task:BL-1' })
  expect(await ui.find({ type: 'Text', text: 'Descripción' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Criterios de aceptación' })).toBeDefined()
  await ui.press({ key: 'work' })
  expect(fills[0]?.text).toBe(
    'Trabaja solo en BL-1. Investiga el código y escribe un plan de implementación en la tarea. Espera mi aprobación antes de programar.',
  )
  expect(await ui.find({ type: 'Text', text: /El borrador para BL-1/ })).toBeDefined()
  await ui.unmount()
})

test('auto: Claude Code\'s language setting picks Spanish', async ($, on) => {
  const { clock } = world(on, { settings: { language: 'Español' }, env: { LANG: 'en_US.UTF-8' } })
  expect((await open($, clock)).text).toBe('Panel de Backlog abierto.')
})

test('auto: with no setting, LANG picks Spanish', async ($, on) => {
  const { clock } = world(on, { env: { LANG: 'es_ES.UTF-8' } })
  expect((await open($, clock)).text).toBe('Panel de Backlog abierto.')
})

test('auto: an English setting wins over a Spanish locale', async ($, on) => {
  const { clock } = world(on, { settings: { language: 'English' }, env: { LC_ALL: 'es_ES.UTF-8' } })
  expect((await open($, clock)).text).toBe('Backlog pane opened.')
})

test('with no surface, /backlog answers in Spanish too', { options: { language: 'es' } }, async ($, on) => {
  const { clock } = world(on, { surfaces: [] })
  const answer = await open($, clock)
  expect(answer.text).toContain('Backlog: 3 tareas')
  expect(answer.text).toContain('BL-2  Add login')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: Cancel hides the new task field without creating`, async ($, on) => {
    const { clock, runs } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'new-task-open' })
    expect(await ui.find({ key: 'new-task' })).toBeDefined()
    await ui.press({ key: 'new-task-cancel' })
    expect(await ui.find({ key: 'new-task' })).toBe(undefined)
    expect(runs.some(argv => argv[1] === 'create')).toBe(false)
    await ui.unmount()
  })

  test(`${surface}: a failed create keeps the field open`, async ($, on) => {
    const { clock } = world(on, { create: fail('Error: title too long') })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'new-task-open' })
    await ui.input({ key: 'new-task', text: 'x' })
    expect(await ui.find({ type: 'Text', text: 'Error: title too long' })).toBeDefined()
    expect(await ui.find({ key: 'new-task' })).toBeDefined()
    await ui.unmount()
  })
}

test('Spanish: "+ Nueva tarea"', { options: { language: 'es' } }, async ($, on) => {
  const { clock } = world(on)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'new-task-open' }))?.text).toBe('+ Nueva tarea')
  await ui.press({ key: 'new-task-open' })
  expect((await ui.find({ key: 'new-task' }))?.props.placeholder).toBe('Título de la nueva tarea')
  expect((await ui.find({ key: 'new-task-cancel' }))?.text).toBe('Cancelar')
  await ui.input({ key: 'new-task', text: 'Enviar' })
  expect(await ui.find({ type: 'Text', text: 'Creada BL-4.' })).toBeDefined()
  await ui.unmount()
})

test('a missing CLI says how to install it', async ($, on) => {
  const { clock } = world(on, { installed: false })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Backlog.md CLI not found' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /npm i -g backlog\.md/ })).toBeDefined()
  expect(await ui.find({ key: 'retry' })).toBeDefined()
  await ui.unmount()
})

test('an uninitialized folder suggests backlog init', async ($, on) => {
  const { clock } = world(on, {
    watch: { stderr: 'No Backlog.md project found. Run `backlog init` to initialize.\n', code: 1 },
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'No Backlog.md project in this folder' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /backlog init/ })).toBeDefined()
  await ui.unmount()
})

test('a failing watch is restarted a few times, then offers Retry', async ($, on) => {
  const { clock, spawnCount } = world(on, { watch: { stderr: 'disk on fire\n', code: 1 } })
  await open($, clock)
  for (let i = 0; i < 6; i++) await clock.advance(60_000)
  expect(spawnCount()).toBe(5)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'disk on fire' })).toBeDefined()
  await ui.press({ key: 'retry' })
  expect(spawnCount()).toBe(6)
  await ui.unmount()
})

test('mobile: status buttons instead of a picker, no creation button', async ($, on) => {
  const { clock, runs } = world(on)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ type: 'Input' })).toBe(undefined)
  expect(await ui.find({ key: 'new-task-open' })).toBe(undefined)
  await ui.press({ key: 'task:BL-2' })
  await ui.press({ key: 'status-1' })
  expect(runs).toContainEqual(['task', 'edit', 'BL-2', '--status', 'In Progress'])
  await ui.unmount()
})

test('with no surface, /backlog answers with the board as text', async ($, on) => {
  const { clock } = world(on, { surfaces: [] })
  const answer = await open($, clock)
  expect(answer.text).toContain('Backlog: 3 tasks')
  expect(answer.text).toContain('In Progress (1)')
  expect(answer.text).toContain('BL-2  Add login')
})

test('with no surface and no project, /backlog says so', async ($, on) => {
  const { clock } = world(on, {
    surfaces: [],
    list: fail('No Backlog.md project found. Run `backlog init` to initialize.'),
  })
  expect((await open($, clock)).text).toContain('backlog init')
})
