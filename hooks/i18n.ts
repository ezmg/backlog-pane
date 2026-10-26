// Every string the mod shows, in English and Spanish, and how the language
// is chosen. Nothing here touches `$`: register.tsx reads the sources and
// hands them to `detectLanguage`.

export type Language = 'en' | 'es'

/** What the `language` option holds: a language, or `auto` to detect one. */
export type LanguageOption = 'auto' | Language

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)


/** What Jira changes in the integration's words, over Redmine's. */
const enJira = {
  redmineUrl: 'Jira URL',
  urlPlaceholder: 'https://your-company.atlassian.net',
  redmineProject: 'Project key',
  projectPlaceholder: 'as in its issue keys, e.g. APP',
  badProject: 'Type the project’s key, as in its issue keys (APP-12 → APP).',
  modeRead: 'Read only (Jira → Backlog.md)',
  apiKeySet: 'API token: set.',
  apiKeyMissing:
    'API token: missing. Set “Jira API token” in the plugin’s settings (/plugin, or /config), and for Jira Cloud also “Jira email”: Claude Code keeps the token in secure storage.',
  statusMapping: 'Jira status → Backlog.md status',
  priorityMapping: 'Jira priority → Backlog.md priority',
  excludedNote: (n: number) =>
    `${n} ${plural(n, 'task', 'tasks')} that existed before the sync ${plural(n, 'is', 'are')} not sent to Jira.`,
  inRedmine: 'Jira',
  useRemote: 'Use Jira’s',
  syncDone: (n: { fromRemote: number; toRemote: number; conflicts: number }) =>
    `Jira: ${n.fromRemote} from Jira, ${n.toRemote} to Jira, ${n.conflicts} ${plural(n.conflicts, 'conflict', 'conflicts')}.`,
  unauthorized: 'Jira refused the email or the API token (401). Check them in the plugin’s settings.',
  forbidden: 'Jira says this token may not do that (403).',
  noProject: (project: string) => `Jira has no project “${project}” (404), or this token cannot see it.`,
  unreachable: (detail: string) => `Could not reach Jira: ${detail}`,
  unexpected: (detail: string) => `Jira answered something unexpected: ${detail}`,
  statusNotSent: (task: string, status: string) => `${task}: no Jira status maps to “${status}”, so its status was not sent.`,
  priorityNotSent: (task: string, priority: string) =>
    `${task}: no Jira priority maps to “${priority}”, so its priority was not sent.`,
  noMe: (task: string) => `${task} was not sent: Jira did not say who owns the API token, to assign it to.`,
  refused: (issue: string, why: string) => `Jira refused the change to ${issue}: ${why}`,
  syncNote:
    'Issues are copied into Backlog.md as tasks (with the issue’s URL in their references) and kept in step field by field: title, status, priority and description. Read only never writes to Jira. Nothing is ever deleted on either side.',
}

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

  manageStatuses: 'Statuses…',
  statusesTitle: 'Statuses',
  taskCount: (n: number) => (n === 0 ? 'no tasks' : `${n} ${plural(n, 'task', 'tasks')}`),
  finalTag: 'final',
  closedTag: 'closed',
  defaultTag: 'new tasks start here',
  newStatus: 'New status name',
  position: 'Position',
  atStart: 'At the start',
  after: (status: string) => `After ${status}`,
  statusAdded: (status: string) => `Added the status ${status}.`,
  statusRemoved: (status: string) => `Deleted the status ${status}.`,
  confirmRemoveStatus: (status: string) => `Delete the status ${status}?`,
  statusProblem: {
    empty: 'Type a name for the status.',
    comma: 'A status name cannot hold a comma, a quote or a line break.',
    duplicate: 'There is already a status with that name.',
    'too-long': 'A status name can be 40 characters at most.',
  } as Record<string, string>,
  cannotRemoveDefault: (status: string) =>
    `${status} is the status new tasks start in. Change it first with \`backlog config set defaultStatus <status>\`.`,
  cannotRemoveLast: 'A project needs at least two statuses.',
  configNotFound: 'Could not find the Backlog.md config (backlog/config.yml).',
  configUnreadable: 'The config has no statuses line the pane can rewrite. Edit it by hand.',
  configMismatch: 'Backlog.md did not read the new statuses, so the config was put back as it was.',
  statusesNote:
    'Backlog.md has no command to change statuses, so the pane rewrites only the statuses line of its config and then checks that Backlog.md reads it. Task counts leave out drafts and archived tasks.',
  closedHint: 'A closed status is folded and dim, and ◀/▶ and the board’s arrow keys skip it. Colours and closed statuses are kept for this project only.',
  colour: 'Colour',
  closedCheck: 'Closed',
  autoColour: 'Automatic',
  colourNames: {
    suggestion: 'Blue',
    ide: 'Steel blue',
    planMode: 'Teal',
    success: 'Green',
    warning: 'Amber',
    claude: 'Orange',
    error: 'Red',
    merged: 'Purple',
    permission: 'Lavender',
    inactive: 'Grey',
  } as Record<string, string>,

  integration: 'Integration…',
  integrationTitle: 'Integration',
  tracker: 'Tracker',
  noTracker: 'None',
  trackerRedmine: 'Redmine (API)',
  trackerCsv: 'Excel / CSV (Redmine export)',
  csvFile: 'CSV file',
  csvPlaceholder: 'C:\\Users\\you\\Downloads\\issues.csv',
  csvUrl: 'Redmine URL (optional, to link the tasks)',
  csvHow:
    'In Redmine: Issues, filter them (for example Assignee: “me”), then CSV at the bottom, tick Description, and Export. Save it over the same file each time, then press Sync now.',
  csvNote:
    'The file’s issues are copied into Backlog.md as tasks and kept in step field by field: title, status, priority and description. Nothing is ever written to the file or to Redmine, and nothing is deleted. A field changed both in the file and in Backlog.md is a conflict you settle.',
  badFile: 'Type the path of the CSV file Redmine exported.',
  fileUnreadable: (path: string, why: string) => `Could not read ${path}: ${why}`,
  csvColumns: (headers: string) =>
    `This is not an issue export from Redmine: it has no “#” and “Subject” columns${headers ? ` (it has: ${headers})` : ''}.`,
  csvMissing: (fields: string) => `The file has no column for: ${fields}. Those are left alone.`,
  csvDone: (rows: number, changed: number, conflicts: number) =>
    `CSV: ${rows} ${plural(rows, 'issue', 'issues')} read, ${changed} ${plural(changed, 'task', 'tasks')} created or updated, ${conflicts} ${plural(conflicts, 'conflict', 'conflicts')}.`,
  inFile: 'The file',
  useFile: 'Use the file’s',
  redmineUrl: 'Redmine URL',
  urlPlaceholder: 'https://redmine.example.com',
  redmineProject: 'Project identifier',
  projectPlaceholder: 'as in the project’s URL, e.g. my-app',
  mode: 'Mode',
  modeRead: 'Read only (Redmine → Backlog.md)',
  modeBoth: 'Both ways',
  scope: 'Issues',
  scopeAll: 'All of the project',
  scopeMine: 'Only those assigned to me',
  mineShort: 'only mine',
  viewAll: 'View: all',
  viewMine: (n: number) => `View: only mine${n > 0 ? ` (${n} hidden)` : ''}`,
  allHidden: 'No task of yours here. Press “View: only mine” to see them all.',
  every: 'Sync',
  manualOnly: 'Only with the button',
  everyMinutes: (n: number) => `Every ${n} min`,
  apiKeySet: 'API key: set.',
  apiKeyMissing:
    'API key: missing. Set “Redmine API key” in the plugin’s settings (/plugin, or /config): Claude Code keeps it in secure storage.',
  syncNow: 'Sync now',
  syncing: 'Syncing…',
  disconnect: 'Disconnect',
  disconnected: 'Disconnected. The tasks stay in Backlog.md; nothing was deleted.',
  lastSync: (time: string) => `Last sync: ${time}`,
  notSynced: 'Not synced yet.',
  statusMapping: 'Redmine status → Backlog.md status',
  priorityMapping: 'Redmine priority → Backlog.md priority',
  leaveAlone: '— (left alone)',
  mappingLater: 'The status and priority mappings show after the first sync.',
  excludedNote: (n: number) =>
    `${n} ${plural(n, 'task', 'tasks')} that existed before the sync ${plural(n, 'is', 'are')} not sent to Redmine.`,
  includeOld: 'Send them too',
  conflictsTitle: 'Conflicts',
  conflictLine: (task: string, field: string) => `${task}: the ${field} changed on both sides.`,
  inRedmine: 'Redmine',
  inBacklog: 'Backlog.md',
  useRemote: 'Use Redmine’s',
  useLocal: 'Use Backlog.md’s',
  fieldNames: { title: 'title', status: 'status', priority: 'priority', description: 'description' } as Record<
    string,
    string
  >,
  empty: '(empty)',
  syncDone: (n: { fromRemote: number; toRemote: number; conflicts: number }) =>
    `Redmine: ${n.fromRemote} from Redmine, ${n.toRemote} to Redmine, ${n.conflicts} ${plural(n.conflicts, 'conflict', 'conflicts')}.`,
  syncLine: (tracker: string, mode: string, time: string | null, conflicts: number) =>
    `${tracker} · ${mode}${time ? ` · ${time}` : ''}${conflicts > 0 ? ` · ${conflicts} ${plural(conflicts, 'conflict', 'conflicts')}` : ''}`,
  readOnlyShort: 'read only',
  bothShort: 'both ways',
  badUrl: 'Type the server’s URL, starting with https:// (or http://).',
  badProject: 'Type the project’s identifier, as in its URL.',
  unauthorized: 'Redmine refused the API key (401). Check it in the plugin’s settings.',
  forbidden: 'Redmine says this key may not do that (403).',
  noProject: (project: string) => `Redmine has no project “${project}” (404), or this key cannot see it.`,
  unreachable: (detail: string) => `Could not reach Redmine: ${detail}`,
  unexpected: (detail: string) => `Redmine answered something unexpected: ${detail}`,
  statusNotSent: (task: string, status: string) => `${task}: no Redmine status maps to “${status}”, so its status was not sent.`,
  priorityNotSent: (task: string, priority: string) =>
    `${task}: no Redmine priority maps to “${priority}”, so its priority was not sent.`,
  noMe: (task: string) => `${task} was not sent: Redmine did not say who owns the API key, to assign it to.`,
  refused: (issue: string, why: string) => `Redmine refused the change to #${issue}: ${why}`,
  localFailed: (task: string, why: string) => `${task} could not be updated: ${why}`,
  syncNote:
    'Issues are copied into Backlog.md as tasks (with the issue’s URL in their references) and kept in step field by field: title, status, priority and description. Read only never writes to Redmine. Nothing is ever deleted on either side.',
  trackerJira: 'Jira (API)',
  textFormat: 'Text format in Redmine',
  structure: 'Types and parents',
  structureOn: 'Type as a label; new tasks under their parent',
  structureOff: 'Leave them out',
  issueType: 'Issue type for new tasks',
  issueTypeAuto: 'Task, or the first',
  noTransition: (task: string, status: string) =>
    `${task}: its Jira workflow has no transition to “${status}” from where the issue is, so its status was not sent.`,
  emailMissing: 'Jira Cloud needs your account’s email too: set “Jira email” in the plugin’s settings.',
  jira: enJira,
}

export type Strings = typeof en

/** The strings for a tracker: Jira's words over Redmine's where they differ. */
export const wordsFor = (t: Strings, provider: string | undefined): Strings => (provider === 'jira' ? { ...t, ...t.jira } : t)

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

  manageStatuses: 'Estados…',
  statusesTitle: 'Estados',
  taskCount: n => (n === 0 ? 'sin tareas' : `${n} ${plural(n, 'tarea', 'tareas')}`),
  finalTag: 'final',
  closedTag: 'cerrado',
  defaultTag: 'las tareas nuevas empiezan aquí',
  newStatus: 'Nombre del nuevo estado',
  position: 'Posición',
  atStart: 'Al principio',
  after: status => `Después de ${status}`,
  statusAdded: status => `Estado ${status} añadido.`,
  statusRemoved: status => `Estado ${status} eliminado.`,
  confirmRemoveStatus: status => `¿Eliminar el estado ${status}?`,
  statusProblem: {
    empty: 'Escribe un nombre para el estado.',
    comma: 'El nombre de un estado no puede tener comas, comillas ni saltos de línea.',
    duplicate: 'Ya hay un estado con ese nombre.',
    'too-long': 'El nombre de un estado puede tener 40 caracteres como máximo.',
  },
  cannotRemoveDefault: status =>
    `${status} es el estado en el que empiezan las tareas nuevas. Cámbialo antes con \`backlog config set defaultStatus <estado>\`.`,
  cannotRemoveLast: 'Un proyecto necesita al menos dos estados.',
  configNotFound: 'No se encontró la configuración de Backlog.md (backlog/config.yml).',
  configUnreadable: 'La configuración no tiene una línea de estados que el panel pueda reescribir. Edítala a mano.',
  configMismatch: 'Backlog.md no leyó los estados nuevos, así que la configuración se dejó como estaba.',
  statusesNote:
    'Backlog.md no tiene un comando para cambiar los estados, así que el panel reescribe solo la línea de estados de su configuración y después comprueba que Backlog.md la lee. Los recuentos no incluyen borradores ni tareas archivadas.',
  closedHint: 'Un estado cerrado sale plegado y atenuado, y ◀/▶ y las flechas del tablero se lo saltan. Los colores y los estados cerrados se guardan solo para este proyecto.',
  colour: 'Color',
  closedCheck: 'Cerrado',
  autoColour: 'Automático',
  colourNames: {
    suggestion: 'Azul',
    ide: 'Azul acero',
    planMode: 'Verde azulado',
    success: 'Verde',
    warning: 'Ámbar',
    claude: 'Naranja',
    error: 'Rojo',
    merged: 'Morado',
    permission: 'Lavanda',
    inactive: 'Gris',
  },

  integration: 'Integración…',
  integrationTitle: 'Integración',
  tracker: 'Gestor',
  noTracker: 'Ninguno',
  trackerRedmine: 'Redmine (API)',
  trackerCsv: 'Excel / CSV (exportación de Redmine)',
  csvFile: 'Archivo CSV',
  csvPlaceholder: 'C:\\Users\\tú\\Downloads\\issues.csv',
  csvUrl: 'URL de Redmine (opcional, para enlazar las tareas)',
  csvHow:
    'En Redmine: Peticiones, fíltralas (por ejemplo Asignado a: «yo»), luego CSV abajo, marca Descripción y Exportar. Guárdalo siempre sobre el mismo archivo y pulsa Sincronizar ahora.',
  csvNote:
    'Las peticiones del archivo se copian en Backlog.md como tareas y se mantienen al día campo a campo: título, estado, prioridad y descripción. Nunca se escribe nada en el archivo ni en Redmine, y nunca se borra nada. Un campo cambiado en el archivo y en Backlog.md es un conflicto que resuelves tú.',
  badFile: 'Escribe la ruta del archivo CSV que exportó Redmine.',
  fileUnreadable: (path, why) => `No se pudo leer ${path}: ${why}`,
  csvColumns: headers =>
    `Esto no es una exportación de peticiones de Redmine: no tiene las columnas «#» y «Asunto»${headers ? ` (tiene: ${headers})` : ''}.`,
  csvMissing: fields => `El archivo no tiene columna para: ${fields}. Eso no se toca.`,
  csvDone: (rows, changed, conflicts) =>
    `CSV: ${rows} ${plural(rows, 'petición leída', 'peticiones leídas')}, ${changed} ${plural(changed, 'tarea creada o actualizada', 'tareas creadas o actualizadas')}, ${conflicts} ${plural(conflicts, 'conflicto', 'conflictos')}.`,
  inFile: 'El archivo',
  useFile: 'Usar el del archivo',
  redmineUrl: 'URL de Redmine',
  urlPlaceholder: 'https://redmine.ejemplo.com',
  redmineProject: 'Identificador del proyecto',
  projectPlaceholder: 'como en la URL del proyecto, p. ej. mi-app',
  mode: 'Modo',
  modeRead: 'Solo lectura (Redmine → Backlog.md)',
  modeBoth: 'Bidireccional',
  scope: 'Peticiones',
  scopeAll: 'Todas las del proyecto',
  scopeMine: 'Solo las asignadas a mí',
  mineShort: 'solo mías',
  viewAll: 'Ver: todas',
  viewMine: n => `Ver: solo mías${n > 0 ? ` (${n} ocultas)` : ''}`,
  allHidden: 'Aquí no hay tareas tuyas. Pulsa «Ver: solo mías» para verlas todas.',
  every: 'Sincronizar',
  manualOnly: 'Solo con el botón',
  everyMinutes: n => `Cada ${n} min`,
  apiKeySet: 'Clave de API: configurada.',
  apiKeyMissing:
    'Clave de API: falta. Ponla en «Redmine API key» en los ajustes del plugin (/plugin, o /config): Claude Code la guarda en el almacén seguro.',
  syncNow: 'Sincronizar ahora',
  syncing: 'Sincronizando…',
  disconnect: 'Desconectar',
  disconnected: 'Desconectado. Las tareas siguen en Backlog.md; no se ha borrado nada.',
  lastSync: time => `Última sincronización: ${time}`,
  notSynced: 'Aún no se ha sincronizado.',
  statusMapping: 'Estado de Redmine → estado de Backlog.md',
  priorityMapping: 'Prioridad de Redmine → prioridad de Backlog.md',
  leaveAlone: '— (sin tocar)',
  mappingLater: 'La correspondencia de estados y prioridades aparece tras la primera sincronización.',
  excludedNote: n =>
    `${n} ${plural(n, 'tarea que ya existía', 'tareas que ya existían')} antes de la sincronización no se ${plural(n, 'envía', 'envían')} a Redmine.`,
  includeOld: 'Enviarlas también',
  conflictsTitle: 'Conflictos',
  conflictLine: (task, field) => `${task}: ${field === 'prioridad' || field === 'descripción' ? 'la' : 'el'} ${field} cambió en los dos lados.`,
  inRedmine: 'Redmine',
  inBacklog: 'Backlog.md',
  useRemote: 'Usar el de Redmine',
  useLocal: 'Usar el de Backlog.md',
  fieldNames: { title: 'título', status: 'estado', priority: 'prioridad', description: 'descripción' },
  empty: '(vacío)',
  syncDone: n =>
    `Redmine: ${n.fromRemote} desde Redmine, ${n.toRemote} hacia Redmine, ${n.conflicts} ${plural(n.conflicts, 'conflicto', 'conflictos')}.`,
  syncLine: (tracker, mode, time, conflicts) =>
    `${tracker} · ${mode}${time ? ` · ${time}` : ''}${conflicts > 0 ? ` · ${conflicts} ${plural(conflicts, 'conflicto', 'conflictos')}` : ''}`,
  readOnlyShort: 'solo lectura',
  bothShort: 'bidireccional',
  badUrl: 'Escribe la URL del servidor, empezando por https:// (o http://).',
  badProject: 'Escribe el identificador del proyecto, como aparece en su URL.',
  unauthorized: 'Redmine rechazó la clave de API (401). Revísala en los ajustes del plugin.',
  forbidden: 'Redmine dice que esta clave no puede hacer eso (403).',
  noProject: project => `Redmine no tiene el proyecto «${project}» (404), o esta clave no puede verlo.`,
  unreachable: detail => `No se pudo conectar con Redmine: ${detail}`,
  unexpected: detail => `Redmine respondió algo inesperado: ${detail}`,
  statusNotSent: (task, status) => `${task}: ningún estado de Redmine corresponde a «${status}», así que su estado no se envió.`,
  priorityNotSent: (task, priority) =>
    `${task}: ninguna prioridad de Redmine corresponde a «${priority}», así que su prioridad no se envió.`,
  noMe: task => `${task} no se envió: Redmine no dijo de quién es la clave de API, para asignársela.`,
  refused: (issue, why) => `Redmine rechazó el cambio en #${issue}: ${why}`,
  localFailed: (task, why) => `No se pudo actualizar ${task}: ${why}`,
  syncNote:
    'Las peticiones se copian en Backlog.md como tareas (con la URL de la petición en sus referencias) y se mantienen al día campo a campo: título, estado, prioridad y descripción. Solo lectura nunca escribe en Redmine. Nunca se borra nada en ningún lado.',
  trackerJira: 'Jira (API)',
  textFormat: 'Formato del texto en Redmine',
  structure: 'Tipos y padres',
  structureOn: 'Tipo como etiqueta; tareas nuevas bajo su padre',
  structureOff: 'No usarlos',
  issueType: 'Tipo de incidencia para las tareas nuevas',
  issueTypeAuto: 'Tarea, o la primera',
  noTransition: (task, status) =>
    `${task}: el flujo de trabajo de Jira no tiene transición a «${status}» desde donde está la incidencia, así que su estado no se envió.`,
  emailMissing: 'Jira Cloud también necesita el email de tu cuenta: pon «Jira email» en los ajustes del plugin.',
  jira: {
    redmineUrl: 'URL de Jira',
    urlPlaceholder: 'https://tu-empresa.atlassian.net',
    redmineProject: 'Clave del proyecto',
    projectPlaceholder: 'la de sus incidencias, p. ej. APP',
    badProject: 'Escribe la clave del proyecto, la de sus incidencias (APP-12 → APP).',
    modeRead: 'Solo lectura (Jira → Backlog.md)',
    apiKeySet: 'Token de API: configurado.',
    apiKeyMissing:
      'Token de API: falta. Pon «Jira API token» en los ajustes del plugin (/plugin, o /config), y para Jira Cloud también «Jira email»: Claude Code guarda el token en el almacén seguro.',
    statusMapping: 'Estado de Jira → estado de Backlog.md',
    priorityMapping: 'Prioridad de Jira → prioridad de Backlog.md',
    excludedNote: n =>
      `${n} ${plural(n, 'tarea que ya existía', 'tareas que ya existían')} antes de la sincronización no se ${plural(n, 'envía', 'envían')} a Jira.`,
    inRedmine: 'Jira',
    useRemote: 'Usar el de Jira',
    syncDone: n =>
      `Jira: ${n.fromRemote} desde Jira, ${n.toRemote} a Jira, ${n.conflicts} ${plural(n.conflicts, 'conflicto', 'conflictos')}.`,
    unauthorized: 'Jira rechazó el email o el token de API (401). Revísalos en los ajustes del plugin.',
    forbidden: 'Jira dice que este token no puede hacer eso (403).',
    noProject: project => `Jira no tiene el proyecto «${project}» (404), o este token no puede verlo.`,
    unreachable: detail => `No se pudo conectar con Jira: ${detail}`,
    unexpected: detail => `Jira respondió algo inesperado: ${detail}`,
    statusNotSent: (task, status) => `${task}: ningún estado de Jira corresponde a «${status}», así que su estado no se envió.`,
    priorityNotSent: (task, priority) =>
      `${task}: ninguna prioridad de Jira corresponde a «${priority}», así que su prioridad no se envió.`,
    noMe: task => `${task} no se envió: Jira no dijo de quién es el token de API, para asignársela.`,
    refused: (issue, why) => `Jira rechazó el cambio en ${issue}: ${why}`,
    syncNote:
      'Las incidencias se copian en Backlog.md como tareas (con la URL de la incidencia en sus referencias) y se mantienen al día campo a campo: título, estado, prioridad y descripción. Solo lectura nunca escribe en Jira. Nunca se borra nada en ningún lado.',
  },
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
