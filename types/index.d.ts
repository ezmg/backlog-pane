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

declare module 'claude-code' {
  interface PluginState {
    'backlog-pane': {
      phase: Phase
      tasks: TaskSummary[]
      statuses: string[]
      selectedId: string | null
      detail: TaskDetail | null
      isDoneOpen: boolean
      notice: string | null
      isCreating: boolean
    }
  }
}
