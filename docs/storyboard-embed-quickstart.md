# StoryProject Embed Quickstart

This is the fastest way to test the storyboard embed with StoryProject.

## 1) Start dev server
From the repo root:

```
npm run dev
```

If port 5173 is busy, Vite will print another port. Use that port in the URLs below.

## 2) Open the host demo
Example (port 5174):

```
http://localhost:5174/embed-host-demo.html
```

The demo uses the host SDK and already sends `STORY_PROJECT_INIT`.

## 3) Minimal embed URL preset (open integration scope)
- **Phases:** Script + Storyboard only
- **Features:** storyboard generation + script analysis

```
/embed.html?allowedOrigins=https://storyproject.example&phases=script,storyboard&initialPhase=script&features=storyboard-generation,script-analysis
```

Replace `https://storyproject.example` with the host origin.

## 4) Minimal init payload (open integration scope)

```
{
  allowedPhases: ['script', 'storyboard'],
  initialPhase: 'script',
  allowedFeatures: ['storyboard-generation', 'script-analysis']
}
```

## 5) Common issues
- **Blank iframe:** check the `allowedOrigins` matches the host origin exactly.
- **No messages:** ensure `sessionToken` matches the one sent in `STORY_PROJECT_INIT`.
- **No AI buttons:** check `features`/`allowedFeatures` flags.
