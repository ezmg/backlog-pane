import { describe, expect, test } from 'claude-code/testing'

import { columnsOf, decodeText, fromBase64, parseCsv, readExport, refFor, statusesOf, toRemoteRow } from '../hooks/csv'
import { toBase64 } from './fixtures'

// The CSV adapter: what Redmine's issue export looks like in the languages
// and encodings it writes.

const latin1 = (text: string) => Uint8Array.from([...text].map(char => char.charCodeAt(0)))

describe('reading the bytes', () => {
  test('UTF-8, with or without its mark', async () => {
    const utf8 = new TextEncoder().encode('Descripción;Petición')
    expect(decodeText(utf8)).toBe('Descripción;Petición')
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8]))).toBe('Descripción;Petición')
  })
  test('anything else is Windows-1252, as Redmine writes Spanish by default', async () => {
    expect(decodeText(latin1('Descripción;Mañana'))).toBe('Descripción;Mañana')
    expect(decodeText(Uint8Array.from([0x80, 0x20, 0x93, 0x61, 0x94]))).toBe('€ “a”')
  })
  test('base64 both ways', async () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253])
    for (let n = 0; n <= bytes.length; n++) expect([...fromBase64(toBase64(bytes.subarray(0, n)))]).toEqual([...bytes.subarray(0, n)])
  })
})

describe('parsing', () => {
  test('the separator is the header line’s: comma, semicolon or tab', async () => {
    expect(parseCsv('#,Subject\n1,A')).toEqual([['#', 'Subject'], ['1', 'A']])
    expect(parseCsv('#;Asunto\r\n1;A, B\r\n')).toEqual([['#', 'Asunto'], ['1', 'A, B']])
    expect(parseCsv('#\tSubject\n1\tA')).toEqual([['#', 'Subject'], ['1', 'A']])
  })
  test('quoted fields hold separators, quotes and line breaks; blank lines are dropped', async () => {
    const text = '#;Asunto;Descripción\n1;"Con ; dentro";"Línea 1\nLínea ""2"""\n\n2;B;\n'
    expect(parseCsv(text)).toEqual([
      ['#', 'Asunto', 'Descripción'],
      ['1', 'Con ; dentro', 'Línea 1\nLínea "2"'],
      ['2', 'B', ''],
    ])
  })
  test('the columns, by their headers in English or Spanish', async () => {
    expect(columnsOf(['#', 'Project', 'Tracker', 'Status', 'Priority', 'Subject', 'Closed', 'Description'])).toEqual({
      id: 0,
      status: 3,
      priority: 4,
      title: 5,
      closed: 6,
      description: 7,
    })
    expect(columnsOf(['#', 'Proyecto', 'Estado', 'Prioridad', 'Asunto', 'Cerrada', 'Descripción'])).toEqual({
      id: 0,
      status: 2,
      priority: 3,
      title: 4,
      closed: 5,
      description: 6,
    })
  })
})

describe('the export', () => {
  const EXPORT = [
    '#;Proyecto;Estado;Prioridad;Asunto;Cerrada;Descripción',
    '12;Demo;Nueva;Normal;Página de acceso;;"Email y\ncontraseña"',
    '13;Demo;En curso;Alta;Exportar a CSV;;',
    '14;Demo;Resuelta;Urgente;Fallo al arrancar;20/10/2026 09:00;Arreglado.',
    'Total;;;;;;',
  ].join('\n')

  test('rows with a number; the rest (a total line) are dropped', async () => {
    const file = readExport(EXPORT)
    if (!('rows' in file)) throw new Error('no rows')
    expect(file.rows.map(row => [row.id, row.subject, row.status, row.priority, row.isClosed])).toEqual([
      [12, 'Página de acceso', 'Nueva', 'Normal', false],
      [13, 'Exportar a CSV', 'En curso', 'Alta', false],
      [14, 'Fallo al arrancar', 'Resuelta', 'Urgente', true],
    ])
    expect(file.rows[0]?.description).toBe('Email y\ncontraseña')
    expect(file.skip).toEqual([])
  })
  test('a status is closed when a row in it has a closing date, or its name says so', async () => {
    const file = readExport(`${EXPORT}\n15;Demo;Rechazada;Baja;Otra;;`)
    if (!('rows' in file)) throw new Error('no rows')
    expect(statusesOf(file.rows).map(one => [one.id, one.isClosed])).toEqual([
      ['Nueva', false],
      ['En curso', false],
      ['Resuelta', true],
      ['Rechazada', true],
    ])
  })
  test('with no "#" or subject column it is not an export; missing fields are skipped', async () => {
    expect(readExport('Name;Age\nAna;30')).toEqual({ headers: ['Name', 'Age'] })
    const file = readExport('#,Subject\n1,A')
    expect('rows' in file && file.skip).toEqual(['status', 'priority', 'description'])
  })
  test('a row in Backlog.md terms, named by its URL when Redmine’s is known', async () => {
    const row = { id: 12, subject: 'A', status: 'Nueva', priority: 'Alta', description: 'D', isClosed: false }
    expect(toRemoteRow(undefined, row, [], { Nueva: 'To Do' }, { Alta: 'High' }, 'To Do')).toEqual({
      key: '12',
      url: '#12',
      fields: { title: 'A', status: 'To Do', priority: 'high', description: 'D' },
      skip: [],
    })
    expect(refFor('https://r.test', 12)).toBe('https://r.test/issues/12')
    expect(toRemoteRow(undefined, { ...row, status: 'Otra', priority: 'Rara' }, [], {}, {}, 'To Do').fields).toMatchObject({
      status: 'To Do',
      priority: null,
    })
  })
})
