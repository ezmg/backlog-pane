import { expect, test } from 'claude-code/testing'

import { PANE, fail, ok, open, openTask, world } from './fixtures'

// The description and the plan: inline in a field of several rows where the
// engine's Input takes `rows` (2.1.301 and later), in the person's own
// editor below that, since an older engine refuses a tree that names it.

const FIELDS = [
  { field: 'description', flag: '-d', text: 'Parse the **stream**.' },
  { field: 'plan', flag: '--plan', text: '1. Read\n2. Split' },
] as const

for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
  for (const { field, flag, text } of FIELDS) {
    test(`${surface}, 2.1.301: the ${field} is edited inline in a field of several rows`, async ($, on) => {
      const { clock, edits, editorRuns } = world(on, { version: '2.1.301' })
      await open($, clock)
      const ui = await $.ui.mount({ ...PANE, surface })
      await openTask(ui, 'BL-1')
      expect(await ui.find({ key: `editor-${field}` })).toBe(undefined)
      await ui.press({ key: `edit-${field}` })
      const input = await ui.find({ key: `${field}-input` })
      expect(input?.props.rows).toBe(8)
      expect(input?.props.value).toBe(text)
      expect(input?.props.autoFocus).toBe(true)
      expect(await ui.find({ type: 'Text', text: /Shift\+Enter/ })).toBeDefined()

      await ui.input({ key: `${field}-input`, text: 'First line\n\nSecond, with "quotes" & $HOME' })
      expect(edits()).toEqual([['task', 'edit', 'BL-1', flag, 'First line\n\nSecond, with "quotes" & $HOME']])
      expect(await ui.find({ key: `${field}-input` })).toBe(undefined)
      expect(editorRuns).toEqual([])
      await ui.unmount()
    })
  }

  test(`${surface}, 2.1.301: an unchanged text or Cancel saves nothing`, async ($, on) => {
    const { clock, edits } = world(on, { version: '2.1.310' })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    await ui.press({ key: 'edit-description' })
    await ui.input({ key: 'description-input', text: 'Parse the **stream**.\n' })
    expect(await ui.find({ type: 'Text', text: 'Nothing changed.' })).toBeDefined()
    await ui.press({ key: 'edit-plan' })
    await ui.press({ key: 'plan-cancel' })
    expect(await ui.find({ key: 'plan-input' })).toBe(undefined)
    expect(edits()).toEqual([])
    await ui.unmount()
  })

  test(`${surface}, 2.1.296: "Open in editor" instead, and no field names rows`, async ($, on) => {
    const { clock } = world(on, { version: '2.1.296' })
    await open($, clock)
    const ui = await $.ui.mount({ ...PANE, surface })
    await openTask(ui, 'BL-1')
    expect(await ui.find({ key: 'edit-description' })).toBe(undefined)
    expect((await ui.find({ key: 'editor-description' }))?.text).toBe('Open in editor')
    expect((await ui.find({ key: 'editor-plan' }))?.text).toBe('Open in editor')
    expect(await ui.find({ type: 'Markdown', text: /code --wait/ })).toBeDefined()
    for (const input of await ui.findAll({ type: 'Input' })) expect(input.props.rows).toBe(undefined)
    await ui.unmount()
  })

  for (const { field, flag } of FIELDS) {
    test(`${surface}, 2.1.296: the ${field} goes to defaultEditor and back`, async ($, on) => {
      const { clock, edits, editorRuns, files } = world(on, {
        version: '2.1.296',
        config: { defaultEditor: ok('code --wait\n') },
        env: { VISUAL: 'vim', TMPDIR: '/var/tmp/' },
        editor: { writes: 'Edited\r\nby hand\n' },
      })
      await open($, clock)
      const ui = await $.ui.mount({ ...PANE, surface })
      await openTask(ui, 'BL-1')
      await ui.press({ key: `editor-${field}` })
      const path = `/var/tmp/backlog-pane-BL-1-${field}.md`
      expect(editorRuns).toEqual([{ argv: ['code', '--wait', path], timeoutMs: 600_000 }])
      // The file held the text when the editor got it; the edit is saved.
      expect(files.get(path)).toBe('Edited\r\nby hand\n')
      expect(edits()).toEqual([['task', 'edit', 'BL-1', flag, 'Edited\nby hand']])
      expect(await ui.find({ type: 'Text', text: 'Updated BL-1.' })).toBeDefined()
      await ui.unmount()
    })
  }
}

test('the editor gets the text as it stands', async ($, on) => {
  // This editor leaves the file as it found it.
  const { clock, files } = world(on, { version: '2.1.296', env: { EDITOR: 'nano' } })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  await ui.press({ key: 'editor-plan' })
  expect(files.get('/tmp/backlog-pane-BL-1-plan.md')).toBe('1. Read\n2. Split')
  await ui.unmount()
})

test('without defaultEditor: VISUAL, then EDITOR', async ($, on) => {
  const { clock, editorRuns } = world(on, { version: '2.1.296', env: { VISUAL: 'subl -w', EDITOR: 'nano' } })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openTask(ui, 'BL-1')
  await ui.press({ key: 'editor-description' })
  expect(editorRuns[0]?.argv).toEqual(['subl', '-w', '/tmp/backlog-pane-BL-1-description.md'])
  await ui.unmount()
})

test('EDITOR alone', async ($, on) => {
  const { clock, editorRuns } = world(on, {
    version: '2.1.296',
    config: { defaultEditor: fail('Unknown key') },
    env: { EDITOR: 'nano' },
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  await ui.press({ key: 'editor-description' })
  expect(editorRuns[0]?.argv[0]).toBe('nano')
  await ui.unmount()
})

test('Windows: Notepad, in TEMP, when nothing names an editor', async ($, on) => {
  const { clock, editorRuns } = world(on, {
    version: '2.1.296',
    env: { OS: 'Windows_NT', TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp' },
  })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openTask(ui, 'BL-1')
  await ui.press({ key: 'editor-description' })
  expect(editorRuns[0]?.argv).toEqual(['notepad', 'C:\\Users\\me\\AppData\\Local\\Temp\\backlog-pane-BL-1-description.md'])
  await ui.unmount()
})

test('no editor anywhere: says how to set one, runs nothing', async ($, on) => {
  const { clock, editorRuns, edits } = world(on, { version: '2.1.296' })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  await ui.press({ key: 'editor-description' })
  expect(await ui.find({ type: 'Text', text: /backlog config set defaultEditor/ })).toBeDefined()
  expect(editorRuns).toEqual([])
  expect(edits()).toEqual([])
  await ui.unmount()
})

test('an editor that exits with an error saves nothing', async ($, on) => {
  const { clock, edits } = world(on, { version: '2.1.296', env: { EDITOR: 'nano' }, editor: { result: fail('nano: bad flag') } })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  await ui.press({ key: 'editor-description' })
  expect(await ui.find({ type: 'Text', text: 'The editor did not finish: nano: bad flag' })).toBeDefined()
  expect(edits()).toEqual([])
  await ui.unmount()
})

test('an editor still open at the timeout saves nothing', async ($, on) => {
  const { clock, edits } = world(on, { version: '2.1.296', env: { EDITOR: 'nano' }, editor: { throws: 'timed out' } })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  await ui.press({ key: 'editor-plan' })
  expect(await ui.find({ type: 'Text', text: /The editor did not finish: .*timed out/ })).toBeDefined()
  expect(edits()).toEqual([])
  await ui.unmount()
})

test('an editor closed without changes saves nothing', async ($, on) => {
  const { clock, edits } = world(on, { version: '2.1.296', env: { EDITOR: 'nano' }, editor: { writes: 'Parse the **stream**.\n' } })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  await ui.press({ key: 'editor-description' })
  expect(await ui.find({ type: 'Text', text: 'Nothing changed.' })).toBeDefined()
  expect(edits()).toEqual([])
  await ui.unmount()
})

test('a version that does not parse counts as old', async ($, on) => {
  const { clock } = world(on, { version: 'dev' })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  expect(await ui.find({ key: 'editor-description' })).toBeDefined()
  await ui.unmount()
})

test('mobile: the texts are shown, not edited', async ($, on) => {
  const { clock } = world(on, { version: '2.1.310' })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await openTask(ui, 'BL-1')
  expect(await ui.find({ type: 'Markdown', text: 'Parse the **stream**.' })).toBeDefined()
  expect(await ui.find({ key: 'edit-description' })).toBe(undefined)
  expect(await ui.find({ key: 'editor-description' })).toBe(undefined)
  await ui.unmount()
})

test('Spanish: "Editar" and "Abrir en el editor"', { options: { language: 'es' } }, async ($, on) => {
  const inline = world(on, { version: '2.1.301' })
  await open($, inline.clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openTask(ui, 'BL-1')
  expect((await ui.find({ key: 'edit-description' }))?.text).toBe('Editar')
  await ui.press({ key: 'edit-description' })
  expect((await ui.find({ key: 'description-cancel' }))?.text).toBe('Cancelar')
  expect(await ui.find({ type: 'Text', text: /Mayús\+Enter/ })).toBeDefined()
  await ui.unmount()
})

test('Spanish, 2.1.296: "Abrir en el editor"', { options: { language: 'es' } }, async ($, on) => {
  const { clock } = world(on, { version: '2.1.296' })
  await open($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openTask(ui, 'BL-1')
  expect((await ui.find({ key: 'editor-plan' }))?.text).toBe('Abrir en el editor')
  expect(await ui.find({ type: 'Markdown', text: /debe quedarse abierto/ })).toBeDefined()
  await ui.unmount()
})
