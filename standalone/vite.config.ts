/**
 * SPIKE — stand-alone static builds of Eduskript widgets (one page each).
 *
 *   pnpm exec vite build   --config standalone/vite.config.ts
 *   pnpm exec vite preview --config standalone/vite.config.ts --port 4317
 *   → /kara/index.html, /quiz/index.html   widgets (configurable via embed.js)
 *     /embed.js                           reference host script, copied as is
 *     /demo/index.html                    plain HTML page using embed.js
 *
 * Reuses the app sources via the `@` alias. `@/lib/kara/host-inpage` (the
 * Eduskript adapter) is swapped for a stub; kara/main.tsx installs the real
 * host with setKaraHost (src/lib/kara/host.ts).
 */

import { defineConfig, type Plugin } from 'vite'
import { cpSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(here, '../src')
const outDir = path.resolve(here, 'dist')

// embed.js and the demo page are plain files, not part of the widget bundles:
// copied unchanged so the host script stays readable and vendorable. Kara's
// built-in art (public/kara: sprites, portraits, sfx) lands next to the Kara
// page, where kara/main.tsx resolves `/kara/...` asset paths.
const copyPlain: Plugin = {
  name: 'copy-plain-files',
  closeBundle() {
    cpSync(path.resolve(here, '../public/kara'), path.resolve(outDir, 'kara'), { recursive: true })
    cpSync(path.resolve(here, 'embed/embed.js'), path.resolve(outDir, 'embed.js'))
    cpSync(path.resolve(here, 'widgets.htaccess'), path.resolve(outDir, '.htaccess'))
    cpSync(path.resolve(here, 'demo'), path.resolve(outDir, 'demo'), { recursive: true })
  },
}

export default defineConfig({
  root: here,
  base: './',
  plugins: [react(), copyPlain],
  // public/ is the app's; the widgets only need public/kara (copied below).
  publicDir: false,
  resolve: {
    alias: [
      { find: /^@\/lib\/kara\/host-inpage$/, replacement: path.resolve(here, 'shims/host-inpage.ts') },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  css: { postcss: path.resolve(here, '..') },
  // A sandboxed iframe (no allow-same-origin) has origin "null"; module
  // scripts and crossorigin CSS then need CORS from whatever serves the files.
  preview: { headers: { 'Access-Control-Allow-Origin': '*' } },
  build: {
    outDir,
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        kara: path.resolve(here, 'kara/index.html'),
        quiz: path.resolve(here, 'quiz/index.html'),
      },
    },
  },
})
