// Every string the mod shows, in English and Spanish, and how the language
// is chosen. Nothing here touches `$`: register.tsx reads the sources and
// hands them to `detectLanguage`.

export type Language = 'en' | 'es'

/** What the `language` option holds: a language, or `auto` to detect one. */
export type LanguageOption = 'auto' | Language

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

const en = {
  paneTitle: 'Backlog',
  commandDescription: 'Open the Backlog.md board in a side pane',
  opened: 'Backlog pane opened.',
  waitingForRoom: (reason: string) => `Backlog pane is waiting for room (${reason}).`,
  cliMissingText: 'Backlog.md CLI not found. Install it with `npm i -g backlog.md`.',
  noProjectText: 'No Backlog.md project here. Run `backlog init` first.',
  listFailed: 'backlog task list failed.',
  cliNotFound: 'The backlog CLI was not found.',
  watchStopping: 'backlog task list --watch kept stopping.',

  summaryEmpty: 'Backlog: no tasks yet. Create one with `backlog task create "Title"`.',
  summaryCount: (n: number) => `Backlog: ${n} ${plural(n, 'task', 'tasks')}`,
  summaryMore: (n: number) => `… ${n} more`,

  notInstalledTitle: 'Backlog.md CLI not found',
  notInstalledHelp:
    'Install it with `npm i -g backlog.md` (or `bun add -g backlog.md`, `brew install backlog-md`), then press Retry. You can also set the full path in the plugin option **backlogPath**.',
  notInitializedTitle: 'No Backlog.md project in this folder',
  notInitializedHelp: 'Run `backlog init` in the project root, then press Retry.',
  failedTitle: 'The live task list stopped',
  retry: 'Retry',
  loadingTasks: 'Loading tasks…',
  loadingDetails: 'Loading details…',
  noTasks: 'No tasks yet.',
  mostRecent: (shown: number, total: number) => `The ${shown} most recent of ${total}.`,
  boardHint: 'Drag a card to another column, or click it and press ←/→ to move it, ↑/↓ to pick another, Enter to open it.',
  highPriority: 'high priority',

  newTask: '+ New task',
  newTaskPlaceholder: 'New task title',
  create: 'Create',
  cancel: 'Cancel',
  created: (id: string) => `Created ${id}.`,
  theTask: 'the task',
  couldNotCreate: 'Could not create the task.',

  back: '← Back',
  title: 'Title',
  save: 'Save',
  status: 'Status',
  priority: 'Priority',
  noPriority: 'None',
  priorityName: { high: 'High', medium: 'Medium', low: 'Low' } as Record<string, string>,
  moved: (id: string, status: string) => `Moved ${id} to ${status}.`,
  couldNotMove: (id: string) => `Could not move ${id}.`,
  couldNotRead: (id: string) => `Could not read ${id}.`,
  updated: (id: string) => `Updated ${id}.`,
  couldNotUpdate: (id: string) => `Could not update ${id}.`,
  noChange: 'Nothing changed.',

  work: 'Work on this task',
  editWithClaude: 'Edit with Claude',
  workPrompt: (id: string) =>
    `Work on ${id} only. Research the codebase and write an implementation plan in the task. Wait for my approval before coding.`,
  editPrompt: (id: string) => `Update ${id}: `,
  draftReady: (id: string) => `Draft for ${id} is in the prompt box. Review it, then press Enter to send.`,
  editReady: (id: string) => `"Update ${id}" is in the prompt box. Say what to change, then press Enter.`,
  draftRejected: (text: string) => `The prompt box did not take the draft. Copy it instead: ${text}`,

  description: 'Description',
  plan: 'Implementation plan',
  criteria: 'Acceptance criteria',
  none: 'None.',
  edit: 'Edit',
  remove: 'Delete',
  confirmRemove: (index: number) => `Delete criterion ${index}?`,
  keep: 'Keep',
  newCriterion: 'New criterion',
  add: 'Add',
  multilineHint: 'Enter saves. Shift+Enter (or \\ then Enter) starts a new line.',
  openInEditor: 'Open in editor',
  editorHint:
    'Opens the text in your editor (`backlog config get defaultEditor`, else VISUAL or EDITOR). The editor must stay open until you close the file, for example `code --wait`.',
  editorWaiting: 'Waiting for the editor. Save and close the file to apply the change.',
  noEditor: 'No editor is set. Run `backlog config set defaultEditor "code --wait"`, or set VISUAL or EDITOR.',
  editorFailed: (detail: string) => `The editor did not finish: ${detail}`,
}

export type Strings = typeof en

const es: Strings = {
  paneTitle: 'Backlog',
  commandDescription: 'Abre el tablero de Backlog.md en un panel lateral',
  opened: 'Panel de Backlog abierto.',
  waitingForRoom: reason => `El panel de Backlog espera a tener sitio (${reason}).`,
  cliMissingText: 'No se encontró la CLI de Backlog.md. Instálala con `npm i -g backlog.md`.',
  noProjectText: 'Aquí no hay ningún proyecto de Backlog.md. Ejecuta antes `backlog init`.',
  listFailed: 'Falló backlog task list.',
  cliNotFound: 'No se encontró la CLI de backlog.',
  watchStopping: 'backlog task list --watch se detenía una y otra vez.',

  summaryEmpty: 'Backlog: todavía no hay tareas. Crea una con `backlog task create "Título"`.',
  summaryCount: n => `Backlog: ${n} ${plural(n, 'tarea', 'tareas')}`,
  summaryMore: n => `… ${n} más`,

  notInstalledTitle: 'No se encontró la CLI de Backlog.md',
  notInstalledHelp:
    'Instálala con `npm i -g backlog.md` (o `bun add -g backlog.md`, `brew install backlog-md`) y pulsa Reintentar. También puedes indicar la ruta completa en la opción **backlogPath** del plugin.',
  notInitializedTitle: 'No hay ningún proyecto de Backlog.md en esta carpeta',
  notInitializedHelp: 'Ejecuta `backlog init` en la raíz del proyecto y pulsa Reintentar.',
  failedTitle: 'La lista de tareas en vivo se detuvo',
  retry: 'Reintentar',
  loadingTasks: 'Cargando tareas…',
  loadingDetails: 'Cargando detalles…',
  noTasks: 'Todavía no hay tareas.',
  mostRecent: (shown, total) => `Las ${shown} más recientes de ${total}.`,
  boardHint:
    'Arrastra una tarjeta a otra columna, o haz clic en ella y pulsa ←/→ para moverla, ↑/↓ para elegir otra, Enter para abrirla.',
  highPriority: 'prioridad alta',

  newTask: '+ Nueva tarea',
  newTaskPlaceholder: 'Título de la nueva tarea',
  create: 'Crear',
  cancel: 'Cancelar',
  created: id => `Creada ${id}.`,
  theTask: 'la tarea',
  couldNotCreate: 'No se pudo crear la tarea.',

  back: '← Volver',
  title: 'Título',
  save: 'Guardar',
  status: 'Estado',
  priority: 'Prioridad',
  noPriority: 'Ninguna',
  priorityName: { high: 'Alta', medium: 'Media', low: 'Baja' },
  moved: (id, status) => `${id} movida a ${status}.`,
  couldNotMove: id => `No se pudo mover ${id}.`,
  couldNotRead: id => `No se pudo leer ${id}.`,
  updated: id => `${id} actualizada.`,
  couldNotUpdate: id => `No se pudo actualizar ${id}.`,
  noChange: 'No ha cambiado nada.',

  work: 'Trabajar en esta tarea',
  editWithClaude: 'Editar con Claude',
  workPrompt: id =>
    `Trabaja solo en ${id}. Investiga el código y escribe un plan de implementación en la tarea. Espera mi aprobación antes de programar.`,
  editPrompt: id => `Actualiza ${id}: `,
  draftReady: id => `El borrador para ${id} está en el cuadro del prompt. Revísalo y pulsa Enter para enviarlo.`,
  editReady: id => `"Actualiza ${id}" está en el cuadro del prompt. Di qué cambiar y pulsa Enter.`,
  draftRejected: text => `El cuadro del prompt no aceptó el borrador. Cópialo: ${text}`,

  description: 'Descripción',
  plan: 'Plan de implementación',
  criteria: 'Criterios de aceptación',
  none: 'Ninguno.',
  edit: 'Editar',
  remove: 'Eliminar',
  confirmRemove: index => `¿Eliminar el criterio ${index}?`,
  keep: 'Conservar',
  newCriterion: 'Nuevo criterio',
  add: 'Añadir',
  multilineHint: 'Enter guarda. Mayús+Enter (o \\ y luego Enter) empieza una línea nueva.',
  openInEditor: 'Abrir en el editor',
  editorHint:
    'Abre el texto en tu editor (`backlog config get defaultEditor`, si no VISUAL o EDITOR). El editor debe quedarse abierto hasta que cierres el archivo, por ejemplo `code --wait`.',
  editorWaiting: 'Esperando al editor. Guarda y cierra el archivo para aplicar el cambio.',
  noEditor: 'No hay ningún editor configurado. Ejecuta `backlog config set defaultEditor "code --wait"`, o define VISUAL o EDITOR.',
  editorFailed: detail => `El editor no terminó: ${detail}`,
}

const tables: Record<Language, Strings> = { en, es }

export function strings(language: Language): Strings {
  return tables[language]
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

/**
 * Claude Code's `language` setting is free text ("Español", "Spanish",
 * "English", "es"). Any language other than Spanish is shown in English.
 */
export function languageFromSetting(value: unknown): Language | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const text = fold(value)
  return /^es\b|^es[-_]|spanish|espanol|castellano/.test(text) ? 'es' : 'en'
}

/** A POSIX or BCP 47 locale (`es_ES.UTF-8`, `es-MX`); `C` and `POSIX` say nothing. */
export function languageFromLocale(value: string | undefined): Language | undefined {
  if (!value) return undefined
  const code = value.trim().split(/[_.@-]/)[0]?.toLowerCase() ?? ''
  if (code === '' || code === 'c' || code === 'posix') return undefined
  return code === 'es' ? 'es' : 'en'
}

/**
 * The language to show: the option when it names one; for `auto`, the first
 * source that says anything, in this order: Claude Code's `language` setting,
 * `LC_ALL`, `LC_MESSAGES`, `LANG`, the runtime's Intl locale; else English.
 */
export function detectLanguage(sources: {
  option?: unknown
  setting?: unknown
  lcAll?: string
  lcMessages?: string
  lang?: string
  intl?: string
}): Language {
  if (sources.option === 'en' || sources.option === 'es') return sources.option
  return (
    languageFromSetting(sources.setting) ??
    languageFromLocale(sources.lcAll) ??
    languageFromLocale(sources.lcMessages) ??
    languageFromLocale(sources.lang) ??
    languageFromLocale(sources.intl) ??
    'en'
  )
}
