/**
 * SPIKE — entry point. Reads the level from the page (stand-in for what an
 * embedding host would pass in init) and mounts the widget on the no-host
 * adapter.
 */

import { createRoot } from 'react-dom/client'
import { setKaraHost } from '@/lib/kara/host'
import { createNoHost, setHost } from './host'
import { KaraWidget } from './widget'
import './styles.css'

const params = new URLSearchParams(location.search)
const body = document.getElementById('level')?.textContent ?? ''
const dark = matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.classList.toggle('dark', dark)

const host = createNoHost({
  instanceId: params.get('id') ?? 'demo',
  mode: 'normal',
  config: { attributes: {}, body },
  theme: dark ? 'dark' : 'light',
})
setHost(host)

// Kara's own host interface (src/lib/kara/host.ts), backed by the widget host.
// Built-in assets resolve next to this page, not at the domain root.
setKaraHost({
  getState: (scope, key) => host.getState(scope, key),
  saveState: (scope, key, data) => host.saveState(scope, key, data),
  onStateChanged: (scope, key, cb) => host.onStateChanged(scope, key, cb),
  assetUrl: path => new URL(`.${path}`, document.baseURI).href,
  tilesetUrl: () => params.get('tiles') ?? '',
})

createRoot(document.getElementById('root')!).render(<KaraWidget />)
