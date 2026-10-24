// backlog-pane: a live Backlog.md board in a side pane.
//
// `/backlog` opens the pane and starts one `backlog task list --json --watch`
// child, whose full-list replacements are read into $.state; the pane draws
// from there. Every write goes through a `backlog` command, never the files.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Phase, TaskDetail, TaskSummary } from '../types'
import {
  JsonDocumentReader,
  args,
  candidates,
  classify,
  createdId,
  errorLine,
  groupTasks,
  parseStatuses,
  readTaskList,
  readTaskView,
  summarize,
  workPrompt,
} from './cli'

type Engine = EngineInterface

const PANE = 'backlog'
const TITLE = 'Backlog'
const COMMAND = 'backlog'
const MAX_ATTEMPTS = 5

const phase = atom({ plugin: 'backlog-pane', key: 'phase' } as const, { kind: 'idle' } as Phase)
const tasks = atom({ plugin: 'backlog-pane', key: 'tasks' } as const, [] as TaskSummary[])
const statuses = atom({ plugin: 'backlog-pane', key: 'statuses' } as const, [] as string[])
const selectedId = atom({ plugin: 'backlog-pane', key: 'selectedId' } as const, null as string | null)
const detail = atom({ plugin: 'backlog-pane', key: 'detail' } as const, null as TaskDetail | null)
const isDoneOpen = atom({ plugin: 'backlog-pane', key: 'isDoneOpen' } as const, false)
const notice = atom({ plugin: 'backlog-pane', key: 'notice' } as const, null as string | null)

type Run = { ok: true; stdout: string } | { ok: false; stderr: string }

// Read from the plugin's options each time the module loads.
let configured = ''
let doneLimit = 5
// The executable that answered `--version`; found again after a reload.
let bin: string | null = null
// The watch loop in progress, if any.
let active: { isStopped: boolean; stop: () => void } | null = null

async function findBin($: Engine): Promise<string | null> {
  if (bin) return bin
  const list = candidates({
    configured,
    os: await $.env.get('OS'),
    appData: await $.env.get('APPDATA'),
    userProfile: await $.env.get('USERPROFILE'),
  })
  for (const candidate of list) {
    try {
      const probe = await $.process.run([candidate, ...args.version()], { timeoutMs: 15_000 })
      if (probe.exitCode === 0) return (bin = candidate)
    } catch {
      // Not startable under this name; try the next.
    }
  }
  return null
}

async function backlog($: Engine, argv: string[]): Promise<Run> {
  const exe = await findBin($)
  if (!exe) return { ok: false, stderr: 'The backlog CLI was not found.' }
  try {
    const done = await $.process.run([exe, ...argv], { timeoutMs: 60_000 })
    return done.exitCode === 0
      ? { ok: true, stdout: done.stdout }
      : { ok: false, stderr: done.stderr || done.stdout }
  } catch (error) {
    return { ok: false, stderr: String(error) }
  }
}

async function loadStatuses($: Engine) {
  const run = await backlog($, args.statuses())
  if (run.ok) await update($, statuses, () => parseStatuses(run.stdout))
}

async function loadDetail($: Engine, id: string) {
  const run = await backlog($, args.view(id))
  if ((await read($, selectedId)) !== id) return
  if (!run.ok) {
    await update($, notice, () => errorLine(run.stderr, `Could not read ${id}.`))
    return
  }
  const task = readTaskView(safeParse(run.stdout))
  await update($, detail, () => task ?? null)
}

async function receive($: Engine, list: TaskSummary[]) {
  await update($, tasks, () => list)
  await update($, phase, () => ({ kind: 'ready' }) as Phase)
  const id = await read($, selectedId)
  if (!id) return
  const shown = await read($, detail)
  const now = list.find(task => task.id === id)
  if (now && (!shown || shown.updatedAt !== now.updatedAt || shown.status !== now.status)) {
    await loadDetail($, id)
  }
}

async function watch($: Engine) {
  if (active) return
  const run = { isStopped: false, stop: () => {} }
  active = run
  try {
    if ((await read($, phase)).kind !== 'ready') await update($, phase, () => ({ kind: 'loading' }) as Phase)
    let failures = 0
    while (!run.isStopped) {
      const exe = await findBin($)
      if (!exe) {
        await update($, phase, () => ({ kind: 'not-installed' }) as Phase)
        return
      }
      await loadStatuses($)
      let stderr = ''
      let isListed = false
      const reader = new JsonDocumentReader()
      try {
        const stream = $.process.spawn({ argv: [exe, ...args.watch()] })
        run.stop = () => void stream.return(undefined as never)
        for await (const chunk of stream) {
          if (run.isStopped) break
          if (chunk.stream === 'stderr') {
            stderr = (stderr + chunk.text).slice(-4000)
            continue
          }
          for (const document of reader.push(chunk.text)) {
            const list = readTaskList(document)
            if (!list) continue
            isListed = true
            await receive($, list)
          }
        }
      } catch (error) {
        stderr ||= String(error)
      }
      if (run.isStopped) return
      if (classify(stderr) === 'not-initialized') {
        await update($, phase, () => ({ kind: 'not-initialized', message: errorLine(stderr, '') }) as Phase)
        return
      }
      // A watch that delivered lists and then ended starts the count over.
      failures = isListed ? 1 : failures + 1
      if (failures >= MAX_ATTEMPTS) {
        const message = errorLine(stderr, 'backlog task list --watch kept stopping.')
        await update($, phase, () => ({ kind: 'failed', message }) as Phase)
        return
      }
      await $.clock.sleep(1000 * 2 ** (failures - 1))
    }
  } finally {
    if (active === run) active = null
  }
}

/** Starts the watch in the background; it ends with the pane or the module. */
function startWatch($: Engine) {
  watch($).catch(() => {
    // Aborted by an unload or a reload: the next load starts it again.
  })
}

function stopWatch() {
  if (!active) return
  active.isStopped = true
  active.stop()
  active = null
}

async function retry($: Engine) {
  stopWatch()
  bin = null
  await update($, notice, () => null)
  await update($, phase, () => ({ kind: 'loading' }) as Phase)
  startWatch($)
}

async function select($: Engine, id: string | null) {
  await update($, selectedId, () => id)
  await update($, detail, () => null)
  await update($, notice, () => null)
  if (id) await loadDetail($, id)
}

async function setStatus($: Engine, id: string, status: string) {
  const run = await backlog($, args.setStatus(id, status))
  await update($, notice, () => (run.ok ? `Moved ${id} to ${status}.` : errorLine(run.stderr, `Could not move ${id}.`)))
  if (run.ok) await loadDetail($, id)
}

async function create($: Engine, title: string) {
  const name = title.trim()
  if (!name) return
  const run = await backlog($, args.create(name))
  await update($, notice, () =>
    run.ok ? `Created ${createdId(run.stdout) ?? 'the task'}.` : errorLine(run.stderr, 'Could not create the task.'),
  )
}

async function work($: Engine, id: string) {
  const text = workPrompt(id)
  const box = await $.prompt.read()
  const filled =
    box.text.trim() === ''
      ? await $.prompt.fill({ text, mode: 'replace' })
      : await $.prompt.fill({ text: `\n\n${text}`, mode: 'append' })
  if (filled.isFilled) {
    await update($, notice, () => `Draft for ${id} is in the prompt box. Review it, then press Enter to send.`)
  } else {
    await update($, notice, () => `The prompt box did not take the draft. Copy it instead: ${text}`)
  }
}

export const register: Register = (on, options) => {
  configured = typeof options.backlogPath === 'string' ? options.backlogPath : ''
  doneLimit = typeof options.doneLimit === 'number' ? options.doneLimit : 5

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Open the Backlog.md board in a side pane',
    })
    // After a reload the pane may still be up: pick its watch up again.
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) startWatch($)
    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    if ((await $.session.surfaces()).length === 0) {
      const run = await backlog($, args.list())
      if (!run.ok) {
        if (!(await findBin($))) return { text: 'Backlog.md CLI not found. Install it with `npm i -g backlog.md`.' }
        return {
          text:
            classify(run.stderr) === 'not-initialized'
              ? 'No Backlog.md project here. Run `backlog init` first.'
              : errorLine(run.stderr, 'backlog task list failed.'),
        }
      }
      await loadStatuses($)
      return { text: summarize(readTaskList(safeParse(run.stdout)) ?? [], await read($, statuses)) }
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    startWatch($)
    return { text: opened.isPlaced ? 'Backlog pane opened.' : `Backlog pane is waiting for room (${opened.reason}).` }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopWatch()
    await update($, phase, () => ({ kind: 'idle' }) as Phase)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = ui
    // Fields and pickers only where the surface's table has them (not mobile).
    const hasForms = e.surface === 'terminal' || e.surface === 'desktop' || e.surface === 'vscode'
    const Input = hasForms && 'Input' in ui ? ui.Input : undefined
    const Select = hasForms && 'Select' in ui ? ui.Select : undefined
    const now = await read($, phase)
    const message = await read($, notice)

    const section = (title: string, body: string | null) => (
      <Box flexDirection="column">
        <Text bold>{title}</Text>
        {body?.trim() ? <Markdown text={body} /> : <Text dimColor>None.</Text>}
      </Box>
    )
    const retryButton =<Button key="retry" variant="primary" label="Retry" onPress={() => retry($)} />
    const footer = message ? <Text dimColor>{message}</Text> : null

    if (now.kind === 'not-installed') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Backlog.md CLI not found</Text>
          <Markdown text={'Install it with `npm i -g backlog.md` (or `bun add -g backlog.md`, `brew install backlog-md`), then press Retry. You can also set the full path in the plugin option **backlogPath**.'} />
          {retryButton}
        </Box>
      )
    }
    if (now.kind === 'not-initialized') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>No Backlog.md project in this folder</Text>
          <Markdown text={'Run `backlog init` in the project root, then press Retry.'} />
          {retryButton}
        </Box>
      )
    }
    if (now.kind === 'failed') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="red">The live task list stopped</Text>
          <Text>{now.message}</Text>
          {retryButton}
        </Box>
      )
    }
    if (now.kind !== 'ready') {
      return <Text dimColor>Loading tasks…</Text>
    }

    const id = await read($, selectedId)
    const order = await read($, statuses)

    if (id) {
      const task = await read($, detail)
      const summary = (await read($, tasks)).find(one => one.id === id)
      const status = task?.status ?? summary?.status ?? ''
      const choices = order.includes(status) || !status ? order : [...order, status]
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Button key="back" plain label="← Back" onPress={() => select($, null)} />
            <Text dimColor>{id}</Text>
          </Box>
          <Text bold>{task?.title ?? summary?.title ?? id}</Text>
          {Select ? (
            <Select
              key="status"
              label="Status"
              value={status}
              options={choices.map(one => ({ value: one, label: one }))}
              onSelect={value => (value !== status ? setStatus($, id, value) : undefined)}
            />
          ) : (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {choices.map((one, i) => (
                <Button key={`status-${i}`} label={one} variant={one === status ? 'primary' : 'secondary'} onPress={() => (one !== status ? setStatus($, id, one) : undefined)} />
              ))}
            </Box>
          )}
          <Button key="work" variant="primary" label="Work on this task" onPress={() => work($, id)} />
          {footer}
          {!task ? <Text dimColor>Loading details…</Text> : null}
          {task ? section('Description', task.description) : null}
          {task ? (
            <Box flexDirection="column">
              <Text bold>Acceptance criteria</Text>
              {task.acceptanceCriteria.length === 0 ? <Text dimColor>None.</Text> : null}
              {task.acceptanceCriteria.map(item => (
                <Text dimColor={item.checked}>
                  {item.checked ? '[x]' : '[ ]'} {item.index}. {item.text}
                </Text>
              ))}
            </Box>
          ) : null}
          {task ? section('Implementation plan', task.implementationPlan) : null}
        </Box>
      )
    }

    const list = await read($, tasks)
    const isOpen = await read($, isDoneOpen)
    const groups = groupTasks(list, order, doneLimit)
    return (
      <Box flexDirection="column" gap={1}>
        {Input ? (
          <Input key="new-task" placeholder="New task title" submitLabel="Create" onSubmit={value => create($, value)} />
        ) : null}
        {footer}
        {list.length === 0 ? <Text dimColor>No tasks yet.</Text> : null}
        {groups.map(group => {
          const rows = group.tasks.map(task => (
            <Button key={`task:${task.id}`} plain onPress={() => select($, task.id)}>
              {task.id} {task.title}
              {task.acceptanceCriteriaCount > 0 ? (
                <Text dimColor>
                  {' '}
                  {task.acceptanceCriteriaCompleted}/{task.acceptanceCriteriaCount}
                </Text>
              ) : (
                ''
              )}
            </Button>
          ))
          if (group.isFinal) {
            return (
              <Box key={`group:${group.status}`} flexDirection="column">
                <Button key="toggle-done" plain onPress={() => update($, isDoneOpen, open => !open)}>
                  {isOpen ? '▾' : '▸'} {group.status} <Text dimColor>({group.total})</Text>
                </Button>
                {isOpen ? rows : null}
                {isOpen && group.total > group.tasks.length ? (
                  <Text dimColor>
                    The {group.tasks.length} most recent of {group.total}.
                  </Text>
                ) : null}
              </Box>
            )
          }
          return (
            <Box key={`group:${group.status}`} flexDirection="column">
              <Text bold>
                {group.status} <Text dimColor>({group.total})</Text>
              </Text>
              {rows}
            </Box>
          )
        })}
      </Box>
    )
  })
}

function safeParse(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}
