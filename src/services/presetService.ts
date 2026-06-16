import { useState, useEffect } from 'react';

export interface Preset {
    id: string;
    label: string;
    prompt: string;
    image: string;
    isCustom?: boolean;
}

const STORAGE_KEYS = {
    STYLE: 'custom_style_presets',
    SHOT_TYPE: 'custom_shot_type_presets',
    LIGHTING: 'custom_lighting_presets',
};

export const usePresets = (
    storageKey: string,
    defaultPresets: Preset[]
) => {
    const [customPresets, setCustomPresets] = useState<Preset[]>([]);

    // Load from local storage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                setCustomPresets(JSON.parse(stored));
            }
        } catch (e) {
            console.error('Failed to load custom presets', e);
        }
    }, [storageKey]);

    const addPreset = (label: string, prompt: string, imageUrl: string) => {
        const newPreset: Preset = {
            id: `custom-${Date.now()}`,
            label,
            prompt,
            image: imageUrl,
            isCustom: true,
        };

        const updated = [newPreset, ...customPresets];
        setCustomPresets(updated);
        localStorage.setItem(storageKey, JSON.stringify(updated));
    };

    const removePreset = (id: string) => {
        const updated = customPresets.filter(p => p.id !== id);
        setCustomPresets(updated);
        localStorage.setItem(storageKey, JSON.stringify(updated));
    };

    const allPresets = [...customPresets, ...defaultPresets];

    return {
        allPresets,
        customPresets,
        addPreset,
        removePreset,
    };
};

export const PRESET_KEYS = STORAGE_KEYS;
