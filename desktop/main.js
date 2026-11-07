const { app, BrowserWindow, shell } = require('electron')

// The desktop shell is a thin wrapper: the workspace, database and sign-in all
// live on the deployed app, so the window just loads that origin. Point a local
// build somewhere else with RELAY_APP_URL.
const DEFAULT_APP_URL = 'https://site-dbf0843ca8604a209e1ff80638c87f51.freebuff.page'

function appUrl() {
  try {
    return new URL(process.env.RELAY_APP_URL || DEFAULT_APP_URL)
  } catch {
    return new URL(DEFAULT_APP_URL)
  }
}

function openInBrowser(url) {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'https:' || protocol === 'http:') shell.openExternal(url).catch(() => {})
  } catch {
    // Ignore malformed URLs instead of failing the window.
  }
}

function createWindow() {
  const target = appUrl()
  const window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#fbfbfa',
    autoHideMenuBar: true,
    title: 'Relay',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })

  // Avoid a white flash before the app paints.
  window.once('ready-to-show', () => window.show())
  window.loadURL(target.toString())

  // GitHub releases, docs and other external links open in the default browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
  })

  // Keep the window on the app itself; anything else is handed to the browser.
  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === target.origin) return
    } catch {
      // Fall through and block the navigation.
    }
    event.preventDefault()
    openInBrowser(url)
  })

  return window
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.relay.crm')
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
