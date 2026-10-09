/**
 * SPIKE — replaces `@/lib/kara/host-inpage` in the stand-alone build (vite
 * alias), so userDataService and the rest of the app are not bundled.
 * main.tsx installs the real host with setKaraHost before rendering.
 */

import type { KaraHost } from '@/lib/kara/host'

const missing = () => { throw new Error('Kara host not installed (setKaraHost)') }

export const inPageKaraHost: KaraHost = {
  getState: missing,
  saveState: missing,
  onStateChanged: missing,
  assetUrl: missing,
  tilesetUrl: missing,
}
