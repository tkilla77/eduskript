/**
 * SPIKE — stand-alone Kara widget: CodeMirror + Run/Stop + KaraPanel.
 *
 * A deliberately small re-assembly of the Kara parts of
 * src/components/public/code-editor/index.tsx (6k lines). Left out: file tabs,
 * toolbox/skript imports, version history, highlights, exam/grading, intro
 * card, voice editor, draggable splitter and stacked/side toggle, aftermath
 * replay, data files.
 *
 * Layout like Eduskript's default: editor left, world right (`code-width`
 * attribute = editor share in %, default 50), stacked when the frame is
 * narrower than 768 px. Editor theme: VS Code light/dark, as in Eduskript, on
 * a white / black background, following the host's theme.
 *
 * Reports to the host: a single Run is an `attempt` (it never earns stars,
 * as in Eduskript); "Test all worlds" is a `submit` with the stars as score.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark'
import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light'
import { basicSetup } from 'codemirror'
import { python } from '@codemirror/lang-python'
import { indentWithTab } from '@codemirror/commands'
import { KaraPanel } from '@/components/public/code-editor/kara-panel'
import { karaLineHighlighting, showKaraLine, type KaraLineTarget } from '@/components/public/code-editor/kara-line-extension'
import { KARA_MODULE_SOURCE, KARA_RUNNER } from '@/lib/kara/kara-module'
import { karaRunInput, karaStars, parseKaraLevel, type KaraTrace } from '@/lib/kara/world'
import { runPython, warmPyodideWorker } from '@/lib/pyodide-worker.client'
import { host, type Theme } from '../shared/host'

const TIMEOUT_MS = 30_000
const CODE_KEY = 'code'
const MAX_STARS = 3
/** Height of the side-by-side row (editor | world); the world panel fills it. */
const ROW_HEIGHT = 440

// VS Code themes as in Eduskript, on plain white / black instead of their own
// editor backgrounds.
const editorTheme = (theme: Theme) => {
  const bg = theme === 'dark' ? '#000000' : '#ffffff'
  return [
    theme === 'dark' ? vsCodeDark : vsCodeLight,
    // Prec.highest: the VS Code themes set their own background otherwise.
    Prec.highest(EditorView.theme({ '&': { backgroundColor: bg, height: '100%' }, '.cm-gutters': { backgroundColor: bg }, '.cm-scroller': { overflow: 'auto' } }, { dark: theme === 'dark' })),
  ]
}

type Run = { variant: number; trace: KaraTrace; code: string }
type Suite = { traces: (KaraTrace | null)[]; done: boolean; code?: string }

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatches(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

export function KaraWidget() {
  const { instanceId, config } = host().init
  const level = useMemo(() => parseKaraLevel(config.body), [config.body])
  const codeWidth = Math.min(80, Math.max(20, Number(config.attributes['code-width']) || 50))
  const themeCompartment = useRef(new Compartment())
  const levelId = level.config.id ?? instanceId
  const editorEl = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const abort = useRef<AbortController | null>(null)
  const [variant, setVariant] = useState(0)
  const [run, setRun] = useState<Run | null>(null)
  const [suite, setSuite] = useState<Suite | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState('')
  // Latest Run for the keymap, which is built once with the editor.
  const runRef = useRef<() => void>(() => {})
  // KaraPanel's fill mode needs a fixed-height parent: only side by side.
  const isWide = useMediaQuery('(min-width: 768px)')

  useEffect(() => {
    warmPyodideWorker()
    let destroyed = false
    void host().getState<string>('instance', CODE_KEY).then(saved => {
      if (destroyed || !editorEl.current) return
      let t: ReturnType<typeof setTimeout> | undefined
      view.current = new EditorView({
        parent: editorEl.current,
        state: EditorState.create({
          doc: saved ?? config.attributes.code ?? '',
          extensions: [
            // Ctrl/Cmd+Enter and Shift+Enter run, as in Eduskript. Prec.highest:
            // basicSetup's keymap binds Mod-Enter (insertBlankLine) otherwise.
            Prec.highest(keymap.of([
              { key: 'Mod-Enter', run: () => { runRef.current(); return true } },
              { key: 'Shift-Enter', run: () => { runRef.current(); return true } },
            ])),
            basicSetup, python(), keymap.of([indentWithTab]), ...karaLineHighlighting(),
            themeCompartment.current.of(editorTheme(host().init.theme)),
            EditorView.updateListener.of(u => {
              if (!u.docChanged) return
              clearTimeout(t)
              t = setTimeout(() => void host().saveState('instance', CODE_KEY, u.state.doc.toString()), 500)
            }),
          ],
        }),
      })
    })
    const offTheme = host().onThemeChanged(t =>
      view.current?.dispatch({ effects: themeCompartment.current.reconfigure(editorTheme(t)) }))
    return () => { destroyed = true; offTheme(); view.current?.destroy() }
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
        if (!trace) return
        setRun({ variant, trace, code })
        host().attempt({
          kind: 'run',
          level: levelId,
          world: variant + 1,
          stars: karaStars(trace, level.config),
          error: trace.error?.message,
          code,
        })
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

  runRef.current = () => { if (!busy) void start(false) }

  return (
    <div className="flex flex-col gap-2 p-2 text-foreground">
      <div className="flex gap-2">
        <button className="rounded border px-3 py-1" disabled={busy} onClick={() => void start(false)} title="Run (Ctrl/Cmd+Enter)">Run</button>
        <button className="rounded border px-3 py-1" disabled={!busy} onClick={() => abort.current?.abort()}>Stop</button>
      </div>
      <div
        className="flex flex-col overflow-hidden rounded border md:flex-row md:[height:var(--row-h)]"
        style={{ '--row-h': `${ROW_HEIGHT}px`, '--code-w': `${codeWidth}%` } as CSSProperties}
      >
        <div ref={editorEl} className="h-56 min-w-0 shrink-0 md:h-full md:w-[var(--code-w)]" />
        <div className="w-full border-t md:hidden" />
        <div className="hidden w-px shrink-0 bg-border md:block" />
        <div className="min-h-0 min-w-0 flex-1">
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
            // KaraPanel only saves progress when this is set. Kara's progress is
            // course-wide, so main.tsx maps it to the host's `group` scope.
            skriptId="group"
            maxTile={40}
            fill={isWide}
            onLine={(t: KaraLineTarget | null) => { if (view.current) showKaraLine(view.current, t) }}
          />
        </div>
      </div>
      {errors && <pre className="whitespace-pre-wrap text-sm text-red-600">{errors}</pre>}
    </div>
  )
}
