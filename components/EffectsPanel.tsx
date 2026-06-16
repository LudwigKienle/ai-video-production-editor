





import React from 'react';
import { Effect, EffectType } from '../types';
import { EFFECTS } from '../constants';
import { MagicWandIcon, PaintBucketIcon, TextIcon, KeyingIcon } from './icons';

interface EffectsPanelProps {
  onApplyEffect: (effect: EffectType) => void;
  onApplyAIEffect: (effect: Effect) => void;
  onApplyNativeEffect: (effect: Effect, value: string) => void;
  disabled: boolean;
}

const EffectsPanel: React.FC<EffectsPanelProps> = ({ onApplyEffect, onApplyAIEffect, onApplyNativeEffect, disabled }) => {

  const handleEffectClick = async (effect: Effect) => {
    if (disabled && (effect.type === 'css' || effect.type === 'native')) return;

    if (effect.type === 'ai') {
        onApplyAIEffect(effect);
    } else if (effect.type === 'native') {
        if (effect.id === EffectType.NATIVE_SOLID_COLOR) {
            const color = window.prompt(`Enter a color (e.g., #RRGGBB, color name):`, '#2563eb');
            if (color) {
                onApplyNativeEffect(effect, color);
            }
        } else if (effect.id === EffectType.TEXT || effect.id === EffectType.CHROMA_KEY) {
            // No value needed, the handler in App.tsx will toggle the effect
            onApplyNativeEffect(effect, '');
        }
    } else { // 'css'
        onApplyEffect(effect.id);
    }
  };

  const getIcon = (effect: Effect) => {
      if (effect.type === 'ai') return <MagicWandIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />;
      if (effect.id === EffectType.TEXT) return <TextIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />;
      if (effect.id === EffectType.CHROMA_KEY) return <KeyingIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />;
      if (effect.id === EffectType.NATIVE_SOLID_COLOR) return <PaintBucketIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />;
      return null;
  }

  return (
    <div className="bg-gray-800/50 p-4 flex flex-col h-full">
      <h3 className="text-lg font-semibold mb-4 text-white">Effects Library</h3>
      <div className="flex-grow overflow-y-auto pr-2 -mr-2 space-y-2">
        {EFFECTS.map(effect => (
          <div
            key={effect.id}
            onClick={() => handleEffectClick(effect)}
            className={`p-3 rounded-lg border-2 transition-all duration-200 ${
              (disabled && (effect.type === 'css' || effect.type === 'native'))
                ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                : 'bg-gray-900/50 border-gray-700 hover:border-indigo-500 hover:bg-gray-800 cursor-pointer'
            }`}
          >
            <div className="flex items-center gap-3">
              {getIcon(effect)}
              <div className="flex-grow">
                <p className="font-semibold text-white">{effect.name}</p>
                <p className="text-sm text-gray-400">{effect.description}</p>
              </div>
            </div>
          </div>
        ))}
        {disabled && <p className="text-xs text-center text-gray-500 mt-4">Select a clip on the timeline to apply effects.</p>}
      </div>
    </div>
  );
};

export default EffectsPanel;