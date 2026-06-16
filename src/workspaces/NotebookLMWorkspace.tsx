import React, { useState } from 'react';
import type { StoryBible } from '../types';
import ProjectResearchPanel from '../components/ProjectResearchPanel';
import NotebookLMPanel from '../components/NotebookLMPanel';
import { BrainCircuitIcon, SearchIcon } from '../components/icons';

type NotebookLMWorkspaceProps = {
    storyBible: StoryBible;
    setStoryBible: React.Dispatch<React.SetStateAction<StoryBible>>;
    onOpenMoodboard?: () => void;
    onOpenSettings?: () => void;
};

const NotebookLMWorkspace: React.FC<NotebookLMWorkspaceProps> = ({
    storyBible,
    setStoryBible,
    onOpenMoodboard,
    onOpenSettings,
}) => {
    const [tab, setTab] = useState<'internal' | 'notebooklm'>('internal');

    return (
        <div className="w-full h-full bg-gray-950 text-white">
            <div className="border-b border-white/10 px-4 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setTab('internal')}
                        className={`inline-flex items-center gap-2 rounded-t-xl border px-4 py-2 text-sm font-medium transition ${tab === 'internal'
                            ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
                            : 'border-white/10 bg-white/5 text-gray-300 hover:border-cyan-400/20 hover:text-white'
                            }`}
                    >
                        <SearchIcon className="h-4 w-4" />
                        Internal Research
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab('notebooklm')}
                        className={`inline-flex items-center gap-2 rounded-t-xl border px-4 py-2 text-sm font-medium transition ${tab === 'notebooklm'
                            ? 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100'
                            : 'border-white/10 bg-white/5 text-gray-300 hover:border-cyan-400/20 hover:text-white'
                            }`}
                    >
                        <BrainCircuitIcon className="h-4 w-4" />
                        NotebookLM MCP
                    </button>
                </div>
            </div>

            <div className="h-[calc(100%-65px)]">
                {tab === 'internal' ? (
                    <ProjectResearchPanel
                        storyBible={storyBible}
                        setStoryBible={setStoryBible}
                        onOpenMoodboard={onOpenMoodboard}
                        onOpenSettings={onOpenSettings}
                    />
                ) : (
                    <NotebookLMPanel />
                )}
            </div>
        </div>
    );
};

export default NotebookLMWorkspace;
