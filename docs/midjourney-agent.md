# Midjourney · Jeff (browser agent)

Midjourney has no public API. Jeff drives **midjourney.com** in a persistent, hidden
Electron window with the user's own sign-in, so Concept and Storyboard can use
Midjourney like any other image model — prompt in, four images back, nothing to click.

> Automation is against Midjourney's terms of service. Jeff behaves like a person
> (one job at a time, real waits, a real browser session), but the risk of a ban is
> the user's. Say so in the UI; we do.

## Pieces

| Where | What |
|---|---|
| `electron/midjourney-agent.js` | The agent. Session partition `persist:midjourney`, hidden `BrowserWindow`, job queue, DOM scripts, download to `references/midjourney/<job>_<n>.png` in the project folder. |
| `electron/main.js` | IPC: `midjourney:status / connect / disconnect / toggleWindow / generate`; forwards agent events to renderers as `midjourney:event`. |
| `electron/preload.js` | `window.electron.midjourney.*` |
| `src/services/midjourneyAgentService.ts` | Renderer wrapper. Maps project references → Midjourney parameters and returns `MediaItem[]` (first item carries the 4-grid in `imageVersions`). |
| `src/components/ApiKeyModal.tsx` | Settings → AI providers → "Midjourney · Jeff": Sign in / Sign out / Show window. |
| `src/workspaces/ProjectHubWorkspace.tsx` | Model `midjourney` in `REFERENCE_MODEL_OPTIONS`; branches in `generateReferenceImage` (Concept) and the storyboard renderer. Extra grid images are merged as reference versions via `finalizeReferenceImage.extraVersions`. |

## Two lanes

The page renders job cards as `<a href="/jobs/<uuid>">` with a CSS `background-image`
on the CDN, no `<img>`; `jobIds` / `jobCards` read hrefs and styles. On top of the DOM,
a Chrome DevTools Protocol tap (`attachNetworkTap`) records the page's own `/api/…`
responses and socket frames: the first submit response after Enter carries the job id
(the submit lane is serialized, so attribution is by time), and status updates mark a
job complete before the DOM shows it.

- **Submit lane** (serialized, ≤ 75 s per job): wait for a free slot, upload references,
  type, Enter, learn the job id. Then the next prompt is typed while the first renders.
- **Tracker** (one loop for all running jobs, every 3 s): progress from cards or API,
  completion when the API says so or the card shows the grid, then the four images
  through the page session (a plain fetch gets 403 from the CDN). Per-job limits: 8 min
  render, 4 min without any progress change; every failure takes a screenshot.
- **Parallel jobs**: Settings → Midjourney → parallel jobs (1–6, default 3). Storyboard
  "Generate all" runs that many shots at once; API models get two lanes.
- **Cancel** from the Activity drawer releases the slot and the task (Midjourney itself
  keeps rendering).

## Flow of one job

1. `status()` — load `/imagine`, check for the prompt box and the absence of a login page.
2. Upload references through the page's own uploader (file input, else drag-drop on the prompt form); wait until a `cdn.midjourney.com` url appears; record it.
3. Clear the reference chips and build the text prompt:
   `[image refs…] <prompt> --ar W:H --oref <first character> --sref <style…>`
4. Type it (React-safe value setter + Enter, fallback submit button).
5. Poll the feed every 3 s: a **new job uuid** in `cdn.midjourney.com/<uuid>/…` that was not there before submit; done when four grid images `0_0…0_3` are present and no percentage is shown. Timeout 10 min (relax mode is slow).
6. Download `https://cdn.midjourney.com/<uuid>/0_<n>.png` through the session (cookies), fall back to the `_640_N.webp` preview, persist to the project folder, return data urls.

## Reference mapping

| Phase | Source | Midjourney |
|---|---|---|
| Concept | base image (regenerate) | `--oref` |
| Storyboard | matched **character** refs | first → `--oref`, others → image prompt |
| Storyboard | environment / product refs | image prompt (url before the text) |
| Storyboard | first moodboard image | `--sref` |
| Storyboard | pose map / sketch | image prompt, first |

## Moderation

Midjourney refuses some prompts in the UI (dialog, toast or a job card marked as
blocked). Jeff polls `promptError` while waiting for the new job to appear, closes the
dialog, and rejects with a message prefixed `[moderated]`. The renderer service then
retries the same job label up to three times:

1. the prompt as written;
2. local word swaps (`promptModeration.ts`: blood → dark stains, nude → base-layer
   clothing, a young character never keeps "underwear", …), parameters untouched;
3. a Gemini rewrite when a key exists, otherwise the stronger local pass that drops
   risky sentences and adds `--no blood, gore, nudity`.

The Activity drawer shows the retry on the same task. The images that come back carry
the prompt that finally went through.

## When the page changes

Every selector lives in `PAGE_SCRIPTS` inside `midjourney-agent.js`, each with several
candidates. On failure the agent saves a screenshot to
`~/Library/Application Support/<app>/midjourney/<step>-<time>.png` and puts the path in the
error message. Settings → "Show window" makes the hidden browser visible so you can watch a
job and see where it stalls.

## Not yet

- Fast/relax detection and automatic mode switching.
- Upscales (we take the grid; each image is 1024² for square, proportionally otherwise).
- Concurrency (Midjourney allows three fast jobs; Jeff runs one).
