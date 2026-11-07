import { Hono } from 'hono'

import { privateJson } from '../auth'
import { ACTIVITY_SELECT, TASK_SELECT, mapActivity, mapTask, now } from '../db'
import type { AppContext } from '../env'
import { clearWorkspace, seedWorkspace } from '../seed'
import type { DealStage, Me, Overview } from '../../shared/types'

export const workspace = new Hono<AppContext>()

async function ensureWorkspace(db: D1Database, owner: string, name: string) {
  const row = await db.prepare(`SELECT name, seeded_at FROM workspaces WHERE owner_sub = ?`).bind(owner).first<{ name: string; seeded_at: number | null }>()
  // A new workspace starts empty; Settings can load sample data on request.
  if (row) return row
  await db.prepare(`INSERT OR IGNORE INTO workspaces (owner_sub, name, created_at) VALUES (?, ?, ?)`).bind(owner, name, now()).run()
  return { name, seeded_at: null }
}

const DEMO_CLEANUP = 'demo-data-cleanup-v2'

/**
 * One-time cleanup for workspaces that used to open with sample data. A
 * workspace that was seeded is emptied once, and the migration is recorded per
 * owner, so sample data loaded later from Settings is not cleared again.
 */
async function clearSeededDemoData(db: D1Database, owner: string) {
  const applied = await db.prepare(`SELECT 1 AS ok FROM migrations WHERE owner_sub = ? AND key = ?`).bind(owner, DEMO_CLEANUP).first()
  if (applied) return
  const seeded = await db.prepare(`SELECT seeded_at FROM workspaces WHERE owner_sub = ?`).bind(owner).first<{ seeded_at: number | null }>()
  if (seeded?.seeded_at) await clearWorkspace(db, owner)
  await db.prepare(`INSERT INTO migrations (owner_sub, key, applied_at) VALUES (?, ?, ?)`).bind(owner, DEMO_CLEANUP, now()).run()
}

workspace.get('/me', async (c) => {
  const user = c.get('user')
  const db = c.get('db')
  const fallback = `${user.name?.split(' ')[0] ?? 'Your'}'s workspace`
  await ensureWorkspace(db, user.sub, fallback)
  await clearSeededDemoData(db, user.sub)
  const ws =
    (await db.prepare(`SELECT name, seeded_at FROM workspaces WHERE owner_sub = ?`).bind(user.sub).first<{ name: string; seeded_at: number | null }>()) ??
    { name: fallback, seeded_at: null }
  const body: Me = {
    user: { sub: user.sub, name: user.name, email: user.email, picture: user.picture },
    workspace: { name: ws.name, seededAt: ws.seeded_at },
    capabilities: {
      database: true,
      files: Boolean(c.env.FILES),
    },
  }
  return privateJson(c, body)
})

workspace.patch('/workspace', async (c) => {
  const { name } = await c.req.json<{ name?: string }>()
  const clean = name?.trim().slice(0, 60)
  if (!clean) return c.json({ error: 'Name is required.' }, 400)
  await c.get('db').prepare(`UPDATE workspaces SET name = ? WHERE owner_sub = ?`).bind(clean, c.get('user').sub).run()
  return privateJson(c, { ok: true })
})

workspace.post('/workspace/reset', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  await clearWorkspace(db, owner)
  await seedWorkspace(db, owner)
  return privateJson(c, { ok: true })
})

workspace.delete('/workspace/data', async (c) => {
  await clearWorkspace(c.get('db'), c.get('user').sub)
  return privateJson(c, { ok: true })
})

workspace.get('/overview', async (c) => {
  const db = c.get('db')
  const owner = c.get('user').sub
  const t = now()
  const startOfMonth = new Date(t)
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const startOfLast = new Date(startOfMonth)
  startOfLast.setMonth(startOfLast.getMonth() - 1)
  const month = startOfMonth.toISOString().slice(0, 10)
  const lastMonth = startOfLast.toISOString().slice(0, 10)
  const rangeParam = c.req.query('range')
  const range = rangeParam === 'month' ? 'month' : 'year'
  const year = startOfMonth.getUTCFullYear()
  const requestedYear = Number(c.req.query('year'))
  const selectedYear =
    range === 'year' && Number.isInteger(requestedYear) && requestedYear >= 1970 && requestedYear <= 2100 ? requestedYear : year
  const monthIndex = startOfMonth.getUTCMonth()
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const buckets: { key: string; label: string }[] = []
  let revenueStart: string
  let revenueGroup: string
  if (range === 'month') {
    // Every day of the current month, so the 30/31 columns are all there.
    const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
    revenueStart = new Date(Date.UTC(year, monthIndex, 1)).toISOString().slice(0, 10)
    revenueGroup = 'close_date'
    for (let day = 1; day <= days; day++) {
      buckets.push({ key: new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10), label: String(day) })
    }
  } else {
    // All twelve months of the selected year, including months without deals.
    revenueStart = `${selectedYear}-01-01`
    revenueGroup = 'substr(close_date, 1, 7)'
    for (let i = 0; i < 12; i++) {
      buckets.push({ key: `${selectedYear}-${String(i + 1).padStart(2, '0')}`, label: monthNames[i] ?? '' })
    }
  }

  const [pipeline, wonThis, wonLast, openDeals, newContacts, tasksDue, stages, revenue, revenueYears, activity, tasks] = await db.batch([
    db.prepare(`SELECT COALESCE(SUM(value),0) AS v FROM deals WHERE owner_sub = ? AND stage NOT IN ('won','lost')`).bind(owner),
    db.prepare(`SELECT COALESCE(SUM(value),0) AS v FROM deals WHERE owner_sub = ? AND stage = 'won' AND close_date >= ?`).bind(owner, month),
    db.prepare(`SELECT COALESCE(SUM(value),0) AS v FROM deals WHERE owner_sub = ? AND stage = 'won' AND close_date >= ? AND close_date < ?`).bind(owner, lastMonth, month),
    db.prepare(`SELECT COUNT(*) AS n FROM deals WHERE owner_sub = ? AND stage NOT IN ('won','lost')`).bind(owner),
    db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE owner_sub = ? AND created_at >= ?`).bind(owner, t - 30 * 86_400_000),
    db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE owner_sub = ? AND done_at IS NULL AND due_at IS NOT NULL AND due_at <= ?`).bind(owner, t + 86_400_000),
    db.prepare(`SELECT stage, COUNT(*) AS n, COALESCE(SUM(value),0) AS v FROM deals WHERE owner_sub = ? GROUP BY stage`).bind(owner),
    db
      .prepare(
        `SELECT ${revenueGroup} AS ym,
                COALESCE(SUM(CASE WHEN stage = 'won' THEN value ELSE -value END),0) AS v
         FROM deals
         WHERE owner_sub = ? AND stage IN ('won','lost') AND close_date >= ? GROUP BY ym ORDER BY ym`,
      )
      .bind(owner, revenueStart),
    db
      .prepare(
        `SELECT DISTINCT CAST(substr(close_date, 1, 4) AS INTEGER) AS y
         FROM deals
         WHERE owner_sub = ? AND stage IN ('won','lost') AND close_date IS NOT NULL
         ORDER BY y`,
      )
      .bind(owner),
    db.prepare(`${ACTIVITY_SELECT} WHERE a.owner_sub = ? ORDER BY a.created_at DESC LIMIT 8`).bind(owner),
    db.prepare(`${TASK_SELECT} WHERE t.owner_sub = ? AND t.done_at IS NULL ORDER BY t.due_at IS NULL, t.due_at ASC LIMIT 6`).bind(owner),
  ])

  const revenueSeries: { label: string; value: number }[] = []
  const byBucket = new Map((revenue.results as { ym: string | number; v: number }[]).map((r) => [String(r.ym), Number(r.v)]))
  // Running total: a loss pulls the previous period's revenue down instead of
  // drawing a separate negative bucket.
  let running = 0
  for (const bucket of buckets) {
    running += byBucket.get(bucket.key) ?? 0
    revenueSeries.push({ label: bucket.label, value: running })
  }
  // Offer every year that has won/lost deals, plus the current and next year.
  const yearSet = new Set<number>((revenueYears.results as { y: number }[]).map((r) => Number(r.y)))
  yearSet.add(year)
  yearSet.add(year + 1)
  const availableYears = [...yearSet].sort((a, b) => a - b)

  const stageRows = stages.results as { stage: DealStage; n: number; v: number }[]
  const body: Overview = {
    kpis: {
      pipelineValue: Number((pipeline.results[0] as { v: number }).v),
      wonThisMonth: Number((wonThis.results[0] as { v: number }).v),
      wonLastMonth: Number((wonLast.results[0] as { v: number }).v),
      openDeals: Number((openDeals.results[0] as { n: number }).n),
      newContacts: Number((newContacts.results[0] as { n: number }).n),
      tasksDue: Number((tasksDue.results[0] as { n: number }).n),
    },
    revenueSeries,
    revenueYears: availableYears,
    stageTotals: (['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as DealStage[]).map((stage) => {
      const row = stageRows.find((r) => r.stage === stage)
      return { stage, count: Number(row?.n ?? 0), value: Number(row?.v ?? 0) }
    }),
    recentActivity: (activity.results as Record<string, unknown>[]).map(mapActivity),
    upcomingTasks: (tasks.results as Record<string, unknown>[]).map(mapTask),
  }
  return privateJson(c, body)
})

workspace.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  if (q.length < 1) return privateJson(c, { contacts: [], companies: [], deals: [] })
  const db = c.get('db')
  const owner = c.get('user').sub
  const like = `%${q.replace(/[%_]/g, '')}%`
  const [contacts, companies, deals] = await db.batch([
    db
      .prepare(
        `SELECT id, first_name, last_name, email, hue FROM contacts WHERE owner_sub = ? AND (first_name || ' ' || last_name LIKE ? OR email LIKE ?) ORDER BY last_activity_at DESC LIMIT 5`,
      )
      .bind(owner, like, like),
    db.prepare(`SELECT id, name, domain, hue FROM companies WHERE owner_sub = ? AND name LIKE ? ORDER BY name LIMIT 5`).bind(owner, like),
    db.prepare(`SELECT id, title, stage, value FROM deals WHERE owner_sub = ? AND title LIKE ? ORDER BY updated_at DESC LIMIT 5`).bind(owner, like),
  ])
  return privateJson(c, {
    contacts: (contacts.results as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      name: `${r.first_name} ${r.last_name}`.trim(),
      email: r.email,
      hue: r.hue,
    })),
    companies: companies.results,
    deals: deals.results,
  })
})
