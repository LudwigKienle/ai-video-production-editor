import React, { useMemo, useState } from 'react';
import { MediaItem, RecentProject, ReferenceItem, ShotPrompt, TimelineClip, TimelineTrack } from '../types';
import AudioMasteringPanel, { type AudioMasteringSourceOption } from '../components/AudioMasteringPanel';
import EditorPageShell, { type SharedSequenceProps } from '../components/EditorPageShell';
import { AudioIcon, MusicNoteIcon, SparklesIcon, AddIcon, LockIcon, UnlockIcon, SearchIcon, PlayIcon } from '../components/icons';
import { generateSpeechWithElevenLabs } from '../services/elevenLabsService';
import {
  generateMusicWithLyria2,
  generateSpeechWithMinimax,
  separateAudioWithDemucs,
} from '../services/replicateService';
import { generateMusicWithSonauto, hasSonautoApiKey } from '../services/sonautoService';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import { useLibraryAssets } from '../hooks/useLibraryAssets';
import { formatTimecode } from '../utils/timecode';

/**
 * Fairlight page — the shared timeline is the centre of the page, the mixer
 * on the right reads and writes the same tracks and clips, and generation
 * tools live in the browser on the left so new audio lands straight on the cut.
 */

interface SoundWorkspaceProps extends SharedSequenceProps {
  onAddGeneratedMedia: (item: MediaItem) => void;
  /** Places a generated clip on the timeline at the playhead. */
  onAddToTimeline?: (item: MediaItem) => void;
  apiKeyReady?: boolean;
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  onSwitchToEdit?: () => void;
}

type VoiceProvider = 'elevenlabs' | 'minimax';
type MusicProvider = 'lyria2' | 'sonauto-v3';
type BrowserTab = 'generate' | 'library' | 'master';
type GenerateTool = 'voice' | 'music' | 'sfx' | 'stems';

const GENERATE_TOOLS: Array<{ id: GenerateTool; label: string }> = [
  { id: 'voice', label: 'Voice' },
  { id: 'music', label: 'Music' },
  { id: 'sfx', label: 'SFX' },
  { id: 'stems', label: 'Stems' },
];

const toDb = (gain: number) => (gain <= 0.001 ? '-∞' : `${(20 * Math.log10(gain)).toFixed(1)}`);

/* ─── Mixer ─── */

type StripModel = {
  track: TimelineTrack;
  clips: TimelineClip[];
  gain: number;
  level: number;
  hasAudio: boolean;
};

const Meter: React.FC<{ level: number; muted?: boolean }> = ({ level, muted }) => (
  <div className={`fl-meter ${muted ? 'fl-meter--muted' : ''}`} aria-hidden="true">
    <div className="fl-meter__fill" style={{ height: `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%` }} />
    <div className="fl-meter__ticks"><span /><span /><span /><span /></div>
  </div>
);

const ChannelStrip: React.FC<{
  strip: StripModel;
  anySolo: boolean;
  selectedClip: TimelineClip | null;
  mediaItems: MediaItem[];
  onGain: (gain: number) => void;
  onToggle: (updates: Partial<Omit<TimelineTrack, 'id' | 'type'>>) => void;
  onClipGain: (clip: TimelineClip, gain: number) => void;
}> = ({ strip, anySolo, selectedClip, mediaItems, onGain, onToggle, onClipGain }) => {
  const { track, clips, gain, level } = strip;
  const silenced = track.isMuted || (anySolo && !track.isSolo);
  const clipOnTrack = selectedClip && selectedClip.trackId === track.id ? selectedClip : null;
  const clipMedia = clipOnTrack ? mediaItems.find((item) => item.id === clipOnTrack.mediaId) : null;
  const clipGain = clipOnTrack ? (clipOnTrack.volume ?? 1) : 1;
  return (
    <div className={`fl-strip ${silenced ? 'fl-strip--silent' : ''} ${clipOnTrack ? 'fl-strip--focus' : ''}`}>
      <div className="fl-strip__name" title={track.name || track.id}>
        <span className={`fl-strip__badge fl-strip__badge--${track.type}`}>{track.type === 'audio' ? 'A' : 'V'}</span>
        <span>{track.name || (track.type === 'audio' ? 'Audio' : 'Video')}</span>
      </div>
      <div className="fl-strip__toggles">
        <button type="button" className={`fl-toggle ${track.isMuted ? 'fl-toggle--mute' : ''}`} onClick={() => onToggle({ isMuted: !track.isMuted })} title="Mute">M</button>
        <button type="button" className={`fl-toggle ${track.isSolo ? 'fl-toggle--solo' : ''}`} onClick={() => onToggle({ isSolo: !(track.isSolo ?? false) })} title="Solo">S</button>
        <button type="button" className={`fl-toggle ${track.isLocked ? 'fl-toggle--lock' : ''}`} onClick={() => onToggle({ isLocked: !track.isLocked })} title={track.isLocked ? 'Unlock track' : 'Lock track'}>
          {track.isLocked ? <LockIcon className="w-3 h-3" /> : <UnlockIcon className="w-3 h-3" />}
        </button>
      </div>
      <div className="fl-strip__fader">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={gain}
          disabled={clips.length === 0 || track.isLocked}
          onChange={(event) => onGain(Number(event.target.value))}
          onDoubleClick={() => onGain(1)}
          aria-label={`${track.name || track.id} level`}
          title="Drag to set the level of every clip on this track · double-click resets to 0 dB"
          className="fl-fader"
        />
        <Meter level={silenced ? 0 : level} muted={silenced} />
      </div>
      <div className="fl-strip__db" title="Track level (applied to all clips on the track)">{toDb(gain)}<small>dB</small></div>
      <div className="fl-strip__count">{clips.length === 0 ? 'empty' : `${clips.length} clip${clips.length === 1 ? '' : 's'}`}</div>
      {clipOnTrack && (
        <div className="fl-strip__clip">
          <div className="fl-strip__clip-name" title={clipMedia?.name}>{clipMedia?.name || 'Clip'}</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clipGain}
            onChange={(event) => onClipGain(clipOnTrack, Number(event.target.value))}
            onDoubleClick={() => onClipGain(clipOnTrack, 1)}
            aria-label="Selected clip gain"
            className="fl-clip-fader"
          />
          <div className="fl-strip__clip-db">Clip {toDb(clipGain)} dB</div>
        </div>
      )}
    </div>
  );
};

/* ─── Page ─── */

const SoundWorkspace: React.FC<SoundWorkspaceProps> = (props) => {
  const {
    onAddGeneratedMedia,
    onAddToTimeline,
    apiKeyReady,
    mediaItems,
    timelineClips,
    timelineTracks,
    selectedClipId,
    playheadPosition,
    waveformCache,
    references = [],
    shotPrompts = [],
    recentProjects = [],
    currentProjectName,
    currentProjectPath,
    onUpdateClip,
    onBatchUpdateClips,
    onUpdateTrack,
    onAddTrack,
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

  const { assets: libraryAssets, isLoading: libraryLoading, error: libraryError } = useLibraryAssets({
    currentProjectName,
    currentProjectPath,
    mediaItems,
    references,
    shotPrompts,
    recentProjects,
  });

  const selectedClip = useMemo(() => timelineClips.find((clip) => clip.id === selectedClipId) || null, [timelineClips, selectedClipId]);

  /* Mixer model: one strip per track that can carry sound (audio tracks, plus video tracks holding video clips). */
  const strips = useMemo<StripModel[]>(() => {
    return timelineTracks
      .map((track) => {
        const clips = timelineClips.filter((clip) => clip.trackId === track.id);
        const audible = clips.filter((clip) => {
          const media = mediaItems.find((item) => item.id === clip.mediaId);
          return media && (media.type === 'audio' || media.type === 'video');
        });
        const hasAudio = track.type === 'audio' || audible.length > 0;
        const gain = audible.length > 0 ? audible.reduce((sum, clip) => sum + (clip.volume ?? 1), 0) / audible.length : 1;
        const under = audible.find((clip) => playheadPosition >= clip.start && playheadPosition < clip.end);
        let level = 0;
        if (under) {
          const media = mediaItems.find((item) => item.id === under.mediaId);
          const waveform = media ? waveformCache[media.id] : undefined;
          if (media && waveform && waveform.length > 0) {
            const sourceDuration = media.duration || under.duration || (under.end - under.start) || 1;
            const sourcePos = (under.sourceIn ?? 0) + (playheadPosition - under.start) * (under.speed || 1);
            const index = Math.max(0, Math.min(waveform.length - 1, Math.floor((sourcePos / sourceDuration) * waveform.length)));
            level = (waveform[index] || 0) * (under.volume ?? 1);
          } else {
            // No analysed waveform yet: show a steady "signal present" level scaled by gain.
            level = 0.35 * (under.volume ?? 1);
          }
        }
        return { track, clips: audible, gain, level, hasAudio };
      })
      .filter((strip) => strip.hasAudio);
  }, [timelineTracks, timelineClips, mediaItems, playheadPosition, waveformCache]);

  const anySolo = strips.some((strip) => strip.track.isSolo);
  const mainLevel = strips.reduce((max, strip) => {
    const silenced = strip.track.isMuted || (anySolo && !strip.track.isSolo);
    return Math.max(max, silenced ? 0 : strip.level);
  }, 0);

  const setTrackGain = (strip: StripModel, gain: number) => {
    if (strip.clips.length === 0) return;
    onBatchUpdateClips(strip.clips.map((clip) => ({ ...clip, volume: gain })));
  };

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
          <button key={tool.id} type="button" role="tab" aria-selected={generateTool === tool.id} className={`fl-gen__tool ${generateTool === tool.id ? 'fl-gen__tool--active' : ''}`} onClick={() => setGenerateTool(tool.id)}>{tool.label}</button>
        ))}
      </div>

      {generateTool === 'voice' && (
        <div className="fl-form">
          <select value={voiceProvider} onChange={(event) => setVoiceProvider(event.target.value as VoiceProvider)} className="app-select">
            <option value="elevenlabs">ElevenLabs</option>
            <option value="minimax">Minimax Speech 02 HD</option>
          </select>
          <textarea value={voiceText} onChange={(event) => setVoiceText(event.target.value)} placeholder="What should the voice say?" rows={5} className="app-textarea" />
          {voiceProvider === 'elevenlabs' ? (
            <details className="fl-form__advanced">
              <summary>Voice settings</summary>
              <label>Voice ID<input value={voiceId} onChange={(event) => setVoiceId(event.target.value)} className="app-input" /></label>
              <label>Model<input value={voiceModelId} onChange={(event) => setVoiceModelId(event.target.value)} className="app-input" /></label>
              <label>Output<input value={voiceOutputFormat} onChange={(event) => setVoiceOutputFormat(event.target.value)} className="app-input" /></label>
            </details>
          ) : (
            <details className="fl-form__advanced">
              <summary>Voice settings</summary>
              <label>Voice (optional)<input value={minimaxVoice} onChange={(event) => setMinimaxVoice(event.target.value)} className="app-input" /></label>
              <label>Speed · {minimaxSpeed.toFixed(2)}×<input type="range" min={0.5} max={1.5} step={0.05} value={minimaxSpeed} onChange={(event) => setMinimaxSpeed(Number(event.target.value))} /></label>
            </details>
          )}
          <button className="app-button app-primary w-full" onClick={handleGenerateVoice} disabled={isRunning}>{isRunning ? 'Generating…' : 'Generate voice'}</button>
        </div>
      )}

      {generateTool === 'music' && (
        <div className="fl-form">
          <select value={musicProvider} onChange={(event) => setMusicProvider(event.target.value as MusicProvider)} className="app-select">
            <option value="lyria2">Google Lyria 2 · short cue</option>
            <option value="sonauto-v3">Sonauto v3 · full song</option>
          </select>
          <textarea value={musicPrompt} onChange={(event) => setMusicPrompt(event.target.value)} placeholder="Style, tempo, mood, instruments…" rows={4} className="app-textarea" />
          {musicProvider === 'lyria2' ? (
            <label className="fl-form__inline">Duration<input type="number" min={4} max={120} value={musicDuration} onChange={(event) => setMusicDuration(Number(event.target.value) || 20)} className="app-input" /><span>s</span></label>
          ) : (
            <label className="fl-form__check"><input type="checkbox" checked={sonautoInstrumental} onChange={(event) => setSonautoInstrumental(event.target.checked)} />Instrumental</label>
          )}
          <button className="app-button app-primary w-full" onClick={() => handleGenerateMusic('music')} disabled={isRunning}>{isRunning ? 'Generating…' : 'Generate music'}</button>
        </div>
      )}

      {generateTool === 'sfx' && (
        <div className="fl-form">
          <textarea value={sfxPrompt} onChange={(event) => setSfxPrompt(event.target.value)} placeholder="Whoosh, impact, rain on a tin roof…" rows={4} className="app-textarea" />
          <label className="fl-form__inline">Duration<input type="number" min={2} max={60} value={sfxDuration} onChange={(event) => setSfxDuration(Number(event.target.value) || 6)} className="app-input" /><span>s</span></label>
          <button className="app-button app-primary w-full" onClick={() => handleGenerateMusic('sfx')} disabled={isRunning}>{isRunning ? 'Generating…' : 'Generate SFX'}</button>
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
          <button className="app-button app-primary w-full" onClick={handleDemucs} disabled={isRunning}>{isRunning ? 'Separating…' : 'Separate stems'}</button>
        </div>
      )}

      <label className="fl-form__check fl-gen__place">
        <input type="checkbox" checked={placeOnTimeline} onChange={(event) => setPlaceOnTimeline(event.target.checked)} disabled={!onAddToTimeline} />
        Place result on the timeline at the playhead
      </label>
    </div>
  );

  const libraryPanel = (
    <div className="fl-library">
      <label className="fx-search">
        <SearchIcon className="fx-search__icon" />
        <input type="search" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Search audio" aria-label="Search audio" />
      </label>
      {libraryError && <div className="fl-form__hint" style={{ color: 'var(--app-warm)' }}>{libraryError}</div>}
      <div className="fl-library__section">Project</div>
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
      <div className="fl-library__section">Library</div>
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
          { id: 'generate', label: 'Generate', icon: SparklesIcon },
          { id: 'library', label: 'Library', icon: AudioIcon },
          { id: 'master', label: 'Master', icon: MusicNoteIcon },
        ] as Array<{ id: BrowserTab; label: string; icon: React.FC<{ className?: string }> }>).map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={browserTab === tab.id} className={`edit-seg__item ${browserTab === tab.id ? 'edit-seg__item--active' : ''}`} onClick={() => setBrowserTab(tab.id)}>
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

  /* ─── Mixer (right) ─── */

  const right = (
    <div className="fl-mixer">
      <div className="fl-mixer__header">
        <span>Mixer</span>
        <button type="button" className="edit-icon-btn" onClick={() => onAddTrack('audio')} title="Add audio track"><AddIcon className="w-3.5 h-3.5" /></button>
      </div>
      <div className="fl-mixer__strips">
        {strips.map((strip) => (
          <ChannelStrip
            key={strip.track.id}
            strip={strip}
            anySolo={anySolo}
            selectedClip={selectedClip}
            mediaItems={mediaItems}
            onGain={(gain) => setTrackGain(strip, gain)}
            onToggle={(updates) => onUpdateTrack(strip.track.id, updates)}
            onClipGain={(clip, gain) => onUpdateClip({ ...clip, volume: gain })}
          />
        ))}
        <div className="fl-strip fl-strip--main">
          <div className="fl-strip__name"><span className="fl-strip__badge fl-strip__badge--main">M</span><span>Main</span></div>
          <div className="fl-strip__toggles" aria-hidden="true" />
          <div className="fl-strip__fader fl-strip__fader--meter-only">
            <Meter level={mainLevel} />
          </div>
          <div className="fl-strip__db">{toDb(mainLevel)}<small>pk</small></div>
          <div className="fl-strip__count">{formatTimecode(playheadPosition)}</div>
        </div>
        {strips.length === 0 && (
          <div className="fl-mixer__empty">
            <MusicNoteIcon className="w-5 h-5" />
            <strong>No audio on the timeline</strong>
            <span>Generate a voice, music or SFX on the left, or add an audio track and drop clips on it.</span>
          </div>
        )}
      </div>
    </div>
  );

  const audioClipCount = strips.reduce((sum, strip) => sum + strip.clips.length, 0);
  const toolbar = (
    <div className="edit-toolbar__group">
      <span style={{ color: 'var(--app-accent-strong)' }}><MusicNoteIcon className="w-4 h-4" /></span>
      <span className="text-sm font-semibold">Fairlight</span>
      <span className="edit-toolbar__hint">{strips.length} track{strips.length === 1 ? '' : 's'} · {audioClipCount} audio clip{audioClipCount === 1 ? '' : 's'} · faders write clip volume on the shared timeline</span>
    </div>
  );

  return (
    <EditorPageShell
      {...props}
      page="fairlight"
      toolbar={toolbar}
      left={left}
      right={right}
      transportPlacement="viewer"
      onSwitchToEdit={props.onSwitchToEdit}
    />
  );
};

export default SoundWorkspace;
