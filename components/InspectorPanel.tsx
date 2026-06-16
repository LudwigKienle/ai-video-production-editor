
import React, { useState, useEffect } from 'react';
import { TimelineClip, MediaItem, EffectType, TransitionType, KenBurnsConfig, Keyframe } from '../types';
import { FunctionDeclaration } from '@google/genai';
import AIAssistant from './AIAssistant';
import { TRANSITIONS } from '../constants';
import { PropertiesIcon, EffectsIcon, ColorIcon, TransitionsIcon, MagicWandIcon, TextIcon, TransformIcon, KeyingIcon, MotionIcon, KeyframeIcon } from './icons';

interface InspectorPanelProps {
    selectedClip: TimelineClip | null;
    selectedMedia: MediaItem | null;
    onUpdateClip: (updatedClip: TimelineClip) => void;
    onUpdateClipFilters: (clipId: string, filters: TimelineClip['filters']) => void;
    onApplyCSSEffect: (effect: EffectType) => void;
    onUpdateClipTransition: (clipId: string, transition: { type: TransitionType; duration: number } | null) => void;
    onUpdateTextConfig: (clipId: string, textConfig: TimelineClip['textConfig']) => void;
    onUpdateClipSpeed: (clipId: string, newSpeed: number) => void;
    onUpdateClipTransform: (clipId: string, transform: TimelineClip['transform']) => void;
    onUpdateChromaKeyConfig: (clipId: string, chromaKeyConfig: TimelineClip['chromaKey']) => void;
    apiKeyReady: boolean;
    aiTools: FunctionDeclaration[];
    aiToolExecutor: { [key: string]: Function };
    playheadPosition: number;
}

type InspectorTab = 'PROPERTIES' | 'EFFECTS' | 'COLOR' | 'TRANSITIONS' | 'TEXT' | 'AI' | 'TRANSFORM' | 'MOTION' | 'KEYFRAMES';

const DEFAULT_FILTERS = {
    brightness: 100,
    contrast: 100,
    saturate: 100,
    hueRotate: 0,
};

const DEFAULT_TRANSFORM = {
    scale: 1,
    opacity: 1,
    position: { x: 50, y: 50 },
};

const DEFAULT_KEN_BURNS: KenBurnsConfig = {
    enabled: false,
    start: { scale: 1.0, x: 0, y: 0 },
    end: { scale: 1.2, x: 0, y: 0 },
};

const InspectorPanel: React.FC<InspectorPanelProps> = (props) => {
    const { selectedClip, selectedMedia, onUpdateClip, onUpdateClipFilters, onApplyCSSEffect, onUpdateClipTransition, onUpdateTextConfig, onUpdateClipSpeed, onUpdateClipTransform, onUpdateChromaKeyConfig } = props;
    const [activeTab, setActiveTab] = useState<InspectorTab>('PROPERTIES');

    // Reset to properties tab when clip changes
    useEffect(() => {
        if(selectedClip) {
            setActiveTab('PROPERTIES');
        }
    }, [selectedClip?.id]);

    const handleFilterChange = (name: string, value: number) => {
        if (!selectedClip) return;
        const newFilters = { ...(selectedClip.filters || DEFAULT_FILTERS), [name]: value };
        onUpdateClipFilters(selectedClip.id, newFilters);
    };

    const handleTransitionTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (!selectedClip) return;
        const newType = e.target.value as TransitionType;
        const defaultDuration = TRANSITIONS.find(t => t.id === newType)?.duration || 1.0;
        onUpdateClipTransition(selectedClip.id, { type: newType, duration: selectedClip.transitionOut?.duration || defaultDuration });
    };

    const handleTransitionDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!selectedClip || !selectedClip.transitionOut) return;
        const newDuration = parseFloat(e.target.value);
        if (!isNaN(newDuration) && newDuration > 0) {
            onUpdateClipTransition(selectedClip.id, { ...selectedClip.transitionOut, duration: newDuration });
        }
    };

    const handleTextConfigChange = (field: keyof NonNullable<TimelineClip['textConfig']>, value: string | number) => {
        if (!selectedClip || !selectedClip.textConfig) return;
        const newConfig = { ...selectedClip.textConfig, [field]: value };
        onUpdateTextConfig(selectedClip.id, newConfig as NonNullable<TimelineClip['textConfig']>);
    };

    const handleChromaKeyChange = (field: 'color' | 'tolerance', value: string | number) => {
        if (!selectedClip || !selectedClip.chromaKey) return;
        const newConfig = { ...selectedClip.chromaKey, [field]: value };
        onUpdateChromaKeyConfig(selectedClip.id, newConfig);
    };

    const handleTransformChange = (field: 'scale' | 'opacity' | 'positionX' | 'positionY', value: number) => {
        if (!selectedClip) return;
        const currentTransform = selectedClip.transform || DEFAULT_TRANSFORM;
        let newTransform;
        if (field === 'positionX') {
            newTransform = { ...currentTransform, position: { ...currentTransform.position, x: value }};
        } else if (field === 'positionY') {
            newTransform = { ...currentTransform, position: { ...currentTransform.position, y: value }};
        } else {
            newTransform = { ...currentTransform, [field]: value };
        }
        onUpdateClipTransform(selectedClip.id, newTransform);
    };

    const handleSpeedChange = (newSpeed: number) => {
        if (!selectedClip) return;
        onUpdateClipSpeed(selectedClip.id, newSpeed);
    };

    const handleBlendModeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (!selectedClip) return;
        onUpdateClip({ ...selectedClip, blendMode: e.target.value as any });
    };

    const handleKenBurnsChange = (point: 'start' | 'end', field: 'scale' | 'x' | 'y', value: number) => {
        if (!selectedClip) return;
        const currentKB = selectedClip.kenBurns || DEFAULT_KEN_BURNS;
        const newKB = { ...currentKB, [point]: { ...currentKB[point], [field]: value } };
        onUpdateClip({ ...selectedClip, kenBurns: newKB });
    };

    const toggleKenBurns = () => {
        if (!selectedClip) return;
        const currentKB = selectedClip.kenBurns || DEFAULT_KEN_BURNS;
        onUpdateClip({ ...selectedClip, kenBurns: { ...currentKB, enabled: !currentKB.enabled } });
    };

    const handleAddKeyframe = (property: Keyframe['property']) => {
        if (!selectedClip) return;
        const localTime = (props.playheadPosition - selectedClip.start) * selectedClip.speed;

        if (localTime < 0 || localTime > selectedClip.duration) {
            alert("Playhead is outside the clip range.");
            return;
        }

        let currentValue = 0;
        if (property === 'scale') currentValue = selectedClip.transform?.scale || 1;
        if (property === 'opacity') currentValue = selectedClip.transform?.opacity || 1;
        if (property === 'x') currentValue = selectedClip.transform?.position.x || 50;
        if (property === 'y') currentValue = selectedClip.transform?.position.y || 50;
        if (property === 'volume') currentValue = selectedClip.volume !== undefined ? selectedClip.volume : 1;

        // Check if keyframe already exists at this time (approx)
        const existingIndex = (selectedClip.keyframes || []).findIndex(k => k.property === property && Math.abs(k.time - localTime) < 0.1);
        let newKeyframes = selectedClip.keyframes ? [...selectedClip.keyframes] : [];

        if (existingIndex >= 0) {
            // Update existing
            newKeyframes[existingIndex] = { ...newKeyframes[existingIndex], value: currentValue };
        } else {
             const newKeyframe: Keyframe = {
                id: `kf-${Date.now()}`,
                time: localTime,
                value: currentValue,
                property,
                easing: 'linear'
            };
            newKeyframes.push(newKeyframe);
        }

        onUpdateClip({ ...selectedClip, keyframes: newKeyframes });
    };

    const handleRemoveKeyframe = (id: string) => {
        if (!selectedClip || !selectedClip.keyframes) return;
        const newKeyframes = selectedClip.keyframes.filter(k => k.id !== id);
        onUpdateClip({ ...selectedClip, keyframes: newKeyframes });
    };

    const renderTabContent = () => {
        if (!selectedClip || !selectedMedia) {
            return <AIAssistant
                apiKeyReady={props.apiKeyReady}
                tools={props.aiTools}
                toolExecutor={props.aiToolExecutor}
            />;
        }

        switch (activeTab) {
            case 'PROPERTIES':
                const displayDuration = (selectedMedia.type === 'video' ? (selectedMedia.duration || 5) : selectedClip.duration) / selectedClip.speed;
                return (
                    <div className="p-4 space-y-4 text-sm">
                        <div>
                            <label className="font-semibold text-gray-400">Clip Name</label>
                            <p className="text-white truncate">{selectedMedia.name}</p>
                        </div>
                        <div>
                            <label className="font-semibold text-gray-400">Timeline Duration</label>
                            <p className="text-white">{displayDuration.toFixed(2)}s</p>
                        </div>
                        <div>
                           <label htmlFor="speed" className="font-semibold text-gray-400 flex justify-between">
                                Speed <span>{selectedClip.speed.toFixed(2)}x</span>
                            </label>
                            <input
                                type="range"
                                id="speed"
                                name="speed"
                                min="0.25"
                                max="4"
                                step="0.05"
                                value={selectedClip.speed}
                                onChange={e => handleSpeedChange(parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo mt-1"
                            />
                        </div>
                        <div>
                           <label htmlFor="blendMode" className="font-semibold text-gray-400 block mb-1">Blending Mode</label>
                           <select
                                id="blendMode"
                                value={selectedClip.blendMode || 'normal'}
                                onChange={handleBlendModeChange}
                                className="w-full bg-gray-700 text-white p-2 rounded border border-gray-600 focus:border-indigo-500 outline-none"
                           >
                               <option value="normal">Normal</option>
                               <option value="screen">Screen (Lighten)</option>
                               <option value="overlay">Overlay (Contrast)</option>
                               <option value="multiply">Multiply (Darken)</option>
                               <option value="darken">Darken</option>
                               <option value="lighten">Lighten</option>
                               <option value="color-dodge">Color Dodge</option>
                               <option value="soft-light">Soft Light</option>
                               <option value="difference">Difference</option>
                           </select>
                        </div>
                    </div>
                );
            case 'EFFECTS':
                const chromaKeyConfig = selectedClip.chromaKey;
                return (
                    <div className="p-4 space-y-4">
                        <h4 className="font-semibold text-gray-300">CSS Filter Effect</h4>
                        {selectedClip.effect ? (
                             <div className="flex justify-between items-center bg-gray-700 p-2 rounded-lg">
                                <span className="text-white font-medium">{selectedClip.effect}</span>
                                <button onClick={() => onApplyCSSEffect(selectedClip.effect!)} className="text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded">Remove</button>
                            </div>
                        ) : <p className="text-gray-500 text-sm">No CSS effect applied. Add one from the Effects panel.</p>}

                        <div className="border-t border-gray-700 my-4"></div>

                        <h4 className="font-semibold text-gray-300 flex items-center gap-2"><KeyingIcon className="w-5 h-5" />Chroma Key (Green Screen)</h4>
                        {!chromaKeyConfig ? (
                            <p className="text-gray-500 text-sm">No Chroma Key effect applied. Add it from the Effects panel.</p>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center gap-4">
                                    <label htmlFor="keyColor" className="text-sm font-medium text-gray-300">Key Color</label>
                                    <input id="keyColor" type="color" value={chromaKeyConfig.color} onChange={e => handleChromaKeyChange('color', e.target.value)} className="w-12 h-10 bg-gray-700 border border-gray-600 rounded-md p-1"/>
                                </div>
                                <div>
                                    <label htmlFor="tolerance" className="text-sm font-medium text-gray-300 flex justify-between">Tolerance <span>{Math.round(chromaKeyConfig.tolerance * 100)}%</span></label>
                                    <input id="tolerance" type="range" min="0" max="1" step="0.01" value={chromaKeyConfig.tolerance} onChange={e => handleChromaKeyChange('tolerance', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo mt-1"/>
                                </div>
                            </div>
                        )}
                    </div>
                );
            case 'COLOR':
                const filters = selectedClip.filters || DEFAULT_FILTERS;
                return (
                    <div className="p-4 space-y-4">
                        <div className="flex flex-col">
                            <label htmlFor="brightness" className="mb-1 text-sm text-gray-300 flex justify-between">Brightness <span>{filters.brightness}%</span></label>
                            <input type="range" id="brightness" name="brightness" min="0" max="200" value={filters.brightness} onChange={e => handleFilterChange('brightness', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                        </div>
                         <div className="flex flex-col">
                            <label htmlFor="contrast" className="mb-1 text-sm text-gray-300 flex justify-between">Contrast <span>{filters.contrast}%</span></label>
                            <input type="range" id="contrast" name="contrast" min="0" max="200" value={filters.contrast} onChange={e => handleFilterChange('contrast', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                        </div>
                         <div className="flex flex-col">
                            <label htmlFor="saturate" className="mb-1 text-sm text-gray-300 flex justify-between">Saturation <span>{filters.saturate}%</span></label>
                            <input type="range" id="saturate" name="saturate" min="0" max="200" value={filters.saturate} onChange={e => handleFilterChange('saturate', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                        </div>
                         <div className="flex flex-col">
                            <label htmlFor="hueRotate" className="mb-1 text-sm text-gray-300 flex justify-between">Hue <span>{filters.hueRotate}°</span></label>
                            <input type="range" id="hueRotate" name="hueRotate" min="0" max="360" value={filters.hueRotate} onChange={e => handleFilterChange('hueRotate', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                        </div>
                    </div>
                );
            case 'TRANSFORM':
                const transform = selectedClip.transform || DEFAULT_TRANSFORM;
                 return (
                    <div className="p-4 space-y-4">
                         <div className="flex flex-col">
                            <label htmlFor="scale" className="mb-1 text-sm text-gray-300 flex justify-between">Scale <span>{(transform.scale * 100).toFixed(0)}%</span></label>
                            <input type="range" id="scale" min="0.1" max="3" step="0.01" value={transform.scale} onChange={e => handleTransformChange('scale', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                        </div>
                         <div className="flex flex-col">
                            <label htmlFor="opacity" className="mb-1 text-sm text-gray-300 flex justify-between">Opacity <span>{(transform.opacity * 100).toFixed(0)}%</span></label>
                            <input type="range" id="opacity" min="0" max="1" step="0.01" value={transform.opacity} onChange={e => handleTransformChange('opacity', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                        </div>
                         <div className="flex flex-col">
                            <label htmlFor="positionX" className="mb-1 text-sm text-gray-300 flex justify-between">Position X <span>{transform.position.x.toFixed(1)}%</span></label>
                            <input type="range" id="positionX" min="0" max="100" step="0.1" value={transform.position.x} onChange={e => handleTransformChange('positionX', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                        </div>
                         <div className="flex flex-col">
                            <label htmlFor="positionY" className="mb-1 text-sm text-gray-300 flex justify-between">Position Y <span>{transform.position.y.toFixed(1)}%</span></label>
                            <input type="range" id="positionY" min="0" max="100" step="0.1" value={transform.position.y} onChange={e => handleTransformChange('positionY', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                        </div>
                    </div>
                );
            case 'MOTION':
                const kenBurns = selectedClip.kenBurns || DEFAULT_KEN_BURNS;
                return (
                    <div className="p-4 space-y-6">
                        <div className="flex items-center justify-between">
                            <h4 className="font-semibold text-gray-300">Ken Burns Effect</h4>
                            <button
                                onClick={toggleKenBurns}
                                className={`w-10 h-5 rounded-full p-0.5 transition-colors ${kenBurns.enabled ? 'bg-indigo-600' : 'bg-gray-600'}`}
                            >
                                <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${kenBurns.enabled ? 'translate-x-5' : 'translate-x-0'}`}/>
                            </button>
                        </div>

                        {kenBurns.enabled && (
                            <>
                                <div>
                                    <h5 className="text-xs font-bold text-indigo-400 uppercase mb-2">Start Position</h5>
                                    <div className="space-y-2">
                                        <div className="flex flex-col">
                                            <label className="text-xs text-gray-400">Scale {kenBurns.start.scale.toFixed(2)}x</label>
                                            <input type="range" min="1" max="3" step="0.1" value={kenBurns.start.scale} onChange={e => handleKenBurnsChange('start', 'scale', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg cursor-pointer"/>
                                        </div>
                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <label className="text-xs text-gray-400">Pan X</label>
                                                <input type="range" min="-50" max="50" value={kenBurns.start.x} onChange={e => handleKenBurnsChange('start', 'x', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg cursor-pointer"/>
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-xs text-gray-400">Pan Y</label>
                                                <input type="range" min="-50" max="50" value={kenBurns.start.y} onChange={e => handleKenBurnsChange('start', 'y', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg cursor-pointer"/>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="border-t border-gray-700 pt-2">
                                    <h5 className="text-xs font-bold text-indigo-400 uppercase mb-2">End Position</h5>
                                    <div className="space-y-2">
                                        <div className="flex flex-col">
                                            <label className="text-xs text-gray-400">Scale {kenBurns.end.scale.toFixed(2)}x</label>
                                            <input type="range" min="1" max="3" step="0.1" value={kenBurns.end.scale} onChange={e => handleKenBurnsChange('end', 'scale', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg cursor-pointer"/>
                                        </div>
                                        <div className="flex gap-2">
                                            <div className="flex-1">
                                                <label className="text-xs text-gray-400">Pan X</label>
                                                <input type="range" min="-50" max="50" value={kenBurns.end.x} onChange={e => handleKenBurnsChange('end', 'x', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg cursor-pointer"/>
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-xs text-gray-400">Pan Y</label>
                                                <input type="range" min="-50" max="50" value={kenBurns.end.y} onChange={e => handleKenBurnsChange('end', 'y', parseFloat(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg cursor-pointer"/>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                );
            case 'KEYFRAMES':
                const keyframes = selectedClip.keyframes || [];
                return (
                    <div className="p-4 space-y-4">
                        <h4 className="font-semibold text-gray-300 mb-4">Keyframe Animation</h4>
                        <p className="text-xs text-gray-500 mb-4">Position the playhead on the timeline and click "+" to add a keyframe for a property.</p>

                        <div className="grid grid-cols-2 gap-3 mb-6">
                            <button onClick={() => handleAddKeyframe('scale')} className="bg-gray-700 hover:bg-gray-600 p-2 rounded text-xs font-medium flex justify-between items-center">Scale <span>+</span></button>
                            <button onClick={() => handleAddKeyframe('opacity')} className="bg-gray-700 hover:bg-gray-600 p-2 rounded text-xs font-medium flex justify-between items-center">Opacity <span>+</span></button>
                            <button onClick={() => handleAddKeyframe('x')} className="bg-gray-700 hover:bg-gray-600 p-2 rounded text-xs font-medium flex justify-between items-center">Pos X <span>+</span></button>
                            <button onClick={() => handleAddKeyframe('y')} className="bg-gray-700 hover:bg-gray-600 p-2 rounded text-xs font-medium flex justify-between items-center">Pos Y <span>+</span></button>
                            <button onClick={() => handleAddKeyframe('volume')} className="bg-gray-700 hover:bg-gray-600 p-2 rounded text-xs font-medium flex justify-between items-center">Volume <span>+</span></button>
                        </div>

                        <div className="space-y-2">
                            {keyframes.length === 0 && <p className="text-center text-gray-600 text-xs py-4">No keyframes added.</p>}
                            {keyframes.sort((a,b) => a.time - b.time).map(kf => (
                                <div key={kf.id} className="flex items-center justify-between bg-gray-900 p-2 rounded border border-gray-700 text-xs">
                                    <span className="text-indigo-300 font-mono w-12">{kf.time.toFixed(1)}s</span>
                                    <span className="text-gray-300 font-bold uppercase w-16">{kf.property}</span>
                                    <span className="text-white w-12 text-right">{kf.value.toFixed(2)}</span>
                                    <button onClick={() => handleRemoveKeyframe(kf.id)} className="text-red-500 hover:text-red-400 px-2">&times;</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )
            case 'TRANSITIONS':
                 return (
                    <div className="p-4 space-y-4">
                        <h4 className="font-semibold text-gray-300">Outgoing Transition</h4>
                        {!selectedClip.transitionOut ? (
                            <p className="text-gray-500 text-sm">No transition applied. Add one from the Transitions panel on the left.</p>
                        ) : (
                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs text-gray-400">Type</label>
                                    <select value={selectedClip.transitionOut.type} onChange={handleTransitionTypeChange} className="w-full bg-gray-700 border border-gray-600 rounded-md p-1 mt-1 text-sm">
                                        {TRANSITIONS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400">Duration (s)</label>
                                    <input type="number" value={selectedClip.transitionOut.duration} onChange={handleTransitionDurationChange} step="0.1" min="0.1" className="w-full bg-gray-700 border border-gray-600 rounded-md p-1 mt-1 text-sm"/>
                                </div>
                                <button onClick={() => onUpdateClipTransition(selectedClip.id, null)} className="w-full text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded">Remove Transition</button>
                            </div>
                        )}
                    </div>
                );
            case 'TEXT':
                const textConfig = selectedClip.textConfig;
                if (!textConfig) return null; // Should not happen if tab is visible
                return (
                    <div className="p-4 space-y-4">
                        <div>
                            <label htmlFor="textContent" className="text-sm font-medium text-gray-300">Text Content</label>
                            <textarea id="textContent" rows={3} value={textConfig?.content} onChange={e => handleTextConfigChange('content', e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 mt-1"/>
                        </div>
                         <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="font" className="text-sm font-medium text-gray-300">Font</label>
                                <select id="font" value={textConfig?.font} onChange={e => handleTextConfigChange('font', e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 mt-1">
                                    <option>Arial</option>
                                    <option>Verdana</option>
                                    <option>Georgia</option>
                                    <option>Times New Roman</option>
                                    <option>Courier New</option>
                                </select>
                            </div>
                             <div>
                                <label htmlFor="color" className="text-sm font-medium text-gray-300">Color</label>
                                <input id="color" type="color" value={textConfig?.color} onChange={e => handleTextConfigChange('color', e.target.value)} className="w-full h-10 bg-gray-700 border border-gray-600 rounded-md p-1 mt-1"/>
                            </div>
                        </div>
                         <div>
                            <label htmlFor="size" className="text-sm font-medium text-gray-300 flex justify-between">Size <span>{textConfig?.size}px</span></label>
                            <input id="size" type="range" min="12" max="128" value={textConfig?.size} onChange={e => handleTextConfigChange('size', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo mt-1"/>
                        </div>
                         <div>
                            <label htmlFor="position" className="text-sm font-medium text-gray-300">Position</label>
                            <select id="position" value={textConfig?.position} onChange={e => handleTextConfigChange('position', e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-md p-2 mt-1">
                                <option value="center">Center</option>
                                <option value="top-left">Top Left</option>
                                <option value="top-center">Top Center</option>
                                <option value="top-right">Top Right</option>
                                <option value="bottom-left">Bottom Left</option>
                                <option value="bottom-center">Bottom Center</option>
                                <option value="bottom-right">Bottom Right</option>
                            </select>
                        </div>
                    </div>
                );
            case 'AI':
                return <AIAssistant
                    apiKeyReady={props.apiKeyReady}
                    tools={props.aiTools}
                    toolExecutor={props.aiToolExecutor}
                />;
        }
    }

    let tabs: {id: InspectorTab, icon: React.FC<{className?: string}>, name: string }[] = [
        { id: 'PROPERTIES', icon: PropertiesIcon, name: 'Properties' },
    ];

    if (selectedMedia?.type === 'video' || selectedMedia?.type === 'image') {
        tabs.push(
            { id: 'TRANSFORM', icon: TransformIcon, name: 'Transform' },
            { id: 'MOTION', icon: MotionIcon, name: 'Motion' },
            { id: 'KEYFRAMES', icon: KeyframeIcon, name: 'Keyframes' },
            { id: 'EFFECTS', icon: EffectsIcon, name: 'Effects' },
            { id: 'COLOR', icon: ColorIcon, name: 'Color' },
            { id: 'TRANSITIONS', icon: TransitionsIcon, name: 'Transitions' },
        );
    }

    if (selectedClip?.textConfig) {
        tabs.push({ id: 'TEXT', icon: TextIcon, name: 'Text' });
    }
    tabs.push({ id: 'AI', icon: MagicWandIcon, name: 'AI Assistant' });


    return (
        <div className="w-full h-full flex flex-col bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <header className="flex-shrink-0 flex items-center justify-between p-3 border-b border-gray-700 bg-gray-800">
                <h2 className="text-sm font-bold uppercase tracking-wider text-gray-300">{selectedClip ? 'Inspector' : 'AI Assistant'}</h2>
            </header>

            {selectedClip && (
                 <div className="flex-shrink-0 flex border-b border-gray-700 bg-gray-900/30">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            title={tab.name}
                            className={`flex-1 py-3 flex justify-center transition-all relative group ${activeTab === tab.id ? 'text-indigo-400 bg-indigo-500/10' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}
                        >
                            <tab.icon className="w-5 h-5"/>
                            {activeTab === tab.id && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500"></span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-grow overflow-y-auto custom-scrollbar">
                {renderTabContent()}
            </div>
        </div>
    );
};

export default InspectorPanel;