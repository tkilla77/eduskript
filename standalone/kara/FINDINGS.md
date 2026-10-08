# Spike: stand-alone Kara — findings

Branch `spike/kara-standalone`. Goal: run Kara outside the Eduskript app as
static files behind a host interface, and record every dependency on the app.

**Result:** it works. A 25-module slice of `src/` builds with Vite into a
static page. It runs, replays and scores a level both directly and inside
`<iframe sandbox="allow-scripts">`, and Stop kills a run in ~30 ms there.

The spike first ran without touching `src/`, by swapping `@/lib/userdata` for
a shim. It now sits on top of the PR 1 candidate (`feat/kara-host-interface`,
`src/lib/kara/host.ts`): `main.tsx` installs a `KaraHost` with `setKaraHost`,
and the only alias left replaces the in-page adapter (`host-inpage.ts`) with a
stub so that `userDataService` is not bundled.

## Run it

```bash
pnpm exec vite build   --config standalone/kara/vite.config.ts
pnpm exec vite preview --config standalone/kara/vite.config.ts --port 4317
# http://localhost:4317/index.html   (?id=<instance> to separate saved state)
```

| File | Role |
|---|---|
| `host.ts` | `WidgetHost` interface v0.1 draft + no-host adapter (localStorage, memory fallback) |
| `shims/host-inpage.ts` | Replaces Eduskript's in-page `KaraHost` adapter with a stub (keeps the app out of the bundle) |
| `widget.tsx` | CodeMirror + Run/Stop + `KaraPanel`, ~150 lines, re-assembled from `code-editor/index.tsx` |
| `main.tsx`, `index.html` | Reads the level from the page (stand-in for `init.config.body`), installs the hosts (`setKaraHost`), mounts. `?tiles=<url>` sets a tileset URL |
| `vite.config.ts` | `@` alias to `src/`, host-inpage stub, CORS header on preview |

Left out of the spike: file tabs, toolbox / skript-wide imports, version
history, highlights, exam/grading, intro card, teacher voice editor, aftermath
replay, `@file.json` data files, resizable layout.

## Licence

- Repository: **AGPL-3.0**. A stand-alone build served to other hosts is a
  distribution of AGPL code; linking the source repo from the widget satisfies
  that. DokuWiki (GPL-2.0) embedding via iframe is not linking, so no conflict.
- Kara tileset (gameart2d) is licensed and **not redistributable**. Not in the
  repo; `kara-tiles.ts` falls back to labelled placeholders when
  `NEXT_PUBLIC_KARA_TILESET_URL` is unset (as in the spike). A public widget
  build needs either its own tiles or a host-supplied tileset URL.
- Built-in art in `public/kara/` (portraits, MOP-7 sprites, evidence,
  obstacles, sfx): `portraits.ts` calls the portraits "own Blender renders";
  licence of the rest is not stated. **Ask the maintainer.**

## Dependency map

Bundle contents (from the source map): `src/lib/kara/*` (minus server files),
`kara-panel`, `kara-callstack`, `kara-vars`, `kara-portrait`,
`kara-line-extension`, `celebrations`, `python-check-runner`,
`pyodide-worker.client`, `sound`, `utils`. Third-party: React, CodeMirror,
lucide-react, clsx, tailwind-merge. Output: 862 kB JS (283 kB gzip), 212 kB CSS.

### Clean (no app coupling)

`world.ts`, `generate.ts`, `kara-module.ts` (the Python `kara` module +
runner), `kara-tiles.ts`, `aurora-defaults.ts`, `voice-directions.ts`,
`voice-fx.ts`, `portraits.ts`, and the panel components listed above.

### Touch points

| Concern | Where | Stand-alone status |
|---|---|---|
| **Storage** | `kara/progress.ts` → `userDataService.get/save/subscribe` (key `kara-progress`, scope = skriptId). Editor code via `useSyncedUserData` in `index.tsx`. | PR 1: `KaraHost.getState/saveState/onStateChanged`. Editor code storage is not behind it. |
| **Voice (TTS)** | `kara/voice.ts` → `POST /api/kara/tts` (relative URL). Server renders via OpenRouter, caches in S3 (`voice-tts.server.ts`). | PR 1: optional `KaraHost.voiceLineUrl`. The spike host has none → no voices. |
| **Absolute asset paths** | `/kara/...` in `voice.ts`, `kara-tiles.ts` (×2), `portraits.ts`, `kara-panel.tsx` | PR 1: `KaraHost.assetUrl`; the spike resolves them relative to the page. |
| **Tileset URL** | `NEXT_PUBLIC_KARA_TILESET_URL`, build-time | PR 1: `KaraHost.tilesetUrl()`, read at load time. |
| **Skript file → URL resolution** | `markdown-components.tsx` resolves audio, music, portraits, `@file.json` against skript files into `karaAssets` | Host's job. Maps to an `assets: {name: url}` field in `init.config`. |
| **Skript-wide shared state** | progress (stars, evidence) per skript; `<evidence-board>` and `<kara-archive>` read it on other pages; toolbox `befehle.py` lives in the skript's python-imports record | Spike uses one fixed scope. See interface notes below. |
| **Mute** | `lib/sound.ts`, localStorage + page toolbar button | Works; no mute button stand-alone. |
| **Styling** | Tailwind classes + theme tokens from `src/app/globals.css` (2834 lines); dark mode via `.dark` class | Spike imports all of `globals.css`. A real build should extract the tokens Kara uses. |
| **Auth / session** | None on the student path. Only `KaraIntro` (`usePageCanEdit`) and the teacher voice editor (`/api/pages/[id]/replace`, `/api/kara/voice-take`, `/api/kara/voice-pick`). | Authoring stays in Eduskript. |
| **i18n** | None. UI strings English; story text (e.g. `AFTERMATH_TEXT`, AURORA defaults) hard-coded German. | Fine for now. |
| **Orchestration** | Kara run/suite/variant logic (`runKaraCode` etc.) sits inside `code-editor/index.tsx` (6162 lines) | Re-written in `widget.tsx`. PR 1 candidate: extract into a hook both use. |

## Python runtime and Stop

- `src/lib/pyodide-worker.client.ts`: Pyodide v0.29.0 from jsDelivr via
  `importScripts` inside a **blob-URL worker**; one shared worker per page.
  Plain/turtle code may run on Skulpt instead (`/js/skulpt*.js`, main thread).
- Stop is **always `worker.terminate()`**. No SharedArrayBuffer / interrupt
  buffer, no `crossOriginIsolated` check. Cost: ~3 s cold start on the next
  run. Kara additionally caps runs at `MAX_STEPS` in the Python module, so an
  endless loop ends by itself.
- Measured in a sandboxed iframe, not cross-origin isolated: Stop → Run
  re-enabled in 31 ms. **Hosts need no special headers.** Using
  `pyodide.setInterruptBuffer` when `crossOriginIsolated` is an optional later
  improvement (keeps Pyodide warm), not a requirement.

## AI feedback

Not wired into the code editor. `<ai-feedback>` (`components/markdown/ai-feedback.tsx`)
is a separate markdown component for handwritten/photographed work; it posts
images to `/api/ai/feedback`, and the server derives prompt and reference
solution from page content. Python checks run locally (`python-check-runner.ts`).
So the cut is clean: AI is already host-side. The only AI on the Kara path is
server-side TTS for voice lines.

## Sandboxed iframe: what we learned

1. **CORS is required.** A sandbox without `allow-same-origin` has origin
   `null`; module scripts and Vite's `crossorigin` CSS are CORS requests. The
   server hosting widget files must send `Access-Control-Allow-Origin: *`.
   Without it the page stays blank.
2. **No persistent storage.** `localStorage` throws under opaque origin; the
   no-host adapter falls back to memory, so state is lost on reload. For
   DokuWiki this means "browser storage only" does **not** work in the
   recommended sandbox. Options: the DokuWiki plugin stores state for the
   iframe via postMessage (a tiny host, no server needed), or widgets are
   served from a separate origin and embedded with `allow-same-origin`.
3. Blob-URL workers, jsDelivr `importScripts`, canvas, Web Audio: all work.

## Runtime sharing: many editors on one page

Each sandboxed iframe boots its own Pyodide: ~30–50 MB WASM heap and ~2–3 s
CPU each, so a dozen editors ≈ 0.5 GB. Opaque-origin frames also cannot share
a SharedWorker or storage, and the HTTP cache likely does not help either
(browsers partitioning the cache probably give opaque-origin frames a transient
key, i.e. a ~10 MB Pyodide download per frame per visit). **Not measured yet**;
count the jsDelivr requests with two frames to confirm.

Options, cheapest first:

1. **Boot Pyodide on first Run, not on idle.** The editor warms Pyodide when
   idle today (`code-editor/index.tsx`, `deferUntilIdle` → `preloadPyodide`). In
   iframe mode that should wait for Run, so cost scales with editors actually
   used. Worth doing regardless.
2. **Host-provided runtime (capability `python`).** One Pyodide for the page;
   widgets send `run(code, files)` and get output/trace back; widgets fall back
   to their own Pyodide when the host does not offer it. Must **not** run in a
   worker created by the host page: a worker has its creator's origin, so student
   code sent by an untrusted widget could call host APIs with the user's cookies.
   Instead: one hidden runtime iframe on its own origin (e.g.
   `run.<widget-domain>`, not opaque, so its cache persists). It owns a dedicated
   worker, so Stop stays `terminate()`. A shared interpreter is what Eduskript
   already does (one worker per page; `runChecks` serialised because checks share
   globals, `pyodide-worker.client.ts`), with the same limits. The DokuWiki plugin
   needs host JS anyway (postMessage storage), so this fits there.
3. **Widget origin + `allow-same-origin`.** Widgets from a separate origin share
   HTTP cache, storage and potentially a SharedWorker running Pyodide, while staying
   isolated from the host. Drawbacks: a SharedWorker cannot be `terminate()`d from
   outside (needs a nested dedicated worker — browser support to check — or an
   interrupt buffer, which needs cross-origin isolation), and all widgets on that
   origin can read each other's state. Not recommended.
4. **In-page web component for trusted widgets** (the bottom-editor approach;
   the brief already allows trusted in-page widgets). Kara and the Python editor
   share one worker in the page on any host; only untrusted widgets go in iframes.

Recommendation: 1 now; 4 for first-party widgets; 2 as the long-term route for
untrusted widgets.

## Implications for the interface (v0.1 sketch)

- **State scopes.** Kara needs more than per-instance state: progress is
  shared across all levels of a course and read by other widgets
  (evidence board, archive). Proposal: `getState(scope, key)` with
  scope ∈ `instance` | `group`, where the host defines what a group is
  (Eduskript: skript; DokuWiki: namespace).
- **Assets.** `init.config` needs an `assets: {name: url}` map plus a base
  URL for the widget's own files.
- **Submit / regrade.** Stars are computed client-side, but the `kara` module
  is deterministic Python: a host can regrade by re-running the submitted code
  against the level. The spike submits `{code, level, stars}` + score
  (raw/min/max/scaled) when "Test all worlds" finishes.
- **Voice** as an optional host capability, not a widget concern.

## PR 1 candidate (no behaviour change)

Branch `feat/kara-host-interface`, one commit on `main`, not yet proposed:

1. Done: `kara/progress.ts` and `kara/voice.ts` take storage / voice lines from
   `karaHost()` (`src/lib/kara/host.ts`) instead of importing `userDataService`
   / fetching `/api/kara/tts`; the in-page adapter (`host-inpage.ts`) is the
   default, so Eduskript needs no setup call.
2. Done: built-in asset paths and the tileset URL go through the host.
3. Not done, better as its own PR: extract the Kara run logic from
   `code-editor/index.tsx` into a hook (`useKaraRun`) shared with the
   stand-alone widget.

## Open questions for the maintainer

- Licence of the built-in Kara art in `public/kara/`.
- Is a second build target (`standalone/`) acceptable long-term, and who owns it?
- Should skript-wide progress/evidence be part of the public interface, or
  stay Eduskript-only?
