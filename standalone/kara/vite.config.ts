/**
 * SPIKE — stand-alone static build of the Kara widget.
 *
 *   pnpm exec vite build --config standalone/kara/vite.config.ts
 *   pnpm exec vite --config standalone/kara/vite.config.ts      (dev)
 *
 * Reuses the app sources via the `@` alias. `@/lib/kara/host-inpage` (the
 * Eduskript adapter) is swapped for a stub; main.tsx installs the real host
 * with setKaraHost (src/lib/kara/host.ts).
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(here, '../../src')

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  // Only public/kara is needed, but publicDir takes one directory, so all of
  // public/ (3.6 MB) is copied. A real build target should copy public/kara only.
  publicDir: path.resolve(here, '../../public'),
  resolve: {
    alias: [
      { find: /^@\/lib\/kara\/host-inpage$/, replacement: path.resolve(here, 'shims/host-inpage.ts') },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  css: { postcss: path.resolve(here, '../..') },
  // A sandboxed iframe (no allow-same-origin) has origin "null"; module
  // scripts and crossorigin CSS then need CORS from whatever serves the files.
  preview: { headers: { 'Access-Control-Allow-Origin': '*' } },
  build: { outDir: path.resolve(here, 'dist'), emptyOutDir: true },
})
