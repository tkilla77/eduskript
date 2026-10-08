/**
 * Default KaraHost (host.ts) for Kara running inside Eduskript: state through
 * userDataService (local IndexedDB, synced to the server for logged-in users),
 * voice lines from /api/kara/tts, assets served from public/.
 */

import { userDataService } from '@/lib/userdata'
import type { KaraHost } from './host'

const TILESET_URL = (process.env.NEXT_PUBLIC_KARA_TILESET_URL || '').replace(/\/$/, '')

export const inPageKaraHost: KaraHost = {
  async getState<T>(scope: string, key: string) {
    const record = await userDataService.get<T>(scope, key)
    return record?.data ?? null
  },
  async saveState<T>(scope: string, key: string, data: T) {
    await userDataService.save(scope, key, data, { immediate: true })
  },
  onStateChanged<T>(scope: string, key: string, cb: (data: T) => void) {
    return userDataService.subscribe<T>(scope, key, cb)
  },
  voiceLineUrl(speaker, text) {
    return fetch('/api/kara/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speaker, text }),
    }).then(r => (r.ok ? r.json() : null)).then(j => j?.url ?? null).catch(() => null)
  },
  assetUrl: path => path,
  tilesetUrl: () => TILESET_URL,
}
