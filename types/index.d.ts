// The values backlog-pane keeps in $.state, and the shapes of Backlog.md's
// JSON output (schemaVersion 1) that the pane reads.

export type Checklist = { index: number; text: string; checked: boolean }

/** A task as `backlog task list --json` lists it (the fields the pane uses). */
export type TaskSummary = {
  id: string
  title: string
  status: string
  priority: string | null
  labels: string[]
  /** Its references: URLs or paths; a synced task holds its issue's URL here. */
  references: string[]
  acceptanceCriteriaCompleted: number
  acceptanceCriteriaCount: number
  createdAt: string | null
  updatedAt: string | null
}

/** A task as `backlog task view <id> --json` shows it. */
export type TaskDetail = TaskSummary & {
  description: string | null
  acceptanceCriteria: Checklist[]
  implementationPlan: string | null
}

/** What the pane can say about the backlog as a whole. */
export type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'not-installed' }
  | { kind: 'not-initialized'; message: string }
  | { kind: 'failed'; message: string }

/** One card of the board: a task as its surface module draws it. */
export type BoardCard = {
  id: string
  title: string
  isHigh: boolean
  /** Its acceptance criteria done, as `1/2`; null when it has none. */
  criteria: string | null
}

/** One column of the board: a status, its theme colour and its cards. */
export type BoardColumn = {
  status: string
  color: string
  total: number
  /** In the `closedStatuses` option: drawn dim, and ←/→ skip it. */
  isClosed: boolean
  cards: BoardCard[]
}

/** What the board's `Client` is handed: plain data, no closures. */
export type BoardProps = {
  columns: BoardColumn[]
  /** The pane's body width, until the region has been laid out. */
  width: number
  hint: string
}

/** What the board's surface module posts to the hooks module. */
export type BoardMessage = { type: 'move'; id: string; status: string } | { type: 'open'; id: string }

/** A project's colours (theme keys) and closed statuses; `closed` absent: the option's. */
export type Prefs = { colors: Record<string, string>; closed?: string[] }

/** A task's synced fields, in Backlog.md's terms (status and priority mapped). */
export type SyncFields = { title: string; status: string; priority: string | null; description: string }

export type SyncField = 'title' | 'status' | 'priority' | 'description'

/** `read`: the tracker is only read. `both`: changes go both ways. */
export type SyncMode = 'read' | 'both'

/** What the last sync agreed on for one linked pair, by the tracker's key. */
export type SyncLink = { taskId: string; base: SyncFields }

/** One field that changed on both sides since the last sync, kept until the person picks one. */
export type SyncConflict = {
  key: string
  taskId: string
  field: SyncField
  local: string | null
  remote: string | null
}

/**
 * Where a project's tasks come from: Redmine's API, or a CSV file Redmine
 * exported (read only, read when the person presses Sync now).
 */
export type SyncProvider = 'redmine' | 'jira' | 'csv'

/** How a project syncs, as the person set it up in Integration…. */
export type SyncSettings = {
  provider: SyncProvider
  /** Redmine's URL: the API's, or (CSV) the one the tasks' references point at; optional for CSV. */
  url: string
  project: string
  /** CSV: the exported file, absolute or relative to the session's folder. */
  file: string
  /** Jira: the issue type new tasks are created as (its id); '' picks Task, or the first. */
  issueType?: string
  /** Redmine and its CSV: the descriptions' format there; Textile is converted to Markdown and back. */
  textFormat?: 'textile' | 'markdown'
  mode: SyncMode
  /** Only the issues assigned to the key's owner; new tasks sent to Redmine are assigned to them. */
  onlyMine: boolean
  /** The board shows every task, or hides those linked to issues not assigned to the key's owner. */
  view: 'all' | 'mine'
  /** Minutes between automatic syncs while the pane is open; 0: only by the button. */
  intervalMin: number
  /** Redmine status id (CSV: name) → Backlog.md status, and the same for priorities. */
  statusMap: Record<string, string>
  priorityMap: Record<string, string>
  /** Tasks that existed when the sync was set up: never sent to Redmine unless asked. */
  excluded: string[]
}

/** What a project's sync knows between runs. */
export type SyncData = {
  links: Record<string, SyncLink>
  conflicts: SyncConflict[]
  /** Each issue's Redmine status and priority ids, from the last read. */
  meta: Record<string, { statusId: number | string; priorityId: number | string | null; assigneeId?: number | string | null }>
  /** The key's owner (and, in Redmine, their groups), as the tracker said at the last sync. */
  me?: (number | string)[]
  statuses: { id: number | string; name: string; isClosed: boolean }[]
  priorities: { id: number | string; name: string; isDefault: boolean }[]
  /** Jira: the project's issue types new tasks can be created as. */
  issueTypes?: { id: string; name: string }[]
  lastSync?: string
  lastError?: string
  warnings: string[]
}

/** The project's sync as the pane draws it. */
export type SyncView = { settings: SyncSettings | null; data: SyncData; isSyncing: boolean }

declare module 'claude-code' {
  interface PluginState {
    'backlog-pane': {
      phase: Phase
      tasks: TaskSummary[]
      statuses: string[]
      priorities: string[]
      selectedId: string | null
      detail: TaskDetail | null
      openGroups: string[]
      notice: string | null
      editing: string | null
      isCreating: boolean
      isBoardFailed: boolean
      isManagingStatuses: boolean
      newStatusAt: number | null
      prefs: Prefs
      prefsKey: string | null
      sync: SyncView
      isManagingSync: boolean
    }
  }
}
