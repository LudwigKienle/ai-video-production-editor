import React from 'react';
import { useCurrentFrame } from 'remotion';
import { FPS, LEAD, SceneData, Word } from '../timeline';
import { C, sans } from '../theme';

const MAX_CHARS = 44;

/** Split narration into caption lines at sentence/clause ends or ~44 characters. */
const chunk = (words: Word[]) => {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let len = 0;
  for (const w of words) {
    if (line.length && len + w.word.length + 1 > MAX_CHARS) {
      lines.push(line); line = []; len = 0;
    }
    line.push(w);
    len += w.word.length + 1;
    if (/[.!?]$/.test(w.word) || (/[,:;]$/.test(w.word) && len > MAX_CHARS * 0.55)) {
      lines.push(line); line = []; len = 0;
    }
  }
  if (line.length) lines.push(line);
  return lines;
};

/** Word-by-word captions; the spoken word lights up. */
export const Captions: React.FC<{ scene: SceneData; bottom?: number }> = ({ scene, bottom = 44 }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS - LEAD;
  const lines = React.useMemo(() => chunk(scene.words), [scene]);
  const current = lines.find((l, i) => {
    const next = lines[i + 1];
    return t >= l[0].start - 0.15 && (!next || t < next[0].start - 0.15);
  });
  if (!current || t > current[current.length - 1].end + 0.6) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{
        fontFamily: sans, fontSize: 38, fontWeight: 600, letterSpacing: '-0.005em', lineHeight: 1.25,
        padding: '10px 22px', borderRadius: 14, background: 'rgba(7, 9, 15, 0.78)',
        boxShadow: '0 10px 30px rgba(0,0,0,.35)', maxWidth: 1400, textAlign: 'center',
      }}>
        {current.map((w, i) => {
          const spoken = t >= w.start;
          return (
            <span key={i} style={{ color: spoken ? C.ink : 'rgba(232, 236, 244, 0.42)' }}>
              {w.word}{i < current.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
};
