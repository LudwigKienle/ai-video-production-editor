# Story Project Embed (iFrame)

This guide documents the iFrame/embed integration for the Story Project page. It uses `postMessage` to exchange state and events with the host (e.g. StoryProject).

## Build outputs
- `embed.html` (entry) renders the embed page.
- `dist/embed.html` is created on build.

## Security: allowlisted origins + session token
Pass the host origin in the iframe URL so the embed only accepts messages from that origin:

```
/embed.html?allowedOrigins=https://storyproject.example
```

You can also pass multiple origins (comma separated):

```
/embed.html?allowedOrigins=https://storyproject.example,https://staging.storyproject.example
```

For local dev you can use `*`, but avoid this in production:

```
/embed.html?allowedOrigins=*
```

Once the first valid host message arrives, the embed will lock to that origin for the remainder of the session.

For extra security, include a session token in the embed URL and in the init payload:

```
/embed.html?allowedOrigins=https://storyproject.example&sessionToken=YOUR_RANDOM_TOKEN
```

The embed will ignore all messages without the matching token, and will ignore non-init messages until it receives a `STORY_PROJECT_INIT` with the matching token.

## Feature scoping (v1)
You can limit which phases are visible by passing `phases` (or `allowedPhases`) in the embed URL or in the init payload.

Example (URL):

```
/embed.html?allowedOrigins=https://storyproject.example&phases=script,storyboard&initialPhase=script
```

Example (init payload):

```
{ allowedPhases: ['script', 'storyboard'], initialPhase: 'script' }
```

## Sub-feature flags (AI actions)
You can also enable/disable specific AI actions via `features` (allowlist) or `disabledFeatures` (blocklist).

Available features:
- `script-generation`
- `script-analysis`
- `director-mode`
- `concept-generation`
- `storyboard-generation`
- `filming-generation`
- `review-analysis`

Example (URL):

```
/embed.html?allowedOrigins=https://storyproject.example&phases=script,storyboard&features=storyboard-generation,script-analysis
```

Example (init payload):

```
{ allowedFeatures: ['storyboard-generation'], disabledFeatures: ['script-generation'] }
```

## Message contract
All messages use `window.postMessage`.

### Host -> Embed
- `STORY_PROJECT_INIT`
  - payload: `{ storyBible?, projectSync?, projectCollaboration?, shotPrompts?, references?, recentProjects?, apiKeyReady?, projectPath?, activeProfileName?, syncStatus?, token?, allowedPhases?, initialPhase?, allowedFeatures?, disabledFeatures? }`
- `STORY_PROJECT_SET_STORY_BIBLE` (payload: StoryBible)
- `STORY_PROJECT_SET_SHOT_PROMPTS` (payload: ShotPrompt[])
- `STORY_PROJECT_SET_REFERENCES` (payload: ReferenceItem[])
- `STORY_PROJECT_SET_PROJECT_SYNC` (payload: ProjectSyncConfig)
- `STORY_PROJECT_SET_PROJECT_COLLABORATION` (payload: ProjectCollaboration)
- `STORY_PROJECT_SET_API_KEY_READY` (payload: boolean)
- `STORY_PROJECT_SET_RECENT_PROJECTS` (payload: RecentProject[])
- `STORY_PROJECT_REQUEST_STATE` (no payload)

### Embed -> Host
- `STORY_PROJECT_EMBED_READY`
- `STORY_PROJECT_INIT_ACK`
- `STORY_PROJECT_STATE` (payload: full embed state)
- `STORY_PROJECT_EVENT` (payload: `{ event, data }`)
  - events: `storyBibleChanged`, `shotPromptsChanged`, `referencesChanged`, `projectSyncChanged`, `projectCollaborationChanged`, `apiKeyReadyChanged`, `recentProjectsChanged`, `mediaItemsChanged`, `roughCutReady`

## Minimal host example
See `embed-host-demo.html` for a working example.

## Host helper SDK
For production, use the dedicated host SDK package in `packages/storyboard-embed-sdk`:
- build: `cd packages/storyboard-embed-sdk && npm run build`
- import: `@ai-video-production-editor/storyboard-embed-sdk`

It handles:
- building the iframe URL with allowlisted origins and a session token
- sending typed messages
- receiving events/state callbacks

## Quickstart
See `docs/storyboard-embed-quickstart.md` for a minimal open integration scope preset (Script + Storyboard only).
