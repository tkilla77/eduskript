import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Question } from '@/components/markdown/quiz'
import { ExamPageContextProvider } from '@/contexts/exam-page-context'
import type { QuizData } from '@/lib/userdata/types'

// The question persists through useSyncedUserData; the test supplies a stored
// answer directly instead of standing up the IndexedDB provider.
const stored: { data: QuizData | null } = { data: null }
const updateData = vi.fn()
vi.mock('@/lib/userdata', () => ({
  useSyncedUserData: () => ({ data: stored.data, updateData, isLoading: false }),
}))

function renderChoice(extra: Record<string, unknown> = {}, data: QuizData | null = null) {
  stored.data = data
  return render(
    <Question id="q" pageId="page-1" type="single" {...extra}>
      <answer feedback="21 = 3 · 7">21</answer>
      <answer correct="true">23</answer>
      <answer feedback="25 = 5 · 5">25</answer>
    </Question>
  )
}

const pick = (label: string) => fireEvent.click(screen.getByText(label))
const checkButton = () => screen.queryByRole('button', { name: /check answer|check again/i })
const lastSaved = (): QuizData => updateData.mock.calls.at(-1)![0] as QuizData

beforeEach(() => {
  updateData.mockClear()
})

describe('check mode (non-exam default)', () => {
  it('renders a Check button and reveals nothing before it is pressed', () => {
    renderChoice()
    pick('21')
    expect(checkButton()).toBeInTheDocument()
    expect(screen.queryByText('21 = 3 · 7')).not.toBeInTheDocument()
  })

  it('disables the button until an answer exists', () => {
    renderChoice()
    expect(checkButton()).toBeDisabled()
    pick('21')
    expect(checkButton()).toBeEnabled()
  })

  it('locks after one wrong check and reveals the key', () => {
    renderChoice()
    pick('21')
    act(() => { fireEvent.click(checkButton()!) })
    expect(screen.getByText('21 = 3 · 7')).toBeInTheDocument()
    expect(checkButton()).not.toBeInTheDocument()
    expect(lastSaved()).toMatchObject({ attempts: 1, checked: true, selected: [0], choiceScore: 0 })
    // Locked: clicking another option changes nothing.
    pick('23')
    expect(lastSaved().selected).toEqual([0])
  })

  it('with attempts="3": a wrong check marks only the pick and allows another try', () => {
    const { container } = renderChoice({ attempts: 3 })
    pick('21')
    act(() => { fireEvent.click(checkButton()!) })
    expect(screen.getByText('21 = 3 · 7')).toBeInTheDocument()
    expect(screen.getByText(/2 attempts left/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again (2 of 3)' })).toBeInTheDocument()
    // The correct answer is NOT revealed by a partial result.
    const correctCard = screen.getByText('23').closest('div[class*="border"]')!
    expect(correctCard.className).not.toMatch(/border-green/)
    expect(lastSaved()).toMatchObject({ attempts: 1, checked: false })
    // Changing the answer clears the partial marks.
    pick('25')
    expect(screen.queryByText('21 = 3 · 7')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.border-red-600').length).toBe(0)
  })

  it('a correct check finishes the question regardless of attempts left', () => {
    renderChoice({ attempts: 'unlimited' as unknown as number })
    pick('23')
    act(() => { fireEvent.click(checkButton()!) })
    expect(checkButton()).not.toBeInTheDocument()
    expect(lastSaved()).toMatchObject({ attempts: 1, checked: true, choiceScore: 1 })
  })

  it('a Check right after a change is not overwritten by the pending autosave', () => {
    vi.useFakeTimers()
    try {
      renderChoice({ attempts: 3 })
      pick('21')
      // Within the 400 ms autosave debounce of the pick.
      act(() => { fireEvent.click(checkButton()!) })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(lastSaved()).toMatchObject({ attempts: 1, checked: false, selected: [0] })
      pick('23')
      act(() => { fireEvent.click(checkButton()!) })
      act(() => { vi.advanceTimersByTime(1000) })
      expect(lastSaved()).toMatchObject({ attempts: 2, checked: true, selected: [1] })
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores a finished question as locked', () => {
    renderChoice({}, { isSubmitted: true, selected: [0], attempts: 1, checked: true })
    expect(checkButton()).not.toBeInTheDocument()
    expect(screen.getByText('21 = 3 · 7')).toBeInTheDocument()
  })
})

describe('other feedback modes', () => {
  it('feedback="instant" reveals on selection without a button', () => {
    renderChoice({ feedback: 'instant' }, { isSubmitted: true, selected: [0] })
    expect(checkButton()).not.toBeInTheDocument()
    expect(screen.getByText('21 = 3 · 7')).toBeInTheDocument()
  })

  it('showFeedback="true" still means instant', () => {
    renderChoice({ showFeedback: true }, { isSubmitted: true, selected: [0] })
    expect(checkButton()).not.toBeInTheDocument()
    expect(screen.getByText('21 = 3 · 7')).toBeInTheDocument()
  })

  it('feedback="none" shows neither button nor correctness', () => {
    renderChoice({ feedback: 'none' }, { isSubmitted: true, selected: [0] })
    expect(checkButton()).not.toBeInTheDocument()
    expect(screen.queryByText('21 = 3 · 7')).not.toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('exam pages ignore the attribute: no button, nothing revealed', () => {
    stored.data = { isSubmitted: true, selected: [0] }
    render(
      <ExamPageContextProvider>
        <Question id="q" pageId="page-1" type="single" feedback="check" attempts={3}>
          <answer feedback="21 = 3 · 7">21</answer>
          <answer correct="true">23</answer>
        </Question>
      </ExamPageContextProvider>
    )
    expect(checkButton()).not.toBeInTheDocument()
    expect(screen.queryByText('21 = 3 · 7')).not.toBeInTheDocument()
  })
})

describe('check mode on sliders', () => {
  function renderSlider(extra: Record<string, unknown> = {}) {
    stored.data = null
    return render(
      <Question id="s" pageId="page-1" type="number" minValue={-2} maxValue={2} step={0.1} expected="-1" tolerance={0.15} {...extra}>
        <answer from="1" feedback="Spot on"></answer>
        <answer feedback="Not yet"></answer>
      </Question>
    )
  }

  it('stays silent until Check, then shows the band and locks', () => {
    renderSlider()
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '1.5' } })
    expect(screen.queryByText('Not yet')).not.toBeInTheDocument()
    act(() => { fireEvent.click(checkButton()!) })
    expect(screen.getByText('Not yet')).toBeInTheDocument()
    expect(screen.getByText('Incorrect')).toBeInTheDocument()
    expect(slider).toBeDisabled()
    expect(lastSaved()).toMatchObject({ attempts: 1, checked: true, numberAnswer: 1.5 })
  })

  it('reveals the target after the last failed attempt, not before', () => {
    renderSlider({ attempts: 2 })
    const slider = screen.getByRole('slider')
    fireEvent.change(slider, { target: { value: '1.5' } })
    act(() => { fireEvent.click(checkButton()!) })
    expect(screen.queryByText(/Correct answer:/)).not.toBeInTheDocument()
    fireEvent.change(slider, { target: { value: '1.2' } })
    act(() => { fireEvent.click(checkButton()!) })
    expect(screen.getByText(/Correct answer:/)).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
  })

  it('shows the current value beneath the track', () => {
    renderSlider()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.5' } })
    expect(screen.getByText('Your answer: 0.5')).toBeInTheDocument()
  })

  it('a correct slider check finishes with the top band', () => {
    renderSlider({ attempts: 3 })
    fireEvent.change(screen.getByRole('slider'), { target: { value: '-1' } })
    act(() => { fireEvent.click(checkButton()!) })
    expect(screen.getByText('Spot on')).toBeInTheDocument()
    expect(checkButton()).not.toBeInTheDocument()
  })
})
