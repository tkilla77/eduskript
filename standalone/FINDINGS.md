# Spike: stand-alone Eduskript widgets — findings

Branches: `spike/kara-standalone` (Kara only), `spike/widget-host` (Kara +
quiz on a shared host). Goal: run Eduskript widgets outside the app as static
files behind a host interface, and record every dependency on the app. The quiz
part is [below](#quiz-question); everything up to it is about Kara.

**Kara result:** it works. A 25-module slice of `src/` builds with Vite into a
static page. It runs, replays and scores a level both directly and inside
`<iframe sandbox="allow-scripts">`, and Stop kills a run in ~30 ms there.

The spike first ran without touching `src/`, by swapping `@/lib/userdata` for
a shim. It now sits on top of the PR 1 candidate (`feat/kara-host-interface`,
`src/lib/kara/host.ts`): `main.tsx` installs a `KaraHost` with `setKaraHost`,
and the only alias left replaces the in-page adapter (`host-inpage.ts`) with a
stub so that `userDataService` is not bundled.

## Run it

```bash
pnpm exec vite build   --config standalone/vite.config.ts
pnpm exec vite preview --config standalone/vite.config.ts --port 4317
# http://localhost:4317/demo/index.html   host page: both widgets via embed.js
# http://localhost:4317/kara/index.html    a widget opened directly (built-in demo config)
# http://localhost:4317/quiz/index.html    ?id=<instance>, ?mode=review
```

| File | Role |
|---|---|
| `shared/host.ts` | `WidgetHost` interface v0.1 draft; no-host adapter (localStorage, memory fallback) and postMessage adapter |
| `shared/protocol.ts` | The `learning-widget/0.1` messages between widget and host |
| `shared/boot.ts` | Picks the transport: `#config=` fragment → no host; inside a frame → postMessage; else the widget page's own demo config |
| `embed/embed.js` | Reference host: `<learning-widget>` element → sandboxed iframe, init, state in the host page's localStorage, resize, `widget-submit` event. Plain JS, copied unchanged into `dist/` |
| `demo/index.html` | Plain HTML host page: two Kara levels in one group, two quiz questions, submit log |
| `shims/host-inpage.ts` | Replaces Eduskript's in-page `KaraHost` adapter with a stub (keeps the app out of the bundle) |
| `kara/widget.tsx` | CodeMirror + Run/Stop + `KaraPanel`, ~150 lines, re-assembled from `code-editor/index.tsx` |
| `kara/main.tsx` | Installs the hosts (`setKaraHost` on top of the widget host). `?tiles=<url>` sets a tileset URL |
| `quiz/widget.tsx` | Eduskript's `QuestionInner` on the widget host: state, mode, submit |
| `vite.config.ts` | One build, one page per widget; `@` alias to `src/`, host-inpage stub, CORS header on preview |

Left out of the Kara spike: file tabs, toolbox / skript-wide imports, version
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

## Quiz question

`quiz/` runs Eduskript's `QuestionInner` (`src/components/markdown/quiz.tsx`,
now exported) unchanged on the widget host. Tested in Chromium, directly and in
the sandboxed iframe: multiple choice in `check` mode with 2 attempts. Partial
marks after a wrong check, the answer key after the final check, score 2/2,
state saved and restored, `?mode=review` gives the read-only graded view.

### How it is wired

- **Content: host-rendered HTML.** In Eduskript the question gets its
  content as rendered React children: `<question-prompt>`,
  `<answer correct="…" feedback="…">`, `<answer-feedback>` (markdown and
  KaTeX already applied). The widget takes the same thing as an HTML fragment
  in `init.config.body` and turns it into React elements (~15 lines,
  `htmlToReact`). So the widget ships **no markdown pipeline**; rendering
  markdown/math is the host's job (DokuWiki: the plugin renders the inner
  wiki text). This generalises: `body` is HTML whenever the widget shows
  author text.
- **Attributes** (`type`, `feedback`, `attempts`, `points`, `expected`, …) go
  in `init.config.attributes` as strings; the widget coerces them, like
  `markdown-components.tsx` does.
- **State:** one record per instance (`saveState(instanceId, 'answer')`). No
  course scope needed, unlike Kara.
- `QuestionInner` already takes `initialData` / `updateData` as props, so no
  change to the component was needed beyond exporting it.

### Coupling

Importing `quiz.tsx` pulls in ~30 app modules, because the file also holds the
`Question` router, `SyncedQuestion`, `SurveyQuestion` and the progress bar:
the userdata sync engine (Dexie), next-auth (`survey-provider`), realtime
events, teacher class / exam / review / stage contexts, Radix dialog, scoring
helpers. They load and stay idle (no errors, the contexts default to "off"),
but the quiz bundle is 216 kB for a question. `QuestionInner` itself only reads
three contexts: exam page, stage lock, grading review.

**PR candidate:** move `QuestionInner` and its pure helpers (option
extraction, scoring) into `question-core.tsx`, with exam page / stage lock /
review passed in as props or read from a small host context.
`quiz.tsx` keeps the Eduskript wrappers.

### Modes, feedback and grading

- Eduskript has two layers: the **author's** feedback mode (`check`, `instant`,
  `none`) and the **page's** situation (review/grade view; exam page forces
  silent autosave; surveys force `none`). Only the second belongs to the host.
  It maps to the brief's modes plus one flag: `review` = `reviewMode`;
  `normal` = the author's mode; **exam** is "normal, but never reveal
  feedback", which is a host policy, not a launch mode. Proposal:
  `init.mode` ∈ normal | browse | review, plus `init.policy.feedback: false`.
- **The answer key is in the browser.** `QuestionInner` scores client-side
  from the `correct` attributes, so wherever this component scores, the key is
  readable in devtools (also in Eduskript today; on exam pages the feedback is
  hidden, the key is still in the client props). The spec needs two grading
  styles: **client-scored** (key in config, score self-reported; fine for
  practice) and **host-scored** (no key sent; the widget submits the raw
  response and the host returns feedback via the `feedback` message).
- **saveState vs submit.** The question autosaves every change. In the spike,
  each distinct answer marked `isSubmitted` is also `submit`ted: 4 submits for
  a 2-check flow. Better: Check press = `attempt`, final check (or hand-in) =
  `submit`. That needs `QuestionInner` to expose an `onCheck` callback.
- Teacher progress bar, survey aggregation, exam answer history: need data
  across students, so they stay host features; a host can build them from the
  submit stream.

### Bug found in Eduskript (not caused by the spike)

`check` mode: a Check press **within 400 ms of the last answer change** is
overwritten by the pending autosave. The debounced autosave timer
(`quiz.tsx`, effect on `[selected, textAnswer, …]`) still holds a closure from
before the check, so it saves `attempts`/`checked` from before the Check
press. After a reload the question is unlocked again with the old attempt
count: fast clickers get unlimited attempts, and a teacher sees
`checked: false`. Reproduced in the spike (Check 0 ms after the click → stored
`attempts: 0, checked: false`; 600 ms → `attempts: 1, checked: true`).
Fixed on `fix/quiz-check-autosave-race` (off `main`, with a regression test):
`handleCheck` cancels the pending autosave. Merged into `spike/widget-host`.

## Embedding: configure at the inclusion site

The widget pages are generic; the embedding page configures each use:

```html
<script type="module" src="embed.js"></script>
<learning-widget src="https://widgets.example/kara/" id="level-1" group="week-1">
  <script type="text/plain">…level…</script>
</learning-widget>
<learning-widget src="https://widgets.example/quiz/" type="single" attempts="2">
  <template><question-prompt>…</question-prompt><answer correct="true">…</answer></template>
</learning-widget>
```

`embed.js` (≈240 lines, plain JS) replaces each element with
`<iframe sandbox="allow-scripts">`, answers the widget's `ready` with `init`
(attributes, body, instance id, mode, theme), stores state in the **host
page's** localStorage (this fixes "no persistence inside the sandbox"), sizes
the iframe from `resize`, and raises `widget-submit` on the element. Without a
host script, `<iframe src=".../quiz/#config=<base64url JSON>">` works too, with
no persistence.

State keys: `lw:<widget URL>|instance:<page path>#<id>|<key>` and
`lw:<widget URL>|group:<group>|<key>`. Widgets only say `instance` or `group`;
the host decides what a group is (Eduskript: the skript; embed.js: the `group`
attribute, default the page path).

Tested cross-origin in Chromium (host page on one port, widgets on another):
all four embeds configured from the host page; iframes sized to content; Kara
level solved (3★ stored once for the group); quiz checked; three
`widget-submit` events with responses and scores; quiz locked and Kara code
restored after reload; `#config=` fallback renders; a forged message from a
window that is not a widget frame is ignored.

Found on the way: the widget must measure its React root, not `body` — the
app stylesheet makes `body` fill the viewport, so body-based heights only
ever reported the iframe's own height.

### Trust model

The iframes isolate the host from the widgets, but `embed.js` itself runs
with the host page's rights. So it is **host code**: vendored or pinned with
an integrity hash, small enough to read in full, no imports, no shared code
with the widgets. It never evaluates or inserts anything a widget sends; its
only effects are namespaced, size-capped storage writes, a clamped iframe
height and the submit event; it only handles messages whose sender is one of
its own frames (origin is "null" for all of them). The protocol is the
contract; `embed.js` is a reference implementation (DokuWiki and Eduskript
can have their own).

What the sandbox cannot stop: anything handed to a widget (config, its saved
state) can be sent anywhere by the widget, since a sandboxed frame may still
make network requests. Treat it as disclosed to the widget provider and pass
nothing personal (pseudonymous instance ids only). The iframe `csp` attribute
could restrict a widget's network access but is Chromium-only. Widget
versions should be pinned by URL so students get what the teacher tested.

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
- **Body is host-rendered HTML** for widgets that show author text (quiz);
  plain text for widgets with their own format (Kara levels).
- **Feedback policy** (`init.policy.feedback`) next to `mode`, for exams.
- **Two grading styles:** client-scored (key in config) and host-scored (no
  key; `feedback` message back). See the quiz section.
- **attempt vs submit** need distinct meanings for autosaving widgets.
- **Generic host.** `KaraHost` (PR 1) is Kara-specific. The quiz shows the
  shape of the generic one: state with scopes, mode/policy, submit/attempt,
  assets; Kara's voice lines become an optional capability on top.

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
- Quiz: OK to split `QuestionInner` into its own module? And the check-mode
  autosave race above.
- Where should grading live for exams: is a host-scored path (no key in the
  browser) wanted?

## Upstream issues found while deploying the demo

Not caused by the spike; each is a small separate fix.

- **`scripts/seed-demo.mjs` fails on a fresh database.** It creates a
  Collection with `slug` and without a Site (both changed: a Collection belongs
  to a Site, no slug, no author table) and upserts `PageLayout` by `userId`
  (it is keyed by `siteId`). The demo teacher and its site get created, the
  content does not; the entrypoint tolerates the failure, so it goes unnoticed.
- **A fresh install answers 404 everywhere on any host but eduskript.org.**
  `src/proxy.ts` sends unknown hosts to the default org `eduskript`, which only
  `scripts/seed-org.js` creates, and that is not in the start sequence. The
  404 pages are then cached by Next.js until the container is recreated.
- **`docker-compose.local.yml` publishes Postgres on all interfaces** with the
  password `password`. Docker's port publishing bypasses host firewalls
  (iptables DNAT + its own FORWARD chain). A dev database started that way on
  the demo server was being brute-forced within a day and had a look-alike
  superuser `postgres ` (trailing space) added. Default should be
  `127.0.0.1:${POSTGRES_PORT:-5432}:5432`.
- **The DB connection forces SSL for any non-localhost host**
  (`src/lib/prisma.ts`, seeds: `ssl: isLocal ? false : {…}`). A Postgres on a
  Docker network without TLS needs `?sslmode=disable` in `DATABASE_URL`
  (node-postgres lets the connection string override the option).
