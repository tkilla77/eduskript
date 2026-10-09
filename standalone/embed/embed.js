/**
 * learning-widget embed — reference host for the learning-widget/0.1 protocol
 * (SPIKE). Plain JS, no imports, no build step: meant to be read in full and
 * vendored as a pinned copy by the host. Protocol: standalone/shared/protocol.ts.
 *
 * Usage (load as a module so the elements are parsed when it runs):
 *
 *   <script type="module" src="embed.js"></script>
 *   <learning-widget src="https://widgets.example/kara/" id="level-3" group="week-1">
 *     <script type="text/plain">…level text…</script>
 *   </learning-widget>
 *   <learning-widget src="https://widgets.example/quiz/" type="single">
 *     <template><question-prompt>…</question-prompt><answer correct="true">…</answer></template>
 *   </learning-widget>
 *
 * Reserved attributes: src, id (instance id; default: position on the page),
 * mode (normal | browse | review), group (state shared between embeds; default:
 * the page path), height (initial px), theme (light | dark; default: the
 * page's `dark` class, else prefers-color-scheme). Every other attribute is
 * passed to the widget as config.attributes. Body: the <template>'s innerHTML,
 * else a <script type="text/plain">'s text, else the element's innerHTML.
 * Hide the raw body until this script runs:
 *   learning-widget:not(:defined) { display: none }
 *
 * Events (bubble) on the element: `widget-submit`, detail = { instanceId,
 * response, score } — score is self-reported by the widget, never trust it
 * for grading without checking the response; `widget-attempt`, detail =
 * { instanceId, event } — a try that is not a submission (Kara: a single Run).
 *
 * Trust model. This script runs with the host page's rights, so the host must
 * trust it (vendor it, or pin it with an integrity hash). It does NOT trust the
 * widgets:
 *   - each widget runs in <iframe sandbox="allow-scripts">: opaque origin, no
 *     access to this page, its cookies or storage; no top navigation, no popups;
 *   - only messages whose sender is one of its own iframes are handled (origin
 *     is "null" for all of them, so the sender window is the check), and only
 *     the message types below, with their fields type-checked;
 *   - nothing a widget sends is evaluated or inserted as HTML; the only effects
 *     are: localStorage writes under this widget's own prefix (size-capped),
 *     the iframe's height (clamped), and the widget-submit/-attempt events;
 *   - storage is namespaced by widget URL, so one widget cannot read another
 *     widget's state. Embeds of the SAME widget URL on this site can address
 *     each other's group state by naming the group, by design.
 * What it cannot stop: data handed to a widget (config, its saved state) can
 * be sent anywhere by the widget — pass nothing personal. Messages to a frame
 * go with targetOrigin '*' (an opaque origin cannot be targeted).
 */

const PROTOCOL = 'learning-widget/0.1'
const PREFIX = 'lw:'
const MAX_STATE_BYTES = 256 * 1024
const MAX_KEY_LENGTH = 200
const MAX_HEIGHT = 4000
const RESERVED = new Set(['src', 'id', 'mode', 'group', 'height', 'theme', 'class', 'style'])
const MODES = new Set(['normal', 'browse', 'review'])

/** contentWindow → embed record */
const embeds = new Map()

// ─── storage (host page's localStorage; memory if blocked) ─────────────────

const memory = new Map()
const store = {
  get(k) {
    try { return localStorage.getItem(k) } catch { return memory.get(k) ?? null }
  },
  set(k, v) {
    try { localStorage.setItem(k, v) } catch { memory.set(k, v) }
  },
}

function recordKey(embed, scope, key) {
  const owner = scope === 'group' ? `group:${embed.group}` : `instance:${location.pathname}#${embed.instanceId}`
  return `${PREFIX}${embed.widget}|${owner}|${key}`
}

// ─── messages ──────────────────────────────────────────────────────────────

function post(embed, msg) {
  embed.iframe.contentWindow?.postMessage({ protocol: PROTOCOL, ...msg }, '*')
}

const isScope = s => s === 'instance' || s === 'group'
const isKey = k => typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY_LENGTH
const isNum = n => typeof n === 'number' && Number.isFinite(n)

window.addEventListener('message', (e) => {
  const embed = embeds.get(e.source)
  if (!embed) return
  const m = e.data
  if (!m || typeof m !== 'object' || m.protocol !== PROTOCOL) return

  switch (m.type) {
    case 'ready':
      post(embed, { type: 'init', init: embed.init })
      break

    case 'getState': {
      if (!isNum(m.id) || !isScope(m.scope) || !isKey(m.key)) return
      const raw = store.get(recordKey(embed, m.scope, m.key))
      post(embed, { type: 'state', id: m.id, data: raw === null ? null : JSON.parse(raw) })
      break
    }

    case 'saveState': {
      if (!isScope(m.scope) || !isKey(m.key)) return
      const raw = JSON.stringify(m.data ?? null)
      if (raw.length > MAX_STATE_BYTES) return console.warn('[learning-widget] state too large, not saved')
      const k = recordKey(embed, m.scope, m.key)
      store.set(k, raw)
      broadcast(k, m.scope, m.key, m.data ?? null)
      break
    }

    case 'submit': {
      const s = m.score
      const score = s && isNum(s.raw) && isNum(s.min) && isNum(s.max) && isNum(s.scaled)
        ? { raw: s.raw, min: s.min, max: s.max, scaled: s.scaled }
        : undefined
      embed.el.dispatchEvent(new CustomEvent('widget-submit', {
        bubbles: true,
        detail: { instanceId: embed.instanceId, response: m.response, score },
      }))
      break
    }

    case 'attempt':
      embed.el.dispatchEvent(new CustomEvent('widget-attempt', {
        bubbles: true,
        detail: { instanceId: embed.instanceId, event: m.event },
      }))
      break

    case 'resize':
      if (!isNum(m.height)) return
      embed.iframe.style.height = `${Math.min(MAX_HEIGHT, Math.max(40, Math.ceil(m.height)))}px`
      break
  }
})

/** Tell every embed that can read record `k` (itself, others in the group) about a save. */
function broadcast(k, scope, key, data) {
  for (const other of embeds.values()) {
    if (recordKey(other, scope, key) === k) post(other, { type: 'stateChanged', scope, key, data })
  }
}

// Saves from another tab of this site.
window.addEventListener('storage', (e) => {
  if (!e.key?.startsWith(PREFIX) || e.newValue === null) return
  for (const embed of embeds.values()) {
    for (const scope of ['instance', 'group']) {
      const prefix = recordKey(embed, scope, '')
      if (e.key.startsWith(prefix)) post(embed, { type: 'stateChanged', scope, key: e.key.slice(prefix.length), data: JSON.parse(e.newValue) })
    }
  }
})

// ─── theme ─────────────────────────────────────────────────────────────────

const darkQuery = matchMedia('(prefers-color-scheme: dark)')

function themeOf(el) {
  const attr = el.getAttribute('theme')
  if (attr === 'light' || attr === 'dark') return attr
  if (document.documentElement.classList.contains('dark')) return 'dark'
  return darkQuery.matches ? 'dark' : 'light'
}

darkQuery.addEventListener('change', () => {
  for (const embed of embeds.values()) {
    const theme = themeOf(embed.el)
    if (theme !== embed.init.theme) post(embed, { type: 'themeChanged', theme: (embed.init.theme = theme) })
  }
})

// ─── the element ───────────────────────────────────────────────────────────

let counter = 0

function readBody(el) {
  const template = el.querySelector(':scope > template')
  if (template) return template.innerHTML.trim()
  const script = el.querySelector(':scope > script[type="text/plain"]')
  if (script) return script.textContent.replace(/^\n/, '').replace(/\n\s*$/, '\n')
  return el.innerHTML.trim()
}

class LearningWidget extends HTMLElement {
  connectedCallback() {
    if (this.embed) {
      // Moved in the DOM: the iframe reloads with a new window.
      this.embed.window = this.embed.iframe.contentWindow
      embeds.set(this.embed.window, this.embed)
      return
    }
    // Module scripts run after parsing, but an element added later by script
    // may still be filling in its children: wait for the document.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.connectedCallback(), { once: true })
      return
    }
    const srcAttr = this.getAttribute('src')
    if (!srcAttr) return console.warn('[learning-widget] missing src', this)
    const src = new URL(srcAttr, document.baseURI)

    const attributes = {}
    for (const a of this.attributes) if (!RESERVED.has(a.name)) attributes[a.name] = a.value
    const mode = this.getAttribute('mode')
    const index = counter++
    const instanceId = this.id || `w${index}`

    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.setAttribute('loading', 'lazy')
    iframe.title = this.getAttribute('title') || `Learning widget ${index + 1}`
    iframe.src = src.href
    iframe.style.cssText = `display:block;width:100%;border:0;height:${Number(this.getAttribute('height')) || 200}px`

    this.embed = {
      el: this,
      iframe,
      instanceId,
      widget: src.origin + src.pathname,
      group: this.getAttribute('group') || location.pathname,
      init: {
        protocol: PROTOCOL,
        instanceId,
        mode: MODES.has(mode) ? mode : 'normal',
        config: { attributes, body: readBody(this) },
        theme: themeOf(this),
        capabilities: ['state', 'submit'],
      },
    }
    this.replaceChildren(iframe)
    // contentWindow exists once the iframe is in the document; kept, because
    // it is null again by the time disconnectedCallback runs.
    this.embed.window = iframe.contentWindow
    embeds.set(this.embed.window, this.embed)
  }

  disconnectedCallback() {
    if (this.embed) embeds.delete(this.embed.window)
  }
}

if (!customElements.get('learning-widget')) customElements.define('learning-widget', LearningWidget)
