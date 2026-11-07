export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'relay-theme'

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // Private mode or blocked storage: fall back to the system preference.
  }
  return 'system'
}

function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolvedTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme
}

export function applyTheme(theme: Theme) {
  const resolved = resolvedTheme(theme)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b0b0e' : '#f6f6f7')
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Keep the in-memory choice even when storage is unavailable.
  }
  applyTheme(theme)
}

// Only follow the operating system while the saved choice is "system".
export function watchSystemTheme() {
  const query = matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (storedTheme() === 'system') applyTheme('system')
  }
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
