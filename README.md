# Relay

A complete, single-workspace CRM: overview dashboard, contacts, companies, a
drag-and-drop deal board, tasks, notes and file attachments. It runs on
Freebuff Sites with Sign in with Freebuff, D1 for data and R2 for files, and
every record is scoped to the signed-in user.

## Run it

```sh
bun install
bun run dev        # http://localhost:5173 with local D1 and R2 (Miniflare)
bun run build      # dist/client (assets) + dist/relay/index.js (Worker)
```

On localhost without a `FREEBUFF_CLIENT_ID`, the app signs you in as a local
development user so everything works before auth is provisioned. A new
workspace starts empty; Settings can load sample data or clear everything.

## Connect it to Freebuff

1. `sites_create`, then `sites_add_storage` for D1 named `DB` and R2 named `FILES`.
2. `sites_enable_auth` (pass `http://localhost:5173` as the local origin while
   developing). Copy the development variables into `.dev.vars` (see
   `.dev.vars.example`) to use real accounts locally.
3. `bun run build`, then `sites_deploy` with `deploy.json`. The deploy injects
   `FREEBUFF_CLIENT_ID`, `FREEBUFF_ISSUER` and `APP_ORIGIN`, and attaches the
   `DB` and `FILES` bindings.

If a binding is missing the app says so instead of failing: Settings shows what
is connected, and file uploads are hidden until R2 is attached.

## What is inside

- **Overview** — pipeline and revenue KPIs, a six-month won-revenue chart, stage
  totals, recent activity and the next few follow-ups.
- **Contacts** — searchable, filterable, paginated people with status, photo,
  company, notes, deals and files. Contacts link both ways into companies.
  CSV import matches on email (updating instead of duplicating) and creates
  missing companies; CSV export downloads the current list.
- **Companies** — account cards with people, pipeline and full activity history.
- **Deals** — a six-stage board you can drag between columns (positions are
  persisted), plus a list view and a detail drawer with notes and attachments.
- **Tasks** — grouped into overdue, today, this week, later and done, linked to
  the person or deal they belong to.
- **Search** — `⌘K` / `Ctrl+K` across contacts, companies and deals.

## Where things are

- `src/worker/` is the Hono API. `db.ts` owns the schema (created on first
  request), `seed.ts` the sample data, `auth.ts` the Freebuff integration and
  the loopback-only development user, `routes/*` the endpoints.
- `src/app/` is the React app. `components/ui.tsx` holds the primitives
  (buttons, inputs, dialogs, drawer, menus, toasts); `pages/*` the screens;
  `lib/api.ts` the data hooks (TanStack Query).
- `src/shared/types.ts` is the contract between the two.
- `src/styles.css` holds the design tokens. Everything rounded is a squircle
  via `corner-shape`; true circles use the `round` class.

## Security notes

Every `/api/*` route requires a signed-in user and scopes queries by
`owner_sub`. Mutations must be same-origin (`isSameOriginRequest`). Files are
addressed by database row, never by R2 key, so one user cannot read another's.
Personalised responses are `Cache-Control: private, no-store`.

## Contributing

Issues and pull requests are welcome. Run `bun install` and `bun run typecheck`
before opening a PR; keep the worker and the app talking through
`src/shared/types.ts`.

## License

MIT — see [LICENSE](LICENSE). You may use, modify and redistribute Relay,
including commercially, as long as the copyright notice is kept.
