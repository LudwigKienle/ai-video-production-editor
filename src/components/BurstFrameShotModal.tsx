/**
 * Burst Frame for one storyboard shot (Project Space → Storyboard). Builds the
 * prompt from the shot's frame with the shared BurstFramePanel and stores it on
 * the shot; Filming then renders it verbatim (5 s, 20 hard cuts, no audio).
 */
import React from 'react';
import BurstFramePanel from './BurstFramePanel';
import { BURST_FRAME_SETTINGS, checkBurstFramePrompt } from '../services/burstFrame';
import { conceptReferenceToBurst, sceneConceptReferences, type BurstReference } from '../services/burstReferences';
import type { ReferenceItem, ShotPrompt } from '../types';

export type BurstSave = { prompt: string; aspectRatio?: string; references?: BurstReference[]; source?: 'start-frame' | 'references' };

type Props = {
  shots: ShotPrompt[];
  shotNumber: number;
  /** Concept references of the project (cast, locations, products, props). */
  references: ReferenceItem[];
  /** Video model takes several reference images without a start frame. */
  videoModelTakesReferences: boolean;
  onPickReferenceModel: () => void;
  onSelectShot: (shot: number) => void;
  aspectOptions: string[];
  videoModelLabel?: string;
  videoModelTakesStartFrame: boolean;
  analysisReady: boolean;
  canFilm: boolean;
  onSave: (shot: number, burst: BurstSave | null) => void;
  onFilm: (shot: number) => void;
  onPickImageModel: () => void;
  onClose: () => void;
};

const shotLabel = (shot: ShotPrompt) => shot.shotLabel || `Shot ${shot.shot}`;
export const shotStartFrame = (shot: ShotPrompt | undefined) => shot?.startFrameUrl || shot?.imageUrl || null;

const BurstFrameShotModal: React.FC<Props> = ({ shots, shotNumber, references, videoModelTakesReferences, onPickReferenceModel, onSelectShot, aspectOptions, videoModelLabel, videoModelTakesStartFrame, analysisReady, canFilm, onSave, onFilm, onPickImageModel, onClose }) => {
  const shot = shots.find((entry) => entry.shot === shotNumber);
  const frame = shotStartFrame(shot);
  const stored = shot?.burstFrame?.prompt || '';
  const check = stored ? checkBurstFramePrompt(stored) : null;
  // Default: the concept references that occur in this shot's scene; a saved burst keeps its own selection.
  const sceneDefaults = React.useMemo(() => (shot ? sceneConceptReferences(shot, shots, references) : []), [shot, shots, references]);
  const available = React.useMemo(() => references.map(conceptReferenceToBurst).filter((ref): ref is BurstReference => Boolean(ref)), [references]);
  const [selected, setSelected] = React.useState<BurstReference[]>(() => shot?.burstFrame?.references ?? sceneDefaults);
  React.useEffect(() => { setSelected(shot?.burstFrame?.references ?? sceneDefaults); }, [shotNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  const sceneNote = shot ? [shot.sceneSlugline, shot.description].filter(Boolean).join(' – ') : undefined;
  const fromRefs = shot?.burstFrame?.source === 'references';

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Burst Frame" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} data-automation-id="storyboard.burst-frame.modal">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#14161a] p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold" style={{ color: "#f4f5f7" }}>Burst Frame</h3>
            <p className="text-xs text-gray-400">Aus dem Storyboard-Frame eines Shots oder nur aus seinen Concept-Referenzen (Location, Figuren, Props) wird ein 5-s-Video mit 20 statischen Einstellungen und harten Schnitten. Filming nutzt den Prompt wortgleich, ohne Ton.</p>
          </div>
          <button type="button" className="app-button app-tertiary text-xs" onClick={onClose} data-automation-id="storyboard.burst-frame.close">Schließen</button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-xs text-gray-400">
            Shot
            <select className="app-select ml-2" value={shotNumber} onChange={(event) => onSelectShot(Number(event.target.value))} data-automation-id="storyboard.burst-frame.shot">
              {shots.map((entry) => (
                <option key={entry.shot} value={entry.shot}>
                  {shotLabel(entry)}{entry.burstFrame ? ' · Burst' : ''}{shotStartFrame(entry) ? '' : ' (ohne Frame)'}
                </option>
              ))}
            </select>
          </label>
          {frame && <img src={frame} alt="" className="h-16 rounded-md border border-white/10 object-cover" />}
          {shot?.description && <p className="min-w-[12rem] flex-1 text-xs text-gray-400 line-clamp-3">{shot.description}</p>}
        </div>

        {stored && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-gray-300" data-automation-id="storyboard.burst-frame.active">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-emerald-300">Burst aktiv für {shot ? shotLabel(shot) : `Shot ${shotNumber}`}: {BURST_FRAME_SETTINGS.durationSeconds} s, {BURST_FRAME_SETTINGS.shotCount} Einstellungen, Ton aus{shot?.burstFrame?.aspectRatio ? `, ${shot.burstFrame.aspectRatio}` : ''}{fromRefs ? ', nur Referenzen' : ''}{shot?.burstFrame?.references?.length ? `, ${shot.burstFrame.references.length} Referenzen` : ''}</span>
              <span className="flex gap-2">
                <button type="button" className="app-button app-primary text-xs" disabled={!canFilm || shot?.isFilming} onClick={() => onFilm(shotNumber)} data-automation-id="storyboard.burst-frame.film" title={canFilm ? `Filmt den Shot mit ${videoModelLabel || 'dem Filming-Modell'}` : 'Filming ist nicht verfügbar'}>
                  {shot?.isFilming ? 'Filmt …' : 'Jetzt filmen'}
                </button>
                <button type="button" className="app-button app-secondary text-xs" onClick={() => onSave(shotNumber, null)} data-automation-id="storyboard.burst-frame.clear">Burst entfernen</button>
              </span>
            </div>
            {check && !check.ok && <p className="mt-2 text-amber-300">Prompt-Check: {check.problems.join(' ')}</p>}
            <details className="mt-2">
              <summary className="cursor-pointer text-gray-400">Prompt ansehen ({stored.length} Zeichen)</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-gray-400">{stored}</pre>
            </details>
          </div>
        )}

        <BurstFramePanel
          key={shotNumber}
          startImage={{ url: frame }}
          prompt={stored}
          aspectOptions={aspectOptions}
          modelLabel={videoModelLabel}
          modelSupportsImage={videoModelTakesStartFrame}
          analysisReady={analysisReady}
          onApply={(result) => onSave(shotNumber, result)}
          onPickImageModel={onPickImageModel}
          missingStartHint="Dieser Shot hat noch keinen Storyboard-Frame. Frame generieren oder hochladen, oder „Nur Referenzen“ wählen."
          references={selected}
          onReferencesChange={setSelected}
          availableReferences={available}
          referencesNote={`Vorausgewählt: Concept-Referenzen dieser Szene (${sceneDefaults.length}). Mitgeschickt an Seedance Omni, MiniMax H3 Reference, PixVerse C1 und Kling; bei anderen Modellen nur im Prompt.`}
          allowReferencesOnly
          modelSupportsReferences={videoModelTakesReferences}
          onPickReferenceModel={onPickReferenceModel}
          sceneNote={sceneNote}
          initialSource={shot?.burstFrame?.source ?? (frame ? 'start-frame' : 'references')}
        />
      </div>
    </div>
  );
};

export default BurstFrameShotModal;
