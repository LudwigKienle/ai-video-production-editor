import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RECOMMENDED_LOCAL_LLMS,
  LOCAL_LLM_DEFAULT_URLS,
  deleteOllamaModel,
  generateContentWithLocalLlm,
  getLocalLlmConfig,
  listLocalModels,
  probeLocalServer,
  pullOllamaModel,
  setLocalLlmConfig,
  type LocalLlmConfig,
  type LocalLlmModel,
  type LocalLlmProvider,
  type LocalServerStatus,
  type PullProgress,
} from '../services/localLlmService';
import {
  cancelLocalModelDownload,
  checkModelInstalled,
  downloadLocalModel,
  getComfyBaseUrl,
  getLocalModelSettings,
  isLocalModelDownloadAvailable,
  localModelsBridge,
  modelDownloadSize,
  removeLocalModel,
  setLocalModelSettings,
  type ModelDownloadProgress,
  type ModelInstallState,
} from '../services/localModelService';
import { LOCAL_MODEL_CATALOG, type LocalModelEntry } from '../data/localModelCatalog';
import { DRAW_THINGS_DEFAULT_URL, getDrawThingsUrl, probeDrawThings, setDrawThingsUrl } from '../services/drawThingsService';
import { getComfyUiHealth } from '../services/comfyUiService';
import { BrainCircuitIcon, DownloadIcon, FolderIcon, ImageIcon, SparklesIcon, TrashIcon, VideoIcon, XIcon } from '../components/icons';

type Section = 'text' | 'images' | 'draw-things';

const formatBytes = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
};

const ProgressBar: React.FC<{ value: number; label?: string }> = ({ value, label }) => (
  <div className="local-ai-progress" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
    <div className="local-ai-progress__bar" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    {label && <span className="local-ai-progress__label">{label}</span>}
  </div>
);

const PROVIDER_LABELS: Record<LocalLlmProvider, string> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  'openai-compatible': 'Other (OpenAI-compatible)',
};

// ---------------------------------------------------------------------------
// Text models (local LLMs)
// ---------------------------------------------------------------------------

const TextModelsPanel: React.FC = () => {
  const [config, setConfig] = useState<LocalLlmConfig>(() => getLocalLlmConfig());
  const [server, setServer] = useState<LocalServerStatus | null>(null);
  const [models, setModels] = useState<LocalLlmModel[]>([]);
  const [pulls, setPulls] = useState<Record<string, PullProgress & { cancel?: () => void }>>({});
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);

  const update = (patch: Partial<LocalLlmConfig>) => setConfig(setLocalLlmConfig(patch));

  const refresh = useCallback(async (current = config) => {
    const status = await probeLocalServer(current.provider, current.baseUrl);
    setServer(status);
    if (!status.online) {
      setModels([]);
      return;
    }
    try {
      setModels(await listLocalModels(current.provider, current.baseUrl));
    } catch (error: any) {
      setMessage(error?.message || String(error));
    }
  }, [config]);

  useEffect(() => {
    void refresh();
    // Re-check on provider or address change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.provider, config.baseUrl]);

  const chooseProvider = (provider: LocalLlmProvider) => {
    update({ provider, baseUrl: LOCAL_LLM_DEFAULT_URLS[provider], model: '' });
  };

  const startPull = (tag: string) => {
    const job = pullOllamaModel(config.baseUrl, tag, (progress) => {
      setPulls((prev) => ({ ...prev, [tag]: { ...prev[tag], ...progress } }));
    });
    setPulls((prev) => ({ ...prev, [tag]: { status: 'starting', cancel: job.cancel } }));
    job.promise
      .then(async () => {
        setPulls((prev) => {
          const next = { ...prev };
          delete next[tag];
          return next;
        });
        await refresh();
        if (!config.model) update({ model: tag });
        setMessage(`${tag} is ready.`);
      })
      .catch((error) => {
        setPulls((prev) => ({ ...prev, [tag]: { status: 'error', error: error?.message || String(error) } }));
      });
  };

  const removeModel = async (id: string) => {
    if (!window.confirm(`Delete ${id} from Ollama?`)) return;
    try {
      await deleteOllamaModel(config.baseUrl, id);
      if (config.model === id) update({ model: '' });
      await refresh();
    } catch (error: any) {
      setMessage(error?.message || String(error));
    }
  };

  const testModel = async () => {
    setTesting(true);
    setMessage('');
    try {
      const started = Date.now();
      const response = await generateContentWithLocalLlm({ contents: 'Write a one-sentence logline for a short film about a lighthouse keeper.', config: { maxOutputTokens: 120 } }, config);
      setMessage(`${config.model} answered in ${((Date.now() - started) / 1000).toFixed(1)} s: ${response.text}`);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setTesting(false);
    }
  };

  const installedIds = new Set(models.map((model) => model.id));

  return (
    <section className="local-ai-section">
      <div className="plugin-install__hero">
        <h2>Text models</h2>
        <p>Run the script, breakdown, prompt and assistant features on a model on your own computer: free, private and offline. Steps that make or read images, video or audio still use Gemini when a key is set.</p>
      </div>

      <div className="local-ai-card">
        <div className="local-ai-row">
          <label className="local-ai-field">
            <span>Server</span>
            <select className="app-input" value={config.provider} onChange={(event) => chooseProvider(event.target.value as LocalLlmProvider)}>
              {(Object.keys(PROVIDER_LABELS) as LocalLlmProvider[]).map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
            </select>
          </label>
          <label className="local-ai-field local-ai-field--grow">
            <span>Address</span>
            <input className="app-input" value={config.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} />
          </label>
          <button type="button" className="app-button app-secondary text-xs" onClick={() => refresh()}>Check</button>
        </div>
        <p className={`local-ai-status ${server?.online ? 'local-ai-status--ok' : ''}`}>
          {server === null ? 'Checking…'
            : server.online ? `${PROVIDER_LABELS[config.provider]} is running${server.version ? ` (v${server.version})` : ''}.`
              : config.provider === 'ollama'
                ? <>Ollama is not running. Install it from <a href="https://ollama.com/download" target="_blank" rel="noreferrer">ollama.com/download</a> and open it, then press Check.</>
                : config.provider === 'lmstudio'
                  ? <>LM Studio's server is off. In LM Studio open Developer → Start server (port 1234), load a model, then press Check.</>
                  : <>No server answers at {config.baseUrl}.</>}
        </p>
      </div>

      <div className="local-ai-card">
        <h3>Use for text features</h3>
        <div className="local-ai-choice">
          <label>
            <input type="radio" checked={config.textProvider === 'local'} onChange={() => update({ textProvider: 'local' })} />
            <span><strong>Local model</strong> for all text steps</span>
          </label>
          <label>
            <input type="radio" checked={config.textProvider === 'gemini'} onChange={() => update({ textProvider: 'gemini' })} />
            <span><strong>Gemini</strong>, and the local model only when no Gemini key is set</span>
          </label>
        </div>
        <div className="local-ai-row">
          <label className="local-ai-field local-ai-field--grow">
            <span>Model</span>
            <select className="app-input" value={config.model} onChange={(event) => update({ model: event.target.value })}>
              <option value="">{models.length ? 'Choose a model…' : 'No models installed yet'}</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}{model.parameterSize ? ` · ${model.parameterSize}` : ''}{model.vision ? ' · vision' : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="app-button app-primary text-xs" disabled={!config.model || testing || !server?.online} onClick={testModel}>
            {testing ? 'Testing…' : 'Test'}
          </button>
        </div>
        {message && <p className="local-ai-message">{message}</p>}
      </div>

      {config.provider === 'ollama' && (
        <div className="local-ai-card">
          <h3>Download a model</h3>
          <p className="local-ai-hint">One click pulls the model into Ollama. Pick by your computer's memory; models marked "vision" can also read reference images.</p>
          <ul className="local-ai-list" role="list">
            {RECOMMENDED_LOCAL_LLMS.map((entry) => {
              const pull = pulls[entry.tag];
              const installed = installedIds.has(entry.tag);
              const fraction = pull?.total ? (pull.completed || 0) / pull.total : 0;
              return (
                <li key={entry.tag} className="local-ai-item">
                  <div className="local-ai-item__text">
                    <strong>{entry.label}</strong>
                    <span className="local-ai-item__meta">{entry.tag} · {entry.size} · {entry.memory}{entry.vision ? ' · vision' : ''}</span>
                    <span className="local-ai-item__note">{entry.note}</span>
                    {pull && pull.status !== 'error' && <ProgressBar value={fraction} label={pull.total ? `${pull.status} · ${formatBytes(pull.completed)} of ${formatBytes(pull.total)}` : pull.status} />}
                    {pull?.status === 'error' && <span className="local-ai-error">{pull.error}</span>}
                  </div>
                  <div className="local-ai-item__actions">
                    {installed ? (
                      <>
                        <button type="button" className={`app-button text-xs ${config.model === entry.tag ? 'app-secondary' : 'app-primary'}`} onClick={() => update({ model: entry.tag })} disabled={config.model === entry.tag}>
                          {config.model === entry.tag ? 'In use' : 'Use'}
                        </button>
                        <button type="button" className="toolbar-button toolbar-button--icon" title="Delete" onClick={() => removeModel(entry.tag)}><TrashIcon className="w-4 h-4" /></button>
                      </>
                    ) : pull && pull.status !== 'error' ? (
                      <button type="button" className="app-button app-secondary text-xs" onClick={() => pull.cancel?.()}>Cancel</button>
                    ) : (
                      <button type="button" className="app-button app-primary text-xs" disabled={!server?.online} onClick={() => startPull(entry.tag)}>
                        <DownloadIcon className="w-4 h-4" /> Download
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <form className="local-ai-row" onSubmit={(event) => {
            event.preventDefault();
            const tag = String(new FormData(event.currentTarget).get('tag') || '').trim();
            if (tag) startPull(tag);
          }}>
            <label className="local-ai-field local-ai-field--grow">
              <span>Any model from ollama.com/library</span>
              <input name="tag" className="app-input" placeholder="e.g. qwen3-vl:8b" />
            </label>
            <button type="submit" className="app-button app-secondary text-xs" disabled={!server?.online}>Download</button>
          </form>
        </div>
      )}
      {config.provider === 'lmstudio' && (
        <div className="plugin-help">
          <h4>Getting models in LM Studio</h4>
          <p>Search and download models in LM Studio's Discover tab, load one, and it appears in the list above. Good picks: Qwen 3.5 9B or Gemma 4 12B (both read images).</p>
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Image & video models (ComfyUI)
// ---------------------------------------------------------------------------

const LICENSE_LABEL: Record<LocalModelEntry['license']['commercial'], string> = {
  yes: 'Commercial use OK',
  limited: 'Commercial use limited',
  no: 'Non-commercial only',
};

const ImageModelsPanel: React.FC = () => {
  const [settings, setSettings] = useState(() => getLocalModelSettings());
  const [states, setStates] = useState<Record<string, ModelInstallState>>({});
  const [progress, setProgress] = useState<Record<string, ModelDownloadProgress | { error: string }>>({});
  const [withEnhancer, setWithEnhancer] = useState<Record<string, boolean>>({});
  const [comfyOnline, setComfyOnline] = useState<boolean | null>(null);
  const canDownload = isLocalModelDownloadAvailable();
  const comfyUrl = getComfyBaseUrl();

  const refreshStates = useCallback(async () => {
    const next: Record<string, ModelInstallState> = {};
    for (const model of LOCAL_MODEL_CATALOG) next[model.id] = await checkModelInstalled(model, settings.modelsRoot);
    setStates(next);
  }, [settings.modelsRoot]);

  useEffect(() => { void refreshStates(); }, [refreshStates]);
  useEffect(() => {
    getComfyUiHealth(comfyUrl).then(() => setComfyOnline(true)).catch(() => setComfyOnline(false));
  }, [comfyUrl]);

  const saveSettings = (patch: Partial<typeof settings>) => setSettings(setLocalModelSettings(patch));

  const pickFolder = async () => {
    const result = await localModelsBridge()?.pickFolder({ title: 'Choose ComfyUI\'s "models" folder' });
    if (result && !result.canceled && result.path) saveSettings({ modelsRoot: result.path });
  };

  const startDownload = async (model: LocalModelEntry) => {
    const entry = withEnhancer[model.id] ? { ...model, files: model.files.map((file) => ({ ...file, optional: false })) } : model;
    setProgress((prev) => ({ ...prev, [model.id]: { modelId: model.id, file: '', fileIndex: 0, fileCount: entry.files.length, received: 0, total: modelDownloadSize(entry) } }));
    try {
      await downloadLocalModel(entry, (update) => setProgress((prev) => ({ ...prev, [model.id]: update })));
      setProgress((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
    } catch (error: any) {
      const text = error?.message === 'cancelled' ? '' : (error?.message || String(error));
      setProgress((prev) => {
        const next = { ...prev };
        if (text) next[model.id] = { error: text };
        else delete next[model.id];
        return next;
      });
    }
    await refreshStates();
  };

  const remove = async (model: LocalModelEntry) => {
    if (!window.confirm(`Delete the ${model.label} files from ${settings.modelsRoot}?`)) return;
    await removeLocalModel(model);
    await refreshStates();
  };

  if (!canDownload) {
    return (
      <section className="local-ai-section">
        <div className="plugin-install__hero">
          <h2>Image & video models</h2>
          <p>Downloading and running open-weights models needs the desktop app.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="local-ai-section">
      <div className="plugin-install__hero">
        <h2>Image & video models</h2>
        <p>Open-weights models that run on your GPU through ComfyUI. Download once, then pick them in Images or Video like any other model. No per-image cost; your images never leave the machine.</p>
      </div>

      <div className="local-ai-card">
        <div className="local-ai-row">
          <label className="local-ai-field local-ai-field--grow">
            <span>ComfyUI models folder</span>
            <input className="app-input" value={settings.modelsRoot} placeholder="…/ComfyUI/models" onChange={(event) => saveSettings({ modelsRoot: event.target.value })} />
          </label>
          <button type="button" className="app-button app-secondary text-xs" onClick={pickFolder}><FolderIcon className="w-4 h-4" /> Choose</button>
          {settings.modelsRoot && <button type="button" className="app-button app-tertiary text-xs" onClick={() => localModelsBridge()?.openFolder({ path: settings.modelsRoot })}>Open</button>}
        </div>
        <p className={`local-ai-status ${comfyOnline ? 'local-ai-status--ok' : ''}`}>
          {comfyOnline === null ? 'Checking ComfyUI…'
            : comfyOnline ? `ComfyUI is running at ${comfyUrl}.`
              : <>ComfyUI is not running at {comfyUrl}. Install <a href="https://www.comfy.org/download" target="_blank" rel="noreferrer">ComfyUI Desktop</a> (its models folder is in Documents/ComfyUI/models) or start your own, then come back. The address is set in Images → ComfyUI.</>}
        </p>
        <label className="local-ai-field">
          <span>Hugging Face token (only for gated models such as FLUX.3 Klein)</span>
          <input className="app-input" type="password" value={settings.hfToken} placeholder="hf_…" onChange={(event) => saveSettings({ hfToken: event.target.value.trim() })} />
        </label>
        <p className="local-ai-hint">Create a read token at huggingface.co/settings/tokens and accept the model's license on its Hugging Face page once. The token is only sent to huggingface.co.</p>
      </div>

      <ul className="local-ai-list" role="list">
        {LOCAL_MODEL_CATALOG.map((model) => {
          const state = states[model.id];
          const job = progress[model.id];
          const running = job && !('error' in job);
          const optional = model.files.filter((file) => file.optional);
          const total = modelDownloadSize(model);
          return (
            <li key={model.id} className="local-ai-model">
              <div className="local-ai-model__head">
                <span className="plugin-card__icon">{model.kind === 'video' ? <VideoIcon className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}</span>
                <div className="local-ai-item__text">
                  <strong>{model.label} <span className="local-ai-item__meta">· {model.vendor}</span></strong>
                  <span className="local-ai-item__note">{model.summary}</span>
                  <span className="local-ai-tags">
                    {model.capabilities.map((capability) => <span key={capability} className="status-chip">{capability}</span>)}
                    <span className="status-chip">{model.vram} VRAM</span>
                    <span className="status-chip">{formatBytes(total)}</span>
                    <a className={`status-chip local-ai-license local-ai-license--${model.license.commercial}`} href={model.license.url} target="_blank" rel="noreferrer" title={model.license.note}>{LICENSE_LABEL[model.license.commercial]}</a>
                    {model.gated && <span className="status-chip">Needs HF token</span>}
                  </span>
                </div>
                <div className="local-ai-item__actions">
                  {state?.installed ? (
                    <>
                      <span className="local-ai-installed">Installed</span>
                      <button type="button" className="toolbar-button toolbar-button--icon" title="Delete files" onClick={() => remove(model)}><TrashIcon className="w-4 h-4" /></button>
                    </>
                  ) : running ? (
                    <button type="button" className="app-button app-secondary text-xs" onClick={() => cancelLocalModelDownload(model.id)}><XIcon className="w-4 h-4" /> Cancel</button>
                  ) : (
                    <button type="button" className="app-button app-primary text-xs" disabled={!settings.modelsRoot} onClick={() => startDownload(model)} title={settings.modelsRoot ? '' : 'Choose the models folder first'}>
                      <DownloadIcon className="w-4 h-4" /> {state && state.presentBytes > 0 ? 'Resume' : 'Download'}
                    </button>
                  )}
                </div>
              </div>
              {optional.length > 0 && !state?.installed && !running && (
                <label className="local-ai-optional">
                  <input type="checkbox" checked={Boolean(withEnhancer[model.id])} onChange={(event) => setWithEnhancer((prev) => ({ ...prev, [model.id]: event.target.checked }))} />
                  <span>Also download the prompt enhancer (+{formatBytes(optional.reduce((sum, file) => sum + file.size, 0))}): {optional[0].note}</span>
                </label>
              )}
              {running && (
                <ProgressBar
                  value={job.total ? job.received / job.total : 0}
                  label={`File ${job.fileIndex + 1} of ${job.fileCount}${job.file ? ` · ${job.file}` : ''} · ${formatBytes(job.received)} of ${formatBytes(job.total)}${job.bytesPerSecond ? ` · ${formatBytes(job.bytesPerSecond)}/s` : ''}`}
                />
              )}
              {job && 'error' in job && <p className="local-ai-error">{job.error}</p>}
              {model.license.commercial !== 'yes' && model.license.note && <p className="local-ai-hint">{model.license.note}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Draw Things
// ---------------------------------------------------------------------------

const DrawThingsPanel: React.FC = () => {
  const [url, setUrl] = useState(() => getDrawThingsUrl());
  const [status, setStatus] = useState<{ online: boolean; model?: string; error?: string } | null>(null);
  const check = useCallback(async (value = url) => setStatus(await probeDrawThings(value)), [url]);
  useEffect(() => { void check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="local-ai-section">
      <div className="plugin-install__hero">
        <h2>Draw Things</h2>
        <p>Draw Things runs open-weights image models natively on Apple silicon (Mac, iPad). Turn on its API server and the studio can generate with whatever model you load there, from Images → Draw Things.</p>
      </div>
      <div className="local-ai-card">
        <div className="local-ai-row">
          <label className="local-ai-field local-ai-field--grow">
            <span>Address</span>
            <input className="app-input" value={url} onChange={(event) => { setUrl(event.target.value); setDrawThingsUrl(event.target.value); }} placeholder={DRAW_THINGS_DEFAULT_URL} />
          </label>
          <button type="button" className="app-button app-secondary text-xs" onClick={() => check()}>Check</button>
        </div>
        <p className={`local-ai-status ${status?.online ? 'local-ai-status--ok' : ''}`}>
          {status === null ? 'Checking…' : status.online ? `Draw Things is connected${status.model ? ` · model: ${status.model}` : ''}.` : 'Not connected.'}
        </p>
      </div>
      <div className="plugin-help">
        <h4>Setup</h4>
        <p>1. Install Draw Things from the Mac App Store. 2. Download a model inside Draw Things (for example FLUX or Qwen Image). 3. Settings → API Server: turn on the HTTP server (port 7860). 4. Press Check.</p>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------

const SECTIONS: Array<{ id: Section; label: string; meta: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'text', label: 'Text models', meta: 'Ollama · LM Studio', icon: BrainCircuitIcon },
  { id: 'images', label: 'Image & video models', meta: 'ComfyUI · one-click downloads', icon: ImageIcon },
  { id: 'draw-things', label: 'Draw Things', meta: 'Apple silicon', icon: SparklesIcon },
];

const LocalAiWorkspace: React.FC = () => {
  const [section, setSection] = useState<Section>('text');
  const active = useMemo(() => SECTIONS.find((entry) => entry.id === section)!, [section]);
  return (
    <div className="plugins-workspace">
      <aside className="plugins-sidebar">
        <div className="plugins-sidebar__head">
          <span className="plugins-sidebar__title">Local AI</span>
        </div>
        <ul className="plugins-list" role="list">
          {SECTIONS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`plugins-list__item ${active.id === entry.id ? 'plugins-list__item--active' : ''}`}
                onClick={() => setSection(entry.id)}
              >
                <span className="plugins-list__icon"><entry.icon className="w-4 h-4" /></span>
                <span className="plugins-list__text">
                  <span className="plugins-list__name">{entry.label}</span>
                  <span className="plugins-list__meta">{entry.meta}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="plugins-sidebar__foot">
          <p>Everything here runs on your computer. Nothing is billed.</p>
        </div>
      </aside>
      <div className="plugins-main">
        {section === 'text' && <TextModelsPanel />}
        {section === 'images' && <ImageModelsPanel />}
        {section === 'draw-things' && <DrawThingsPanel />}
      </div>
    </div>
  );
};

export default LocalAiWorkspace;
