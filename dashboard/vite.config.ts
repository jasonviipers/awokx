import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Use the same port `wrangler dev` uses (its "dev.port" setting), so the proxy can't
 * silently hit another local project that happens to run on the default 8787.
 */
function wranglerDevPort(): string {
  for (const name of ['wrangler.json', 'wrangler.jsonc']) {
    const file = fileURLToPath(new URL(`../${name}`, import.meta.url))
    if (!existsSync(file)) continue
    const match = readFileSync(file, 'utf8').match(/"dev"\s*:\s*\{[^}]*"port"\s*:\s*(\d+)/)
    if (match) return match[1]
  }
  return '8787'
}

// 127.0.0.1, not "localhost": Node resolves localhost to ::1 first, but wrangler listens on IPv4.
const apiTarget = process.env.MAHORAGA_API_URL || `http://127.0.0.1:${process.env.WRANGLER_PORT || wranglerDevPort()}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, '/agent'),
      },
    },
  },
})
