/**
 * SPIKE — entry point of the stand-alone Kara widget. Connects to the host
 * (shared/boot.ts) and installs Kara's own host interface on top of it.
 */

import { createRoot } from 'react-dom/client'
import { setKaraHost } from '@/lib/kara/host'
import { bootHost } from '../shared/boot'
import { KaraWidget } from './widget'
import '../shared/styles.css'

void bootHost('demo').then(host => {
  // Kara's own host interface (src/lib/kara/host.ts), backed by the widget
  // host. Kara only stores course-wide progress through it (scope = the
  // skriptId prop, "group" here), so every scope maps to the host's group.
  // Built-in assets resolve next to the build root, not at the domain root.
  const root = new URL('../', document.baseURI)
  setKaraHost({
    getState: (_scope, key) => host.getState('group', key),
    saveState: (_scope, key, data) => host.saveState('group', key, data),
    onStateChanged: (_scope, key, cb) => host.onStateChanged('group', key, cb),
    assetUrl: path => new URL(`.${path}`, root).href,
    // Tileset: the embed's `tiles` attribute, else ?tiles=, else the copy
    // deployed next to the widgets (dist/kara-tiles; 404 → placeholders).
    tilesetUrl: () => host.init.config.attributes.tiles
      ?? new URLSearchParams(location.search).get('tiles')
      ?? new URL('kara-tiles', root).href,
  })
  createRoot(document.getElementById('root')!).render(<KaraWidget />)
})
