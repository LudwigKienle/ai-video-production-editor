import React, { useState } from 'react';
import { SHOT_TYPE_PRESETS } from '../data/shotTypeData';
import { SelectionModal } from './SelectionModal';
import { usePresets, PRESET_KEYS } from '../services/presetService';

interface ShotTypeSelectionProps {
    selectedId: string | null;
    onSelect: (id: string) => void;
}

export const ShotTypeSelection: React.FC<ShotTypeSelectionProps> = ({
    selectedId,
    onSelect,
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { allPresets, addPreset, removePreset } = usePresets(PRESET_KEYS.SHOT_TYPE, SHOT_TYPE_PRESETS);

    const selectedPreset = allPresets.find(p => p.id === selectedId);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-[0.2em] text-gray-400">
                    Shot Type
                </h3>
                {selectedId && (
                    <button
                        onClick={() => onSelect('')} // Assuming empty string resets for now based on parent usage, but parent takes (id: string) so might need null check. Let's assume parent handles empty string or null.
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
                            src={selectedPreset.image}
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
                            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </div>
                        <span className="text-xs text-gray-400 font-medium">Select Shot Type...</span>
                    </div>
                )}
            </div>

            <SelectionModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Select Shot Type"
                presets={allPresets}
                selectedId={selectedId}
                onSelect={(id) => {
                    if (id) onSelect(id);
                }}
                onAddCustom={addPreset}
                onRemoveCustom={removePreset}
            />
        </div>
    );
};
