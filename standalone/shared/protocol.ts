/**
 * SPIKE — widget ⇄ host message protocol, v0.1 draft (postMessage transport).
 *
 * Every message carries `protocol`. The host is embed/embed.js (reference
 * implementation, plain JS, no imports — keep the two in step by hand).
 *
 * Widget → host
 *   ready                            sent on load; the host answers with init
 *   getState  {id, scope, key}       the host answers with state {id, data}
 *   saveState {scope, key, data}     the host stores it and echoes stateChanged
 *   submit    {response, score?}     raw response always; score self-reported
 *   resize    {height}               content height in CSS px
 *
 * Host → widget
 *   init         {init}              instance id, mode, config, theme, capabilities
 *   state        {id, data}          answer to getState (data null = nothing saved)
 *   stateChanged {scope, key, data}  after any save of a record this widget can read
 *   themeChanged {theme}
 *
 * Not in v0.1 yet: attempt, feedback (host-produced), fullscreen, capability
 * negotiation beyond the init list.
 */

import type { StateScope, Theme, WidgetInit, WidgetSubmission } from './host'

export const PROTOCOL = 'learning-widget/0.1' as const

type Base = { protocol: typeof PROTOCOL }

export type WidgetMessage = Base & (
  | { type: 'ready' }
  | { type: 'getState'; id: number; scope: StateScope; key: string }
  | { type: 'saveState'; scope: StateScope; key: string; data: unknown }
  | ({ type: 'submit' } & WidgetSubmission)
  | { type: 'resize'; height: number }
)

export type HostMessage = Base & (
  | { type: 'init'; init: WidgetInit }
  | { type: 'state'; id: number; data: unknown }
  | { type: 'stateChanged'; scope: StateScope; key: string; data: unknown }
  | { type: 'themeChanged'; theme: Theme }
)
