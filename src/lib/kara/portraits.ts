/**
 * Portrait for a Kara speaker: a skript file `portrait-<speaker>.png` wins;
 * otherwise the built-in MOP-7 cast in public/kara/portraits/ (own Blender
 * renders). Unknown speakers without a file get none (the bar shows an initial).
 */

import { karaHost } from './host'

const BUILT_IN = new Set(['aurora', 'brandt', 'bueroklaemmerli', 'jonas', 'lenz', 'pavel', 'tanaka', 'weber'])

/** 'BÜROKLÄMMERLI' → 'bueroklaemmerli' (built-in file names are ASCII). */
function asciiKey(key: string): string {
  return key.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
}

export function karaPortrait(speaker: string, assets?: Record<string, string>): string | undefined {
  const key = speaker.toLowerCase()
  const builtIn = asciiKey(key)
  return assets?.[`portrait:${key}`] ?? (BUILT_IN.has(builtIn) ? karaHost().assetUrl(`/kara/portraits/${builtIn}.png`) : undefined)
}
