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
  /** The card's second line: its id, and its criteria done (`BL-1 · 1/2`). */
  meta: string
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
    }
  }
}
