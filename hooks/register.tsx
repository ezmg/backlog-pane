// backlog-pane: a live Backlog.md board in a side pane.
//
// `/backlog` opens the pane and starts one `backlog task list --json --watch`
// child, whose full-list replacements are read into $.state; the pane draws
// from there. Every write goes through a `backlog` command, never the files.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BoardProps, Phase, TaskDetail, TaskSummary } from '../types'
import {
  JsonDocumentReader,
  args,
  candidates,
  classify,
  createdId,
  errorLine,
  groupTasks,
  isHighPriority,
  isRecord,
  neighbours,
  parsePriorities,
  parseStatuses,
  readTaskList,
  readTaskView,
  rewriteCriteria,
  summarize,
} from './cli'
import { detectLanguage, strings } from './i18n'
import type { Language, Strings } from './i18n'

type Engine = EngineInterface

const PANE = 'backlog'
const COMMAND = 'backlog'
const MAX_ATTEMPTS = 5

const phase = atom({ plugin: 'backlog-pane', key: 'phase' } as const, { kind: 'idle' } as Phase)
const tasks = atom({ plugin: 'backlog-pane', key: 'tasks' } as const, [] as TaskSummary[])
const statuses = atom({ plugin: 'backlog-pane', key: 'statuses' } as const, [] as string[])
const priorities = atom({ plugin: 'backlog-pane', key: 'priorities' } as const, [] as string[])
const selectedId = atom({ plugin: 'backlog-pane', key: 'selectedId' } as const, null as string | null)
const detail = atom({ plugin: 'backlog-pane', key: 'detail' } as const, null as TaskDetail | null)
const isDoneOpen = atom({ plugin: 'backlog-pane', key: 'isDoneOpen' } as const, false)
const notice = atom({ plugin: 'backlog-pane', key: 'notice' } as const, null as string | null)
// What the task view is editing: `title`, `description`, `plan`, a criterion
// (`criterion:<index>`), or the criterion awaiting a delete (`remove:<index>`).
const editing = atom({ plugin: 'backlog-pane', key: 'editing' } as const, null as string | null)
const isCreating = atom({ plugin: 'backlog-pane', key: 'isCreating' } as const, false)
// Set when the board's Client failed on a surface: the list stands in.
const isBoardFailed = atom({ plugin: 'backlog-pane', key: 'isBoardFailed' } as const, false)

type Run = { ok: true; stdout: string } | { ok: false; stderr: string }

// Read from the plugin's options each time the module loads.
let configured = ''
let doneLimit = 5
let languageOption: unknown = 'auto'
// The language shown, detected once per load.
let language: Language | null = null
// The executable that answered `--version`; found again after a reload.
let bin: string | null = null
// The watch loop in progress, if any.
let active: { isStopped: boolean; stop: () => void } | null = null

/**
 * The strings in the language the `language` option names, or for `auto`
 * the one Claude Code's `language` setting, the locale variables or the
 * runtime's locale say, in that order.
 */
async function text($: Engine): Promise<Strings> {
  if (!language) {
    let setting: unknown
    try {
      const value = await $.settings.read({ key: 'language' })
      // Earlier releases (2.1.296 among them) answer a read of one key with
      // the whole settings object.
      setting = isRecord(value) ? value.language : value
    } catch {
      // No settings to read here; the locale decides.
    }
    let intl: string | undefined
    try {
      intl = new Intl.DateTimeFormat().resolvedOptions().locale
    } catch {
      // No Intl in this runtime.
    }
    language = detectLanguage({
      option: languageOption,
      setting,
      lcAll: await $.env.get('LC_ALL'),
      lcMessages: await $.env.get('LC_MESSAGES'),
      lang: await $.env.get('LANG'),
      intl,
    })
  }
  return strings(language)
}

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
  if (!exe) return { ok: false, stderr: (await text($)).cliNotFound }
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
  const listed = await backlog($, args.priorities())
  await update($, priorities, () => parsePriorities(listed.ok ? listed.stdout : ''))
}

async function loadDetail($: Engine, id: string) {
  const run = await backlog($, args.view(id))
  if ((await read($, selectedId)) !== id) return
  if (!run.ok) {
    const t = await text($)
    await update($, notice, () => errorLine(run.stderr, t.couldNotRead(id)))
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
        const message = errorLine(stderr, (await text($)).watchStopping)
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
  await update($, editing, () => null)
  if (id) await loadDetail($, id)
}

/**
 * Runs `task edit` commands for `id` one after another, stopping at the
 * first that fails; then says how it went and reads the task again.
 */
async function edit($: Engine, id: string, commands: string[][]): Promise<boolean> {
  const t = await text($)
  for (const argv of commands) {
    const run = await backlog($, argv)
    if (!run.ok) {
      await update($, notice, () => errorLine(run.stderr, t.couldNotUpdate(id)))
      return false
    }
  }
  await update($, notice, () => t.updated(id))
  await update($, editing, () => null)
  if ((await read($, selectedId)) === id) await loadDetail($, id)
  return true
}

async function rename($: Engine, id: string, title: string) {
  const name = title.trim()
  const shown = (await read($, detail))?.title
  if (!name || name === shown) return
  if (await edit($, id, [args.setTitle(id, name)])) {
    await update($, tasks, list => list.map(task => (task.id === id ? { ...task, title: name } : task)))
  }
}

async function setPriority($: Engine, id: string, priority: string) {
  const shown = (await read($, detail))?.priority
  if (!priority || priority.toLowerCase() === shown?.toLowerCase()) return
  if (await edit($, id, [args.setPriority(id, priority)])) {
    await update($, tasks, list => list.map(task => (task.id === id ? { ...task, priority } : task)))
  }
}

async function toggleCriterion($: Engine, id: string, index: number, isChecked: boolean) {
  await edit($, id, [isChecked ? args.uncheckCriterion(id, index) : args.checkCriterion(id, index)])
}

async function addCriterion($: Engine, id: string, value: string) {
  const criterion = value.trim()
  if (criterion) await edit($, id, [args.addCriterion(id, criterion)])
}

async function removeCriterion($: Engine, id: string, index: number) {
  await edit($, id, [args.removeCriterion(id, index)])
}

/**
 * Edits one criterion by writing the whole list again, in order: the CLI
 * keeps the ticks of the texts that did not change, so a ticked criterion
 * whose text changed is ticked again by a second command.
 */
async function rewriteCriterion($: Engine, id: string, index: number, value: string) {
  const criteria = (await read($, detail))?.acceptanceCriteria ?? []
  const texts = rewriteCriteria(criteria, index, value)
  if (!texts) {
    await update($, editing, () => null)
    return
  }
  const position = criteria.findIndex(item => item.index === index) + 1
  const wasChecked = criteria[position - 1]?.checked === true
  const commands = [args.setCriteria(id, texts)]
  if (wasChecked) commands.push(args.checkCriterion(id, position))
  await edit($, id, commands)
}

async function setStatus($: Engine, id: string, status: string) {
  const run = await backlog($, args.setStatus(id, status))
  const t = await text($)
  await update($, notice, () => (run.ok ? t.moved(id, status) : errorLine(run.stderr, t.couldNotMove(id))))
  if (!run.ok) return
  // Shown at once; the watch's next list confirms it.
  await update($, tasks, list => list.map(task => (task.id === id ? { ...task, status } : task)))
  if ((await read($, selectedId)) === id) await loadDetail($, id)
}

async function create($: Engine, title: string) {
  const name = title.trim()
  if (!name) return
  const run = await backlog($, args.create(name))
  const t = await text($)
  await update($, notice, () =>
    run.ok ? t.created(createdId(run.stdout) ?? t.theTask) : errorLine(run.stderr, t.couldNotCreate),
  )
  if (run.ok) await update($, isCreating, () => false)
}

/**
 * What the board's surface module posted: a card moved to another column,
 * or opened. It came from code, so it is checked against the tasks shown.
 */
async function onBoardMessage($: Engine, data: unknown) {
  if (!isRecord(data) || typeof data.id !== 'string') return
  const id = data.id
  const list = await read($, tasks)
  const task = list.find(one => one.id === id)
  if (!task) return
  if (data.type === 'open') {
    await select($, id)
    return
  }
  if (data.type !== 'move' || typeof data.status !== 'string' || data.status === task.status) return
  const shown = groupTasks(list, await read($, statuses), 0).map(group => group.status)
  if (shown.includes(data.status)) await setStatus($, id, data.status)
}

async function work($: Engine, id: string) {
  const t = await text($)
  const draft = t.workPrompt(id)
  const box = await $.prompt.read()
  const filled =
    box.text.trim() === ''
      ? await $.prompt.fill({ text: draft, mode: 'replace' })
      : await $.prompt.fill({ text: `\n\n${draft}`, mode: 'append' })
  await update($, notice, () => (filled.isFilled ? t.draftReady(id) : t.draftRejected(draft)))
}

export const register: Register = (on, options) => {
  configured = typeof options.backlogPath === 'string' ? options.backlogPath : ''
  doneLimit = typeof options.doneLimit === 'number' ? options.doneLimit : 5
  languageOption = options.language
  language = null

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // A reload gives the board another try.
    await update($, isBoardFailed, () => false)
    await $.command.register({
      name: COMMAND,
      description: (await text($)).commandDescription,
    })
    // After a reload the pane may still be up: pick its watch up again.
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) startWatch($)
    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    const t = await text($)
    if ((await $.session.surfaces()).length === 0) {
      const run = await backlog($, args.list())
      if (!run.ok) {
        if (!(await findBin($))) return { text: t.cliMissingText }
        return {
          text: classify(run.stderr) === 'not-initialized' ? t.noProjectText : errorLine(run.stderr, t.listFailed),
        }
      }
      await loadStatuses($)
      return { text: summarize(readTaskList(safeParse(run.stdout)) ?? [], await read($, statuses), t) }
    }
    const opened = await $.ui.open({ id: PANE, title: t.paneTitle })
    startWatch($)
    return { text: opened.isPlaced ? t.opened : t.waitingForRoom(opened.reason) }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    stopWatch()
    await update($, phase, () => ({ kind: 'idle' }) as Phase)
    return next(e)
  })

  on('ui.message', { element: 'board' }, async ($, e, next) => {
    await onBoardMessage($, e.data)
    return next(e)
  })

  on('ui.fault', { element: 'board' }, async ($, e, next) => {
    await update($, isBoardFailed, () => true)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = ui
    // Fields and pickers only where the surface's table has them (not mobile).
    const hasForms = e.surface === 'terminal' || e.surface === 'desktop' || e.surface === 'vscode'
    const Input = hasForms && 'Input' in ui ? ui.Input : undefined
    const Select = hasForms && 'Select' in ui ? ui.Select : undefined
    // The board where a Client draws (terminal, desktop); the list elsewhere.
    const hasBoard = e.surface === 'terminal' || e.surface === 'desktop'
    const Client = hasBoard && 'Client' in ui ? ui.Client : undefined
    const t = await text($)
    const now = await read($, phase)
    const message = await read($, notice)

    const section = (title: string, body: string | null) => (
      <Box flexDirection="column">
        <Text bold>{title}</Text>
        {body?.trim() ? <Markdown text={body} /> : <Text dimColor>{t.none}</Text>}
      </Box>
    )
    const retryButton = <Button key="retry" variant="primary" label={t.retry} onPress={() => retry($)} />
    const footer = message ? <Text dimColor>{message}</Text> : null

    if (now.kind === 'not-installed') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{t.notInstalledTitle}</Text>
          <Markdown text={t.notInstalledHelp} />
          {retryButton}
        </Box>
      )
    }
    if (now.kind === 'not-initialized') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{t.notInitializedTitle}</Text>
          <Markdown text={t.notInitializedHelp} />
          {retryButton}
        </Box>
      )
    }
    if (now.kind === 'failed') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="error">{t.failedTitle}</Text>
          <Text>{now.message}</Text>
          {retryButton}
        </Box>
      )
    }
    if (now.kind !== 'ready') {
      return <Text dimColor>{t.loadingTasks}</Text>
    }

    const id = await read($, selectedId)
    const order = await read($, statuses)

    if (id) {
      const task = await read($, detail)
      const summary = (await read($, tasks)).find(one => one.id === id)
      const status = task?.status ?? summary?.status ?? ''
      const choices = order.includes(status) || !status ? order : [...order, status]
      const color = groupTasks([], choices, 0).find(group => group.status === status)?.color
      const title = task?.title ?? summary?.title ?? id
      const priority = task?.priority ?? summary?.priority ?? null
      const isHigh = isHighPriority(priority)
      const around = neighbours(choices, status)
      const now = await read($, editing)
      const stopEditing = () => update($, editing, () => null)

      // Priorities: the configured ones, the task's own if the config lacks
      // it. A priority once set cannot be cleared through the CLI, so "None"
      // is offered only while the task has none.
      const levels = await read($, priorities)
      const current = levels.find(one => one.toLowerCase() === priority?.toLowerCase()) ?? priority
      const priorityOptions = [
        ...(current ? [] : [{ value: '', label: t.noPriority }]),
        ...(current && !levels.includes(current) ? [current] : []).concat(levels).map(one => ({
          value: one,
          label: t.priorityName[one.toLowerCase()] ?? one,
        })),
      ]

      const criteria = task ? (
        <Box flexDirection="column">
          <Text bold>{t.criteria}</Text>
          {task.acceptanceCriteria.length === 0 ? <Text dimColor>{t.none}</Text> : null}
          {task.acceptanceCriteria.map(item => {
            if (Input && now === `criterion:${item.index}`) {
              return (
                <Box flexDirection="row" gap={1}>
                  <Input
                    key={`criterion-text-${item.index}`}
                    autoFocus
                    value={item.text}
                    submitLabel={t.save}
                    onSubmit={value => rewriteCriterion($, id, item.index, value)}
                  />
                  <Button key="criterion-cancel" label={t.cancel} onPress={stopEditing} />
                </Box>
              )
            }
            if (now === `remove:${item.index}`) {
              return (
                <Box flexDirection="row" flexWrap="wrap" gap={1}>
                  <Text>{t.confirmRemove(item.index)}</Text>
                  <Button
                    key={`criterion-remove-yes-${item.index}`}
                    variant="primary"
                    label={t.remove}
                    onPress={() => removeCriterion($, id, item.index)}
                  />
                  <Button key="criterion-remove-no" label={t.keep} onPress={stopEditing} />
                </Box>
              )
            }
            return (
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                <Button
                  key={`criterion-check-${item.index}`}
                  plain
                  dimColor={item.checked}
                  onPress={() => toggleCriterion($, id, item.index, item.checked)}
                >
                  {item.checked ? '[x]' : '[ ]'} {item.index}. {item.text}
                </Button>
                {Input ? (
                  <Button
                    key={`criterion-edit-${item.index}`}
                    plain
                    dimColor
                    label={t.edit}
                    onPress={() => update($, editing, () => `criterion:${item.index}`)}
                  />
                ) : null}
                <Button
                  key={`criterion-remove-${item.index}`}
                  plain
                  dimColor
                  label={t.remove}
                  onPress={() => update($, editing, () => `remove:${item.index}`)}
                />
              </Box>
            )
          })}
          {Input ? (
            <Input
              key="criterion-new"
              placeholder={t.newCriterion}
              submitLabel={t.add}
              value=""
              onSubmit={value => addCriterion($, id, value)}
            />
          ) : null}
        </Box>
      ) : null

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Button key="back" plain label={t.back} onPress={() => select($, null)} />
            <Text dimColor>{id}</Text>
            <Text color={color}>{status}</Text>
          </Box>
          {Input ? (
            <Input key="title" label={t.title} value={title} submitLabel={t.save} onSubmit={value => rename($, id, value)} />
          ) : (
            <Text bold>
              {isHigh ? <Text color="error">! </Text> : ''}
              {title}
            </Text>
          )}
          {Select ? (
            <Select
              key="status"
              label={t.status}
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
          {around.previous || around.next ? (
            <Box flexDirection="row" gap={1}>
              {around.previous ? (
                <Button
                  key="status-prev"
                  hotkey="h"
                  label={`◀ ${around.previous}`}
                  onPress={() => setStatus($, id, around.previous ?? status)}
                />
              ) : null}
              {around.next ? (
                <Button
                  key="status-next"
                  hotkey="l"
                  label={`${around.next} ▶`}
                  onPress={() => setStatus($, id, around.next ?? status)}
                />
              ) : null}
            </Box>
          ) : null}
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {Select ? (
              <Select
                key="priority"
                label={t.priority}
                value={current ?? ''}
                options={priorityOptions}
                onSelect={value => setPriority($, id, value)}
              />
            ) : (
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                <Text>{t.priority}:</Text>
                {priorityOptions
                  .filter(option => option.value !== '')
                  .map((option, i) => (
                    <Button
                      key={`priority-${i}`}
                      label={option.label}
                      variant={option.value === current ? 'primary' : 'secondary'}
                      onPress={() => setPriority($, id, option.value)}
                    />
                  ))}
              </Box>
            )}
            {isHigh ? <Text color="error">! {t.highPriority}</Text> : null}
          </Box>
          <Button key="work" variant="primary" label={t.work} onPress={() => work($, id)} />
          {footer}
          {!task ? <Text dimColor>{t.loadingDetails}</Text> : null}
          {task ? section(t.description, task.description) : null}
          {criteria}
          {task ? section(t.plan, task.implementationPlan) : null}
        </Box>
      )
    }

    const list = await read($, tasks)
    const isOpen = await read($, isDoneOpen)
    const groups = groupTasks(list, order, doneLimit)
    const creating = await read($, isCreating)
    return (
      <Box flexDirection="column" gap={1}>
        {Input && creating ? (
          <Box flexDirection="row" gap={1}>
            <Input
              key="new-task"
              autoFocus
              placeholder={t.newTaskPlaceholder}
              submitLabel={t.create}
              onSubmit={value => create($, value)}
            />
            <Button key="new-task-cancel" label={t.cancel} onPress={() => update($, isCreating, () => false)} />
          </Box>
        ) : null}
        {Input && !creating ? (
          <Button key="new-task-open" label={t.newTask} onPress={() => update($, isCreating, () => true)} />
        ) : null}
        {footer}
        {list.length === 0 ? <Text dimColor>{t.noTasks}</Text> : null}
        {list.length > 0 && Client && !(await read($, isBoardFailed)) ? (
          <Client key="board" module="./board.tsx" width="100%" props={board(groups, e.props.bodyColumns, t)} />
        ) : null}
        {list.length > 0 && Client && !(await read($, isBoardFailed)) ? null : groups.map(group => {
          const rows = group.tasks.map(task => (
            <Button key={`task:${task.id}`} plain onPress={() => select($, task.id)}>
              {isHighPriority(task.priority) ? <Text color="error">! </Text> : ''}
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
                  {isOpen ? '▾' : '▸'} <Text color={group.color}>{group.status}</Text> <Text dimColor>({group.total})</Text>
                </Button>
                {isOpen ? rows : null}
                {isOpen && group.total > group.tasks.length ? (
                  <Text dimColor>{t.mostRecent(group.tasks.length, group.total)}</Text>
                ) : null}
              </Box>
            )
          }
          return (
            <Box key={`group:${group.status}`} flexDirection="column">
              <Text bold color={group.color}>
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

/** The board's props: every status shown, its colour and its cards. */
function board(groups: ReturnType<typeof groupTasks>, width: number, t: Strings): BoardProps {
  return {
    columns: groups.map(group => ({
      status: group.status,
      color: group.color,
      total: group.total,
      cards: group.tasks.map(task => ({ id: task.id, title: task.title, isHigh: isHighPriority(task.priority) })),
    })),
    width,
    hint: t.boardHint,
  }
}

function safeParse(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}
