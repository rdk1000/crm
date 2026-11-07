import { Hono } from 'hono'

import { privateJson } from '../auth'
import { CONTACT_SELECT, hueFor, id, mapContact, now } from '../db'
import type { AppContext } from '../env'
import { CONTACT_STATUSES, type ContactStatus } from '../../shared/types'

// CSV in and out for contacts, with company matching on import. Parsing lives
// here so the browser never has to deal with quoting or line endings.

export const importExport = new Hono<AppContext>()

const COLUMNS = ['First name', 'Last name', 'Email', 'Phone', 'Title', 'Status', 'Company']
const MAX_ROWS = 2000
const MAX_BYTES = 2_000_000

function cell(value: string | null | undefined) {
  const text = (value ?? '').trim()
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** RFC 4180 subset: quoted fields, escaped quotes, CRLF or LF, optional BOM. */
function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

importExport.get('/contacts.csv', async (c) => {
  const rows = await c
    .get('db')
    .prepare(`${CONTACT_SELECT} WHERE c.owner_sub = ? ORDER BY c.last_name ASC, c.first_name ASC`)
    .bind(c.get('user').sub)
    .all()
  const lines = [COLUMNS.join(',')]
  for (const row of rows.results as Record<string, unknown>[]) {
    const contact = mapContact(row)
    lines.push(
      [contact.firstName, contact.lastName, contact.email, contact.phone, contact.title, contact.status, contact.companyName].map(cell).join(','),
    )
  }
  return new Response(`${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="relay-contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
})

type ImportResult = { created: number; updated: number; skipped: number; companies: number }

importExport.post('/contacts/import', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const body = await c.req.json<{ csv?: string }>().catch(() => ({ csv: '' }))
  const csv = (body.csv ?? '').trim()
  if (!csv) return c.json({ error: 'Choose a CSV file or paste its contents first.' }, 400)
  if (csv.length > MAX_BYTES) return c.json({ error: 'That file is too large. Imports are limited to 2 MB.' }, 413)

  const rows = parseCsv(csv)
  if (rows.length < 2) return c.json({ error: 'Add a header row and at least one contact.' }, 400)
  if (rows.length - 1 > MAX_ROWS) return c.json({ error: `Import up to ${MAX_ROWS} contacts at a time.` }, 400)

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const index = (...names: string[]) => names.reduce((found, name) => (found >= 0 ? found : header.indexOf(name)), -1)
  const iFirst = index('first name', 'firstname', 'first')
  const iLast = index('last name', 'lastname', 'last')
  const iEmail = index('email', 'e-mail', 'email address')
  const iPhone = index('phone', 'phone number')
  const iTitle = index('title', 'job title')
  const iStatus = index('status')
  const iCompany = index('company', 'company name', 'account')
  if (iFirst < 0) {
    return c.json({ error: 'The file needs a "First name" column. Export your contacts first to see the format.' }, 400)
  }

  const [companyRows, contactRows] = await db.batch([
    db.prepare(`SELECT id, name FROM companies WHERE owner_sub = ?`).bind(owner),
    db.prepare(`SELECT id, email FROM contacts WHERE owner_sub = ? AND email IS NOT NULL`).bind(owner),
  ])
  const companyIds = new Map((companyRows.results as { id: string; name: string }[]).map((row) => [row.name.toLowerCase(), row.id]))
  const contactIds = new Map((contactRows.results as { id: string; email: string }[]).map((row) => [row.email.toLowerCase(), row.id]))

  const statements: D1PreparedStatement[] = []
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, companies: 0 }
  const t = now()

  for (const row of rows.slice(1)) {
    const value = (at: number) => (at >= 0 ? (row[at] ?? '').trim() : '')
    const firstName = value(iFirst).slice(0, 80)
    if (!firstName) {
      result.skipped++
      continue
    }
    const lastName = value(iLast).slice(0, 80)
    const email = value(iEmail).toLowerCase().slice(0, 160) || null
    const phone = value(iPhone).slice(0, 40) || null
    const title = value(iTitle).slice(0, 80) || null
    const rawStatus = value(iStatus).toLowerCase()
    const status: ContactStatus = CONTACT_STATUSES.includes(rawStatus as ContactStatus) ? (rawStatus as ContactStatus) : 'lead'
    const companyName = value(iCompany).slice(0, 100)

    let companyId: string | null = null
    if (companyName) {
      const key = companyName.toLowerCase()
      companyId = companyIds.get(key) ?? null
      if (!companyId) {
        companyId = id()
        companyIds.set(key, companyId)
        result.companies++
        statements.push(
          db
            .prepare(`INSERT INTO companies (id, owner_sub, name, hue, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(companyId, owner, companyName, hueFor(companyName), t, t),
        )
      }
    }

    const existingId = email ? contactIds.get(email) : undefined
    if (existingId) {
      // Match on email: an existing contact is updated rather than duplicated.
      statements.push(
        db
          .prepare(
            `UPDATE contacts SET first_name = ?, last_name = ?, phone = ?, title = ?, status = ?, company_id = ?, updated_at = ?
             WHERE owner_sub = ? AND id = ?`,
          )
          .bind(firstName, lastName, phone, title, status, companyId, t, owner, existingId),
      )
      result.updated++
    } else {
      const contactId = id()
      if (email) contactIds.set(email, contactId)
      statements.push(
        db
          .prepare(
            `INSERT INTO contacts (id, owner_sub, company_id, first_name, last_name, email, phone, title, status, hue, last_activity_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(contactId, owner, companyId, firstName, lastName, email, phone, title, status, hueFor(firstName + lastName), t, t, t),
      )
      result.created++
    }
  }

  // D1 batches are limited in size; chunk to stay well under the limit.
  for (let i = 0; i < statements.length; i += 40) await db.batch(statements.slice(i, i + 40))
  return privateJson(c, result)
})
