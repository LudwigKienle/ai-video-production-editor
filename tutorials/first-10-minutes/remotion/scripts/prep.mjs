// Collects narration timings and screen marks into src/data.generated.json for the edit.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const { scenes } = JSON.parse(readFileSync(resolve(root, 'script/scenes.json'), 'utf8'));
const out = scenes.map((scene) => {
  const timing = JSON.parse(readFileSync(resolve(root, `build/timings/${scene.id}.json`), 'utf8'));
  const marksFile = resolve(root, `build/screen/${scene.id}.marks.json`);
  const marks = existsSync(marksFile) ? JSON.parse(readFileSync(marksFile, 'utf8')) : null;
  return {
    id: scene.id,
    kind: scene.kind,
    text: scene.text,
    words: timing.words,
    duration: timing.duration,
    estimated: Boolean(timing.estimated),
    // Prefer the loudness-normalized narration (script/normalize-voice.sh).
    audio: timing.estimated ? null
      : existsSync(resolve(root, `build/audio/norm/${scene.id}.wav`)) ? `audio/norm/${scene.id}.wav`
      : existsSync(resolve(root, `build/audio/${scene.id}.mp3`)) ? `audio/${scene.id}.mp3` : null,
    hasScreen: existsSync(resolve(root, `build/screen/${scene.id}.mp4`)),
    marks: marks?.marks ?? [],
    events: marks?.events ?? [],
    viewport: marks?.viewport ?? null,
  };
});
const music = existsSync(resolve(root, 'build/audio/music.mp3')) ? 'audio/music.mp3' : null;
writeFileSync(resolve(import.meta.dirname, '../src/data.generated.json'), JSON.stringify({ music, scenes: out }, null, 1));
console.log(out.map((s) => `${s.id}: ${s.duration.toFixed(1)} s${s.estimated ? ' (estimated)' : ''}${s.hasScreen ? ', screen' : ''}`).join('\n'));
