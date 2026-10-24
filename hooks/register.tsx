// backlog-pane: a live Backlog.md board in a side pane.
//
// `/backlog` opens the pane and starts one `backlog task list --json --watch`
// child, whose full-list replacements are read into $.state; the pane draws
// from there. Every write goes through a `backlog` command, never the files.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BoardProps, Phase, Prefs, TaskDetail, TaskSummary } from '../types'
import {
  JsonDocumentReader,
  args,
  candidates,
  classify,
  configCandidates,
  createdId,
  editorFile,
  errorLine,
  groupTasks,
  isAtLeast,
  isHighPriority,
  isPaletteColor,
  isRecord,
  neighbours,
  PALETTE,
  parseClosed,
  parsePriorities,
  parseStatuses,
  pickEditor,
  readPrefs,
  readTaskList,
  readTaskView,
  rewriteCriteria,
  rewriteStatuses,
  sameStatuses,
  statusProblem,
  summarize,
} from './cli'
import { detectLanguage, strings } from './i18n'
import type { Language, Strings } from './i18n'

type Engine = EngineInterface

const PANE = 'backlog'
const COMMAND = 'backlog'
const MAX_ATTEMPTS = 5
// The release whose Input took `rows`. An older engine does not draw it (or
// refuses the tree that names it), so the external editor stands in there.
const MULTILINE_SINCE = '2.1.301'
// How long the external editor may stay open: $.process.run's longest.
const EDITOR_TIMEOUT_MS = 600_000

type LongField = 'description' | 'plan'

const phase = atom({ plugin: 'backlog-pane', key: 'phase' } as const, { kind: 'idle' } as Phase)
const tasks = atom({ plugin: 'backlog-pane', key: 'tasks' } as const, [] as TaskSummary[])
const statuses = atom({ plugin: 'backlog-pane', key: 'statuses' } as const, [] as string[])
const priorities = atom({ plugin: 'backlog-pane', key: 'priorities' } as const, [] as string[])
const selectedId = atom({ plugin: 'backlog-pane', key: 'selectedId' } as const, null as string | null)
const detail = atom({ plugin: 'backlog-pane', key: 'detail' } as const, null as TaskDetail | null)
// The folded groups of the list (the final status, the closed ones) that are unfolded.
const openGroups = atom({ plugin: 'backlog-pane', key: 'openGroups' } as const, [] as string[])
const notice = atom({ plugin: 'backlog-pane', key: 'notice' } as const, null as string | null)
// What the task view is editing: `description`, `plan`, a criterion
// (`criterion:<index>`), or the criterion awaiting a delete (`remove:<index>`).
const editing = atom({ plugin: 'backlog-pane', key: 'editing' } as const, null as string | null)
const isCreating = atom({ plugin: 'backlog-pane', key: 'isCreating' } as const, false)
// Set when the board's Client failed on a surface: the list stands in.
const isBoardFailed = atom({ plugin: 'backlog-pane', key: 'isBoardFailed' } as const, false)
// The statuses view, and where a new status goes in it (null: before the final one).
const isManagingStatuses = atom({ plugin: 'backlog-pane', key: 'isManagingStatuses' } as const, false)
const newStatusAt = atom({ plugin: 'backlog-pane', key: 'newStatusAt' } as const, null as number | null)
// This project's colours and closed statuses, and the $.store key they are kept under.
const prefs = atom({ plugin: 'backlog-pane', key: 'prefs' } as const, { colors: {} } as Prefs)
const prefsKey = atom({ plugin: 'backlog-pane', key: 'prefsKey' } as const, null as string | null)

type Run = { ok: true; stdout: string } | { ok: false; stderr: string }

// Read from the plugin's options each time the module loads.
let configured = ''
let doneLimit = 5
// The closedStatuses option: the closed statuses of a project whose own are not set yet.
let closedOption: string[] = []
// The session's working folder, from session.start: where the config is looked for from.
let cwd = ''
let languageOption: unknown = 'auto'
// The language shown, detected once per load.
let language: Language | null = null
// Whether this engine's Input takes `rows`, asked once per load.
let multiline: boolean | null = null
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

async function hasMultiline($: Engine): Promise<boolean> {
  if (multiline === null) {
    try {
      const engine = await $.session.version()
      multiline = isAtLeast(engine.base ?? engine.version, MULTILINE_SINCE)
    } catch {
      multiline = false
    }
  }
  return multiline
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
  await loadPrefs($)
}

/** This project's prefs, kept in $.store under its config's path (else its folder). */
async function loadPrefs($: Engine) {
  const key = `project:${(await findConfig($)) ?? cwd}`
  let stored: unknown
  try {
    stored = await $.store.get(key)
  } catch {
    // Nothing kept yet.
  }
  await update($, prefsKey, () => key)
  await update($, prefs, () => readPrefs(stored))
}

/** The project's closed statuses: its own, else the closedStatuses option's. */
const closedOf = (kept: Prefs) => kept.closed ?? closedOption

async function savePrefs($: Engine, change: (kept: Prefs) => Prefs) {
  const next = await update($, prefs, change)
  const key = await read($, prefsKey)
  if (!key) return
  try {
    await $.store.set(key, next)
  } catch (error) {
    await update($, notice, () => String(error))
  }
}

/** Gives a status a colour of the palette, or `auto` for the one it would have. */
async function setStatusColor($: Engine, status: string, color: string) {
  await savePrefs($, kept => {
    const colors = { ...kept.colors }
    if (isPaletteColor(color)) colors[status] = color
    else delete colors[status]
    return { ...kept, colors }
  })
}

async function toggleClosed($: Engine, status: string) {
  await savePrefs($, kept => {
    const now = closedOf(kept)
    const isClosed = now.some(one => one.toLowerCase() === status.toLowerCase())
    const next = isClosed ? now.filter(one => one.toLowerCase() !== status.toLowerCase()) : [...now, status]
    return { ...kept, closed: next }
  })
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

/** Saves a description or plan typed in the inline field. */
async function saveLong($: Engine, id: string, field: LongField, value: string) {
  const task = await read($, detail)
  const before = (field === 'description' ? task?.description : task?.implementationPlan) ?? ''
  if (value.trimEnd() === before.trimEnd()) {
    const t = await text($)
    await update($, notice, () => t.noChange)
    await update($, editing, () => null)
    return
  }
  await edit($, id, [field === 'description' ? args.setDescription(id, value) : args.setPlan(id, value)])
}

async function findEditor($: Engine): Promise<string[] | undefined> {
  const run = await backlog($, args.defaultEditor())
  return pickEditor({
    configured: run.ok ? run.stdout : undefined,
    visual: await $.env.get('VISUAL'),
    editor: await $.env.get('EDITOR'),
    os: await $.env.get('OS'),
  })
}

/**
 * Hands a description or plan to the person's own editor: writes it to a
 * temp file, runs the editor on it and waits for it to exit (so the editor
 * must block, as `code --wait` does), then reads it back and saves it.
 */
async function openInEditor($: Engine, id: string, field: LongField) {
  const t = await text($)
  const editor = await findEditor($)
  if (!editor) {
    await update($, notice, () => t.noEditor)
    return
  }
  const task = await read($, detail)
  const before = (field === 'description' ? task?.description : task?.implementationPlan) ?? ''
  const path = editorFile(
    {
      tmpdir: await $.env.get('TMPDIR'),
      temp: await $.env.get('TEMP'),
      tmp: await $.env.get('TMP'),
      userProfile: await $.env.get('USERPROFILE'),
      os: await $.env.get('OS'),
    },
    id,
    field,
  )
  let after: string
  try {
    await $.fs.write(path, before)
    await update($, notice, () => t.editorWaiting)
    const done = await $.process.run([...editor, path], { timeoutMs: EDITOR_TIMEOUT_MS })
    if (done.exitCode !== 0) {
      await update($, notice, () => t.editorFailed(errorLine(done.stderr, `exit code ${done.exitCode}`)))
      return
    }
    after = (await $.fs.read(path)).replace(/\r\n/g, '\n')
  } catch (error) {
    await update($, notice, () => t.editorFailed(String(error)))
    return
  }
  if (after.trimEnd() === before.trimEnd()) {
    await update($, notice, () => t.noChange)
    return
  }
  const value = after.replace(/\n+$/, '')
  await edit($, id, [field === 'description' ? args.setDescription(id, value) : args.setPlan(id, value)])
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

async function openStatuses($: Engine) {
  await update($, isManagingStatuses, () => true)
  await update($, isCreating, () => false)
  await update($, editing, () => null)
  await update($, notice, () => null)
  // Read them again: they may have changed since the watch started.
  await loadStatuses($)
}

async function closeStatuses($: Engine) {
  await update($, isManagingStatuses, () => false)
  await update($, editing, () => null)
  await update($, newStatusAt, () => null)
}

/** The config file Backlog.md reads, nearest first, as it looks for it. */
async function findConfig($: Engine): Promise<string | undefined> {
  for (const path of configCandidates(cwd)) {
    try {
      if (await $.fs.exists(path)) return path
    } catch {
      // A path the host will not look at: try the next.
    }
  }
  return undefined
}

/**
 * Writes `next` as the project's statuses. Backlog.md has no command for
 * it, so this rewrites only the `statuses` line of its config, then asks
 * `backlog config get statuses` and puts the file back as it was when
 * Backlog.md does not read exactly `next`. The one write outside the CLI.
 */
async function writeStatuses($: Engine, next: string[]): Promise<boolean> {
  const t = await text($)
  const path = await findConfig($)
  if (!path) {
    await update($, notice, () => t.configNotFound)
    return false
  }
  let before: string
  try {
    before = await $.fs.read(path)
  } catch (error) {
    await update($, notice, () => String(error))
    return false
  }
  const after = rewriteStatuses(before, next)
  if (after === undefined) {
    await update($, notice, () => t.configUnreadable)
    return false
  }
  try {
    await $.fs.write(path, after)
  } catch (error) {
    await update($, notice, () => String(error))
    return false
  }
  const run = await backlog($, args.statuses())
  if (!run.ok || !sameStatuses(parseStatuses(run.stdout), next)) {
    try {
      await $.fs.write(path, before)
    } catch {
      // Nothing more to do: the notice says the change did not take.
    }
    await update($, notice, () => t.configMismatch)
    return false
  }
  await update($, statuses, () => next)
  return true
}

/** Adds a status where the position picker says (by default, before the final one). */
async function addStatus($: Engine, name: string) {
  const t = await text($)
  const order = await read($, statuses)
  const position = (await read($, newStatusAt)) ?? Math.max(0, order.length - 1)
  const problem = statusProblem(name, order)
  if (problem) {
    await update($, notice, () => t.statusProblem[problem] ?? problem)
    return
  }
  const status = name.trim()
  const at = Math.max(0, Math.min(order.length, position))
  const next = [...order.slice(0, at), status, ...order.slice(at)]
  if (await writeStatuses($, next)) {
    await update($, notice, () => t.statusAdded(status))
    await update($, newStatusAt, () => null)
  }
}

/**
 * Deletes a status no task is in. One that tasks are in, the one new tasks
 * start in, and either of the last two are kept.
 */
async function removeStatus($: Engine, status: string) {
  const t = await text($)
  const order = await read($, statuses)
  const inUse = (await read($, tasks)).some(task => task.status === status)
  if (inUse || !order.includes(status)) return
  if (order.length <= 2) {
    await update($, notice, () => t.cannotRemoveLast)
    return
  }
  const fallback = await backlog($, args.defaultStatus())
  if (fallback.ok && fallback.stdout.trim().toLowerCase() === status.toLowerCase()) {
    await update($, notice, () => t.cannotRemoveDefault(status))
    return
  }
  if (await writeStatuses($, order.filter(one => one !== status))) {
    await update($, notice, () => t.statusRemoved(status))
    await update($, editing, () => null)
    // A status of the same name added later starts afresh.
    const kept = await read($, prefs)
    if (status in kept.colors || kept.closed?.includes(status)) {
      await savePrefs($, now => {
        const colors = { ...now.colors }
        delete colors[status]
        return now.closed ? { colors, closed: now.closed.filter(one => one !== status) } : { colors }
      })
    }
  }
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

/**
 * Starts a request to Claude about the task: `Update <ID>: ` in the prompt
 * box, the caret after it, never sent. An empty box is replaced; text
 * already there is kept and the request starts on a new line below it.
 */
async function editWithClaude($: Engine, id: string) {
  const t = await text($)
  const draft = t.editPrompt(id)
  const box = await $.prompt.read()
  const filled =
    box.text.trim() === ''
      ? await $.prompt.fill({ text: draft, mode: 'replace' })
      : await $.prompt.fill({ text: `\n${draft}`, mode: 'append' })
  await update($, notice, () => (filled.isFilled ? t.editReady(id) : t.draftRejected(draft)))
}

export const register: Register = (on, options) => {
  configured = typeof options.backlogPath === 'string' ? options.backlogPath : ''
  doneLimit = typeof options.doneLimit === 'number' ? options.doneLimit : 5
  closedOption = parseClosed(options.closedStatuses)
  languageOption = options.language
  language = null

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cwd = e.cwd
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
    const isBoardSurface = e.surface === 'terminal' || e.surface === 'desktop'
    const Client = isBoardSurface && 'Client' in ui ? ui.Client : undefined
    const t = await text($)
    const now = await read($, phase)
    const message = await read($, notice)

    const isMultiline = Input ? await hasMultiline($) : false
    const shownBody = (body: string | null) =>
      body?.trim() ? <Markdown text={body} /> : <Text dimColor>{t.none}</Text>
    // A description or plan, with a way to edit it where the surface has
    // fields: inline from 2.1.301, else in the person's editor.
    const section = (title: string, body: string | null, id: string, field: LongField, now: string | null) => {
      if (!Input) {
        return (
          <Box flexDirection="column">
            <Text bold>{title}</Text>
            {shownBody(body)}
          </Box>
        )
      }
      if (!isMultiline) {
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text bold>{title}</Text>
              <Button key={`editor-${field}`} plain dimColor label={t.openInEditor} onPress={() => openInEditor($, id, field)} />
            </Box>
            {shownBody(body)}
          </Box>
        )
      }
      if (now === field) {
        return (
          <Box flexDirection="column">
            <Text bold>{title}</Text>
            <Input
              key={`${field}-input`}
              rows={8}
              autoFocus
              value={body ?? ''}
              submitLabel={t.save}
              onSubmit={value => saveLong($, id, field, value)}
            />
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{t.multilineHint}</Text>
              <Button key={`${field}-cancel`} label={t.cancel} onPress={() => update($, editing, () => null)} />
            </Box>
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text bold>{title}</Text>
            <Button key={`edit-${field}`} plain dimColor label={t.edit} onPress={() => update($, editing, () => field)} />
          </Box>
          {shownBody(body)}
        </Box>
      )
    }
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
    const kept = await read($, prefs)
    const closed = closedOf(kept)

    if (await read($, isManagingStatuses)) {
      const all = await read($, tasks)
      const now = await read($, editing)
      const shown = groupTasks(all, order, 0, closed, kept.colors)
      const final = order[order.length - 1]
      const at = (await read($, newStatusAt)) ?? Math.max(0, order.length - 1)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            <Button key="statuses-back" plain label={t.back} onPress={() => closeStatuses($)} />
            <Text bold>{t.statusesTitle}</Text>
          </Box>
          {footer}
          <Box flexDirection="column">
            {order.map((status, i) => {
              const count = all.filter(task => task.status === status).length
              const group = shown.find(one => one.status === status)
              // Closed shows on its checkbox.
              const tags = status === final ? [t.finalTag] : []
              if (now === `remove-status:${status}`) {
                return (
                  <Box flexDirection="row" flexWrap="wrap" gap={1}>
                    <Text>{t.confirmRemoveStatus(status)}</Text>
                    <Button
                      key={`status-remove-yes-${i}`}
                      variant="primary"
                      label={t.remove}
                      onPress={() => removeStatus($, status)}
                    />
                    <Button key="status-remove-no" label={t.keep} onPress={() => update($, editing, () => null)} />
                  </Box>
                )
              }
              const picked = kept.colors[status]
              const colourOptions = [
                { value: 'auto', label: t.autoColour },
                ...PALETTE.map(key => ({ value: key, label: t.colourNames[key] ?? key })),
              ]
              const shownColour = isPaletteColor(picked) ? picked : 'auto'
              const nextColour = () => {
                const at = colourOptions.findIndex(option => option.value === shownColour)
                return colourOptions[(at + 1) % colourOptions.length]?.value ?? 'auto'
              }
              return (
                <Box flexDirection="row" flexWrap="wrap" gap={1}>
                  <Text color={group?.color}>■</Text>
                  <Text bold={!group?.isClosed} dimColor={group?.isClosed}>
                    {status}
                  </Text>
                  <Text dimColor>
                    {t.taskCount(count)}
                    {tags.length > 0 ? ` · ${tags.join(' · ')}` : ''}
                  </Text>
                  {Select ? (
                    <Select
                      key={`status-colour-${i}`}
                      label={t.colour}
                      value={shownColour}
                      options={colourOptions}
                      onSelect={value => setStatusColor($, status, value)}
                    />
                  ) : (
                    <Button
                      key={`status-colour-${i}`}
                      plain
                      label={`${t.colour}: ${colourOptions.find(option => option.value === shownColour)?.label ?? ''}`}
                      onPress={() => setStatusColor($, status, nextColour())}
                    />
                  )}
                  {status !== final ? (
                    <Button
                      key={`status-closed-${i}`}
                      plain
                      label={`${group?.isClosed ? '[x]' : '[ ]'} ${t.closedCheck}`}
                      onPress={() => toggleClosed($, status)}
                    />
                  ) : null}
                  {count === 0 ? (
                    <Button
                      key={`status-remove-${i}`}
                      plain
                      dimColor
                      label={t.remove}
                      onPress={() => update($, editing, () => `remove-status:${status}`)}
                    />
                  ) : null}
                </Box>
              )
            })}
          </Box>
          {Input && Select ? (
            <Box flexDirection="column">
              <Select
                key="status-position"
                label={t.position}
                value={String(at)}
                options={[
                  { value: '0', label: t.atStart },
                  ...order.map((status, i) => ({ value: String(i + 1), label: t.after(status) })),
                ]}
                onSelect={value => update($, newStatusAt, () => Number(value))}
              />
              <Input
                key="status-new"
                placeholder={t.newStatus}
                submitLabel={t.add}
                value=""
                onSubmit={value => addStatus($, value)}
              />
            </Box>
          ) : null}
          <Text dimColor>{t.closedHint}</Text>
          <Text dimColor>{t.statusesNote}</Text>
        </Box>
      )
    }

    if (id) {
      const task = await read($, detail)
      const summary = (await read($, tasks)).find(one => one.id === id)
      const status = task?.status ?? summary?.status ?? ''
      const choices = order.includes(status) || !status ? order : [...order, status]
      const color = groupTasks([], choices, 0, closed, kept.colors).find(group => group.status === status)?.color
      const title = task?.title ?? summary?.title ?? id
      const priority = task?.priority ?? summary?.priority ?? null
      const isHigh = isHighPriority(priority)
      const around = neighbours(choices, status, closed)
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
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button key="work" variant="primary" label={t.work} onPress={() => work($, id)} />
            <Button key="edit-with-claude" label={t.editWithClaude} onPress={() => editWithClaude($, id)} />
          </Box>
          {footer}
          {!task ? <Text dimColor>{t.loadingDetails}</Text> : null}
          {task ? section(t.description, task.description, id, 'description', now) : null}
          {criteria}
          {task ? section(t.plan, task.implementationPlan, id, 'plan', now) : null}
          {task && Input && !isMultiline ? <Markdown text={t.editorHint} /> : null}
        </Box>
      )
    }

    const list = await read($, tasks)
    const unfolded = await read($, openGroups)
    const groups = groupTasks(list, order, doneLimit, closed, kept.colors)
    const creating = await read($, isCreating)
    const hasBoard = list.length > 0 && Client !== undefined && !(await read($, isBoardFailed))
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
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {Input && !creating ? (
            <Button key="new-task-open" label={t.newTask} onPress={() => update($, isCreating, () => true)} />
          ) : null}
          <Button key="statuses-open" label={t.manageStatuses} onPress={() => openStatuses($)} />
        </Box>
        {footer}
        {list.length === 0 ? <Text dimColor>{t.noTasks}</Text> : null}
        {hasBoard && Client ? (
          <Client key="board" module="./board.tsx" width="100%" props={board(groups, e.props.bodyColumns, t)} />
        ) : null}
        {hasBoard
          ? null
          : groups.map(group => {
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
              if (group.isFinal || group.isClosed) {
                const isOpen = unfolded.includes(group.status)
                const toggle = () =>
                  update($, openGroups, now =>
                    now.includes(group.status) ? now.filter(one => one !== group.status) : [...now, group.status],
                  )
                return (
                  <Box key={`group:${group.status}`} flexDirection="column">
                    <Button key={`toggle:${group.status}`} plain dimColor={group.isClosed} onPress={toggle}>
                      {isOpen ? '▾' : '▸'} <Text color={group.color}>{group.status}</Text>{' '}
                      <Text dimColor>({group.total})</Text>
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
      isClosed: group.isClosed,
      cards: group.tasks.map(task => ({
        id: task.id,
        title: task.title,
        isHigh: isHighPriority(task.priority),
        criteria:
          task.acceptanceCriteriaCount > 0
            ? `${task.acceptanceCriteriaCompleted}/${task.acceptanceCriteriaCount}`
            : null,
      })),
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
