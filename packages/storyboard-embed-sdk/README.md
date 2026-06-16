# Story Project Embed Host SDK

Small host-side wrapper around the Story Project iFrame `postMessage` contract.

## Install (local)

```
# from repo root
cd packages/storyboard-embed-sdk
npm run build
```

## Usage

```ts
import { StoryProjectEmbedClient, createEmbedSessionToken } from '@ai-video-production-editor/storyboard-embed-sdk';

const iframe = document.querySelector('iframe');
const token = createEmbedSessionToken();

const client = new StoryProjectEmbedClient({
  iframe,
  embedUrl: '/embed.html',
  allowedOrigins: [window.location.origin],
  sessionToken: token,
  validateMessages: true,
  onReady: () => console.log('embed ready'),
  onEvent: (event) => console.log(event.event),
});

client.init({
  storyBible: {
    logline: 'A test story',
    characters: [],
    plotBeats: '',
    script: '',
    productionGuidelines: '',
  },
  apiKeyReady: true,
  allowedPhases: ['script', 'storyboard'],
  initialPhase: 'script',
  allowedFeatures: ['storyboard-generation', 'script-analysis'],
});
```

## Runtime validation
You can validate incoming events/state manually:

```ts
import { StoryProjectEmbedEventSchema, StoryProjectEmbedStateSchema } from '@ai-video-production-editor/storyboard-embed-sdk';

const parsedEvent = StoryProjectEmbedEventSchema.safeParse(event);
const parsedState = StoryProjectEmbedStateSchema.safeParse(state);
```

## Notes
- Use `allowedOrigins` + `sessionToken` in production. The client sends the token on every message.
- `embedUrl` should point to the hosted `embed.html`.
- Set `validateMessages: true` to enable runtime schema validation via Zod.

## Publish checklist
1) `npm install` in `packages/storyboard-embed-sdk`
2) `npm run build`
3) `npm publish --access public`
