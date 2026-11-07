import { Hono } from 'hono'

import { requireUser } from './auth'
import { requireDb } from './db'
import type { AppContext, Env } from './env'
import { activities } from './routes/activities'
import { companies } from './routes/companies'
import { contacts } from './routes/contacts'
import { deals } from './routes/deals'
import { files } from './routes/files'
import { importExport } from './routes/importExport'
import { tasks } from './routes/tasks'
import { workspace } from './routes/workspace'

const app = new Hono<AppContext>()

// Public: lets the app know how to sign in before any private call.
app.get('/api/auth/status', (c) => {
  c.header('Cache-Control', 'private, no-store')
  return c.json({ mode: 'local', database: Boolean(c.env.DB), files: Boolean(c.env.FILES) })
})

app.get('/api/health', (c) => c.json({ ok: true }))

const api = new Hono<AppContext>()
api.use('*', requireDb, requireUser)
api.route('/', workspace)
api.route('/contacts', contacts)
api.route('/companies', companies)
api.route('/deals', deals)
api.route('/tasks', tasks)
api.route('/activities', activities)
api.route('/files', files)
api.route('/data', importExport)
app.route('/api', api)

app.onError((error, c) => {
  console.error(error)
  return c.json({ error: 'Something went wrong.' }, 500)
})

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.env.ASSETS.fetch(c.req.raw)))

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return Promise.resolve(app.fetch(request, env, ctx))
  },
}
