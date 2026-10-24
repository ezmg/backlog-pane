import { expect, test } from 'claude-code/testing'

import { PANE, fail, ok, open, openTask, world } from './fixtures'

// Editing in the task view: every change is a `backlog task edit` command.

for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
  test(`${surface}: the title field renames the task with -t`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    expect((await ui.find({ key: 'title' }))?.props.value).toBe('Write parser')
    // Unchanged or empty: nothing runs.
    await ui.input({ key: 'title', text: 'Write parser' })
    await ui.input({ key: 'title', text: '   ' })
    expect(edits()).toEqual([])
    await ui.input({ key: 'title', text: ' Write the "parser" & co ' })
    expect(edits()).toEqual([['task', 'edit', 'BL-1', '-t', 'Write the "parser" & co']])
    expect(await ui.find({ type: 'Text', text: 'Updated BL-1.' })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: the priority picker lists the configured priorities`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    const picker = await ui.find({ key: 'priority' })
    expect(picker?.props.value).toBe('medium')
    expect(picker?.props.options).toEqual([
      { value: 'high', label: 'High' },
      { value: 'medium', label: 'Medium' },
      { value: 'low', label: 'Low' },
    ])
    await ui.select({ key: 'priority', value: 'medium' })
    expect(edits()).toEqual([])
    await ui.select({ key: 'priority', value: 'high' })
    expect(edits()).toEqual([['task', 'edit', 'BL-1', '--priority', 'high']])
    await ui.unmount()
  })

  test(`${surface}: a task with no priority offers "None" until one is set`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-3')
    const picker = await ui.find({ key: 'priority' })
    expect(picker?.props.value).toBe('')
    expect((picker?.props.options as { label: string }[]).map(option => option.label)).toEqual([
      'None',
      'High',
      'Medium',
      'Low',
    ])
    await ui.select({ key: 'priority', value: '' })
    expect(edits()).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: criteria are ticked, added, edited and deleted through the CLI`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')

    await ui.press({ key: 'criterion-check-1' })
    await ui.press({ key: 'criterion-check-2' })
    expect(edits()).toEqual([
      ['task', 'edit', 'BL-1', '--uncheck-ac', '1'],
      ['task', 'edit', 'BL-1', '--check-ac', '2'],
    ])

    await ui.input({ key: 'criterion-new', text: '  Handles\nnewlines  ' })
    await ui.input({ key: 'criterion-new', text: '  ' })
    expect(edits()[2]).toEqual(['task', 'edit', 'BL-1', '--ac', 'Handles\nnewlines'])
    expect(edits()).toHaveLength(3)

    // Delete asks first; Keep backs out.
    await ui.press({ key: 'criterion-remove-2' })
    expect(await ui.find({ type: 'Text', text: 'Delete criterion 2?' })).toBeDefined()
    await ui.press({ key: 'criterion-remove-no' })
    expect(await ui.find({ type: 'Text', text: 'Delete criterion 2?' })).toBe(undefined)
    expect(edits()).toHaveLength(3)
    await ui.press({ key: 'criterion-remove-2' })
    await ui.press({ key: 'criterion-remove-yes-2' })
    expect(edits()[3]).toEqual(['task', 'edit', 'BL-1', '--remove-ac', '2'])
    await ui.unmount()
  })

  test(`${surface}: editing an unticked criterion rewrites the list in order`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    await ui.press({ key: 'criterion-edit-2' })
    const field = await ui.find({ key: 'criterion-text-2' })
    expect(field?.props.value).toBe('Has tests')
    expect(field?.props.autoFocus).toBe(true)
    await ui.input({ key: 'criterion-text-2', text: 'Has unit tests' })
    expect(edits()).toEqual([
      ['task', 'edit', 'BL-1', '--acceptance-criteria', 'Handles chunks', '--acceptance-criteria', 'Has unit tests'],
    ])
    expect(await ui.find({ key: 'criterion-text-2' })).toBe(undefined)
    await ui.unmount()
  })

  test(`${surface}: editing a ticked criterion ticks it again`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    await ui.press({ key: 'criterion-edit-1' })
    await ui.input({ key: 'criterion-text-1', text: 'Handles any chunk' })
    expect(edits()).toEqual([
      ['task', 'edit', 'BL-1', '--acceptance-criteria', 'Handles any chunk', '--acceptance-criteria', 'Has tests'],
      ['task', 'edit', 'BL-1', '--check-ac', '1'],
    ])
    await ui.unmount()
  })

  test(`${surface}: an unchanged edit, or Cancel, runs nothing`, async ($, on) => {
    const { clock, edits } = world(on)
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    await ui.press({ key: 'criterion-edit-1' })
    await ui.input({ key: 'criterion-text-1', text: ' Handles chunks ' })
    expect(await ui.find({ key: 'criterion-text-1' })).toBe(undefined)
    await ui.press({ key: 'criterion-edit-1' })
    await ui.press({ key: 'criterion-cancel' })
    expect(await ui.find({ key: 'criterion-text-1' })).toBe(undefined)
    expect(edits()).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: a failed edit says why and keeps the field`, async ($, on) => {
    const { clock } = world(on, { edit: fail('Error: no such criterion') })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    await ui.press({ key: 'criterion-edit-2' })
    await ui.input({ key: 'criterion-text-2', text: 'x' })
    expect(await ui.find({ type: 'Text', text: 'Error: no such criterion' })).toBeDefined()
    expect(await ui.find({ key: 'criterion-text-2' })).toBeDefined()
    await ui.unmount()
  })
}

test('custom priorities from the config are listed as they are spelled', async ($, on) => {
  const { clock, edits } = world(on, { config: { priorities: ok('[ "P1", "P2" ]\n') } })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openTask(ui, 'BL-1')
  expect((await ui.find({ key: 'priority' }))?.props.options).toEqual([
    { value: 'medium', label: 'Medium' },
    { value: 'P1', label: 'P1' },
    { value: 'P2', label: 'P2' },
  ])
  await ui.select({ key: 'priority', value: 'P1' })
  expect(edits()).toEqual([['task', 'edit', 'BL-1', '--priority', 'P1']])
  await ui.unmount()
})

test('when the config has no priorities, High, Medium and Low', async ($, on) => {
  const { clock } = world(on, { config: { priorities: fail('Unknown key: priorities') } })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  expect((await ui.find({ key: 'priority' }))?.props.options).toHaveLength(3)
  await ui.unmount()
})

test('mobile: criteria tick and delete, priority by buttons; no fields', async ($, on) => {
  const { clock, edits } = world(on)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await openTask(ui, 'BL-1')
  expect(await ui.find({ key: 'criterion-new' })).toBe(undefined)
  expect(await ui.find({ key: 'criterion-edit-1' })).toBe(undefined)
  await ui.press({ key: 'criterion-check-2' })
  await ui.press({ key: 'criterion-remove-1' })
  await ui.press({ key: 'criterion-remove-yes-1' })
  await ui.press({ key: 'priority-2' })
  expect(edits()).toEqual([
    ['task', 'edit', 'BL-1', '--check-ac', '2'],
    ['task', 'edit', 'BL-1', '--remove-ac', '1'],
    ['task', 'edit', 'BL-1', '--priority', 'low'],
  ])
  await ui.unmount()
})

test('Spanish: editing labels', { options: { language: 'es' } }, async ($, on) => {
  const { clock } = world(on)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-2')
  expect((await ui.find({ key: 'title' }))?.props.label).toBe('Título')
  const picker = await ui.find({ key: 'priority' })
  expect(picker?.props.label).toBe('Prioridad')
  expect((picker?.props.options as { label: string }[]).map(option => option.label)).toEqual(['Alta', 'Media', 'Baja'])
  expect(await ui.find({ type: 'Text', text: '! prioridad alta' })).toBeDefined()
  expect((await ui.find({ key: 'criterion-new' }))?.props.placeholder).toBe('Nuevo criterio')
  await ui.press({ key: 'criterion-remove-1' })
  expect(await ui.find({ type: 'Text', text: '¿Eliminar el criterio 1?' })).toBeDefined()
  expect((await ui.find({ key: 'criterion-remove-no' }))?.text).toBe('Conservar')
  await ui.unmount()
})
