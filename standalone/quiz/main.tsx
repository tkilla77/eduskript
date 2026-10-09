/** SPIKE — entry point of the stand-alone quiz question (see widget.tsx). */

import { createRoot } from 'react-dom/client'
import { bootHost } from '../shared/boot'
import { QuizWidget } from './widget'
import '../shared/styles.css'

void bootHost('demo-quiz').then(() => {
  createRoot(document.getElementById('root')!).render(<QuizWidget />)
})
