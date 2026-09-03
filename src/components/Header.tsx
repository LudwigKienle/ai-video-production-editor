import React, { useEffect, useRef, useState } from 'react';
import { AppLogoIcon, UndoIcon, RedoIcon, InfoIcon, SettingsIcon, FolderIcon, ChevronRightIcon } from './icons';
import { Theme, User, UserProfile } from '../types';
import { UIMode, UI_MODE_META } from '../config/uiModes';

export type HeaderActivityTone = 'idle' | 'busy' | 'attention' | 'ready' | 'error';

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
    /** Rendered in a collapsible drawer under the toolbar (presence + agent). */
    auxiliaryContent?: React.ReactNode;
    sidebarCollapsed?: boolean;
    onToggleSidebar?: () => void;
    breadcrumb?: { group?: string; workspace?: string; description?: string };
    activity?: {
        open: boolean;
        onToggle: () => void;
        label: string;
        tone: HeaderActivityTone;
        /** 0-1 aggregate progress of running tasks; null hides the bar. */
        progress?: number | null;
    };
    projectMenuOpen?: boolean;
    onProjectMenuOpenChange?: (open: boolean) => void;
}

const SidebarToggleIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5" />
        <path d="M7.5 3.75v12.5" />
    </svg>
);

const useOutsideClose = (open: boolean, onClose: () => void) => {
    const ref = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!open) return;
        const handlePointer = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) onClose();
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', handlePointer);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handlePointer);
            document.removeEventListener('keydown', handleKey);
        };
    }, [open, onClose]);
    return ref;
};

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
    sidebarCollapsed = false,
    onToggleSidebar,
    breadcrumb,
    activity,
    projectMenuOpen,
    onProjectMenuOpenChange,
}) => {
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [internalProjectMenu, setInternalProjectMenu] = useState(false);
    const [newProfileName, setNewProfileName] = useState('');
    const [newProfileRole, setNewProfileRole] = useState<UserProfile['role']>('artist');

    const showProjectMenu = projectMenuOpen ?? internalProjectMenu;
    const setShowProjectMenu = (open: boolean) => {
        setInternalProjectMenu(open);
        onProjectMenuOpenChange?.(open);
    };

    const projectMenuRef = useOutsideClose(showProjectMenu, () => setShowProjectMenu(false));
    const profileMenuRef = useOutsideClose(showProfileMenu, () => setShowProfileMenu(false));

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
    ];
    const uiModeOptions: Array<{ id: UIMode; label: string; description: string }> = [
        { id: 'beginner', label: UI_MODE_META.beginner.label, description: UI_MODE_META.beginner.description },
        { id: 'advanced', label: UI_MODE_META.advanced.label, description: UI_MODE_META.advanced.description },
        { id: 'pro', label: UI_MODE_META.pro.label, description: UI_MODE_META.pro.description },
    ];

    return (
        <header className="app-toolbar">
            <div className="app-toolbar__row">
                <div className="app-toolbar__leading">
                    <button
                        type="button"
                        className="toolbar-button toolbar-button--icon"
                        onClick={onToggleSidebar}
                        aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                        aria-pressed={!sidebarCollapsed}
                        title={sidebarCollapsed ? 'Show sidebar (⌘\\)' : 'Hide sidebar (⌘\\)'}
                    >
                        <SidebarToggleIcon className="w-[18px] h-[18px]" />
                    </button>
                    <div className="app-toolbar__brand" title="AI Video Production Editor">
                        <AppLogoIcon className="w-[18px] h-[18px] app-logo" />
                    </div>
                    <div className="app-toolbar__crumbs" aria-label="Current workspace">
                        {breadcrumb?.group && (
                            <>
                                <span className="app-toolbar__crumb app-toolbar__crumb--muted">{breadcrumb.group}</span>
                                <ChevronRightIcon className="app-toolbar__crumb-sep" />
                            </>
                        )}
                        <span className="app-toolbar__crumb">{breadcrumb?.workspace || 'Workspace'}</span>
                        {breadcrumb?.description && (
                            <span className="app-toolbar__crumb-hint">{breadcrumb.description}</span>
                        )}
                    </div>
                </div>

                <div className="app-toolbar__center">
                    <div className="relative" ref={projectMenuRef}>
                        <button
                            type="button"
                            onClick={() => setShowProjectMenu(!showProjectMenu)}
                            className="toolbar-project"
                            aria-label="Project menu"
                            aria-haspopup="menu"
                            aria-expanded={showProjectMenu}
                        >
                            <FolderIcon className="w-4 h-4 toolbar-project__icon" />
                            <span className="toolbar-project__name">{projectName || 'Choose project'}</span>
                            <span className={`toolbar-project__status toolbar-project__status--${projectStatus.tone}`} title={projectStatus.label}>
                                <span className="toolbar-project__dot" />
                                <span className="toolbar-project__status-text">{projectStatus.label}</span>
                            </span>
                        </button>

                        {showProjectMenu && (
                            <div className="app-menu app-menu--project toolbar-popover toolbar-popover--center animate-fadeIn" role="menu">
                                <div className="app-menu__section">
                                    <p className="app-menu-title">Project</p>
                                    <p className="app-menu-strong truncate">{projectName || 'Untitled Project'}</p>
                                    <p className="text-xs app-muted truncate">{projectPath || 'No project folder selected yet.'}</p>
                                    {formattedSavedAt && (
                                        <p className="text-[11px] app-muted mt-1">Saved {formattedSavedAt}</p>
                                    )}
                                    {formattedAutoSavedAt && (
                                        <p className="text-[11px] app-muted mt-0.5">Auto-saved {formattedAutoSavedAt}</p>
                                    )}
                                </div>
                                <div className="app-menu__section app-menu__section--list">
                                    <button
                                        onClick={() => { onSelectProjectFolder?.(); setShowProjectMenu(false); }}
                                        className="app-menu-item"
                                    >
                                        Choose Project Folder…
                                    </button>
                                    <button
                                        onClick={() => { onSaveProject?.(); setShowProjectMenu(false); }}
                                        disabled={!projectPath || isProjectSaving}
                                        className="app-menu-item"
                                    >
                                        <span>Save Project</span>
                                        <kbd className="app-menu-item__kbd">⌘S</kbd>
                                    </button>
                                    <button
                                        onClick={() => { onOpenProjectFolder?.(); setShowProjectMenu(false); }}
                                        disabled={!projectPath}
                                        className="app-menu-item"
                                    >
                                        Reveal in Finder
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
                </div>

                <div className="app-toolbar__trailing">
                    <div className="toolbar-group" role="group" aria-label="History">
                        <button
                            onClick={onUndo}
                            disabled={!canUndo}
                            className="toolbar-button toolbar-button--icon"
                            aria-label="Undo"
                            title="Undo (⌘Z)"
                        >
                            <UndoIcon className="w-[18px] h-[18px]" />
                        </button>
                        <button
                            onClick={onRedo}
                            disabled={!canRedo}
                            className="toolbar-button toolbar-button--icon"
                            aria-label="Redo"
                            title="Redo (⇧⌘Z)"
                        >
                            <RedoIcon className="w-[18px] h-[18px]" />
                        </button>
                    </div>

                    <div className="toolbar-segmented" role="radiogroup" aria-label="Interface mode">
                        {uiModeOptions.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                role="radio"
                                aria-checked={uiMode === option.id}
                                className={`toolbar-segmented__item ${uiMode === option.id ? 'toolbar-segmented__item--active' : ''}`}
                                onClick={() => onSelectUIMode(option.id)}
                                title={option.description}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    {activity && (
                        <button
                            type="button"
                            className={`toolbar-activity toolbar-activity--${activity.tone} ${activity.open ? 'toolbar-activity--open' : ''}`}
                            onClick={activity.onToggle}
                            aria-pressed={activity.open}
                            title={activity.open ? 'Hide activity' : 'Show activity'}
                        >
                            <span className="toolbar-activity__dot" />
                            <span className="toolbar-activity__label">{activity.label}</span>
                            {typeof activity.progress === 'number' && (
                                <span className="toolbar-activity__progress" aria-hidden="true">
                                    <span style={{ width: `${Math.round(Math.min(1, Math.max(0.04, activity.progress)) * 100)}%` }} />
                                </span>
                            )}
                        </button>
                    )}

                    {user && (
                        <div className="relative" ref={profileMenuRef}>
                            <button
                                type="button"
                                onClick={() => setShowProfileMenu(!showProfileMenu)}
                                className="toolbar-avatar"
                                aria-haspopup="menu"
                                aria-expanded={showProfileMenu}
                                aria-label="Account menu"
                                title={user.name}
                            >
                                {user.avatarUrl ? (
                                    <img src={user.avatarUrl} alt="" className="toolbar-avatar__image" />
                                ) : (
                                    <span className="toolbar-avatar__initial">{user.name.charAt(0).toUpperCase()}</span>
                                )}
                            </button>

                            {showProfileMenu && (
                                <div className="app-menu toolbar-popover toolbar-popover--right animate-fadeIn" role="menu">
                                    <div className="app-menu__section">
                                        <p className="app-menu-strong truncate">{user.name}</p>
                                        <p className="text-xs app-muted truncate">{user.email}</p>
                                        {planLabel && (
                                            <p className="text-xs app-muted mt-1">
                                                {planLabel}
                                                {typeof creditBalance === 'number' && ` · €${creditBalance.toFixed(2)}`}
                                            </p>
                                        )}
                                    </div>

                                    {profiles && (
                                        <div className="app-menu__section">
                                            <p className="app-menu-title">Profiles</p>
                                            <div className="mt-1 space-y-1 max-h-36 overflow-y-auto">
                                                {profiles.map((p) => (
                                                    <div key={p.id} className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => { onSelectProfile?.(p.id); setShowProfileMenu(false); }}
                                                            className={`app-menu-profile ${activeProfileId === p.id ? 'app-menu-profile--active' : ''}`}
                                                        >
                                                            <span className="truncate">{p.name}</span>
                                                            {activeProfileId === p.id && <span aria-hidden="true">✓</span>}
                                                        </button>
                                                        <select
                                                            value={p.role || 'artist'}
                                                            onChange={(e) => onUpdateProfileRole?.(p.id, e.target.value as UserProfile['role'])}
                                                            className="app-select app-select--compact"
                                                            title="Change role"
                                                            aria-label={`Role for ${p.name}`}
                                                        >
                                                            <option value="artist">Artist</option>
                                                            <option value="director">Director</option>
                                                        </select>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="mt-2 flex items-center gap-2">
                                                <input
                                                    className="app-input app-input--compact"
                                                    placeholder="New profile"
                                                    value={newProfileName}
                                                    onChange={(e) => setNewProfileName(e.target.value)}
                                                    aria-label="New profile name"
                                                />
                                                <select
                                                    className="app-select app-select--compact"
                                                    value={newProfileRole || 'artist'}
                                                    onChange={(e) => setNewProfileRole(e.target.value as UserProfile['role'])}
                                                    aria-label="New profile role"
                                                >
                                                    <option value="artist">Artist</option>
                                                    <option value="director">Director</option>
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (!newProfileName.trim()) return;
                                                        onCreateProfile?.(newProfileName.trim(), newProfileRole || 'artist');
                                                        setNewProfileName('');
                                                        setNewProfileRole('artist');
                                                        setShowProfileMenu(false);
                                                    }}
                                                    className="toolbar-button toolbar-button--text"
                                                >
                                                    Add
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="app-menu__section app-menu__section--list">
                                        <button onClick={() => { onOpenSettings?.(); setShowProfileMenu(false); }} className="app-menu-item">
                                            <SettingsIcon className="w-4 h-4" /> <span>Settings & API Keys…</span>
                                            <kbd className="app-menu-item__kbd">⌘,</kbd>
                                        </button>
                                        <button onClick={() => { onOpenPricing?.(); setShowProfileMenu(false); }} className="app-menu-item">
                                            Pricing & Usage
                                        </button>
                                        <button onClick={() => { onOpenAbout?.(); setShowProfileMenu(false); }} className="app-menu-item">
                                            <InfoIcon className="w-4 h-4" /> <span>About & Updates</span>
                                        </button>
                                        {canOpenDesignSystem && (
                                            <button onClick={() => { onOpenDesignSystem?.(); setShowProfileMenu(false); }} className="app-menu-item">
                                                Design System
                                            </button>
                                        )}
                                    </div>

                                    <div className="app-menu__section">
                                        <p className="app-menu-title">Appearance</p>
                                        <div className="app-menu__field">
                                            <label>Theme</label>
                                            <div className="toolbar-segmented" role="radiogroup" aria-label="Theme">
                                                {themeOptions.map((option) => (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={(theme === option.id) || (option.id === 'dark' && theme !== 'light')}
                                                        className={`toolbar-segmented__item ${(theme === option.id) || (option.id === 'dark' && theme !== 'light') ? 'toolbar-segmented__item--active' : ''}`}
                                                        onClick={() => onSelectTheme?.(option.id)}
                                                    >
                                                        {option.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="app-menu__field">
                                            <label htmlFor="header-mode-select">Mode</label>
                                            <select
                                                id="header-mode-select"
                                                className="app-select app-select--compact"
                                                value={uiMode}
                                                onChange={(event) => onSelectUIMode(event.target.value as UIMode)}
                                            >
                                                {uiModeOptions.map((option) => (
                                                    <option key={option.id} value={option.id}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <p className="text-[11px] app-muted mt-1">
                                            {uiModeOptions.find((option) => option.id === uiMode)?.description}
                                        </p>
                                    </div>

                                    <div className="app-menu__section app-menu__section--list">
                                        <button onClick={() => { onLogout?.(); setShowProfileMenu(false); }} className="app-menu-item app-menu-item--danger">
                                            Exit Studio
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {activity?.open && auxiliaryContent && (
                <div className="app-toolbar__drawer">
                    {auxiliaryContent}
                </div>
            )}
        </header>
    );
};

export default Header;
