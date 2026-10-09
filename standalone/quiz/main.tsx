/** SPIKE — entry point of the stand-alone quiz question (see widget.tsx). */

import { createRoot } from 'react-dom/client'
import { bootNoHost } from '../shared/boot'
import { QuizWidget } from './widget'
import '../shared/styles.css'

bootNoHost('demo-quiz')
createRoot(document.getElementById('root')!).render(<QuizWidget />)
