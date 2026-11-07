import { Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Avatar, Badge, Button, ConfirmDialog, Field, Input, PageHeader, useToast } from '../components/ui'
import { api, useApiMutation, useMe } from '../lib/api'
import { cx } from '../lib/cx'
import { applyTheme, saveTheme, storedTheme, watchSystemTheme, type Theme } from '../lib/theme'

const THEME_OPTIONS = [
  { value: 'system' as const, label: 'System', icon: Monitor },
  { value: 'light' as const, label: 'Light', icon: Sun },
  { value: 'dark' as const, label: 'Dark', icon: Moon },
]

const releaseUrl = (asset: string) => `https://github.com/rubende2013/crm/releases/latest/download/${asset}`
const DESKTOP_DOWNLOADS = [
  {
    os: 'macOS',
    hint: 'Disk image for Apple Silicon or Intel',
    files: [
      { label: 'Apple Silicon', asset: 'Relay-macOS-arm64.dmg' },
      { label: 'Intel', asset: 'Relay-macOS-x64.dmg' },
    ],
  },
  { os: 'Windows', hint: 'Installer for Windows 10 and 11', files: [{ label: 'Download .exe', asset: 'Relay-Windows-x64.exe' }] },
  {
    os: 'Linux',
    hint: 'AppImage or Debian package, 64-bit',
    files: [
      { label: 'AppImage', asset: 'Relay-Linux-x86_64.AppImage' },
      { label: 'Debian', asset: 'Relay-Linux-amd64.deb' },
    ],
  },
]
const downloadLink =
  'inline-flex h-8 items-center justify-center rounded-tile border border-line-strong bg-surface px-3 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2'

export function Settings() {
  const { data: me } = useMe()
  const toast = useToast()
  const [name, setName] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'reset' | 'clear' | null>(null)
  const [theme, setTheme] = useState<Theme>(() => storedTheme())

  useEffect(() => {
    applyTheme(theme)
    return theme === 'system' ? watchSystemTheme() : undefined
  }, [theme])

  const chooseTheme = (next: Theme) => {
    setTheme(next)
    saveTheme(next)
  }

  const rename = useApiMutation((value: string) => api('/workspace', { method: 'PATCH', json: { name: value } }), ['me'], {
    onSuccess: () => toast('Workspace renamed'),
  })
  const reset = useApiMutation(() => api('/workspace/reset', { method: 'POST' }), ['me', 'overview', 'contacts', 'companies', 'deals', 'tasks'], {
    onSuccess: () => {
      setConfirm(null)
      toast('Sample data restored')
    },
  })
  const clear = useApiMutation(() => api('/workspace/data', { method: 'DELETE' }), ['me', 'overview', 'contacts', 'companies', 'deals', 'tasks'], {
    onSuccess: () => {
      setConfirm(null)
      toast('Workspace cleared')
    },
  })

  if (!me) return null
  const value = name ?? me.workspace.name

  return (
    <div className="mx-auto max-w-[720px] p-5 sm:p-8">
      <PageHeader title="Settings" />

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold">Account</h2>
        <div className="mt-3 flex items-center gap-4 rounded-card border border-line p-4">
          <Avatar name={me.user.name ?? me.user.email ?? 'You'} hue={210} src={me.user.picture} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-medium">{me.user.name ?? 'Signed in'}</p>
            {me.user.email && <p className="truncate text-[13px] text-muted">{me.user.email}</p>}
          </div>
          {me.capabilities.auth === 'freebuff' ? (
            <form method="post" action="/auth/freebuff/signout">
              <input type="hidden" name="returnTo" value="/" />
              <Button type="submit">Sign out</Button>
            </form>
          ) : (
            <Badge tone="warning">Development user</Badge>
          )}
        </div>
        {me.capabilities.auth === 'development' && (
          <p className="mt-2 text-[12.5px] text-faint">Sign in with Freebuff is not configured yet. Run the app with FREEBUFF_CLIENT_ID set to use real accounts.</p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold">Workspace</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (value.trim() && value !== me.workspace.name) rename.mutate(value.trim())
          }}
          className="mt-3 flex items-end gap-2"
        >
          <Field label="Name" className="flex-1">
            <Input value={value} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </Field>
          <Button variant="primary" type="submit" loading={rename.isPending} disabled={!value.trim() || value === me.workspace.name}>
            Save
          </Button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold">Connections</h2>
        <ul className="mt-3 divide-y divide-line rounded-card border border-line">
          {[
            ['Database', me.capabilities.database, 'D1 via the DB binding'],
            ['File storage', me.capabilities.files, 'R2 via the FILES binding'],
            ['Sign in with Freebuff', me.capabilities.auth === 'freebuff', 'FREEBUFF_CLIENT_ID'],
          ].map(([label, ok, detail]) => (
            <li key={label as string} className="flex h-13 items-center gap-3 px-4">
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium">{label}</span>
                <span className="block truncate text-[12px] text-faint">{detail}</span>
              </span>
              <Badge tone={ok ? 'success' : 'neutral'} dot>
                {ok ? 'Connected' : 'Not connected'}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold">Appearance</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseTheme(value)}
              aria-pressed={theme === value}
              className={cx(
                'flex h-9 items-center gap-2 rounded-control border px-3 text-[13px] font-medium transition-colors',
                theme === value ? 'border-line-strong bg-surface text-fg shadow-card' : 'border-line text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-faint">System follows the appearance your operating system uses.</p>
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold">Desktop app</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          Relay in its own window. The desktop shell loads this workspace, so sign-in and data stay on the server.
        </p>
        <div className="mt-3 divide-y divide-line rounded-card border border-line">
          {DESKTOP_DOWNLOADS.map((row) => (
            <div key={row.os} className="flex flex-wrap items-center gap-3 p-4">
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium">{row.os}</span>
                <span className="block text-[12.5px] text-muted">{row.hint}</span>
              </span>
              <span className="flex flex-wrap gap-2">
                {row.files.map((file) => (
                  <a key={file.asset} href={releaseUrl(file.asset)} target="_blank" rel="noreferrer" className={downloadLink}>
                    {file.label}
                  </a>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-faint">
          Builds are unsigned: on macOS open the app once with right-click → Open, on Windows SmartScreen asks for confirmation.{' '}
          <a href="https://github.com/rubende2013/crm/releases/latest" target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-fg">
            All releases
          </a>
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-[14px] font-semibold">Data</h2>
        <div className="mt-3 divide-y divide-line rounded-card border border-line">
          <div className="flex items-center gap-3 p-4">
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">Restore sample data</span>
              <span className="block text-[12.5px] text-muted">Replaces everything with the starter companies, contacts and deals.</span>
            </span>
            <Button onClick={() => setConfirm('reset')}>Restore</Button>
          </div>
          <div className="flex items-center gap-3 p-4">
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">Clear workspace</span>
              <span className="block text-[12.5px] text-muted">Deletes every record and file. This cannot be undone.</span>
            </span>
            <Button variant="danger" onClick={() => setConfirm('clear')}>
              Clear
            </Button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={confirm === 'reset'}
        onClose={() => setConfirm(null)}
        onConfirm={() => reset.mutate(undefined)}
        loading={reset.isPending}
        title="Restore sample data?"
        description="Everything in the workspace is replaced with the starter data."
        confirmLabel="Restore"
      />
      <ConfirmDialog
        open={confirm === 'clear'}
        onClose={() => setConfirm(null)}
        onConfirm={() => clear.mutate(undefined)}
        loading={clear.isPending}
        title="Clear the workspace?"
        description="Every contact, company, deal, task, note and file is deleted."
        confirmLabel="Clear everything"
      />
    </div>
  )
}
