/**
 * SPIKE — picks the transport and builds the widget's host:
 *
 *   1. `#config=<base64url JSON>` in the URL: a plain <iframe src> without a
 *      host script. No-host adapter (no persistence inside a sandbox).
 *      JSON: { attributes?, body?, id?, mode? } — see encodeConfig.
 *   2. Inside a frame: postMessage to the parent (embed.js). Waits for init.
 *   3. Otherwise (page opened directly, or a frame whose parent never
 *      answers): the demo config embedded in the widget's own index.html:
 *        <script type="application/json" id="widget-attrs">  attributes
 *        <template id="widget-body"> / <script type="text/plain" id="widget-body">
 *        ?id=<instance>  ?mode=normal|browse|review
 *
 * Also applies the theme (`dark` class) and follows themeChanged.
 */

import { connectPostMessageHost, createNoHost, setHost, type WidgetHost, type WidgetMode } from './host'

interface FragmentConfig {
  attributes?: Record<string, string>
  body?: string
  id?: string
  mode?: WidgetMode
}

/** UTF-8 JSON → base64url, for `#config=` links (the inverse of readFragment). */
export function encodeConfig(c: FragmentConfig): string {
  const bytes = new TextEncoder().encode(JSON.stringify(c))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function readFragment(): FragmentConfig | null {
  const m = location.hash.match(/^#config=([A-Za-z0-9_-]+)$/)
  if (!m) return null
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as FragmentConfig
  } catch {
    return null
  }
}

function readPage(defaultId: string): FragmentConfig {
  const params = new URLSearchParams(location.search)
  const bodyEl = document.getElementById('widget-body')
  return {
    attributes: JSON.parse(document.getElementById('widget-attrs')?.textContent || '{}'),
    body: bodyEl instanceof HTMLTemplateElement ? bodyEl.innerHTML : bodyEl?.textContent ?? '',
    id: params.get('id') ?? defaultId,
    mode: (params.get('mode') as WidgetMode | null) ?? 'normal',
  }
}

export async function bootHost(defaultId: string): Promise<WidgetHost> {
  const fragment = readFragment()
  const host = (!fragment && await connectPostMessageHost()) || noHost(fragment ?? readPage(defaultId), defaultId)
  setHost(host)
  const applyTheme = (t: string) => document.documentElement.classList.toggle('dark', t === 'dark')
  applyTheme(host.init.theme)
  host.onThemeChanged(applyTheme)
  return host
}

function noHost(c: FragmentConfig, defaultId: string): WidgetHost {
  return createNoHost({
    instanceId: c.id ?? defaultId,
    mode: c.mode ?? 'normal',
    config: { attributes: c.attributes ?? {}, body: c.body ?? '' },
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  })
}
