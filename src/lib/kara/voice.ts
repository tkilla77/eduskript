'use client'

/**
 * Plays Kara voice lines in the browser. Lines come either from a skript file
 * (`audio=` in the level config) or from the host's voiceLineUrl (host.ts; in
 * Eduskript the cached TTS route /api/kara/tts, which returns the cached raw
 * line, rendering it on first request, see src/lib/kara/voice-tts.server.ts).
 * The speaker's voice effect is applied live via Web Audio (voice-fx.ts).
 * One line plays at a time.
 */

let ctx: AudioContext | null = null
import { connectVoiceFx, VOICE_FX } from './voice-fx'
import { adSpan } from './voice-directions'
import { isMuted, onMuteChange } from '@/lib/sound'
import { karaHost } from './host'

// Lines play through an <audio> element (pitch-preserving `playbackRate`)
// routed into Web Audio for the effect chain. Needs CORS on the file host
// (the teacher bucket allows *).
let current: { el: HTMLAudioElement; stop: () => void } | null = null
// Taps the playing line (before the effect chain) for voiceLevel(); portraits
// pulse with it (aurora-mark.tsx).
let analyser: AnalyserNode | null = null
let levelBuf: Float32Array<ArrayBuffer> | null = null
/** `SPEAKER|text` of the line playing right now (text = as passed to playVoice), null when silent. */
let speakingNow: string | null = null
const speakingListeners = new Set<() => void>()
function setSpeaking(s: string | null) {
  if (speakingNow === s) return
  speakingNow = s
  speakingListeners.forEach(cb => cb())
}

/** `SPEAKER|text` of the line playing right now, null when silent (see speakingKey). */
export function voiceSpeaker(): string | null { return speakingNow }

/** Key of a line for voiceSpeaker(): upper-case speaker and the text as written. */
export function speakingKey(speaker: string, text = ''): string { return `${speaker.toUpperCase()}|${text}` }
export function onVoiceSpeakerChange(cb: () => void): () => void {
  speakingListeners.add(cb)
  return () => { speakingListeners.delete(cb) }
}

/** Loudness of the playing line, roughly 0..1 (RMS, scaled). 0 when silent. */
export function voiceLevel(): number {
  if (!analyser || !levelBuf || !speakingNow) return 0
  analyser.getFloatTimeDomainData(levelBuf)
  let sum = 0
  for (const v of levelBuf) sum += v * v
  return Math.min(1, Math.sqrt(sum / levelBuf.length) * 4)
}
let seq = 0 // latest playVoice call wins
const urlCache = new Map<string, Promise<string | null>>()

/** Shared AudioContext for Kara voices and effects (sfx.ts). */
export function audio(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** URL of a pre-rendered line; null when there is none (or the host has no voices). */
export function ttsLineUrl(speaker: string, text: string): Promise<string | null> {
  const key = `${speaker}|${text}`
  let p = urlCache.get(key)
  if (!p) {
    p = karaHost().voiceLineUrl?.(speaker, text) ?? Promise.resolve(null)
    urlCache.set(key, p)
  }
  return p
}

/** Drop a cached line URL, e.g. after an author picked a new take for it. */
export function forgetTtsLine(speaker: string, text: string) {
  urlCache.delete(`${speaker}|${text}`)
}

const stopListeners = new Set<() => void>()

/** Called whenever a playing (or loading) line is cut off, including by the next playVoice(). */
export function onVoiceStop(cb: () => void): () => void {
  stopListeners.add(cb)
  return () => { stopListeners.delete(cb) }
}

/** Ad jingle under a `{werbung}` part of the playing line (adSpan). */
const AD_JINGLE = '/kara/sfx/werbung.mp3'
const AD_VOLUME = 0.1
const AD_FADE_IN = 1.5 // seconds
const AD_FADE_OUT = 2 // seconds; also after the line ends
const AD_FADE_CUT = 0.4 // seconds, when another line or Stop interrupts
/** Voice gain while the ad runs (a limiter after it keeps peaks below 0 dBFS). */
const AD_VOICE_BOOST = 1.35
let ad: { el: HTMLAudioElement; timers: number[]; gain: GainNode } | null = null

/** End the ad: music fades out over `fade` seconds, the voice gain returns to 1. */
function stopAd(fade = AD_FADE_OUT) {
  if (!ad) return
  const { el, timers, gain } = ad
  ad = null
  timers.forEach(t => clearTimeout(t))
  gain.gain.setTargetAtTime(1, gain.context.currentTime, 0.15)
  const from = el.volume
  const t0 = performance.now()
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / (fade * 1000))
    el.volume = from * (1 - k) * (1 - k) // ease out
    if (k < 1) requestAnimationFrame(step); else el.pause()
  }
  requestAnimationFrame(step)
}

/**
 * Schedule the jingle for the line `text`, voiced by `el` through `gain`
 * (call once it plays): music fades in to AD_VOLUME over AD_FADE_IN while the
 * voice rises to AD_VOICE_BOOST; both return at the end of the ad span.
 */
function scheduleAd(el: HTMLAudioElement, text: string, gain: GainNode) {
  const span = adSpan(text)
  if (!span || !Number.isFinite(el.duration)) return
  const real = (t: number) => (t * el.duration * 1000) / (el.playbackRate || 1) // media → wall-clock ms
  const music = new Audio(karaHost().assetUrl(AD_JINGLE))
  music.loop = true
  music.volume = 0
  const fadeIn = () => {
    gain.gain.setTargetAtTime(AD_VOICE_BOOST, gain.context.currentTime, 0.2)
    void music.play().catch(() => {})
    const t0 = performance.now()
    const step = () => {
      if (ad?.el !== music) return
      const k = Math.min(1, (performance.now() - t0) / (AD_FADE_IN * 1000))
      music.volume = AD_VOLUME * k * k // ease in
      if (k < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  const timers = [
    window.setTimeout(fadeIn, real(span.from)),
    ...(span.to < 1 ? [window.setTimeout(() => stopAd(), real(span.to))] : []),
  ]
  ad = { el: music, timers, gain }
}

export function stopVoice() {
  stopListeners.forEach(cb => cb())
  seq++
  if (current) { current.el.pause(); current.stop(); current = null }
  stopAd(AD_FADE_CUT)
  setSpeaking(null)
}

/**
 * Play `url`, with the speaker's voice effect and speed (VOICE_FX) if it has one.
 * `onEnded` runs when the line finishes on its own (not when another line or
 * stopVoice() cuts it off, and not when muted). `text`: the line as written,
 * for the `{werbung}` jingle (adSpan).
 */
export async function playVoice(url: string, speaker?: string, onEnded?: () => void, text?: string): Promise<void> {
  stopVoice()
  if (isMuted()) return
  const token = seq
  const c = audio()
  const el = new Audio()
  el.crossOrigin = 'anonymous'
  el.src = url
  const fx = speaker ? VOICE_FX[speaker.toUpperCase()] : undefined
  el.preservesPitch = true
  el.playbackRate = fx?.rate ?? 1
  const src = c.createMediaElementSource(el)
  // Line gain (raised during a `{werbung}` part) → limiter → speakers.
  const gain = c.createGain()
  const limiter = c.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = 0.1
  gain.connect(limiter).connect(c.destination)
  const fxStop = fx ? await connectVoiceFx(c, src, gain, fx) : (src.connect(gain), () => {})
  const stop = () => { fxStop(); gain.disconnect(); limiter.disconnect() }
  if (token !== seq) { stop(); return }
  if (!analyser) { analyser = c.createAnalyser(); analyser.fftSize = 512; levelBuf = new Float32Array(analyser.fftSize) }
  src.connect(analyser)
  el.onended = () => {
    stop(); src.disconnect()
    if (current?.el === el) { current = null; setSpeaking(null); stopAd() }
    onEnded?.()
  }
  current = { el, stop }
  await el.play()
  if (token === seq) {
    setSpeaking(speakingKey(speaker ?? '', text))
    if (text) scheduleAd(el, text, gain)
  }
}

// Muting the page stops a line that is already playing.
if (typeof window !== 'undefined') onMuteChange(() => { if (isMuted()) stopVoice() })
