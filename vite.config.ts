import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Hostnames a hosted dev preview reaches this server on. Set per process
// (PREVIEW_ALLOWED_HOSTS=a.example,b.example) so no hostname is committed;
// unset locally, where only localhost needs to be allowed.
declare const process: { env: Record<string, string | undefined> }
const allowedHosts = (process.env.PREVIEW_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: { port: 5173, strictPort: false, allowedHosts },
})
