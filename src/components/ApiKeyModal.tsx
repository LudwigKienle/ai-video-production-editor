
import React, { useState, useEffect } from 'react';
import { MagicWandIcon, LockIcon, CheckCircleIcon } from './icons';
import { ShortcutAction, ShortcutMap, StudioAgentApprovalMode, StudioAgentControlMode, Workspace } from '../types';
import { DEFAULT_SHORTCUTS, SHORTCUT_DEFINITIONS } from '../utils/shortcuts';
import { clearCloudAuth, getCloudAuth, getCloudClientId, setCloudClientId, startCloudOAuth } from '../services/cloudAuthService';
import { getGoogleModelProvider, setGoogleModelProvider, GoogleModelProvider } from '../services/googleModelProvider';
import { UNSPLASH_ACCESS_KEY_STORAGE_KEY } from '../services/unsplashService';

type AutosaveSettings = {
    enabled: boolean;
    debounceMs: number;
    minIntervalMs: number;
    recoverOnCrash: boolean;
};

type StartupPreferences = {
    startupWorkspace: Workspace;
    autoOpenAssistant: boolean;
    studioAgentMode: StudioAgentControlMode;
    studioAgentApprovalMode: StudioAgentApprovalMode;
};

interface ApiKeyModalProps {
    onKeySelected: () => void;
    onClose?: () => void;
    shortcuts?: ShortcutMap;
    onUpdateShortcuts?: (shortcuts: ShortcutMap) => void;
    autosaveSettings?: AutosaveSettings;
    onUpdateAutosaveSettings?: (settings: AutosaveSettings) => void;
    startupPreferences?: StartupPreferences;
    onUpdateStartupPreferences?: (settings: StartupPreferences) => void;
    onRestartOnboarding?: () => void;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
    onKeySelected,
    onClose,
    shortcuts,
    onUpdateShortcuts,
    autosaveSettings,
    onUpdateAutosaveSettings,
    startupPreferences,
    onUpdateStartupPreferences,
    onRestartOnboarding,
}) => {
    const [googleKey, setGoogleKey] = useState('');
    const [googleProvider, setGoogleProvider] = useState<GoogleModelProvider>('gemini');
    const [replicateKey, setReplicateKey] = useState('');
    const [xaiKey, setXaiKey] = useState('');
    const [elevenLabsKey, setElevenLabsKey] = useState('');
    const [sonautoKey, setSonautoKey] = useState('');
    const [falKey, setFalKey] = useState('');
    const [ltxKey, setLtxKey] = useState('');
    const [worldLabsKey, setWorldLabsKey] = useState('');
    const [braveSearchKey, setBraveSearchKey] = useState('');
    const [unsplashKey, setUnsplashKey] = useState('');
    const [dropboxClientId, setDropboxClientId] = useState('');
    const [googleDriveClientId, setGoogleDriveClientId] = useState('');
    const [error, setError] = useState('');
    const [cloudError, setCloudError] = useState('');
    const [googleSaved, setGoogleSaved] = useState(false);
    const [replicateSaved, setReplicateSaved] = useState(false);
    const [xaiSaved, setXaiSaved] = useState(false);
    const [elevenLabsSaved, setElevenLabsSaved] = useState(false);
    const [sonautoSaved, setSonautoSaved] = useState(false);
    const [falSaved, setFalSaved] = useState(false);
    const [ltxSaved, setLtxSaved] = useState(false);
    const [worldLabsSaved, setWorldLabsSaved] = useState(false);
    const [braveSearchSaved, setBraveSearchSaved] = useState(false);
    const [unsplashSaved, setUnsplashSaved] = useState(false);
    const [dropboxSaved, setDropboxSaved] = useState(false);
    const [googleDriveSaved, setGoogleDriveSaved] = useState(false);
    const [dropboxConnected, setDropboxConnected] = useState(false);
    const [googleDriveConnected, setGoogleDriveConnected] = useState(false);

    useEffect(() => {
        const storedGoogle = localStorage.getItem('gemini_api_key');
        const storedReplicate = localStorage.getItem('replicate_api_key');
        const storedXai = localStorage.getItem('xai_api_key');
        const storedElevenLabs = localStorage.getItem('elevenlabs_api_key');
        const storedSonauto = localStorage.getItem('sonauto_api_key');
        const storedFal = localStorage.getItem('fal_api_key');
        const storedLtx = localStorage.getItem('ltx_api_key');
        const storedWorldLabs = localStorage.getItem('worldlabs_api_key');
        const storedBraveSearch = localStorage.getItem('brave_search_api_key');
        const storedUnsplash = localStorage.getItem(UNSPLASH_ACCESS_KEY_STORAGE_KEY);
        const storedDropboxClient = getCloudClientId('dropbox');
        const storedGoogleDriveClient = getCloudClientId('google-drive');

        if (storedGoogle) {
            setGoogleKey(storedGoogle);
            setGoogleSaved(true);
        }
        setGoogleProvider(getGoogleModelProvider());
        if (storedReplicate) {
            setReplicateKey(storedReplicate);
            setReplicateSaved(true);
        }
        if (storedXai) {
            setXaiKey(storedXai);
            setXaiSaved(true);
        }
        if (storedElevenLabs) {
            setElevenLabsKey(storedElevenLabs);
            setElevenLabsSaved(true);
        }
        if (storedSonauto) {
            setSonautoKey(storedSonauto);
            setSonautoSaved(true);
        }
        if (storedFal) {
            setFalKey(storedFal);
            setFalSaved(true);
        }
        if (storedLtx) {
            setLtxKey(storedLtx);
            setLtxSaved(true);
        }
        if (storedWorldLabs) {
            setWorldLabsKey(storedWorldLabs);
            setWorldLabsSaved(true);
        }
        if (storedBraveSearch) {
            setBraveSearchKey(storedBraveSearch);
            setBraveSearchSaved(true);
        }
        if (storedUnsplash) {
            setUnsplashKey(storedUnsplash);
            setUnsplashSaved(true);
        }
        if (storedDropboxClient) {
            setDropboxClientId(storedDropboxClient);
            setDropboxSaved(true);
        }
        if (storedGoogleDriveClient) {
            setGoogleDriveClientId(storedGoogleDriveClient);
            setGoogleDriveSaved(true);
        }

        setDropboxConnected(!!getCloudAuth('dropbox'));
        setGoogleDriveConnected(!!getCloudAuth('google-drive'));
    }, []);

    const shortcutValues = shortcuts || DEFAULT_SHORTCUTS;
    const autosaveValues = autosaveSettings || {
        enabled: true,
        debounceMs: 20000,
        minIntervalMs: 60000,
        recoverOnCrash: true,
    };
    const startupValues = startupPreferences || {
        startupWorkspace: 'PROJECT' as Workspace,
        autoOpenAssistant: false,
        studioAgentMode: 'agent' as StudioAgentControlMode,
        studioAgentApprovalMode: 'important_only' as StudioAgentApprovalMode,
    };

    const handleShortcutChange = (action: ShortcutAction, value: string) => {
        if (!onUpdateShortcuts) return;
        onUpdateShortcuts({
            ...shortcutValues,
            [action]: value.trim(),
        });
    };

    const handleResetShortcuts = () => {
        if (!onUpdateShortcuts) return;
        onUpdateShortcuts({ ...DEFAULT_SHORTCUTS });
    };

    const updateAutosaveSettings = (patch: Partial<AutosaveSettings>) => {
        if (!onUpdateAutosaveSettings) return;
        onUpdateAutosaveSettings({
            ...autosaveValues,
            ...patch,
        });
    };

    const updateStartupPreferences = (patch: Partial<StartupPreferences>) => {
        if (!onUpdateStartupPreferences) return;
        onUpdateStartupPreferences({
            ...startupValues,
            ...patch,
        });
    };

    const handleConnect = async (provider: 'dropbox' | 'google-drive') => {
        try {
            setCloudError('');
            if (provider === 'dropbox' && dropboxClientId.trim()) {
                setCloudClientId('dropbox', dropboxClientId.trim());
            }
            if (provider === 'google-drive' && googleDriveClientId.trim()) {
                setCloudClientId('google-drive', googleDriveClientId.trim());
            }
            await startCloudOAuth(provider);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'OAuth failed.';
            setCloudError(msg);
        }
    };

    const handleDisconnect = (provider: 'dropbox' | 'google-drive') => {
        clearCloudAuth(provider);
        if (provider === 'dropbox') {
            setDropboxConnected(false);
        } else {
            setGoogleDriveConnected(false);
        }
    };

    const handleSaveKey = () => {
        setError('');
        setCloudError('');

        const hasCloudConfig = dropboxClientId.trim() || googleDriveClientId.trim();
        if (!googleKey.trim() && !replicateKey.trim() && !xaiKey.trim() && !elevenLabsKey.trim() && !sonautoKey.trim() && !falKey.trim() && !ltxKey.trim() && !worldLabsKey.trim() && !braveSearchKey.trim() && !unsplashKey.trim() && !hasCloudConfig) {
            setError("Please enter at least one API Key to continue.");
            return;
        }

        if (googleKey.trim()) {
            localStorage.setItem('gemini_api_key', googleKey.trim());
        } else {
            // Allow clearing if intended, but warn if main app features depend on it?
            // For now, assume if they empty it, they want to clear it.
            localStorage.removeItem('gemini_api_key');
        }

        if (replicateKey.trim()) {
            localStorage.setItem('replicate_api_key', replicateKey.trim());
        } else {
            localStorage.removeItem('replicate_api_key');
        }

        if (xaiKey.trim()) {
            localStorage.setItem('xai_api_key', xaiKey.trim());
        } else {
            localStorage.removeItem('xai_api_key');
        }

        setGoogleModelProvider(googleProvider);

        if (elevenLabsKey.trim()) {
            localStorage.setItem('elevenlabs_api_key', elevenLabsKey.trim());
        } else {
            localStorage.removeItem('elevenlabs_api_key');
        }

        if (sonautoKey.trim()) {
            localStorage.setItem('sonauto_api_key', sonautoKey.trim());
        } else {
            localStorage.removeItem('sonauto_api_key');
        }

        if (falKey.trim()) {
            localStorage.setItem('fal_api_key', falKey.trim());
        } else {
            localStorage.removeItem('fal_api_key');
        }

        if (ltxKey.trim()) {
            localStorage.setItem('ltx_api_key', ltxKey.trim());
        } else {
            localStorage.removeItem('ltx_api_key');
        }

        if (worldLabsKey.trim()) {
            localStorage.setItem('worldlabs_api_key', worldLabsKey.trim());
        } else {
            localStorage.removeItem('worldlabs_api_key');
        }

        if (braveSearchKey.trim()) {
            localStorage.setItem('brave_search_api_key', braveSearchKey.trim());
            setBraveSearchSaved(true);
        } else {
            localStorage.removeItem('brave_search_api_key');
            setBraveSearchSaved(false);
        }

        if (unsplashKey.trim()) {
            localStorage.setItem(UNSPLASH_ACCESS_KEY_STORAGE_KEY, unsplashKey.trim());
            setUnsplashSaved(true);
        } else {
            localStorage.removeItem(UNSPLASH_ACCESS_KEY_STORAGE_KEY);
            setUnsplashSaved(false);
        }

        if (dropboxClientId.trim()) {
            setCloudClientId('dropbox', dropboxClientId.trim());
            setDropboxSaved(true);
        } else {
            setCloudClientId('dropbox', '');
            setDropboxSaved(false);
        }

        if (googleDriveClientId.trim()) {
            setCloudClientId('google-drive', googleDriveClientId.trim());
            setGoogleDriveSaved(true);
        } else {
            setCloudClientId('google-drive', '');
            setGoogleDriveSaved(false);
        }

        onKeySelected();
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50">
            <div className="app-modal p-6 sm:p-8 max-w-3xl w-full text-center transform transition-all duration-300 scale-100 relative max-h-[85vh] overflow-y-auto">
                {onClose && (
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 app-muted hover:text-white"
                    >
                        &times;
                    </button>
                )}

                <div className="flex justify-center mb-6">
                    <div className="p-4 bg-sky-500/10 rounded-full border border-sky-400/30">
                        <MagicWandIcon className="w-12 h-12 text-sky-300" />
                    </div>
                </div>
                <h2 className="text-3xl font-bold mb-2">Studio Settings</h2>
                <p className="app-muted mb-8 text-sm">
                    Connect your AI providers to start creating.
                </p>

                <div className="text-left mb-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">Google Gemini API</label>
                            {googleSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={googleKey}
                                onChange={(e) => { setGoogleKey(e.target.value); setGoogleSaved(false); }}
                                className="app-input pl-10"
                                placeholder="AIzaSy..."
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">Required for Script, Imagen, and TTS. Gemini/Veo image + video and AI Writer can use Replicate if selected below.</p>
                        <p className="text-[10px] app-muted mt-1">
                            Get a key at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://aistudio.google.com/app/apikey"
                                target="_blank"
                                rel="noreferrer"
                            >
                                aistudio.google.com
                            </a>
                            . Create an API key, then paste it here.
                        </p>
                        <div className="mt-3">
                            <label className="block text-[10px] font-semibold app-muted uppercase mb-1">Google models via</label>
                            <select
                                className="app-select text-xs w-full"
                                value={googleProvider}
                                onChange={(e) => setGoogleProvider(e.target.value as GoogleModelProvider)}
                            >
                                <option value="gemini">Gemini (AI Studio)</option>
                                <option value="replicate">Replicate</option>
                            </select>
                            <p className="text-[10px] app-muted mt-2">Replicate makes Gemini 3 Pro + Veo optional without a Gemini key.</p>
                        </div>
                    </div>

                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">Replicate API</label>
                            {replicateSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={replicateKey}
                                onChange={(e) => { setReplicateKey(e.target.value); setReplicateSaved(false); }}
                                className="app-input pl-10"
                                placeholder="r8_..."
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">Required for Flux Pro, Schnell (Turbo), and Upscaling.</p>
                        <p className="text-[10px] app-muted mt-1">
                            Get a token at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://replicate.com/account/api-tokens"
                                target="_blank"
                                rel="noreferrer"
                            >
                                replicate.com
                            </a>
                            . Create a token and paste it here.
                        </p>
                    </div>

                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">xAI Grok API</label>
                            {xaiSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={xaiKey}
                                onChange={(e) => { setXaiKey(e.target.value); setXaiSaved(false); }}
                                className="app-input pl-10"
                                placeholder="xai_..."
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">Required for Grok image + video generation.</p>
                        <p className="text-[10px] app-muted mt-1">
                            Get a key at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://console.x.ai/"
                                target="_blank"
                                rel="noreferrer"
                            >
                                console.x.ai
                            </a>
                            . Create an API key and paste it here.
                        </p>
                    </div>

                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">ElevenLabs API</label>
                            {elevenLabsSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={elevenLabsKey}
                                onChange={(e) => { setElevenLabsKey(e.target.value); setElevenLabsSaved(false); }}
                                className="app-input pl-10"
                                placeholder="sk-..."
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">Required for ElevenLabs voice generation.</p>
                        <p className="text-[10px] app-muted mt-1">
                            Get a key at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://elevenlabs.io/app/settings/api-keys"
                                target="_blank"
                                rel="noreferrer"
                            >
                                elevenlabs.io
                            </a>
                            . Generate an API key and paste it here.
                        </p>
                    </div>

                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">Sonauto API</label>
                            {sonautoSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={sonautoKey}
                                onChange={(e) => { setSonautoKey(e.target.value); setSonautoSaved(false); }}
                                className="app-input pl-10"
                                placeholder="sa_..."
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">Used for full-song music generation in Sound Design.</p>
                        <p className="text-[10px] app-muted mt-1">
                            Get a key at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://sonauto.ai/developers"
                                target="_blank"
                                rel="noreferrer"
                            >
                                sonauto.ai/developers
                            </a>
                            . Sonauto notes that user-facing API integrations may require attribution.
                        </p>
                    </div>

                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">FAL AI API</label>
                            {falSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={falKey}
                                onChange={(e) => { setFalKey(e.target.value); setFalSaved(false); }}
                                className="app-input pl-10"
                                placeholder="fal_..."
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">Used for FAL Qwen multi-angle editing plus Kling O3/v3, Grok I2V, and Aurora video.</p>
                        <p className="text-[10px] app-muted mt-1">
                            Get a key at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://fal.ai/dashboard/api-keys"
                                target="_blank"
                                rel="noreferrer"
                            >
                                fal.ai
                            </a>
                            . Create a key, then paste it here.
                        </p>
                    </div>

                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">LTX API</label>
                            {ltxSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={ltxKey}
                                onChange={(e) => { setLtxKey(e.target.value); setLtxSaved(false); }}
                                className="app-input pl-10"
                                placeholder="LTX API key"
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">Used for Color Science Upscale: SDR video to ACES HDR EXR frame archives.</p>
                        <p className="text-[10px] app-muted mt-1">
                            Get a key at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://console.ltx.video"
                                target="_blank"
                                rel="noreferrer"
                            >
                                console.ltx.video
                            </a>
                            . Create a key and paste it here.
                        </p>
                    </div>

                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">World Labs API</label>
                            {worldLabsSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={worldLabsKey}
                                onChange={(e) => { setWorldLabsKey(e.target.value); setWorldLabsSaved(false); }}
                                className="app-input pl-10"
                                placeholder="WLT-..."
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">For 3D World Generation (Marble).</p>
                        <p className="text-[10px] app-muted mt-1">
                            Get a key at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://platform.worldlabs.ai/"
                                target="_blank"
                                rel="noreferrer"
                            >
                                platform.worldlabs.ai
                            </a>
                            . Create a key and paste it here.
                        </p>
                    </div>

                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">Brave Search API</label>
                            {braveSearchSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={braveSearchKey}
                                onChange={(e) => { setBraveSearchKey(e.target.value); setBraveSearchSaved(false); }}
                                className="app-input pl-10"
                                placeholder="BSA_..."
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">Optional but recommended for read-only web, news, and image research inside the Studio Agent.</p>
                        <p className="text-[10px] app-muted mt-1">
                            Get a key at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://api-dashboard.search.brave.com/"
                                target="_blank"
                                rel="noreferrer"
                            >
                                api-dashboard.search.brave.com
                            </a>
                            . The agent uses this only for search and citation retrieval.
                        </p>
                    </div>

                    <div className="app-card p-4">
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-xs font-bold app-muted uppercase">Unsplash API</label>
                            {unsplashSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                        </div>
                        <div className="relative">
                            <input
                                type="password"
                                value={unsplashKey}
                                onChange={(e) => { setUnsplashKey(e.target.value); setUnsplashSaved(false); }}
                                className="app-input pl-10"
                                placeholder="Unsplash Access Key"
                            />
                            <div className="absolute left-3 top-3.5 app-muted">
                                <LockIcon className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] app-muted mt-2">Used for the Stock Library search. Paste the Access Key only, not the Secret Key.</p>
                        <p className="text-[10px] app-muted mt-1">
                            Register an app at{' '}
                            <a
                                className="text-indigo-300 hover:text-indigo-200"
                                href="https://unsplash.com/developers"
                                target="_blank"
                                rel="noreferrer"
                            >
                                unsplash.com/developers
                            </a>
                            .
                        </p>
                    </div>
                </div>

                <div className="text-left mb-8">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <h3 className="text-sm font-semibold text-white">Cloud Providers</h3>
                            <p className="text-[10px] app-muted mt-1">Set OAuth client IDs, then connect to Dropbox or Google Drive.</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="app-card p-4">
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-xs font-bold app-muted uppercase">Dropbox Client ID</label>
                                {dropboxSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                            </div>
                            <input
                                type="text"
                                value={dropboxClientId}
                                onChange={(e) => { setDropboxClientId(e.target.value); setDropboxSaved(false); }}
                                className="app-input text-xs"
                                placeholder="Dropbox OAuth client ID"
                            />
                            <div className="flex items-center justify-between mt-3">
                                <span className={`text-[10px] ${dropboxConnected ? 'text-emerald-300' : 'text-gray-500'}`}>
                                    {dropboxConnected ? 'Connected' : 'Not connected'}
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleConnect('dropbox')}
                                        className="app-button app-secondary text-xs"
                                        type="button"
                                    >
                                        Connect
                                    </button>
                                    <button
                                        onClick={() => handleDisconnect('dropbox')}
                                        className="app-button app-tertiary text-xs"
                                        type="button"
                                    >
                                        Disconnect
                                    </button>
                                </div>
                            </div>
                            <p className="text-[10px] app-muted mt-2">Redirect URI: {typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'app://local'}</p>
                        </div>

                        <div className="app-card p-4">
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-xs font-bold app-muted uppercase">Google Drive Client ID</label>
                                {googleDriveSaved && <span className="text-[10px] text-emerald-300 flex items-center gap-1"><CheckCircleIcon className="w-3 h-3" /> Saved</span>}
                            </div>
                            <input
                                type="text"
                                value={googleDriveClientId}
                                onChange={(e) => { setGoogleDriveClientId(e.target.value); setGoogleDriveSaved(false); }}
                                className="app-input text-xs"
                                placeholder="Google OAuth client ID"
                            />
                            <div className="flex items-center justify-between mt-3">
                                <span className={`text-[10px] ${googleDriveConnected ? 'text-emerald-300' : 'text-gray-500'}`}>
                                    {googleDriveConnected ? 'Connected' : 'Not connected'}
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleConnect('google-drive')}
                                        className="app-button app-secondary text-xs"
                                        type="button"
                                    >
                                        Connect
                                    </button>
                                    <button
                                        onClick={() => handleDisconnect('google-drive')}
                                        className="app-button app-tertiary text-xs"
                                        type="button"
                                    >
                                        Disconnect
                                    </button>
                                </div>
                            </div>
                            <p className="text-[10px] app-muted mt-2">Redirect URI: {typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'app://local'}</p>
                        </div>
                    </div>
                    {cloudError && (
                        <div className="text-red-400 text-xs mt-3 bg-red-500/10 border border-red-500/30 p-2 rounded">
                            {cloudError}
                        </div>
                    )}
                </div>

                <div className="text-left mb-8">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-white">Keyboard Shortcuts</h3>
                            <p className="text-[10px] app-muted mt-1">Format: mod+shift+p, ctrl+k, cmd+1. Leave empty to disable.</p>
                        </div>
                        <button
                            onClick={handleResetShortcuts}
                            className="app-button app-secondary text-xs"
                            type="button"
                        >
                            Reset Defaults
                        </button>
                    </div>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                        {SHORTCUT_DEFINITIONS.map((shortcut) => (
                            <div key={shortcut.id} className="app-card p-3">
                                <div className="text-xs font-semibold text-white">{shortcut.label}</div>
                                <div className="text-[10px] app-muted">{shortcut.description}</div>
                                <input
                                    className="app-input text-xs mt-2"
                                    value={shortcutValues[shortcut.id] || ''}
                                    onChange={(e) => handleShortcutChange(shortcut.id, e.target.value)}
                                    placeholder="disabled"
                                    aria-label={`${shortcut.label} shortcut`}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="text-left mb-8">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-white">Startup Behavior</h3>
                            <p className="text-[10px] app-muted mt-1">Customize default opening workspace and assistant launch behavior.</p>
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        <div className="app-card p-3">
                            <div className="text-xs font-semibold text-white">Default Workspace</div>
                            <div className="text-[10px] app-muted">Workspace shown after app launch.</div>
                            <select
                                className="app-select text-xs mt-2 w-full"
                                value={startupValues.startupWorkspace}
                                onChange={(e) => updateStartupPreferences({ startupWorkspace: e.target.value as Workspace })}
                            >
                                <option value="PROJECT">Project Hub</option>
                                <option value="IMAGE_GEN">Image Gen</option>
                                <option value="VIDEO_GEN">Video Gen</option>
                                <option value="MOODBOARD">Moodboard</option>
                                <option value="EDIT">Edit Timeline</option>
                            </select>
                        </div>
                        <div className="app-card p-3">
                            <div className="text-xs font-semibold text-white">Assistant</div>
                            <div className="text-[10px] app-muted">Open assistant automatically on startup.</div>
                            <label className="text-xs text-gray-200 flex items-center gap-2 mt-3">
                                <input
                                    type="checkbox"
                                    checked={startupValues.autoOpenAssistant}
                                    onChange={(e) => updateStartupPreferences({ autoOpenAssistant: e.target.checked })}
                                />
                                Auto-open assistant
                            </label>
                        </div>
                        <div className="app-card p-3">
                            <div className="text-xs font-semibold text-white">Agent Mode</div>
                            <div className="text-[10px] app-muted">Choose between assistant-driven workflows and manual-only control.</div>
                            <select
                                className="app-select text-xs mt-2 w-full"
                                value={startupValues.studioAgentMode}
                                onChange={(e) => updateStartupPreferences({ studioAgentMode: e.target.value as StudioAgentControlMode })}
                            >
                                <option value="agent">Agent Mode</option>
                                <option value="manual">Manual Mode</option>
                            </select>
                        </div>
                        <div className="app-card p-3">
                            <div className="text-xs font-semibold text-white">Approval Policy</div>
                            <div className="text-[10px] app-muted">Decide whether approvals happen only on important actions or on every action.</div>
                            <select
                                className="app-select text-xs mt-2 w-full"
                                value={startupValues.studioAgentApprovalMode}
                                onChange={(e) => updateStartupPreferences({ studioAgentApprovalMode: e.target.value as StudioAgentApprovalMode })}
                            >
                                <option value="important_only">Important decisions only</option>
                                <option value="every_action">Ask on every action</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="text-left mb-8">
                    <div className="app-card p-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold text-white">Onboarding</h3>
                            <p className="text-[10px] app-muted mt-1">Re-open the welcome walkthrough anytime.</p>
                        </div>
                        <button
                            type="button"
                            className="app-button app-secondary text-xs"
                            onClick={() => onRestartOnboarding?.()}
                        >
                            Walkthrough erneut starten
                        </button>
                    </div>
                </div>

                <div className="text-left mb-8">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-white">Autosave</h3>
                            <p className="text-[10px] app-muted mt-1">Control debounce, minimum interval, and crash recovery behavior.</p>
                        </div>
                    </div>
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="app-card p-3 space-y-3 md:col-span-2">
                            <label className="text-xs text-gray-200 flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={autosaveValues.enabled}
                                    onChange={(e) => updateAutosaveSettings({ enabled: e.target.checked })}
                                />
                                Enable autosave
                            </label>
                            <label className="text-xs text-gray-200 flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={autosaveValues.recoverOnCrash}
                                    onChange={(e) => updateAutosaveSettings({ recoverOnCrash: e.target.checked })}
                                />
                                Offer recovery after unclean shutdown
                            </label>
                        </div>
                        <div className="app-card p-3">
                            <div className="text-xs font-semibold text-white">Debounce (seconds)</div>
                            <div className="text-[10px] app-muted">Wait after edits before autosave starts.</div>
                            <input
                                type="number"
                                min={3}
                                max={180}
                                className="app-input text-xs mt-2"
                                value={Math.round(autosaveValues.debounceMs / 1000)}
                                onChange={(e) => {
                                    const seconds = Math.max(3, Math.min(180, Number(e.target.value) || 20));
                                    updateAutosaveSettings({ debounceMs: seconds * 1000 });
                                }}
                            />
                        </div>
                        <div className="app-card p-3">
                            <div className="text-xs font-semibold text-white">Min Interval (seconds)</div>
                            <div className="text-[10px] app-muted">Absolute minimum time between two autosaves.</div>
                            <input
                                type="number"
                                min={15}
                                max={900}
                                className="app-input text-xs mt-2"
                                value={Math.round(autosaveValues.minIntervalMs / 1000)}
                                onChange={(e) => {
                                    const seconds = Math.max(15, Math.min(900, Number(e.target.value) || 60));
                                    updateAutosaveSettings({ minIntervalMs: seconds * 1000 });
                                }}
                            />
                        </div>
                    </div>
                </div>

                {error && <p className="text-red-500 text-sm mb-4 bg-red-500/10 p-2 rounded border border-red-500/20">{error}</p>}

                <button
                    onClick={handleSaveKey}
                    className="w-full app-button app-primary py-3 text-base"
                >
                    {onClose ? 'Save Changes' : 'Connect & Start Studio'}
                </button>
            </div>
        </div>
    );
};

export default ApiKeyModal;
