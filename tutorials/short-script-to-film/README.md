# Short: "This shot was one line of text."

A 30-second vertical short (1080×1920, 30 fps) for TikTok, Reels and YouTube Shorts.
Text and music only, so it works muted.

| Time | Beat |
| --- | --- |
| 0–1.3 s | Hook: the strongest shot full-bleed, "This shot was one line of text." The frame tears as it rewinds. |
| 1.3–3 s | "Literally this ↓": the real prompt typed onto a screenplay page (`EXT. SALT FLAT - DAWN …`). |
| 3 s | Music drop and impact: back into the film, "Script in. Film out." |
| 4.6–13.6 s | Montage, one shot per beat, each tagged with a genre. "Every genre." / "From a script." |
| 13.6–23.3 s | The app: script, look, 3D blocking, shot generation, export for TikTok & Reels. |
| 23.3–25.3 s | "Free. Open source. Your keys. Your machine." |
| 25.3–30 s | End card with "Link in bio", then a fade into the first frame so the loop is seamless. |

The montage says where the shots come from ("Shots generated with Seedance, Dreamina &
OpenArt"). They were made with those tools from screenplay prompts, not inside the app, so
the short does not claim otherwise.

## Producing it

```bash
cd tutorials/short-script-to-film/remotion
npm install
node scripts/prep.mjs          # cuts clips, stills and sounds into ../build
npx remotion render src/index.ts Short ../build/short.mp4
# master to -14 LUFS / -1.5 dBTP for social platforms
ffmpeg -i ../build/short.mp4 -c:v copy -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 256k -movflags +faststart ../build/short-final.mp4
```

`scripts/media.json` lists every source with its in-point, length and licence. The media
come from the local asset library (`~/Projekte/04_Bibliothek`) and are not committed.

## Sources and licences

- **Shots:** Seedance 2.0/2.5, Dreamina and OpenArt generations from the library (own work,
  the generating services' subscription terms apply). Clips with UFA branding were left out.
- **Music:** "Carrera Teaser Soundtrack" (Mixkit Stock Music Free License), cut in at 17 s so
  its drop lands on the reveal.
- **Sound effects:** Mixkit Sound Effects Free License (impact, deep whoosh) and ElevenLabs
  SFX made under the Magnific Business plan (typing, UI swoosh, logo sting).
- **App screens:** `docs/assets/screenshots`, plus the Render Setup frame from the published tutorial (`frames` in `media.json`).
