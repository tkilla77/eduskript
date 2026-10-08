'use client'

/**
 * Kara world + replay player, shown under the code in Kara editors
 * (code-editor with a `kara-world` block). The program has already run to
 * completion in the Pyodide worker; this component replays the recorded trace
 * step by step, forward and backward, and reports the current line to the
 * editor via `onLine` (see kara-line-extension.ts), which also shows the
 * step's sensor results and the error message inline in the code.
 *
 * Position p ∈ [0, steps]: the world after p steps (0 = initial). A step is
 * one executed line or one action — a line that makes several actions (a
 * toolbox call like `drei_vor()`) replays as several steps on the same line
 * (step over; see kara-module.ts). The status shows `line 5 · 2/3`, and the
 * editor note names the helper frame (`drei_vor() · befehle.py:3`). A
 * «Step into» toggle (pressed = into; shown when an action ran in a helper file,
 * or the level sets `debug:`) switches the target: into = the editor jumps to
 * the helper tab and marks the action's line there (karaStepTarget). The
 * status adds `depth N` (KaraStep.d) once the run called any function.
 * Canvas-rendered; on a single forward step Kara slides one cell or turns
 * (horizontal squash between the two direction sprites, ~120 ms). Any other
 * jump (scrubbing, torus wrap) is drawn without animation. World tiles: src/lib/kara/kara-tiles.ts. Kara sprite:
 * built-in default (4 directions); custom per-student sprites are not
 * implemented yet — `sprites` would take 4 image URLs.
 *
 * Story layer: a fixed-height message bar under the world shows story events
 * (terminal read, chip picked up, door code accepted when the level has
 * `aurora.door.ok` — these pause playback until Continue), the
 * level result once the replay reaches the end, and otherwise the level's
 * `aurora.start` line. The result line comes from `auroraLine`
 * (src/lib/kara/aurora-defaults.ts): level `aurora.*` first, then the German
 * course defaults; errors pick a line per `error.sub` (wall, name, ...), and
 * `aurora.fail.3` replaces `aurora.fail` from the 3rd non-winning run in a
 * row (component state: resets on reload and on a win). Static findings
 * (`trace.lints`, kara-module.ts `_lint`) replace that result line with
 * AURORA's `lint.<code>` comment on the first one (LINT_ORDER, then line) when the run did not win,
 * and every finding gets an inline chip at the end of the replay. Events only trigger when the replay steps onto them
 * (play / step forward); jumping or scrubbing skips them. Results are saved per student (stars,
 * evidence) as soon as a run reaches the goal, see src/lib/kara/progress.ts.
 *
 * Variants (levels with several `===` grids): a world bar picks the variant
 * Run uses (‹ ›) and offers «Test all worlds», which the editor runs one
 * variant after the other (`suite`, index.tsx runKaraCode). With more than
 * one variant a single Run never saves stars (a hardcoded answer can win one
 * world); a complete suite saves the minimum over all variants
 * (karaSuiteStars). Evidence is saved from every run either way. Clicking a
 * suite result replays that world's trace.
 *
 * Aftermath (`aftermath:` in the level, world.ts): after a win (single-world
 * level, or the worst world of a won suite) the editor also runs the program
 * on the hidden aftermath world and passes `aftermath`. Once the win replay
 * has reached its end, the panel waits AFTERMATH_DELAY ms (so the win line can
 * be heard), then shows the `aftermath.text` card; Continue switches the panel
 * to the aftermath world and plays it at ≥ 25 steps/s. Nothing in aftermath
 * mode counts or saves (stars, evidence, fail streak). It plays automatically
 * once per mount; afterwards the «Airlock test» button replays it, and «Back to
 * level» (or a new run) returns to the level's trace.
 *
 * Archive (`archive: true`): the save effects pass `code` (the program of the
 * shown run, from the editor) along with the stars, see progress.ts.
 *
 * Darkness (`dark: r`): drawDark veils every cell MOP-7 has not been within r
 * of (karaSeen in world.ts); visited surroundings stay dimly visible.
 *
 * Variables: KaraVarsStrip (kara-vars.tsx) shows the program's variables
 * after the shown position as labelled drawers, whenever the run watched any
 * (kara-module.ts `_watch`, decoded by world.ts buildVars).
 *
 * Call stack (`callstack: on`): KaraCallStackOverlay (kara-callstack.tsx)
 * draws the stack of the shown position over the world as retro dialog
 * windows. A run that ends in a RecursionError floods the world with windows
 * at the end of the replay; the result card (AURORA's recursion line) waits
 * FLOOD_MS for it.
 */

import { displayText, isAd } from '@/lib/kara/voice-directions'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, CornerDownRight, ListChecks, Loader2, Music, Pause, Play, Rocket, SkipBack, SkipForward, Star, StepBack, StepForward, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { playEffect } from './celebrations'
import { recordKaraResult } from '@/lib/kara/progress'
import { playVoice, stopVoice, ttsLineUrl } from '@/lib/kara/voice'
import { AURORA_WANT, auroraLine, type KaraLintCode } from '@/lib/kara/aurora-defaults'
import { playSfx } from '@/lib/kara/sfx'
import { karaHost } from '@/lib/kara/host'
import { registerSoundSource, useMuted } from '@/lib/sound'
import { AFTERMATH_TEXT, DOOR, ITEM, LASER, karaClues } from '@/lib/kara/world'
import { AdMark, KaraPortrait, useSpeaking } from './kara-portrait'
import { karaStepTarget, type KaraLineTarget, type KaraStepMode } from './kara-line-extension'
import { FLOOD_MS, KaraCallStackOverlay, MAX_WINDOWS } from './kara-callstack'
import { KaraVarsStrip } from './kara-vars'
import { drawKaraFacing, drawKaraMarks, drawKaraTiles, isWallExit, loadKaraTileset, WALL_EXIT_TOP, type KaraTileset } from '@/lib/kara/kara-tiles'
import {
  buildCallStacks,
  buildReplay,
  buildVars,
  karaSeen,
  karaStars,
  karaLimits,
  karaSuiteStars,
  seekCells,
  seekMarks,
  type KaraConfig,
  type KaraEvidence,
  type KaraGoal,
  type KaraLint,
  type KaraMessage,
  type KaraPos,
  type KaraTrace,
  type KaraWorld,
} from '@/lib/kara/world'

// ─── Default character (N, E, S, W) ───────────────────────────────────────

const BODY = `
<ellipse cx="24" cy="57" rx="7" ry="4" fill="#9a3412"/>
<ellipse cx="40" cy="57" rx="7" ry="4" fill="#9a3412"/>
<line x1="32" y1="20" x2="32" y2="8" stroke="#9a3412" stroke-width="3" stroke-linecap="round"/>
<circle cx="32" cy="7" r="4" fill="#facc15" stroke="#9a3412" stroke-width="2"/>
<ellipse cx="32" cy="38" rx="22" ry="19" fill="#f97316" stroke="#9a3412" stroke-width="3"/>`

const FACE_SOUTH = `
<circle cx="24" cy="34" r="6" fill="#fff"/><circle cx="24" cy="36" r="3" fill="#1c1917"/>
<circle cx="40" cy="34" r="6" fill="#fff"/><circle cx="40" cy="36" r="3" fill="#1c1917"/>
<path d="M26 46 Q32 51 38 46" stroke="#7c2d12" stroke-width="2.5" fill="none" stroke-linecap="round"/>`

const FACE_NORTH = `
<path d="M18 32 Q32 24 46 32" stroke="#9a3412" stroke-width="2" fill="none" opacity="0.5"/>`

const FACE_EAST = `
<circle cx="44" cy="34" r="6" fill="#fff"/><circle cx="47" cy="35" r="3" fill="#1c1917"/>
<path d="M46 46 Q50 48 53 44" stroke="#7c2d12" stroke-width="2.5" fill="none" stroke-linecap="round"/>`

function svgUrl(inner: string, mirror = false): string {
  const g = mirror ? `<g transform="translate(64 0) scale(-1 1)">${inner}</g>` : inner
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128">${g}</svg>`,
  )
}

const DEFAULT_SPRITES = [
  svgUrl(BODY + FACE_NORTH),
  svgUrl(BODY + FACE_EAST),
  svgUrl(BODY + FACE_SOUTH),
  svgUrl(BODY + FACE_EAST, true),
]

/** MOP-7 renders (Blender, own art, in public/kara/); the SVG blob is the fallback. */
const MOP7_SPRITES = ['N', 'E', 'S', 'W'].map(d => `/kara/mop7-${d}.png`)

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

let defaultSpritesPromise: Promise<HTMLImageElement[]> | null = null
function loadDefaultSprites(): Promise<HTMLImageElement[]> {
  defaultSpritesPromise ??= Promise.all(MOP7_SPRITES.map(async (src, i) =>
    (await loadImage(karaHost().assetUrl(src))) ?? (await loadImage(DEFAULT_SPRITES[i]))!))
  return defaultSpritesPromise
}

// ─── Rendering ────────────────────────────────────────────────────────────

function drawWorld(
  canvas: HTMLCanvasElement,
  world: KaraWorld,
  cells: number[],
  kara: { x: number; y: number; d: number },
  tile: number,
  tileset: KaraTileset,
  sprites: HTMLImageElement[] | null,
  marks: (string | null)[] | null,
  squashX = 1,
  dark?: { seen: Float64Array; pos: number; r: number } | null,
  chipLooks?: (string | undefined)[],
  /** 0..1: MOP-7, standing in the exit door, drives on north and disappears under the doorway (exit animation). */
  vanish = 0,
) {
  const dpr = window.devicePixelRatio || 1
  const w = world.cols * tile
  const h = world.rows * tile
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingQuality = 'high'
  drawKaraTiles(ctx, world, cells, tile, tileset, chipLooks)

  // Facing cone under the sprite (playtests could not read the side-view sprites' direction).
  // Mid-turn (squashX < 1) it is hidden, so it never points the wrong way.
  if (squashX >= 1 && vanish === 0) drawKaraFacing(ctx, kara.x, kara.y, kara.d, tile)
  const sprite = sprites?.[vanish > 0 ? 0 : kara.d]
  if (vanish > 0 && sprite && sprite.complete && sprite.naturalWidth) {
    // Clip at the doorway's top edge: the sprite drives up through the open door and disappears under it.
    const size = tile * 0.92
    const top = kara.y * tile + tile * (1 - WALL_EXIT_TOP)
    ctx.save()
    ctx.beginPath()
    ctx.rect(kara.x * tile, top, tile, kara.y * tile + tile - top)
    ctx.clip()
    const y0 = kara.y * tile + (tile - size) / 2
    ctx.drawImage(sprite, kara.x * tile + (tile - size) / 2, y0 - vanish * (y0 + size - top), size, size)
    ctx.restore()
  } else if (sprite && sprite.complete && sprite.naturalWidth) {
    const size = tile * 0.92
    // squashX < 1: mid-turn (the sprites are side views, so a turn reads as a squash).
    const w = size * Math.max(0.05, squashX)
    ctx.drawImage(sprite, kara.x * tile + (tile - w) / 2, kara.y * tile + (tile - size) / 2, w, size)
  }
  if (marks) drawKaraMarks(ctx, world, marks, tile)
  if (dark) drawDark(ctx, world, kara, tile, dark)
}

/**
 * Darkness overlay (`dark: r`): black where MOP-7 has not been near yet, a dim
 * veil where it has been (seen[i] ≤ pos), clear within r of its (possibly
 * mid-slide) position. Per cell, O(cols · rows) per frame.
 */
function drawDark(
  ctx: CanvasRenderingContext2D,
  world: KaraWorld,
  kara: { x: number; y: number },
  tile: number,
  { seen, pos, r }: { seen: Float64Array; pos: number; r: number },
) {
  for (let y = 0; y < world.rows; y++) {
    for (let x = 0; x < world.cols; x++) {
      const d = Math.max(Math.abs(x - kara.x), Math.abs(y - kara.y))
      const lit = Math.max(0, Math.min(1, r + 1 - d)) // 1 inside the lamp, fades over the next cell while sliding
      const base = seen[y * world.cols + x] <= pos ? 0.62 : 0.96
      const a = base * (1 - lit)
      if (a <= 0.01) continue
      ctx.fillStyle = `rgba(3, 5, 10, ${a.toFixed(3)})`
      ctx.fillRect(x * tile, y * tile, tile, tile)
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────

/** AURORA comments on the first finding in this order: direct causes of a lost run before an unused def. */
const LINT_ORDER: KaraLintCode[] = ['toolbox_call', 'bare_call', 'toolbox_bare', 'sensor_no_call', 'no_return', 'indented_call', 'never_called']

/** Inline chip text per lint (English UI; AURORA's German comment is in the message bar). */
const LINT_NOTE: Record<KaraLintCode, (name: string) => string> = {
  bare_call: n => `${n} is not called: add ()`,
  sensor_no_call: n => `${n} without () is always true`,
  no_return: n => `${n}() returns None`,
  never_called: n => `${n}() is never called`,
  indented_call: n => `indented: still part of ${n}()`,
  toolbox_call: n => `runs on import: call outside a def in ${n}`,
  toolbox_bare: n => `${n} without () in the toolbox`,
}

const SPEEDS = [1, 2, 5, 10, 25, 100] // steps per second
/** Pause between the end of a win replay and the aftermath card (lets the win line play). */
const AFTERMATH_DELAY = 3500
const AFTERMATH_SPEED = 25

const GOAL_TEXT: Record<KaraGoal, string> = {
  exit: 'reach the exit',
  target: 'stop on the marked cell',
  collect: 'collect every barrel',
  boxes: 'push every box onto a target',
  chips: 'pick up every chip',
  logs: 'read every terminal',
  output: 'print the right answer',
}

interface KaraCard {
  message: KaraMessage
  title?: string
  stars?: number
  detail?: string
  /** Called when the student continues past this card (aftermath intro). */
  onClose?: () => void
}

export interface KaraPanelProps {
  world: KaraWorld
  /** New object per run — resets the player and starts playback. */
  trace: KaraTrace | null
  /** Upper bound for the tile size in px (markdown `tile="…"`). */
  maxTile: number
  /** Upper bound for the world's height in px (fullscreen). */
  maxHeight?: number
  onLine: (target: KaraLineTarget | null) => void
  config: KaraConfig
  /** Resolved asset URLs (audio file names, `portrait:<speaker>`). */
  assets?: Record<string, string>
  /** Key for saved progress. */
  levelId: string
  /** Progress is only saved inside a skript. */
  skriptId?: string
  /**
   * Fixed-height mode (side-by-side layout): the panel fills its parent's
   * height; the divider moves height between world and message bar.
   */
  fill?: boolean
  /** Variant shown and used by Run (0-based) and the level's number of variants. */
  variant?: number
  variantCount?: number
  onVariant?: (v: number) => void
  /** «Test all worlds» results (null entries: not run yet); null before the first test. */
  suite?: { traces: (KaraTrace | null)[]; done: boolean } | null
  onTestAll?: () => void
  /** A run is in progress (disables the world bar). */
  busy?: boolean
  /** The program of the shown run / suite; saved on a win of an `archive: true` level. */
  code?: string
  /** The same program run on the level's hidden aftermath world (only after a win). */
  aftermath?: { world: KaraWorld; trace: KaraTrace } | null
}

export function KaraPanel({ world: levelWorld, trace: levelTrace, maxTile, maxHeight, onLine, config, assets, levelId, skriptId, fill, variant = 0, variantCount = 1, onVariant, suite, onTestAll, busy, code, aftermath }: KaraPanelProps) {
  const multi = variantCount > 1
  // Aftermath mode shows the aftermath world + trace instead of the level's (see header).
  const [inAftermath, setInAftermath] = useState(false)
  const [prevLevelTrace, setPrevLevelTrace] = useState(levelTrace)
  if (levelTrace !== prevLevelTrace) {
    setPrevLevelTrace(levelTrace)
    setInAftermath(false)
  }
  const showAftermath = inAftermath && !!aftermath
  const world = showAftermath ? aftermath.world : levelWorld
  const chipLooks = useMemo(() => config.chips.map(c => c.look), [config])
  const trace = showAftermath ? aftermath.trace : levelTrace
  /** The shown trace belongs to a complete «Test all worlds» suite. */
  const inSuite = !!trace && !!suite?.done && suite.traces[variant] === trace
  /** Stars count for this trace (single-variant level, or part of a complete suite). */
  const starsCount = !showAftermath && (!multi || inSuite)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLPreElement>(null)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [sprites, setSprites] = useState<HTMLImageElement[] | null>(null)
  const [tileset, setTileset] = useState<KaraTileset>(() => new Map())
  const [pos, setPos] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(5)
  const [cards, setCards] = useState<KaraCard[]>([])
  const [resume, setResume] = useState(false)
  const [musicOn, setMusicOn] = useState(false)
  const [outputHeight, setOutputHeight] = useState(80)
  const [barHeight, setBarHeight] = useState(150)
  /** Drag handle above a box: dragging up makes the box below taller. */
  const dragAbove = (h0: number, set: (h: number) => void, min: number, max: number) => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const y0 = 'touches' in e ? e.touches[0]?.clientY ?? 0 : e.clientY
    const move = (ev: MouseEvent | TouchEvent) => {
      const y = 'touches' in ev ? ev.touches[0]?.clientY ?? y0 : ev.clientY
      set(Math.max(min, Math.min(max, h0 - (y - y0))))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', up)
  }
  const musicRef = useRef<HTMLAudioElement>(null)

  const steps = useMemo(() => trace?.steps ?? [], [trace])
  const replay = useMemo(() => (trace ? buildReplay(world, trace) : null), [world, trace])
  /** Darkness (`dark: r`): first position each cell was lit; before a run only the start is lit. */
  const seen = useMemo(() => (config.dark === undefined ? null : karaSeen(world, replay?.kara ?? [world.kara], config.dark)), [config.dark, world, replay])
  /** Variable drawers (KaraVarsStrip); null when the program watched no variable. */
  const vars = useMemo(() => (trace ? buildVars(trace) : null), [trace])
  /** «Step into» follows helper-module actions into their file (kara-line-extension.ts); level `debug: into` starts there. */
  const [stepMode, setStepMode] = useState<KaraStepMode>(config.debug === 'into' ? 'into' : 'over')
  /** The toggle only does something when an action ran in a helper module (befehle.py). */
  const hasHelperSteps = useMemo(() => steps.some(s => s.f && s.fl), [steps])
  /** 'depth N' is shown once the run called any function (d ≥ 1 on some step). */
  const hasDepth = useMemo(() => steps.some(s => s.d), [steps])
  const total = replay?.length ?? 0
  /** Stack per position (`callstack: on` only); null otherwise. O(steps · MAX_WINDOWS). */
  const callStacks = useMemo(() => (config.callstack && trace ? buildCallStacks(steps, MAX_WINDOWS) : null), [config.callstack, trace, steps])

  // Cell state tracks the drawn position incrementally (see seekCells).
  // Marks (mark / mark_at) the same way; null until the trace has any (most levels never mark).
  const cellsRef = useRef<{ cells: number[]; marks: (string | null)[] | null; pos: number; trace: KaraTrace | null; world: KaraWorld } | null>(null)
  const drawnRef = useRef<{ pos: number; trace: KaraTrace | null }>({ pos: 0, trace: null })
  /** Trace whose exit animation already ran (see the draw effect). */
  const exitDoneRef = useRef<KaraTrace | null>(null)

  useEffect(() => { void loadDefaultSprites().then(setSprites) }, [])
  useEffect(() => { void loadKaraTileset().then(setTileset) }, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      setWidth(entries[0]?.contentRect.width ?? el.clientWidth)
      setHeight(entries[0]?.contentRect.height ?? el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // New run → rewind and play (state adjusted during render, not in an effect).
  const [prevTrace, setPrevTrace] = useState(trace)
  /** Runs in a row that did not reach the goal (error, loop or goal missed); `aurora.fail.3`. Per mount, not saved. */
  const [failStreak, setFailStreak] = useState(0)
  // Each trace counts once: replaying a suite world again (clicking its result) is not a new run.
  const [counted] = useState(() => new WeakSet<KaraTrace>())
  if (trace !== prevTrace) {
    setPrevTrace(trace)
    setPos(0)
    setCards([])
    setPlaying(!!trace && trace.steps.length > 0)
    if (trace && config.goals.length && !counted.has(trace) && !showAftermath) {
      counted.add(trace)
      setFailStreak(trace.error || !trace.goal?.reached ? failStreak + 1 : 0)
    }
  }

  const stars = trace ? karaStars(trace, config) : 0
  /** Static findings, shown only when the run did not win (a level without goals never wins). */
  const lints = useMemo((): KaraLint[] => {
    if (!trace?.lints?.length) return []
    const won = !trace.error && config.goals.length > 0 && !!trace.goal?.reached
    return won ? [] : trace.lints
  }, [trace, config])

  /** Story events on a single forward step (pause until Continue). */
  const eventCards = useCallback((from: number, to: number): KaraCard[] => {
    if (!trace || to <= from) return []
    const out: KaraCard[] = []
    if (to === from + 1) for (const [kind, i] of steps[to - 1]?.v ?? []) {
      if (kind === 'log' && config.logs[i]) out.push({ message: config.logs[i], title: 'Log' })
      if (kind === 'chip' && config.chips[i]) out.push({ message: config.chips[i], title: `Evidence: ${config.chips[i].title}` })
      if (kind === 'door' && config.aurora['door.ok']) out.push({ message: config.aurora['door.ok'], title: 'Door code accepted' })
    }
    return out
  }, [trace, steps, config])

  /** Result message, shown (without blocking) once the replay reaches the end. */
  const finalCard = useMemo((): KaraCard | null => {
    if (!trace) return null
    if (showAftermath && config.aftermathEnd) return { message: config.aftermathEnd, title: 'Airlock test' }
    const limits = karaLimits(trace, config)
    // A static finding explains a lost run better than its symptom (loop, wall, goal missed).
    if (lints.length) {
      const first = [...lints].sort((a, b) => LINT_ORDER.indexOf(a.code) - LINT_ORDER.indexOf(b.code) || a.line - b.line)[0]
      const m = auroraLine(config, `lint.${first.code}`, { vars: first })
      if (m) return { message: m, detail: lints.length > 1 ? `${lints.length - 1} more marked in the code` : undefined }
    }
    if (trace.error?.kind === 'loop') { const m = auroraLine(config, 'loop'); return m ? { message: m, title: showAftermath ? 'Airlock test' : undefined } : null }
    if (trace.error) {
      const { sub, name, got, want } = trace.error
      const m = auroraLine(config, 'error', { sub: sub ?? undefined, vars: { name, got, want: want && AURORA_WANT[want] } })
      return m ? { message: m } : null
    }
    if (!config.goals.length || !trace.goal) return null
    if (showAftermath) return null
    if (trace.goal.reached) {
      // A star short: say which limit (detail) and let the level comment (aurora.win.memory / .energy).
      const over: ('memory' | 'energy')[] = []
      if (config.memory && trace.memory > config.memory) over.push('memory')
      if ((config.energy && trace.energy > config.energy) || (config.looks && (trace.looks ?? 0) > config.looks)) over.push('energy')
      const short = over.length ? ` · ${over.map(k => `${k} over the limit`).join(', ')}` : ''
      return starsCount
        ? { message: auroraLine(config, 'win', { over })!, stars, detail: limits + short }
        : { message: auroraLine(config, 'win')!, detail: `Won in this world – test all worlds for the stars · ${limits}` }
    }
    // The goal list always shows (level fail texts point to it); aurora.fail.<goal> comments on the first missing goal.
    return {
      message: auroraLine(config, 'fail', { failStreak, missing: trace.goal.missing })!,
      detail: `Still to do: ${trace.goal.missing.map(g => GOAL_TEXT[g]).join(', ')}`,
    }
  }, [trace, config, stars, failStreak, lints, starsCount, showAftermath])

  /** Sound effects for stepping from `to - 1` to `to` (and the result at the end). */
  const stepSfx = useCallback((to: number) => {
    if (!trace || !replay) return
    const step = steps[to - 1]
    const a = replay.kara[to - 1], b = replay.kara[to]
    if (step) {
      let door = false, laser = false, barrel = false
      for (const [, , before, after] of step.m ?? []) {
        if ((before ^ after) & DOOR) door = true
        if ((before ^ after) & LASER) laser = true
        if ((before ^ after) & ITEM) barrel = true
      }
      // A door opened by its code (event 'door') has no switch click.
      const coded = step.v?.some(([kind]) => kind === 'door')
      if ((door && !coded) || laser) playSfx('switch')
      if (door) playSfx('door')
      if (barrel) playSfx('barrel')
      for (const [kind] of step.v ?? []) if (kind !== 'door') playSfx(kind === 'chip' ? 'chip' : 'log')
      if (a && b && (a.x !== b.x || a.y !== b.y)) playSfx('move')
      else if (a && b && a.d !== b.d) playSfx('turn')
    }
    if (to === total) {
      if (trace.error?.kind === 'kara') playSfx(trace.error.sub === 'acid' ? 'acid' : 'bump')
      else if (!trace.error && config.goals.length && trace.goal) playSfx(trace.goal.reached ? 'win' : 'fail')
    }
  }, [trace, replay, steps, total, config])

  /** Move the replay; pauses on story events (resuming afterwards if it was playing). */
  const advance = useCallback((from: number, to: number, wasPlaying: boolean) => {
    setPos(to)
    if (to === from + 1) stepSfx(to)
    const next = eventCards(from, to)
    if (next.length) {
      setCards(next)
      setResume(wasPlaying && to < total)
      setPlaying(false)
    }
  }, [eventCards, total, stepSfx])

  const closeCard = useCallback(() => {
    const rest = cards.slice(1)
    setCards(rest)
    if (!rest.length && resume) setPlaying(true)
    cards[0]?.onClose?.()
  }, [cards, resume])

  const enterAftermath = useCallback(() => {
    setInAftermath(true)
    setSpeed(s => Math.max(s, AFTERMATH_SPEED))
  }, [])

  // The level's win (not the aftermath's) is what unlocks the aftermath.
  const levelWon = !!levelTrace && !levelTrace.error && !!levelTrace.goal?.reached && config.goals.length > 0
  const [aftermathAuto, setAftermathAuto] = useState(false)
  useEffect(() => {
    if (!aftermath || aftermathAuto || showAftermath || !levelWon || pos !== total || cards.length) return
    const t = setTimeout(() => {
      setAftermathAuto(true)
      setResume(false)
      setCards([{
        message: config.aftermathText ?? { text: AFTERMATH_TEXT, speaker: 'AURORA' },
        title: 'Airlock test',
        onClose: enterAftermath,
      }])
    }, AFTERMATH_DELAY)
    return () => clearTimeout(t)
  }, [aftermath, aftermathAuto, showAftermath, levelWon, pos, total, cards.length, config, enterAftermath])

  // Save progress: evidence found in this run (chips picked up, terminal logs
  // read — even if the level is not solved), stars when solved.
  useEffect(() => {
    if (!skriptId || !levelTrace) return
    // Ids and titles come from karaClues, the same definition the evidence board shows.
    const clues = karaClues(config, levelId)
    const chipClues = clues.filter(c => c.kind === 'chip')
    const logClues = clues.filter(c => c.kind === 'log')
    const found: KaraEvidence[] = []
    for (const step of levelTrace.steps) {
      for (const [kind, i] of step.v ?? []) {
        const clue = kind === 'chip' ? chipClues[i] : kind === 'log' ? logClues[i] : undefined
        if (clue) found.push(clue)
      }
    }
    // Several variants: stars only from a complete suite (effect below).
    const s = multi ? 0 : karaStars(levelTrace, config)
    if (s > 0 || found.length) void recordKaraResult(skriptId, levelId, s, found, config.archive ? code : undefined)
  }, [levelTrace, config, skriptId, levelId, multi, code])

  const suiteStars = suite?.done ? karaSuiteStars(suite.traces, config) : 0
  // Keyed on the suite object, so a second winning suite (same stars, new code) still archives.
  const doneSuite = suite?.done ? suite : null
  useEffect(() => {
    if (skriptId && doneSuite && suiteStars > 0) void recordKaraResult(skriptId, levelId, suiteStars, [], config.archive ? code : undefined)
  }, [doneSuite, suiteStars, skriptId, levelId, config.archive, code])

  // Message bar: pending story event, else the result at the end, else the level's `aurora.start` idle line (the `intro:` briefing is KaraIntro above the editor).
  const startCard = useMemo((): KaraCard | null => (config.aurora.start ? { message: config.aurora.start } : null), [config])
  // RecursionError with `callstack: on`: the window flood plays first, then AURORA's line.
  const flood = !!callStacks && !!trace && trace.error?.sub === 'recursion' && pos === total
  const [floodDone, setFloodDone] = useState<KaraTrace | null>(null)
  useEffect(() => {
    if (!flood) return
    const t = setTimeout(() => setFloodDone(trace), FLOOD_MS)
    return () => clearTimeout(t)
  }, [flood, trace])
  const holdFinal = flood && floodDone !== trace
  const card = cards[0] ?? (trace && pos === total && !holdFinal ? finalCard : null) ?? (pos === 0 ? startCard : null)
  // Voice only for events and results (never on page load).
  const spoken = card && card !== startCard ? card : null
  // A skript audio file wins; otherwise the cached TTS line (speakers with a voice only).
  useEffect(() => {
    if (!spoken) { stopVoice(); return }
    const { audio, speaker, text } = spoken.message
    let cancelled = false
    void (async () => {
      const url = (audio && assets?.[audio]) || (speaker ? await ttsLineUrl(speaker, text) : null)
      if (url && !cancelled) await playVoice(url, speaker, undefined, text).catch(() => {})
    })()
    return () => { cancelled = true }
  }, [spoken, assets])
  useEffect(() => () => stopVoice(), [])

  const musicSrc = config.music ? assets?.[config.music] : undefined
  const muted = useMuted()
  useEffect(() => {
    const el = musicRef.current
    if (!el) return
    if (musicOn && !muted) { el.volume = 0.35; void el.play().catch(() => {}) } else el.pause()
  }, [musicOn, musicSrc, muted])
  // Show the page's mute button while a Kara level is on the page.
  useEffect(() => registerSoundSource(), [])

  // Playback stops by itself at the end.
  const isPlaying = playing && pos < total
  useEffect(() => {
    if (!isPlaying) return
    const t = setTimeout(() => advance(pos, Math.min(pos + 1, total), true), 1000 / speed)
    return () => clearTimeout(t)
  }, [isPlaying, pos, total, speed, advance])

  // Editor line highlight.
  useEffect(() => {
    if (!trace) { onLine(null); return }
    const lintNotes = pos === total && lints.length ? lints.map(l => ({ line: l.line, note: LINT_NOTE[l.code](l.name) })) : undefined
    if (pos === total && trace.error) {
      const last = steps[total - 1]
      const line = trace.error.line ?? last?.l
      if (trace.error.f && trace.error.fl) {
        // Syntax / name error inside the toolbox: open its tab on that line (main.py's import line if the tab is missing).
        onLine({ line: trace.error.fl, file: trace.error.f, over: { line: line ?? 1 }, error: trace.error.message })
      } else if (last && last.l === line) {
        // The failing step's own sensor calls stay visible next to the error;
        // step into: the error shows on the helper line that raised it.
        const t = karaStepTarget(last, stepMode)
        onLine({ ...t, sensors: last.s, door: last.q, error: trace.error.message, lints: t.file ? undefined : lintNotes })
      } else {
        onLine(line || lintNotes ? { line: line ?? undefined, error: trace.error.message, lints: lintNotes } : null)
      }
    } else if (lintNotes && pos === 0) {
      onLine({ lints: lintNotes })
    } else if (pos === 0) {
      onLine(null)
    } else {
      const s = steps[pos - 1]
      const t = karaStepTarget(s, stepMode)
      // Lints belong to main.py; a helper-file target drops them.
      onLine({ ...t, sensors: s.s, door: s.q, lints: t.file ? undefined : lintNotes })
    }
  }, [pos, total, trace, steps, onLine, lints, stepMode])

  const tile = useMemo(() => {
    let t = width ? Math.floor(width / world.cols) : maxTile
    if (maxHeight) t = Math.min(t, Math.floor(maxHeight / world.rows))
    // Fill mode: the world gets whatever height the message bar leaves.
    if (fill && height) t = Math.min(t, Math.floor(height / world.rows))
    return Math.max(8, Math.min(maxTile, t))
  }, [width, height, fill, world.cols, world.rows, maxTile, maxHeight])

  // Draw (one-cell slide or turn on single forward steps).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let state = cellsRef.current
    if (!state || state.trace !== trace || state.world !== world) {
      const marks = steps.some(s => s.mk) ? new Array<string | null>(world.cells.length).fill(null) : null
      state = { cells: [...world.cells], marks, pos: 0, trace, world }
      cellsRef.current = state
    }
    seekCells(state.cells, world.cols, steps, state.pos, pos)
    if (state.marks) seekMarks(state.marks, world.cols, steps, state.pos, pos)
    state.pos = pos

    const to: KaraPos = replay?.kara[pos] ?? world.kara
    const prev = drawnRef.current
    const from: KaraPos | undefined = prev.trace === trace && prev.pos === pos - 1 ? replay?.kara[pos - 1] : undefined
    drawnRef.current = { pos, trace }

    const cells = state.cells
    const marks = state.marks
    const darkAt = (p: number) => (seen && config.dark !== undefined ? { seen, pos: p, r: config.dark } : null)
    const slide = !!from && Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1
    const turn = !!from && from.x === to.x && from.y === to.y && from.d !== to.d
    // Won by reaching an exit in a wall: after the last step MOP-7 drives up into
    // the open wall door and disappears, then stars burst there (once per run; only when
    // stepping onto the last step, not when jumping to it).
    const ci = to.y * world.cols + to.x
    const exitLeave = !!from && pos === total && levelWon && config.goals.includes('exit') && world.look[ci] === 'E'
      && isWallExit(world, to.x, to.y) && exitDoneRef.current !== trace
    let raf = 0
    const leave = () => {
      exitDoneRef.current = trace
      const t0 = performance.now()
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 550)
        drawWorld(canvas, world, cells, to, tile, tileset, sprites, marks, 1, darkAt(pos), chipLooks, k * k)
        if (k < 1) { raf = requestAnimationFrame(step); return }
        const r = canvas.getBoundingClientRect()
        void playEffect(4, canvas, new DOMRect(r.left + to.x * tile, r.top + to.y * tile, tile, tile)).catch(() => {})
      }
      raf = requestAnimationFrame(step)
    }
    if (!from || (!slide && !turn)) {
      drawWorld(canvas, world, cells, to, tile, tileset, sprites, marks, 1, darkAt(pos), chipLooks)
      if (exitLeave) leave()
      return () => cancelAnimationFrame(raf)
    }
    const duration = slide ? Math.min(250, 700 / speed) : Math.min(120, 500 / speed)
    const start = performance.now()
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      if (slide) {
        drawWorld(canvas, world, cells, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, d: to.d }, tile, tileset, sprites, marks, 1, darkAt(pos), chipLooks)
      } else {
        // First half: old sprite narrows; second half: new sprite widens.
        drawWorld(canvas, world, cells, t < 0.5 ? from : to, tile, tileset, sprites, marks, Math.abs(1 - 2 * t), darkAt(pos), chipLooks)
      }
      if (t < 1) raf = requestAnimationFrame(frame)
      else if (exitLeave) leave()
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [pos, trace, world, steps, replay, tile, tileset, sprites, speed, seen, config.dark, config.goals, chipLooks, total, levelWon])

  const output = replay ? replay.output.slice(0, replay.outputEnd[pos]) : ''
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])

  const go = useCallback((p: number) => {
    setPlaying(false)
    setCards([])
    advance(pos, Math.max(0, Math.min(total, p)), false)
  }, [total, pos, advance])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (cards.length && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); closeCard() }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(pos + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(pos - 1) }
    else if (e.key === ' ') { e.preventDefault(); togglePlay() }
  }

  const togglePlay = () => {
    if (isPlaying) { setPlaying(false); return }
    if (pos >= total) setPos(0)
    setPlaying(total > 0)
  }

  const btn = 'h-7 w-7 rounded flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div className="flex h-full flex-col border-t bg-background outline-none" tabIndex={0} onKeyDown={onKeyDown}>
      <div ref={wrapRef} className={cn('relative flex justify-center overflow-hidden', fill ? 'min-h-0 flex-1 items-center' : 'shrink-0 p-2')}>
        <div className="relative">
          <canvas ref={canvasRef} className="block rounded" />
          {callStacks && (
            <KaraCallStackOverlay
              stack={callStacks[Math.min(pos, callStacks.length - 1)]}
              pos={pos}
              width={world.cols * tile}
              height={world.rows * tile}
              kara={replay?.kara[pos] ?? world.kara}
              tile={tile}
              flood={flood}
              assets={assets}
            />
          )}
        </div>
        {musicSrc && <audio ref={musicRef} src={musicSrc} loop preload="none" />}
        {showAftermath && (
          <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-2 rounded bg-slate-950/80 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-amber-300 shadow">
            <span className="flex items-center gap-1.5"><Rocket className="h-3.5 w-3.5" /> Airlock test · not scored</span>
            <button onClick={() => setInAftermath(false)} className="flex items-center gap-1 rounded px-1.5 py-0.5 normal-case tracking-normal text-slate-200 hover:bg-white/10" title="Back to your level">
              <Undo2 className="h-3.5 w-3.5" /> Back to level
            </button>
          </div>
        )}
      </div>

      {multi && (
        <WorldBar
          variant={variant}
          count={variantCount}
          suite={suite ?? null}
          suiteStars={suiteStars}
          config={config}
          busy={!!busy}
          onVariant={onVariant}
          onTestAll={onTestAll}
          btn={btn}
        />
      )}

      {vars && <KaraVarsStrip vars={vars} pos={pos} />}

      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 border-t bg-muted/30 text-xs">
        <div className="flex items-center">
          <button className={btn} onClick={() => go(0)} disabled={!trace || pos === 0} title="To start">
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button className={btn} onClick={() => go(pos - 1)} disabled={!trace || pos === 0} title="Step back (←)">
            <StepBack className="w-3.5 h-3.5" />
          </button>
          <button className={btn} onClick={togglePlay} disabled={!trace || total === 0} title={isPlaying ? 'Pause (space)' : 'Play (space)'}>
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button className={btn} onClick={() => go(pos + 1)} disabled={!trace || pos >= total} title="Step forward (→)">
            <StepForward className="w-3.5 h-3.5" />
          </button>
          <button className={btn} onClick={() => go(total)} disabled={!trace || pos >= total} title="To end">
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={total}
          value={pos}
          disabled={!trace || total === 0}
          onChange={e => go(Number(e.target.value))}
          className="flex-1 min-w-24 accent-primary"
          aria-label="Step"
        />
        <span className="min-w-[13rem] text-right tabular-nums text-muted-foreground whitespace-nowrap">
          {trace ? `Step ${pos} / ${total}` : 'Press Run'}
          {pos > 0 && steps[pos - 1] ? ` · line ${steps[pos - 1].l}` : ''}
          {pos > 0 && steps[pos - 1]?.sub && replay ? ` · ${steps[pos - 1].sub}/${replay.subTotal[pos - 1]}` : ''}
          {pos > 0 && hasDepth && steps[pos - 1] ? <span title="Call depth: how many functions are running right now"> · depth {steps[pos - 1].d ?? 0}</span> : ''}
        </span>
        {(hasHelperSteps || config.debug) && (
          <button
            className={cn(
              'flex h-6 items-center gap-1 rounded border px-1.5 text-[11px] whitespace-nowrap',
              stepMode === 'into'
                ? 'border-amber-400/70 bg-amber-100 text-amber-900 dark:border-amber-500/50 dark:bg-amber-900/30 dark:text-amber-200'
                : 'bg-background text-muted-foreground hover:bg-muted',
            )}
            onClick={() => setStepMode(m => (m === 'into' ? 'over' : 'into'))}
            aria-pressed={stepMode === 'into'}
            title={stepMode === 'into'
              ? 'Step into is on: the editor follows each action into the helper file (e.g. befehle.py). Click to turn it off (step over).'
              : 'Step into is off: the marker stays on the call in main.py. Click to follow actions into helper files.'}
          >
            {/* Fixed label + pressed state (a toggle names its feature, not its current mode). */}
            <CornerDownRight className="h-3 w-3" />
            Step into
          </button>
        )}
        {trace && starsCount && pos === total && config.goals.length > 0 && !trace.error && (
          <span className="flex items-center" title={karaLimits(trace, config)}>
            {[1, 2, 3].map(n => (
              <Star key={n} className={cn('w-3.5 h-3.5', n <= stars ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40')} />
            ))}
          </span>
        )}
        {aftermath && aftermathAuto && !showAftermath && (
          <button className={btn} onClick={() => { setCards([]); enterAftermath() }} title="Airlock test: replay your program in the airlock">
            <Rocket className="w-3.5 h-3.5" />
          </button>
        )}
        {musicSrc && (
          <button className={cn(btn, musicOn && 'bg-muted')} onClick={() => setMusicOn(m => !m)} title={musicOn ? 'Music off' : 'Music on'}>
            <Music className="w-3.5 h-3.5" />
          </button>
        )}
        <select
          value={speed}
          onChange={e => setSpeed(Number(e.target.value))}
          className="h-6 rounded border bg-background px-1 text-xs"
          title="Playback speed (steps per second)"
        >
          {SPEEDS.map(s => <option key={s} value={s}>{s}/s</option>)}
        </select>
      </div>

      <div onMouseDown={dragAbove(barHeight, setBarHeight, 60, 500)} onTouchStart={dragAbove(barHeight, setBarHeight, 60, 500)} className="relative h-2 shrink-0 cursor-row-resize border-t bg-border/60 hover:bg-primary/20 touch-none" title="Drag to resize">
        <div className="absolute -top-2 -bottom-2 inset-x-0 md:hidden" />
      </div>
      <MessageBar card={card} assets={assets} onContinue={cards.length ? closeCard : undefined} more={cards.length - 1} minHeight={barHeight} fixed={fill} />

      {/* Sensor results and errors are shown inline in the code (kara-line-extension).
          The output box is reserved for the whole replay once the run printed
          anything, so nothing below the world changes size while stepping. */}
      {replay?.output && (
        <>
          {/* Drag handle: height stays fixed while stepping, the student sets it. */}
          <div onMouseDown={dragAbove(outputHeight, setOutputHeight, 40, 600)} onTouchStart={dragAbove(outputHeight, setOutputHeight, 40, 600)} className="relative h-2 shrink-0 cursor-row-resize border-t bg-border/60 hover:bg-primary/20 touch-none" title="Drag to resize">
            <div className="absolute -top-2 -bottom-2 inset-x-0 md:hidden" />
          </div>
          <pre ref={outputRef} style={{ height: outputHeight }} className="shrink-0 overflow-auto px-2 py-1 text-xs font-mono whitespace-pre-wrap">{output}</pre>
        </>
      )}
    </div>
  )
}

/**
 * Variant picker + «Test all worlds» + per-world results. A result shows a
 * check and its stars when the world was won, a cross otherwise, a spinner
 * while the suite still runs; clicking it selects (and replays) that world.
 */
function WorldBar({ variant, count, suite, suiteStars, config, busy, onVariant, onTestAll, btn }: {
  variant: number
  count: number
  suite: { traces: (KaraTrace | null)[]; done: boolean } | null
  suiteStars: number
  config: KaraConfig
  busy: boolean
  onVariant?: (v: number) => void
  onTestAll?: () => void
  btn: string
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t bg-muted/30 px-2 py-1 text-xs">
      <div className="flex items-center">
        <button className={btn} onClick={() => onVariant?.(variant - 1)} disabled={busy || variant === 0} title="Previous world">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="min-w-[4.5rem] text-center tabular-nums" title="Run uses this world">World {variant + 1}/{count}</span>
        <button className={btn} onClick={() => onVariant?.(variant + 1)} disabled={busy || variant >= count - 1} title="Next world">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <button
        onClick={onTestAll}
        disabled={busy || !onTestAll}
        className="flex h-6 items-center gap-1 rounded border bg-background px-2 hover:bg-muted disabled:opacity-50"
        title="Run the program in every world; stars count only for all worlds"
      >
        <ListChecks className="w-3.5 h-3.5" /> Test all worlds
      </button>
      {suite && (
        <div className="flex flex-wrap items-center gap-1" role="list" aria-label="Results per world">
          {suite.traces.map((t, i) => {
            const s = t ? karaStars(t, config) : 0
            return (
              <button
                key={i}
                role="listitem"
                onClick={() => onVariant?.(i)}
                disabled={busy || !t}
                title={t ? `World ${i + 1}: ${s ? `${s} star${s > 1 ? 's' : ''}` : 'not solved'}` : `World ${i + 1}: running…`}
                className={cn(
                  'flex h-6 items-center gap-0.5 rounded border px-1.5 tabular-nums',
                  !t ? 'text-muted-foreground'
                    : s ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
                  i === variant && 'ring-1 ring-primary',
                )}
              >
                {i + 1}
                {!t ? <Loader2 className="w-3 h-3 animate-spin" /> : s ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                {s > 0 && <span className="flex">{[1, 2, 3].map(n => <Star key={n} className={cn('w-2.5 h-2.5', n <= s ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40')} />)}</span>}
              </button>
            )
          })}
          {suite.done && (
            <span className="ml-1 text-muted-foreground" title="Stars saved: the minimum over all worlds">
              {suiteStars ? `All worlds: ${suiteStars}★` : 'Not every world solved'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** Dialogue bar under the world: at least `minHeight` (draggable divider above), grows with long text, fills spare height side by side. */
function MessageBar({ card, assets, onContinue, more, minHeight, fixed }: { card: KaraCard | null; assets?: Record<string, string>; onContinue?: () => void; more: number; minHeight: number; fixed?: boolean }) {
  const speaker = card?.message.speaker
  const speaking = useSpeaking(speaker, card?.message.text)
  return (
    // items-center-safe: when the text is taller than a fixed bar, align to the top so it can
    // scroll (plain items-center pushes the first lines above the scroll origin, unreachable).
    <div style={fixed ? { height: minHeight } : { minHeight }} className={cn('flex shrink-0 items-center-safe gap-3 overflow-y-auto px-3 text-sm', onContinue ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-muted/20', speaking && card && isAd(card.message.text) && 'kara-ad-disco')}>
      {card && speaker && <KaraPortrait speaker={speaker} assets={assets} speaking={speaking} className="h-14 w-14" />}
      <div className="min-w-0 flex-1 py-2">
        {card ? (
          <>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {[card.title, speaker].filter(Boolean).join(' · ')}
            </div>
            {isAd(card.message.text)
              ? <AdMark><p className="leading-snug whitespace-pre-wrap">{displayText(card.message.text)}</p></AdMark>
              : <p className="leading-snug whitespace-pre-wrap">{displayText(card.message.text)}</p>}
            {(card.stars !== undefined || card.detail) && (
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                {card.stars !== undefined && (
                  <span className="flex">
                    {[1, 2, 3].map(n => (
                      <Star key={n} className={cn('w-3.5 h-3.5', n <= card.stars! ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground/40')} />
                    ))}
                  </span>
                )}
                {card.detail}
              </div>
            )}
          </>
        ) : null}
      </div>
      {onContinue && (
        <button onClick={onContinue} className="shrink-0 rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:opacity-90">
          {more > 0 ? 'Next' : 'Continue'}
        </button>
      )}
    </div>
  )
}
