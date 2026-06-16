import React, { useEffect, useMemo, useState } from 'react';
import { AvatarProfile, MediaItem } from '../types';
import {
  generateVideoWithOmniHuman,
  generateVideoWithWanAnimateReplace,
  generateVideoWithWanI2V,
  generateVideoWithKling26,
  generateVideoWithKlingMotionControl,
} from '../services/replicateService';
import { ElevenLabsVoice, fetchElevenLabsVoices, generateSpeechWithElevenLabs } from '../services/elevenLabsService';
import { generateVideoWithFalCreatifyAurora } from '../services/falAiService';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import { AddIcon, UploadIcon, UserCircleIcon, WandSparklesIcon } from '../components/icons';

interface AvatarWorkspaceProps {
  avatars: AvatarProfile[];
  onUpdateAvatars: React.Dispatch<React.SetStateAction<AvatarProfile[]>>;
  onAddGeneratedMedia?: (item: MediaItem) => void;
}

type ModelMode = 'omni-human' | 'wan-replace' | 'wan-i2v' | 'kling-26' | 'kling-motion' | 'aurora-fal';

const VOICE_MODEL_OPTIONS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5' },
  { id: 'eleven_monolingual_v1', label: 'Monolingual v1' },
];

const VOICE_OUTPUT_FORMATS = [
  { id: 'mp3_44100_128', label: 'MP3 44.1k 128kbps' },
  { id: 'mp3_22050_32', label: 'MP3 22k 32kbps' },
  { id: 'pcm_16000', label: 'PCM 16k' },
  { id: 'ulaw_8000', label: 'uLaw 8k' },
];

const fileToPayload = async (file: File) => {
  const base64 = await fileToBase64(file);
  return { base64, mimeType: file.type || 'application/octet-stream' };
};

const urlToImagePayload = async (url: string) => {
  const { base64, mimeType } = await getBase64FromUrl(url);
  return { base64, mimeType: mimeType || 'image/png' };
};

const urlToAudioPayload = async (url: string) => {
  const { base64, mimeType } = await getBase64FromUrl(url);
  return { base64, mimeType: mimeType || 'audio/mpeg' };
};

const AvatarWorkspace: React.FC<AvatarWorkspaceProps> = ({ avatars, onUpdateAvatars, onAddGeneratedMedia }) => {
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(avatars[0]?.id ?? null);
  const [newAvatarName, setNewAvatarName] = useState('');
  const [newAvatarFile, setNewAvatarFile] = useState<File | null>(null);
  const [newAvatarPreviewUrl, setNewAvatarPreviewUrl] = useState<string | null>(null);

  const [modelMode, setModelMode] = useState<ModelMode>('omni-human');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [voiceText, setVoiceText] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [voiceOptions, setVoiceOptions] = useState<ElevenLabsVoice[]>([]);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  const [voiceModelId, setVoiceModelId] = useState(VOICE_MODEL_OPTIONS[0]?.id || 'eleven_multilingual_v2');
  const [voiceOutputFormat, setVoiceOutputFormat] = useState(VOICE_OUTPUT_FORMATS[0]?.id || 'mp3_44100_128');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [startImageFile, setStartImageFile] = useState<File | null>(null);

  const [wanResolution, setWanResolution] = useState<'720' | '480'>('720');
  const [wanFps, setWanFps] = useState(24);
  const [wanRefertNum, setWanRefertNum] = useState<1 | 5>(1);
  const [wanMergeAudio, setWanMergeAudio] = useState(true);
  const [wanGoFast, setWanGoFast] = useState(true);
  const [wanFrames, setWanFrames] = useState(81);
  const [wanInterpolate, setWanInterpolate] = useState(false);

  const [klingAspect, setKlingAspect] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [klingDuration, setKlingDuration] = useState<5 | 10>(5);
  const [klingAudio, setKlingAudio] = useState(true);
  const [klingMode, setKlingMode] = useState<'std' | 'pro'>('std');
  const [klingKeepSound, setKlingKeepSound] = useState(true);
  const [klingOrientation, setKlingOrientation] = useState<'image' | 'video'>('image');
  const [auroraResolution, setAuroraResolution] = useState<'720p' | '480p'>('720p');

  const [status, setStatus] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);

  const audioPreviewUrl = useMemo(() => {
    if (audioFile) return URL.createObjectURL(audioFile);
    return audioUrl;
  }, [audioFile, audioUrl]);

  useEffect(() => {
    if (!selectedAvatarId && avatars.length > 0) {
      setSelectedAvatarId(avatars[0].id);
    }
    if (selectedAvatarId && !avatars.find(a => a.id === selectedAvatarId)) {
      setSelectedAvatarId(avatars[0]?.id ?? null);
    }
  }, [avatars, selectedAvatarId]);

  useEffect(() => {
    return () => {
      if (newAvatarPreviewUrl) {
        URL.revokeObjectURL(newAvatarPreviewUrl);
      }
    };
  }, [newAvatarPreviewUrl]);

  useEffect(() => {
    return () => {
      if (audioFile && audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
    };
  }, [audioFile, audioPreviewUrl]);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    const needsVoice = modelMode === 'omni-human' || modelMode === 'aurora-fal';
    if (!needsVoice || voiceStatus !== 'idle') return;
    setVoiceStatus('loading');
    fetchElevenLabsVoices()
      .then((voices) => {
        setVoiceOptions(voices);
        setVoiceStatus('ready');
        if (!selectedVoiceId && voices.length > 0) {
          setSelectedVoiceId(voices[0].voice_id);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setVoiceError(message);
        setVoiceStatus('error');
      });
  }, [modelMode, voiceStatus, selectedVoiceId]);

  const selectedAvatar = useMemo(() => {
    return avatars.find(a => a.id === selectedAvatarId) || null;
  }, [avatars, selectedAvatarId]);

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (newAvatarPreviewUrl) {
      URL.revokeObjectURL(newAvatarPreviewUrl);
    }
    setNewAvatarFile(file);
    setNewAvatarPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const handleCreateAvatar = async () => {
    if (!newAvatarName.trim()) {
      alert('Please name your avatar.');
      return;
    }
    if (!newAvatarFile) {
      alert('Please upload an avatar image.');
      return;
    }
    const base64 = await fileToBase64(newAvatarFile);
    const imageUrl = `data:${newAvatarFile.type || 'image/png'};base64,${base64}`;
    const newAvatar: AvatarProfile = {
      id: `avatar-${Date.now()}`,
      name: newAvatarName.trim(),
      imageUrl,
      createdAt: new Date().toISOString(),
    };
    onUpdateAvatars([...avatars, newAvatar]);
    setSelectedAvatarId(newAvatar.id);
    setNewAvatarName('');
    setNewAvatarFile(null);
    if (newAvatarPreviewUrl) {
      URL.revokeObjectURL(newAvatarPreviewUrl);
    }
    setNewAvatarPreviewUrl(null);
  };

  const handleDeleteAvatar = (avatarId: string) => {
    const next = avatars.filter(a => a.id !== avatarId);
    onUpdateAvatars(next);
    if (selectedAvatarId === avatarId) {
      setSelectedAvatarId(next[0]?.id ?? null);
    }
  };

  const handleGenerateVoiceover = async () => {
    if (!voiceText.trim()) {
      alert('Please enter voiceover text.');
      return;
    }
    setIsGeneratingAudio(true);
    setStatus('Generating voiceover audio...');
    try {
      const audioItem = await generateSpeechWithElevenLabs(voiceText.trim(), {
        voiceId: selectedVoiceId || undefined,
        modelId: voiceModelId || undefined,
        outputFormat: voiceOutputFormat || undefined,
      });
      setAudioUrl(audioItem.url);
      setAudioFile(null);
      setStatus('Voiceover ready.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`Voiceover generation failed: ${message}`);
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedAvatar?.imageUrl) {
      alert('Select an avatar with an image.');
      return;
    }
    if (!onAddGeneratedMedia) return;

    if (modelMode === 'omni-human' || modelMode === 'aurora-fal') {
      if (!audioFile && !audioUrl && !voiceText.trim()) {
        alert('Please upload an audio file or enter voiceover text.');
        return;
      }
    }
    if (modelMode === 'wan-replace' || modelMode === 'kling-motion') {
      if (!videoFile) {
        alert(modelMode === 'wan-replace' ? 'Please upload a video to replace.' : 'Please upload a motion video.');
        return;
      }
    }
    if ((modelMode === 'wan-i2v' || modelMode === 'kling-26' || modelMode === 'kling-motion') && !prompt.trim()) {
      alert('Please add a prompt.');
      return;
    }

    setIsGenerating(true);
    setStatus('Preparing request...');

    try {
      const avatarPayload = await urlToImagePayload(selectedAvatar.imageUrl);
      const resolveAudioPayload = async () => {
        if (audioFile) return fileToPayload(audioFile);
        if (audioUrl) return urlToAudioPayload(audioUrl);
        if (voiceText.trim()) {
          setStatus('Generating voiceover audio...');
          const audioItem = await generateSpeechWithElevenLabs(voiceText.trim(), {
            voiceId: selectedVoiceId || undefined,
            modelId: voiceModelId || undefined,
            outputFormat: voiceOutputFormat || undefined,
          });
          setAudioUrl(audioItem.url);
          return urlToAudioPayload(audioItem.url);
        }
        return null;
      };
      let item: MediaItem | null = null;

      if (modelMode === 'omni-human') {
        const audioPayload = await resolveAudioPayload();
        if (!audioPayload) {
          alert('Please provide audio or voiceover text.');
          return;
        }
        setStatus('Generating OmniHuman video...');
        item = await generateVideoWithOmniHuman(avatarPayload, audioPayload);
      } else if (modelMode === 'wan-replace') {
        const videoPayload = await fileToPayload(videoFile);
        setStatus('Running Wan Animate Replace...');
        item = await generateVideoWithWanAnimateReplace(videoPayload, avatarPayload, {
          resolution: wanResolution,
          fps: wanFps,
          refertNum: wanRefertNum,
          mergeAudio: wanMergeAudio,
          goFast: wanGoFast,
        });
      } else if (modelMode === 'wan-i2v') {
        setStatus('Animating with Wan 2.2...');
        item = await generateVideoWithWanI2V(prompt, avatarPayload, {
          resolution: wanResolution === '480' ? '480p' : '720p',
          fps: wanFps,
          numFrames: wanFrames,
          interpolate: wanInterpolate,
        });
      } else if (modelMode === 'kling-26') {
        const startImagePayload = startImageFile ? await fileToPayload(startImageFile) : undefined;
        setStatus('Generating Kling 2.6 video...');
        item = await generateVideoWithKling26(prompt, {
          startImage: startImagePayload,
          aspectRatio: klingAspect,
          duration: klingDuration,
          generateAudio: klingAudio,
          negativePrompt: negativePrompt || '',
        });
      } else if (modelMode === 'kling-motion') {
        const videoPayload = await fileToPayload(videoFile);
        setStatus('Driving motion with Kling...');
        item = await generateVideoWithKlingMotionControl(prompt, avatarPayload, videoPayload, {
          mode: klingMode,
          keepOriginalSound: klingKeepSound,
          characterOrientation: klingOrientation,
        });
      } else if (modelMode === 'aurora-fal') {
        const audioPayload = await resolveAudioPayload();
        if (!audioPayload) {
          alert('Please provide audio or voiceover text.');
          return;
        }
        setStatus('Generating Aurora avatar video...');
        item = await generateVideoWithFalCreatifyAurora(avatarPayload, audioPayload, {
          prompt: prompt.trim() || undefined,
          resolution: auroraResolution,
        });
      }

      if (item) {
        onAddGeneratedMedia(item);
        setStatus('Video added to Media Bin.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      alert(`Avatar generation failed: ${message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="studio-workspace h-full p-6 bg-gray-900 text-white overflow-auto">
      <div className="flex flex-col lg:flex-row gap-6 h-full">
        <div className="lg:w-80 w-full flex-shrink-0 space-y-6">
          <div className="bg-gray-800/70 border border-gray-700 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <UserCircleIcon className="w-5 h-5 text-indigo-300" />
              <h2 className="text-lg font-semibold">Avatar Library</h2>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={newAvatarName}
                onChange={(e) => setNewAvatarName(e.target.value)}
                placeholder="Avatar name"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
              />
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <UploadIcon className="w-4 h-4" />
                <span>Upload reference image</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
              </label>
              {newAvatarPreviewUrl && (
                <img src={newAvatarPreviewUrl} alt="Avatar preview" className="rounded-lg max-h-40 w-full object-cover" />
              )}
              <button
                onClick={handleCreateAvatar}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2 rounded-lg flex items-center justify-center gap-2"
              >
                <AddIcon className="w-4 h-4" /> Create Avatar
              </button>
            </div>
          </div>

          <div className="bg-gray-800/70 border border-gray-700 rounded-2xl p-4">
            <h3 className="text-sm uppercase tracking-wide text-gray-400 mb-3">Saved Avatars</h3>
            {avatars.length === 0 && (
              <p className="text-sm text-gray-500">No avatars yet. Add one above.</p>
            )}
            <div className="space-y-3">
              {avatars.map((avatar) => (
                <button
                  key={avatar.id}
                  onClick={() => setSelectedAvatarId(avatar.id)}
                  className={`w-full flex items-center gap-3 p-2 rounded-xl border ${
                    selectedAvatarId === avatar.id ? 'border-indigo-500 bg-gray-900/60' : 'border-gray-700 bg-gray-900/30'
                  }`}
                >
                  {avatar.imageUrl ? (
                    <img src={avatar.imageUrl} alt={avatar.name} className="w-12 h-12 rounded-lg object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gray-700 flex items-center justify-center">
                      <UserCircleIcon className="w-6 h-6 text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 text-left">
                    <div className="text-sm font-semibold">{avatar.name}</div>
                    <div className="text-xs text-gray-500">{new Date(avatar.createdAt).toLocaleDateString()}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete avatar "${avatar.name}"?`)) {
                        handleDeleteAvatar(avatar.id);
                      }
                    }}
                    className="text-xs text-red-400 hover:text-red-300 px-2"
                  >
                    Delete
                  </button>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-6">
          <div className="bg-gray-800/70 border border-gray-700 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <WandSparklesIcon className="w-6 h-6 text-indigo-300" />
              <div>
                <h2 className="text-xl font-semibold">AI Avatar Studio</h2>
                <p className="text-sm text-gray-400">Generate lectures, podcasts, and animated scenes.</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wide">Avatar</label>
                <select
                  value={selectedAvatarId || ''}
                  onChange={(e) => setSelectedAvatarId(e.target.value)}
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                >
                  {avatars.map(avatar => (
                    <option key={avatar.id} value={avatar.id}>{avatar.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 uppercase tracking-wide">Model</label>
                <select
                  value={modelMode}
                  onChange={(e) => setModelMode(e.target.value as ModelMode)}
                  className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="omni-human">OmniHuman (avatar + audio)</option>
                  <option value="aurora-fal">Creatify Aurora (avatar + audio)</option>
                  <option value="wan-replace">Wan Animate Replace (video + avatar)</option>
                  <option value="wan-i2v">Wan 2.2 Animate (image to video)</option>
                  <option value="kling-26">Kling 2.6 (text or image)</option>
                  <option value="kling-motion">Kling Motion Control</option>
                </select>
              </div>
            </div>

            <div className="mt-5 grid md:grid-cols-2 gap-4">
              {(modelMode === 'omni-human' || modelMode === 'aurora-fal') && (
                <div className="md:col-span-2 space-y-3">
                  <label className="text-sm text-gray-300 flex items-center gap-2">
                    <UploadIcon className="w-4 h-4" />
                    <span>Upload audio (mp3/wav)</span>
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setAudioFile(file);
                        if (file) {
                          setAudioUrl(null);
                        }
                      }}
                    />
                  </label>
                  {audioPreviewUrl && (
                    <audio controls src={audioPreviewUrl} className="w-full" />
                  )}
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">Voiceover Text (optional)</label>
                    <textarea
                      value={voiceText}
                      onChange={(e) => setVoiceText(e.target.value)}
                      rows={3}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                      placeholder="Type voiceover text to auto-generate audio..."
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleGenerateVoiceover}
                        disabled={isGeneratingAudio || !voiceText.trim()}
                        className="bg-gray-800 hover:bg-indigo-600 text-white text-xs px-3 py-2 rounded-lg disabled:opacity-50"
                      >
                        {isGeneratingAudio ? 'Generating Voice...' : 'Generate Voiceover'}
                      </button>
                      <span className="text-[10px] text-gray-500">Uses ElevenLabs voice.</span>
                    </div>
                    <div className="mt-2">
                      <label className="text-[10px] uppercase tracking-wider text-gray-500">Voice</label>
                      {voiceStatus === 'loading' && (
                        <div className="text-[10px] text-gray-500 mt-1">Loading voices...</div>
                      )}
                      {voiceStatus === 'error' && (
                        <div className="text-[10px] text-red-300 mt-1">{voiceError || 'Failed to load voices.'}</div>
                      )}
                      {voiceStatus === 'ready' && (
                        <select
                          value={selectedVoiceId}
                          onChange={(e) => setSelectedVoiceId(e.target.value)}
                          className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500"
                        >
                          {voiceOptions.map((voice) => (
                            <option key={voice.voice_id} value={voice.voice_id}>
                              {voice.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="mt-2 grid md:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-gray-500">Voice Model</label>
                          <select
                            value={voiceModelId}
                            onChange={(e) => setVoiceModelId(e.target.value)}
                            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500"
                          >
                            {VOICE_MODEL_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-gray-500">Output Format</label>
                          <select
                            value={voiceOutputFormat}
                            onChange={(e) => setVoiceOutputFormat(e.target.value)}
                            className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs focus:ring-2 focus:ring-indigo-500"
                          >
                            {VOICE_OUTPUT_FORMATS.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {(modelMode === 'wan-replace' || modelMode === 'kling-motion') && (
                <label className="text-sm text-gray-300 flex items-center gap-2">
                  <UploadIcon className="w-4 h-4" />
                  <span>{modelMode === 'wan-replace' ? 'Upload source video' : 'Upload motion video'}</span>
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                  />
                </label>
              )}

              {(modelMode === 'wan-i2v' || modelMode === 'kling-26' || modelMode === 'kling-motion' || modelMode === 'aurora-fal') && (
                <div className="md:col-span-2">
                  <label className="text-xs text-gray-400 uppercase tracking-wide">Prompt</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    placeholder={modelMode === 'aurora-fal' ? 'Optional: add direction for the avatar performance...' : 'Describe the scene, movement, or style...'}
                  />
                </div>
              )}

              {modelMode === 'aurora-fal' && (
                <div>
                  <label className="text-xs text-gray-400 uppercase tracking-wide">Resolution</label>
                  <select
                    value={auroraResolution}
                    onChange={(e) => setAuroraResolution(e.target.value as '720p' | '480p')}
                    className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="720p">720p</option>
                    <option value="480p">480p</option>
                  </select>
                </div>
              )}

              {modelMode === 'kling-26' && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">Negative Prompt</label>
                    <input
                      type="text"
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm text-gray-300 flex items-center gap-2">
                      <UploadIcon className="w-4 h-4" />
                      <span>Optional start image</span>
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => setStartImageFile(e.target.files?.[0] || null)} />
                    </label>
                  </div>
                </>
              )}

              {(modelMode === 'wan-replace' || modelMode === 'wan-i2v') && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">Resolution</label>
                    <select
                      value={wanResolution}
                      onChange={(e) => setWanResolution(e.target.value as '720' | '480')}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="720">720p</option>
                      <option value="480">480p</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">FPS</label>
                    <input
                      type="number"
                      min={5}
                      max={60}
                      value={wanFps}
                      onChange={(e) => setWanFps(Number(e.target.value) || 24)}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </>
              )}

              {modelMode === 'wan-replace' && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">Reference Frames</label>
                    <select
                      value={wanRefertNum}
                      onChange={(e) => setWanRefertNum(e.target.value === '5' ? 5 : 1)}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="1">1</option>
                      <option value="5">5</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-4 mt-6 text-sm text-gray-300">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={wanMergeAudio} onChange={(e) => setWanMergeAudio(e.target.checked)} />
                      Merge audio
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={wanGoFast} onChange={(e) => setWanGoFast(e.target.checked)} />
                      Go fast
                    </label>
                  </div>
                </>
              )}

              {modelMode === 'wan-i2v' && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">Frames</label>
                    <input
                      type="number"
                      min={16}
                      value={wanFrames}
                      onChange={(e) => setWanFrames(Number(e.target.value) || 81)}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex items-center gap-2 mt-6 text-sm text-gray-300">
                    <input type="checkbox" checked={wanInterpolate} onChange={(e) => setWanInterpolate(e.target.checked)} />
                    <span>Interpolate output</span>
                  </div>
                </>
              )}

              {modelMode === 'kling-26' && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">Aspect Ratio</label>
                    <select
                      value={klingAspect}
                      onChange={(e) => setKlingAspect(e.target.value as '16:9' | '9:16' | '1:1')}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                      <option value="1:1">1:1</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">Duration</label>
                    <select
                      value={klingDuration}
                      onChange={(e) => setKlingDuration(e.target.value === '10' ? 10 : 5)}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="5">5s</option>
                      <option value="10">10s</option>
                    </select>
                  </div>
                </>
              )}

              {modelMode === 'kling-26' && (
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={klingAudio} onChange={(e) => setKlingAudio(e.target.checked)} />
                  Generate audio
                </label>
              )}

              {modelMode === 'kling-motion' && (
                <>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">Mode</label>
                    <select
                      value={klingMode}
                      onChange={(e) => setKlingMode(e.target.value as 'std' | 'pro')}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="std">Standard</option>
                      <option value="pro">Pro</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-4 mt-6 text-sm text-gray-300">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={klingKeepSound} onChange={(e) => setKlingKeepSound(e.target.checked)} />
                      Keep original sound
                    </label>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide">Orientation</label>
                    <select
                      value={klingOrientation}
                      onChange={(e) => setKlingOrientation(e.target.value as 'image' | 'video')}
                      className="mt-1 w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <div className="text-xs text-gray-400">
                Output will appear in the Media Bin for editing.
                {status && <span className="block text-indigo-300 mt-1">{status}</span>}
              </div>
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !selectedAvatar}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-6 py-2 rounded-lg disabled:opacity-50"
              >
                {isGenerating ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AvatarWorkspace;
