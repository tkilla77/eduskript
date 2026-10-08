/**
 * Per-student Kara progress, shared across every page of a skript: best stars
 * per level and the evidence collected (shown on the evidence board). Stored
 * through the Kara host (host.ts) with the skriptId as scope; in Eduskript that
 * is userDataService, like the skript-wide python imports, so it syncs like
 * other user data. Without a skriptId (e.g. the dashboard preview) nothing is
 * stored.
 *
 * Archive (`archive: true` levels): the student's main.py at the latest win,
 * per level id, read back by `<kara-archive of="…">` (kara-archive.tsx). It
 * lives in the same record, so it is stored locally (IndexedDB) and synced to
 * the server for logged-in users like the rest; no teacher view reads it.
 *
 * Writes are load-merge-save, so they are chained per skript (`queue`): two
 * saves fired at the same moment (a run's evidence + a suite's stars) would
 * otherwise both read the old record and the second would drop the first.
 * This only serialises writes within one tab.
 */

import { karaHost } from './host'
import type { KaraEvidence } from './world'

export const KARA_PROGRESS_KEY = 'kara-progress'

export interface KaraSavedEvidence extends KaraEvidence {
  level: string
}

export interface KaraArchived {
  code: string
  /** Time of the win (ms since epoch). */
  at: number
}

export interface KaraProgress {
  levels: Record<string, number>
  evidence: Record<string, KaraSavedEvidence>
  /** Winning code of `archive: true` levels, by level id. Absent in records saved before it existed. */
  archive?: Record<string, KaraArchived>
}

const EMPTY: KaraProgress = { levels: {}, evidence: {} }

const queue = new Map<string, Promise<void>>()

/** Run `task` after every earlier write for this skript (see header). */
function serialized(skriptId: string, task: () => Promise<void>): Promise<void> {
  const next = (queue.get(skriptId) ?? Promise.resolve()).then(task, task)
  const tail = next.catch(() => {})
  queue.set(skriptId, tail)
  void tail.then(() => { if (queue.get(skriptId) === tail) queue.delete(skriptId) })
  return next
}

export async function loadKaraProgress(skriptId: string): Promise<KaraProgress> {
  const data = await karaHost().getState<KaraProgress>(skriptId, KARA_PROGRESS_KEY)
  return { ...EMPTY, ...(data ?? {}) }
}

/**
 * Merge a finished run into the saved progress (stars only ever go up).
 * `archiveCode`: the winning program of an `archive: true` level; replaces
 * the archived code of `level` (only with stars > 0).
 */
export function recordKaraResult(skriptId: string, level: string, stars: number, evidence: KaraEvidence[], archiveCode?: string): Promise<void> {
  return serialized(skriptId, () => mergeResult(skriptId, level, stars, evidence, archiveCode))
}

async function mergeResult(skriptId: string, level: string, stars: number, evidence: KaraEvidence[], archiveCode?: string): Promise<void> {
  const current = await loadKaraProgress(skriptId)
  // Unsolved runs (0 stars) only add evidence; they never create a level entry.
  const levels = stars > 0 ? { ...current.levels, [level]: Math.max(stars, current.levels[level] ?? 0) } : current.levels
  const next: KaraProgress = {
    levels,
    evidence: { ...current.evidence },
  }
  for (const e of evidence) next.evidence[e.id] = { ...e, level }
  const archive = stars > 0 && archiveCode !== undefined && current.archive?.[level]?.code !== archiveCode
  if (current.archive || archive) next.archive = { ...current.archive }
  if (archive) next.archive![level] = { code: archiveCode!, at: Date.now() }
  const changed = archive || next.levels[level] !== current.levels[level] || evidence.some(e => !current.evidence[e.id])
  if (changed) await karaHost().saveState(skriptId, KARA_PROGRESS_KEY, next)
}

/** The archived code of `level`, or null when nothing was saved. */
export async function loadKaraArchive(skriptId: string, level: string): Promise<KaraArchived | null> {
  return (await loadKaraProgress(skriptId)).archive?.[level] ?? null
}

export function subscribeKaraProgress(skriptId: string, callback: (p: KaraProgress) => void): () => void {
  return karaHost().onStateChanged<KaraProgress>(skriptId, KARA_PROGRESS_KEY, data => callback({ ...EMPTY, ...data }))
}
