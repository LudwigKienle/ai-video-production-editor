import React, { useState, useMemo } from 'react';
import { CAMERA_PRESETS, LENS_PRESETS, CameraPreset, LensPreset } from '../data/cameraData';
import { XIcon, CameraIcon, FilmIcon } from './icons'; // Assuming these icons exist or I'll standardise imports

type LensSelectionProps = {
    cameraPresetId: string;
    setCameraPresetId: (id: string) => void;
    lensPresetId: string;
    setLensPresetId: (id: string) => void;
};

export const LensSelection: React.FC<LensSelectionProps> = ({
    cameraPresetId,
    setCameraPresetId,
    lensPresetId,
    setLensPresetId,
}) => {
    const [activeModal, setActiveModal] = useState<'none' | 'camera' | 'lens'>('none');

    const selectedCamera = useMemo(
        () => CAMERA_PRESETS.find((c) => c.id === cameraPresetId) || CAMERA_PRESETS[0],
        [cameraPresetId]
    );

    const selectedLens = useMemo(
        () => LENS_PRESETS.find((l) => l.id === lensPresetId) || LENS_PRESETS[0],
        [lensPresetId]
    );

    const closeModal = () => setActiveModal('none');

    return (
        <>
            {/* Cards Container */}
            <div className="grid grid-cols-3 gap-4 mb-6">
                {/* Camera Card */}
                <div
                    onClick={() => setActiveModal('camera')}
                    className="group relative flex flex-col items-center justify-center p-4 bg-gray-800/50 hover:bg-gray-800/80 rounded-xl border border-gray-700 hover:border-indigo-500/50 transition-all cursor-pointer h-40"
                >
                    <div className="absolute top-2 left-0 right-0 text-center">
                        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">Camera</span>
                    </div>
                    <img
                        src={selectedCamera.image}
                        alt={selectedCamera.label}
                        className="w-16 h-16 object-contain opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-300"
                    />
                    <div className="absolute bottom-3 left-0 right-0 text-center px-2">
                        <span className="text-xs font-semibold text-gray-200 block truncate">{selectedCamera.label}</span>
                        <span className="text-[10px] text-gray-500 block truncate">Film</span>
                    </div>
                </div>

                {/* Lens Card */}
                <div
                    onClick={() => setActiveModal('lens')}
                    className="group relative flex flex-col items-center justify-center p-4 bg-gray-800/50 hover:bg-gray-800/80 rounded-xl border border-gray-700 hover:border-indigo-500/50 transition-all cursor-pointer h-40"
                >
                    <div className="absolute top-2 left-0 right-0 text-center">
                        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">Lens</span>
                    </div>
                    <img
                        src={selectedLens.image}
                        alt={selectedLens.label}
                        className="w-16 h-16 object-contain opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-300"
                    />
                    <div className="absolute bottom-3 left-0 right-0 text-center px-2">
                        <span className="text-xs font-semibold text-gray-200 block truncate">{selectedLens.label}</span>
                        <span className="text-[10px] text-gray-500 block truncate">{selectedLens.type}</span>
                    </div>
                </div>

                {/* Focal Length Card (Display Only for now) */}
                <div className="flex flex-col items-center justify-center p-4 bg-gray-800/30 rounded-xl border border-gray-700/50 h-40">
                    <div className="mb-2 text-center">
                        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-medium">Focal Length</span>
                    </div>
                    <div className="flex flex-col items-center justify-center flex-1">
                        <span className="text-4xl font-light text-white tracking-tight">
                            {selectedLens.focalLength.replace(/\D/g, '') || '-'}
                        </span>
                        <span className="text-sm text-gray-500 mt-1">mm</span>
                    </div>
                </div>
            </div>

            {/* Modal */}
            {activeModal !== 'none' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="relative w-full max-w-4xl bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                        {/* Header */}
                        <div className="flex items-center justify-between p-6 border-b border-gray-800 bg-gray-900/50">
                            <h3 className="text-xl font-bold text-white flex items-center gap-3">
                                {activeModal === 'camera' ? <CameraIcon className="w-5 h-5 text-indigo-400" /> : <FilmIcon className="w-5 h-5 text-indigo-400" />}
                                Select {activeModal === 'camera' ? 'Camera Body' : 'Lens'}
                            </h3>
                            <button
                                onClick={closeModal}
                                className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-white"
                            >
                                <XIcon className="w-6 h-6" />
                            </button>
                        </div>

                        {/* Grid */}
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {(activeModal === 'camera' ? CAMERA_PRESETS : LENS_PRESETS).map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => {
                                            if (activeModal === 'camera') setCameraPresetId(item.id);
                                            else setLensPresetId(item.id);
                                            closeModal();
                                        }}
                                        className={`group relative flex flex-col items-center p-4 rounded-xl border transition-all duration-200 hover:scale-[1.02]
                      ${(activeModal === 'camera' ? cameraPresetId : lensPresetId) === item.id
                                                ? 'bg-indigo-600/20 border-indigo-500 ring-1 ring-indigo-500/50'
                                                : 'bg-gray-800 border-gray-700 hover:border-gray-500 hover:bg-gray-750'
                                            }
                    `}
                                    >
                                        <div className="w-full aspect-video flex items-center justify-center bg-gray-900/50 rounded-lg mb-3 p-4">
                                            <img src={(item as any).image} alt={item.label} className="w-full h-full object-contain" />
                                        </div>

                                        <div className="text-center w-full">
                                            <div className="font-medium text-sm text-gray-200 truncate group-hover:text-white transition-colors">{item.label}</div>
                                            <div className="text-[10px] text-gray-500 mt-1 line-clamp-2 min-h-[2.5em] leading-relaxed">
                                                {item.prompt || 'No specific prompt modifier'}
                                            </div>
                                        </div>

                                        {(activeModal === 'camera' ? cameraPresetId : lensPresetId) === item.id && (
                                            <div className="absolute top-2 right-2 w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-gray-800 bg-gray-900/50 text-center">
                            <p className="text-xs text-gray-500">
                                Selecting a headset will automatically optimize your prompt for best results with the chosen model.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
