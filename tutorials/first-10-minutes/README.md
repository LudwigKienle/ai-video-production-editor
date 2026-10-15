# Tutorial video: Your first 10 minutes

YouTube tutorial (English, about 4 minutes) for new users: install, welcome guide,
connecting a provider, the studio layout, a project folder, the Project Hub with the
Rainline demo script, the seven production steps, the generators, edit and export.

It is produced entirely from scripts, following the TrendCraft tutorial workflow:

1. **Narration first.** One ElevenLabs `eleven_v4` call per scene, with word timestamps.
2. **Screen recording on the narration.** The real Electron app is filmed frame by
   frame (Playwright, virtual 30 fps clock, 1536×864 CSS px at 2.5× = 3840×2160).
   Cursor moves, clicks, typing and scrolling are placed on spoken words.
3. **Edit in Remotion.** App window with camera zooms and highlight boxes (from UI
   rectangles logged during recording), word-by-word captions, chapter labels, and
   motion-graphics scenes for intro, install and outro.
4. **Sound.** Narration normalized per scene, music ducked under the voice, master
   at −16.5 LUFS.

No AI generation is shown and no provider key is used inside the app: the video shows
the interface and the workflow only.

## Layout

| Path | What it does |
| --- | --- |
| `script/scenes.json` | Narration text per scene (source of truth for wording). |
| `script/voiceover.py` | ElevenLabs v4 narration with timestamps, or `--estimate` timings. |
| `script/normalize-voice.sh` | Per-scene loudness to −21 LUFS. |
| `script/master.sh` | Final loudness master. |
| `record/setup.sh` | App deps, Electron main bundle, local Tailwind build. |
| `record/browser.mjs` | Launches Electron (fresh profile, offline-safe asset serving). |
| `record/recorder.mjs` | Frame-by-frame recorder: cursor, clicks, typing, scroll, marks. |
| `record/scenes.mjs` | Directions for the seven screen scenes, keyed to words. |
| `record/record.mjs` | Records scenes → `build/screen/<scene>.mp4` + `.marks.json`. |
| `remotion/` | The edit. `src/direction.ts` holds camera moves and highlights. |
| `build/` | Generated (ignored by git). |

## Producing the video

Requirements: Node 22, ffmpeg, Xvfb, Chromium (`/opt/pw-browsers` in Claude Code cloud
sessions), Python 3, an ElevenLabs API key with access to `eleven_v4`, and network
access to `api.elevenlabs.io`.

```bash
cd tutorials/first-10-minutes
record/setup.sh                                   # once
(cd ../.. && npx vite --port 5173 --strictPort &)  # dev server for Electron

# 1. Narration (never commit or paste the key)
export ELEVENLABS_API_KEY=...
python3 script/voiceover.py --list-voices "narrator"     # pick a voice id
python3 script/voiceover.py --voice <voice_id>
script/normalize-voice.sh

# 2. Screen recording at 4K on the real timings (≈20 min)
xvfb-run -a -s "-screen 0 4000x2400x24" node record/record.mjs
# quick draft of one scene: SCALE=1 QUALITY=80 xvfb-run ... node record/record.mjs s05_folder

# 3. Optional music: build/audio/music.mp3 (≈4 min, ducked automatically)

# 4. Edit
cd remotion && npm install && node scripts/prep.mjs
export REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
node scripts/stills.mjs                            # check stills → build/stills-check
npx remotion render src/index.ts Tutorial ../build/tutorial.mp4 --browser-executable "$REMOTION_BROWSER"
cd .. && script/master.sh build/tutorial.mp4 build/tutorial-master.mp4
```

Changing a sentence: edit `script/scenes.json`, re-run the voice for that scene, then
re-record that scene (`record.mjs <scene>` replays the earlier scenes without filming
them). Motion scenes follow the new timings automatically.

## Recording notes

- **Tailwind.** The studio loads `cdn.tailwindcss.com` at runtime. Recording serves a
  local Tailwind v3 build instead (`record/tailwind.config.cjs`), appended like the CDN
  does, so every take looks the same and works offline.
- **Fresh profile per take.** Electron otherwise restores the previous project and UI.
- **Native dialogs.** The folder picker cannot be filmed; the recorder answers it with
  `/tmp/tutorial-projects/Rainline` (emptied for every take).
- **Dark theme.** Light theme has unreadable white-on-light text in the welcome guide.
- **Timeline workspace.** Opening it scrolls the `overflow: hidden` app frame and pushes
  the toolbar off screen; the recorder resets that scroll after each click.
- After the welcome guide, the studio opens Settings → AI providers when no key exists;
  the narration covers this.

## Status

- Narration text, recording directions, edit and sound scripts: done.
- Draft recording and silent animatic on *estimated* timings: done (`build/`, not
  committed).
- Real ElevenLabs v4 narration, final 4K recording, music, final render: pending.
  The Claude Code cloud environment blocks `api.elevenlabs.io` until it is added under
  *Network access → Allowed domains*.
