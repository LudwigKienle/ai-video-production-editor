import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ClipEffectLayer, ClipFilters, LutId, TimelineClip, MediaItem, EffectType, TransitionType, KenBurnsConfig, Keyframe } from '../types';
import { FunctionDeclaration } from '@google/genai';
import AIAssistant from './AIAssistant';
import { TRANSITIONS } from '../constants';
import { PropertiesIcon, EffectsIcon, ColorIcon, TransitionsIcon, MagicWandIcon, TextIcon, TransformIcon, KeyingIcon, MotionIcon, KeyframeIcon, XIcon, AddIcon } from './icons';
import { FILM_LUTS, LOOK_PRESETS, normalizeFilters } from '../utils/colorGrading';
import { parseCubeLut } from '../utils/lut';
import { getClipEffectLayers, normalizeEffectLayer, syncClipEffectsLegacyField } from '../utils/effects';

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

const DEFAULT_FONT_FAMILIES = [
    'Arial',
    'Verdana',
    'Georgia',
    'Times New Roman',
    'Courier New',
    'Helvetica',
    'Impact',
    'Trebuchet MS',
    'Palatino',
];

const CUSTOM_FONT_FAMILIES_STORAGE_KEY = 'edit.customFontFamilies.v1';

const mergeFontFamilies = (...groups: string[][]) => {
    const unique = new Set<string>();
    groups.flat().forEach((family) => {
        const value = (family || '').trim();
        if (value) unique.add(value);
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
};

/** One labelled slider row: name left, live value right (mono), track underneath. */
const SliderRow: React.FC<{
    id: string;
    label: string;
    value: number;
    display: string;
    min: number;
    max: number;
    step?: number;
    disabled?: boolean;
    onChange: (value: number) => void;
    onReset?: () => void;
}> = ({ id, label, value, display, min, max, step = 1, disabled, onChange, onReset }) => (
    <label htmlFor={id} className={`insp-slider ${disabled ? 'insp-slider--disabled' : ''}`}>
        <span className="insp-slider__head">
            <span>{label}</span>
            <span className="insp-slider__value" onDoubleClick={onReset} title={onReset ? 'Double-click to reset' : undefined}>{display}</span>
        </span>
        <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} onDoubleClick={onReset} />
    </label>
);

const POSITIONS: Array<NonNullable<TimelineClip['textConfig']>['position']> = ['top-left', 'top-center', 'top-right', 'center', 'center', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];

const InspectorPanel: React.FC<InspectorPanelProps> = (props) => {
    const { selectedClip, selectedMedia, onUpdateClip, onUpdateClipFilters, onApplyCSSEffect, onUpdateClipTransition, onUpdateTextConfig, onUpdateClipSpeed, onUpdateClipTransform, onUpdateChromaKeyConfig } = props;
    const [activeTab, setActiveTab] = useState<InspectorTab>('PROPERTIES');
    const [presetSelection, setPresetSelection] = useState('');
    const lutInputRef = useRef<HTMLInputElement>(null);
    const fontUploadInputRef = useRef<HTMLInputElement>(null);
    const [fontFamilies, setFontFamilies] = useState<string[]>(() => {
        try {
            const stored = JSON.parse(localStorage.getItem(CUSTOM_FONT_FAMILIES_STORAGE_KEY) || '[]');
            return mergeFontFamilies(DEFAULT_FONT_FAMILIES, Array.isArray(stored) ? stored : []);
        } catch {
            return [...DEFAULT_FONT_FAMILIES];
        }
    });
    const [fontSearch, setFontSearch] = useState('');
    const [manualFontFamily, setManualFontFamily] = useState('');
    const [fontStatus, setFontStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
    const [fontStatusMessage, setFontStatusMessage] = useState('');
    const assistantContext = useMemo(() => {
        if (selectedMedia && selectedClip) {
            const duration = typeof selectedClip.duration === 'number' ? `${selectedClip.duration.toFixed(2)}s` : 'unknown';
            return `Selected clip: ${selectedMedia.name} (${selectedMedia.type}), duration ${duration}.`;
        }
        if (selectedMedia) {
            return `Selected media: ${selectedMedia.name} (${selectedMedia.type}).`;
        }
        return 'No clip selected in the timeline.';
    }, [selectedClip, selectedMedia]);

    // Reset to properties tab when clip changes
    useEffect(() => {
        if(selectedClip) {
            setActiveTab('PROPERTIES');
            setPresetSelection('');
        }
    }, [selectedClip?.id]);

    const persistCustomFontFamilies = (families: string[]) => {
        try {
            localStorage.setItem(CUSTOM_FONT_FAMILIES_STORAGE_KEY, JSON.stringify(families));
        } catch (error) {
            console.warn('Unable to persist custom font families:', error);
        }
    };

    const discoverLocalFonts = async () => {
        const queryLocalFontsFn = (window as any).queryLocalFonts;
        const electronFontApi = window.electron?.project?.listSystemFonts;

        setFontStatus('loading');
        if (typeof queryLocalFontsFn === 'function') {
            try {
                const localFonts = await queryLocalFontsFn();
                const discovered = Array.isArray(localFonts)
                    ? localFonts.map((entry: any) => String(entry?.family || '').trim()).filter(Boolean)
                    : [];
                setFontFamilies((prev) => {
                    const merged = mergeFontFamilies(prev, discovered);
                    const customOnly = merged.filter((family) => !DEFAULT_FONT_FAMILIES.includes(family));
                    persistCustomFontFamilies(customOnly);
                    return merged;
                });
                setFontStatus('ready');
                setFontStatusMessage(`Scanned ${discovered.length} local font entries.`);
                return;
            } catch (error) {
                const reason = error instanceof Error ? error.message : 'Permission denied';
                console.warn(`queryLocalFonts scan failed (${reason}), trying desktop fallback.`);
            }
        }

        if (typeof electronFontApi === 'function') {
            try {
                const result = await electronFontApi();
                const discovered = Array.isArray(result?.fonts)
                    ? result.fonts.map((font) => String(font || '').trim()).filter(Boolean)
                    : [];
                setFontFamilies((prev) => {
                    const merged = mergeFontFamilies(prev, discovered);
                    const customOnly = merged.filter((family) => !DEFAULT_FONT_FAMILIES.includes(family));
                    persistCustomFontFamilies(customOnly);
                    return merged;
                });
                setFontStatus('ready');
                setFontStatusMessage(`Desktop scan found ${discovered.length} system fonts.`);
                return;
            } catch (error) {
                const reason = error instanceof Error ? error.message : 'Desktop font scan failed';
                setFontStatus('error');
                setFontStatusMessage(`Could not scan local fonts (${reason}).`);
                return;
            }
        }

        setFontStatus('ready');
        setFontStatusMessage('Local font scan not supported in this browser. You can still add fonts manually.');
    };

    useEffect(() => {
        discoverLocalFonts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addManualFontFamily = () => {
        const family = manualFontFamily.trim();
        if (!family) return;
        setFontFamilies((prev) => {
            const merged = mergeFontFamilies(prev, [family]);
            const customOnly = merged.filter((item) => !DEFAULT_FONT_FAMILIES.includes(item));
            persistCustomFontFamilies(customOnly);
            return merged;
        });
        setManualFontFamily('');
    };

    const handleUploadFonts = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const uploadedFamilies: string[] = [];
        for (const file of Array.from(files)) {
            const fallbackFamily = file.name.replace(/\.[^/.]+$/, '').trim() || `Custom Font ${Date.now()}`;
            try {
                const data = await file.arrayBuffer();
                const fontFace = new FontFace(fallbackFamily, data);
                await fontFace.load();
                document.fonts.add(fontFace);
                uploadedFamilies.push(fallbackFamily);
            } catch (error) {
                console.warn(`Failed to load font "${file.name}"`, error);
            }
        }
        if (uploadedFamilies.length > 0) {
            setFontFamilies((prev) => {
                const merged = mergeFontFamilies(prev, uploadedFamilies);
                const customOnly = merged.filter((item) => !DEFAULT_FONT_FAMILIES.includes(item));
                persistCustomFontFamilies(customOnly);
                return merged;
            });
            setFontStatus('ready');
            setFontStatusMessage(`Loaded ${uploadedFamilies.length} font file(s) for this session.`);
        }
    };

    const handleFilterChange = <K extends keyof ClipFilters>(name: K, value: ClipFilters[K]) => {
        if (!selectedClip) return;
        const newFilters = { ...normalizeFilters(selectedClip.filters), [name]: value };
        onUpdateClipFilters(selectedClip.id, newFilters);
    };

    const handlePresetChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        if (!selectedClip) return;
        const presetId = event.target.value;
        setPresetSelection(presetId);
        const preset = LOOK_PRESETS.find((entry) => entry.id === presetId);
        if (!preset) return;
        const newFilters = { ...normalizeFilters(selectedClip.filters), ...preset.filters };
        onUpdateClipFilters(selectedClip.id, newFilters);
        setPresetSelection('');
    };

    const handleImportLut = async (file: File) => {
        if (!selectedClip) return;
        try {
            const text = await file.text();
            const lut = parseCubeLut(text);
            const newFilters: ClipFilters = {
                ...normalizeFilters(selectedClip.filters),
                lut: 'custom',
                customLut: lut,
                customLutName: file.name,
            };
            onUpdateClipFilters(selectedClip.id, newFilters);
        } catch (error) {
            console.error('Failed to import LUT:', error);
            alert((error as Error).message || 'Unable to import LUT.');
        }
    };

    const handleClearCustomLut = () => {
        if (!selectedClip) return;
        const newFilters: ClipFilters = {
            ...normalizeFilters(selectedClip.filters),
            lut: 'none',
            customLut: null,
            customLutName: null,
        };
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

    const getEffectLayers = (clip: TimelineClip | null) => {
        if (!clip) return [] as ClipEffectLayer[];
        return getClipEffectLayers(clip);
    };

    const updateEffectLayers = (nextEffects: ClipEffectLayer[]) => {
        if (!selectedClip) return;
        const synced = syncClipEffectsLegacyField(selectedClip, nextEffects);
        const validIds = new Set(nextEffects.map((entry) => entry.id));
        const keyframes = (selectedClip.keyframes || []).filter((frame) => frame.property !== 'effectIntensity' || !frame.targetEffectId || validIds.has(frame.targetEffectId));
        onUpdateClip({ ...synced, keyframes });
    };

    const handleEffectIntensityChange = (effectId: string, intensity: number) => {
        if (!selectedClip) return;
        const current = getEffectLayers(selectedClip);
        const next = current.map((entry) => (
            entry.id === effectId
                ? normalizeEffectLayer({ ...entry, intensity: Math.max(0, Math.min(100, intensity)) })
                : entry
        ));
        updateEffectLayers(next);
    };

    const handleRemoveEffectLayer = (effectId: string) => {
        if (!selectedClip) return;
        const current = getEffectLayers(selectedClip);
        const next = current.filter((entry) => entry.id !== effectId);
        updateEffectLayers(next);
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

    const handleAddKeyframe = (property: Keyframe['property'], targetEffectId?: string) => {
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
        if (property === 'effectIntensity') {
            const effectLayer = getEffectLayers(selectedClip).find((entry) => entry.id === targetEffectId);
            if (!effectLayer) {
                alert('Select an effect in the Effects tab first.');
                return;
            }
            currentValue = Math.max(0, Math.min(100, effectLayer.intensity ?? 100));
        }

        // Check if keyframe already exists at this time (approx)
        const existingIndex = (selectedClip.keyframes || []).findIndex((k) =>
            k.property === property &&
            (property !== 'effectIntensity' || (k.targetEffectId || '') === (targetEffectId || '')) &&
            Math.abs(k.time - localTime) < 0.1,
        );
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
                targetEffectId: property === 'effectIntensity' ? targetEffectId : undefined,
                easing: 'linear'
            };
            newKeyframes.push(newKeyframe);
        }

        onUpdateClip({ ...selectedClip, keyframes: newKeyframes });
    };

    const handleCreateEffectBurst = (effectId: string, frames = 20) => {
        if (!selectedClip) return;
        const localTime = (props.playheadPosition - selectedClip.start) * selectedClip.speed;
        if (localTime < 0 || localTime > selectedClip.duration) {
            alert('Playhead is outside the clip range.');
            return;
        }
        const effectLayer = getEffectLayers(selectedClip).find((entry) => entry.id === effectId);
        if (!effectLayer) return;

        const frameDuration = 1 / 30;
        const start = Math.max(0, localTime);
        const end = Math.min(selectedClip.duration, start + frames * frameDuration);
        const mid = start + (end - start) / 2;
        const peakValue = Math.max(0, Math.min(100, effectLayer.intensity ?? 100));

        const keep = (selectedClip.keyframes || []).filter((frame) => (
            frame.property !== 'effectIntensity' ||
            frame.targetEffectId !== effectId ||
            frame.time < start - 0.001 ||
            frame.time > end + 0.001
        ));
        const burst: Keyframe[] = [
            { id: `kf-${Date.now()}-a`, property: 'effectIntensity', targetEffectId: effectId, time: start, value: 0, easing: 'ease-out' },
            { id: `kf-${Date.now()}-b`, property: 'effectIntensity', targetEffectId: effectId, time: mid, value: peakValue, easing: 'ease-in' },
            { id: `kf-${Date.now()}-c`, property: 'effectIntensity', targetEffectId: effectId, time: end, value: 0, easing: 'ease-out' },
        ];
        onUpdateClip({ ...selectedClip, keyframes: [...keep, ...burst] });
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
                context={assistantContext}
            />;
        }

        switch (activeTab) {
            case 'PROPERTIES': {
                const displayDuration = (selectedMedia.type === 'video' ? (selectedMedia.duration || 5) : selectedClip.duration) / selectedClip.speed;
                return (
                    <div className="insp-body">
                        <div className="pk-card">
                            <dl className="insp-facts">
                                <div><dt>Name</dt><dd title={selectedMedia.name}>{selectedMedia.name}</dd></div>
                                <div><dt>Type</dt><dd className="capitalize">{selectedMedia.type}</dd></div>
                                <div><dt>On timeline</dt><dd className="pk-mono">{displayDuration.toFixed(2)}s</dd></div>
                                <div><dt>In · out</dt><dd className="pk-mono">{selectedClip.start.toFixed(2)}s · {selectedClip.end.toFixed(2)}s</dd></div>
                            </dl>
                        </div>
                        <div className="pk-card">
                            <SliderRow id="speed" label="Speed" value={selectedClip.speed} display={`${selectedClip.speed.toFixed(2)}×`} min={0.25} max={4} step={0.05} onChange={handleSpeedChange} onReset={() => handleSpeedChange(1)} />
                            <label className="pk-field">
                                <span>Blend</span>
                                <select id="blendMode" value={selectedClip.blendMode || 'normal'} onChange={handleBlendModeChange}>
                                    <option value="normal">Normal</option>
                                    <option value="screen">Screen · lighten</option>
                                    <option value="overlay">Overlay · contrast</option>
                                    <option value="multiply">Multiply · darken</option>
                                    <option value="darken">Darken</option>
                                    <option value="lighten">Lighten</option>
                                    <option value="color-dodge">Color dodge</option>
                                    <option value="soft-light">Soft light</option>
                                    <option value="difference">Difference</option>
                                </select>
                            </label>
                        </div>
                    </div>
                );
            }
            case 'EFFECTS': {
                const chromaKeyConfig = selectedClip.chromaKey;
                const activeEffects = getEffectLayers(selectedClip);
                return (
                    <div className="insp-body">
                        <section className="fx-section">
                            <header className="fx-section__title">Effect stack · {activeEffects.length}</header>
                            {activeEffects.length > 0 ? (
                                <div className="pk-list">
                                    {activeEffects.map((effectLayer) => (
                                        <div key={effectLayer.id} className="pk-card">
                                            <div className="pk-card__head">
                                                <span className="pk-card__title">{effectLayer.effect}</span>
                                                <span className="pk-actions">
                                                    <button type="button" className="edit-text-btn" onClick={() => handleAddKeyframe('effectIntensity', effectLayer.id)} title="Add an intensity keyframe at the playhead"><KeyframeIcon className="w-3 h-3" />Key</button>
                                                    <button type="button" className="edit-text-btn" onClick={() => handleCreateEffectBurst(effectLayer.id, 20)} title="20-frame burst: 0 → 100 → 0 around the playhead">Burst</button>
                                                    <button type="button" className="edit-icon-btn" onClick={() => handleRemoveEffectLayer(effectLayer.id)} title="Remove effect" aria-label="Remove effect"><XIcon className="w-3.5 h-3.5" /></button>
                                                </span>
                                            </div>
                                            <SliderRow id={`fx-${effectLayer.id}`} label="Intensity" value={Math.round(effectLayer.intensity)} display={`${Math.round(effectLayer.intensity)}%`} min={0} max={100} onChange={(value) => handleEffectIntensityChange(effectLayer.id, value)} onReset={() => handleEffectIntensityChange(effectLayer.id, 100)} />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="pk-empty"><EffectsIcon /><strong>No effects yet</strong><span>Pick one from the Effects browser on the left — it lands here.</span></div>
                            )}
                        </section>
                        <section className="fx-section">
                            <header className="fx-section__title">Chroma key</header>
                            {!chromaKeyConfig ? (
                                <p className="pk-hint">Add “Chroma Key” from the Effects browser to key out a green screen.</p>
                            ) : (
                                <div className="pk-card">
                                    <label className="insp-color">
                                        <span>Key colour</span>
                                        <input id="keyColor" type="color" value={chromaKeyConfig.color} onChange={(e) => handleChromaKeyChange('color', e.target.value)} />
                                        <code className="pk-mono">{chromaKeyConfig.color}</code>
                                    </label>
                                    <SliderRow id="tolerance" label="Tolerance" value={chromaKeyConfig.tolerance} display={`${Math.round(chromaKeyConfig.tolerance * 100)}%`} min={0} max={1} step={0.01} onChange={(value) => handleChromaKeyChange('tolerance', value)} />
                                </div>
                            )}
                        </section>
                    </div>
                );
            }
            case 'COLOR': {
                const filters = normalizeFilters(selectedClip.filters);
                const selectedLut = FILM_LUTS.find((preset) => preset.id === filters.lut);
                const customLutLabel = filters.customLutName ? `Custom · ${filters.customLutName}` : 'Custom .cube';
                return (
                    <div className="insp-body">
                        <div className="pk-card">
                            <label className="pk-field">
                                <span>Look preset</span>
                                <select id="lookPreset" value={presetSelection} onChange={handlePresetChange}>
                                    <option value="">Choose a look…</option>
                                    {['Film Stock', 'Clean Cinematic', 'Vintage/Lo-fi'].map((category) => {
                                        const presets = LOOK_PRESETS.filter((preset) => preset.category === category);
                                        if (presets.length === 0) return null;
                                        return (
                                            <optgroup key={category} label={category}>
                                                {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                                            </optgroup>
                                        );
                                    })}
                                </select>
                            </label>
                        </div>
                        <section className="fx-section">
                            <header className="fx-section__title">Primaries</header>
                            <div className="pk-card">
                                <SliderRow id="brightness" label="Brightness" value={filters.brightness} display={`${filters.brightness}%`} min={0} max={200} onChange={(v) => handleFilterChange('brightness', v)} onReset={() => handleFilterChange('brightness', 100)} />
                                <SliderRow id="contrast" label="Contrast" value={filters.contrast} display={`${filters.contrast}%`} min={0} max={200} onChange={(v) => handleFilterChange('contrast', v)} onReset={() => handleFilterChange('contrast', 100)} />
                                <SliderRow id="saturate" label="Saturation" value={filters.saturate} display={`${filters.saturate}%`} min={0} max={200} onChange={(v) => handleFilterChange('saturate', v)} onReset={() => handleFilterChange('saturate', 100)} />
                                <SliderRow id="hueRotate" label="Hue" value={filters.hueRotate} display={`${filters.hueRotate}°`} min={0} max={360} onChange={(v) => handleFilterChange('hueRotate', v)} onReset={() => handleFilterChange('hueRotate', 0)} />
                            </div>
                        </section>
                        <section className="fx-section">
                            <header className="fx-section__title">Film</header>
                            <div className="pk-card">
                                <label className="pk-field">
                                    <span>Emulation</span>
                                    <select id="lut" value={filters.lut} onChange={(e) => handleFilterChange('lut', e.target.value as LutId)}>
                                        {FILM_LUTS.map((lut) => <option key={lut.id} value={lut.id}>{lut.name}</option>)}
                                        {filters.customLut ? <option value="custom">{customLutLabel}</option> : <option value="custom" disabled>Custom .cube (import below)</option>}
                                    </select>
                                </label>
                                {selectedLut?.description && filters.lut !== 'custom' ? <p className="pk-hint">{selectedLut.description}</p> : null}
                                <SliderRow id="lutIntensity" label="Strength" value={filters.lutIntensity} display={`${filters.lutIntensity}%`} min={0} max={100} disabled={filters.lut === 'none'} onChange={(v) => handleFilterChange('lutIntensity', v)} onReset={() => handleFilterChange('lutIntensity', 100)} />
                                <div className="pk-actions">
                                    <input ref={lutInputRef} type="file" accept=".cube" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleImportLut(file); event.currentTarget.value = ''; }} />
                                    <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => lutInputRef.current?.click()}>Import .cube</button>
                                    <button type="button" className="edit-text-btn" onClick={handleClearCustomLut} disabled={!filters.customLut}>Clear custom</button>
                                </div>
                                <SliderRow id="grain" label="Grain" value={filters.grain} display={`${filters.grain}%`} min={0} max={100} onChange={(v) => handleFilterChange('grain', v)} onReset={() => handleFilterChange('grain', 0)} />
                            </div>
                        </section>
                        <section className="fx-section">
                            <header className="fx-section__title">Glow &amp; lens</header>
                            <div className="pk-card">
                                <SliderRow id="halation" label="Halation" value={filters.halation} display={`${filters.halation}%`} min={0} max={100} onChange={(v) => handleFilterChange('halation', v)} onReset={() => handleFilterChange('halation', 0)} />
                                <SliderRow id="bloom" label="Bloom" value={filters.bloom} display={`${filters.bloom}%`} min={0} max={100} onChange={(v) => handleFilterChange('bloom', v)} onReset={() => handleFilterChange('bloom', 0)} />
                                <SliderRow id="vignette" label="Vignette" value={filters.vignette} display={`${filters.vignette}%`} min={0} max={100} onChange={(v) => handleFilterChange('vignette', v)} onReset={() => handleFilterChange('vignette', 0)} />
                            </div>
                        </section>
                    </div>
                );
            }
            case 'TRANSFORM': {
                const transform = selectedClip.transform || DEFAULT_TRANSFORM;
                return (
                    <div className="insp-body">
                        <div className="pk-card">
                            <SliderRow id="scale" label="Scale" value={transform.scale} display={`${(transform.scale * 100).toFixed(0)}%`} min={0.1} max={3} step={0.01} onChange={(v) => handleTransformChange('scale', v)} onReset={() => handleTransformChange('scale', 1)} />
                            <SliderRow id="opacity" label="Opacity" value={transform.opacity} display={`${(transform.opacity * 100).toFixed(0)}%`} min={0} max={1} step={0.01} onChange={(v) => handleTransformChange('opacity', v)} onReset={() => handleTransformChange('opacity', 1)} />
                        </div>
                        <div className="pk-card">
                            <SliderRow id="positionX" label="Position X" value={transform.position.x} display={`${transform.position.x.toFixed(1)}%`} min={0} max={100} step={0.1} onChange={(v) => handleTransformChange('positionX', v)} onReset={() => handleTransformChange('positionX', 50)} />
                            <SliderRow id="positionY" label="Position Y" value={transform.position.y} display={`${transform.position.y.toFixed(1)}%`} min={0} max={100} step={0.1} onChange={(v) => handleTransformChange('positionY', v)} onReset={() => handleTransformChange('positionY', 50)} />
                        </div>
                        <p className="pk-hint">Double-click a value to reset it.</p>
                    </div>
                );
            }
            case 'MOTION': {
                const kenBurns = selectedClip.kenBurns || DEFAULT_KEN_BURNS;
                return (
                    <div className="insp-body">
                        <div className="pk-card">
                            <label className="pk-switch">
                                <span>
                                    <span className="pk-card__title" style={{ display: 'block' }}>Ken Burns</span>
                                    <span className="pk-hint">Slow push and pan from a start to an end framing.</span>
                                </span>
                                <input type="checkbox" checked={kenBurns.enabled} onChange={toggleKenBurns} />
                            </label>
                        </div>
                        {kenBurns.enabled && (['start', 'end'] as const).map((phase) => (
                            <section key={phase} className="fx-section">
                                <header className="fx-section__title">{phase === 'start' ? 'Start' : 'End'} framing</header>
                                <div className="pk-card">
                                    <SliderRow id={`kb-${phase}-scale`} label="Scale" value={kenBurns[phase].scale} display={`${kenBurns[phase].scale.toFixed(2)}×`} min={1} max={3} step={0.1} onChange={(v) => handleKenBurnsChange(phase, 'scale', v)} />
                                    <SliderRow id={`kb-${phase}-x`} label="Pan X" value={kenBurns[phase].x} display={`${kenBurns[phase].x}`} min={-50} max={50} onChange={(v) => handleKenBurnsChange(phase, 'x', v)} onReset={() => handleKenBurnsChange(phase, 'x', 0)} />
                                    <SliderRow id={`kb-${phase}-y`} label="Pan Y" value={kenBurns[phase].y} display={`${kenBurns[phase].y}`} min={-50} max={50} onChange={(v) => handleKenBurnsChange(phase, 'y', v)} onReset={() => handleKenBurnsChange(phase, 'y', 0)} />
                                </div>
                            </section>
                        ))}
                    </div>
                );
            }
            case 'KEYFRAMES': {
                const keyframes = [...(selectedClip.keyframes || [])].sort((a, b) => a.time - b.time);
                const effectNameById = new Map(getEffectLayers(selectedClip).map((entry) => [entry.id, entry.effect]));
                return (
                    <div className="insp-body">
                        <p className="pk-hint">Park the playhead where the value should land, then add a key for that property.</p>
                        <div className="pk-chips">
                            {([['scale', 'Scale'], ['opacity', 'Opacity'], ['x', 'Pos X'], ['y', 'Pos Y'], ['volume', 'Volume']] as const).map(([property, label]) => (
                                <button key={property} type="button" className="pk-chip pk-chip--accent" onClick={() => handleAddKeyframe(property)}><AddIcon className="w-3 h-3" />{label}</button>
                            ))}
                            {getEffectLayers(selectedClip).map((entry) => (
                                <button key={entry.id} type="button" className="pk-chip pk-chip--accent" onClick={() => handleAddKeyframe('effectIntensity', entry.id)} title={`Intensity of ${entry.effect}`}><AddIcon className="w-3 h-3" />FX · {entry.effect.slice(0, 14)}</button>
                            ))}
                        </div>
                        <section className="fx-section">
                            <header className="fx-section__title">Keys · {keyframes.length}</header>
                            {keyframes.length === 0 ? (
                                <div className="pk-empty"><KeyframeIcon /><strong>No keyframes</strong><span>Add one above — it is placed at the current playhead.</span></div>
                            ) : (
                                <div className="pk-list">
                                    {keyframes.map((kf) => (
                                        <div key={kf.id} className="pk-row insp-key">
                                            <span className="pk-mono insp-key__time">{kf.time.toFixed(2)}s</span>
                                            <span className="insp-key__prop">{kf.property === 'effectIntensity' ? `FX · ${effectNameById.get(kf.targetEffectId || '') || 'Effect'}` : kf.property}</span>
                                            <span className="pk-mono insp-key__value">{kf.value.toFixed(2)}</span>
                                            <button type="button" className="edit-icon-btn" onClick={() => handleRemoveKeyframe(kf.id)} aria-label="Remove keyframe" title="Remove"><XIcon className="w-3.5 h-3.5" /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>
                );
            }
            case 'TRANSITIONS':
                return (
                    <div className="insp-body">
                        {!selectedClip.transitionOut ? (
                            <div className="pk-empty"><TransitionsIcon /><strong>No transition</strong><span>Choose one in the Transitions browser — it is added at the end of this clip.</span></div>
                        ) : (
                            <div className="pk-card">
                                <div className="pk-card__head"><span className="pk-card__title">Outgoing</span><button type="button" className="edit-text-btn" onClick={() => onUpdateClipTransition(selectedClip.id, null)}>Remove</button></div>
                                <label className="pk-field">
                                    <span>Type</span>
                                    <select value={selectedClip.transitionOut.type} onChange={handleTransitionTypeChange}>
                                        {TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </select>
                                </label>
                                <label className="pk-field">
                                    <span>Duration</span>
                                    <span className="pk-inline"><input type="number" value={selectedClip.transitionOut.duration} onChange={handleTransitionDurationChange} step="0.1" min="0.1" style={{ width: '5rem' }} />s</span>
                                </label>
                            </div>
                        )}
                    </div>
                );
            case 'TEXT': {
                const textConfig = selectedClip.textConfig;
                if (!textConfig) return null;
                const fontOptions = mergeFontFamilies(fontFamilies, [textConfig.font]);
                const searchTerm = fontSearch.trim().toLowerCase();
                const visibleFontOptions = searchTerm ? fontOptions.filter((family) => family.toLowerCase().includes(searchTerm)) : fontOptions;
                return (
                    <div className="insp-body">
                        <label className="pk-field">
                            <span>Text</span>
                            <textarea id="textContent" rows={3} value={textConfig.content} onChange={(e) => handleTextConfigChange('content', e.target.value)} style={{ fontFamily: textConfig.font }} />
                        </label>
                        <div className="pk-card">
                            <div className="insp-grid-2">
                                <label className="pk-field">
                                    <span>Font</span>
                                    <select id="font" value={textConfig.font} onChange={(e) => handleTextConfigChange('font', e.target.value)}>
                                        {visibleFontOptions.length > 0 ? visibleFontOptions.map((family) => <option key={family} value={family}>{family}</option>) : <option value={textConfig.font}>{textConfig.font}</option>}
                                    </select>
                                </label>
                                <label className="pk-field">
                                    <span>Colour</span>
                                    <span className="insp-color"><input id="color" type="color" value={textConfig.color} onChange={(e) => handleTextConfigChange('color', e.target.value)} /><code className="pk-mono">{textConfig.color}</code></span>
                                </label>
                            </div>
                            <SliderRow id="size" label="Size" value={textConfig.size} display={`${textConfig.size}px`} min={12} max={128} onChange={(v) => handleTextConfigChange('size', v)} />
                            <div className="pk-field">
                                <span>Position</span>
                                <div className="insp-posgrid" role="radiogroup" aria-label="Text position">
                                    {POSITIONS.map((position, index) => {
                                        const isCenterCell = index === 4;
                                        const isDead = (index === 3 || index === 5);
                                        if (isDead) return <span key={index} aria-hidden="true" />;
                                        const active = textConfig.position === position;
                                        return (
                                            <button key={index} type="button" role="radio" aria-checked={active} aria-label={position} title={position.replace('-', ' ')} className={`insp-posgrid__cell ${active ? 'insp-posgrid__cell--active' : ''} ${isCenterCell ? 'insp-posgrid__cell--center' : ''}`} onClick={() => handleTextConfigChange('position', position)}>
                                                <span />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                        <details className="pk-details">
                            <summary>Font library<small>{visibleFontOptions.length} fonts</small></summary>
                            <div className="pk-details__body">
                                <input id="fontSearch" type="search" value={fontSearch} onChange={(event) => setFontSearch(event.target.value)} placeholder="Search fonts" aria-label="Search fonts" />
                                <div className="pk-actions">
                                    <input value={manualFontFamily} onChange={(event) => setManualFontFamily(event.target.value)} placeholder="Add a font family by name" style={{ flex: 1 }} />
                                    <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={addManualFontFamily}>Add</button>
                                </div>
                                <div className="pk-actions">
                                    <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={() => fontUploadInputRef.current?.click()}>Upload font file</button>
                                    <button type="button" className="edit-text-btn" onClick={discoverLocalFonts}>{fontStatus === 'loading' ? 'Scanning…' : 'Scan local fonts'}</button>
                                </div>
                                <input ref={fontUploadInputRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" multiple className="hidden" onChange={(event) => { handleUploadFonts(event.target.files); event.currentTarget.value = ''; }} />
                                {fontStatusMessage && <p className="pk-hint">{fontStatusMessage}</p>}
                            </div>
                        </details>
                    </div>
                );
            }
            case 'AI':
                return <AIAssistant apiKeyReady={props.apiKeyReady} tools={props.aiTools} toolExecutor={props.aiToolExecutor} context={assistantContext} />;
        }
    }

    const tabs: { id: InspectorTab; icon: React.FC<{ className?: string }>; name: string }[] = [
        { id: 'PROPERTIES', icon: PropertiesIcon, name: 'Clip' },
    ];
    if (selectedMedia?.type === 'video' || selectedMedia?.type === 'image') {
        tabs.push(
            { id: 'TRANSFORM', icon: TransformIcon, name: 'Transform' },
            { id: 'MOTION', icon: MotionIcon, name: 'Motion' },
            { id: 'KEYFRAMES', icon: KeyframeIcon, name: 'Keyframes' },
            { id: 'EFFECTS', icon: EffectsIcon, name: 'Effects' },
            { id: 'COLOR', icon: ColorIcon, name: 'Color' },
            { id: 'TRANSITIONS', icon: TransitionsIcon, name: 'Transition' },
        );
    }
    if (selectedClip?.textConfig) tabs.push({ id: 'TEXT', icon: TextIcon, name: 'Text' });
    tabs.push({ id: 'AI', icon: MagicWandIcon, name: 'Assistant' });
    const activeMeta = tabs.find((tab) => tab.id === activeTab) || tabs[0];

    return (
        <div className="insp">
            <div className="insp__header">
                <div className="insp__title">
                    <h3>{selectedClip ? 'Inspector' : 'Assistant'}</h3>
                    {selectedMedia && selectedClip && (
                        <span className="insp__subject" title={selectedMedia.name}>
                            <span className={`fl-strip__badge fl-strip__badge--${selectedMedia.type === 'audio' ? 'audio' : 'video'}`}>{selectedMedia.type === 'audio' ? 'A' : selectedClip.textConfig ? 'T' : 'V'}</span>
                            <span>{selectedClip.textConfig?.content?.split('\n')[0] || selectedMedia.name}</span>
                        </span>
                    )}
                </div>
                {!selectedClip && <p className="pk-hint">Select a clip to edit it here. Until then, ask the assistant anything about the cut.</p>}
            </div>

            {selectedClip && (
                <div className="insp__tabs" role="tablist" aria-label="Inspector sections">
                    {tabs.map((tab) => {
                        const active = activeTab === tab.id;
                        return (
                            <button key={tab.id} type="button" role="tab" aria-selected={active} aria-label={tab.name} title={tab.name} className={`insp__tab ${active ? 'insp__tab--active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                                <tab.icon className="w-4 h-4" />
                                {active && <span>{tab.name}</span>}
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="insp__scroll">
                {selectedClip && activeTab !== 'AI' && <div className="insp__section-name">{activeMeta.name}</div>}
                {renderTabContent()}
            </div>
        </div>
    );
};

export default InspectorPanel;
