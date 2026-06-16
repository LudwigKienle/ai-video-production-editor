import React, { useState } from 'react';
import { STYLE_PRESETS } from '../data/styleData';
import { SelectionModal } from './SelectionModal';
import { usePresets, PRESET_KEYS } from '../services/presetService';

interface StyleSelectionProps {
    selectedStyleId: string | null;
    setSelectedStyleId: (id: string | null) => void;
}

export const StyleSelection: React.FC<StyleSelectionProps> = ({
    selectedStyleId,
    setSelectedStyleId,
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    // Need to adapt STYLE_PRESETS because they don't have 'image' property initially in some versions of the file?
    // Checking previous context: I updated styleData.ts to include images. So we are good.
    const { allPresets, addPreset, removePreset } = usePresets(PRESET_KEYS.STYLE, STYLE_PRESETS as any[]);

    const selectedPreset = allPresets.find(p => p.id === selectedStyleId);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-[0.2em] text-gray-400">
                    Visual Style
                </h3>
                {selectedStyleId && (
                    <button
                        onClick={() => setSelectedStyleId(null)}
                        className="text-[10px] text-gray-500 hover:text-gray-300"
                    >
                        Clear
                    </button>
                )}
            </div>

            <div
                onClick={() => setIsModalOpen(true)}
                className="group relative cursor-pointer block w-full aspect-video rounded-xl overflow-hidden border border-gray-700 hover:border-indigo-500 transition-all"
            >
                {selectedPreset ? (
                    <>
                        <img
                            src={selectedPreset.image || ''}
                            alt={selectedPreset.label}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors" />
                        <div className="absolute bottom-3 left-3">
                            <span className="bg-black/60 backdrop-blur-md text-indigo-300 text-xs font-medium px-2 py-1 rounded border border-indigo-500/30">
                                {selectedPreset.label}
                            </span>
                        </div>
                    </>
                ) : (
                    <div className="w-full h-full bg-[#18181b] flex flex-col items-center justify-center gap-2 group-hover:bg-[#202023] transition-colors">
                        <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center group-hover:scale-110 transition-transform">
                            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>
                        </div>
                        <span className="text-xs text-gray-400 font-medium">Select Style...</span>
                    </div>
                )}
            </div>

            <SelectionModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Select Cinematic Style"
                presets={allPresets}
                selectedId={selectedStyleId}
                onSelect={(id) => {
                    setSelectedStyleId(id);
                }}
                onAddCustom={addPreset}
                onRemoveCustom={removePreset}
            />
        </div>
    );
};
