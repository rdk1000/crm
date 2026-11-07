import type { Context, MiddlewareHandler } from 'hono'

import type { AppContext, Env } from './env'

// Relay has no accounts: every deployment is one shared workspace. On a fresh
// database the owner is "local"; if workspaces already exist (for example one
// created before sign-in was removed) the oldest is reused so its data stays.
const LOCAL_OWNER = 'local'

export function appOrigin(env: Env, request: Request): string {
  if (env.APP_ORIGIN) return env.APP_ORIGIN
  const url = new URL(request.url)
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwarded === 'https' || forwarded === 'http') url.protocol = `${forwarded}:`
  else {
    // A TLS-terminating preview proxy forwards plain http to us while the
    // browser sends an https Origin for that same host. Adopt its scheme so
    // same-origin writes work there; foreign hosts still fail the check.
    const origin = request.headers.get('origin')
    if (origin && origin !== 'null') {
      try {
        const parsed = new URL(origin)
        if (parsed.host === url.host) return parsed.origin
      } catch {
        // Malformed Origin: fall through to our own origin.
      }
    }
  }
  return url.origin
}

/**
 * Mutations must come from this deployment. Requests without an Origin header
 * (curl, scripts) are allowed; a mismatching browser origin is refused.
 */
export function isSameOrigin(request: Request, origin: string): boolean {
  const header = request.headers.get('origin')
  if (!header) return true
  if (header === 'null') return false
  try {
    return new URL(header).origin === origin
  } catch {
    return false
  }
}

export async function resolveOwner(db: D1Database): Promise<string> {
  const row = await db.prepare(`SELECT owner_sub FROM workspaces ORDER BY created_at ASC LIMIT 1`).first<{ owner_sub: string }>()
  return row?.owner_sub ?? LOCAL_OWNER
}

/** Attaches the shared workspace owner and refuses cross-origin mutations. */
export const requireUser: MiddlewareHandler<AppContext> = async (c, next) => {
  const request = c.req.raw
  if (request.method !== 'GET' && request.method !== 'HEAD' && !isSameOrigin(request, appOrigin(c.env, request))) {
    return c.json({ error: 'Cross-origin request refused.' }, 403)
  }
  c.set('user', { sub: await resolveOwner(c.get('db')) })
  await next()
}

export function privateJson<T>(c: Context<AppContext>, body: T, status = 200) {
  c.header('Cache-Control', 'private, no-store')
  return c.json(body as never, status as never)
}
