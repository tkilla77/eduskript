/**
 * SPIKE — builds the widget's init from the page, as a stand-in for what an
 * embedding host would send:
 *   <script type="application/json" id="widget-attrs">  embed attributes
 *   <template id="widget-body"> or <script type="text/plain" id="widget-body">
 *                                                       embed body (HTML / text)
 *   ?id=<instance>  ?mode=normal|browse|review          URL parameters
 * Installs the no-host adapter and the dark-mode class.
 */

import { createNoHost, setHost, type WidgetHost, type WidgetMode } from './host'

export function bootNoHost(defaultId: string): WidgetHost {
  const params = new URLSearchParams(location.search)
  const bodyEl = document.getElementById('widget-body')
  const body = bodyEl instanceof HTMLTemplateElement ? bodyEl.innerHTML : bodyEl?.textContent ?? ''
  const attributes = JSON.parse(document.getElementById('widget-attrs')?.textContent || '{}') as Record<string, string>
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)

  const host = createNoHost({
    instanceId: params.get('id') ?? defaultId,
    mode: (params.get('mode') as WidgetMode | null) ?? 'normal',
    config: { attributes, body },
    theme: dark ? 'dark' : 'light',
  })
  setHost(host)
  return host
}
