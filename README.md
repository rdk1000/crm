# Relay

A complete, single-workspace CRM: overview dashboard, contacts, companies, a
drag-and-drop deal board, tasks, notes and file attachments. It runs on
Freebuff Sites with Sign in with Freebuff, D1 for data and R2 for files, and
every record is scoped to the signed-in user.

## Download

Ready-to-install desktop builds, straight from the latest release:

| Platform | Download |
| --- | --- |
| macOS (Apple Silicon) | [Relay-macOS-arm64.dmg](https://github.com/rubende2013/crm/releases/latest/download/Relay-macOS-arm64.dmg) |
| macOS (Intel) | [Relay-macOS-x64.dmg](https://github.com/rubende2013/crm/releases/latest/download/Relay-macOS-x64.dmg) |
| Windows 10/11 | [Relay-Windows-x64.exe](https://github.com/rubende2013/crm/releases/latest/download/Relay-Windows-x64.exe) |
| Linux (AppImage) | [Relay-Linux-x86_64.AppImage](https://github.com/rubende2013/crm/releases/latest/download/Relay-Linux-x86_64.AppImage) |
| Linux (Debian/Ubuntu) | [Relay-Linux-amd64.deb](https://github.com/rubende2013/crm/releases/latest/download/Relay-Linux-amd64.deb) |

Every installer is listed with its SHA-256 digest in
[SHA256SUMS.txt](https://github.com/rubende2013/crm/releases/latest/download/SHA256SUMS.txt).
After downloading, verify the files you got:

```sh
sha256sum -c SHA256SUMS.txt     # macOS: shasum -a 256 -c SHA256SUMS.txt
```

The builds are unsigned (macOS: right-click → Open the first time, Windows:
SmartScreen confirmation) and update themselves after the first install. The
download code lives in [Settings](src/app/pages/Settings.tsx),
[`desktop/`](desktop) and [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml).

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

## Desktop app

The desktop shell in `desktop/` is a small Electron wrapper around the deployed
app, so the database, files and sign-in stay on the server. Builds are produced
by `.github/workflows/desktop.yml` on every `v*` tag and attached to a GitHub
release:

| Platform | File |
| --- | --- |
| macOS (Apple Silicon / Intel) | `Relay-macOS-arm64.dmg`, `Relay-macOS-x64.dmg` |
| Windows 10/11 | `Relay-Windows-x64.exe` |
| Linux (x64) | `Relay-Linux-x86_64.AppImage`, `Relay-Linux-amd64.deb` |

Download the latest from <https://github.com/rubende2013/crm/releases/latest>,
or use the Desktop app section in Settings. The builds are unsigned, so macOS
needs right-click → Open the first time and Windows shows a SmartScreen prompt.

### Updates

Packaged builds check the GitHub release feed on launch and every six hours,
download a newer version in the background and ask to restart when it is ready.
The release also ships the `latest*.yml` metadata the updater reads, plus a
`.zip` next to each macOS `.dmg`. Windows and the Linux AppImage update in place;
the `.deb` is updated through the package manager instead. macOS needs a signed
and notarised build for Squirrel to accept an update — unsigned builds log the
failure and keep running, and users install the new `.dmg` by hand.

Build locally (only the current platform can be produced):

```sh
cd desktop
npm install
npm run dist:linux     # or dist:mac / dist:win
```

The window loads the deployed workspace; set `RELAY_APP_URL` to point a local
build at another deployment.

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
