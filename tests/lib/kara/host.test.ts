/**
 * Kara host (host.ts): with setKaraHost, progress, voice lines and asset URLs
 * go through the installed host instead of the Eduskript app. The in-page
 * adapter itself is covered by the progress / evidence-board tests.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'

// The in-page adapter must not be used once another host is installed.
vi.mock('@/lib/userdata', () => ({
  userDataService: {
    get: () => { throw new Error('in-page adapter used') },
    save: () => { throw new Error('in-page adapter used') },
    subscribe: () => { throw new Error('in-page adapter used') },
  },
}))

import { setKaraHost, type KaraHost } from '@/lib/kara/host'
import { loadKaraProgress, recordKaraResult, subscribeKaraProgress } from '@/lib/kara/progress'
import { ttsLineUrl } from '@/lib/kara/voice'
import { karaPortrait } from '@/lib/kara/portraits'

const store = new Map<string, unknown>()
const listeners = new Map<string, (d: unknown) => void>()
const voiceLineUrl = vi.fn(async (speaker: string, text: string) => `https://voices.test/${speaker}/${text.length}.mp3`)

const host: KaraHost = {
  getState: async <T>(scope: string, key: string) => (store.get(`${scope}:${key}`) as T) ?? null,
  saveState: async (scope, key, data) => {
    store.set(`${scope}:${key}`, data)
    listeners.get(`${scope}:${key}`)?.(data)
  },
  onStateChanged: (scope, key, cb) => {
    listeners.set(`${scope}:${key}`, cb as (d: unknown) => void)
    return () => { listeners.delete(`${scope}:${key}`) }
  },
  voiceLineUrl,
  assetUrl: path => `https://widgets.test${path}`,
  tilesetUrl: () => '',
}

beforeAll(() => setKaraHost(host))

describe('karaHost', () => {
  it('stores progress through the installed host', async () => {
    const seen: number[] = []
    const off = subscribeKaraProgress('course', p => seen.push(p.levels.l1))
    await recordKaraResult('course', 'l1', 2, [])
    off()
    expect(store.get('course:kara-progress')).toEqual({ levels: { l1: 2 }, evidence: {} })
    expect((await loadKaraProgress('course')).levels.l1).toBe(2)
    expect(seen).toEqual([2])
  })

  it('asks the host for voice lines, once per line', async () => {
    expect(await ttsLineUrl('AURORA', 'Hallo')).toBe('https://voices.test/AURORA/5.mp3')
    await ttsLineUrl('AURORA', 'Hallo')
    expect(voiceLineUrl).toHaveBeenCalledTimes(1)
  })

  it('resolves built-in assets through the host', () => {
    expect(karaPortrait('AURORA')).toBe('https://widgets.test/kara/portraits/aurora.png')
    expect(karaPortrait('aurora', { 'portrait:aurora': 'https://skript/a.png' })).toBe('https://skript/a.png')
  })
})
