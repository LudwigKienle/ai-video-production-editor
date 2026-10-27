import React, { useMemo, useState } from 'react';
import type { MediaItem, RecentProject, ReferenceItem, ShotPrompt, TimelineClip } from '../../types';
import AudioMasteringPanel, { type AudioMasteringSourceOption } from '../../components/AudioMasteringPanel';
import { AudioIcon, MusicNoteIcon, SparklesIcon, AddIcon, SearchIcon, PlayIcon } from '../../components/icons';
import { generateSpeechWithElevenLabs } from '../../services/elevenLabsService';
import {
  generateMusicWithLyria2,
  generateSpeechWithMinimax,
  separateAudioWithDemucs,
} from '../../services/replicateService';
import { generateMusicWithSonauto, hasSonautoApiKey } from '../../services/sonautoService';
import { fileToBase64, getBase64FromUrl } from '../../utils/helpers';
import type { LibraryAsset } from '../../hooks/useLibraryAssets';
import { formatTimecode } from '../../utils/timecode';

/**
 * Sound browser: AI generation (voice, music, SFX, stems), project and library
 * audio, and mastering. Moved unchanged in behaviour from the former Sound page;
 * shared by all three sound views.
 */

export interface SoundBrowserProps {
  mediaItems: MediaItem[];
  selectedClip: TimelineClip | null;
  onAddGeneratedMedia: (item: MediaItem) => void;
  onAddToTimeline?: (item: MediaItem) => void;
  apiKeyReady?: boolean;
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  library: { assets: LibraryAsset[]; isLoading: boolean; error: string | null };
}

type VoiceProvider = 'elevenlabs' | 'minimax';
type MusicProvider = 'lyria2' | 'sonauto-v3';
type BrowserTab = 'generate' | 'library' | 'master';
type GenerateTool = 'voice' | 'music' | 'sfx' | 'stems';

const GENERATE_TOOLS: Array<{ id: GenerateTool; label: string }> = [
  { id: 'voice', label: 'Stimme' },
  { id: 'music', label: 'Musik' },
  { id: 'sfx', label: 'SFX' },
  { id: 'stems', label: 'Stems' },
];


const SoundBrowser: React.FC<SoundBrowserProps> = (props) => {
  const {
    onAddGeneratedMedia,
    onAddToTimeline,
    apiKeyReady,
    mediaItems,
    selectedClip,
    currentProjectPath,
    library,
  } = props;

  const [browserTab, setBrowserTab] = useState<BrowserTab>('generate');
  const [generateTool, setGenerateTool] = useState<GenerateTool>('voice');

  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>('elevenlabs');
  const [voiceText, setVoiceText] = useState('');
  const [voiceId, setVoiceId] = useState('JBFqnCBsd6RMkjVDRZzb');
  const [voiceModelId, setVoiceModelId] = useState('eleven_multilingual_v2');
  const [voiceOutputFormat, setVoiceOutputFormat] = useState('mp3_44100_128');
  const [minimaxVoice, setMinimaxVoice] = useState('');
  const [minimaxSpeed, setMinimaxSpeed] = useState(1);

  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicDuration, setMusicDuration] = useState(20);
  const [musicProvider, setMusicProvider] = useState<MusicProvider>('lyria2');
  const [sonautoInstrumental, setSonautoInstrumental] = useState(true);
  const [sfxPrompt, setSfxPrompt] = useState('');
  const [sfxDuration, setSfxDuration] = useState(6);

  const [demucsFile, setDemucsFile] = useState<File | null>(null);
  const [demucsUrl, setDemucsUrl] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [placeOnTimeline, setPlaceOnTimeline] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [generated, setGenerated] = useState<MediaItem[]>([]);

  // loaded once by the Sound page (also serves the MCP tool sound_library_list)
  const { assets: libraryAssets, isLoading: libraryLoading, error: libraryError } = library;

  /* Library + mastering sources */
  const filteredLibraryAudio = useMemo(() => {
    const term = librarySearch.trim().toLowerCase();
    return libraryAssets.filter((asset) => {
      if (asset.kind !== 'audio' || !asset.url) return false;
      if (!term) return true;
      return asset.name.toLowerCase().includes(term) || asset.projectName.toLowerCase().includes(term);
    });
  }, [libraryAssets, librarySearch]);

  const projectAudio = useMemo(() => {
    const seen = new Set<string>();
    return [...generated, ...mediaItems.filter((item) => item.type === 'audio')].filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }, [generated, mediaItems]);

  const masteringAudioSources = useMemo<AudioMasteringSourceOption[]>(() => {
    const seen = new Set<string>();
    const sources: AudioMasteringSourceOption[] = [];
    projectAudio.forEach((item, index) => {
      if (seen.has(item.url)) return;
      seen.add(item.url);
      const detail = item.generatedBy || (item.source === 'generated' ? 'Generated audio' : 'Project audio');
      sources.push({ id: `project:${item.id || index}`, name: item.name || `Project audio ${index + 1}`, url: item.url, duration: item.duration, label: `${item.name || `Project audio ${index + 1}`} • ${detail}` });
    });
    libraryAssets.filter((asset) => asset.kind === 'audio' && asset.url).forEach((asset) => {
      if (!asset.url || seen.has(asset.url)) return;
      seen.add(asset.url);
      sources.push({ id: `library:${asset.id}`, name: asset.name, url: asset.url, duration: asset.duration, label: `${asset.name} • Library / ${asset.projectName}` });
    });
    return sources;
  }, [projectAudio, libraryAssets]);

  /* Generation handlers (unchanged behaviour, plus optional placement on the timeline) */
  const handleAddGenerated = (item: MediaItem, label?: string) => {
    const itemWithMeta = { ...item, generatedBy: label || item.generatedBy };
    if (placeOnTimeline && onAddToTimeline) onAddToTimeline(itemWithMeta);
    else onAddGeneratedMedia(itemWithMeta);
    setGenerated((prev) => [itemWithMeta, ...prev].slice(0, 12));
  };

  const handleGenerateVoice = async () => {
    if (!voiceText.trim()) { setStatus('Add voiceover text first.'); return; }
    if (voiceProvider === 'minimax' && apiKeyReady === false) { setStatus('Connect your API keys to generate with Replicate.'); return; }
    setIsRunning(true);
    setStatus('Generating voice…');
    try {
      if (voiceProvider === 'minimax') {
        const item = await generateSpeechWithMinimax(voiceText, { voice: minimaxVoice || undefined, speed: minimaxSpeed });
        handleAddGenerated(item, 'Minimax Speech 02 HD');
      } else {
        const item = await generateSpeechWithElevenLabs(voiceText, { voiceId, modelId: voiceModelId, outputFormat: voiceOutputFormat });
        handleAddGenerated(item, 'ElevenLabs Voiceover');
      }
      setStatus(placeOnTimeline ? 'Voice placed at the playhead.' : 'Voice added to the project.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Voice generation failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleGenerateMusic = async (kind: 'music' | 'sfx') => {
    const prompt = kind === 'music' ? musicPrompt : sfxPrompt;
    const duration = kind === 'music' ? musicDuration : sfxDuration;
    if (!prompt.trim()) { setStatus(`Add a ${kind} prompt first.`); return; }
    if (kind === 'music' && musicProvider === 'sonauto-v3' && !hasSonautoApiKey()) { setStatus('Add a Sonauto API key in Settings to generate with Sonauto.'); return; }
    if ((kind !== 'music' || musicProvider === 'lyria2') && apiKeyReady === false) { setStatus('Connect your API keys to generate audio.'); return; }
    setIsRunning(true);
    setStatus(kind === 'music' && musicProvider === 'sonauto-v3' ? 'Generating music with Sonauto…' : `Generating ${kind}…`);
    try {
      const item = kind === 'music' && musicProvider === 'sonauto-v3'
        ? await generateMusicWithSonauto(prompt, { instrumental: sonautoInstrumental, onStatus: (message) => setStatus(message) })
        : await generateMusicWithLyria2(prompt, { duration });
      handleAddGenerated(item, kind === 'music' ? (musicProvider === 'sonauto-v3' ? 'Sonauto v3 Music' : 'Lyria 2 Music') : 'Lyria 2 SFX');
      setStatus(`${kind === 'music' ? 'Music' : 'SFX'} ${placeOnTimeline ? 'placed at the playhead.' : 'added to the project.'}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${kind} generation failed.`);
    } finally {
      setIsRunning(false);
    }
  };

  const resolveDemucsPayload = async () => {
    if (demucsFile) {
      const base64 = await fileToBase64(demucsFile);
      return { base64, mimeType: demucsFile.type || 'audio/wav' };
    }
    const url = demucsUrl.trim();
    if (!url) return null;
    return getBase64FromUrl(url);
  };

  const handleDemucs = async () => {
    if (apiKeyReady === false) { setStatus('Connect your API keys to separate stems.'); return; }
    const payload = await resolveDemucsPayload();
    if (!payload) { setStatus('Choose an audio file, a library clip or the selected clip first.'); return; }
    setIsRunning(true);
    setStatus('Separating stems…');
    try {
      const stems = await separateAudioWithDemucs(payload);
      stems.forEach((item) => handleAddGenerated(item, 'Demucs Stem'));
      setStatus(`${stems.length} stems ${placeOnTimeline ? 'placed at the playhead.' : 'added to the project.'}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Stem separation failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const selectedClipMedia = selectedClip ? mediaItems.find((item) => item.id === selectedClip.mediaId) : null;
  const useSelectedClipForStems = () => {
    if (!selectedClipMedia) return;
    setDemucsUrl(selectedClipMedia.url);
    setDemucsFile(null);
    setStatus(`Using “${selectedClipMedia.name}” as the stem source.`);
  };

  /* ─── Browser (left) ─── */

  const generatePanel = (
    <div className="fl-gen">
      <div className="fl-gen__tools" role="tablist" aria-label="Generate">
        {GENERATE_TOOLS.map((tool) => (
          <button key={tool.id} type="button" data-automation-id={`sound-generate-tool-${tool.id}`} role="tab" aria-selected={generateTool === tool.id} className={`fl-gen__tool ${generateTool === tool.id ? 'fl-gen__tool--active' : ''}`} onClick={() => setGenerateTool(tool.id)}>{tool.label}</button>
        ))}
      </div>

      {generateTool === 'voice' && (
        <div className="fl-form">
          <select value={voiceProvider} onChange={(event) => setVoiceProvider(event.target.value as VoiceProvider)} className="app-select">
            <option value="elevenlabs">ElevenLabs</option>
            <option value="minimax">Minimax Speech 02 HD</option>
          </select>
          <textarea value={voiceText} onChange={(event) => setVoiceText(event.target.value)} placeholder="Was soll die Stimme sagen?" rows={5} className="app-textarea" />
          {voiceProvider === 'elevenlabs' ? (
            <details className="fl-form__advanced">
              <summary>Stimmeinstellungen</summary>
              <label>Voice ID<input value={voiceId} onChange={(event) => setVoiceId(event.target.value)} className="app-input" /></label>
              <label>Model<input value={voiceModelId} onChange={(event) => setVoiceModelId(event.target.value)} className="app-input" /></label>
              <label>Output<input value={voiceOutputFormat} onChange={(event) => setVoiceOutputFormat(event.target.value)} className="app-input" /></label>
            </details>
          ) : (
            <details className="fl-form__advanced">
              <summary>Stimmeinstellungen</summary>
              <label>Voice (optional)<input value={minimaxVoice} onChange={(event) => setMinimaxVoice(event.target.value)} className="app-input" /></label>
              <label>Speed · {minimaxSpeed.toFixed(2)}×<input type="range" min={0.5} max={1.5} step={0.05} value={minimaxSpeed} onChange={(event) => setMinimaxSpeed(Number(event.target.value))} /></label>
            </details>
          )}
          <button className="app-button app-primary w-full" data-automation-id="sound-generate-voice" onClick={handleGenerateVoice} disabled={isRunning}>{isRunning ? 'Erzeuge…' : 'Stimme erzeugen'}</button>
        </div>
      )}

      {generateTool === 'music' && (
        <div className="fl-form">
          <select value={musicProvider} onChange={(event) => setMusicProvider(event.target.value as MusicProvider)} className="app-select">
            <option value="lyria2">Google Lyria 2 · short cue</option>
            <option value="sonauto-v3">Sonauto v3 · full song</option>
          </select>
          <textarea value={musicPrompt} onChange={(event) => setMusicPrompt(event.target.value)} placeholder="Stil, Tempo, Stimmung, Instrumente…" rows={4} className="app-textarea" />
          {musicProvider === 'lyria2' ? (
            <label className="fl-form__inline">Dauer<input type="number" min={4} max={120} value={musicDuration} onChange={(event) => setMusicDuration(Number(event.target.value) || 20)} className="app-input" /><span>s</span></label>
          ) : (
            <label className="fl-form__check"><input type="checkbox" checked={sonautoInstrumental} onChange={(event) => setSonautoInstrumental(event.target.checked)} />Instrumental</label>
          )}
          <button className="app-button app-primary w-full" data-automation-id="sound-generate-music" onClick={() => handleGenerateMusic('music')} disabled={isRunning}>{isRunning ? 'Erzeuge…' : 'Musik erzeugen'}</button>
        </div>
      )}

      {generateTool === 'sfx' && (
        <div className="fl-form">
          <textarea value={sfxPrompt} onChange={(event) => setSfxPrompt(event.target.value)} placeholder="Whoosh, Einschlag, Regen auf Blechdach…" rows={4} className="app-textarea" />
          <label className="fl-form__inline">Dauer<input type="number" min={2} max={60} value={sfxDuration} onChange={(event) => setSfxDuration(Number(event.target.value) || 6)} className="app-input" /><span>s</span></label>
          <button className="app-button app-primary w-full" data-automation-id="sound-generate-sfx" onClick={() => handleGenerateMusic('sfx')} disabled={isRunning}>{isRunning ? 'Erzeuge…' : 'SFX erzeugen'}</button>
        </div>
      )}

      {generateTool === 'stems' && (
        <div className="fl-form">
          <p className="fl-form__hint">Split a mix into vocals, drums, bass and other with Demucs.</p>
          {selectedClipMedia && (selectedClipMedia.type === 'audio' || selectedClipMedia.type === 'video') && (
            <button type="button" className="edit-text-btn edit-text-btn--outline w-full justify-center" onClick={useSelectedClipForStems}>Use selected clip · {selectedClipMedia.name}</button>
          )}
          <label className="fl-form__file">
            <span>{demucsFile ? demucsFile.name : 'Choose an audio file'}</span>
            <input type="file" accept="audio/*" onChange={(event) => { setDemucsFile(event.target.files?.[0] || null); if (event.target.files?.[0]) setDemucsUrl(''); }} />
          </label>
          <input value={demucsUrl} onChange={(event) => { setDemucsUrl(event.target.value); if (event.target.value) setDemucsFile(null); }} placeholder="…or paste an audio URL" className="app-input" />
          <button className="app-button app-primary w-full" data-automation-id="sound-generate-stems" onClick={handleDemucs} disabled={isRunning}>{isRunning ? 'Trenne…' : 'Stems trennen'}</button>
        </div>
      )}

      <label className="fl-form__check fl-gen__place">
        <input type="checkbox" checked={placeOnTimeline} onChange={(event) => setPlaceOnTimeline(event.target.checked)} disabled={!onAddToTimeline} />
        Ergebnis an der Abspielposition in die Timeline legen
      </label>
    </div>
  );

  const libraryPanel = (
    <div className="fl-library">
      <label className="fx-search">
        <SearchIcon className="fx-search__icon" />
        <input type="search" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Audio suchen" aria-label="Search audio" />
      </label>
      {libraryError && <div className="fl-form__hint" style={{ color: 'var(--app-warm)' }}>{libraryError}</div>}
      <div className="fl-library__section">Projekt</div>
      <div className="fl-library__list">
        {projectAudio.map((item) => (
          <div key={item.id} className="fl-library__item">
            <div className="fl-library__item-head">
              <AudioIcon className="w-3.5 h-3.5" />
              <span title={item.name}>{item.name}</span>
              {item.duration ? <small>{formatTimecode(item.duration).slice(3)}</small> : null}
            </div>
            <audio controls preload="none" src={item.url} />
            <div className="fl-library__item-actions">
              {onAddToTimeline && <button type="button" className="edit-text-btn edit-text-btn--primary" onClick={() => onAddToTimeline(item)}><AddIcon className="w-3 h-3" />Timeline</button>}
              <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => { setDemucsUrl(item.url); setDemucsFile(null); setBrowserTab('generate'); setGenerateTool('stems'); }}>Stems</button>
            </div>
          </div>
        ))}
        {projectAudio.length === 0 && <div className="fl-form__hint">No audio in this project yet — generate some or import it on the Media page.</div>}
      </div>
      <div className="fl-library__section">Bibliothek</div>
      <div className="fl-library__list">
        {filteredLibraryAudio.map((asset) => (
          <button key={asset.id} type="button" className="fl-library__asset" onClick={() => { if (asset.url) { setDemucsUrl(asset.url); setDemucsFile(null); } }} title="Use as stem source">
            <PlayIcon className="w-3 h-3" />
            <span>
              <strong>{asset.name}</strong>
              <small>{asset.projectName}</small>
            </span>
          </button>
        ))}
        {filteredLibraryAudio.length === 0 && !libraryLoading && <div className="fl-form__hint">No library audio found.</div>}
        {libraryLoading && <div className="fl-form__hint">Loading library…</div>}
      </div>
    </div>
  );

  const left = (
    <div className="fl-browser">
      <div className="fl-browser__tabs edit-seg" role="tablist" aria-label="Sound browser">
        {([
          { id: 'generate', label: 'Erzeugen', icon: SparklesIcon },
          { id: 'library', label: 'Bibliothek', icon: AudioIcon },
          { id: 'master', label: 'Mastering', icon: MusicNoteIcon },
        ] as Array<{ id: BrowserTab; label: string; icon: React.FC<{ className?: string }> }>).map((tab) => (
          <button key={tab.id} type="button" data-automation-id={`sound-browser-tab-${tab.id}`} role="tab" aria-selected={browserTab === tab.id} className={`edit-seg__item ${browserTab === tab.id ? 'edit-seg__item--active' : ''}`} onClick={() => setBrowserTab(tab.id)}>
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </div>
      <div className="fl-browser__body">
        {browserTab === 'generate' && generatePanel}
        {browserTab === 'library' && libraryPanel}
        {browserTab === 'master' && (
          <div className="fl-master">
            <AudioMasteringPanel audioSources={masteringAudioSources} currentProjectPath={currentProjectPath} onAddGeneratedMedia={handleAddGenerated} />
          </div>
        )}
      </div>
      {status && <div className="fl-browser__status" role="status">{status}</div>}
    </div>
  );

  return left;
};

export default SoundBrowser;
