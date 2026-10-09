/**
 * SPIKE — entry point of the stand-alone Kara widget. Installs the no-host
 * adapter (shared/boot.ts) and Kara's own host interface on top of it.
 */

import { createRoot } from 'react-dom/client'
import { setKaraHost } from '@/lib/kara/host'
import { bootNoHost } from '../shared/boot'
import { KaraWidget } from './widget'
import '../shared/styles.css'

const host = bootNoHost('demo')

// Kara's own host interface (src/lib/kara/host.ts), backed by the widget host.
// Built-in assets resolve next to the build root, not at the domain root.
const root = new URL('../', document.baseURI)
setKaraHost({
  getState: (scope, key) => host.getState(scope, key),
  saveState: (scope, key, data) => host.saveState(scope, key, data),
  onStateChanged: (scope, key, cb) => host.onStateChanged(scope, key, cb),
  assetUrl: path => new URL(`.${path}`, root).href,
  tilesetUrl: () => new URLSearchParams(location.search).get('tiles') ?? '',
})

createRoot(document.getElementById('root')!).render(<KaraWidget />)
