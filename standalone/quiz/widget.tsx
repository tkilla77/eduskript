/**
 * SPIKE — stand-alone quiz question: Eduskript's QuestionInner
 * (src/components/markdown/quiz.tsx) on the widget host.
 *
 * Config: attributes = the <question> attributes (type, feedback, attempts,
 * points, expected, …); body = the question's inner HTML as the host rendered
 * it: a <question-prompt> plus <answer correct="…" feedback="…"> elements
 * (optionally with an <answer-feedback> child). Markdown / math rendering is the
 * host's job, so the widget ships no markdown pipeline.
 *
 * Mode: normal → the author's feedback mode (check / instant / none);
 * review → QuestionInner's read-only graded view. browse is treated as normal.
 */

import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { QuestionInner } from '@/components/markdown/quiz'
import type { QuizData } from '@/lib/userdata/types'
import { host } from '../shared/host'

const STATE_KEY = 'answer'
const NUMERIC = new Set(['attempts', 'points', 'minValue', 'maxValue', 'step', 'tolerance', 'window'])
const BOOLEAN = new Set(['ignoreCase', 'ignoreWhitespace'])

/** `min-value` → `minValue`; numbers and booleans coerced like markdown-components does. */
function toProps(attributes: Record<string, string>): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [raw, value] of Object.entries(attributes)) {
    const key = raw.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    props[key] = NUMERIC.has(key) ? Number(value) : BOOLEAN.has(key) ? value === 'true' : value
  }
  return props
}

/**
 * Host HTML → React elements, keeping custom tags (question-prompt, answer,
 * answer-feedback) and their attributes as props, which is the shape
 * QuestionInner reads. Sanitising is the host's job; inside the sandboxed
 * iframe a script in the body could only reach the widget itself.
 */
function htmlToReact(html: string): ReactNode[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const convert = (node: Node, key: number): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent
    if (!(node instanceof Element)) return null
    const props: Record<string, unknown> = { key }
    for (const a of node.attributes) props[a.name === 'class' ? 'className' : a.name] = a.value
    return createElement(node.localName, props, ...[...node.childNodes].map(convert))
  }
  return [...doc.body.childNodes].map(convert).filter(n => !(typeof n === 'string' && !n.trim()))
}

/** Self-reported score of a saved answer, from whichever auto-check applied. */
function scoreOf(data: QuizData, max: number) {
  const raw = data.choiceScore ?? data.textScore ?? data.sliderScore
  return raw === undefined ? undefined : { raw, min: 0, max, scaled: max ? raw / max : 0 }
}

export function QuizWidget() {
  const { instanceId, mode, config } = host().init
  const props = useMemo(() => toProps(config.attributes), [config.attributes])
  const children = useMemo(() => htmlToReact(config.body), [config.body])
  const [data, setData] = useState<QuizData | null | undefined>(undefined)
  const lastSubmitted = useRef<string | null>(null)

  useEffect(() => {
    void host().getState<QuizData>(instanceId, STATE_KEY).then(setData)
  }, [instanceId])

  const updateData = async (next: QuizData) => {
    await host().saveState(instanceId, STATE_KEY, next)
    // QuestionInner autosaves on every change; only answers it counts as
    // submitted are reported, and each distinct answer only once.
    const sig = JSON.stringify(next)
    if (!next.isSubmitted || sig === lastSubmitted.current) return
    lastSubmitted.current = sig
    host().submit({ response: next, score: scoreOf(next, Number(props.points ?? 1)) })
  }

  if (data === undefined) return null
  return (
    <div className="p-2 text-foreground">
      <QuestionInner
        {...props}
        initialData={data}
        updateData={updateData}
        componentId={`quiz-${instanceId}`}
        reviewMode={mode === 'review'}
      >
        {children}
      </QuestionInner>
    </div>
  )
}
