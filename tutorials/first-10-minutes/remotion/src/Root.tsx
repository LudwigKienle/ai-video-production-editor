import React from 'react';
import { AbsoluteFill, Audio, Composition, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Background } from './components/Background';
import { Captions } from './components/Captions';
import { ScreenScene } from './components/ScreenScene';
import { directions } from './direction';
import { Install, Intro, Outro } from './scenes/Motion';
import { FPS, HEIGHT, LEAD, SceneData, WIDTH, XFADE, music, sceneFrames, timeline, totalFrames } from './timeline';

const motion: Record<string, React.FC<{ scene: SceneData }>> = { s01_intro: Intro, s02_install: Install, s10_outro: Outro };

const SceneBody: React.FC<{ scene: SceneData }> = ({ scene }) => {
  if (scene.kind === 'screen') return <ScreenScene scene={scene} direction={directions[scene.id](scene)} />;
  const Motion = motion[scene.id];
  return <Motion scene={scene} />;
};

/** One scene with its narration, captions and a fade at both ends. */
const SceneClip: React.FC<{ scene: SceneData }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const frames = sceneFrames(scene);
  const opacity = interpolate(frame, [0, XFADE, frames - XFADE, frames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ opacity }}>
      <SceneBody scene={scene} />
      <Captions scene={scene} />
      {scene.audio && (
        <Sequence from={Math.round(LEAD * FPS)} layout="none">
          <Audio src={staticFile(scene.audio)} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

// Frames in which narration is audible, for ducking the music under the voice.
const speech = timeline.flatMap(({ scene, from }) => scene.words.map((w) => [
  from + Math.round((LEAD + w.start) * FPS), from + Math.round((LEAD + w.end) * FPS),
] as const));
const speaking = (f: number) => speech.some(([a, b]) => f >= a - 8 && f <= b + 14);

/** Music at 0.30, ducked to 0.085 while someone speaks (8-frame attack, 14-frame release). */
const musicVolume = (f: number) => {
  let v = 0.3;
  for (let d = 0; d <= 14; d++) if (speaking(f - d) || speaking(f + Math.min(d, 8))) { v = 0.085 + (0.3 - 0.085) * (d / 14); break; }
  const fadeOut = interpolate(f, [totalFrames - 60, totalFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return v * fadeOut;
};

export const Tutorial: React.FC = () => (
  <AbsoluteFill>
    <Background />
    {music && <Audio src={staticFile(music)} volume={musicVolume} />}
    {timeline.map(({ scene, from, frames }) => (
      <Sequence key={scene.id} from={from} durationInFrames={frames} name={scene.id}>
        <SceneClip scene={scene} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

export const Root: React.FC = () => (
  <>
    <Composition id="Tutorial" component={Tutorial} durationInFrames={totalFrames} fps={FPS} width={WIDTH} height={HEIGHT} />
    {timeline.map(({ scene, frames }) => (
      <Composition key={scene.id} id={scene.id.replace(/_/g, '-')} durationInFrames={frames} fps={FPS} width={WIDTH} height={HEIGHT}
        component={() => (<AbsoluteFill><Background /><SceneClip scene={scene} /></AbsoluteFill>)} />
    ))}
  </>
);
