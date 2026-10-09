/**
 * SPIKE — widget host interface, v0.1 draft.
 *
 * Widget code talks to `WidgetHost`, never to a transport. Only the no-host
 * adapter (browser storage) exists so far; the in-page (Eduskript) and
 * postMessage adapters are not written yet.
 *
 * State is keyed by (scope, key) because that is what Kara already needs:
 * progress is skript-wide (scope = skriptId), not per instance. Whether the
 * spec should expose scopes or only per-instance state is an open question.
 */

export type WidgetMode = 'normal' | 'browse' | 'review'

export interface WidgetInit {
  protocol: '0.1'
  instanceId: string
  mode: WidgetMode
  /** Embed attributes plus the embed body (for Kara: the kara-world block). */
  config: { attributes: Record<string, string>; body: string }
  theme: 'light' | 'dark'
  /** What the host offers, e.g. 'state', 'submit', 'feedback', 'voice'. */
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
  getState<T>(scope: string, key: string): Promise<T | null>
  saveState<T>(scope: string, key: string, data: T): Promise<void>
  /** Fires on external updates (another tab, host sync). */
  onStateChanged<T>(scope: string, key: string, cb: (data: T) => void): () => void
  submit(s: WidgetSubmission): void
  onThemeChanged(cb: (theme: 'light' | 'dark') => void): () => void
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
  const listeners = new Map<string, Set<(d: unknown) => void>>()
  const k = (scope: string, key: string) => `${PREFIX}${scope}:${key}`
  const themeListeners = new Set<(t: 'light' | 'dark') => void>()
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', e => themeListeners.forEach(cb => cb(e.matches ? 'dark' : 'light')))

  // Cross-tab updates (same origin only).
  window.addEventListener('storage', e => {
    if (!e.key || !e.newValue) return
    listeners.get(e.key)?.forEach(cb => cb(JSON.parse(e.newValue!)))
  })

  return {
    init: { ...init, protocol: '0.1', capabilities: ['state'] },
    async getState<T>(scope: string, key: string) {
      const raw = ls ? ls.getItem(k(scope, key)) : mem.get(k(scope, key)) ?? null
      return raw ? (JSON.parse(raw) as T) : null
    },
    async saveState<T>(scope: string, key: string, data: T) {
      const raw = JSON.stringify(data)
      if (ls) ls.setItem(k(scope, key), raw)
      else mem.set(k(scope, key), raw)
      listeners.get(k(scope, key))?.forEach(cb => cb(data))
    },
    onStateChanged<T>(scope: string, key: string, cb: (data: T) => void) {
      const set = listeners.get(k(scope, key)) ?? new Set()
      set.add(cb as (d: unknown) => void)
      listeners.set(k(scope, key), set)
      return () => { set.delete(cb as (d: unknown) => void) }
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

// Module-level handle for widget code (widget.tsx).
let current: WidgetHost | null = null
export function setHost(h: WidgetHost) { current = h }
export function host(): WidgetHost {
  if (!current) throw new Error('widget host not initialised')
  return current
}
