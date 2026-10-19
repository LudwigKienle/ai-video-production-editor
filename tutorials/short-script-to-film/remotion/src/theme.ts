import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/instrument-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';

// The studio's dark theme, so the short and the app read as one thing.
export const C = {
  bg: '#07090f',
  ink: '#f4f6fb',
  muted: '#9aa3b5',
  accent: '#818cf8',
  accentStrong: '#6366f1',
  paper: '#f3efe6',
  paperInk: '#16161a',
};

export const sans = '"Instrument Sans", system-ui, sans-serif';
export const mono = '"IBM Plex Mono", ui-monospace, monospace';

export const FPS = 30;
export const W = 1080;
export const H = 1920;
/** The band clips sit in; above it is room for captions, below it the platform UI. */
export const BAND = { top: 470, height: 1150 };
