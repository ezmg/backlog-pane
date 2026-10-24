// The sync core, the same for every outside tracker (Redmine first; Jira,
// Excel later). Pure: it reads what each side holds now and what they held
// at the last sync, and says what to do. register.tsx runs the actions (the
// backlog CLI on one side, the tracker's adapter on the other).
//
// Each linked pair keeps a `base`: the fields as both sides agreed at the
// last sync, in Backlog.md's terms. A field is merged three ways:
//   - same on both sides: nothing to do;
//   - changed on one side only: the other side takes it;
//   - changed on both, to different values: a conflict. Neither side is
//     touched for that field until the person picks one.
// Read-only mode never writes to the tracker: a field the tracker changed
// overwrites the task's, and a change made only in Backlog.md stays local.

import type { RedmineSettings, SyncConflict, SyncData, SyncField, SyncFields, SyncLink, SyncMode } from '../types'

export const FIELDS: readonly SyncField[] = ['title', 'status', 'priority', 'description']
export type Field = SyncField
export type Fields = SyncFields
export type Conflict = SyncConflict
export type Link = SyncLink
export type { SyncMode }

export type RemoteItem = { key: string; url: string; fields: Fields }

/**
 * A Backlog.md task as the list shows it. `description` is undefined when
 * it was not read this time (the list carries none): it counts as unchanged.
 */
export type LocalItem = { id: string; references: string[]; fields: Omit<Fields, 'description'> & { description?: string } }

export type Change = Partial<Fields>

export type Action =
  | { kind: 'create-local'; key: string; url: string; fields: Fields }
  | { kind: 'update-local'; key: string; taskId: string; change: Change }
  | { kind: 'create-remote'; taskId: string; fields: Fields }
  | { kind: 'update-remote'; key: string; taskId: string; change: Change }

export type Plan = {
  actions: Action[]
  /** The links once every action has gone through; register.tsx keeps the ones that did. */
  links: Record<string, Link>
  conflicts: Conflict[]
}

/** The same text whatever the line endings, trailing space or null. */
const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').replace(/\r\n/g, '\n').trimEnd() === (b ?? '').replace(/\r\n/g, '\n').trimEnd()

/**
 * Merges one field three ways. `local` undefined: not read, so unchanged.
 * Returns what each side should take, or a conflict.
 */
export function mergeField(
  base: string | null,
  local: string | null | undefined,
  remote: string | null,
  mode: SyncMode,
): { toLocal?: string | null; toRemote?: string | null; agreed: string | null; isConflict?: true } {
  const mine = local === undefined ? base : local
  if (same(mine, remote)) return { agreed: remote }
  const remoteChanged = !same(remote, base)
  const localChanged = !same(mine, base)
  if (mode === 'read') return remoteChanged ? { toLocal: remote, agreed: remote } : { agreed: base }
  if (remoteChanged && !localChanged) return { toLocal: remote, agreed: remote }
  if (localChanged && !remoteChanged) return { toRemote: mine, agreed: mine }
  return { agreed: base, isConflict: true }
}

/**
 * Plans one sync. `excluded`: tasks that existed before the tracker was set
 * up, never sent to it unless the person asks. `url` of an issue is how a
 * task is matched to it when no link is kept (the task's references).
 */
export function plan(input: {
  remote: RemoteItem[]
  local: LocalItem[]
  links: Record<string, Link>
  conflicts: Conflict[]
  mode: SyncMode
  excluded: readonly string[]
  /** Whether new Backlog.md tasks are sent to the tracker (bidirectional only). */
  createsRemote: boolean
}): Plan {
  const actions: Action[] = []
  const links: Record<string, Link> = {}
  const conflicts: Conflict[] = []
  const byId = new Map(input.local.map(task => [task.id, task]))
  const linkedTasks = new Set<string>()

  for (const item of input.remote) {
    let link = input.links[item.key]
    // A task that names the issue in its references, with no kept link:
    // adopt it with the task's own fields as the base, so whatever differs
    // counts as the tracker's change and the tracker's values win.
    if (!link || !byId.has(link.taskId)) {
      const found = input.local.find(task => task.references.includes(item.url))
      if (found) link = { taskId: found.id, base: { ...found.fields, description: item.fields.description } }
    }
    const task = link ? byId.get(link.taskId) : undefined
    if (!link || !task) {
      actions.push({ kind: 'create-local', key: item.key, url: item.url, fields: item.fields })
      links[item.key] = { taskId: '', base: item.fields }
      continue
    }
    linkedTasks.add(task.id)
    const toLocal: Change = {}
    const toRemote: Change = {}
    const agreed = { ...link.base }
    for (const field of FIELDS) {
      // A tracker priority with no Backlog.md one to land in: leave priority alone.
      if (field === 'priority' && item.fields.priority === null) {
        agreed.priority = task.fields.priority
        continue
      }
      const open = input.conflicts.find(one => one.key === item.key && one.field === field)
      const merged = mergeField(link.base[field], task.fields[field], item.fields[field], input.mode)
      if (merged.isConflict) {
        conflicts.push({
          key: item.key,
          taskId: task.id,
          field,
          local: task.fields[field] ?? open?.local ?? null,
          remote: item.fields[field],
        })
        continue
      }
      if ('toLocal' in merged) (toLocal as Record<string, unknown>)[field] = merged.toLocal
      if ('toRemote' in merged) (toRemote as Record<string, unknown>)[field] = merged.toRemote
      ;(agreed as Record<string, unknown>)[field] = merged.agreed
    }
    if (Object.keys(toLocal).length > 0) actions.push({ kind: 'update-local', key: item.key, taskId: task.id, change: toLocal })
    if (Object.keys(toRemote).length > 0) {
      actions.push({ kind: 'update-remote', key: item.key, taskId: task.id, change: toRemote })
    }
    links[item.key] = { taskId: task.id, base: agreed as Fields }
  }

  // Links whose issue is gone from the tracker's list (deleted, moved, out
  // of reach) are kept as they were: nothing is deleted on either side.
  for (const [key, link] of Object.entries(input.links)) {
    if (!(key in links)) {
      links[key] = link
      linkedTasks.add(link.taskId)
    }
  }

  if (input.mode === 'both' && input.createsRemote) {
    const remoteUrls = new Set(input.remote.map(item => item.url))
    for (const task of input.local) {
      if (linkedTasks.has(task.id) || input.excluded.includes(task.id)) continue
      // A task that already points at an issue of this tracker is not a new one.
      if (task.references.some(ref => remoteUrls.has(ref))) continue
      actions.push({
        kind: 'create-remote',
        taskId: task.id,
        fields: { ...task.fields, description: task.fields.description ?? '' },
      })
    }
  }
  return { actions, links, conflicts }
}

/** The fields a change touches, in a fixed order, for messages and tests. */
export const changedFields = (change: Change) => FIELDS.filter(field => field in change)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A project's sync as kept in $.store, keeping only what is well formed. */
export function readSyncStore(value: unknown): { settings: RedmineSettings | null; data: SyncData } {
  const raw = isRecord(value) ? value : {}
  const data = isRecord(raw.data) ? raw.data : {}
  const strings = (one: unknown) => (isRecord(one) ? Object.fromEntries(Object.entries(one).filter(([, v]) => typeof v === 'string')) : {})
  const s = isRecord(raw.settings) ? raw.settings : undefined
  const settings: RedmineSettings | null =
    s && s.provider === 'redmine'
      ? {
          provider: 'redmine',
          url: typeof s.url === 'string' ? s.url : '',
          project: typeof s.project === 'string' ? s.project : '',
          mode: s.mode === 'both' ? 'both' : 'read',
          intervalMin: typeof s.intervalMin === 'number' && s.intervalMin >= 0 ? s.intervalMin : 5,
          statusMap: strings(s.statusMap) as Record<string, string>,
          priorityMap: strings(s.priorityMap) as Record<string, string>,
          excluded: Array.isArray(s.excluded) ? s.excluded.filter(one => typeof one === 'string') : [],
        }
      : null
  return {
    settings,
    data: {
      links: isRecord(data.links) ? (data.links as Record<string, SyncLink>) : {},
      conflicts: Array.isArray(data.conflicts) ? (data.conflicts as SyncConflict[]) : [],
      meta: isRecord(data.meta) ? (data.meta as SyncData['meta']) : {},
      statuses: Array.isArray(data.statuses) ? (data.statuses as SyncData['statuses']) : [],
      priorities: Array.isArray(data.priorities) ? (data.priorities as SyncData['priorities']) : [],
      lastSync: typeof data.lastSync === 'string' ? data.lastSync : undefined,
      lastError: typeof data.lastError === 'string' ? data.lastError : undefined,
      warnings: Array.isArray(data.warnings) ? data.warnings.filter(one => typeof one === 'string') : [],
    },
  }
}

export const EMPTY_SYNC: SyncData = { links: {}, conflicts: [], meta: {}, statuses: [], priorities: [], warnings: [] }

/**
 * Whether a linked task's description must be read again: the list carries
 * none, and updatedAt is kept to the minute, so a task changed in the minute
 * of the last sync or after is read.
 */
export const needsRead = (updatedAt: string | null, lastSync: string | undefined) =>
  !lastSync || (updatedAt ?? '') >= `${lastSync.slice(0, 16)}:00Z`
