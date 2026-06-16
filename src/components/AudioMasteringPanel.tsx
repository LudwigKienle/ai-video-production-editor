import React, { useEffect, useMemo, useState } from 'react';
import { MediaItem } from '../types';
import {
  getAudioMasteringStatus,
  runAudioMasteringJob,
  setupAudioMasteringEnvironment,
  type AudioMasteringResult,
  type AudioMasteringStatus,
} from '../services/audioMastering/audioMasteringService';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';

export type AudioMasteringSourceOption = {
  id: string;
  name: string;
  url: string;
  label: string;
  duration?: number;
};

type AudioMasteringPanelProps = {
  audioSources: AudioMasteringSourceOption[];
  currentProjectPath?: string | null;
  onAddGeneratedMedia: (item: MediaItem, label?: string) => void;
};

const formatMetric = (value: number | null | undefined, suffix: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value.toFixed(1)} ${suffix}`;
};

const profileLabels: Record<string, string> = {
  spotify_balanced: 'Balanced Spotify master',
  spotify_loud: 'Tighter loud Spotify master',
  spotify_natural: 'More dynamic Spotify master',
  spotify_dialog: 'Controlled dialog-forward Spotify master',
};

const AudioMasteringPanel: React.FC<AudioMasteringPanelProps> = ({
  audioSources,
  currentProjectPath,
  onAddGeneratedMedia,
}) => {
  const [targetSourceId, setTargetSourceId] = useState('');
  const [referenceSourceId, setReferenceSourceId] = useState('');
  const [targetFile, setTargetFile] = useState<File | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [compressionStrength, setCompressionStrength] = useState(5);
  const [stereoWidthPercent, setStereoWidthPercent] = useState(100);
  const [targetLufs, setTargetLufs] = useState(-14);
  const [eqMatchAmount, setEqMatchAmount] = useState(100);
  const [limiterCeilingDbtp, setLimiterCeilingDbtp] = useState(-1);
  const [lowMidCrossoverHz, setLowMidCrossoverHz] = useState(160);
  const [midHighCrossoverHz, setMidHighCrossoverHz] = useState(3200);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [envStatus, setEnvStatus] = useState<AudioMasteringStatus | null>(null);
  const [result, setResult] = useState<AudioMasteringResult | null>(null);

  const hasDesktopAudioMastering = typeof window !== 'undefined' && Boolean(window.electron?.audioMastering);

  useEffect(() => {
    if (!hasDesktopAudioMastering) {
      setEnvStatus({
        ready: false,
        available: false,
        error: 'Audio mastering is available in the desktop app.',
      });
      return;
    }

    let isActive = true;
    getAudioMasteringStatus()
      .then((nextStatus) => {
        if (isActive) {
          setEnvStatus(nextStatus);
        }
      })
      .catch((error) => {
        if (isActive) {
          setEnvStatus({
            ready: false,
            available: false,
            error: error instanceof Error ? error.message : 'Failed to read mastering engine status.',
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, [hasDesktopAudioMastering]);

  useEffect(() => {
    if (audioSources.length === 0) {
      return;
    }

    if (!audioSources.some((source) => source.id === targetSourceId)) {
      setTargetSourceId(audioSources[0].id);
    }
    if (!audioSources.some((source) => source.id === referenceSourceId)) {
      setReferenceSourceId('');
    }
  }, [audioSources, referenceSourceId, targetSourceId]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    setProgressPercent((current) => (current > 5 ? current : 8));
    const interval = window.setInterval(() => {
      setProgressPercent((current) => {
        if (current >= 92) {
          return current;
        }
        if (current < 48) {
          return current + 8;
        }
        if (current < 76) {
          return current + 4;
        }
        return current + 1.5;
      });
    }, 350);

    return () => {
      window.clearInterval(interval);
    };
  }, [isRunning]);

  const selectedTargetSource = useMemo(
    () => audioSources.find((source) => source.id === targetSourceId) || null,
    [audioSources, targetSourceId]
  );
  const selectedReferenceSource = useMemo(
    () => audioSources.find((source) => source.id === referenceSourceId) || null,
    [audioSources, referenceSourceId]
  );

  const resolvePayload = async (
    file: File | null,
    source: AudioMasteringSourceOption | null,
    role: 'song' | 'reference',
    required: boolean
  ) => {
    if (file) {
      return {
        payload: {
          base64: await fileToBase64(file),
          mimeType: file.type || 'audio/wav',
          name: file.name,
        },
        name: file.name,
        duration: undefined,
      };
    }

    if (!source) {
      if (!required) {
        return null;
      }
      throw new Error(`Choose a ${role} audio source or upload a file first.`);
    }

    const payload = await getBase64FromUrl(source.url);
    return {
      payload: {
        ...payload,
        mimeType: payload.mimeType || 'audio/wav',
        name: source.name,
      },
      name: source.name,
      duration: source.duration,
    };
  };

  const handlePrepareEnvironment = async () => {
    if (!hasDesktopAudioMastering) {
      setStatus('Audio mastering is available in the desktop app.');
      return;
    }

    setIsRunning(true);
    setProgressPercent(12);
    setStatus('Preparing local audio mastering engine...');
    try {
      const nextStatus = await setupAudioMasteringEnvironment();
      setEnvStatus(nextStatus);
      setStatus(nextStatus.ready ? 'Audio mastering engine is ready.' : nextStatus.error || 'Audio mastering setup needs attention.');
      setProgressPercent(100);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to prepare local audio mastering.');
      setProgressPercent(0);
    } finally {
      setIsRunning(false);
      window.setTimeout(() => setProgressPercent(0), 600);
    }
  };

  const handleRunMastering = async (mode: 'manual' | 'spotify_auto') => {
    if (!hasDesktopAudioMastering) {
      setStatus('Audio mastering is available in the desktop app.');
      return;
    }

    setIsRunning(true);
    setResult(null);
    setStatus('Preparing mastering job...');
    setProgressPercent(8);

    try {
      const [target, reference] = await Promise.all([
        resolvePayload(targetFile, selectedTargetSource, 'song', true),
        resolvePayload(referenceFile, selectedReferenceSource, 'reference', false),
      ]);

      setStatus(
        mode === 'spotify_auto'
          ? 'Analyzing source, choosing a Spotify-safe profile, mastering, and validating the result...'
          : 'Running EQ match, multiband compression, stereo imaging, limiting, and loudness normalization...'
      );
      const nextResult = await runAudioMasteringJob({
        provider: 'local',
        mode,
        target: target!.payload,
        reference: reference?.payload ?? null,
        compressionStrength,
        stereoWidthPercent,
        targetLufs,
        advanced: {
          eqMatchAmount,
          limiterCeilingDbtp,
          lowMidCrossoverHz,
          midHighCrossoverHz,
        },
        projectPath: currentProjectPath || null,
      });

      setResult(nextResult);
      setStatus(
        mode === 'spotify_auto'
          ? `Spotify auto master exported as ${nextResult.outputName}.`
          : `Mastered 24-bit WAV exported as ${nextResult.outputName}.`
      );
      setProgressPercent(100);

      onAddGeneratedMedia(
        {
          id: `audio-mastering-${Date.now()}`,
          name: nextResult.outputName,
          type: 'audio',
          url: nextResult.url,
          source: 'generated',
          generatedBy: mode === 'spotify_auto' ? 'Spotify Auto Master' : 'Custom DSP Mastering',
          prompt:
            mode === 'spotify_auto'
              ? `Song: ${target?.name}; Reference: ${reference?.name || 'Internal Spotify profile'}; Auto profile: ${nextResult.autoProfile || 'spotify_balanced'}`
              : `Song: ${target?.name}; Reference: ${reference?.name || 'None'}; Compression ${compressionStrength}; Width ${stereoWidthPercent}%; Target ${targetLufs} LUFS`,
          duration: target?.duration,
          originProjectPath: currentProjectPath || null,
        },
        mode === 'spotify_auto' ? 'Spotify Auto Master' : 'Custom DSP Mastering'
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Audio mastering failed.');
      setProgressPercent(0);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className="app-panel p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-400">AI Mastering</div>
          <p className="text-xs text-gray-500">
            One-click Spotify-safe mastering on top of the custom DSP chain, with manual controls available in Advanced.
          </p>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${
            envStatus?.ready
              ? 'bg-emerald-500/15 text-emerald-200'
              : envStatus?.available
                ? 'bg-amber-500/15 text-amber-200'
                : 'bg-white/5 text-gray-400'
          }`}
        >
          {envStatus?.ready ? `Ready${envStatus.version ? ` · numpy ${envStatus.version}` : ''}` : envStatus?.available ? 'Setup Required' : 'Unavailable'}
        </div>
      </div>

      {envStatus?.error && <div className="text-[10px] text-amber-300">{envStatus.error}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="app-card p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Song</div>
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.flac,.aiff,.aif"
            className="app-input-file"
            onChange={(event) => setTargetFile(event.target.files?.[0] || null)}
          />
          {targetFile && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-100">
              <span className="truncate">Using upload: {targetFile.name}</span>
              <button type="button" className="text-[10px] uppercase tracking-[0.18em] text-indigo-200" onClick={() => setTargetFile(null)}>
                Clear
              </button>
            </div>
          )}
          <select
            value={targetSourceId}
            onChange={(event) => setTargetSourceId(event.target.value)}
            className="app-select"
            disabled={Boolean(targetFile)}
          >
            {audioSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </div>

        <div className="app-card p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400">Reference</div>
          <div className="text-[11px] text-gray-500">Optional. Leave empty to use the internal Spotify profile.</div>
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.flac,.aiff,.aif"
            className="app-input-file"
            onChange={(event) => setReferenceFile(event.target.files?.[0] || null)}
          />
          {referenceFile && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-100">
              <span className="truncate">Using upload: {referenceFile.name}</span>
              <button type="button" className="text-[10px] uppercase tracking-[0.18em] text-indigo-200" onClick={() => setReferenceFile(null)}>
                Clear
              </button>
            </div>
          )}
          <select
            value={referenceSourceId}
            onChange={(event) => setReferenceSourceId(event.target.value)}
            className="app-select"
            disabled={Boolean(referenceFile)}
          >
            <option value="">No reference · Internal Spotify profile</option>
            {audioSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="app-card p-4 space-y-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left text-[11px] uppercase tracking-[0.18em] text-gray-300"
          onClick={() => setIsAdvancedOpen((current) => !current)}
        >
          <span>Advanced</span>
          <span>{isAdvancedOpen ? 'Hide' : 'Show'}</span>
        </button>

        {isAdvancedOpen && (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-3">
              <label className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-gray-300">
                  <span>Compression Strength</span>
                  <span>{compressionStrength}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={compressionStrength}
                  onChange={(event) => setCompressionStrength(Number(event.target.value))}
                  className="w-full"
                />
              </label>

              <label className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-gray-300">
                  <span>Stereo Width</span>
                  <span>{stereoWidthPercent}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={stereoWidthPercent}
                  onChange={(event) => setStereoWidthPercent(Number(event.target.value))}
                  className="w-full"
                />
              </label>

              <label className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-gray-300">
                  <span>Output Loudness</span>
                  <span>{targetLufs} LUFS</span>
                </div>
                <input
                  type="range"
                  min={-16}
                  max={-9}
                  step={1}
                  value={targetLufs}
                  onChange={(event) => setTargetLufs(Number(event.target.value))}
                  className="w-full"
                />
              </label>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
            <label className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-gray-300">
                <span>EQ Match Amount</span>
                <span>{eqMatchAmount}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={eqMatchAmount}
                onChange={(event) => setEqMatchAmount(Number(event.target.value))}
                className="w-full"
              />
            </label>

            <label className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-gray-300">
                <span>Limiter Ceiling</span>
                <span>{limiterCeilingDbtp.toFixed(1)} dBTP</span>
              </div>
              <input
                type="range"
                min={-2}
                max={-0.1}
                step={0.1}
                value={limiterCeilingDbtp}
                onChange={(event) => setLimiterCeilingDbtp(Number(event.target.value))}
                className="w-full"
              />
            </label>

            <label className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-gray-300">
                <span>Low / Mid Crossover</span>
                <span>{lowMidCrossoverHz} Hz</span>
              </div>
              <input
                type="range"
                min={40}
                max={400}
                step={5}
                value={lowMidCrossoverHz}
                onChange={(event) => setLowMidCrossoverHz(Number(event.target.value))}
                className="w-full"
              />
            </label>

            <label className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-gray-300">
                <span>Mid / High Crossover</span>
                <span>{midHighCrossoverHz} Hz</span>
              </div>
              <input
                type="range"
                min={1200}
                max={12000}
                step={50}
                value={midHighCrossoverHz}
                onChange={(event) => setMidHighCrossoverHz(Number(event.target.value))}
                className="w-full"
              />
            </label>
          </div>
          </div>
        )}
      </div>

      <div className="app-card p-4 space-y-4 border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-200">Spotify Auto Master</div>
            <div className="text-sm text-gray-100">One click to analyze, profile, master, validate, and export for Spotify.</div>
            <div className="text-[11px] text-emerald-100/80">Target: about -14 LUFS integrated and max -1 dBTP true peak.</div>
          </div>
          <button className="app-button app-primary min-w-[220px]" onClick={() => handleRunMastering('spotify_auto')} disabled={isRunning}>
            {isRunning ? 'Mastering...' : 'Auto Master for Spotify'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="app-button" onClick={handlePrepareEnvironment} disabled={isRunning}>
          {isRunning ? 'Working...' : envStatus?.ready ? 'Refresh Engine' : 'Prepare Local Engine'}
        </button>
        <button className="app-button" onClick={() => handleRunMastering('manual')} disabled={isRunning}>
          {isRunning ? 'Mastering...' : 'Manual Master'}
        </button>
        <div className="text-[10px] text-gray-500">
          {currentProjectPath
            ? 'Exports are saved to media/audio/remasters in the current project.'
            : 'Without a saved project, exports are written to a temporary desktop runtime folder.'}
        </div>
      </div>

      {(isRunning || progressPercent > 0) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-gray-400">
            <span>{isRunning ? 'Processing' : 'Complete'}</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-400 via-cyan-400 to-emerald-400 transition-all"
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            />
          </div>
        </div>
      )}

      {status && <div className="text-xs text-gray-400">{status}</div>}

      {result && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="app-card p-4 space-y-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">LUFS Before</div>
              <div className="text-lg font-semibold">{formatMetric(result.beforeLufs, 'LUFS')}</div>
            </div>
            <div className="app-card p-4 space-y-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">LUFS After</div>
              <div className="text-lg font-semibold">{formatMetric(result.afterLufs, 'LUFS')}</div>
            </div>
            <div className="app-card p-4 space-y-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">True Peak Before</div>
              <div className="text-lg font-semibold">{formatMetric(result.beforeTruePeakDbtp, 'dBTP')}</div>
            </div>
            <div className="app-card p-4 space-y-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">True Peak After</div>
              <div className="text-lg font-semibold">{formatMetric(result.afterTruePeakDbtp, 'dBTP')}</div>
            </div>
            <div className="app-card p-4 space-y-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Spotify Ready</div>
              <div className={`text-lg font-semibold ${result.spotifyReady ? 'text-emerald-300' : 'text-amber-200'}`}>
                {typeof result.spotifyReady === 'boolean' ? (result.spotifyReady ? 'Yes' : 'Needs review') : 'n/a'}
              </div>
            </div>
            <div className="app-card p-4 space-y-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Profile</div>
              <div className="text-sm font-semibold text-gray-100">
                {result.autoProfile ? profileLabels[result.autoProfile] || result.autoProfile : 'Manual mastering'}
              </div>
            </div>
          </div>

          <div className="app-card p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Output</div>
              <div className="text-sm text-gray-200">{result.outputName}</div>
              {result.correctionApplied && <div className="text-[11px] text-amber-200">A corrective safety pass was applied.</div>}
            </div>
            <a className="app-button app-primary" href={result.url} download={result.outputName}>
              Download Mastered WAV
            </a>
          </div>

          {result.warnings && result.warnings.length > 0 && (
            <div className="app-card p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300">Warnings</div>
              {result.warnings.map((warning, index) => (
                <div key={`${warning}-${index}`} className="text-[11px] text-amber-100">
                  {warning}
                </div>
              ))}
            </div>
          )}

          {result.logLines && result.logLines.length > 0 && (
            <div className="app-card p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Processing Log</div>
              <div className="max-h-40 space-y-1 overflow-auto">
                {result.logLines.map((line, index) => (
                  <div key={`${line}-${index}`} className="text-[10px] text-gray-500">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default AudioMasteringPanel;
