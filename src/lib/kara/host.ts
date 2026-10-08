/**
 * Kara's link to the page that embeds it: per-student state, voice lines and
 * asset URLs. Kara code calls `karaHost()` instead of reaching into the app
 * (userDataService, /api/kara/tts, root-relative /kara/... paths), so the same
 * modules can run under another host, e.g. a stand-alone static build.
 *
 * Inside Eduskript nothing calls setKaraHost(); karaHost() returns the in-page
 * adapter (host-inpage.ts), which does exactly what the code did before.
 *
 * Covers only what lib/kara and the Kara panel components use. The editor's
 * own code storage (useSyncedUserData in code-editor/index.tsx) and the
 * teacher voice editor (kara-voice-editor.tsx, authoring routes) are not
 * behind this interface.
 */

import { inPageKaraHost } from '@/lib/kara/host-inpage'

export interface KaraHost {
  /**
   * Per-student state. `scope` groups records shared across levels (Eduskript:
   * the skriptId, so stars and evidence span every page of a skript).
   */
  getState<T>(scope: string, key: string): Promise<T | null>
  saveState<T>(scope: string, key: string, data: T): Promise<void>
  /** Fires after every save of the record, including the caller's own; returns unsubscribe. */
  onStateChanged<T>(scope: string, key: string, cb: (data: T) => void): () => void
  /** URL of a pre-rendered voice line, null when there is none. Absent = no voices. */
  voiceLineUrl?(speaker: string, text: string): Promise<string | null>
  /** URL of a built-in asset, given its root-relative path (`/kara/mop7-N.png`). */
  assetUrl(path: string): string
  /** Base URL of the licensed tileset (no trailing slash); '' = labelled placeholders. */
  tilesetUrl(): string
}

let current: KaraHost | null = null

/** Install another host. Call before any Kara component mounts. */
export function setKaraHost(host: KaraHost) {
  current = host
}

export function karaHost(): KaraHost {
  return current ?? inPageKaraHost
}
