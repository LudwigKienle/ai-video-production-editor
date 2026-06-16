import React, { useState } from 'react';
import { LIGHTING_PRESETS } from '../data/lightingData';
import { SelectionModal } from './SelectionModal';
import { usePresets, PRESET_KEYS } from '../services/presetService';

interface LightingSelectionProps {
    selectedId: string | null;
    onSelect: (id: string | null) => void;
}

export const LightingSelection: React.FC<LightingSelectionProps> = ({
    selectedId,
    onSelect,
}) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { allPresets, addPreset, removePreset } = usePresets(PRESET_KEYS.LIGHTING, LIGHTING_PRESETS);

    const selectedPreset = allPresets.find(p => p.id === selectedId);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-[0.2em] text-gray-400">
                    Relight (Lighting)
                </h3>
                {selectedId && (
                    <button
                        onClick={() => onSelect(null)}
                        className="text-[10px] text-gray-500 hover:text-gray-300"
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Trigger Button / Preview */}
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
                            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        </div>
                        <span className="text-xs text-gray-400 font-medium">Select Lighting...</span>
                    </div>
                )}
            </div>

            <SelectionModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Select Lighting Source"
                presets={allPresets}
                selectedId={selectedId}
                onSelect={(id) => {
                    onSelect(id);
                    // Optional: Close on select, or keep open for browsing?
                    // Defaulting to auto-close for smoother flow
                }}
                onAddCustom={addPreset}
                onRemoveCustom={removePreset}
            />
        </div>
    );
};
