import React, { useMemo, useState } from 'react';
import { Effect, EffectStackPreset, EffectType } from '../types';
import { EFFECTS, EFFECT_STACK_PRESETS } from '../constants';
import { MagicWandIcon, PaintBucketIcon, TextIcon, KeyingIcon, SearchIcon, LayersIcon, SparklesIcon } from './icons';
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

type EffectCategory = 'looks' | 'stylize' | 'vfx' | 'tools' | 'ai';
type LibraryFilter = 'all' | EffectCategory;
type PresetFilter = 'all' | EffectStackPreset['category'];

const CATEGORY_LABEL: Record<EffectCategory, string> = {
  looks: 'Looks',
  stylize: 'Stylize',
  vfx: 'VFX',
  tools: 'Tools',
  ai: 'AI',
};

const CATEGORY_ORDER: EffectCategory[] = ['looks', 'stylize', 'vfx', 'tools', 'ai'];

const LIBRARY_FILTERS: Array<{ id: LibraryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'looks', label: 'Looks' },
  { id: 'stylize', label: 'Stylize' },
  { id: 'vfx', label: 'VFX' },
  { id: 'tools', label: 'Tools' },
  { id: 'ai', label: 'AI' },
];

const PRESET_FILTERS: Array<{ id: PresetFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'look', label: 'Looks' },
  { id: 'stylize', label: 'Stylize' },
  { id: 'vfx', label: 'VFX' },
];

const STYLIZE_IDS = new Set<EffectType>([EffectType.VAN_GOGH, EffectType.ANIME, EffectType.WATERCOLOR, EffectType.COMIC]);
const VFX_IDS = new Set<EffectType>([EffectType.FIRE_OVERLAY, EffectType.LIGHTNING_OVERLAY, EffectType.EXPLOSION_OVERLAY, EffectType.GLITCH_OVERLAY]);

const getEffectCategory = (effect: Effect): EffectCategory => {
  if (effect.type === 'ai') return 'ai';
  if (effect.type === 'native') return 'tools';
  if (STYLIZE_IDS.has(effect.id)) return 'stylize';
  if (VFX_IDS.has(effect.id)) return 'vfx';
  return 'looks';
};

/** Short display name: strips the "(Model)" suffix and generic verbs so tiles stay readable. */
const shortName = (name: string) =>
  name
    .replace(/\s*\((.*?)\)\s*$/, (_m, inner: string) => ` · ${inner}`)
    .replace(/ Stylize$/, '')
    .replace(/ Overlay$/, '');

/** Static overlay decoration for VFX/comic tiles so they read correctly without animation. */
const TileOverlay: React.FC<{ effect: EffectType }> = ({ effect }) => {
  switch (effect) {
    case EffectType.FIRE_OVERLAY:
      return <div className="fx-tile__overlay" style={{ background: 'linear-gradient(to top, rgba(255,72,0,0.8), rgba(255,163,55,0.4) 45%, transparent 75%)' }} />;
    case EffectType.LIGHTNING_OVERLAY:
      return (
        <>
          <div className="fx-tile__overlay" style={{ background: 'rgba(214,232,255,0.22)' }} />
          <div className="fx-tile__overlay" style={{ left: '46%', width: 2, background: 'rgba(255,255,255,0.9)', transform: 'skewX(-16deg)', boxShadow: '0 0 6px 1px rgba(200,225,255,0.9)' }} />
        </>
      );
    case EffectType.EXPLOSION_OVERLAY:
      return <div className="fx-tile__overlay" style={{ background: 'radial-gradient(circle at 50% 55%, rgba(255,244,190,0.95) 0%, rgba(255,152,70,0.6) 30%, rgba(255,78,0,0) 62%)' }} />;
    case EffectType.GLITCH_OVERLAY:
      return (
        <>
          <div className="fx-tile__overlay" style={{ top: '28%', height: 3, background: 'rgba(103,232,249,0.55)' }} />
          <div className="fx-tile__overlay" style={{ top: '61%', height: 3, background: 'rgba(240,171,252,0.5)' }} />
        </>
      );
    case EffectType.COMIC:
      return <div className="fx-tile__overlay" style={{ opacity: 0.25, backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.4), rgba(0,0,0,0.4) 1px, transparent 1px, transparent 4px)' }} />;
    default:
      return null;
  }
};

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
  const [panelView, setPanelView] = useState<'library' | 'presets'>('library');
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
  const [presetFilter, setPresetFilter] = useState<PresetFilter>('all');

  const isEffectUnavailable = (effect: Effect) =>
    disabled && (
      effect.type === 'css' ||
      (effect.type === 'native' && effect.id !== EffectType.NATIVE_SOLID_COLOR && effect.id !== EffectType.TEXT)
    );

  const handleEffectClick = (effect: Effect) => {
    if (isEffectUnavailable(effect)) return;
    if (effect.type === 'ai') {
      onApplyAIEffect(effect);
    } else if (effect.type === 'native') {
      if (effect.id === EffectType.NATIVE_SOLID_COLOR) {
        const color = window.prompt('Enter a color (e.g., #RRGGBB, color name):', '#2563eb');
        if (color) onApplyNativeEffect(effect, color);
      } else if (effect.id === EffectType.TEXT || effect.id === EffectType.CHROMA_KEY) {
        onApplyNativeEffect(effect, '');
      }
    } else {
      onApplyEffect(effect.id);
    }
  };

  const getIcon = (effect: Effect) => {
    const cls = 'fx-tile__icon';
    if (effect.type === 'ai') return <MagicWandIcon className={cls} />;
    if (effect.id === EffectType.TEXT) return <TextIcon className={cls} />;
    if (effect.id === EffectType.CHROMA_KEY) return <KeyingIcon className={cls} />;
    if (effect.id === EffectType.NATIVE_SOLID_COLOR) return <PaintBucketIcon className={cls} />;
    return null;
  };

  const term = search.trim().toLowerCase();

  const filteredEffects = useMemo(
    () =>
      EFFECTS.filter((effect) => {
        const category = getEffectCategory(effect);
        if (libraryFilter !== 'all' && category !== libraryFilter) return false;
        if (!term) return true;
        return (
          effect.name.toLowerCase().includes(term) ||
          effect.description.toLowerCase().includes(term) ||
          CATEGORY_LABEL[category].toLowerCase().includes(term)
        );
      }),
    [term, libraryFilter]
  );

  const groupedEffects = useMemo(() => {
    const groups = new Map<EffectCategory, Effect[]>();
    for (const effect of filteredEffects) {
      const category = getEffectCategory(effect);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(effect);
    }
    return CATEGORY_ORDER.filter((c) => groups.has(c)).map((c) => ({ category: c, effects: groups.get(c)! }));
  }, [filteredEffects]);

  const filteredStacks = useMemo(
    () =>
      EFFECT_STACK_PRESETS.filter((stack) => {
        if (presetFilter !== 'all' && stack.category !== presetFilter) return false;
        if (!term) return true;
        return (
          stack.name.toLowerCase().includes(term) ||
          stack.description.toLowerCase().includes(term) ||
          stack.baseEffect.toLowerCase().includes(term) ||
          (stack.effects || []).some((entry) => entry.effect.toLowerCase().includes(term))
        );
      }),
    [term, presetFilter]
  );

  const renderThumb = (effectId: EffectType, extraFilter?: string) => {
    const filter = extraFilter ?? (buildStyleFilterForEffect(effectId, 1) || 'none');
    return (
      <div className="fx-tile__thumb">
        {previewFrameUrl ? (
          <img src={previewFrameUrl} alt="" draggable={false} style={{ filter }} />
        ) : (
          <div className="fx-tile__placeholder" style={{ filter }} />
        )}
        <TileOverlay effect={effectId} />
      </div>
    );
  };

  const renderEffectTile = (effect: Effect) => {
    const unavailable = isEffectUnavailable(effect);
    const isFilter = effect.type === 'css';
    const icon = getIcon(effect);
    return (
      <button
        key={effect.id}
        type="button"
        title={`${effect.name}\n${effect.description}`}
        aria-label={effect.name}
        disabled={unavailable}
        onClick={() => handleEffectClick(effect)}
        draggable={isFilter && !unavailable}
        onDragStart={(event) => {
          if (!isFilter) return;
          event.dataTransfer.setData('application/x-effect-id', effect.id);
          event.dataTransfer.effectAllowed = 'copy';
        }}
        className={`fx-tile ${unavailable ? 'fx-tile--disabled' : ''}`}
      >
        {isFilter ? (
          renderThumb(effect.id)
        ) : (
          <div className={`fx-tile__thumb fx-tile__thumb--${effect.type}`}>{icon}</div>
        )}
        <span className="fx-tile__name">{shortName(effect.name)}</span>
      </button>
    );
  };

  const renderPresetTile = (stack: EffectStackPreset) => {
    const layerCount = stack.effects?.length || 1;
    // Compose the preset's layer filters so the thumb shows the whole stack, not just the base.
    const composed = (stack.effects && stack.effects.length > 0 ? stack.effects : [{ effect: stack.baseEffect, intensity: 100 }])
      .map((layer) => buildStyleFilterForEffect(layer.effect, (layer.intensity ?? 100) / 100))
      .filter(Boolean)
      .join(' ');
    return (
      <button
        key={stack.id}
        type="button"
        title={`${stack.name}\n${stack.description}`}
        aria-label={stack.name}
        disabled={disabled}
        onClick={() => onApplyEffectStack(stack.id)}
        draggable={!disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-effect-stack-id', stack.id);
          event.dataTransfer.effectAllowed = 'copy';
        }}
        className={`fx-tile ${disabled ? 'fx-tile--disabled' : ''}`}
      >
        {renderThumb(stack.baseEffect, composed || 'none')}
        <span className="fx-tile__badge">
          <LayersIcon className="w-3 h-3" />
          {layerCount}
        </span>
        <span className="fx-tile__name">{stack.name}</span>
      </button>
    );
  };

  const filters = panelView === 'library' ? LIBRARY_FILTERS : PRESET_FILTERS;
  const activeFilter = panelView === 'library' ? libraryFilter : presetFilter;
  const setFilter = (id: string) => {
    if (panelView === 'library') setLibraryFilter(id as LibraryFilter);
    else setPresetFilter(id as PresetFilter);
  };

  const isEmpty = panelView === 'library' ? filteredEffects.length === 0 : filteredStacks.length === 0;

  return (
    <div className="fx-browser">
      <div className="fx-browser__header">
        <h3 className="fx-browser__title">Effects</h3>
        <div className="edit-seg" role="tablist" aria-label="Effects view">
          <button
            type="button"
            role="tab"
            aria-selected={panelView === 'library'}
            className={`edit-seg__item ${panelView === 'library' ? 'edit-seg__item--active' : ''}`}
            onClick={() => setPanelView('library')}
          >
            Library
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panelView === 'presets'}
            className={`edit-seg__item ${panelView === 'presets' ? 'edit-seg__item--active' : ''}`}
            onClick={() => setPanelView('presets')}
          >
            <SparklesIcon className="w-3 h-3" />
            Presets
          </button>
        </div>
      </div>

      <label className="fx-search">
        <SearchIcon className="fx-search__icon" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={panelView === 'library' ? 'Search effects' : 'Search presets'}
          aria-label={panelView === 'library' ? 'Search effects' : 'Search presets'}
        />
      </label>

      <div className="fx-filters" role="tablist" aria-label="Category">
        {filters.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={activeFilter === entry.id}
            onClick={() => setFilter(entry.id)}
            className={`fx-filters__item ${activeFilter === entry.id ? 'fx-filters__item--active' : ''}`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="fx-browser__scroll">
        {panelView === 'library' ? (
          libraryFilter === 'all' && !term ? (
            groupedEffects.map((group) => (
              <section key={group.category} className="fx-section">
                <header className="fx-section__title">{CATEGORY_LABEL[group.category]}</header>
                <div className="fx-grid">{group.effects.map(renderEffectTile)}</div>
              </section>
            ))
          ) : (
            <div className="fx-grid">{filteredEffects.map(renderEffectTile)}</div>
          )
        ) : (
          <div className="fx-grid">{filteredStacks.map(renderPresetTile)}</div>
        )}

        {isEmpty && <p className="fx-empty">No results for “{search.trim()}”</p>}
      </div>

      <footer className="fx-browser__footer">
        {disabled ? (
          <span>Select a clip to apply effects. Solid Color and Text can be added without a selection.</span>
        ) : (
          <span>Click to apply · drag onto a clip{previewFrameUrl && previewSourceLabel ? ` · previewing ${previewSourceLabel}` : ''}</span>
        )}
      </footer>
    </div>
  );
};

export default EffectsPanel;
