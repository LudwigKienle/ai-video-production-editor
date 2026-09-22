
import React, { useState, useEffect } from 'react';
import { LockIcon, CheckCircleIcon, KeyboardIcon, SettingsIcon, FolderIcon, SparklesIcon, InfoIcon } from './icons';
import { ShortcutAction, ShortcutMap, StudioAgentApprovalMode, StudioAgentControlMode, Workspace } from '../types';
import { DEFAULT_SHORTCUTS, SHORTCUT_DEFINITIONS } from '../utils/shortcuts';
import { clearCloudAuth, getCloudAuth, getCloudClientId, setCloudClientId, startCloudOAuth } from '../services/cloudAuthService';
import { getGoogleModelProvider, setGoogleModelProvider, GoogleModelProvider } from '../services/googleModelProvider';
import { UNSPLASH_ACCESS_KEY_STORAGE_KEY } from '../services/unsplashService';
import { connectMidjourney, disconnectMidjourney, getMidjourneyConcurrency, getMidjourneyStatus, isMidjourneyAgentAvailable, onMidjourneyEvent, setMidjourneyConcurrency, toggleMidjourneyWindow, type MidjourneyStatus } from '../services/midjourneyAgentService';
import { isLocalAgentsAvailable, listLocalAgents, openLocalAgentLogin, stopLocalAgent, type LocalAgentInfo } from '../services/localAgentsService';
import { HIGGSFIELD_API_KEY_STORAGE_KEY, getVideoProviderPreference, setVideoProviderPreference, type VideoProviderPreference } from '../services/higgsfieldService';

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
    const [soniloKey, setSoniloKey] = useState('');
    const [falKey, setFalKey] = useState('');
    const [ltxKey, setLtxKey] = useState('');
    const [runwayKey, setRunwayKey] = useState('');
    const [worldLabsKey, setWorldLabsKey] = useState('');
    const [braveSearchKey, setBraveSearchKey] = useState('');
    const [unsplashKey, setUnsplashKey] = useState('');
    const [higgsfieldKey, setHiggsfieldKey] = useState('');
    const [higgsfieldSaved, setHiggsfieldSaved] = useState(false);
    const [videoProvider, setVideoProvider] = useState<VideoProviderPreference>(() => getVideoProviderPreference());
    const [dropboxClientId, setDropboxClientId] = useState('');
    const [googleDriveClientId, setGoogleDriveClientId] = useState('');
    const [error, setError] = useState('');
    const [cloudError, setCloudError] = useState('');
    const [googleSaved, setGoogleSaved] = useState(false);
    const [replicateSaved, setReplicateSaved] = useState(false);
    const [xaiSaved, setXaiSaved] = useState(false);
    const [elevenLabsSaved, setElevenLabsSaved] = useState(false);
    const [sonautoSaved, setSonautoSaved] = useState(false);
    const [soniloSaved, setSoniloSaved] = useState(false);
    const [falSaved, setFalSaved] = useState(false);
    const [ltxSaved, setLtxSaved] = useState(false);
    const [runwaySaved, setRunwaySaved] = useState(false);
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
        const storedSonilo = localStorage.getItem('sonilo_api_key');
        const storedFal = localStorage.getItem('fal_api_key');
        const storedLtx = localStorage.getItem('ltx_api_key');
        const storedRunway = localStorage.getItem('runway_api_key');
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
        if (storedSonilo) {
            setSoniloKey(storedSonilo);
            setSoniloSaved(true);
        }
        if (storedFal) {
            setFalKey(storedFal);
            setFalSaved(true);
        }
        if (storedLtx) {
            setLtxKey(storedLtx);
            setLtxSaved(true);
        }
        if (storedRunway) {
            setRunwayKey(storedRunway);
            setRunwaySaved(true);
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
        const storedHiggsfield = localStorage.getItem(HIGGSFIELD_API_KEY_STORAGE_KEY);
        if (storedHiggsfield) {
            setHiggsfieldKey(storedHiggsfield);
            setHiggsfieldSaved(true);
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
        if (!googleKey.trim() && !replicateKey.trim() && !xaiKey.trim() && !elevenLabsKey.trim() && !sonautoKey.trim() && !soniloKey.trim() && !falKey.trim() && !ltxKey.trim() && !runwayKey.trim() && !worldLabsKey.trim() && !braveSearchKey.trim() && !unsplashKey.trim() && !hasCloudConfig) {
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

        if (soniloKey.trim()) {
            localStorage.setItem('sonilo_api_key', soniloKey.trim());
        } else {
            localStorage.removeItem('sonilo_api_key');
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

        if (runwayKey.trim()) {
            localStorage.setItem('runway_api_key', runwayKey.trim());
        } else {
            localStorage.removeItem('runway_api_key');
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

        if (higgsfieldKey.trim()) {
            localStorage.setItem(HIGGSFIELD_API_KEY_STORAGE_KEY, higgsfieldKey.trim());
            setHiggsfieldSaved(true);
        } else {
            localStorage.removeItem(HIGGSFIELD_API_KEY_STORAGE_KEY);
            setHiggsfieldSaved(false);
        }
        setVideoProviderPreference(videoProvider);

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

    type SettingsSection = 'providers' | 'agents' | 'cloud' | 'shortcuts' | 'startup' | 'autosave';
    const [section, setSection] = useState<SettingsSection>('providers');
    const [showAllProviders, setShowAllProviders] = useState(false);
    const [mjStatus, setMjStatus] = useState<MidjourneyStatus>({ available: isMidjourneyAgentAvailable(), connected: false });
    const [mjConcurrency, setMjConcurrency] = useState<number>(() => getMidjourneyConcurrency());
    const [mjBusy, setMjBusy] = useState<'connect' | 'disconnect' | null>(null);
    const [mjWindowOpen, setMjWindowOpen] = useState(false);
    const [localAgents, setLocalAgents] = useState<LocalAgentInfo[]>([]);
    const refreshLocalAgents = () => { if (isLocalAgentsAvailable()) listLocalAgents().then(setLocalAgents); };
    useEffect(() => { refreshLocalAgents(); }, []);
    useEffect(() => {
        if (!isMidjourneyAgentAvailable()) return;
        let cancelled = false;
        getMidjourneyStatus().then((next) => { if (!cancelled) setMjStatus(next); });
        const off = onMidjourneyEvent((event) => {
            if (event.type === 'status') setMjStatus((prev) => ({ ...prev, available: true, connected: Boolean(event.connected) }));
            if (event.type === 'window') setMjWindowOpen(Boolean(event.visible));
        });
        return () => { cancelled = true; off(); };
    }, []);
    const handleMidjourneyConnect = async () => {
        setMjBusy('connect');
        try { setMjStatus(await connectMidjourney()); } finally { setMjBusy(null); }
    };
    const handleMidjourneyDisconnect = async () => {
        setMjBusy('disconnect');
        try { setMjStatus(await disconnectMidjourney()); } finally { setMjBusy(null); }
    };

    type ProviderRow = {
        id: string;
        label: string;
        value: string;
        setValue: (value: string) => void;
        saved: boolean;
        setSaved: (value: boolean) => void;
        placeholder: string;
        usedFor: string;
        href: string;
        hrefLabel: string;
        essential?: boolean;
    };
    const providers: ProviderRow[] = [
        { id: 'google', label: 'Google Gemini', value: googleKey, setValue: setGoogleKey, saved: googleSaved, setSaved: setGoogleSaved, placeholder: 'AIzaSy…', usedFor: 'Script, Imagen, TTS and the AI Writer.', href: 'https://aistudio.google.com/app/apikey', hrefLabel: 'aistudio.google.com', essential: true },
        { id: 'fal', label: 'fal.ai', value: falKey, setValue: setFalKey, saved: falSaved, setSaved: setFalSaved, placeholder: 'fal_…', usedFor: 'GPT Image, Seedream, Wan, Kling, Seedance and most video models.', href: 'https://fal.ai/dashboard/api-keys', hrefLabel: 'fal.ai', essential: true },
        { id: 'replicate', label: 'Replicate', value: replicateKey, setValue: setReplicateKey, saved: replicateSaved, setSaved: setReplicateSaved, placeholder: 'r8_…', usedFor: 'Flux, upscaling, Lyria music, Demucs stems.', href: 'https://replicate.com/account/api-tokens', hrefLabel: 'replicate.com', essential: true },
        { id: 'elevenlabs', label: 'ElevenLabs', value: elevenLabsKey, setValue: setElevenLabsKey, saved: elevenLabsSaved, setSaved: setElevenLabsSaved, placeholder: 'sk-…', usedFor: 'Voiceovers.', href: 'https://elevenlabs.io/app/settings/api-keys', hrefLabel: 'elevenlabs.io', essential: true },
        { id: 'xai', label: 'xAI Grok', value: xaiKey, setValue: setXaiKey, saved: xaiSaved, setSaved: setXaiSaved, placeholder: 'xai_…', usedFor: 'Grok image and video generation.', href: 'https://console.x.ai/', hrefLabel: 'console.x.ai' },
        { id: 'sonauto', label: 'Sonauto', value: sonautoKey, setValue: setSonautoKey, saved: sonautoSaved, setSaved: setSonautoSaved, placeholder: 'sa_…', usedFor: 'Full-song music generation.', href: 'https://sonauto.ai/developers', hrefLabel: 'sonauto.ai' },
        { id: 'sonilo', label: 'Sonilo', value: soniloKey, setValue: setSoniloKey, saved: soniloSaved, setSaved: setSoniloSaved, placeholder: 'sk-…', usedFor: 'Licensed music and SFX nodes in Node Space.', href: 'https://platform.sonilo.com/dashboard/api-keys', hrefLabel: 'platform.sonilo.com' },
        { id: 'ltx', label: 'LTX', value: ltxKey, setValue: setLtxKey, saved: ltxSaved, setSaved: setLtxSaved, placeholder: 'LTX API key', usedFor: 'Color Science upscale to ACES HDR EXR.', href: 'https://console.ltx.video', hrefLabel: 'console.ltx.video' },
        { id: 'runway', label: 'Runway', value: runwayKey, setValue: setRunwayKey, saved: runwaySaved, setSaved: setRunwaySaved, placeholder: 'Runway API key', usedFor: 'Ruby: SDR video to true HDR.', href: 'https://dev.runwayml.com', hrefLabel: 'dev.runwayml.com' },
        { id: 'worldlabs', label: 'World Labs', value: worldLabsKey, setValue: setWorldLabsKey, saved: worldLabsSaved, setSaved: setWorldLabsSaved, placeholder: 'WLT-…', usedFor: '3D world generation (Marble).', href: 'https://platform.worldlabs.ai/', hrefLabel: 'platform.worldlabs.ai' },
        { id: 'brave', label: 'Brave Search', value: braveSearchKey, setValue: setBraveSearchKey, saved: braveSearchSaved, setSaved: setBraveSearchSaved, placeholder: 'BSA_…', usedFor: 'Web, news and image research for the Studio Agent.', href: 'https://api-dashboard.search.brave.com/', hrefLabel: 'api-dashboard.search.brave.com' },
        { id: 'higgsfield', label: 'Higgsfield', value: higgsfieldKey, setValue: setHiggsfieldKey, saved: higgsfieldSaved, setSaved: setHiggsfieldSaved, placeholder: 'KEY_ID:KEY_SECRET', usedFor: 'Soul / Soul Cinema / DoP, and a second host for Kling 3, MiniMax, Wan 3, LTX 2.5, PixVerse.', href: 'https://console.higgsfield.ai', hrefLabel: 'console.higgsfield.ai' },
        { id: 'unsplash', label: 'Unsplash', value: unsplashKey, setValue: setUnsplashKey, saved: unsplashSaved, setSaved: setUnsplashSaved, placeholder: 'Unsplash Access Key', usedFor: 'Stock library search. Access Key only, never the Secret Key.', href: 'https://unsplash.com/developers', hrefLabel: 'unsplash.com/developers' },
    ];
    const connectedCount = providers.filter((row) => row.value.trim()).length;
    const essentialMissing = providers.filter((row) => row.essential && !row.value.trim()).length;
    const visibleProviders = showAllProviders ? providers : providers.filter((row) => row.essential || row.value.trim());
    const hiddenCount = providers.length - visibleProviders.length;

    const renderProvider = (row: ProviderRow) => {
        const has = row.value.trim().length > 0;
        return (
            <div key={row.id} className={`settings-provider ${has ? 'settings-provider--on' : ''}`}>
                <div className="settings-provider__head">
                    <div className="settings-provider__name">
                        <span className={`settings-provider__dot ${has ? 'settings-provider__dot--on' : ''}`} aria-hidden="true" />
                        <strong>{row.label}</strong>
                        {row.essential && !has && <span className="pk-chip pk-chip--warn">recommended</span>}
                        {has && row.saved && <span className="pk-chip pk-chip--ok"><CheckCircleIcon className="w-3 h-3" />saved</span>}
                        {has && !row.saved && <span className="pk-chip pk-chip--accent">unsaved</span>}
                    </div>
                    <a className="settings-provider__link" href={row.href} target="_blank" rel="noreferrer">Get a key ↗</a>
                </div>
                <label className="settings-provider__field">
                    <LockIcon className="w-3.5 h-3.5" />
                    <input
                        type="password"
                        value={row.value}
                        onChange={(e) => { row.setValue(e.target.value); row.setSaved(false); }}
                        placeholder={row.placeholder}
                        aria-label={`${row.label} API key`}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </label>
                <p className="pk-hint">{row.usedFor}</p>
                {row.id === 'higgsfield' && (
                    <div className="pk-field settings-provider__extra">
                        <span>Video host for shared models</span>
                        <div className="pk-seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                            {(['auto', 'fal', 'higgsfield'] as VideoProviderPreference[]).map((option) => (
                                <button key={option} type="button" aria-pressed={videoProvider === option} onClick={() => setVideoProvider(option)}>{option === 'auto' ? 'Auto' : option === 'fal' ? 'fal.ai' : 'Higgsfield'}</button>
                            ))}
                        </div>
                        <span className="pk-hint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>Auto uses fal when a fal key is set, otherwise Higgsfield. Applies to Kling 3, MiniMax, Wan 3, LTX 2.5 and PixVerse.</span>
                    </div>
                )}
                {row.id === 'google' && (
                    <label className="pk-field settings-provider__extra">
                        <span>Run Google models via</span>
                        <select value={googleProvider} onChange={(e) => setGoogleProvider(e.target.value as GoogleModelProvider)}>
                            <option value="gemini">Gemini (AI Studio)</option>
                            <option value="replicate">Replicate</option>
                        </select>
                        <span className="pk-hint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>Replicate makes Gemini 3 Pro + Veo work without a Gemini key.</span>
                    </label>
                )}
            </div>
        );
    };

    const renderCloud = (kind: 'dropbox' | 'google-drive', label: string, value: string, setValue: (v: string) => void, saved: boolean, setSaved: (v: boolean) => void, connected: boolean) => (
        <div className={`settings-provider ${connected ? 'settings-provider--on' : ''}`}>
            <div className="settings-provider__head">
                <div className="settings-provider__name">
                    <span className={`settings-provider__dot ${connected ? 'settings-provider__dot--on' : ''}`} aria-hidden="true" />
                    <strong>{label}</strong>
                    <span className={`pk-chip ${connected ? 'pk-chip--ok' : ''}`}>{connected ? 'connected' : 'not connected'}</span>
                    {saved && !connected && <span className="pk-chip"><CheckCircleIcon className="w-3 h-3" />client id saved</span>}
                </div>
                <span className="pk-actions">
                    {connected ? (
                        <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => handleDisconnect(kind)}>Disconnect</button>
                    ) : (
                        <button type="button" className="edit-text-btn edit-text-btn--primary" onClick={() => handleConnect(kind)} disabled={!value.trim()}>Connect</button>
                    )}
                </span>
            </div>
            <label className="settings-provider__field">
                <FolderIcon className="w-3.5 h-3.5" />
                <input type="text" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} placeholder={`${label} OAuth client ID`} aria-label={`${label} client ID`} spellCheck={false} />
            </label>
            <p className="pk-hint">Redirect URI: <code className="pk-mono">{typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : 'app://local'}</code></p>
        </div>
    );

    const nav: Array<{ id: SettingsSection; label: string; hint: string; icon: React.FC<{ className?: string }> }> = [
        { id: 'providers', label: 'AI providers', hint: `${connectedCount} of ${providers.length} connected`, icon: SparklesIcon },
        { id: 'agents', label: 'Local agents', hint: localAgents.some((a) => a.installed) ? localAgents.filter((a) => a.installed).map((a) => a.label).join(', ') : 'Claude Code, Codex', icon: KeyboardIcon },
        { id: 'cloud', label: 'Cloud', hint: dropboxConnected || googleDriveConnected ? 'connected' : 'Dropbox, Google Drive', icon: FolderIcon },
        { id: 'shortcuts', label: 'Shortcuts', hint: 'keyboard', icon: KeyboardIcon },
        { id: 'startup', label: 'Startup', hint: 'workspace, assistant', icon: SettingsIcon },
        { id: 'autosave', label: 'Autosave', hint: autosaveValues.enabled ? 'on' : 'off', icon: InfoIcon },
    ];

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="settings">
                <aside className="settings__nav">
                    <div className="settings__brand">
                        <h2 id="settings-title">Settings</h2>
                        <p className="pk-hint">{onClose ? 'Keys stay on this machine.' : 'Add one key to start creating.'}</p>
                    </div>
                    <nav className="settings__list" aria-label="Settings sections">
                        {nav.map((item) => (
                            <button key={item.id} type="button" className={`settings__item ${section === item.id ? 'settings__item--active' : ''}`} onClick={() => setSection(item.id)} aria-current={section === item.id ? 'page' : undefined}>
                                <item.icon className="w-4 h-4" />
                                <span><strong>{item.label}</strong><small>{item.hint}</small></span>
                            </button>
                        ))}
                    </nav>
                    {onClose && <button type="button" className="edit-text-btn settings__close" onClick={onClose}>Close</button>}
                </aside>

                <div className="settings__main">
                    <div className="settings__scroll">
                        {section === 'providers' && (
                            <div className="pk-stack">
                                <div className="settings__head">
                                    <h3>AI providers</h3>
                                    <p className="pk-hint">
                                        {essentialMissing === 0
                                            ? 'Everything essential is connected. Add more providers as you need their models.'
                                            : `Add ${essentialMissing === 4 ? 'a Gemini or fal.ai key' : 'the remaining recommended keys'} to unlock generation. Keys are stored locally and never sent anywhere but the provider.`}
                                    </p>
                                </div>
                                <div className="settings__providers">
                                    <div className={`settings-provider ${mjStatus.connected ? 'settings-provider--on' : ''}`}>
                                        <div className="settings-provider__head">
                                            <div className="settings-provider__name">
                                                <span className={`settings-provider__dot ${mjStatus.connected ? 'settings-provider__dot--on' : ''}`} aria-hidden="true" />
                                                <strong>Midjourney · Jeff</strong>
                                                <span className={`pk-chip ${mjStatus.connected ? 'pk-chip--ok' : ''}`}>{!mjStatus.available ? 'desktop app only' : mjStatus.connected ? 'signed in' : 'not signed in'}</span>
                                                {mjStatus.busy && <span className="pk-chip pk-chip--accent">{mjStatus.running ? `${mjStatus.running} rendering` : 'working'}{mjStatus.waiting ? ` · ${mjStatus.waiting} waiting` : ''}</span>}
                                            </div>
                                            <span className="pk-actions">
                                                {mjStatus.available && mjStatus.connected && (
                                                    <button type="button" className="edit-text-btn" onClick={async () => setMjWindowOpen((await toggleMidjourneyWindow(!mjWindowOpen)).visible)}>{mjWindowOpen ? 'Hide window' : 'Show window'}</button>
                                                )}
                                                {mjStatus.available && (mjStatus.connected ? (
                                                    <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={handleMidjourneyDisconnect} disabled={mjBusy !== null}>{mjBusy === 'disconnect' ? 'Signing out…' : 'Sign out'}</button>
                                                ) : (
                                                    <button type="button" className="edit-text-btn edit-text-btn--primary" onClick={handleMidjourneyConnect} disabled={mjBusy !== null}>{mjBusy === 'connect' ? 'Waiting for sign-in…' : 'Sign in'}</button>
                                                ))}
                                            </span>
                                        </div>
                                        <p className="pk-hint">
                                            No API key — Jeff is a background browser that uses your own Midjourney account. Sign in once (Google or Discord) in the window that opens; after that Concept and Storyboard can pick “Midjourney · Jeff” as the image model and everything runs unattended. Automation is against Midjourney’s terms; use at your own risk.
                                        </p>
                                        {mjStatus.error && <p className="pk-hint" style={{ color: 'var(--app-danger)' }}>{mjStatus.error}</p>}
                                        {mjStatus.available && (
                                            <div className="pk-field settings-provider__extra">
                                                <span>Parallel jobs</span>
                                                <div className="pk-seg" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
                                                    {[1, 2, 3, 4, 5, 6].map((count) => (
                                                        <button key={count} type="button" aria-pressed={mjConcurrency === count} onClick={() => setMjConcurrency(setMidjourneyConcurrency(count))}>{count}</button>
                                                    ))}
                                                </div>
                                                <span className="pk-hint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>How many jobs Jeff keeps rendering at once. Basic and Standard plans allow 3 fast jobs, Pro 12; more than your plan allows just queues at Midjourney.</span>
                                            </div>
                                        )}
                                    </div>
                                    {visibleProviders.map(renderProvider)}
                                </div>
                                {hiddenCount > 0 && (
                                    <button type="button" className="edit-text-btn edit-text-btn--outline self-start" onClick={() => setShowAllProviders(true)}>Show {hiddenCount} more provider{hiddenCount === 1 ? '' : 's'}</button>
                                )}
                                {showAllProviders && hiddenCount === 0 && providers.some((row) => !row.essential && !row.value.trim()) && (
                                    <button type="button" className="edit-text-btn self-start" onClick={() => setShowAllProviders(false)}>Show fewer</button>
                                )}
                            </div>
                        )}

                        {section === 'agents' && (
                            <div className="pk-stack">
                                <div className="settings__head settings__head--row">
                                    <div>
                                        <h3>Local agents</h3>
                                        <p className="pk-hint">Claude Code and Codex run as agents inside the editor, signed in with their own CLI login — no API key, no token copied. They get the editor's tools and can operate the timeline, the project hub and generation for you.</p>
                                    </div>
                                    <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={refreshLocalAgents}>Refresh</button>
                                </div>
                                {!isLocalAgentsAvailable() && <div className="pk-alert pk-alert--info">Local agents are available in the desktop app only.</div>}
                                <div className="settings__providers">
                                    {localAgents.map((agent) => (
                                        <div key={agent.id} className={`settings-provider ${agent.installed ? 'settings-provider--on' : ''}`}>
                                            <div className="settings-provider__head">
                                                <div className="settings-provider__name">
                                                    <span className={`settings-provider__dot ${agent.installed ? 'settings-provider__dot--on' : ''}`} aria-hidden="true" />
                                                    <strong>{agent.label}</strong>
                                                    <span className={`pk-chip ${agent.installed ? 'pk-chip--ok' : 'pk-chip--warn'}`}>{agent.installed ? (agent.version || 'installed') : 'not installed'}</span>
                                                    {agent.installed && <span className="pk-chip">{agent.login === 'signed-in' ? 'signed in' : agent.login === 'likely' ? 'login found' : 'sign-in unknown'}</span>}
                                                    {agent.running && <span className="pk-chip pk-chip--accent">running</span>}
                                                    {!agent.adapterAvailable && <span className="pk-chip pk-chip--warn">adapter missing</span>}
                                                </div>
                                                <span className="pk-actions">
                                                    {agent.installed && <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => { void openLocalAgentLogin(agent.id); }}>Sign in in Terminal</button>}
                                                    {agent.running && <button type="button" className="edit-text-btn" onClick={() => { void stopLocalAgent(agent.id)?.then(refreshLocalAgents); }}>Stop</button>}
                                                </span>
                                            </div>
                                            <p className="pk-hint">{agent.installed ? `${agent.binary}` : agent.loginHint}</p>
                                            {agent.installed && agent.login !== 'signed-in' && <p className="pk-hint">{agent.loginHint}</p>}
                                        </div>
                                    ))}
                                </div>
                                <p className="pk-hint">Pick the agent at the top of the Assistant panel. The editor's tools are offered to it as an MCP server; anything else the agent wants to do (edit files, run commands) asks you first.</p>
                            </div>
                        )}

                        {section === 'cloud' && (
                            <div className="pk-stack">
                                <div className="settings__head">
                                    <h3>Cloud storage</h3>
                                    <p className="pk-hint">Paste an OAuth client ID, save, then connect. Files stay in your own account.</p>
                                </div>
                                <div className="settings__providers">
                                    {renderCloud('dropbox', 'Dropbox', dropboxClientId, setDropboxClientId, dropboxSaved, setDropboxSaved, dropboxConnected)}
                                    {renderCloud('google-drive', 'Google Drive', googleDriveClientId, setGoogleDriveClientId, googleDriveSaved, setGoogleDriveSaved, googleDriveConnected)}
                                </div>
                                {cloudError && <div className="pk-alert pk-alert--danger">{cloudError}</div>}
                            </div>
                        )}

                        {section === 'shortcuts' && (
                            <div className="pk-stack">
                                <div className="settings__head settings__head--row">
                                    <div>
                                        <h3>Keyboard shortcuts</h3>
                                        <p className="pk-hint">Format: mod+shift+p, ctrl+k, cmd+1. Leave a field empty to disable it.</p>
                                    </div>
                                    <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={handleResetShortcuts}>Reset to defaults</button>
                                </div>
                                <div className="pk-list">
                                    {SHORTCUT_DEFINITIONS.map((shortcut) => (
                                        <label key={shortcut.id} className="pk-row settings__shortcut">
                                            <span className="pk-row__body">
                                                <span className="pk-row__title">{shortcut.label}</span>
                                                <span className="pk-row__meta">{shortcut.description}</span>
                                            </span>
                                            <input className="pk-mono" value={shortcutValues[shortcut.id] || ''} onChange={(e) => handleShortcutChange(shortcut.id, e.target.value)} placeholder="disabled" aria-label={`${shortcut.label} shortcut`} spellCheck={false} />
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {section === 'startup' && (
                            <div className="pk-stack">
                                <div className="settings__head">
                                    <h3>Startup &amp; assistant</h3>
                                    <p className="pk-hint">What you see first, and how much the assistant does on its own.</p>
                                </div>
                                <div className="pk-card">
                                    <label className="pk-field">
                                        <span>Open on launch</span>
                                        <select value={startupValues.startupWorkspace} onChange={(e) => updateStartupPreferences({ startupWorkspace: e.target.value as Workspace })}>
                                            <option value="PROJECT">Project Hub</option>
                                            <option value="IMAGE_GEN">Images</option>
                                            <option value="VIDEO_GEN">Video</option>
                                            <option value="MOODBOARD">Moodboard</option>
                                            <option value="EDIT">Edit timeline</option>
                                        </select>
                                    </label>
                                    <label className="pk-switch">
                                        <span><span className="pk-card__title" style={{ display: 'block' }}>Open the assistant automatically</span><span className="pk-hint">Shows the assistant panel when the app starts.</span></span>
                                        <input type="checkbox" checked={startupValues.autoOpenAssistant} onChange={(e) => updateStartupPreferences({ autoOpenAssistant: e.target.checked })} />
                                    </label>
                                </div>
                                <div className="pk-card">
                                    <div className="pk-field">
                                        <span>Studio agent</span>
                                        <div className="pk-seg" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                            <button type="button" aria-pressed={startupValues.studioAgentMode === 'agent'} onClick={() => updateStartupPreferences({ studioAgentMode: 'agent' })}>Agent mode</button>
                                            <button type="button" aria-pressed={startupValues.studioAgentMode === 'manual'} onClick={() => updateStartupPreferences({ studioAgentMode: 'manual' })}>Manual only</button>
                                        </div>
                                    </div>
                                    <div className="pk-field">
                                        <span>Ask before acting</span>
                                        <div className="pk-seg" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                            <button type="button" aria-pressed={startupValues.studioAgentApprovalMode === 'important_only'} onClick={() => updateStartupPreferences({ studioAgentApprovalMode: 'important_only' })}>Important decisions</button>
                                            <button type="button" aria-pressed={startupValues.studioAgentApprovalMode === 'every_action'} onClick={() => updateStartupPreferences({ studioAgentApprovalMode: 'every_action' })}>Every action</button>
                                        </div>
                                    </div>
                                </div>
                                <div className="pk-card pk-card--quiet">
                                    <div className="pk-card__head">
                                        <span><span className="pk-card__title" style={{ display: 'block' }}>Welcome walkthrough</span><span className="pk-hint">Replay the first-run tour any time.</span></span>
                                        <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => onRestartOnboarding?.()}>Start again</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {section === 'autosave' && (
                            <div className="pk-stack">
                                <div className="settings__head">
                                    <h3>Autosave</h3>
                                    <p className="pk-hint">Saves the project folder in the background after you stop editing.</p>
                                </div>
                                <div className="pk-card">
                                    <label className="pk-switch">
                                        <span><span className="pk-card__title" style={{ display: 'block' }}>Autosave</span><span className="pk-hint">Write changes to the project folder automatically.</span></span>
                                        <input type="checkbox" checked={autosaveValues.enabled} onChange={(e) => updateAutosaveSettings({ enabled: e.target.checked })} />
                                    </label>
                                    <label className="pk-switch">
                                        <span><span className="pk-card__title" style={{ display: 'block' }}>Offer recovery after a crash</span><span className="pk-hint">Restores the last autosave after an unclean shutdown.</span></span>
                                        <input type="checkbox" checked={autosaveValues.recoverOnCrash} onChange={(e) => updateAutosaveSettings({ recoverOnCrash: e.target.checked })} />
                                    </label>
                                </div>
                                <div className="pk-card">
                                    <label className="pk-inline">Wait after the last edit
                                        <input type="number" min={3} max={180} value={Math.round(autosaveValues.debounceMs / 1000)} onChange={(e) => { const seconds = Math.max(3, Math.min(180, Number(e.target.value) || 20)); updateAutosaveSettings({ debounceMs: seconds * 1000 }); }} disabled={!autosaveValues.enabled} />s
                                    </label>
                                    <label className="pk-inline">At most one save every
                                        <input type="number" min={15} max={900} value={Math.round(autosaveValues.minIntervalMs / 1000)} onChange={(e) => { const seconds = Math.max(15, Math.min(900, Number(e.target.value) || 60)); updateAutosaveSettings({ minIntervalMs: seconds * 1000 }); }} disabled={!autosaveValues.enabled} />s
                                    </label>
                                </div>
                            </div>
                        )}
                    </div>

                    <footer className="settings__footer">
                        {error ? <span className="settings__error">{error}</span> : <span className="pk-hint">{connectedCount} provider{connectedCount === 1 ? '' : 's'} connected</span>}
                        <button type="button" onClick={handleSaveKey} className="app-button app-primary">
                            {onClose ? 'Save' : 'Save & start'}
                        </button>
                    </footer>
                </div>
            </div>
        </div>
    );
};

export default ApiKeyModal;
