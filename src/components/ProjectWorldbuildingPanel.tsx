import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  WorldbuildingEnvironment,
  WorldbuildingFaction,
  WorldbuildingGlossaryEntry,
  WorldbuildingMapRegion,
  WorldbuildingMapRegionKind,
  WorldbuildingState,
} from '../types';
import {
  createDefaultWorldbuildingState,
  createWorldbuildingEnvironment,
  createWorldbuildingFaction,
  createWorldbuildingGlossaryEntry,
  createWorldbuildingRegion,
  WORLD_ENVIRONMENT_CONTAINER_OPTIONS,
  WORLD_REGION_KIND_OPTIONS,
} from '../data/worldbuildingTypes';
import {
  WORLD_ENVIRONMENT_PRESETS,
  WORLD_ERA_SUGGESTIONS,
  WORLD_FACTION_PRESETS,
  WORLD_GENRE_SUGGESTIONS,
  WORLD_GLOSSARY_PACKS,
  WORLD_MAGIC_SUGGESTIONS,
  WORLD_REGION_PRESETS,
  WORLD_TECH_SUGGESTIONS,
  WORLD_TEMPLATES,
  WORLD_TONE_SUGGESTIONS,
  buildWorldFromTemplate,
  environmentFromPreset,
  factionFromPreset,
  glossaryFromPack,
  isWorldEmpty,
  regionFromPreset,
  type WorldTemplate,
} from '../data/worldbuildingPresets';
import { STYLE_PRESETS } from '../data/styleData';
import {
  AddIcon,
  BoxIcon,
  BrainIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LandscapeIcon,
  ListIcon,
  MapIcon,
  PaletteIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
  UserCircleIcon,
  XIcon,
} from './icons';

type ProjectWorldbuildingPanelProps = {
  value?: WorldbuildingState;
  onChange: (next: WorldbuildingState) => void;
  onBack: () => void;
  backLabel: string;
  onNext: () => void;
  nextLabel: string;
  onOpenConcept: () => void;
  conceptLabel: string;
  scriptReady: boolean;
  conceptCount: number;
};

type SectionId = 'overview' | 'map' | 'factions' | 'places' | 'lore' | 'look';
type SheetId = 'templates' | 'regions' | 'factions' | 'places' | 'lore' | null;

const SECTION_KEY = 'project_world_section_v1';
const MAX_LOOK_STYLES = 4;

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.FC<{ className?: string }> }> = [
  { id: 'overview', label: 'Universe', icon: BrainIcon },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'factions', label: 'Factions', icon: UserCircleIcon },
  { id: 'places', label: 'Places', icon: BoxIcon },
  { id: 'lore', label: 'Lore', icon: ListIcon },
  { id: 'look', label: 'Look', icon: PaletteIcon },
];

const clampPercent = (value: number) => Math.max(4, Math.min(96, Math.round(value)));

const kindLabel = (kind: WorldbuildingMapRegionKind) =>
  WORLD_REGION_KIND_OPTIONS.find((option) => option.value === kind)?.label || kind;

const containerLabel = (type: WorldbuildingEnvironment['containerType']) =>
  WORLD_ENVIRONMENT_CONTAINER_OPTIONS.find((option) => option.value === type)?.label || type;

const toggleListValue = (current: string, chip: string) => {
  const parts = current.split(',').map((part) => part.trim()).filter(Boolean);
  const exists = parts.some((part) => part.toLowerCase() === chip.toLowerCase());
  const next = exists ? parts.filter((part) => part.toLowerCase() !== chip.toLowerCase()) : [...parts, chip];
  return next.join(', ');
};

const hasChip = (current: string, chip: string) =>
  current.split(',').map((part) => part.trim().toLowerCase()).includes(chip.toLowerCase());

/* ─── Small building blocks ─── */

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; className?: string }> = ({ label, hint, children, className }) => (
  <label className={`wb-field ${className || ''}`}>
    <span className="wb-field__label">
      {label}
      {hint && <small>{hint}</small>}
    </span>
    {children}
  </label>
);

const Chips: React.FC<{ items: string[]; value: string; onToggle: (chip: string) => void; limit?: number }> = ({ items, value, onToggle, limit = 8 }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);
  return (
    <div className="wb-chips">
      {visible.map((chip) => (
        <button key={chip} type="button" className={`wb-chip ${hasChip(value, chip) ? 'wb-chip--on' : ''}`} onClick={() => onToggle(chip)}>
          {chip}
        </button>
      ))}
      {items.length > limit && (
        <button type="button" className="wb-chip wb-chip--more" onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? 'Less' : `+${items.length - limit} more`}
        </button>
      )}
    </div>
  );
};

type ListRow = { id: string; name: string; meta?: string; color?: string };

const MasterList: React.FC<{
  title: string;
  rows: ListRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onBrowse: () => void;
  addLabel?: string;
  emptyHint: string;
  addMenu?: React.ReactNode;
}> = ({ title, rows, selectedId, onSelect, onAdd, onBrowse, addLabel = 'New', emptyHint, addMenu }) => (
  <aside className="wb-list">
    <div className="wb-list__head">
      <span className="wb-list__title">{title} <small>{rows.length}</small></span>
      <div className="wb-list__actions">
        {addMenu || (
          <button type="button" className="wb-icon-btn" onClick={onAdd} title={`${addLabel} ${title.toLowerCase().replace(/s$/, '')}`}>
            <AddIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
    <div className="wb-list__rows">
      {rows.length === 0 && <p className="wb-list__empty">{emptyHint}</p>}
      {rows.map((row) => (
        <button key={row.id} type="button" className={`wb-row ${row.id === selectedId ? 'wb-row--active' : ''}`} onClick={() => onSelect(row.id)}>
          <span className="wb-row__dot" style={{ background: row.color || 'var(--app-accent)' }} />
          <span className="wb-row__text">
            <span className="wb-row__name">{row.name || 'Untitled'}</span>
            {row.meta && <span className="wb-row__meta">{row.meta}</span>}
          </span>
        </button>
      ))}
    </div>
    <button type="button" className="wb-list__browse" onClick={onBrowse}>
      <SparklesIcon className="w-3.5 h-3.5" />
      Browse presets
    </button>
  </aside>
);

const DetailHeader: React.FC<{ name: string; placeholder: string; onName: (value: string) => void; onDelete: () => void; badge?: string; color?: string; onColor?: (value: string) => void }> = ({ name, placeholder, onName, onDelete, badge, color, onColor }) => (
  <div className="wb-detail__head">
    {onColor && (
      <label className="wb-swatch" title="Colour" style={{ background: color || 'var(--app-accent)' }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(color || '') ? color : '#7c8cff'} onChange={(event) => onColor(event.target.value)} />
      </label>
    )}
    <input className="wb-detail__name" value={name} onChange={(event) => onName(event.target.value)} placeholder={placeholder} />
    {badge && <span className="wb-badge">{badge}</span>}
    <button type="button" className="wb-icon-btn wb-icon-btn--danger" onClick={onDelete} title="Delete">
      <TrashIcon className="w-4 h-4" />
    </button>
  </div>
);

const EmptyDetail: React.FC<{ title: string; hint: string; action?: React.ReactNode }> = ({ title, hint, action }) => (
  <div className="wb-detail wb-detail--empty">
    <p className="wb-detail__empty-title">{title}</p>
    <p className="wb-detail__empty-hint">{hint}</p>
    {action}
  </div>
);

type SheetItem = { id: string; name: string; subtitle: string; meta?: string; color?: string; gradient?: string; tags?: string[] };

const PresetSheet: React.FC<{
  title: string;
  description: string;
  items: SheetItem[];
  onPick: (id: string) => void;
  onClose: () => void;
  pickLabel?: string;
  large?: boolean;
}> = ({ title, description, items, onPick, onClose, pickLabel = 'Add', large = false }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? items.filter((item) => [item.name, item.subtitle, item.meta, ...(item.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(normalized))
    : items;
  return (
    <div className="wb-overlay" onClick={onClose}>
      <div className="wb-sheet-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-label={title}>
        <div className="wb-sheet-modal__head">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <button type="button" className="wb-icon-btn" onClick={onClose} title="Close (Esc)"><XIcon className="w-4 h-4" /></button>
        </div>
        <div className="wb-search">
          <SearchIcon className="w-4 h-4" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search presets" />
        </div>
        <div className={`wb-preset-grid ${large ? 'wb-preset-grid--large' : ''}`}>
          {filtered.length === 0 && <p className="wb-list__empty">Nothing matches that search.</p>}
          {filtered.map((item) => (
            <button key={item.id} type="button" className="wb-preset" onClick={() => onPick(item.id)}>
              {item.gradient ? (
                <span className="wb-preset__art" style={{ background: item.gradient }} />
              ) : (
                <span className="wb-preset__dot" style={{ background: item.color || 'var(--app-accent)' }} />
              )}
              <span className="wb-preset__text">
                <span className="wb-preset__name">{item.name}</span>
                <span className="wb-preset__sub">{item.subtitle}</span>
                {item.meta && <span className="wb-preset__meta">{item.meta}</span>}
              </span>
              <span className="wb-preset__cta">{pickLabel}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const TemplateCard: React.FC<{ template: WorldTemplate; onPick: () => void; active?: boolean }> = ({ template, onPick, active }) => (
  <button type="button" className={`wb-template ${active ? 'wb-template--active' : ''}`} onClick={onPick}>
    <span className="wb-template__art" style={{ background: template.gradient }} />
    <span className="wb-template__body">
      <span className="wb-template__name">{template.name}</span>
      <span className="wb-template__tag">{template.tagline}</span>
      <span className="wb-template__meta">{template.regions.length} regions · {template.factions.length} factions · {template.environments.length} places</span>
    </span>
  </button>
);

/* ─── Main panel ─── */

export const ProjectWorldbuildingPanel: React.FC<ProjectWorldbuildingPanelProps> = ({
  value,
  onChange,
  onBack,
  backLabel,
  onNext,
  nextLabel,
  onOpenConcept,
  conceptLabel,
  scriptReady,
  conceptCount,
}) => {
  const world = useMemo(() => value ?? createDefaultWorldbuildingState(), [value]);
  const [section, setSectionState] = useState<SectionId>(() => {
    if (typeof window === 'undefined') return 'overview';
    const saved = window.localStorage?.getItem(SECTION_KEY) as SectionId | null;
    return saved && SECTIONS.some((entry) => entry.id === saved) ? saved : 'overview';
  });
  const setSection = (id: SectionId) => {
    setSectionState(id);
    try { window.localStorage?.setItem(SECTION_KEY, id); } catch { /* ignore */ }
  };
  const [sheet, setSheet] = useState<SheetId>(null);
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [selectedFactionId, setSelectedFactionId] = useState('');
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('');
  const [draggingRegionId, setDraggingRegionId] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedRegionId && world.mapRegions.some((item) => item.id === selectedRegionId)) return;
    setSelectedRegionId(world.mapRegions[0]?.id || '');
  }, [selectedRegionId, world.mapRegions]);
  useEffect(() => {
    if (selectedFactionId && world.factions.some((item) => item.id === selectedFactionId)) return;
    setSelectedFactionId(world.factions[0]?.id || '');
  }, [selectedFactionId, world.factions]);
  useEffect(() => {
    if (selectedEnvironmentId && world.environments.some((item) => item.id === selectedEnvironmentId)) return;
    setSelectedEnvironmentId(world.environments[0]?.id || '');
  }, [selectedEnvironmentId, world.environments]);

  const updateWorld = (updates: Partial<WorldbuildingState>) => onChange({ ...world, ...updates });
  const updateRegion = (id: string, updates: Partial<WorldbuildingMapRegion>) =>
    updateWorld({ mapRegions: world.mapRegions.map((item) => (item.id === id ? { ...item, ...updates } : item)) });
  const updateFaction = (id: string, updates: Partial<WorldbuildingFaction>) =>
    updateWorld({ factions: world.factions.map((item) => (item.id === id ? { ...item, ...updates } : item)) });
  const updateEnvironment = (id: string, updates: Partial<WorldbuildingEnvironment>) =>
    updateWorld({ environments: world.environments.map((item) => (item.id === id ? { ...item, ...updates } : item)) });
  const updateGlossary = (id: string, updates: Partial<WorldbuildingGlossaryEntry>) =>
    updateWorld({ glossary: world.glossary.map((item) => (item.id === id ? { ...item, ...updates } : item)) });

  const selectedRegion = world.mapRegions.find((item) => item.id === selectedRegionId) || null;
  const selectedFaction = world.factions.find((item) => item.id === selectedFactionId) || null;
  const selectedEnvironment = world.environments.find((item) => item.id === selectedEnvironmentId) || null;
  const regionName = (id?: string) => world.mapRegions.find((item) => item.id === id)?.name || '';
  const activeTemplate = WORLD_TEMPLATES.find((template) => template.id === world.templateId) || null;
  const lookStyles = STYLE_PRESETS.filter((style) => (world.lookStyleIds || []).includes(style.id));
  const worldEmpty = isWorldEmpty(world);

  const readiness = [
    { id: 'overview' as SectionId, label: 'Universe core', detail: world.universeName || world.coreConflict ? (world.universeName || 'Conflict defined') : 'Name the world or its conflict', ready: Boolean(world.universeName.trim() || world.coreConflict.trim()) },
    { id: 'map' as SectionId, label: 'Map regions', detail: world.mapRegions.length ? `${world.mapRegions.length} placed` : 'Add at least one region', ready: world.mapRegions.length > 0 },
    { id: 'factions' as SectionId, label: 'Factions', detail: world.factions.length ? `${world.factions.length} defined` : 'Who wants what', ready: world.factions.length > 0 },
    { id: 'places' as SectionId, label: 'Places', detail: world.environments.length ? `${world.environments.length} ready` : 'Reusable locations for scenes', ready: world.environments.length > 0 },
  ];
  const readyCount = readiness.filter((item) => item.ready).length;

  /* ── add / remove ── */
  const addRegion = (kind?: WorldbuildingMapRegionKind) => {
    const next = createWorldbuildingRegion();
    if (kind) { next.kind = kind; next.name = `New ${kindLabel(kind)}`; }
    next.x = clampPercent(20 + Math.random() * 60);
    next.y = clampPercent(20 + Math.random() * 60);
    updateWorld({ mapRegions: [...world.mapRegions, next] });
    setSelectedRegionId(next.id);
  };
  const removeRegion = (region: WorldbuildingMapRegion) => {
    if (!window.confirm(`Delete "${region.name}"?`)) return;
    updateWorld({
      mapRegions: world.mapRegions.filter((item) => item.id !== region.id),
      factions: world.factions.map((item) => ({ ...item, baseRegionId: item.baseRegionId === region.id ? '' : item.baseRegionId })),
      environments: world.environments.map((item) => ({ ...item, linkedRegionId: item.linkedRegionId === region.id ? '' : item.linkedRegionId })),
    });
  };
  const addFaction = () => {
    const next = createWorldbuildingFaction();
    updateWorld({ factions: [...world.factions, next] });
    setSelectedFactionId(next.id);
  };
  const removeFaction = (faction: WorldbuildingFaction) => {
    if (!window.confirm(`Delete "${faction.name}"?`)) return;
    updateWorld({
      factions: world.factions.filter((item) => item.id !== faction.id),
      mapRegions: world.mapRegions.map((item) => ({ ...item, factionIds: item.factionIds.filter((id) => id !== faction.id) })),
    });
  };
  const addEnvironment = () => {
    const next = createWorldbuildingEnvironment();
    updateWorld({ environments: [...world.environments, next] });
    setSelectedEnvironmentId(next.id);
  };
  const removeEnvironment = (environment: WorldbuildingEnvironment) => {
    if (!window.confirm(`Delete "${environment.name}"?`)) return;
    updateWorld({ environments: world.environments.filter((item) => item.id !== environment.id) });
  };
  const addGlossary = () => {
    const next = createWorldbuildingGlossaryEntry();
    next.term = '';
    updateWorld({ glossary: [...world.glossary, next] });
  };

  const applyTemplate = (template: WorldTemplate) => {
    if (!worldEmpty && !window.confirm(`Replace the current world with "${template.name}"? Existing regions, factions and places will be removed.`)) return;
    onChange(buildWorldFromTemplate(template));
    setSheet(null);
    setSection('overview');
  };
  const clearWorld = () => {
    if (!window.confirm('Clear the whole world? This removes every region, faction, place and term.')) return;
    onChange(createDefaultWorldbuildingState());
  };

  const pickPreset = (id: string) => {
    if (sheet === 'regions') {
      const preset = WORLD_REGION_PRESETS.find((item) => item.id === id);
      if (preset) { const next = regionFromPreset(preset); updateWorld({ mapRegions: [...world.mapRegions, next] }); setSelectedRegionId(next.id); }
    } else if (sheet === 'factions') {
      const preset = WORLD_FACTION_PRESETS.find((item) => item.id === id);
      if (preset) { const next = factionFromPreset(preset); updateWorld({ factions: [...world.factions, next] }); setSelectedFactionId(next.id); }
    } else if (sheet === 'places') {
      const preset = WORLD_ENVIRONMENT_PRESETS.find((item) => item.id === id);
      if (preset) { const next = environmentFromPreset(preset); updateWorld({ environments: [...world.environments, next] }); setSelectedEnvironmentId(next.id); }
    } else if (sheet === 'lore') {
      const pack = WORLD_GLOSSARY_PACKS.find((item) => item.id === id);
      if (pack) {
        const existing = new Set(world.glossary.map((entry) => entry.term.toLowerCase()));
        const fresh = glossaryFromPack(pack).filter((entry) => !existing.has(entry.term.toLowerCase()));
        updateWorld({ glossary: [...world.glossary, ...fresh] });
      }
    } else if (sheet === 'templates') {
      const template = WORLD_TEMPLATES.find((item) => item.id === id);
      if (template) applyTemplate(template);
      return;
    }
    setSheet(null);
  };

  const toggleLookStyle = (id: string) => {
    const current = world.lookStyleIds || [];
    if (current.includes(id)) { updateWorld({ lookStyleIds: current.filter((entry) => entry !== id) }); return; }
    if (current.length >= MAX_LOOK_STYLES) return;
    updateWorld({ lookStyleIds: [...current, id] });
  };

  /* ── map interaction ── */
  const positionFromPointer = (event: React.PointerEvent | React.MouseEvent) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return { x: clampPercent(((event.clientX - rect.left) / rect.width) * 100), y: clampPercent(((event.clientY - rect.top) / rect.height) * 100) };
  };
  const handleMapPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRegionId) return;
    const position = positionFromPointer(event);
    if (position) updateRegion(draggingRegionId, position);
  };
  const handleMapDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const position = positionFromPointer(event);
    if (!position) return;
    const next = createWorldbuildingRegion();
    next.x = position.x; next.y = position.y;
    updateWorld({ mapRegions: [...world.mapRegions, next] });
    setSelectedRegionId(next.id);
  };

  const sheetItems: SheetItem[] = sheet === 'templates'
    ? WORLD_TEMPLATES.map((template) => ({ id: template.id, name: template.name, subtitle: template.tagline, meta: `${template.regions.length} regions · ${template.factions.length} factions · ${template.environments.length} places`, gradient: template.gradient, tags: [template.core.genre, template.core.tone] }))
    : sheet === 'regions'
      ? WORLD_REGION_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, subtitle: preset.summary, meta: `${kindLabel(preset.kind)} · ${preset.climate}`, color: preset.color, tags: preset.tags }))
      : sheet === 'factions'
        ? WORLD_FACTION_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, subtitle: preset.agenda, meta: `${preset.archetype} · ${preset.influence}`, color: preset.color, tags: preset.tags }))
        : sheet === 'places'
          ? WORLD_ENVIRONMENT_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, subtitle: preset.description, meta: `${containerLabel(preset.containerType)} · ${preset.mood}`, tags: preset.tags }))
          : sheet === 'lore'
            ? WORLD_GLOSSARY_PACKS.map((pack) => ({ id: pack.id, name: pack.name, subtitle: pack.description, meta: `${pack.entries.length} terms · ${pack.entries.map((entry) => entry.term).join(', ')}` }))
            : [];
  const sheetMeta: Record<Exclude<SheetId, null>, { title: string; description: string; pickLabel: string }> = {
    templates: { title: 'World templates', description: 'Start from a complete universe with regions, factions, places and lore. You can change everything afterwards.', pickLabel: 'Use' },
    regions: { title: 'Region presets', description: 'Drop a ready-made region onto the map, then rename and move it.', pickLabel: 'Add' },
    factions: { title: 'Faction archetypes', description: 'Power blocks with an agenda and a belief. Rename them to fit your story.', pickLabel: 'Add' },
    places: { title: 'Place presets', description: 'Reusable locations for scenes and set design.', pickLabel: 'Add' },
    lore: { title: 'Lore starter packs', description: 'Add a handful of terms at once. Terms you already have are skipped.', pickLabel: 'Add pack' },
  };

  const regionAddMenu = (
    <details className="wb-menu">
      <summary className="wb-icon-btn" title="Add region"><AddIcon className="w-4 h-4" /></summary>
      <div className="wb-menu__panel">
        {WORLD_REGION_KIND_OPTIONS.map((option) => (
          <button key={option.value} type="button" className="wb-menu__item" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); addRegion(option.value); }}>
            {option.label}
          </button>
        ))}
        <div className="wb-menu__sep" />
        <button type="button" className="wb-menu__item" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); setSheet('regions'); }}>
          From preset…
        </button>
      </div>
    </details>
  );

  /* ── sections ── */

  const renderOverview = () => (
    <>
      {worldEmpty && (
        <section className="wb-hero">
          <div className="wb-hero__text">
            <h3>Start with a world</h3>
            <p>Pick a template to get a universe, a map, factions, places and lore in one step, or begin with a blank universe below. Everything stays editable.</p>
          </div>
          <div className="wb-template-grid">
            {WORLD_TEMPLATES.map((template) => (
              <TemplateCard key={template.id} template={template} onPick={() => applyTemplate(template)} />
            ))}
          </div>
        </section>
      )}
      <div className="wb-grid wb-grid--overview">
        <section className="wb-sheet">
          <div className="wb-sheet__head">
            <h3>Universe</h3>
            <p>The facts every other page refers to.</p>
          </div>
          <Field label="Name">
            <input className="wb-input wb-input--large" value={world.universeName} onChange={(event) => updateWorld({ universeName: event.target.value })} placeholder="Name your world" />
          </Field>
          <div className="wb-two">
            <Field label="Genre">
              <input className="wb-input" value={world.genre} onChange={(event) => updateWorld({ genre: event.target.value })} placeholder="Dark fantasy, mythic adventure" />
              <Chips items={WORLD_GENRE_SUGGESTIONS} value={world.genre} onToggle={(chip) => updateWorld({ genre: toggleListValue(world.genre, chip) })} />
            </Field>
            <Field label="Tone">
              <input className="wb-input" value={world.tone} onChange={(event) => updateWorld({ tone: event.target.value })} placeholder="Melancholic, epic, dangerous" />
              <Chips items={WORLD_TONE_SUGGESTIONS} value={world.tone} onToggle={(chip) => updateWorld({ tone: toggleListValue(world.tone, chip) })} />
            </Field>
          </div>
          <div className="wb-two">
            <Field label="Era">
              <input className="wb-input" value={world.era} onChange={(event) => updateWorld({ era: event.target.value })} placeholder="Fifth age after the eclipse war" />
              <Chips items={WORLD_ERA_SUGGESTIONS} value={world.era} onToggle={(chip) => updateWorld({ era: toggleListValue(world.era, chip) })} limit={6} />
            </Field>
            <Field label="Technology">
              <input className="wb-input" value={world.technologyLevel} onChange={(event) => updateWorld({ technologyLevel: event.target.value })} placeholder="Pre-industrial, arcane machinery…" />
              <Chips items={WORLD_TECH_SUGGESTIONS} value={world.technologyLevel} onToggle={(chip) => updateWorld({ technologyLevel: toggleListValue(world.technologyLevel, chip) })} limit={6} />
            </Field>
          </div>
          <Field label="Core conflict" hint="The power struggle or threat the story turns on">
            <textarea className="wb-textarea" value={world.coreConflict} onChange={(event) => updateWorld({ coreConflict: event.target.value })} placeholder="What is the major power struggle or existential threat?" />
          </Field>
          <details className="wb-more" open={Boolean(world.magicSystem || world.rules || world.history)}>
            <summary>World rules, magic and history</summary>
            <div className="wb-more__body">
              <Field label="Magic or power logic" hint="Costs, limits, taboos">
                <textarea className="wb-textarea wb-textarea--short" value={world.magicSystem} onChange={(event) => updateWorld({ magicSystem: event.target.value })} placeholder="Costs, limits, rituals, forbidden usage…" />
                <Chips items={WORLD_MAGIC_SUGGESTIONS} value={world.magicSystem} onToggle={(chip) => updateWorld({ magicSystem: toggleListValue(world.magicSystem, chip) })} limit={5} />
              </Field>
              <div className="wb-two">
                <Field label="Rules of the world">
                  <textarea className="wb-textarea wb-textarea--short" value={world.rules} onChange={(event) => updateWorld({ rules: event.target.value })} placeholder="Social rules, taboos, travel limits…" />
                </Field>
                <Field label="History snapshot">
                  <textarea className="wb-textarea wb-textarea--short" value={world.history} onChange={(event) => updateWorld({ history: event.target.value })} placeholder="Key wars, cataclysms, dynasties…" />
                </Field>
              </div>
            </div>
          </details>
        </section>

        <aside className="wb-stack">
          <section className="wb-sheet wb-sheet--tight">
            <div className="wb-sheet__head wb-sheet__head--row">
              <h3>Readiness</h3>
              <span className={`wb-pill ${readyCount === readiness.length ? 'wb-pill--ready' : ''}`}>{readyCount} of {readiness.length}</span>
            </div>
            <ul className="wb-checklist">
              {readiness.map((item) => (
                <li key={item.id}>
                  <button type="button" className={`wb-check ${item.ready ? 'wb-check--done' : ''}`} onClick={() => setSection(item.id)}>
                    <CheckCircleIcon className="w-4 h-4" />
                    <span className="wb-check__text">
                      <span className="wb-check__label">{item.label}</span>
                      <span className="wb-check__detail">{item.detail}</span>
                    </span>
                    <ChevronRightIcon className="w-3.5 h-3.5 wb-check__arrow" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="wb-note">{scriptReady ? 'Script context is available for the concept phase.' : 'No script yet. The world still works on its own; add a script later for grounded prompts.'}</p>
          </section>

          <section className="wb-sheet wb-sheet--tight">
            <div className="wb-sheet__head wb-sheet__head--row">
              <h3>Template</h3>
              {activeTemplate && <span className="wb-badge">{activeTemplate.name}</span>}
            </div>
            <p className="wb-note">{activeTemplate ? 'Seeded from a template. Everything above has been yours to change since.' : 'Not using a template. You can still pull one in and keep editing.'}</p>
            <div className="wb-actions">
              <button type="button" className="wb-btn" onClick={() => setSheet('templates')}><SparklesIcon className="w-4 h-4" />Browse templates</button>
              {!worldEmpty && <button type="button" className="wb-btn wb-btn--quiet" onClick={clearWorld}>Clear world</button>}
            </div>
          </section>

          <section className="wb-sheet wb-sheet--tight">
            <div className="wb-sheet__head"><h3>At a glance</h3></div>
            <dl className="wb-stats">
              <div><dt>Regions</dt><dd>{world.mapRegions.length}</dd></div>
              <div><dt>Factions</dt><dd>{world.factions.length}</dd></div>
              <div><dt>Places</dt><dd>{world.environments.length}</dd></div>
              <div><dt>Terms</dt><dd>{world.glossary.length}</dd></div>
              <div><dt>Look refs</dt><dd>{lookStyles.length}</dd></div>
              <div><dt>Concept refs</dt><dd>{conceptCount}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );

  const renderMap = () => (
    <div className="wb-grid wb-grid--map">
      <MasterList
        title="Regions"
        rows={world.mapRegions.map((region) => ({ id: region.id, name: region.name, meta: kindLabel(region.kind), color: region.color }))}
        selectedId={selectedRegionId}
        onSelect={setSelectedRegionId}
        onAdd={() => addRegion()}
        onBrowse={() => setSheet('regions')}
        emptyHint="No regions yet. Add one, double-click the map, or browse presets."
        addMenu={regionAddMenu}
      />
      <div className="wb-map-column">
        <div
          ref={mapRef}
          className={`wb-map ${draggingRegionId ? 'wb-map--dragging' : ''}`}
          onPointerMove={handleMapPointerMove}
          onPointerUp={() => setDraggingRegionId(null)}
          onPointerLeave={() => setDraggingRegionId(null)}
          onDoubleClick={handleMapDoubleClick}
          onClick={(event) => { if (event.target === event.currentTarget) setSelectedRegionId(''); }}
        >
          {world.mapRegions.length === 0 && (
            <div className="wb-map__empty">
              <strong>An empty map</strong>
              <span>Double-click anywhere to place a region, or add one from the list.</span>
            </div>
          )}
          {world.mapRegions.map((region) => {
            const active = region.id === selectedRegionId;
            const owners = world.factions.filter((faction) => region.factionIds.includes(faction.id));
            return (
              <button
                key={region.id}
                type="button"
                className={`wb-marker wb-marker--${region.kind} ${active ? 'wb-marker--active' : ''}`}
                style={{ left: `${region.x}%`, top: `${region.y}%`, ['--marker-color' as string]: region.color || '#a78bfa' }}
                onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); setSelectedRegionId(region.id); setDraggingRegionId(region.id); }}
                onPointerUp={(event) => { event.currentTarget.releasePointerCapture?.(event.pointerId); setDraggingRegionId(null); }}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                title={`${region.name} · ${kindLabel(region.kind)}${owners.length ? ` · ${owners.map((faction) => faction.name).join(', ')}` : ''}`}
              >
                <span className="wb-marker__dot" />
                <span className="wb-marker__label">{region.name || 'Untitled'}</span>
                {owners.length > 0 && (
                  <span className="wb-marker__owners">
                    {owners.slice(0, 3).map((faction) => <i key={faction.id} style={{ background: faction.color }} />)}
                  </span>
                )}
              </button>
            );
          })}
          <div className="wb-map__hint">Drag markers to place them · double-click to add</div>
        </div>
        <details className="wb-more" open={Boolean(world.mapLegend)}>
          <summary>Map legend and travel rules</summary>
          <div className="wb-more__body">
            <textarea className="wb-textarea wb-textarea--short" value={world.mapLegend} onChange={(event) => updateWorld({ mapLegend: event.target.value })} placeholder="Roads, forbidden zones, portal routes, borders…" />
          </div>
        </details>
      </div>
      {selectedRegion ? (
        <div className="wb-detail">
          <DetailHeader name={selectedRegion.name} placeholder="Region name" onName={(name) => updateRegion(selectedRegion.id, { name })} onDelete={() => removeRegion(selectedRegion)} color={selectedRegion.color} onColor={(color) => updateRegion(selectedRegion.id, { color })} />
          <div className="wb-two">
            <Field label="Kind">
              <select className="wb-select" value={selectedRegion.kind} onChange={(event) => updateRegion(selectedRegion.id, { kind: event.target.value as WorldbuildingMapRegionKind })}>
                {WORLD_REGION_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Climate">
              <input className="wb-input" value={selectedRegion.climate} onChange={(event) => updateRegion(selectedRegion.id, { climate: event.target.value })} placeholder="Temperate, arid…" />
            </Field>
          </div>
          <Field label="Terrain">
            <input className="wb-input" value={selectedRegion.terrain} onChange={(event) => updateRegion(selectedRegion.id, { terrain: event.target.value })} placeholder="River delta, stone walls…" />
          </Field>
          <Field label="Why it matters">
            <textarea className="wb-textarea wb-textarea--short" value={selectedRegion.summary} onChange={(event) => updateRegion(selectedRegion.id, { summary: event.target.value })} placeholder="What makes this place important?" />
          </Field>
          <Field label="Controlled by">
            {world.factions.length === 0 ? (
              <button type="button" className="wb-link" onClick={() => setSection('factions')}>Add a faction to assign control</button>
            ) : (
              <div className="wb-chips">
                {world.factions.map((faction) => {
                  const active = selectedRegion.factionIds.includes(faction.id);
                  return (
                    <button key={faction.id} type="button" className={`wb-chip ${active ? 'wb-chip--on' : ''}`} style={active ? { ['--chip-color' as string]: faction.color } : undefined}
                      onClick={() => updateRegion(selectedRegion.id, { factionIds: active ? selectedRegion.factionIds.filter((id) => id !== faction.id) : [...selectedRegion.factionIds, faction.id] })}>
                      {faction.name}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
          <Field label="Notes">
            <textarea className="wb-textarea wb-textarea--short" value={selectedRegion.notes} onChange={(event) => updateRegion(selectedRegion.id, { notes: event.target.value })} placeholder="Legends, travel restrictions, visual motifs…" />
          </Field>
          <div className="wb-position">
            <span>Position</span>
            <label>X<input type="range" min={4} max={96} value={selectedRegion.x} onChange={(event) => updateRegion(selectedRegion.id, { x: clampPercent(Number(event.target.value)) })} /></label>
            <label>Y<input type="range" min={4} max={96} value={selectedRegion.y} onChange={(event) => updateRegion(selectedRegion.id, { y: clampPercent(Number(event.target.value)) })} /></label>
          </div>
        </div>
      ) : (
        <EmptyDetail title="No region selected" hint="Select a marker on the map or a row in the list to edit its lore and placement." action={<button type="button" className="wb-btn" onClick={() => setSheet('regions')}><SparklesIcon className="w-4 h-4" />Browse region presets</button>} />
      )}
    </div>
  );

  const renderFactions = () => (
    <div className="wb-grid wb-grid--split">
      <MasterList
        title="Factions"
        rows={world.factions.map((faction) => ({ id: faction.id, name: faction.name, meta: [faction.archetype, regionName(faction.baseRegionId)].filter(Boolean).join(' · '), color: faction.color }))}
        selectedId={selectedFactionId}
        onSelect={setSelectedFactionId}
        onAdd={addFaction}
        onBrowse={() => setSheet('factions')}
        emptyHint="No factions yet. Who holds power, and who wants it?"
      />
      {selectedFaction ? (
        <div className="wb-detail">
          <DetailHeader name={selectedFaction.name} placeholder="Faction name" onName={(name) => updateFaction(selectedFaction.id, { name })} onDelete={() => removeFaction(selectedFaction)} color={selectedFaction.color} onColor={(color) => updateFaction(selectedFaction.id, { color })} />
          <div className="wb-two">
            <Field label="Archetype"><input className="wb-input" value={selectedFaction.archetype} onChange={(event) => updateFaction(selectedFaction.id, { archetype: event.target.value })} placeholder="Empire, cult, guild…" /></Field>
            <Field label="Influence"><input className="wb-input" value={selectedFaction.influence} onChange={(event) => updateFaction(selectedFaction.id, { influence: event.target.value })} placeholder="Military, trade, occult…" /></Field>
          </div>
          <div className="wb-two">
            <Field label="Leader"><input className="wb-input" value={selectedFaction.leader} onChange={(event) => updateFaction(selectedFaction.id, { leader: event.target.value })} placeholder="Who speaks for them" /></Field>
            <Field label="Base region">
              <select className="wb-select" value={selectedFaction.baseRegionId || ''} onChange={(event) => updateFaction(selectedFaction.id, { baseRegionId: event.target.value })}>
                <option value="">No base region</option>
                {world.mapRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Agenda" hint="What they want right now"><textarea className="wb-textarea wb-textarea--short" value={selectedFaction.agenda} onChange={(event) => updateFaction(selectedFaction.id, { agenda: event.target.value })} placeholder="Strategic agenda and current objective…" /></Field>
          <Field label="Beliefs"><textarea className="wb-textarea wb-textarea--short" value={selectedFaction.beliefs} onChange={(event) => updateFaction(selectedFaction.id, { beliefs: event.target.value })} placeholder="Ideology, propaganda, what they tell their children…" /></Field>
          <div className="wb-two">
            <Field label="Allies"><input className="wb-input" value={selectedFaction.allies} onChange={(event) => updateFaction(selectedFaction.id, { allies: event.target.value })} placeholder="Allies and deals" /></Field>
            <Field label="Rivals"><input className="wb-input" value={selectedFaction.rivals} onChange={(event) => updateFaction(selectedFaction.id, { rivals: event.target.value })} placeholder="Rivals and enemies" /></Field>
          </div>
          <Field label="Visual identity" hint="Uniforms, sigils, rituals"><textarea className="wb-textarea wb-textarea--short" value={selectedFaction.notes} onChange={(event) => updateFaction(selectedFaction.id, { notes: event.target.value })} placeholder="Colours, uniforms, rituals, how they are recognised on screen…" /></Field>
        </div>
      ) : (
        <EmptyDetail title="No faction selected" hint="Add a faction or start from an archetype like an empire, a guild or a cult." action={<button type="button" className="wb-btn" onClick={() => setSheet('factions')}><SparklesIcon className="w-4 h-4" />Browse archetypes</button>} />
      )}
      <section className="wb-sheet wb-sheet--tight wb-grid__wide">
        <div className="wb-sheet__head"><h3>Balance of power</h3><p>One paragraph on who is winning and who is about to lose.</p></div>
        <textarea className="wb-textarea wb-textarea--short" value={world.factionsSummary} onChange={(event) => updateWorld({ factionsSummary: event.target.value })} placeholder="High-level balance of power across the universe…" />
      </section>
    </div>
  );

  const renderPlaces = () => (
    <div className="wb-grid wb-grid--split">
      <MasterList
        title="Places"
        rows={world.environments.map((environment) => ({ id: environment.id, name: environment.name, meta: [containerLabel(environment.containerType), regionName(environment.linkedRegionId)].filter(Boolean).join(' · '), color: world.mapRegions.find((region) => region.id === environment.linkedRegionId)?.color || 'var(--app-muted)' }))}
        selectedId={selectedEnvironmentId}
        onSelect={setSelectedEnvironmentId}
        onAdd={addEnvironment}
        onBrowse={() => setSheet('places')}
        emptyHint="No places yet. Reusable locations keep scenes and set design consistent."
      />
      {selectedEnvironment ? (
        <div className="wb-detail">
          <DetailHeader name={selectedEnvironment.name} placeholder="Place name" onName={(name) => updateEnvironment(selectedEnvironment.id, { name })} onDelete={() => removeEnvironment(selectedEnvironment)} badge={containerLabel(selectedEnvironment.containerType)} />
          <div className="wb-two">
            <Field label="Type">
              <select className="wb-select" value={selectedEnvironment.containerType} onChange={(event) => updateEnvironment(selectedEnvironment.id, { containerType: event.target.value as WorldbuildingEnvironment['containerType'] })}>
                {WORLD_ENVIRONMENT_CONTAINER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
            <Field label="Region">
              <select className="wb-select" value={selectedEnvironment.linkedRegionId || ''} onChange={(event) => updateEnvironment(selectedEnvironment.id, { linkedRegionId: event.target.value })}>
                <option value="">Not on the map</option>
                {world.mapRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="wb-three">
            <Field label="Biome"><input className="wb-input" value={selectedEnvironment.biome} onChange={(event) => updateEnvironment(selectedEnvironment.id, { biome: event.target.value })} placeholder="Interior, coastal…" /></Field>
            <Field label="Mood"><input className="wb-input" value={selectedEnvironment.mood} onChange={(event) => updateEnvironment(selectedEnvironment.id, { mood: event.target.value })} placeholder="Hushed, electric…" /></Field>
            <Field label="Used for"><input className="wb-input" value={selectedEnvironment.purpose} onChange={(event) => updateEnvironment(selectedEnvironment.id, { purpose: event.target.value })} placeholder="Chases, deals, the climax" /></Field>
          </div>
          <Field label="What it feels like"><textarea className="wb-textarea wb-textarea--short" value={selectedEnvironment.description} onChange={(event) => updateEnvironment(selectedEnvironment.id, { description: event.target.value })} placeholder="Light, sound, smell, the first thing a character notices…" /></Field>
          <div className="wb-two">
            <Field label="Hazards"><textarea className="wb-textarea wb-textarea--short" value={selectedEnvironment.hazards} onChange={(event) => updateEnvironment(selectedEnvironment.id, { hazards: event.target.value })} placeholder="Enemies, instability, rules…" /></Field>
            <Field label="Resources"><textarea className="wb-textarea wb-textarea--short" value={selectedEnvironment.resources} onChange={(event) => updateEnvironment(selectedEnvironment.id, { resources: event.target.value })} placeholder="Relics, value, why people come here…" /></Field>
          </div>
          <Field label="Set design notes" hint="Recurring props, creatures, dressing"><textarea className="wb-textarea wb-textarea--short" value={selectedEnvironment.notes} onChange={(event) => updateEnvironment(selectedEnvironment.id, { notes: event.target.value })} placeholder="Props, creatures, colours, what must stay consistent between shots…" /></Field>
        </div>
      ) : (
        <EmptyDetail title="No place selected" hint="Add a place or pick a preset such as a throne hall, a night bazaar or an underground lab." action={<button type="button" className="wb-btn" onClick={() => setSheet('places')}><SparklesIcon className="w-4 h-4" />Browse place presets</button>} />
      )}
    </div>
  );

  const renderLore = () => (
    <div className="wb-grid wb-grid--lore">
      <section className="wb-sheet">
        <div className="wb-sheet__head wb-sheet__head--row">
          <div>
            <h3>Lore terms <small>{world.glossary.length}</small></h3>
            <p>Names, ranks, spells, relics and slang. Keep meanings short.</p>
          </div>
          <div className="wb-actions">
            <button type="button" className="wb-btn wb-btn--quiet" onClick={() => setSheet('lore')}><SparklesIcon className="w-4 h-4" />Starter packs</button>
            <button type="button" className="wb-btn" onClick={addGlossary}><AddIcon className="w-4 h-4" />Add term</button>
          </div>
        </div>
        {world.glossary.length === 0 ? (
          <p className="wb-list__empty">No terms yet. Add one, or pull in a starter pack for ranks, magic, tech jargon, faith, travel or creatures.</p>
        ) : (
          <div className="wb-terms">
            {world.glossary.map((entry) => (
              <div key={entry.id} className="wb-term">
                <input className="wb-input wb-term__name" value={entry.term} onChange={(event) => updateGlossary(entry.id, { term: event.target.value })} placeholder="Term" />
                <input className="wb-input wb-term__meaning" value={entry.meaning} onChange={(event) => updateGlossary(entry.id, { meaning: event.target.value })} placeholder="Meaning, relevance, visual cue" />
                <button type="button" className="wb-icon-btn wb-icon-btn--danger" onClick={() => updateWorld({ glossary: world.glossary.filter((item) => item.id !== entry.id) })} title="Remove term"><XIcon className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </section>
      <aside className="wb-stack">
        <section className="wb-sheet wb-sheet--tight">
          <div className="wb-sheet__head"><h3>Starter packs</h3><p>Add a themed set in one click.</p></div>
          <div className="wb-packs">
            {WORLD_GLOSSARY_PACKS.map((pack) => (
              <button key={pack.id} type="button" className="wb-pack" onClick={() => { setSheet('lore'); }} title={pack.entries.map((entry) => entry.term).join(', ')}>
                <span className="wb-pack__name">{pack.name}</span>
                <span className="wb-pack__meta">{pack.entries.length} terms · {pack.description}</span>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );

  const renderLook = () => {
    const selectedIds = world.lookStyleIds || [];
    return (
      <div className="wb-grid wb-grid--look">
        <section className="wb-sheet">
          <div className="wb-sheet__head wb-sheet__head--row">
            <div>
              <h3>Visual look <small>{selectedIds.length}/{MAX_LOOK_STYLES}</small></h3>
              <p>Pick up to {MAX_LOOK_STYLES} style references that define how this world should be rendered.</p>
            </div>
            {selectedIds.length > 0 && <button type="button" className="wb-btn wb-btn--quiet" onClick={() => updateWorld({ lookStyleIds: [] })}>Clear</button>}
          </div>
          <div className="wb-style-grid">
            {STYLE_PRESETS.map((style) => {
              const active = selectedIds.includes(style.id);
              const disabled = !active && selectedIds.length >= MAX_LOOK_STYLES;
              return (
                <button key={style.id} type="button" className={`wb-style ${active ? 'wb-style--active' : ''}`} disabled={disabled} onClick={() => toggleLookStyle(style.id)} title={style.prompt}>
                  <img src={style.image} alt="" loading="lazy" />
                  <span className="wb-style__name">{style.label}</span>
                  {active && <span className="wb-style__check"><CheckCircleIcon className="w-4 h-4" /></span>}
                </button>
              );
            })}
          </div>
        </section>
        <aside className="wb-stack">
          <section className="wb-sheet wb-sheet--tight">
            <div className="wb-sheet__head"><h3>Selected references</h3></div>
            {lookStyles.length === 0 ? (
              <p className="wb-note">Nothing selected yet. Templates come with a suggested look.</p>
            ) : (
              <div className="wb-look-list">
                {lookStyles.map((style) => (
                  <div key={style.id} className="wb-look-item">
                    <img src={style.image} alt="" />
                    <span className="wb-look-item__text">
                      <span className="wb-look-item__name">{style.label}</span>
                      <span className="wb-look-item__prompt">{style.prompt}</span>
                    </span>
                    <button type="button" className="wb-icon-btn" onClick={() => toggleLookStyle(style.id)} title="Remove"><XIcon className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="wb-sheet wb-sheet--tight">
            <div className="wb-sheet__head"><h3>Art direction notes</h3></div>
            <textarea className="wb-textarea" value={world.lookNotes || ''} onChange={(event) => updateWorld({ lookNotes: event.target.value })} placeholder="Palette, lenses, materials, what must never appear…" />
          </section>
        </aside>
      </div>
    );
  };

  const counts: Record<SectionId, number | null> = {
    overview: null,
    map: world.mapRegions.length,
    factions: world.factions.length,
    places: world.environments.length,
    lore: world.glossary.length,
    look: (world.lookStyleIds || []).length,
  };

  return (
    <div className="wb">
      <div className="wb-bar">
        <nav className="wb-seg" aria-label="World sections">
          {SECTIONS.map((entry) => {
            const Icon = entry.icon;
            const count = counts[entry.id];
            return (
              <button key={entry.id} type="button" className={`wb-seg__item ${section === entry.id ? 'wb-seg__item--active' : ''}`} onClick={() => setSection(entry.id)} aria-pressed={section === entry.id}>
                <Icon className="w-4 h-4" />
                <span>{entry.label}</span>
                {count !== null && count > 0 && <span className="wb-seg__count">{count}</span>}
              </button>
            );
          })}
        </nav>
        <div className="wb-bar__right">
          <span className={`wb-pill ${readyCount === readiness.length ? 'wb-pill--ready' : ''}`} title="Universe, map, factions and places">{readyCount}/{readiness.length} ready</span>
          <button type="button" className="wb-btn wb-btn--quiet" onClick={onBack} title={`Back to ${backLabel}`}><ChevronLeftIcon className="w-4 h-4" />{backLabel}</button>
          <button type="button" className="wb-btn" onClick={onOpenConcept} title={`Open ${conceptLabel} with world context`}><SparklesIcon className="w-4 h-4" />{conceptLabel}</button>
          <button type="button" className="wb-btn wb-btn--primary" onClick={onNext}>Next: {nextLabel}<ChevronRightIcon className="w-4 h-4" /></button>
        </div>
      </div>

      {section === 'overview' && renderOverview()}
      {section === 'map' && renderMap()}
      {section === 'factions' && renderFactions()}
      {section === 'places' && renderPlaces()}
      {section === 'lore' && renderLore()}
      {section === 'look' && renderLook()}

      {sheet && (
        <PresetSheet
          title={sheetMeta[sheet].title}
          description={sheetMeta[sheet].description}
          pickLabel={sheetMeta[sheet].pickLabel}
          items={sheetItems}
          onPick={pickPreset}
          onClose={() => setSheet(null)}
          large={sheet === 'templates'}
        />
      )}
    </div>
  );
};

export default ProjectWorldbuildingPanel;
