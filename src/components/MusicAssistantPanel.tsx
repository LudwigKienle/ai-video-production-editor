import React, { useState } from 'react';
import { MediaItem, TimelineClip } from '../types';
import { generateMusicPromptForTimeline } from '../services/geminiService';
import { generateSpeechWithElevenLabs } from '../services/elevenLabsService';
import { generateMusicWithLyria2 } from '../services/replicateService';
import { MusicNoteIcon, SparklesIcon } from './icons';

interface MusicAssistantPanelProps {
  timelineClips: TimelineClip[];
  mediaItems: MediaItem[];
  onAddGeneratedMedia: (item: MediaItem) => void;
  apiKeyReady: boolean;
}

/**
 * Three steps, top to bottom: read the cut → refine the brief → generate.
 * The brief is the only thing the user has to write; everything else is one click.
 */
const MusicAssistantPanel: React.FC<MusicAssistantPanelProps> = ({ timelineClips, mediaItems, onAddGeneratedMedia, apiKeyReady }) => {
  const [prompt, setPrompt] = useState('');
  const [mood, setMood] = useState('');
  const [analysedDuration, setAnalysedDuration] = useState<number | null>(null);
  const [duration, setDuration] = useState(20);
  const [bpm, setBpm] = useState<number | null>(null);
  const [instruments, setInstruments] = useState<string[]>([]);
  const [mixNotes, setMixNotes] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState<'music' | 'voice' | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger' | 'info'; text: string } | null>(null);
  const [voiceId, setVoiceId] = useState('JBFqnCBsd6RMkjVDRZzb');
  const [modelId, setModelId] = useState('eleven_multilingual_v2');
  const [outputFormat, setOutputFormat] = useState('mp3_44100_128');

  const sequenceDuration = timelineClips.reduce((max, clip) => Math.max(max, clip.end), 0);
  const hasBrief = prompt.trim().length > 0;
  const step = !hasBrief ? 1 : 2;

  const handleAnalyze = async () => {
    if (!apiKeyReady) return setStatus({ tone: 'danger', text: 'Add a Google Gemini API key in Settings first.' });
    if (timelineClips.length === 0) return setStatus({ tone: 'danger', text: 'Put some clips on the timeline first.' });
    setStatus({ tone: 'info', text: 'Reading the cut…' });
    setIsAnalyzing(true);
    try {
      const result = await generateMusicPromptForTimeline(timelineClips, mediaItems);
      setPrompt(result.prompt);
      setMood(result.mood);
      setAnalysedDuration(result.duration);
      if (result.duration) setDuration(Math.max(4, Math.min(120, Math.round(result.duration))));
      setBpm(typeof result.bpm === 'number' ? result.bpm : null);
      setInstruments(result.instruments || []);
      setMixNotes(result.mixNotes || '');
      setStatus({ tone: 'ok', text: 'Brief written from the timeline — adjust it, then generate.' });
    } catch (e) {
      setStatus({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateMusic = async () => {
    if (!hasBrief) return setStatus({ tone: 'danger', text: 'Write or generate a brief first.' });
    if (!apiKeyReady) return setStatus({ tone: 'danger', text: 'Connect your API keys to generate music.' });
    setIsGenerating('music');
    setStatus({ tone: 'info', text: `Composing ${duration}s with Lyria 2…` });
    try {
      const item = await generateMusicWithLyria2(prompt, { duration });
      onAddGeneratedMedia({ ...item, generatedBy: item.generatedBy || 'Lyria 2 Music' });
      setStatus({ tone: 'ok', text: 'Music added to the media pool — drag it onto an audio track.' });
    } catch (e) {
      setStatus({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsGenerating(null);
    }
  };

  const handleGenerateVoice = async () => {
    if (!hasBrief) return setStatus({ tone: 'danger', text: 'Write or generate a brief first.' });
    setIsGenerating('voice');
    setStatus({ tone: 'info', text: 'Recording voiceover with ElevenLabs…' });
    try {
      const item = await generateSpeechWithElevenLabs(prompt, { voiceId, modelId, outputFormat });
      onAddGeneratedMedia({ ...item, generatedBy: item.generatedBy || 'ElevenLabs Voiceover' });
      setStatus({ tone: 'ok', text: 'Voiceover added to the media pool.' });
    } catch (e) {
      setStatus({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsGenerating(null);
    }
  };

  return (
    <div className="fx-browser">
      <div className="fx-browser__header">
        <h3 className="fx-browser__title">Music</h3>
        <span className={`pk-chip ${apiKeyReady ? 'pk-chip--ok' : 'pk-chip--warn'}`}>{apiKeyReady ? 'AI ready' : 'No API key'}</span>
      </div>

      <div className="fx-browser__scroll">
        <div className="pk-steps">
          <div className={`pk-step ${hasBrief ? 'pk-step--done' : 'pk-step--active'}`}>
            <span className="pk-step__num">1</span>
            <div className="pk-step__body">
              <span className="pk-step__title">Read the cut</span>
              <p className="pk-hint">Gemini watches the timeline and writes a music brief: mood, tempo, instruments, length.</p>
              <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={handleAnalyze} disabled={isAnalyzing || timelineClips.length === 0}>
                <SparklesIcon className="w-3.5 h-3.5" />
                {isAnalyzing ? 'Reading…' : hasBrief ? 'Read again' : 'Analyze timeline'}
              </button>
              {timelineClips.length === 0 && <p className="pk-hint">The timeline is empty — you can still write a brief by hand below.</p>}
            </div>
          </div>

          <div className={`pk-step ${step === 2 ? 'pk-step--active' : ''}`}>
            <span className="pk-step__num">2</span>
            <div className="pk-step__body">
              <span className="pk-step__title">Refine the brief</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={5}
                placeholder="Warm acoustic guitar, slow build, hopeful — or let step 1 write it for you."
                aria-label="Music brief"
              />
              {(mood || bpm || instruments.length > 0 || analysedDuration) && (
                <div className="pk-chips">
                  {mood && <span className="pk-chip">Mood <strong>{mood}</strong></span>}
                  {bpm ? <span className="pk-chip">Tempo <strong>{bpm} bpm</strong></span> : null}
                  {analysedDuration ? <span className="pk-chip">Cut <strong>{analysedDuration.toFixed(1)}s</strong></span> : null}
                  {instruments.slice(0, 4).map((name) => <span key={name} className="pk-chip">{name}</span>)}
                </div>
              )}
              {mixNotes && <p className="pk-hint">Mix notes: {mixNotes}</p>}
            </div>
          </div>

          <div className={`pk-step ${hasBrief ? 'pk-step--active' : ''}`}>
            <span className="pk-step__num">3</span>
            <div className="pk-step__body">
              <span className="pk-step__title">Generate</span>
              <label className="pk-inline">
                Length
                <input type="number" min={4} max={120} value={duration} onChange={(event) => setDuration(Math.max(4, Math.min(120, Number(event.target.value) || 20)))} />
                s
                {sequenceDuration > 0 && (
                  <button type="button" className="edit-text-btn" onClick={() => setDuration(Math.max(4, Math.min(120, Math.round(sequenceDuration))))} title="Match the sequence length">
                    Match cut ({Math.round(sequenceDuration)}s)
                  </button>
                )}
              </label>
              <button type="button" className="edit-text-btn edit-text-btn--primary w-full justify-center" onClick={handleGenerateMusic} disabled={!hasBrief || isGenerating !== null}>
                <MusicNoteIcon className="w-3.5 h-3.5" />
                {isGenerating === 'music' ? 'Composing…' : 'Generate music · Lyria 2'}
              </button>
              <details className="pk-details">
                <summary>Read the brief as a voiceover<small>ElevenLabs</small></summary>
                <div className="pk-details__body">
                  <label className="pk-field"><span>Voice ID</span><input value={voiceId} onChange={(event) => setVoiceId(event.target.value)} /></label>
                  <label className="pk-field"><span>Model</span><input value={modelId} onChange={(event) => setModelId(event.target.value)} /></label>
                  <label className="pk-field"><span>Output</span><input value={outputFormat} onChange={(event) => setOutputFormat(event.target.value)} /></label>
                  <button type="button" className="edit-text-btn edit-text-btn--outline w-full justify-center" onClick={handleGenerateVoice} disabled={!hasBrief || isGenerating !== null}>
                    {isGenerating === 'voice' ? 'Recording…' : 'Generate voiceover'}
                  </button>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>

      <footer className="fx-browser__footer">
        {status ? (
          <span style={{ color: status.tone === 'danger' ? 'var(--app-danger)' : status.tone === 'ok' ? 'var(--app-success)' : undefined }}>{status.text}</span>
        ) : (
          <span>Generated audio lands in the media pool, ready to drag onto an audio track.</span>
        )}
      </footer>
    </div>
  );
};

export default MusicAssistantPanel;
