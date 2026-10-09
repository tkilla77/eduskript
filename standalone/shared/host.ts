/**
 * SPIKE — widget host interface, v0.1 draft, and its widget-side adapters.
 *
 * Widget code talks to `WidgetHost`, never to a transport. Adapters:
 *   - createNoHost:          browser storage only (page opened directly, or a
 *                            #config= fragment without a host script)
 *   - createPostMessageHost: inside an iframe created by embed.js (or any host
 *                            speaking the protocol in protocol.ts)
 * Eduskript's own in-page adapter for Kara lives in src/lib/kara/host-inpage.ts.
 *
 * State scopes: widgets say *what* the state belongs to, the host decides
 * *where* it goes. `instance` = this embed (quiz answer, Kara code); `group` =
 * shared by the embeds of a group the host defines (Kara stars and evidence;
 * Eduskript: the skript, embed.js: the `group` attribute or the page).
 */

import { PROTOCOL, type HostMessage, type WidgetMessage } from './protocol'

export type WidgetMode = 'normal' | 'browse' | 'review'
export type StateScope = 'instance' | 'group'
export type Theme = 'light' | 'dark'

export interface WidgetInit {
  protocol: typeof PROTOCOL
  instanceId: string
  mode: WidgetMode
  /** Embed attributes plus the embed body (Kara: level text; quiz: host-rendered HTML). */
  config: { attributes: Record<string, string>; body: string }
  theme: Theme
  /** What the host offers, e.g. 'state', 'submit'. */
  capabilities: string[]
}

export interface WidgetSubmission {
  /** Raw response, always sent so the host can review or regrade. */
  response: unknown
  /** Self-reported by client code; the host must not trust it blindly. */
  score?: { raw: number; min: number; max: number; scaled: number }
}

export interface WidgetHost {
  init: WidgetInit
  getState<T>(scope: StateScope, key: string): Promise<T | null>
  saveState<T>(scope: StateScope, key: string, data: T): Promise<void>
  /** Fires on every save of the record, including this widget's own (and other embeds' for `group`). */
  onStateChanged<T>(scope: StateScope, key: string, cb: (data: T) => void): () => void
  /** A try that is not a submission (e.g. a test run); informational for the host. */
  attempt(event: unknown): void
  submit(s: WidgetSubmission): void
  onThemeChanged(cb: (theme: Theme) => void): () => void
}

type Listeners = Map<string, Set<(d: unknown) => void>>

function listen(listeners: Listeners, k: string, cb: (d: unknown) => void): () => void {
  const set = listeners.get(k) ?? new Set()
  set.add(cb)
  listeners.set(k, set)
  return () => { set.delete(cb) }
}

// ─── no-host adapter: browser storage only ───────────────────────────────

const PREFIX = 'widget:'

function storage(): Storage | null {
  // Throws in a sandboxed iframe without allow-same-origin; fall back to memory.
  try { return window.localStorage } catch { return null }
}

export function createNoHost(init: Omit<WidgetInit, 'protocol' | 'capabilities'>): WidgetHost {
  const mem = new Map<string, string>()
  const ls = storage()
  const listeners: Listeners = new Map()
  const k = (scope: StateScope, key: string) => `${PREFIX}${scope === 'group' ? 'group' : init.instanceId}:${key}`
  const themeListeners = new Set<(t: Theme) => void>()
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e =>
    themeListeners.forEach(cb => cb(e.matches ? 'dark' : 'light')))

  // Cross-tab updates (same origin only).
  window.addEventListener('storage', e => {
    if (!e.key || !e.newValue) return
    listeners.get(e.key)?.forEach(cb => cb(JSON.parse(e.newValue!)))
  })

  return {
    init: { ...init, protocol: PROTOCOL, capabilities: ['state'] },
    async getState<T>(scope: StateScope, key: string) {
      const raw = ls ? ls.getItem(k(scope, key)) : mem.get(k(scope, key)) ?? null
      return raw ? (JSON.parse(raw) as T) : null
    },
    async saveState<T>(scope: StateScope, key: string, data: T) {
      const raw = JSON.stringify(data)
      if (ls) ls.setItem(k(scope, key), raw)
      else mem.set(k(scope, key), raw)
      listeners.get(k(scope, key))?.forEach(cb => cb(data))
    },
    onStateChanged<T>(scope: StateScope, key: string, cb: (data: T) => void) {
      return listen(listeners, k(scope, key), cb as (d: unknown) => void)
    },
    attempt(event) {
      console.info('[widget] attempt (no host):', event)
    },
    submit(s) {
      // No host to receive it. Logged so the spike shows what would be sent.
      console.info('[widget] submit (no host):', s)
    },
    onThemeChanged(cb) {
      themeListeners.add(cb)
      return () => { themeListeners.delete(cb) }
    },
  }
}

// ─── postMessage adapter: inside a host-created iframe ───────────────────

/**
 * Sends `ready` to the parent and resolves with a host once `init` arrives;
 * null after `timeoutMs` (no host script on the parent page).
 *
 * Messages are accepted only from `window.parent` (a sandboxed frame has
 * origin "null", so the sender window is the check, not the origin) and
 * posted with targetOrigin '*': the widget cannot know the host's origin, and
 * everything it sends is its own state, which the embedding page owns anyway.
 */
export function connectPostMessageHost(timeoutMs = 3000): Promise<WidgetHost | null> {
  if (window.parent === window) return Promise.resolve(null)
  const post = (m: WidgetMessage) => window.parent.postMessage(m, '*')
  const pending = new Map<number, (data: unknown) => void>()
  const listeners: Listeners = new Map()
  const themeListeners = new Set<(t: Theme) => void>()
  const k = (scope: StateScope, key: string) => `${scope}:${key}`
  let nextId = 1

  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs)
    window.addEventListener('message', e => {
      if (e.source !== window.parent) return
      const m = e.data as HostMessage
      if (!m || m.protocol !== PROTOCOL) return
      switch (m.type) {
        case 'init':
          clearTimeout(timer)
          resolve(makeHost(m.init))
          break
        case 'state':
          pending.get(m.id)?.(m.data)
          pending.delete(m.id)
          break
        case 'stateChanged':
          listeners.get(k(m.scope, m.key))?.forEach(cb => cb(m.data))
          break
        case 'themeChanged':
          themeListeners.forEach(cb => cb(m.theme))
          break
      }
    })
    post({ protocol: PROTOCOL, type: 'ready' })
  })

  function makeHost(init: WidgetInit): WidgetHost {
    // Report the content height so the host can size the iframe. Measures the
    // React root, not body/scrollHeight: the app stylesheet (globals.css) makes
    // body fill the viewport, so those only ever report the iframe's own height.
    const content = document.getElementById('root') ?? document.body
    let last = 0
    new ResizeObserver(() => {
      const h = Math.ceil(content.getBoundingClientRect().height)
      if (h !== last) post({ protocol: PROTOCOL, type: 'resize', height: (last = h) })
    }).observe(content)

    return {
      init,
      getState<T>(scope: StateScope, key: string) {
        const id = nextId++
        return new Promise<T | null>(res => {
          pending.set(id, d => res((d ?? null) as T | null))
          post({ protocol: PROTOCOL, type: 'getState', id, scope, key })
        })
      },
      async saveState<T>(scope: StateScope, key: string, data: T) {
        post({ protocol: PROTOCOL, type: 'saveState', scope, key, data })
      },
      onStateChanged<T>(scope: StateScope, key: string, cb: (data: T) => void) {
        // The host echoes saves back as stateChanged, to this frame and to the
        // other frames sharing the record.
        return listen(listeners, k(scope, key), cb as (d: unknown) => void)
      },
      attempt(event) {
        post({ protocol: PROTOCOL, type: 'attempt', event })
      },
      submit(s) {
        post({ protocol: PROTOCOL, type: 'submit', ...s })
      },
      onThemeChanged(cb) {
        themeListeners.add(cb)
        return () => { themeListeners.delete(cb) }
      },
    }
  }
}

// Module-level handle for widget code (widget.tsx).
let current: WidgetHost | null = null
export function setHost(h: WidgetHost) { current = h }
export function host(): WidgetHost {
  if (!current) throw new Error('widget host not initialised')
  return current
}
