import React, { useMemo, useState } from 'react';
import { MediaItem, RecentProject, ReferenceItem, ShotPrompt } from '../types';
import AudioMasteringPanel, { type AudioMasteringSourceOption } from '../components/AudioMasteringPanel';
import { AudioIcon, MusicNoteIcon, SparklesIcon } from '../components/icons';
import { generateSpeechWithElevenLabs } from '../services/elevenLabsService';
import {
  generateMusicWithLyria2,
  generateSpeechWithMinimax,
  separateAudioWithDemucs,
} from '../services/replicateService';
import { generateMusicWithSonauto, hasSonautoApiKey } from '../services/sonautoService';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import { useLibraryAssets } from '../hooks/useLibraryAssets';

interface SoundWorkspaceProps {
  onAddGeneratedMedia: (item: MediaItem) => void;
  apiKeyReady?: boolean;
  mediaItems?: MediaItem[];
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
}

type VoiceProvider = 'elevenlabs' | 'minimax';
type MusicProvider = 'lyria2' | 'sonauto-v3';

const SoundWorkspace: React.FC<SoundWorkspaceProps> = ({
  onAddGeneratedMedia,
  apiKeyReady,
  mediaItems = [],
  references = [],
  shotPrompts = [],
  recentProjects = [],
  currentProjectName,
  currentProjectPath,
}) => {
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

  const latestAudio = useMemo(() => {
    const projectAudio = mediaItems.filter((item) => item.type === 'audio');
    const combined = [...generated, ...projectAudio];
    const seen = new Set<string>();
    const unique: MediaItem[] = [];
    for (const item of combined) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      unique.push(item);
    }
    return unique.slice(0, 12);
  }, [generated, mediaItems]);

  const filteredLibraryAudio = useMemo(() => {
    const term = librarySearch.trim().toLowerCase();
    return libraryAssets.filter((asset) => {
      if (asset.kind !== 'audio' || !asset.url) return false;
      if (!term) return true;
      return asset.name.toLowerCase().includes(term) || asset.projectName.toLowerCase().includes(term);
    });
  }, [libraryAssets, librarySearch]);

  const masteringAudioSources = useMemo<AudioMasteringSourceOption[]>(() => {
    const seen = new Set<string>();
    const sources: AudioMasteringSourceOption[] = [];

    [...generated, ...mediaItems]
      .filter((item) => item.type === 'audio' && item.url)
      .forEach((item, index) => {
        if (!item.url || seen.has(item.url)) return;
        seen.add(item.url);
        const detail = item.generatedBy || (item.source === 'generated' ? 'Generated audio' : 'Project audio');
        sources.push({
          id: `project:${item.id || index}`,
          name: item.name || `Project audio ${index + 1}`,
          url: item.url,
          duration: item.duration,
          label: `${item.name || `Project audio ${index + 1}`} • ${detail}`,
        });
      });

    libraryAssets
      .filter((asset) => asset.kind === 'audio' && asset.url)
      .forEach((asset) => {
        if (!asset.url || seen.has(asset.url)) return;
        seen.add(asset.url);
        sources.push({
          id: `library:${asset.id}`,
          name: asset.name,
          url: asset.url,
          duration: asset.duration,
          label: `${asset.name} • Library / ${asset.projectName}`,
        });
      });

    return sources;
  }, [generated, libraryAssets, mediaItems]);

  const handleAddGenerated = (item: MediaItem, label?: string) => {
    const itemWithMeta = { ...item, generatedBy: label || item.generatedBy };
    onAddGeneratedMedia(itemWithMeta);
    setGenerated((prev) => [itemWithMeta, ...prev].slice(0, 12));
  };

  const handleGenerateVoice = async () => {
    if (!voiceText.trim()) {
      setStatus('Add voiceover text first.');
      return;
    }
    if (voiceProvider === 'minimax' && apiKeyReady === false) {
      setStatus('Connect your API keys to generate with Replicate.');
      return;
    }
    setIsRunning(true);
    setStatus('Generating voice...');
    try {
      let item: MediaItem;
      if (voiceProvider === 'minimax') {
        item = await generateSpeechWithMinimax(voiceText, {
          voice: minimaxVoice || undefined,
          speed: minimaxSpeed,
        });
        handleAddGenerated(item, 'Minimax Speech 02 HD');
      } else {
        item = await generateSpeechWithElevenLabs(voiceText, {
          voiceId,
          modelId: voiceModelId,
          outputFormat: voiceOutputFormat,
        });
        handleAddGenerated(item, 'ElevenLabs Voiceover');
      }
      setStatus('Voice generated and added to the project.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Voice generation failed.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleGenerateMusic = async (kind: 'music' | 'sfx') => {
    const prompt = kind === 'music' ? musicPrompt : sfxPrompt;
    const duration = kind === 'music' ? musicDuration : sfxDuration;
    if (!prompt.trim()) {
      setStatus(`Add a ${kind} prompt first.`);
      return;
    }
    if (kind === 'music' && musicProvider === 'sonauto-v3' && !hasSonautoApiKey()) {
      setStatus('Add a Sonauto API key in Settings to generate with Sonauto.');
      return;
    }
    if ((kind !== 'music' || musicProvider === 'lyria2') && apiKeyReady === false) {
      setStatus('Connect your API keys to generate audio.');
      return;
    }
    setIsRunning(true);
    setStatus(kind === 'music' && musicProvider === 'sonauto-v3'
      ? 'Generating music with Sonauto...'
      : `Generating ${kind}...`);
    try {
      const item = kind === 'music' && musicProvider === 'sonauto-v3'
        ? await generateMusicWithSonauto(prompt, {
            instrumental: sonautoInstrumental,
            onStatus: (message) => setStatus(message),
          })
        : await generateMusicWithLyria2(prompt, { duration });
      handleAddGenerated(
        item,
        kind === 'music'
          ? (musicProvider === 'sonauto-v3' ? 'Sonauto v3 Music' : 'Lyria 2 Music')
          : 'Lyria 2 SFX',
      );
      setStatus(`${kind === 'music' ? 'Music' : 'SFX'} generated and added to the project.`);
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
    if (apiKeyReady === false) {
      setStatus('Connect your API keys to separate stems.');
      return;
    }
    const payload = await resolveDemucsPayload();
    if (!payload) {
      setStatus('Upload or paste an audio file to separate stems.');
      return;
    }
    setIsRunning(true);
    setStatus('Separating stems...');
    try {
      const stems = await separateAudioWithDemucs(payload);
      stems.forEach((item) => handleAddGenerated(item, 'Demucs Stem'));
      setStatus('Stems generated and added to the project.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Stem separation failed.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="studio-workspace p-6 h-full overflow-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="workspace-hero">
          <div className="workspace-hero__content">
            <div className="workspace-hero__eyebrow">Audio production</div>
            <h2 className="workspace-hero__title">Sound Design</h2>
            <p className="workspace-hero__body">Generate voiceovers, music, SFX, stems, and mastered audio from one workspace.</p>
          </div>
          <div className="workspace-hero__icon">
            <MusicNoteIcon className="w-7 h-7" />
          </div>
          <div className="workspace-stat-grid">
            <div className="workspace-stat">
              <AudioIcon className="workspace-stat__icon" />
              <div>
                <div className="workspace-stat__value">{latestAudio.length}</div>
                <div className="workspace-stat__label">Ready audio</div>
              </div>
            </div>
            <div className="workspace-stat">
              <MusicNoteIcon className="workspace-stat__icon" />
              <div>
                <div className="workspace-stat__value">{filteredLibraryAudio.length}</div>
                <div className="workspace-stat__label">Library matches</div>
              </div>
            </div>
            <div className="workspace-stat">
              <SparklesIcon className="workspace-stat__icon" />
              <div>
                <div className="workspace-stat__value">{voiceText.trim().length}</div>
                <div className="workspace-stat__label">Voice chars</div>
              </div>
            </div>
            <div className="workspace-stat">
              <AudioIcon className="workspace-stat__icon" />
              <div>
                <div className="workspace-stat__value">{masteringAudioSources.length}</div>
                <div className="workspace-stat__label">Mastering sources</div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-6">
            <AudioMasteringPanel
              audioSources={masteringAudioSources}
              currentProjectPath={currentProjectPath}
              onAddGeneratedMedia={handleAddGenerated}
            />

            <section className="app-panel p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Voiceover</div>
                  <p className="text-xs text-gray-500">ElevenLabs or Minimax Speech 02 HD.</p>
                </div>
                <SparklesIcon className="w-5 h-5 text-indigo-300" />
              </div>
              <select
                value={voiceProvider}
                onChange={(event) => setVoiceProvider(event.target.value as VoiceProvider)}
                className="app-select"
              >
                <option value="elevenlabs">ElevenLabs</option>
                <option value="minimax">Minimax Speech 02 HD (Replicate)</option>
              </select>
              <textarea
                value={voiceText}
                onChange={(event) => setVoiceText(event.target.value)}
                placeholder="Voiceover script..."
                rows={4}
                className="app-textarea"
              />
              {voiceProvider === 'elevenlabs' ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase">Voice ID</label>
                    <input value={voiceId} onChange={(event) => setVoiceId(event.target.value)} className="app-input mt-1 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase">Model</label>
                    <input value={voiceModelId} onChange={(event) => setVoiceModelId(event.target.value)} className="app-input mt-1 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase">Output</label>
                    <input value={voiceOutputFormat} onChange={(event) => setVoiceOutputFormat(event.target.value)} className="app-input mt-1 text-xs" />
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase">Voice (optional)</label>
                    <input value={minimaxVoice} onChange={(event) => setMinimaxVoice(event.target.value)} className="app-input mt-1 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase">Speed</label>
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      value={minimaxSpeed}
                      onChange={(event) => setMinimaxSpeed(Number(event.target.value))}
                      className="w-full mt-2"
                    />
                  </div>
                </div>
              )}
              <button
                className="app-button app-primary"
                onClick={handleGenerateVoice}
                disabled={isRunning}
              >
                {isRunning ? 'Generating...' : 'Generate Voice'}
              </button>
            </section>

            <section className="app-panel p-6 space-y-4">
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Music</div>
                <select
                  value={musicProvider}
                  onChange={(event) => setMusicProvider(event.target.value as MusicProvider)}
                  className="app-select"
                >
                  <option value="lyria2">Google Lyria 2 (short clip)</option>
                  <option value="sonauto-v3">Sonauto v3 (full song)</option>
                </select>
              </div>
              <textarea
                value={musicPrompt}
                onChange={(event) => setMusicPrompt(event.target.value)}
                placeholder="Describe the music style, tempo, mood..."
                rows={3}
                className="app-textarea"
              />
              {musicProvider === 'lyria2' ? (
                <div className="flex items-center gap-3">
                  <label className="text-[10px] text-gray-500 uppercase">Duration (sec)</label>
                  <input
                    type="number"
                    min={4}
                    max={120}
                    value={musicDuration}
                    onChange={(event) => setMusicDuration(Number(event.target.value) || 20)}
                    className="app-input w-24 text-xs"
                  />
                  <button
                    className="app-button app-primary"
                    onClick={() => handleGenerateMusic('music')}
                    disabled={isRunning}
                  >
                    Generate Music
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="text-xs text-gray-200 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={sonautoInstrumental}
                      onChange={(event) => setSonautoInstrumental(event.target.checked)}
                    />
                    Instrumental track
                  </label>
                  <div className="text-[10px] text-gray-500">
                    Sonauto v3 generates full songs and determines the final runtime itself.
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Sonauto notes that user-facing API integrations may require attribution.
                  </div>
                  <button
                    className="app-button app-primary"
                    onClick={() => handleGenerateMusic('music')}
                    disabled={isRunning}
                  >
                    Generate Music
                  </button>
                </div>
              )}
            </section>

            <section className="app-panel p-6 space-y-4">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">SFX (Lyria 2)</div>
              <textarea
                value={sfxPrompt}
                onChange={(event) => setSfxPrompt(event.target.value)}
                placeholder="Describe the sound effect (e.g. whoosh, impact, ambience)..."
                rows={3}
                className="app-textarea"
              />
              <div className="flex items-center gap-3">
                <label className="text-[10px] text-gray-500 uppercase">Duration (sec)</label>
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={sfxDuration}
                  onChange={(event) => setSfxDuration(Number(event.target.value) || 6)}
                  className="app-input w-24 text-xs"
                />
                <button
                  className="app-button app-primary"
                  onClick={() => handleGenerateMusic('sfx')}
                  disabled={isRunning}
                >
                  Generate SFX
                </button>
              </div>
            </section>

            <section className="app-panel p-6 space-y-4">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Stem Separation (Demucs)</div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Upload audio</label>
                  <input
                    type="file"
                    accept="audio/*"
                    className="app-input-file"
                    onChange={(event) => setDemucsFile(event.target.files?.[0] || null)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Or paste URL</label>
                  <input
                    value={demucsUrl}
                    onChange={(event) => setDemucsUrl(event.target.value)}
                    placeholder="https://..."
                    className="app-input text-xs"
                  />
                </div>
              </div>
              <button className="app-button app-primary" onClick={handleDemucs} disabled={isRunning}>
                {isRunning ? 'Separating...' : 'Separate Stems'}
              </button>
            </section>
          </div>

          <div className="space-y-6">
            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Library audio</div>
              <input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="Search audio assets..."
                className="app-input text-xs"
              />
              {libraryError && <div className="text-[10px] text-amber-300">{libraryError}</div>}
              <div className="space-y-2 max-h-64 overflow-auto">
                {filteredLibraryAudio.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      if (asset.url) {
                        setDemucsUrl(asset.url);
                        setDemucsFile(null);
                      }
                    }}
                    className="app-card p-2 text-left hover:border-indigo-500/60"
                  >
                    <div className="text-xs text-gray-200 truncate">{asset.name}</div>
                    <div className="text-[10px] text-gray-500 truncate">{asset.projectName}</div>
                  </button>
                ))}
                {filteredLibraryAudio.length === 0 && !libraryLoading && (
                  <div className="text-[10px] text-gray-500">No audio assets found.</div>
                )}
                {libraryLoading && (
                  <div className="text-[10px] text-gray-500">Loading audio assets...</div>
                )}
              </div>
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Latest Audio</div>
                {status && <div className="text-[10px] text-gray-500">{status}</div>}
              </div>
              <div className="space-y-3">
                {latestAudio.map((item) => (
                  <div key={item.id} className="app-card p-3 space-y-2">
                    <div className="text-[10px] text-gray-400">{item.name}</div>
                    <audio controls src={item.url} className="w-full" />
                  </div>
                ))}
                {latestAudio.length === 0 && (
                  <div className="text-[10px] text-gray-500">No audio generated yet.</div>
                )}
              </div>
            </section>
          </div>
        </div>

        {status && <div className="text-xs text-gray-400">{status}</div>}
      </div>
    </div>
  );
};

export default SoundWorkspace;
