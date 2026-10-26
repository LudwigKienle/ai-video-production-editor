/**
 * Burst Frame (Phil Langer): turns the start frame into a 5-second sequence of
 * 20 static compositions with hard cuts. Builds the prompt; generation runs
 * through the video workspace, so every model with a start frame works.
 */
import React, { useMemo, useState } from 'react';
import { analyzeImage } from '../services/geminiService';
import {
  BURST_ANALYSIS_INSTRUCTION,
  BURST_FRAME_SETTINGS,
  buildBurstFramePrompt,
  burstShots,
  checkBurstFramePrompt,
  nearestAspectRatio,
  parseBurstAnalysis,
  type BurstLighting,
  type BurstSubjectKind,
} from '../services/burstFrame';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';

type Props = {
  startImage: { file?: File | null; url?: string | null };
  /** Current text of the workspace prompt box (checked live). */
  prompt: string;
  aspectOptions: string[];
  modelLabel?: string;
  modelSupportsImage: boolean;
  analysisReady: boolean;
  onApply: (result: { prompt: string; aspectRatio?: string }) => void;
  onPickImageModel: () => void;
};

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

const BurstFramePanel: React.FC<Props> = ({ startImage, prompt, aspectOptions, modelLabel, modelSupportsImage, analysisReady, onApply, onPickImageModel }) => {
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
      const source = await startSource();
      if (!source) throw new Error('Bitte zuerst ein Startbild wählen.');
      const size = await imageSize(source.src);
      if (size.width) setAspect(nearestAspectRatio(size.width, size.height, aspectOptions.filter((a) => /^\d+:\d+$/.test(a))));
      const text = await analyzeImage(BURST_ANALYSIS_INSTRUCTION, { base64: source.base64, mimeType: source.mimeType });
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
      prompt: buildBurstFramePrompt({ continuity, style, shots: shots ?? undefined, subjectKind, lighting, compact }),
      aspectRatio: aspect,
    });
    setMessage(`Prompt übernommen: ${BURST_FRAME_SETTINGS.durationSeconds} s, ${BURST_FRAME_SETTINGS.shotCount} Shots, Audio aus${aspect ? `, ${aspect}` : ''}.`);
  };

  return (
    <div className="space-y-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4" data-automation-id="burst-frame.panel">
      <div>
        <div className="text-xs uppercase tracking-[0.12em] text-indigo-300">Burst Frame · Phil Langer</div>
        <p className="mt-1 text-sm text-gray-400">
          Ein Startbild, 20 statische Einstellungen, harte Schnitte alle 0,25 s, 5 s ohne Ton. Motiv und Set bleiben identisch, nur Kamera und Bildausschnitt wechseln.
          Funktioniert mit jedem Modell, das ein Startbild nimmt.
        </p>
      </div>

      {!hasStart && <p className="text-xs text-amber-300">Wähle unten bei „Start Frame“ ein Startbild (Upload oder Bibliothek).</p>}
      {!modelSupportsImage && (
        <p className="text-xs text-amber-300">
          {modelLabel || 'Dieses Modell'} nimmt kein Startbild.{' '}
          <button type="button" className="underline" onClick={onPickImageModel} data-automation-id="burst-frame.pick-model">
            Seedance 2.5 I2V wählen
          </button>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="app-button app-secondary text-xs" disabled={!hasStart || busy || !analysisReady} onClick={() => void analyze()} data-automation-id="burst-frame.analyze" title={analysisReady ? 'Analysiert das Startbild mit Gemini' : 'Gemini-Schlüssel fehlt – Felder manuell ausfüllen'}>
          {busy ? 'Analysiere …' : 'Startbild analysieren'}
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
