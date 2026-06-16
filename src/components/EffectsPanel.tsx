import React, { useEffect, useMemo, useState } from 'react';
import { Effect, EffectType } from '../types';
import { EFFECTS, EFFECT_STACK_PRESETS } from '../constants';
import { MagicWandIcon, PaintBucketIcon, TextIcon, KeyingIcon } from './icons';
import { buildStyleFilterForEffect } from '../utils/effects';

interface EffectsPanelProps {
  onApplyEffect: (effect: EffectType) => void;
  onApplyAIEffect: (effect: Effect) => void;
  onApplyNativeEffect: (effect: Effect, value: string) => void;
  onApplyEffectStack: (stackId: string) => void;
  disabled: boolean;
  previewFrameUrl?: string | null;
  previewSourceLabel?: string;
}

const EffectsPanel: React.FC<EffectsPanelProps> = ({
  onApplyEffect,
  onApplyAIEffect,
  onApplyNativeEffect,
  onApplyEffectStack,
  disabled,
  previewFrameUrl,
  previewSourceLabel,
}) => {
  const [search, setSearch] = useState('');
  const [panelView, setPanelView] = useState<'library' | 'marketplace'>('library');
  const [typeFilter, setTypeFilter] = useState<'all' | 'looks' | 'stylize' | 'vfx' | 'native' | 'ai'>('all');
  const [stackFilter, setStackFilter] = useState<'all' | 'look' | 'stylize' | 'vfx'>('all');
  const [hoveredEffect, setHoveredEffect] = useState<EffectType | null>(null);
  const [previewTick, setPreviewTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPreviewTick((prev) => (prev + 0.02) % 1);
    }, 40);
    return () => window.clearInterval(interval);
  }, []);

  const getEffectCategory = (effect: Effect): 'looks' | 'stylize' | 'vfx' | 'native' | 'ai' => {
    if (effect.type === 'ai') return 'ai';
    if (effect.type === 'native') return 'native';
    if (
      effect.id === EffectType.VAN_GOGH ||
      effect.id === EffectType.ANIME ||
      effect.id === EffectType.WATERCOLOR ||
      effect.id === EffectType.COMIC
    ) {
      return 'stylize';
    }
    if (
      effect.id === EffectType.FIRE_OVERLAY ||
      effect.id === EffectType.LIGHTNING_OVERLAY ||
      effect.id === EffectType.EXPLOSION_OVERLAY ||
      effect.id === EffectType.GLITCH_OVERLAY
    ) {
      return 'vfx';
    }
    return 'looks';
  };

  const isEffectUnavailable = (effect: Effect) =>
    disabled && (
      effect.type === 'css' ||
      (effect.type === 'native' && effect.id !== EffectType.NATIVE_SOLID_COLOR && effect.id !== EffectType.TEXT)
    );

  const handleEffectClick = async (effect: Effect) => {
    if (isEffectUnavailable(effect)) return;

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
  };

  const filteredEffects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return EFFECTS.filter((effect) => {
      if (typeFilter !== 'all' && getEffectCategory(effect) !== typeFilter) return false;
      if (!term) return true;
      return (
        effect.name.toLowerCase().includes(term) ||
        effect.description.toLowerCase().includes(term) ||
        getEffectCategory(effect).toLowerCase().includes(term)
      );
    });
  }, [search, typeFilter]);

  const filteredStacks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return EFFECT_STACK_PRESETS.filter((stack) => {
      if (stackFilter !== 'all' && stack.category !== stackFilter) return false;
      if (!term) return true;
      return (
        stack.name.toLowerCase().includes(term) ||
        stack.description.toLowerCase().includes(term) ||
        stack.baseEffect.toLowerCase().includes(term) ||
        (stack.effects || []).some((entry) => entry.effect.toLowerCase().includes(term))
      );
    });
  }, [search, stackFilter]);

  const activePreviewEffect = useMemo(
    () =>
      EFFECTS.find((entry) => entry.id === hoveredEffect) ||
      filteredEffects[0] ||
      null,
    [hoveredEffect, filteredEffects]
  );

  const renderPreview = () => {
    if (!activePreviewEffect) {
      return (
        <div className="mb-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3 text-[11px] text-gray-500">
          Hover an effect card to preview it.
        </div>
      );
    }

    const progress = (Math.sin(previewTick * Math.PI * 2) + 1) / 2;
    const previewFilter = buildStyleFilterForEffect(activePreviewEffect.id, 1) || 'none';
    const overlays: React.ReactNode[] = [];

    if (activePreviewEffect.id === EffectType.FIRE_OVERLAY) {
      overlays.push(
        <div
          key="fire"
          className="absolute inset-x-0 bottom-0 h-2/5"
          style={{
            opacity: 0.75,
            background: 'linear-gradient(to top, rgba(255,72,0,0.78), rgba(255,163,55,0.42), rgba(255,214,130,0))',
          }}
        />
      );
    }
    if (activePreviewEffect.id === EffectType.LIGHTNING_OVERLAY) {
      overlays.push(<div key="storm" className="absolute inset-0 bg-sky-100/15" style={{ opacity: Math.max(0, Math.sin(progress * Math.PI) * 0.9) }} />);
      overlays.push(<div key="bolt" className="absolute w-0.5 bg-white/90" style={{ height: '100%', left: `${20 + progress * 55}%`, transform: 'skewX(-18deg)' }} />);
    }
    if (activePreviewEffect.id === EffectType.EXPLOSION_OVERLAY) {
      overlays.push(
        <div
          key="burst"
          className="absolute rounded-full"
          style={{
            width: `${20 + progress * 70}%`,
            height: `${20 + progress * 70}%`,
            left: `${40 - progress * 20}%`,
            top: `${40 - progress * 20}%`,
            opacity: Math.max(0, Math.sin(progress * Math.PI) * 0.82),
            background: 'radial-gradient(circle, rgba(255,244,190,0.95) 0%, rgba(255,152,70,0.58) 56%, rgba(255,78,0,0) 100%)',
          }}
        />
      );
    }
    if (activePreviewEffect.id === EffectType.GLITCH_OVERLAY) {
      overlays.push(<div key="scan1" className="absolute inset-x-0 h-1 bg-cyan-300/45" style={{ top: `${12 + progress * 68}%` }} />);
      overlays.push(<div key="scan2" className="absolute inset-x-0 h-1 bg-fuchsia-300/40" style={{ top: `${65 - progress * 40}%` }} />);
    }
    if (activePreviewEffect.id === EffectType.COMIC) {
      overlays.push(
        <div
          key="comic-lines"
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.35), rgba(0,0,0,0.35) 1px, transparent 1px, transparent 4px)',
          }}
        />
      );
    }

    return (
      <div className="mb-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">Source Frame Preview</div>
          <div className="text-[11px] text-indigo-300">{activePreviewEffect.name}</div>
        </div>
        <div className="relative h-24 overflow-hidden rounded-md border border-gray-700 bg-black">
          {previewFrameUrl ? (
            <div className="absolute inset-0" style={{ filter: previewFilter, transform: `scale(${1 + progress * 0.02})` }}>
              <img src={previewFrameUrl} className="h-full w-full object-cover" alt="Effect preview source frame" />
            </div>
          ) : (
            <>
              <div className="absolute inset-0 bg-gradient-to-br from-purple-600/40 via-indigo-600/40 to-blue-500/35" />
              <div className="absolute inset-0" style={{ filter: previewFilter, transform: `scale(${1 + progress * 0.02})` }}>
                <div className="h-full w-full bg-gradient-to-br from-orange-300/55 via-pink-300/45 to-sky-300/40" />
              </div>
            </>
          )}
          {overlays}
          <div className="absolute bottom-0 left-0 h-0.5 bg-indigo-400" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">{getEffectCategory(activePreviewEffect)}</div>
          {previewFrameUrl ? (
            <div className="text-[10px] text-gray-500 truncate max-w-[55%]">{previewSourceLabel || 'Source monitor'}</div>
          ) : (
            <div className="text-[10px] text-gray-500">No source frame available</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-gray-800/50 p-4 flex flex-col h-full">
      <h3 className="text-lg font-semibold mb-3 text-white">Effects Library</h3>
      <div className="mb-3 grid grid-cols-2 gap-2 text-[10px] uppercase tracking-wide">
        <button
          type="button"
          onClick={() => setPanelView('library')}
          className={`rounded border px-2 py-1 ${panelView === 'library' ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
        >
          Library
        </button>
        <button
          type="button"
          onClick={() => setPanelView('marketplace')}
          className={`rounded border px-2 py-1 ${panelView === 'marketplace' ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}
        >
          Marketplace
        </button>
      </div>
      {panelView === 'library' && renderPreview()}
      <div className="space-y-2 mb-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search effects..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200"
        />
        <div className="flex items-center gap-2">
          {panelView === 'library' ? (
            <>
              {([
                { id: 'all', label: 'All' },
                { id: 'looks', label: 'Looks' },
                { id: 'stylize', label: 'Stylize' },
                { id: 'vfx', label: 'VFX' },
                { id: 'native', label: 'Native' },
                { id: 'ai', label: 'AI' },
              ] as const).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTypeFilter(entry.id)}
                  className={`px-2.5 py-1 rounded text-[10px] border ${typeFilter === entry.id ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-gray-900 text-gray-400 border-gray-700 hover:text-gray-200'}`}
                >
                  {entry.label}
                </button>
              ))}
            </>
          ) : (
            <>
              {([
                { id: 'all', label: 'All' },
                { id: 'look', label: 'Look' },
                { id: 'stylize', label: 'Stylize' },
                { id: 'vfx', label: 'VFX' },
              ] as const).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setStackFilter(entry.id)}
                  className={`px-2.5 py-1 rounded text-[10px] border ${stackFilter === entry.id ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-gray-900 text-gray-400 border-gray-700 hover:text-gray-200'}`}
                >
                  {entry.label}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="flex-grow overflow-y-auto pr-2 -mr-2 space-y-2">
        {panelView === 'library' ? (
          <>
            {filteredEffects.map(effect => (
              <div
                key={effect.id}
                onClick={() => handleEffectClick(effect)}
                onMouseEnter={() => setHoveredEffect(effect.id)}
                onMouseLeave={() => setHoveredEffect((current) => (current === effect.id ? null : current))}
                draggable={effect.type === 'css'}
                onDragStart={(event) => {
                  if (effect.type !== 'css') return;
                  event.dataTransfer.setData('application/x-effect-id', effect.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                className={`p-3 rounded-lg border-2 transition-all duration-200 ${
                  isEffectUnavailable(effect)
                    ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed'
                    : 'bg-gray-900/50 border-gray-700 hover:border-indigo-500 hover:bg-gray-800 cursor-pointer'
                }`}
              >
                <div className="flex items-center gap-3">
                  {getIcon(effect)}
                  <div className="flex-grow">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-white">{effect.name}</p>
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">{getEffectCategory(effect)}</span>
                    </div>
                    <p className="text-sm text-gray-400">{effect.description}</p>
                  </div>
                </div>
              </div>
            ))}
            {filteredEffects.length === 0 && (
              <p className="text-xs text-center text-gray-500 mt-4">No matching effects found.</p>
            )}
            {disabled && <p className="text-xs text-center text-gray-500 mt-4">Select a clip for clip-based effects. Solid Color and Text Overlay can also create standalone clips.</p>}
          </>
        ) : (
          <>
            {filteredStacks.map((stack) => (
              <div
                key={stack.id}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-effect-stack-id', stack.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                className={`rounded-lg border p-3 ${disabled ? 'border-gray-700 bg-gray-800/40 opacity-70' : 'border-gray-700 bg-gray-900/50 hover:border-indigo-500/60'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{stack.name}</p>
                    <p className="mt-1 text-xs text-gray-400">{stack.description}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-gray-500">
                      {stack.category} · {stack.effects?.length || 1} FX · Base: {stack.baseEffect}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onApplyEffectStack(stack.id)}
                    className="rounded border border-indigo-500/40 bg-indigo-600/20 px-2 py-1 text-[10px] uppercase tracking-wide text-indigo-200 disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              </div>
            ))}
            {filteredStacks.length === 0 && <p className="text-xs text-center text-gray-500 mt-4">No matching stacks found.</p>}
            <p className="text-[10px] text-gray-500 mt-2">Tip: Drag an effect or stack directly onto a clip in the timeline.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default EffectsPanel;
