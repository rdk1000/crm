export interface Env {
  ASSETS: Fetcher
  // Attached by Freebuff Sites once provisioned (sites_add_storage). Optional so
  // the app can explain what is missing instead of crashing.
  DB?: D1Database
  FILES?: R2Bucket
  // Public origin of the deployment, used for the mutation origin check.
  APP_ORIGIN?: string
}

export type Variables = {
  user: { sub: string; name?: string; email?: string; picture?: string }
  db: D1Database
}

export type AppContext = { Bindings: Env; Variables: Variables }
