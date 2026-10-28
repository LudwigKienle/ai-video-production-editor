/**
 * Burst Frame (Phil Langer): turns the start frame into a 5-second sequence of
 * 20 static compositions with hard cuts. Builds the prompt; generation runs
 * through the video workspace, so every model with a start frame works.
 */
import React, { useMemo, useState } from 'react';
import { analyzeImage, analyzeImages } from '../services/geminiService';
import {
  BURST_ANALYSIS_INSTRUCTION,
  BURST_FRAME_SETTINGS,
  burstAnalysisInstruction,
  buildBurstFramePrompt,
  burstShots,
  checkBurstFramePrompt,
  nearestAspectRatio,
  parseBurstAnalysis,
  type BurstLighting,
  type BurstSubjectKind,
} from '../services/burstFrame';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import type { BurstReference } from '../services/burstReferences';

type Props = {
  startImage: { file?: File | null; url?: string | null };
  /** Current text of the workspace prompt box (checked live). */
  prompt: string;
  aspectOptions: string[];
  modelLabel?: string;
  modelSupportsImage: boolean;
  analysisReady: boolean;
  onApply: (result: { prompt: string; aspectRatio?: string; references?: BurstReference[]; source?: 'start-frame' | 'references' }) => void;
  onPickImageModel: () => void;
  /** Hint shown when there is no start image (defaults to the video page's Start Frame field). */
  missingStartHint?: string;
  /** Reference images sent with the start frame; omit to hide the section. */
  references?: BurstReference[];
  onReferencesChange?: (references: BurstReference[]) => void;
  /** Concept references that can be added (e.g. all project references with an image). */
  availableReferences?: BurstReference[];
  /** Note shown under the references (e.g. which models receive them). */
  referencesNote?: string;
  /** Allow a burst built from the references alone (no start frame). */
  allowReferencesOnly?: boolean;
  /** Whether the current video model takes several reference images without a start frame. */
  modelSupportsReferences?: boolean;
  onPickReferenceModel?: () => void;
  /** Scene text for the references-only analysis (slugline, action). */
  sceneNote?: string;
  /** Source stored with an existing burst. */
  initialSource?: 'start-frame' | 'references';
};

const MAX_REFERENCES = 8;

const SUBJECTS: Array<[BurstSubjectKind, string]> = [
  ['person', 'Person'],
  ['object', 'Objekt / Produkt'],
  ['animal', 'Tier'],
  ['landscape', 'Landschaft'],
  ['architecture', 'Architektur / Raum'],
];

const imageSize = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });

const BurstFramePanel: React.FC<Props> = ({ startImage, prompt, aspectOptions, modelLabel, modelSupportsImage, analysisReady, onApply, onPickImageModel, missingStartHint, references, onReferencesChange, availableReferences, referencesNote, allowReferencesOnly, modelSupportsReferences, onPickReferenceModel, sceneNote, initialSource }) => {
  const [continuity, setContinuity] = useState('');
  const [style, setStyle] = useState('');
  const [subjectKind, setSubjectKind] = useState<BurstSubjectKind>('person');
  const [lighting, setLighting] = useState<BurstLighting>('continuous');
  const [compact, setCompact] = useState(false);
  const [shots, setShots] = useState<string[] | null>(null);
  const [aspect, setAspect] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasStart = Boolean(startImage.file || startImage.url);
  const [source, setSource] = useState<'start-frame' | 'references'>(initialSource ?? (hasStart || !allowReferencesOnly ? 'start-frame' : 'references'));
  const fromRefs = allowReferencesOnly === true && source === 'references';
  const refCount = references?.length ?? 0;
  const canAnalyze = fromRefs ? refCount > 0 : hasStart;
  const check = useMemo(() => checkBurstFramePrompt(prompt), [prompt]);
  const looksLikeBurst = /BURST FRAME/i.test(prompt);
  const preview = useMemo(() => burstShots({ shots: shots ?? undefined, subjectKind, lighting }), [shots, subjectKind, lighting]);

  const startSource = async () => {
    if (startImage.file) return { base64: await fileToBase64(startImage.file), mimeType: startImage.file.type || 'image/png', src: URL.createObjectURL(startImage.file) };
    if (startImage.url) return { ...(await getBase64FromUrl(startImage.url)), src: startImage.url };
    return null;
  };

  const analyze = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (fromRefs) {
        const refs = references || [];
        if (!refs.length) throw new Error('Bitte zuerst Referenzen wählen.');
        const text = await analyzeImages(
          burstAnalysisInstruction(refs.map((ref) => (ref.kind ? `${ref.name} (${ref.kind})` : ref.name)), { withStartFrame: false, sceneNote }),
          await Promise.all(refs.map((ref) => getBase64FromUrl(ref.imageUrl))),
        );
        const parsed = parseBurstAnalysis(text);
        if (!parsed) throw new Error('Die Analyse lieferte kein gültiges Ergebnis. Bitte Felder manuell ausfüllen.');
        setContinuity(parsed.continuity);
        setStyle(parsed.style);
        if (parsed.subjectKind) setSubjectKind(parsed.subjectKind);
        if (parsed.aspectRatio && aspectOptions.includes(parsed.aspectRatio)) setAspect(parsed.aspectRatio);
        setShots(parsed.shots ?? null);
        setMessage(`${refs.length} Referenzen analysiert: ein Moment daraus komponiert${parsed.shots ? ', 20 angepasste Einstellungen übernommen' : ''}.`);
        return;
      }
      const source = await startSource();
      if (!source) throw new Error('Bitte zuerst ein Startbild wählen.');
      const size = await imageSize(source.src);
      if (size.width) setAspect(nearestAspectRatio(size.width, size.height, aspectOptions.filter((a) => /^\d+:\d+$/.test(a))));
      const refs = references || [];
      const text = refs.length
        ? await analyzeImages(burstAnalysisInstruction(refs.map((ref) => ref.name)), [
          { base64: source.base64, mimeType: source.mimeType },
          ...(await Promise.all(refs.map((ref) => getBase64FromUrl(ref.imageUrl)))),
        ])
        : await analyzeImage(BURST_ANALYSIS_INSTRUCTION, { base64: source.base64, mimeType: source.mimeType });
      const parsed = parseBurstAnalysis(text);
      if (!parsed) throw new Error('Die Bildanalyse lieferte kein gültiges Ergebnis. Bitte Felder manuell ausfüllen.');
      setContinuity(parsed.continuity);
      setStyle(parsed.style);
      if (parsed.subjectKind) setSubjectKind(parsed.subjectKind);
      setShots(parsed.shots ?? null);
      setMessage(parsed.shots ? 'Startbild analysiert, 20 angepasste Einstellungen übernommen.' : 'Startbild analysiert; Shot-Liste aus der Standardbibliothek.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    onApply({
      prompt: buildBurstFramePrompt({ continuity, style, shots: shots ?? undefined, subjectKind, lighting, compact, references: references?.map((ref) => ({ name: ref.name, kind: ref.kind })), source: fromRefs ? 'references' : 'start-frame' }),
      aspectRatio: aspect,
      references,
      source: fromRefs ? 'references' : 'start-frame',
    });
    setMessage(`Prompt übernommen: ${BURST_FRAME_SETTINGS.durationSeconds} s, ${BURST_FRAME_SETTINGS.shotCount} Shots, Audio aus${aspect ? `, ${aspect}` : ''}.`);
  };

  return (
    <div className="space-y-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4" data-automation-id="burst-frame.panel">
      <div>
        <div className="text-xs uppercase tracking-[0.12em] text-indigo-300">Burst Frame · Phil Langer</div>
        <p className="mt-1 text-sm text-gray-400">
          {fromRefs
            ? 'Ohne Startbild: ein eingefrorener Moment aus den Referenzen (Figuren in der Location), 20 statische Einstellungen, harte Schnitte alle 0,25 s, 5 s ohne Ton. Braucht ein Modell, das mehrere Referenzbilder nimmt.'
            : 'Ein Startbild, 20 statische Einstellungen, harte Schnitte alle 0,25 s, 5 s ohne Ton. Motiv und Set bleiben identisch, nur Kamera und Bildausschnitt wechseln. Funktioniert mit jedem Modell, das ein Startbild nimmt.'}
        </p>
      </div>

      {allowReferencesOnly && (
        <div className="pk-seg" style={{ gridTemplateColumns: '1fr 1fr' }} data-automation-id="burst-frame.source">
          <button type="button" aria-pressed={!fromRefs} disabled={!hasStart} onClick={() => setSource('start-frame')} title={hasStart ? 'Das Startbild bestimmt den Moment' : 'Dieser Shot hat kein Startbild'}>Startbild{refCount ? ' + Referenzen' : ''}</button>
          <button type="button" aria-pressed={fromRefs} onClick={() => setSource('references')} title="Ohne Startbild: der Moment wird aus den Referenzen komponiert (Figuren in der Location)">Nur Referenzen</button>
        </div>
      )}
      {!fromRefs && !hasStart && <p className="text-xs text-amber-300">{missingStartHint || 'Wähle unten bei „Start Frame“ ein Startbild (Upload oder Bibliothek).'}</p>}
      {fromRefs && !refCount && <p className="text-xs text-amber-300">Wähle mindestens eine Referenz (z. B. Location und Figuren).</p>}
      {fromRefs && modelSupportsReferences === false && (
        <p className="text-xs text-amber-300">
          {modelLabel || 'Dieses Modell'} filmt nicht aus Referenzen allein.{' '}
          {onPickReferenceModel && <button type="button" className="underline" onClick={onPickReferenceModel} data-automation-id="burst-frame.pick-reference-model">Seedance 2.5 Omni wählen</button>}
        </p>
      )}
      {!fromRefs && !modelSupportsImage && (
        <p className="text-xs text-amber-300">
          {modelLabel || 'Dieses Modell'} nimmt kein Startbild.{' '}
          <button type="button" className="underline" onClick={onPickImageModel} data-automation-id="burst-frame.pick-model">
            Seedance 2.5 I2V wählen
          </button>
        </p>
      )}

      {references && onReferencesChange && (
        <div className="space-y-2" data-automation-id="burst-frame.references">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>Referenzen ({references.length}/{MAX_REFERENCES}) · Identität und Design bleiben in allen 20 Einstellungen gleich</span>
            <label className="app-button app-tertiary cursor-pointer text-xs" data-automation-id="burst-frame.references.upload">
              + Bild
              <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => {
                const files = Array.from(event.target.files || []).slice(0, Math.max(0, MAX_REFERENCES - references.length));
                event.target.value = '';
                void Promise.all(files.map(async (file, index) => ({
                  id: `upload-${Date.now()}-${index}`,
                  name: file.name.replace(/\.[^.]+$/, ''),
                  imageUrl: `data:${file.type || 'image/png'};base64,${await fileToBase64(file)}`,
                  source: 'upload' as const,
                }))).then((added) => onReferencesChange([...references, ...added]));
              }} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {references.map((ref) => (
              <button key={ref.id} type="button" className="group relative h-16 w-16 overflow-hidden rounded-md border border-indigo-400/60" title={`${ref.name}${ref.kind ? ` (${ref.kind})` : ''} – klicken zum Entfernen`} onClick={() => onReferencesChange(references.filter((entry) => entry.id !== ref.id))} data-automation-id={`burst-frame.reference.${ref.id}`}>
                <img src={ref.imageUrl} alt="" className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 text-[9px] text-white">{ref.name}</span>
                <span className="absolute right-0.5 top-0.5 hidden rounded bg-black/70 px-1 text-[9px] text-white group-hover:block">✕</span>
              </button>
            ))}
            {references.length === 0 && <span className="text-xs text-gray-500">Keine Referenzen – nur das Startbild.</span>}
          </div>
          {availableReferences && availableReferences.some((ref) => !references.some((entry) => entry.id === ref.id)) && references.length < MAX_REFERENCES && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
              <span>Hinzufügen:</span>
              {availableReferences.filter((ref) => !references.some((entry) => entry.id === ref.id)).map((ref) => (
                <button key={ref.id} type="button" className="rounded-full border border-white/15 px-2 py-0.5 hover:border-indigo-400" onClick={() => onReferencesChange([...references, ref].slice(0, MAX_REFERENCES))} data-automation-id={`burst-frame.reference-add.${ref.id}`}>
                  + {ref.name}
                </button>
              ))}
            </div>
          )}
          {referencesNote && <p className="text-[11px] text-gray-500">{referencesNote}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="app-button app-secondary text-xs" disabled={!canAnalyze || busy || !analysisReady} onClick={() => void analyze()} data-automation-id="burst-frame.analyze" title={analysisReady ? `Analysiert ${fromRefs ? 'die Referenzen' : refCount ? 'Startbild und Referenzen' : 'das Startbild'} mit Gemini` : 'Gemini-Schlüssel fehlt – Felder manuell ausfüllen'}>
          {busy ? 'Analysiere …' : fromRefs ? 'Referenzen analysieren' : refCount ? 'Startbild + Referenzen analysieren' : 'Startbild analysieren'}
        </button>
        <button type="button" className="app-button app-primary text-xs" disabled={busy} onClick={apply} data-automation-id="burst-frame.apply">
          Burst-Prompt übernehmen
        </button>
      </div>

      <label className="block text-xs text-gray-400">
        Kontinuität („Preserve exactly the same …“)
        <textarea className="app-textarea mt-1 h-20 text-xs" value={continuity} onChange={(e) => setContinuity(e.target.value)} placeholder="z. B. woman in a red wool coat seated on a grey sofa, hands folded, brass lamp to her left, beige living room with tall window" data-automation-id="burst-frame.continuity" />
      </label>
      <label className="block text-xs text-gray-400">
        Stil (Licht, Palette, Textur, Objektiv)
        <textarea className="app-textarea mt-1 h-16 text-xs" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="z. B. Soft window light from camera left, muted palette, shallow depth of field, photorealistic." data-automation-id="burst-frame.style" />
      </label>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
        <label>
          Motiv
          <select className="app-select mt-1 w-full" value={subjectKind} onChange={(e) => { setSubjectKind(e.target.value as BurstSubjectKind); setShots(null); }} data-automation-id="burst-frame.subject">
            {SUBJECTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>
          Licht
          <select className="app-select mt-1 w-full" value={lighting} onChange={(e) => setLighting(e.target.value as BurstLighting)} data-automation-id="burst-frame.lighting">
            <option value="continuous">Durchgehend wie Startbild</option>
            <option value="time-of-day">Tageszeit-Varianten (Shots 18–20)</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-400">
        <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} data-automation-id="burst-frame.compact" />
        Kompakte Fassung (für Modelle mit kurzem Prompt-Limit)
      </label>

      <details className="text-xs text-gray-400">
        <summary className="cursor-pointer">Shot-Liste ({preview.length}){shots ? ' – aus Bildanalyse' : ' – Standard'}</summary>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5">
          {preview.map((shot, i) => <li key={i}>{shot}</li>)}
        </ol>
      </details>

      {looksLikeBurst && (
        <div className={`text-xs ${check.ok ? 'text-emerald-300' : 'text-amber-300'}`} data-automation-id="burst-frame.check">
          {check.ok ? `Prompt-Check ok · ${prompt.length} Zeichen` : `Prompt-Check: ${check.problems.join(' ')}`}
        </div>
      )}
      {message && <p className="text-xs text-gray-300">{message}</p>}
    </div>
  );
};

export default BurstFramePanel;
