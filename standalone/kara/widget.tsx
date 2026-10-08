/**
 * SPIKE — stand-alone Kara widget: CodeMirror + Run/Stop + KaraPanel.
 *
 * A deliberately small re-assembly of the Kara parts of
 * src/components/public/code-editor/index.tsx (6k lines). Left out: file tabs,
 * toolbox/skript imports, version history, highlights, exam/grading, intro
 * card, voice editor, resizable splitters, aftermath replay, data files.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { python } from '@codemirror/lang-python'
import { indentWithTab } from '@codemirror/commands'
import { KaraPanel } from '@/components/public/code-editor/kara-panel'
import { karaLineHighlighting, showKaraLine, type KaraLineTarget } from '@/components/public/code-editor/kara-line-extension'
import { KARA_MODULE_SOURCE, KARA_RUNNER } from '@/lib/kara/kara-module'
import { karaRunInput, karaStars, parseKaraLevel, type KaraTrace } from '@/lib/kara/world'
import { runPython, warmPyodideWorker } from '@/lib/pyodide-worker.client'
import { host } from './host'

const TIMEOUT_MS = 30_000
const CODE_KEY = 'code'
const MAX_STARS = 3

type Run = { variant: number; trace: KaraTrace; code: string }
type Suite = { traces: (KaraTrace | null)[]; done: boolean; code?: string }

export function KaraWidget() {
  const { instanceId, config } = host().init
  const level = useMemo(() => parseKaraLevel(config.body), [config.body])
  const levelId = level.config.id ?? instanceId
  const editorEl = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const abort = useRef<AbortController | null>(null)
  const [variant, setVariant] = useState(0)
  const [run, setRun] = useState<Run | null>(null)
  const [suite, setSuite] = useState<Suite | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState('')

  useEffect(() => {
    warmPyodideWorker()
    let destroyed = false
    void host().getState<string>(instanceId, CODE_KEY).then(saved => {
      if (destroyed || !editorEl.current) return
      let t: ReturnType<typeof setTimeout> | undefined
      view.current = new EditorView({
        parent: editorEl.current,
        state: EditorState.create({
          doc: saved ?? config.attributes.code ?? '',
          extensions: [
            basicSetup, python(), keymap.of([indentWithTab]), ...karaLineHighlighting(),
            EditorView.updateListener.of(u => {
              if (!u.docChanged) return
              clearTimeout(t)
              t = setTimeout(() => void host().saveState(instanceId, CODE_KEY, u.state.doc.toString()), 500)
            }),
          ],
        }),
      })
    })
    return () => { destroyed = true; view.current?.destroy() }
  }, [instanceId, config.attributes.code])

  const runVariant = async (code: string, v: number, signal: AbortSignal): Promise<KaraTrace | null> => {
    const { result, stopped, timedOut } = await runPython({
      code: KARA_RUNNER,
      textFiles: [
        { name: 'kara.py', content: KARA_MODULE_SOURCE },
        { name: '__kara_student.py', content: code },
        { name: '__kara_world.json', content: JSON.stringify(karaRunInput(level, v)) },
      ],
      signal,
      timeoutMs: TIMEOUT_MS,
      onStderr: text => setErrors(e => e + text),
    })
    if (stopped || timedOut || typeof result !== 'string') return null
    return JSON.parse(result) as KaraTrace
  }

  const start = async (all: boolean) => {
    const code = view.current?.state.doc.toString() ?? ''
    const ctrl = new AbortController()
    abort.current = ctrl
    setBusy(true)
    setErrors('')
    try {
      if (!all) {
        const trace = await runVariant(code, variant, ctrl.signal)
        setSuite(null)
        if (trace) setRun({ variant, trace, code })
        return
      }
      const traces: (KaraTrace | null)[] = level.variants.map(() => null)
      setRun(null)
      setSuite({ traces: [...traces], done: false })
      for (let v = 0; v < traces.length; v++) {
        const trace = await runVariant(code, v, ctrl.signal)
        if (!trace) { setSuite(null); return }
        traces[v] = trace
        setSuite({ traces: [...traces], done: false })
      }
      const stars = traces.map(t => karaStars(t!, level.config))
      const worst = stars.indexOf(Math.min(...stars))
      setSuite({ traces, done: true, code })
      setVariant(worst)
      setRun({ variant: worst, trace: traces[worst]!, code })
      // Raw response always; score is self-reported.
      host().submit({
        response: { code, level: levelId, stars },
        score: { raw: stars[worst], min: 0, max: MAX_STARS, scaled: stars[worst] / MAX_STARS },
      })
    } catch (e) {
      setErrors(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (abort.current === ctrl) abort.current = null
    }
  }

  return (
    <div className="flex flex-col gap-2 p-2 text-foreground">
      <div className="flex gap-2">
        <button className="rounded border px-3 py-1" disabled={busy} onClick={() => void start(false)}>Run</button>
        <button className="rounded border px-3 py-1" disabled={!busy} onClick={() => abort.current?.abort()}>Stop</button>
      </div>
      <div ref={editorEl} className="min-h-40 rounded border" />
      {errors && <pre className="whitespace-pre-wrap text-sm text-red-600">{errors}</pre>}
      <KaraPanel
        world={level.variants[variant] ?? level.variants[0]}
        trace={run?.variant === variant ? run.trace : null}
        code={suite?.code ?? run?.code}
        aftermath={null}
        variant={variant}
        variantCount={level.variants.length}
        onVariant={v => { setVariant(v); setRun(null) }}
        suite={suite}
        busy={busy}
        onTestAll={() => void start(true)}
        config={level.config}
        levelId={levelId}
        // KaraPanel only saves progress when this is set; the host scopes it.
        skriptId="standalone"
        maxTile={40}
        onLine={(t: KaraLineTarget | null) => { if (view.current) showKaraLine(view.current, t) }}
      />
    </div>
  )
}
