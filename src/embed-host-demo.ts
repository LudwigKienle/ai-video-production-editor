import { StoryProjectEmbedClient, createEmbedSessionToken } from './sdk/storyProjectEmbedHost';

const iframe = document.getElementById('story-embed') as HTMLIFrameElement | null;
const log = document.getElementById('log');

if (!iframe || !log) {
  throw new Error('Missing iframe or log element');
}

const logLine = (message: string) => {
  const time = new Date().toLocaleTimeString();
  log.textContent = `[${time}] ${message}\n` + log.textContent;
};

const sessionToken = createEmbedSessionToken();

const client = new StoryProjectEmbedClient({
  iframe,
  embedUrl: '/embed.html',
  allowedOrigins: [window.location.origin],
  sessionToken,
  onReady: () => logLine('Embed ready'),
  onInitAck: () => logLine('Init ACK'),
  onState: (state) => logLine(`STATE: ${JSON.stringify(state)}`),
  onEvent: (event) => logLine(`EVENT: ${event.event}`),
});

const initButton = document.getElementById('init');
const requestButton = document.getElementById('request');
const setBibleButton = document.getElementById('set-bible');

initButton?.addEventListener('click', () => {
  client.init({
    storyBible: {
      title: 'Embed Demo',
      logline: 'A lone filmmaker discovers a portal into their own storyboard.',
      characters: [{ name: 'Ira', description: 'Curious creator with a haunted sketchbook.' }],
      plotBeats: 'Arrival → discovery → confrontation → resolve',
      script: '',
      productionGuidelines: 'Moody, cinematic lighting. Practical textures.',
    },
    apiKeyReady: true,
    activeProfileName: 'Embed Host',
    allowedPhases: ['script', 'storyboard'],
    initialPhase: 'script',
    allowedFeatures: ['script-analysis', 'storyboard-generation'],
  });
});

requestButton?.addEventListener('click', () => {
  client.requestState();
});

setBibleButton?.addEventListener('click', () => {
  client.setStoryBible({
    logline: 'A test update from the host.',
    characters: [],
    plotBeats: '',
    script: '',
    productionGuidelines: '',
  });
});

const pingButton = document.getElementById('ping');
pingButton?.addEventListener('click', () => {
  logLine('Ping sent');
});
