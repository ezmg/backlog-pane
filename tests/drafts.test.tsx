import { expect, test } from 'claude-code/testing'

import { PANE, open, openTask, world } from './fixtures'

// The two drafts the task view leaves in the prompt box. Neither is sent.

for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
  test(`${surface}: "Edit with Claude" replaces an empty prompt box with "Update <ID>: "`, async ($, on) => {
    const { clock, fills } = world(on, { prompt: '  ' })
    let submitted = 0
    on('prompt.submit', (_, e) => {
      submitted += 1
      return { text: e.text }
    })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-2')
    expect((await ui.find({ key: 'edit-with-claude' }))?.text).toBe('Edit with Claude')
    await ui.press({ key: 'edit-with-claude' })
    expect(fills).toEqual([{ text: 'Update BL-2: ', mode: 'replace' }])
    expect(submitted).toBe(0)
    expect(await ui.find({ type: 'Text', text: /"Update BL-2" is in the prompt box/ })).toBeDefined()
    await ui.unmount()
  })

  test(`${surface}: "Edit with Claude" adds a line to text already in the box`, async ($, on) => {
    const { clock, fills } = world(on, { prompt: 'Also check the tests.' })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    await ui.press({ key: 'edit-with-claude' })
    expect(fills).toEqual([{ text: '\nUpdate BL-1: ', mode: 'append' }])
    await ui.unmount()
  })

  test(`${surface}: "Work on this task" adds a paragraph to text already in the box`, async ($, on) => {
    const { clock, fills } = world(on, { prompt: 'Context first.' })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    await ui.press({ key: 'work' })
    expect(fills[0]?.mode).toBe('append')
    expect(fills[0]?.text).toMatch(/^\n\nWork on BL-1 only\./)
    await ui.unmount()
  })
}

test('Spanish: "Editar con Claude" drafts "Actualiza <ID>: "', { options: { language: 'es' } }, async ($, on) => {
  const { clock, fills } = world(on)
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openTask(ui, 'BL-1')
  expect((await ui.find({ key: 'edit-with-claude' }))?.text).toBe('Editar con Claude')
  expect((await ui.find({ key: 'work' }))?.text).toBe('Trabajar en esta tarea')
  await ui.press({ key: 'edit-with-claude' })
  expect(fills).toEqual([{ text: 'Actualiza BL-1: ', mode: 'replace' }])
  await ui.press({ key: 'work' })
  expect(fills[1]?.text).toBe(
    'Trabaja solo en BL-1. Investiga el código y escribe un plan de implementación en la tarea. Espera mi aprobación antes de programar.',
  )
  await ui.unmount()
})

test('a prompt box that refuses the draft: the draft is shown to copy', async ($, on) => {
  const { clock } = world(on, { isFillRefused: true })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  await ui.press({ key: 'edit-with-claude' })
  expect(await ui.find({ type: 'Text', text: /Copy it instead: Update BL-1:/ })).toBeDefined()
  await ui.unmount()
})
