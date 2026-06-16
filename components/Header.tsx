

import React, { useState } from 'react';
import { AppLogoIcon, UndoIcon, RedoIcon, InfoIcon, FolderIcon } from './icons';
import { User } from '../types';

interface HeaderProps {
    onUndo: () => void;
    onRedo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    projectName?: string | null;
    projectPath?: string | null;
    lastSavedAt?: string | null;
    isProjectSaving?: boolean;
    isProjectLoading?: boolean;
    onSelectProjectFolder?: () => void;
    onSaveProject?: () => void;
    onOpenProjectFolder?: () => void;
    onCloseProject?: () => void;
    user?: User | null;
    onLogout?: () => void;
    onOpenAbout?: () => void;
}

const Header: React.FC<HeaderProps> = ({
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  projectName,
  projectPath,
  lastSavedAt,
  isProjectSaving,
  isProjectLoading,
  onSelectProjectFolder,
  onSaveProject,
  onOpenProjectFolder,
  onCloseProject,
  user,
  onLogout,
  onOpenAbout,
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);

  const formattedSavedAt = lastSavedAt ? new Date(lastSavedAt).toLocaleString() : null;

  return (
    <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 p-4 sticky top-0 z-50">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
            <AppLogoIcon className="w-8 h-8 text-indigo-500"/>
            <h1 className="text-2xl font-bold tracking-tighter text-white">AI Video Production Editor</h1>
        </div>
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 border-r border-gray-700 pr-4">
                <button
                    onClick={onUndo}
                    disabled={!canUndo}
                    className="p-2 rounded-md transition-colors disabled:text-gray-600 disabled:cursor-not-allowed text-gray-300 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                    aria-label="Undo last action"
                    title="Undo (Ctrl+Z)"
                >
                    <UndoIcon className="w-6 h-6" />
                </button>
                <button
                    onClick={onRedo}
                    disabled={!canRedo}
                    className="p-2 rounded-md transition-colors disabled:text-gray-600 disabled:cursor-not-allowed text-gray-300 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                    aria-label="Redo last action"
                    title="Redo (Ctrl+Y)"
                >
                    <RedoIcon className="w-6 h-6" />
                </button>
            </div>

            <div className="relative">
                <button
                    onClick={() => setShowProjectMenu(!showProjectMenu)}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                    aria-label="Project menu"
                >
                    <FolderIcon className="w-5 h-5" />
                    <span className="text-sm font-medium hidden md:block">{projectName || 'Project'}</span>
                    {isProjectSaving && <span className="text-[10px] text-indigo-300 uppercase">Saving</span>}
                    {isProjectLoading && <span className="text-[10px] text-indigo-300 uppercase">Loading</span>}
                </button>

                {showProjectMenu && (
                    <div className="absolute right-0 mt-2 w-80 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-50 animate-fadeIn">
                        <div className="px-4 py-3 border-b border-gray-700">
                            <p className="text-[10px] uppercase text-gray-500">Active Project</p>
                            <p className="text-sm font-semibold text-white truncate">{projectName || 'Untitled Project'}</p>
                            <p className="text-xs text-gray-400 truncate">{projectPath || 'No folder selected yet.'}</p>
                            {formattedSavedAt && (
                                <p className="text-[10px] text-gray-500 mt-1">Last saved {formattedSavedAt}</p>
                            )}
                        </div>
                        <div className="py-2">
                            <button
                                onClick={() => { onSelectProjectFolder?.(); setShowProjectMenu(false); }}
                                className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
                            >
                                Select/Load Project Folder
                            </button>
                            <button
                                onClick={() => { onSaveProject?.(); setShowProjectMenu(false); }}
                                disabled={!projectPath || isProjectSaving}
                                className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Save Project
                            </button>
                            <button
                                onClick={() => { onOpenProjectFolder?.(); setShowProjectMenu(false); }}
                                disabled={!projectPath}
                                className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Open Project Folder
                            </button>
                            {projectPath && (
                                <button
                                    onClick={() => { onCloseProject?.(); setShowProjectMenu(false); }}
                                    className="block w-full text-left px-4 py-2 text-sm text-red-300 hover:bg-gray-700 hover:text-red-200"
                                >
                                    Close Project
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {user && (
                <div className="relative">
                    <button
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                        className="flex items-center gap-2 focus:outline-none"
                    >
                        {user.avatarUrl ? (
                            <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full border border-gray-600" />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white">
                                {user.name.charAt(0).toUpperCase()}
                            </div>
                        )}
                        <span className="text-sm font-medium text-gray-300 hidden md:block">{user.name}</span>
                        <span className="bg-gradient-to-r from-indigo-500 to-purple-600 text-[10px] text-white px-1.5 py-0.5 rounded font-bold tracking-wide shadow-sm">STUDIO</span>
                    </button>

                    {showProfileMenu && (
                        <div className="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-1 z-50 animate-fadeIn">
                            <div className="px-4 py-2 border-b border-gray-700">
                                <p className="text-xs text-gray-400">Signed in as</p>
                                <p className="text-sm font-bold text-white truncate">{user.email}</p>
                            </div>
                            <button onClick={() => { onOpenAbout?.(); setShowProfileMenu(false); }} className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white flex items-center gap-2">
                                <InfoIcon className="w-4 h-4" /> About & Updates
                            </button>
                            <div className="border-t border-gray-700 my-1"></div>
                            <button onClick={() => { onLogout?.(); setShowProfileMenu(false); }} className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 hover:text-red-300">Exit Studio</button>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </header>
  );
};

export default Header;
