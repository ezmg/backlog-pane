// A CSV file Redmine exported (Issues → CSV), the tracker for those with no
// API key: read only, read into the sync core's terms. Pure: register.tsx
// reads the file with $.fs.
//
// Redmine writes the export in the language of the person's account: its
// headers ("#", "Asunto", "Estado"…), its separator ("," or ";"), and its
// encoding (UTF-8, or the language's own, such as Windows-1252).

import { fromBase64 } from './base64'
import type { RedminePriority, RedmineStatus } from './redmine'
import type { Fields, RemoteItem } from './sync'
import type { SyncField } from '../types'

export { fromBase64 }

/** Windows-1252's 0x80–0x9F; the rest of its bytes are Latin-1's. */
const CP1252 =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'

/** Whether the bytes are well-formed UTF-8. */
function isUtf8(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; ) {
    const byte = bytes[i] as number
    const extra = byte < 0x80 ? 0 : byte >= 0xc2 && byte < 0xe0 ? 1 : byte >= 0xe0 && byte < 0xf0 ? 2 : byte >= 0xf0 && byte < 0xf5 ? 3 : -1
    if (extra < 0) return false
    for (let k = 1; k <= extra; k++) if (((bytes[i + k] ?? 0) & 0xc0) !== 0x80) return false
    i += extra + 1
  }
  return true
}

/** The file's text: UTF-8 (with or without its mark), else Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3))
  if (isUtf8(bytes)) return new TextDecoder().decode(bytes)
  let text = ''
  for (const byte of bytes) text += byte >= 0x80 && byte < 0xa0 ? CP1252[byte - 0x80] : String.fromCharCode(byte)
  return text
}

/** The separator of the header line: the one of `,`, `;` or tab found most outside quotes. */
function separatorOf(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let isQuoted = false
  for (const char of text) {
    if (char === '"') isQuoted = !isQuoted
    else if (!isQuoted && (char === '\n' || char === '\r')) break
    else if (!isQuoted && char in counts) counts[char] = (counts[char] ?? 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ','
}

/** The rows of a CSV: quoted fields may hold separators, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const separator = separatorOf(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let isQuoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string
    if (isQuoted) {
      if (char !== '"') field += char
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else isQuoted = false
    } else if (char === '"') isQuoted = true
    else if (char === separator) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(one => one.some(cell => cell.trim() !== ''))
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

/** The headers each column goes by, in the languages Redmine is used in most. */
const HEADERS = {
  id: /^(#|id|n[o.º°]?|issue|peticion|tarefa|ticket)$/,
  title: /^(subject|asunto|titulo|title|summary|resumen|sujet|betreff|oggetto|assunto)$/,
  status: /^(status|estado|statut|stato|estat)$/,
  priority: /^(priority|prioridad|priorite|prioritat|priorita|prioridade|prioritat)$/,
  description: /^(description|descripcion|beschreibung|descrizione|descricao|descripcio)$/,
  closed: /^(closed|cerrada|cerrado|fecha de cierre|ferme|fermee|geschlossen|chiusa|fechada|tancada)$/,
  type: /^(tracker|tipo|type|typ|tipus)$/,
  parent: /^(parent task|parent|tarea padre|tache parente|ubergeordnete aufgabe|attivita padre|tarefa pai|tasca pare)$/,
} as const

export type Column = keyof typeof HEADERS
export type Columns = Partial<Record<Column, number>>

/** Which column holds what, from the header row. */
export function columnsOf(headers: string[]): Columns {
  const columns: Columns = {}
  headers.forEach((header, i) => {
    const name = fold(header)
    for (const [column, pattern] of Object.entries(HEADERS) as [Column, RegExp][]) {
      if (columns[column] === undefined && pattern.test(name)) columns[column] = i
    }
  })
  return columns
}

export type ExportRow = {
  id: number
  subject: string
  status: string
  priority: string
  description: string
  isClosed: boolean
  type: string
  parentId: number | null
}

export type Export = {
  headers: string[]
  columns: Columns
  rows: ExportRow[]
  /** The fields the file has no column for: left alone. */
  skip: SyncField[]
}

/** An export, or the headers it has when it lacks the "#" and subject columns. */
export function readExport(text: string): Export | { headers: string[] } {
  const [headers = [], ...lines] = parseCsv(text)
  const columns = columnsOf(headers)
  if (columns.id === undefined || columns.title === undefined) return { headers }
  const cell = (line: string[], column: Column) => {
    const at = columns[column]
    return at === undefined ? '' : (line[at] ?? '').trim()
  }
  const rows = lines.flatMap(line => {
    const id = Number(cell(line, 'id').replace(/^#/, ''))
    if (!Number.isInteger(id) || id <= 0) return []
    return [
      {
        id,
        subject: cell(line, 'title'),
        status: cell(line, 'status'),
        priority: cell(line, 'priority'),
        description: columns.description === undefined ? '' : (line[columns.description] ?? '').replace(/\r\n/g, '\n'),
        isClosed: cell(line, 'closed') !== '',
        type: cell(line, 'type'),
        parentId: Number(cell(line, 'parent').replace(/^#/, '')) || null,
      },
    ]
  })
  const skip = (['status', 'priority', 'description'] as const).filter(field => columns[field] === undefined)
  return { headers, columns, rows, skip }
}

const CLOSED = /closed|cerrad|rechaz|rejected|cancel|anulad|ferme|geschlossen|chius|fechad|tancad/

/**
 * The statuses an export names, in the order they first appear. A status is
 * closed when a row in it has a closing date, or its name says so.
 */
export function statusesOf(rows: ExportRow[]): RedmineStatus[] {
  const seen = new Map<string, RedmineStatus>()
  for (const row of rows) {
    if (!row.status) continue
    const known = seen.get(row.status)
    const isClosed = row.isClosed || CLOSED.test(fold(row.status))
    if (!known) seen.set(row.status, { id: row.status, name: row.status, isClosed })
    else if (isClosed) known.isClosed = true
  }
  return [...seen.values()]
}

export function prioritiesOf(rows: ExportRow[]): RedminePriority[] {
  const names = [...new Set(rows.map(row => row.priority).filter(Boolean))]
  return names.map(name => ({ id: name, name, isDefault: false }))
}

/** What a task's reference names the issue by: its URL when Redmine's is known, else "#12". */
export const refFor = (base: string | undefined, id: number) => (base ? `${base}/issues/${id}` : `#${id}`)

/** A row in Backlog.md's terms. A status the map lacks lands in `fallback`. */
export function toRemoteRow(
  base: string | undefined,
  row: ExportRow,
  skip: readonly SyncField[],
  statusMap: Readonly<Record<string, string>>,
  priorityMap: Readonly<Record<string, string>>,
  fallback: string,
): RemoteItem {
  const fields: Fields = {
    title: row.subject,
    status: statusMap[row.status] ?? fallback,
    priority: (priorityMap[row.priority] || '').toLowerCase() || null,
    description: row.description,
  }
  return {
    key: String(row.id),
    url: refFor(base, row.id),
    fields,
    skip,
    ...(row.type ? { type: row.type } : {}),
    ...(row.parentId ? { parentKey: String(row.parentId) } : {}),
  }
}
