
import React, { useState } from 'react';
import { AppLogoIcon, UndoIcon, RedoIcon, InfoIcon, SettingsIcon, FolderIcon } from './icons';
import { Theme, User, UserProfile } from '../types';
import { UIMode, UI_MODE_META } from '../config/uiModes';

interface HeaderProps {
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    projectName?: string | null;
    projectPath?: string | null;
    lastSavedAt?: string | null;
    lastAutoSavedAt?: string | null;
    isProjectSaving?: boolean;
    isAutoSaving?: boolean;
    isProjectLoading?: boolean;
    onSelectProjectFolder?: () => void;
    onSaveProject?: () => void;
    onOpenProjectFolder?: () => void;
    onCloseProject?: () => void;
    user?: User | null;
    onLogout?: () => void;
    onOpenAbout?: () => void;
    onOpenSettings?: () => void;
    onOpenPricing?: () => void;
    onOpenDesignSystem?: () => void;
    canOpenDesignSystem?: boolean;
    theme?: Theme;
    onSelectTheme?: (theme: Theme) => void;
    uiMode: UIMode;
    onSelectUIMode: (mode: UIMode) => void;
    profiles?: UserProfile[];
    activeProfileId?: string | null;
    onSelectProfile?: (id: string) => void;
    onCreateProfile?: (name: string, role: UserProfile['role']) => void;
    onUpdateProfileRole?: (id: string, role: UserProfile['role']) => void;
    planLabel?: string;
    creditBalance?: number | null;
    auxiliaryContent?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    projectName,
    projectPath,
    lastSavedAt,
    lastAutoSavedAt,
    isProjectSaving,
    isAutoSaving,
    isProjectLoading,
    onSelectProjectFolder,
    onSaveProject,
    onOpenProjectFolder,
    onCloseProject,
    user,
    onLogout,
    onOpenAbout,
    onOpenSettings,
    onOpenPricing,
    onOpenDesignSystem,
    canOpenDesignSystem = true,
    theme = 'dark',
    onSelectTheme,
    uiMode,
    onSelectUIMode,
    profiles,
    activeProfileId,
    onSelectProfile,
    onCreateProfile,
    onUpdateProfileRole,
    planLabel,
    creditBalance,
    auxiliaryContent,
}) => {
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [showProjectMenu, setShowProjectMenu] = useState(false);
    const [newProfileName, setNewProfileName] = useState('');
    const [newProfileRole, setNewProfileRole] = useState<UserProfile['role']>('artist');

    const formattedSavedAt = lastSavedAt ? new Date(lastSavedAt).toLocaleString() : null;
    const formattedAutoSavedAt = lastAutoSavedAt ? new Date(lastAutoSavedAt).toLocaleString() : null;
    const projectStatus = isProjectLoading
        ? { label: 'Loading', tone: 'busy' }
        : isProjectSaving
            ? { label: 'Saving', tone: 'busy' }
            : isAutoSaving
                ? { label: 'Auto-saving', tone: 'busy' }
                : projectPath
                    ? { label: 'Saved', tone: 'ready' }
                    : { label: 'No folder', tone: 'attention' };
    const themeOptions: Array<{ id: Theme; label: string }> = [
        { id: 'dark', label: 'Dark' },
        { id: 'light', label: 'Light' },
        { id: 'fantasy', label: 'Fantasy' },
        { id: 'cyberpunk', label: 'Neon Racer' },
        { id: 'studio', label: 'Studio' },
        { id: 'cinematic', label: 'Cinematic Indigo' },
    ];
    const uiModeOptions: Array<{ id: UIMode; label: string; description: string; emoji: string }> = [
        { id: 'beginner', label: UI_MODE_META.beginner.label, description: UI_MODE_META.beginner.description, emoji: UI_MODE_META.beginner.emoji },
        { id: 'advanced', label: UI_MODE_META.advanced.label, description: UI_MODE_META.advanced.description, emoji: UI_MODE_META.advanced.emoji },
        { id: 'pro', label: UI_MODE_META.pro.label, description: UI_MODE_META.pro.description, emoji: UI_MODE_META.pro.emoji },
    ];

    return (
        <header className="app-header px-4 py-3 sticky top-0 z-50">
            <div className="container mx-auto">
                <div className="header-main flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="app-logo-mark">
                            <AppLogoIcon className="w-7 h-7 app-logo" />
                        </div>
                        <div className="header-brand">
                            <p className="header-brand__eyebrow">Creative Studio</p>
                            <h1 className="text-xl font-semibold app-title">AI Video Production Editor</h1>
                            <p className="header-brand__subtitle">Plan, create, edit, and export in one workspace.</p>
                        </div>
                    </div>
                    <div className="header-actions flex items-center gap-3">
                        <div className="flex items-center gap-2 border-r pr-4 app-divider">
                            <button
                                onClick={onUndo}
                                disabled={!canUndo}
                                className="app-icon-button p-2"
                                aria-label="Undo last action"
                                title="Undo (Cmd/Ctrl+Z)"
                            >
                                <UndoIcon className="w-6 h-6" />
                            </button>
                            <button
                                onClick={onRedo}
                                disabled={!canRedo}
                                className="app-icon-button p-2"
                                aria-label="Redo last action"
                                title="Redo (Cmd+Shift+Z/Ctrl+Y)"
                            >
                                <RedoIcon className="w-6 h-6" />
                            </button>
                        </div>

                        {planLabel && (
                            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full app-chip">
                                <span>{planLabel}</span>
                                {typeof creditBalance === 'number' && (
                                    <span className="app-chip__meta">· €{creditBalance.toFixed(2)}</span>
                                )}
                            </div>
                        )}

                        <div className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-xl app-chip">
                            <span className="app-menu-title !text-[10px]">Mode</span>
                            <select
                                className="app-select app-select--compact"
                                value={uiMode}
                                onChange={(event) => onSelectUIMode(event.target.value as UIMode)}
                                aria-label="Select interface mode"
                            >
                                {uiModeOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                        {option.emoji} {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="relative header-project-menu">
                            <button
                                onClick={() => setShowProjectMenu(!showProjectMenu)}
                                className="app-button app-project-button"
                                aria-label="Project menu"
                                aria-haspopup="menu"
                                aria-expanded={showProjectMenu}
                            >
                                <FolderIcon className="w-5 h-5" />
                                <span className="app-project-button__text">
                                    <span className="app-project-button__label">Project</span>
                                    <span className="app-project-button__name">{projectName || 'Choose project'}</span>
                                </span>
                                <span className={`app-status-pill app-status-pill--${projectStatus.tone}`}>
                                    <span className="app-status-pill__dot" />
                                    {projectStatus.label}
                                </span>
                            </button>

                            {showProjectMenu && (
                                <div className="absolute right-0 mt-2 w-80 app-menu app-menu--project z-50 animate-fadeIn" role="menu">
                                    <div className="px-4 py-3 border-b app-divider">
                                        <p className="app-menu-title">Active Project</p>
                                        <p className="app-menu-strong truncate">{projectName || 'Untitled Project'}</p>
                                        <p className="text-xs app-muted truncate">{projectPath || 'No project folder selected yet.'}</p>
                                        {formattedSavedAt && (
                                            <p className="text-[10px] app-muted mt-1">Last saved {formattedSavedAt}</p>
                                        )}
                                        {formattedAutoSavedAt && (
                                            <p className="text-[10px] app-muted mt-1">Auto-saved {formattedAutoSavedAt}</p>
                                        )}
                                    </div>
                                    <div className="py-2">
                                        <button
                                            onClick={() => { onSelectProjectFolder?.(); setShowProjectMenu(false); }}
                                            className="app-menu-item"
                                        >
                                            Choose Project Folder
                                        </button>
                                        <button
                                            onClick={() => { onSaveProject?.(); setShowProjectMenu(false); }}
                                            disabled={!projectPath || isProjectSaving}
                                            className="app-menu-item disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Save Project
                                        </button>
                                        <button
                                            onClick={() => { onOpenProjectFolder?.(); setShowProjectMenu(false); }}
                                            disabled={!projectPath}
                                            className="app-menu-item disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Reveal Folder
                                        </button>
                                        {projectPath && (
                                            <button
                                                onClick={() => { onCloseProject?.(); setShowProjectMenu(false); }}
                                                className="app-menu-item app-menu-item--danger"
                                            >
                                                Close Project
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {user && (
                            <div className="relative header-profile-menu">
                                <button
                                    onClick={() => setShowProfileMenu(!showProfileMenu)}
                                    className="app-profile-button"
                                    aria-haspopup="menu"
                                    aria-expanded={showProfileMenu}
                                >
                                    {user.avatarUrl ? (
                                        <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full border border-white/10" />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-sky-300 flex items-center justify-center text-xs font-bold text-slate-900">
                                            {user.name.charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <span className="app-profile-button__meta">
                                        <span className="app-profile-button__label">Signed in</span>
                                        <span className="app-profile-button__name">{user.name}</span>
                                    </span>
                                    <span className="app-badge">Workspace</span>
                                </button>

                                {showProfileMenu && (
                                    <div className="absolute right-0 mt-2 w-64 app-menu py-1 z-50 animate-fadeIn" role="menu">
                                    <div className="px-4 py-2 border-b app-divider">
                                        <p className="text-xs app-muted">Signed in as</p>
                                        <p className="app-menu-strong truncate">{user.email}</p>
                                    </div>

                                    {/* Profile Switcher */}
                                    {profiles && (
                                        <div className="px-4 py-2 border-b app-divider">
                                            <p className="text-[10px] app-muted uppercase tracking-wider mb-2">Profiles</p>
                                            <div className="space-y-2 max-h-36 overflow-y-auto">
                                                {profiles.map(p => (
                                                    <div key={p.id} className="flex items-center justify-between gap-2">
                                                        <button
                                                            onClick={() => { onSelectProfile?.(p.id); setShowProfileMenu(false); }}
                                                            className={`flex items-center justify-between w-full text-left text-xs ${activeProfileId === p.id ? 'text-sky-400 font-bold' : 'text-neutral-300 hover:text-white'}`}
                                                        >
                                                            <span>{p.name} {p.role ? `(${p.role})` : ''}</span>
                                                            {activeProfileId === p.id && <span>✓</span>}
                                                        </button>
                                                        <select
                                                            value={p.role || 'artist'}
                                                            onChange={(e) => onUpdateProfileRole?.(p.id, e.target.value as UserProfile['role'])}
                                                            className="app-select text-[10px] w-24"
                                                            title="Change role"
                                                        >
                                                            <option value="artist">artist</option>
                                                            <option value="director">director</option>
                                                        </select>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="mt-3 space-y-2">
                                                <input
                                                    className="app-input text-xs"
                                                    placeholder="New profile name"
                                                    value={newProfileName}
                                                    onChange={(e) => setNewProfileName(e.target.value)}
                                                />
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        className="app-select text-xs"
                                                        value={newProfileRole || 'artist'}
                                                        onChange={(e) => setNewProfileRole(e.target.value as UserProfile['role'])}
                                                    >
                                                        <option value="artist">artist</option>
                                                        <option value="director">director</option>
                                                    </select>
                                                    <button
                                                        onClick={() => {
                                                            if (!newProfileName.trim()) return;
                                                            onCreateProfile?.(newProfileName.trim(), newProfileRole || 'artist');
                                                            setNewProfileName('');
                                                            setNewProfileRole('artist');
                                                            setShowProfileMenu(false);
                                                        }}
                                                        className="app-button text-xs border border-slate-500/40"
                                                    >
                                                        Create
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <button onClick={() => { onOpenSettings?.(); setShowProfileMenu(false); }} className="app-menu-item flex items-center gap-2">
                                        <SettingsIcon className="w-4 h-4" /> Settings & API Keys
                                    </button>
                                    <button onClick={() => { onOpenPricing?.(); setShowProfileMenu(false); }} className="app-menu-item">
                                        Pricing & Usage
                                    </button>
                                    <button onClick={() => { onOpenAbout?.(); setShowProfileMenu(false); }} className="app-menu-item flex items-center gap-2">
                                        <InfoIcon className="w-4 h-4" /> About & Updates
                                    </button>
                                    {canOpenDesignSystem && (
                                        <button onClick={() => { onOpenDesignSystem?.(); setShowProfileMenu(false); }} className="app-menu-item">
                                            Design System
                                        </button>
                                    )}
                                    <div className="border-t app-divider my-1"></div>
                                    <div className="px-4 py-3">
                                        <p className="app-menu-title">Interface Mode</p>
                                        <select
                                            className="app-select text-xs mt-2"
                                            value={uiMode}
                                            onChange={(event) => onSelectUIMode(event.target.value as UIMode)}
                                            aria-label="Select interface mode"
                                        >
                                            {uiModeOptions.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.emoji} {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        <p className="text-[10px] app-muted mt-2">
                                            {uiModeOptions.find((option) => option.id === uiMode)?.description}
                                        </p>
                                    </div>
                                    <div className="border-t app-divider my-1"></div>
                                    <div className="px-4 py-3">
                                        <p className="app-menu-title">Theme</p>
                                        <select
                                            className="app-select text-xs mt-2"
                                            value={theme}
                                            onChange={(e) => onSelectTheme?.(e.target.value as Theme)}
                                            aria-label="Select theme"
                                        >
                                            {themeOptions.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="border-t app-divider my-1"></div>
                                    <button onClick={() => { onLogout?.(); setShowProfileMenu(false); }} className="app-menu-item app-menu-item--danger">Exit Studio</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                {auxiliaryContent}
            </div>
        </header>
    );
};

export default Header;
