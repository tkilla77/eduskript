/**
 * Tileset rendering for the Kara world.
 *
 * The art is a licensed pack (gameart2d "Sci-fi Top Down Tileset") that may
 * not be redistributed, so it is NOT in this repo. It is served from the
 * host's tilesetUrl (host.ts; in Eduskript NEXT_PUBLIC_KARA_TILESET_URL: bucket
 * in prod, /kara-tiles from a gitignored public/ folder in dev). Without it —
 * e.g. in a fork — every tile falls back to a labelled placeholder; the world
 * stays fully usable.
 *
 * Walls are autotiled: each `#` cell picks one of the pack's wall pieces from
 * its 8 neighbours (metal border where the neighbour is not a wall, a small
 * nub for inner corners). A wall with floor directly south is drawn as the
 * wall's front face instead (3/4 perspective). The pack covers 32 of the 47
 * neighbour combinations; the rest use the closest piece (see pickWall).
 */

import { ACID, BLOCK, BOX, CHIP, DOOR, ITEM, LASER, type KaraWorld } from './world'
import { karaHost } from './host'

// Mask bits: border on a side (neighbour is not a wall) + inner-corner nubs.
const N = 1, E = 2, S = 4, W = 8, NE = 16, SE = 32, SW = 64, NW = 128

/** mask → wall piece number (file wall-<n>.png), read off the pack's tiles. */
const WALL_PIECES: Record<number, number> = {
  0: 10, [NW]: 19, [SW]: 17, [SW | NW]: 21, [SE]: 16, [SE | SW]: 23, [NE]: 18,
  [NE | NW]: 22, [NE | SE]: 20, [NE | SE | SW | NW]: 34,
  [W]: 11, [W | NE | SE]: 24, [S]: 13, [S | NE | NW]: 27, [S | W]: 12, [S | W | NE]: 30,
  [E]: 9, [E | SW | NW]: 25, [E | W]: 33, [E | S]: 14, [E | S | NW]: 31, [E | S | W]: 35,
  [N]: 7, [N | SE | SW]: 26, [N | W]: 6, [N | W | SE]: 28, [N | S]: 2, [N | S | W]: 1,
  [N | E]: 8, [N | E | SW]: 29, [N | E | W]: 32, [N | E | S]: 5,
}
const WALL_MASKS = Object.keys(WALL_PIECES).map(Number)

const bits = (n: number) => { let c = 0; while (n) { c += n & 1; n >>= 1 } return c }

/** Exact piece if the pack has it, else the one with the fewest differing edges (then nubs). */
function pickWall(mask: number): number {
  if (mask in WALL_PIECES) return WALL_PIECES[mask]
  let best = 0, bestScore = Infinity
  for (const m of WALL_MASKS) {
    const score = bits((m ^ mask) & 15) * 10 + bits((m ^ mask) & 240)
    if (score < bestScore) { bestScore = score; best = m }
  }
  return WALL_PIECES[best]
}

const OBSTACLES: Record<string, string> = {
  T: 'table', P: 'desk', L: 'locker', R: 'barrel-red', Y: 'barrel-yellow', t: 'terminal',
}
/** Static floor objects drawn from `look` (not flags). */
const FLOOR_OBJECTS: Record<string, string> = { S: 'switch', m: 'switch' }

const TILE_NAMES = [
  'floor', 'grate', 'face', 'face-alt', 'face-sign', 'item', 'box',
  'door-closed', 'door-open', 'laser-h', 'laser-v', 'acid',
  ...Object.values(OBSTACLES), ...Object.values(FLOOR_OBJECTS),
  ...[...new Set(Object.values(WALL_PIECES))].map(n => `wall-${n}`),
]

export type KaraTileset = Map<string, HTMLImageElement>

/**
 * Evidence sprites (own Blender renders, ~/coding/mop7-trailer/scripts/evidence.py),
 * shipped in public/kara/evidence/ like the MOP-7 sprites, so they load
 * without the licensed tileset. Stored in the tileset as `evidence-<look>`.
 */
export const EVIDENCE_LOOKS = ['cup', 'note', 'logbook', 'datachip', 'camera', 'bottle']

/** Own obstacle sprites in public/kara/obstacles/ (Blender, ~/coding/mop7-trailer/scripts/crates.py). */
const OWN_OBSTACLES = ['coffee-1', 'coffee-2', 'coffee-3']

let tilesetPromise: Promise<KaraTileset> | null = null

/** Loads every tile once per page. Missing files are simply absent (→ placeholder). */
export function loadKaraTileset(): Promise<KaraTileset> {
  tilesetPromise ??= (async () => {
    const set: KaraTileset = new Map()
    const load = (name: string, src: string) => new Promise<void>((resolve) => {
      const img = new Image()
      img.onload = () => { set.set(name, img); resolve() }
      img.onerror = () => resolve()
      img.src = src
    })
    const { assetUrl, tilesetUrl } = karaHost()
    const tiles = tilesetUrl()
    await Promise.all([
      ...EVIDENCE_LOOKS.map(l => load(`evidence-${l}`, assetUrl(`/kara/evidence/${l}.png`))),
      ...OWN_OBSTACLES.map(n => load(n, assetUrl(`/kara/obstacles/${n}.png`))),
      ...(tiles ? TILE_NAMES.map(name => load(name, `${tiles}/${name}.png`)) : []),
    ])
    return set
  })()
  return tilesetPromise
}

// Doors and exits sit inside walls, so they count as wall for the autotiler.
const WALL_LOOKS = new Set(['#', 'D', 'E'])

// Deterministic per-cell variation (wall faces), stable across redraws.
const cellHash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0

/** Tile name for a `#` cell. Out-of-bounds counts as wall so the rim closes. */
function wallTile(world: KaraWorld, x: number, y: number): string {
  const isWall = (cx: number, cy: number) =>
    cx < 0 || cy < 0 || cx >= world.cols || cy >= world.rows || WALL_LOOKS.has(world.look[cy * world.cols + cx])
  if (y + 1 < world.rows && !isWall(x, y + 1)) {
    const h = cellHash(x, y) % 10
    return h === 0 ? 'face-sign' : h < 3 ? 'face-alt' : 'face'
  }
  const n = isWall(x, y - 1), e = isWall(x + 1, y), s = isWall(x, y + 1), w = isWall(x - 1, y)
  let mask = 0
  if (!n) mask |= N
  if (!e) mask |= E
  if (!s) mask |= S
  if (!w) mask |= W
  if (n && e && !isWall(x + 1, y - 1)) mask |= NE
  if (s && e && !isWall(x + 1, y + 1)) mask |= SE
  if (s && w && !isWall(x - 1, y + 1)) mask |= SW
  if (n && w && !isWall(x - 1, y - 1)) mask |= NW
  return `wall-${pickWall(mask)}`
}

// ─── Placeholders (no tileset) ────────────────────────────────────────────

const PLACEHOLDER: Record<string, { fill: string; label?: string }> = {
  floor: { fill: '#e2e8f0' }, grate: { fill: '#cbd5e1' },
  wall: { fill: '#334155' },
  item: { fill: '#16a34a', label: 'item' }, box: { fill: '#a16207', label: 'box' },
  table: { fill: '#64748b', label: 'T' }, desk: { fill: '#64748b', label: 'D' },
  locker: { fill: '#64748b', label: 'L' }, 'barrel-red': { fill: '#dc2626', label: 'R' },
  'barrel-yellow': { fill: '#ca8a04', label: 'Y' },
  terminal: { fill: '#0f766e', label: 't' }, switch: { fill: '#7c3aed', label: 'S' },
  exit: { fill: '#15803d', label: 'E' }, acid: { fill: '#84cc16' },
  'door-closed': { fill: '#475569', label: 'D' }, 'door-open': { fill: '#cbd5e1', label: 'd' },
  'laser-h': { fill: '#ef4444', label: '=' }, 'laser-v': { fill: '#ef4444', label: '|' },
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, s: number, full: boolean) {
  const p = PLACEHOLDER[name.startsWith('wall') || name.startsWith('face') ? 'wall' : name] ?? { fill: '#94a3b8', label: '?' }
  ctx.fillStyle = p.fill
  if (full) {
    ctx.fillRect(x, y, s, s)
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1)
  } else {
    const pad = s * 0.18
    ctx.beginPath(); ctx.roundRect(x + pad, y + pad, s - 2 * pad, s - 2 * pad, s * 0.1); ctx.fill()
  }
  if (p.label && s >= 20) {
    ctx.fillStyle = '#fff'
    ctx.font = `${Math.round(s * 0.22)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(p.label, x + s / 2, y + s / 2)
  }
}

/** Full-cell tile (floor, wall). */
function drawCell(ctx: CanvasRenderingContext2D, set: KaraTileset, name: string, x: number, y: number, s: number) {
  const img = set.get(name)
  if (img) ctx.drawImage(img, x, y, s, s)
  else drawPlaceholder(ctx, name, x, y, s, true)
}

/** Object standing in a cell: fitted to 86 % of the cell, bottom-aligned. */
function drawObject(ctx: CanvasRenderingContext2D, set: KaraTileset, name: string, x: number, y: number, s: number) {
  const img = set.get(name)
  if (!img) { drawPlaceholder(ctx, name, x, y, s, false); return }
  const f = (s * 0.86) / Math.max(img.naturalWidth, img.naturalHeight)
  const w = img.naturalWidth * f
  const h = img.naturalHeight * f
  ctx.drawImage(img, x + (s - w) / 2, y + s - h - s * 0.06, w, h)
}

/**
 * Draw the world (without Kara). `cells` is the current flag state (items and
 * boxes move); walls/obstacles come from the static `world.look`. Marks are
 * drawn separately (drawKaraMarks), after MOP-7's sprite.
 */
export function drawKaraTiles(ctx: CanvasRenderingContext2D, world: KaraWorld, cells: number[], tile: number, set: KaraTileset, chipLooks?: (string | undefined)[]) {
  // Chip cell → its `look=` (chips are numbered in reading order, like config.chips).
  const lookAt = new Map<number, string | undefined>(world.chips.map(([cx, cy], k) => [cy * world.cols + cx, chipLooks?.[k]]))
  for (let y = 0; y < world.rows; y++) {
    for (let x = 0; x < world.cols; x++) {
      const i = y * world.cols + x
      const look = world.look[i]
      const c = cells[i]
      const px = x * tile
      const py = y * tile
      if (look === '#') { drawCell(ctx, set, wallTile(world, x, y), px, py, tile); continue }
      // `x` (crate) is the pack's floor grate; it reads as a crate, so it blocks.
      if (look === 'a') { drawAirlock(ctx, x, y, px, py, tile); if (c & BOX) drawObject(ctx, set, 'box', px, py, tile); continue }
      drawCell(ctx, set, look === 'x' ? 'grate' : look === '~' ? 'acid' : 'floor', px, py, tile)
      if (look === 'D') drawCell(ctx, set, c & DOOR ? 'door-closed' : 'door-open', px, py, tile)
      if ((look === '=' || look === '|') && c & LASER) drawCell(ctx, set, look === '=' ? 'laser-h' : 'laser-v', px, py, tile)
      if (look === 'o' || look === 'q') drawTarget(ctx, px, py, tile)
      if (look === 'q') drawBrokenSensor(ctx, px, py, tile)
      if (look === 's') drawSlime(ctx, x, y, px, py, tile)
      if (look === '~' && !(c & ACID)) drawBridge(ctx, x, y, px, py, tile)
      if (look === 'S' || look === 'm') drawSwitchPad(ctx, px, py, tile)
      // The only kind of exit: an open door in a wall row, entered from below
      // (see isWallExit; check.ts rejects any other placement).
      if (look === 'E') { drawCell(ctx, set, 'door-open', px, py, tile); continue }
      if (FLOOR_OBJECTS[look]) drawObject(ctx, set, FLOOR_OBJECTS[look], px, py, tile)
      if (look === 'm') drawMusicNote(ctx, px, py, tile)
      if (c & BLOCK && OBSTACLES[look]) drawObject(ctx, set, OBSTACLES[look], px, py, tile)
      // `K`: coffee crates, one of three stacks picked per cell (stable across redraws).
      if (c & BLOCK && look === 'K') drawObject(ctx, set, OWN_OBSTACLES[cellHash(x, y) % OWN_OBSTACLES.length], px, py, tile)
      if (c & CHIP) drawEvidence(ctx, set, lookAt.get(i), px, py, tile)
      if (c & ITEM) drawObject(ctx, set, 'item', px, py, tile)
      if (c & BOX) drawObject(ctx, set, 'box', px, py, tile)
    }
  }
}

/**
 * Mark labels (mark / mark_at, row-major, null = none): a translucent cyan
 * sonar tint on the cell and the label in a dark pill at the bottom right.
 * Call it after the sprite so the label stays readable on MOP-7's cell.
 * The canvas has the same colours in light and dark mode. O(cells).
 */
export function drawKaraMarks(ctx: CanvasRenderingContext2D, world: KaraWorld, marks: (string | null)[], s: number) {
  ctx.save()
  const font = Math.max(8, Math.round(s * 0.3))
  ctx.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < marks.length; i++) {
    const label = marks[i]
    if (label == null) continue
    const px = (i % world.cols) * s
    const py = Math.floor(i / world.cols) * s
    ctx.fillStyle = 'rgba(34, 211, 238, 0.22)'
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2)
    const w = Math.max(font * 0.9, ctx.measureText(label).width + font * 0.5)
    const h = font * 1.15
    const bx = px + s - w - s * 0.04
    const by = py + s - h - s * 0.04
    ctx.fillStyle = 'rgba(8, 47, 73, 0.85)'
    ctx.beginPath(); ctx.roundRect(bx, by, w, h, h * 0.35); ctx.fill()
    ctx.strokeStyle = 'rgba(103, 232, 249, 0.9)'
    ctx.lineWidth = Math.max(1, s * 0.025)
    ctx.stroke()
    ctx.fillStyle = '#cffafe'
    ctx.fillText(label, bx + w / 2, by + h / 2 + 0.5)
  }
  ctx.restore()
}

/**
 * Bridged acid (music switch, look '~' without the ACID flag): Gerald, a
 * yellow-green slime mold, spans the cell — a blobby band with a few
 * darker cores. Drawn over the acid tile, so the acid still shows at the edges.
 */
function drawBridge(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number) {
  const h = cellHash(x, y)
  ctx.save()
  ctx.fillStyle = 'rgba(234, 179, 8, 0.92)'
  ctx.strokeStyle = 'rgba(113, 63, 18, 0.8)'
  ctx.lineWidth = Math.max(1, s * 0.03)
  ctx.beginPath()
  ctx.roundRect(px + s * 0.06, py + s * 0.06, s * 0.88, s * 0.88, s * 0.3)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = 'rgba(161, 98, 7, 0.75)'
  for (let k = 0; k < 4; k++) {
    const ox = ((h >> (k * 4)) % 56) / 100 + 0.22
    const oy = ((h >> (k * 4 + 2)) % 56) / 100 + 0.22
    ctx.beginPath(); ctx.arc(px + ox * s, py + oy * s, s * 0.07, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

/**
 * Floor pad under a switch: a yellow ring on the floor, so the switch reads
 * as «stand on it» next to a terminal («stand in front of it»); both tiles
 * are a panel on a pole in the art pack (playtest w1-l2).
 */
function drawSwitchPad(ctx: CanvasRenderingContext2D, px: number, py: number, s: number) {
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(px + s / 2, py + s * 0.72, s * 0.4, s * 0.2, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(250, 204, 21, 0.35)'
  ctx.fill()
  ctx.lineWidth = Math.max(1.5, s * 0.05)
  ctx.strokeStyle = '#facc15'
  ctx.setLineDash([s * 0.1, s * 0.07])
  ctx.stroke()
  ctx.restore()
}

/** Music switch ('m'): a glowing note above the switch plate. */
function drawMusicNote(ctx: CanvasRenderingContext2D, px: number, py: number, s: number) {
  ctx.save()
  ctx.font = `700 ${Math.round(s * 0.42)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = '#e879f9'
  ctx.shadowBlur = s * 0.2
  ctx.lineWidth = Math.max(2, s * 0.06)
  ctx.strokeStyle = 'rgba(28, 25, 23, 0.8)'
  ctx.strokeText('\u266A', px + s * 0.72, py + s * 0.28)
  ctx.fillStyle = '#f0abfc'
  ctx.fillText('\u266A', px + s * 0.72, py + s * 0.28)
  ctx.restore()
}

// ─── Vector overlays (no matching art in the pack) ────────────────────────

function drawTarget(ctx: CanvasRenderingContext2D, px: number, py: number, s: number) {
  ctx.save()
  ctx.strokeStyle = '#facc15'
  ctx.lineWidth = Math.max(1.5, s * 0.05)
  ctx.setLineDash([s * 0.12, s * 0.08])
  ctx.strokeRect(px + s * 0.14, py + s * 0.14, s * 0.72, s * 0.72)
  ctx.restore()
}

/**
 * Broken target sensor ('q'): a small dark sensor box in the corner with a
 * red status LED. Deliberately subtle, the class should notice it (or not).
 */
function drawBrokenSensor(ctx: CanvasRenderingContext2D, px: number, py: number, s: number) {
  ctx.save()
  const w = s * 0.16
  ctx.fillStyle = '#1e293b'
  ctx.fillRect(px + s * 0.08, py + s * 0.08, w, w)
  ctx.fillStyle = '#ef4444'
  ctx.shadowColor = '#ef4444'
  ctx.shadowBlur = s * 0.12
  ctx.beginPath(); ctx.arc(px + s * 0.08 + w / 2, py + s * 0.08 + w / 2, w * 0.28, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

/** Open airlock ('a'): space with a few stars, framed by hazard stripes. */
function drawAirlock(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number) {
  ctx.save()
  ctx.fillStyle = '#020617'
  ctx.fillRect(px, py, s, s)
  const h = cellHash(x, y)
  ctx.fillStyle = '#e2e8f0'
  for (let k = 0; k < 5; k++) {
    const ox = ((h >> (k * 3)) % 80) / 100 + 0.1
    const oy = ((h >> (k * 3 + 5)) % 80) / 100 + 0.1
    ctx.fillRect(px + ox * s, py + oy * s, Math.max(1, s * 0.03), Math.max(1, s * 0.03))
  }
  // Hazard stripes along the cell border (clipped to a frame ring).
  const b = s * 0.09
  ctx.beginPath()
  ctx.rect(px, py, s, s)
  ctx.rect(px + b, py + b, s - 2 * b, s - 2 * b)
  ctx.clip('evenodd')
  ctx.fillStyle = '#facc15'
  ctx.fillRect(px, py, s, s)
  ctx.strokeStyle = '#1c1917'
  ctx.lineWidth = s * 0.07
  for (let o = -s; o < s * 2; o += s * 0.2) {
    ctx.beginPath(); ctx.moveTo(px + o, py); ctx.lineTo(px + o - s, py + s); ctx.stroke()
  }
  ctx.restore()
}

function drawSlime(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number) {
  const h = cellHash(x, y)
  ctx.save()
  ctx.fillStyle = 'rgba(132, 204, 22, 0.55)'
  for (let k = 0; k < 3; k++) {
    const ox = ((h >> (k * 4)) % 60) / 100 + 0.2
    const oy = ((h >> (k * 4 + 2)) % 60) / 100 + 0.2
    ctx.beginPath(); ctx.ellipse(px + ox * s, py + oy * s, s * 0.16, s * 0.1, (h % 7) / 3, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

/**
 * An evidence item: its `look` sprite (else the data-chip sprite, else the
 * drawn chip), with a soft cyan glow so it reads as «pick me up».
 */
function drawEvidence(ctx: CanvasRenderingContext2D, set: KaraTileset, look: string | undefined, px: number, py: number, s: number) {
  const img = set.get(`evidence-${look ?? 'datachip'}`) ?? set.get('evidence-datachip')
  if (!img) { drawChip(ctx, px, py, s); return }
  const size = s * 0.8
  ctx.save()
  ctx.shadowColor = 'rgba(34, 211, 238, 0.85)'
  ctx.shadowBlur = s * 0.18
  ctx.drawImage(img, px + (s - size) / 2, py + (s - size) / 2, size, size)
  ctx.restore()
}

/**
 * Exits sit in a wall row and are entered from the floor cell below (moving
 * north). Drawn as an open door; the exit animation clips MOP-7 at
 * WALL_EXIT_TOP tiles above the exit cell's floor line, inside the doorway.
 */
export const WALL_EXIT_TOP = 0.9

/** True when the `E` at (x, y) is a wall exit: floor below it, wall (or the edge) above. */
export function isWallExit(world: KaraWorld, x: number, y: number): boolean {
  const below = y + 1 < world.rows ? world.look[(y + 1) * world.cols + x] : '#'
  const above = y > 0 ? world.look[(y - 1) * world.cols + x] : '#'
  return below !== '#' && (above === '#' || y === 0)
}

function drawChip(ctx: CanvasRenderingContext2D, px: number, py: number, s: number) {
  const w = s * 0.34
  const x0 = px + (s - w) / 2
  const y0 = py + (s - w) / 2
  ctx.save()
  ctx.shadowColor = '#22d3ee'
  ctx.shadowBlur = s * 0.2
  ctx.fillStyle = '#0e7490'
  ctx.fillRect(x0, y0, w, w)
  ctx.shadowBlur = 0
  ctx.strokeStyle = '#a5f3fc'
  ctx.lineWidth = Math.max(1, s * 0.02)
  for (let k = 1; k < 4; k++) {
    const o = (w * k) / 4
    ctx.beginPath()
    ctx.moveTo(x0 + o, y0 - s * 0.05); ctx.lineTo(x0 + o, y0 + w + s * 0.05)
    ctx.moveTo(x0 - s * 0.05, y0 + o); ctx.lineTo(x0 + w + s * 0.05, y0 + o)
    ctx.stroke()
  }
  ctx.fillStyle = '#67e8f9'
  ctx.fillRect(x0 + w * 0.3, y0 + w * 0.3, w * 0.4, w * 0.4)
  ctx.restore()
}

/**
 * Facing indicator: a headlamp cone from MOP-7 into the cell in front, with a
 * small chevron at its tip. Drawn before the sprite, so the sprite covers the
 * cone's root. (x, y) may be fractional (slide animation); d: 0 = N … 3 = W.
 * Near the world's edge the cone is clipped by the canvas (no torus wrap).
 */
export function drawKaraFacing(ctx: CanvasRenderingContext2D, x: number, y: number, d: number, s: number) {
  const cx = (x + 0.5) * s
  const cy = (y + 0.5) * s
  const angle = (d - 1) * (Math.PI / 2) // 0 rad = east
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  const r0 = s * 0.3, r1 = s * 1.05
  const g = ctx.createLinearGradient(r0, 0, r1, 0)
  g.addColorStop(0, 'rgba(253, 230, 138, 0.55)')
  g.addColorStop(1, 'rgba(253, 230, 138, 0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(r0, -s * 0.12)
  ctx.lineTo(r1, -s * 0.36)
  ctx.lineTo(r1, s * 0.36)
  ctx.lineTo(r0, s * 0.12)
  ctx.closePath()
  ctx.fill()
  // Chevron in the front cell, outlined so it reads on light and dark tiles.
  const t = s * 0.62, w = s * 0.11
  ctx.beginPath()
  ctx.moveTo(t - w, -w * 1.3)
  ctx.lineTo(t + w * 0.6, 0)
  ctx.lineTo(t - w, w * 1.3)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(28, 25, 23, 0.7)'
  ctx.lineWidth = Math.max(2.5, s * 0.08)
  ctx.stroke()
  ctx.strokeStyle = '#fde047'
  ctx.lineWidth = Math.max(1.5, s * 0.045)
  ctx.stroke()
  ctx.restore()
}
