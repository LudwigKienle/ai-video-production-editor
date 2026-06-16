import React, { useEffect, useMemo, useState } from 'react';
import type {
  WorldbuildingEnvironment,
  WorldbuildingFaction,
  WorldbuildingGlossaryEntry,
  WorldbuildingMapRegion,
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
  BoxIcon,
  BrainIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LandscapeIcon,
  ListIcon,
  SparklesIcon,
  UserCircleIcon,
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

const cardClass = 'bg-gray-800/70 border border-gray-700 rounded-2xl p-5 shadow-lg';
const inputClass =
  'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
const textareaClass =
  'w-full min-h-[110px] bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

const clampPercent = (value: number) => Math.max(4, Math.min(96, Math.round(value)));

const metricTone = (ready: boolean) =>
  ready
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-200';

const buttonTone = (active: boolean) =>
  active
    ? 'bg-indigo-600/80 border-indigo-500 text-white'
    : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500';

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
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [selectedFactionId, setSelectedFactionId] = useState('');
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('');
  const [selectedGlossaryId, setSelectedGlossaryId] = useState('');

  useEffect(() => {
    if (selectedRegionId && world.mapRegions.some((item) => item.id === selectedRegionId)) return;
    setSelectedRegionId(world.mapRegions[0]?.id || '');
  }, [selectedRegionId, world.mapRegions]);

  useEffect(() => {
    if (selectedFactionId && world.factions.some((item) => item.id === selectedFactionId)) return;
    setSelectedFactionId(world.factions[0]?.id || '');
  }, [selectedFactionId, world.factions]);

  useEffect(() => {
    if (
      selectedEnvironmentId &&
      world.environments.some((item) => item.id === selectedEnvironmentId)
    ) {
      return;
    }
    setSelectedEnvironmentId(world.environments[0]?.id || '');
  }, [selectedEnvironmentId, world.environments]);

  useEffect(() => {
    if (selectedGlossaryId && world.glossary.some((item) => item.id === selectedGlossaryId)) return;
    setSelectedGlossaryId(world.glossary[0]?.id || '');
  }, [selectedGlossaryId, world.glossary]);

  const updateWorld = (updates: Partial<WorldbuildingState>) => onChange({ ...world, ...updates });

  const updateRegion = (regionId: string, updates: Partial<WorldbuildingMapRegion>) => {
    updateWorld({
      mapRegions: world.mapRegions.map((item) =>
        item.id === regionId ? { ...item, ...updates } : item,
      ),
    });
  };

  const updateFaction = (factionId: string, updates: Partial<WorldbuildingFaction>) => {
    updateWorld({
      factions: world.factions.map((item) =>
        item.id === factionId ? { ...item, ...updates } : item,
      ),
    });
  };

  const updateEnvironment = (
    environmentId: string,
    updates: Partial<WorldbuildingEnvironment>,
  ) => {
    updateWorld({
      environments: world.environments.map((item) =>
        item.id === environmentId ? { ...item, ...updates } : item,
      ),
    });
  };

  const updateGlossary = (glossaryId: string, updates: Partial<WorldbuildingGlossaryEntry>) => {
    updateWorld({
      glossary: world.glossary.map((item) =>
        item.id === glossaryId ? { ...item, ...updates } : item,
      ),
    });
  };

  const selectedRegion =
    world.mapRegions.find((item) => item.id === selectedRegionId) || null;
  const selectedFaction =
    world.factions.find((item) => item.id === selectedFactionId) || null;
  const selectedEnvironment =
    world.environments.find((item) => item.id === selectedEnvironmentId) || null;
  const selectedGlossary =
    world.glossary.find((item) => item.id === selectedGlossaryId) || null;

  const readinessChecks = [
    Boolean(world.universeName.trim() || world.coreConflict.trim()),
    world.mapRegions.length > 0,
    world.factions.length > 0,
    world.environments.length > 0,
  ];
  const readinessCount = readinessChecks.filter(Boolean).length;

  const handleAddRegion = () => {
    const next = createWorldbuildingRegion();
    updateWorld({ mapRegions: [...world.mapRegions, next] });
    setSelectedRegionId(next.id);
  };

  const handleAddFaction = () => {
    const next = createWorldbuildingFaction();
    updateWorld({ factions: [...world.factions, next] });
    setSelectedFactionId(next.id);
  };

  const handleAddEnvironment = () => {
    const next = createWorldbuildingEnvironment();
    updateWorld({ environments: [...world.environments, next] });
    setSelectedEnvironmentId(next.id);
  };

  const handleAddGlossary = () => {
    const next = createWorldbuildingGlossaryEntry();
    updateWorld({ glossary: [...world.glossary, next] });
    setSelectedGlossaryId(next.id);
  };

  const handleMapClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedRegion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    updateRegion(selectedRegion.id, { x: clampPercent(x), y: clampPercent(y) });
  };

  return (
    <div className="space-y-6">
      <div className={`${cardClass} overflow-hidden relative`}>
        <div className="absolute inset-0 opacity-40 pointer-events-none" style={{
          background:
            'radial-gradient(circle at top left, rgba(99,102,241,0.28), transparent 34%), radial-gradient(circle at bottom right, rgba(20,184,166,0.2), transparent 30%)',
        }} />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-200">
              <SparklesIcon className="h-3.5 w-3.5" />
              Worldbuilding
            </div>
            <h2 className="mt-3 text-3xl font-bold text-white">Universe, factions and map before visual execution</h2>
            <p className="mt-2 text-sm leading-6 text-gray-300">
              The idea is strong. A dedicated worldbuilding phase makes more sense than hiding this
              inside Script or Concept, because fantasy projects need a stable universe model before
              art direction and shot design start drifting.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-600 bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:border-gray-500"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Back to {backLabel}
            </button>
            <button
              type="button"
              onClick={onOpenConcept}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/20"
            >
              Open {conceptLabel}
              <SparklesIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Next: {nextLabel}
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
        <div className={`rounded-xl border px-4 py-3 ${metricTone(scriptReady)}`}>
          <div className="text-[11px] uppercase tracking-wide opacity-80">Script context</div>
          <div className="mt-1 text-sm font-semibold">{scriptReady ? 'Ready' : 'Missing'}</div>
        </div>
        <div className={`rounded-xl border px-4 py-3 ${metricTone(readinessChecks[0])}`}>
          <div className="text-[11px] uppercase tracking-wide opacity-80">Universe core</div>
          <div className="mt-1 text-sm font-semibold">{world.universeName || 'Not defined yet'}</div>
        </div>
        <div className={`rounded-xl border px-4 py-3 ${metricTone(readinessChecks[1])}`}>
          <div className="text-[11px] uppercase tracking-wide opacity-80">Map regions</div>
          <div className="mt-1 text-sm font-semibold">{world.mapRegions.length}</div>
        </div>
        <div className={`rounded-xl border px-4 py-3 ${metricTone(readinessChecks[2])}`}>
          <div className="text-[11px] uppercase tracking-wide opacity-80">Factions</div>
          <div className="mt-1 text-sm font-semibold">{world.factions.length}</div>
        </div>
        <div className={`rounded-xl border px-4 py-3 ${metricTone(readinessChecks[3])}`}>
          <div className="text-[11px] uppercase tracking-wide opacity-80">Environment containers</div>
          <div className="mt-1 text-sm font-semibold">
            {world.environments.length} · {conceptCount} concept refs
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className={`${cardClass} xl:col-span-5`}>
          <div className="flex items-center gap-3">
            <BrainIcon className="h-5 w-5 text-indigo-300" />
            <div>
              <h3 className="text-lg font-semibold text-white">Universe Core</h3>
              <p className="text-xs text-gray-400">Rules, era and the central tension of the world.</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Universe Name</label>
              <input
                className={inputClass}
                value={world.universeName}
                onChange={(event) => updateWorld({ universeName: event.target.value })}
                placeholder="Ashen Realms"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Genre</label>
              <input
                className={inputClass}
                value={world.genre}
                onChange={(event) => updateWorld({ genre: event.target.value })}
                placeholder="Dark fantasy, mythic adventure"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Tone</label>
              <input
                className={inputClass}
                value={world.tone}
                onChange={(event) => updateWorld({ tone: event.target.value })}
                placeholder="Melancholic, epic, dangerous"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Era</label>
              <input
                className={inputClass}
                value={world.era}
                onChange={(event) => updateWorld({ era: event.target.value })}
                placeholder="Fifth age after the eclipse war"
              />
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Core Conflict</label>
            <textarea
              className={textareaClass}
              value={world.coreConflict}
              onChange={(event) => updateWorld({ coreConflict: event.target.value })}
              placeholder="What is the major power struggle or existential threat?"
            />
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Magic System / Power Logic</label>
            <textarea
              className={textareaClass}
              value={world.magicSystem}
              onChange={(event) => updateWorld({ magicSystem: event.target.value })}
              placeholder="Costs, limits, rituals, forbidden usage..."
            />
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Technology Level</label>
            <textarea
              className={textareaClass}
              value={world.technologyLevel}
              onChange={(event) => updateWorld({ technologyLevel: event.target.value })}
              placeholder="Pre-industrial, arcane machinery, biotech relics..."
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Rules of the World</label>
              <textarea
                className={textareaClass}
                value={world.rules}
                onChange={(event) => updateWorld({ rules: event.target.value })}
                placeholder="Social rules, taboos, travel limits..."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">History Snapshot</label>
              <textarea
                className={textareaClass}
                value={world.history}
                onChange={(event) => updateWorld({ history: event.target.value })}
                placeholder="Key wars, cataclysms, dynasties..."
              />
            </div>
          </div>
        </div>

        <div className={`${cardClass} xl:col-span-7`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-center gap-3">
              <LandscapeIcon className="h-5 w-5 text-teal-300" />
              <div>
                <h3 className="text-lg font-semibold text-white">Map Planner</h3>
                <p className="text-xs text-gray-400">
                  Add regions, select one, then click inside the map to place it.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAddRegion}
                className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-2 text-xs font-semibold text-teal-100 hover:bg-teal-500/20"
              >
                Add Region
              </button>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-12">
            <div className="xl:col-span-7">
              <div
                onClick={handleMapClick}
                className="relative h-[360px] cursor-crosshair overflow-hidden rounded-2xl border border-gray-700 bg-gray-950"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px), radial-gradient(circle at 20% 20%, rgba(59,130,246,0.12), transparent 22%), radial-gradient(circle at 80% 30%, rgba(16,185,129,0.12), transparent 24%), radial-gradient(circle at 50% 75%, rgba(250,204,21,0.1), transparent 20%), linear-gradient(180deg, rgba(12,18,30,0.94), rgba(7,10,18,0.96))',
                  backgroundSize: '56px 56px, 56px 56px, auto, auto, auto, auto',
                }}
              >
                <div className="absolute inset-0 opacity-60 pointer-events-none" style={{
                  background:
                    'radial-gradient(circle at center, transparent 0%, transparent 54%, rgba(15,23,42,0.82) 100%)',
                }} />
                {world.mapRegions.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-gray-400">
                    Add your first region to start a fantasy map. Regions can represent continents,
                    kingdoms, seas, cities or landmarks.
                  </div>
                )}
                {world.mapRegions.map((region) => {
                  const isActive = region.id === selectedRegionId;
                  return (
                    <button
                      key={region.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedRegionId(region.id);
                      }}
                      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 px-3 py-1 text-[11px] font-semibold transition-transform ${isActive ? 'scale-105 text-white shadow-lg' : 'text-gray-200'}`}
                      style={{
                        left: `${region.x}%`,
                        top: `${region.y}%`,
                        borderColor: region.color || '#a78bfa',
                        backgroundColor: isActive ? `${region.color}33` : 'rgba(15,23,42,0.92)',
                        boxShadow: isActive ? `0 0 0 1px ${region.color}, 0 14px 32px rgba(15,23,42,0.55)` : 'none',
                      }}
                    >
                      {region.name}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {world.mapRegions.map((region) => (
                  <button
                    key={region.id}
                    type="button"
                    onClick={() => setSelectedRegionId(region.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${buttonTone(region.id === selectedRegionId)}`}
                  >
                    {region.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="xl:col-span-5">
              {selectedRegion ? (
                <div className="rounded-2xl border border-gray-700 bg-gray-900/50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-gray-500">Selected Region</div>
                      <div className="text-sm font-semibold text-white">{selectedRegion.name}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateWorld({
                          mapRegions: world.mapRegions.filter((item) => item.id !== selectedRegion.id),
                          factions: world.factions.map((item) => ({
                            ...item,
                            baseRegionId: item.baseRegionId === selectedRegion.id ? '' : item.baseRegionId,
                          })),
                          environments: world.environments.map((item) => ({
                            ...item,
                            linkedRegionId:
                              item.linkedRegionId === selectedRegion.id ? '' : item.linkedRegionId,
                          })),
                        })
                      }
                      className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    <input
                      className={inputClass}
                      value={selectedRegion.name}
                      onChange={(event) =>
                        updateRegion(selectedRegion.id, { name: event.target.value })
                      }
                      placeholder="Region name"
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <select
                        className={inputClass}
                        value={selectedRegion.kind}
                        onChange={(event) =>
                          updateRegion(selectedRegion.id, {
                            kind: event.target.value as WorldbuildingMapRegion['kind'],
                          })
                        }
                      >
                        {WORLD_REGION_KIND_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className={inputClass}
                        value={selectedRegion.color}
                        onChange={(event) =>
                          updateRegion(selectedRegion.id, { color: event.target.value })
                        }
                        placeholder="#a78bfa"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs text-gray-400">
                        X Position
                        <input
                          type="range"
                          min={4}
                          max={96}
                          value={selectedRegion.x}
                          onChange={(event) =>
                            updateRegion(selectedRegion.id, {
                              x: clampPercent(Number(event.target.value)),
                            })
                          }
                          className="mt-2 w-full"
                        />
                      </label>
                      <label className="text-xs text-gray-400">
                        Y Position
                        <input
                          type="range"
                          min={4}
                          max={96}
                          value={selectedRegion.y}
                          onChange={(event) =>
                            updateRegion(selectedRegion.id, {
                              y: clampPercent(Number(event.target.value)),
                            })
                          }
                          className="mt-2 w-full"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        className={inputClass}
                        value={selectedRegion.climate}
                        onChange={(event) =>
                          updateRegion(selectedRegion.id, { climate: event.target.value })
                        }
                        placeholder="Climate"
                      />
                      <input
                        className={inputClass}
                        value={selectedRegion.terrain}
                        onChange={(event) =>
                          updateRegion(selectedRegion.id, { terrain: event.target.value })
                        }
                        placeholder="Terrain"
                      />
                    </div>
                    <textarea
                      className={textareaClass}
                      value={selectedRegion.summary}
                      onChange={(event) =>
                        updateRegion(selectedRegion.id, { summary: event.target.value })
                      }
                      placeholder="What makes this place important?"
                    />
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Controlling Factions
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {world.factions.length === 0 ? (
                          <span className="text-xs text-gray-500">Add a faction to link territorial control.</span>
                        ) : (
                          world.factions.map((faction) => {
                            const active = selectedRegion.factionIds.includes(faction.id);
                            return (
                              <button
                                key={faction.id}
                                type="button"
                                onClick={() =>
                                  updateRegion(selectedRegion.id, {
                                    factionIds: active
                                      ? selectedRegion.factionIds.filter((id) => id !== faction.id)
                                      : [...selectedRegion.factionIds, faction.id],
                                  })
                                }
                                className={`rounded-full border px-3 py-1 text-xs font-semibold ${buttonTone(active)}`}
                              >
                                {faction.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <textarea
                      className={textareaClass}
                      value={selectedRegion.notes}
                      onChange={(event) =>
                        updateRegion(selectedRegion.id, { notes: event.target.value })
                      }
                      placeholder="Legends, travel restrictions, visual motifs..."
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-6 text-sm text-gray-400">
                  Select a region to edit its map placement and lore.
                </div>
              )}
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Map Legend / Travel Rules</label>
            <textarea
              className={textareaClass}
              value={world.mapLegend}
              onChange={(event) => updateWorld({ mapLegend: event.target.value })}
              placeholder="Roads, forbidden zones, portal routes, empire borders..."
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className={`${cardClass} xl:col-span-6`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <UserCircleIcon className="h-5 w-5 text-amber-300" />
              <div>
                <h3 className="text-lg font-semibold text-white">Factions</h3>
                <p className="text-xs text-gray-400">Power blocks, beliefs and territorial control.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddFaction}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
            >
              Add Faction
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {world.factions.map((faction) => (
              <button
                key={faction.id}
                type="button"
                onClick={() => setSelectedFactionId(faction.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${buttonTone(faction.id === selectedFactionId)}`}
              >
                {faction.name}
              </button>
            ))}
          </div>
          {selectedFaction ? (
            <div className="mt-4 rounded-2xl border border-gray-700 bg-gray-900/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">{selectedFaction.name}</div>
                <button
                  type="button"
                  onClick={() =>
                    updateWorld({
                      factions: world.factions.filter((item) => item.id !== selectedFaction.id),
                      mapRegions: world.mapRegions.map((item) => ({
                        ...item,
                        factionIds: item.factionIds.filter((id) => id !== selectedFaction.id),
                      })),
                    })
                  }
                  className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                >
                  Delete
                </button>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  className={inputClass}
                  value={selectedFaction.name}
                  onChange={(event) =>
                    updateFaction(selectedFaction.id, { name: event.target.value })
                  }
                  placeholder="Faction name"
                />
                <input
                  className={inputClass}
                  value={selectedFaction.color}
                  onChange={(event) =>
                    updateFaction(selectedFaction.id, { color: event.target.value })
                  }
                  placeholder="#f59e0b"
                />
                <input
                  className={inputClass}
                  value={selectedFaction.archetype}
                  onChange={(event) =>
                    updateFaction(selectedFaction.id, { archetype: event.target.value })
                  }
                  placeholder="Empire, cult, guild..."
                />
                <input
                  className={inputClass}
                  value={selectedFaction.influence}
                  onChange={(event) =>
                    updateFaction(selectedFaction.id, { influence: event.target.value })
                  }
                  placeholder="Military, trade, occult..."
                />
                <input
                  className={inputClass}
                  value={selectedFaction.leader}
                  onChange={(event) =>
                    updateFaction(selectedFaction.id, { leader: event.target.value })
                  }
                  placeholder="Leader"
                />
                <select
                  className={inputClass}
                  value={selectedFaction.baseRegionId || ''}
                  onChange={(event) =>
                    updateFaction(selectedFaction.id, { baseRegionId: event.target.value })
                  }
                >
                  <option value="">No base region</option>
                  {world.mapRegions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3 space-y-3">
                <textarea
                  className={textareaClass}
                  value={selectedFaction.agenda}
                  onChange={(event) =>
                    updateFaction(selectedFaction.id, { agenda: event.target.value })
                  }
                  placeholder="Strategic agenda and current objective..."
                />
                <textarea
                  className={textareaClass}
                  value={selectedFaction.beliefs}
                  onChange={(event) =>
                    updateFaction(selectedFaction.id, { beliefs: event.target.value })
                  }
                  placeholder="Beliefs, ideology, propaganda..."
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    className={inputClass}
                    value={selectedFaction.allies}
                    onChange={(event) =>
                      updateFaction(selectedFaction.id, { allies: event.target.value })
                    }
                    placeholder="Allies / deals"
                  />
                  <input
                    className={inputClass}
                    value={selectedFaction.rivals}
                    onChange={(event) =>
                      updateFaction(selectedFaction.id, { rivals: event.target.value })
                    }
                    placeholder="Rivals / enemies"
                  />
                </div>
                <textarea
                  className={textareaClass}
                  value={selectedFaction.notes}
                  onChange={(event) =>
                    updateFaction(selectedFaction.id, { notes: event.target.value })
                  }
                  placeholder="Visual identity, uniforms, rituals..."
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-6 text-sm text-gray-400">
              Add a faction to track alliances, rivals and political control.
            </div>
          )}
          <div className="mt-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">Faction Overview</label>
            <textarea
              className={textareaClass}
              value={world.factionsSummary}
              onChange={(event) => updateWorld({ factionsSummary: event.target.value })}
              placeholder="High-level balance of power across the universe..."
            />
          </div>
        </div>

        <div className={`${cardClass} xl:col-span-6`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BoxIcon className="h-5 w-5 text-sky-300" />
              <div>
                <h3 className="text-lg font-semibold text-white">Environment Containers</h3>
                <p className="text-xs text-gray-400">Reusable places for locations, dungeons, hubs and set pieces.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddEnvironment}
              className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-500/20"
            >
              Add Environment
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {world.environments.map((environment) => (
              <button
                key={environment.id}
                type="button"
                onClick={() => setSelectedEnvironmentId(environment.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${buttonTone(environment.id === selectedEnvironmentId)}`}
              >
                {environment.name}
              </button>
            ))}
          </div>
          {selectedEnvironment ? (
            <div className="mt-4 rounded-2xl border border-gray-700 bg-gray-900/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">{selectedEnvironment.name}</div>
                <button
                  type="button"
                  onClick={() =>
                    updateWorld({
                      environments: world.environments.filter(
                        (item) => item.id !== selectedEnvironment.id,
                      ),
                    })
                  }
                  className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                >
                  Delete
                </button>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  className={inputClass}
                  value={selectedEnvironment.name}
                  onChange={(event) =>
                    updateEnvironment(selectedEnvironment.id, { name: event.target.value })
                  }
                  placeholder="Environment name"
                />
                <select
                  className={inputClass}
                  value={selectedEnvironment.containerType}
                  onChange={(event) =>
                    updateEnvironment(selectedEnvironment.id, {
                      containerType: event.target.value as WorldbuildingEnvironment['containerType'],
                    })
                  }
                >
                  {WORLD_ENVIRONMENT_CONTAINER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className={inputClass}
                  value={selectedEnvironment.linkedRegionId || ''}
                  onChange={(event) =>
                    updateEnvironment(selectedEnvironment.id, {
                      linkedRegionId: event.target.value,
                    })
                  }
                >
                  <option value="">No linked region</option>
                  {world.mapRegions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  value={selectedEnvironment.biome}
                  onChange={(event) =>
                    updateEnvironment(selectedEnvironment.id, { biome: event.target.value })
                  }
                  placeholder="Biome"
                />
                <input
                  className={inputClass}
                  value={selectedEnvironment.mood}
                  onChange={(event) =>
                    updateEnvironment(selectedEnvironment.id, { mood: event.target.value })
                  }
                  placeholder="Mood"
                />
                <input
                  className={inputClass}
                  value={selectedEnvironment.purpose}
                  onChange={(event) =>
                    updateEnvironment(selectedEnvironment.id, { purpose: event.target.value })
                  }
                  placeholder="Narrative purpose"
                />
              </div>
              <div className="mt-3 space-y-3">
                <textarea
                  className={textareaClass}
                  value={selectedEnvironment.description}
                  onChange={(event) =>
                    updateEnvironment(selectedEnvironment.id, { description: event.target.value })
                  }
                  placeholder="What does this place feel like?"
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <textarea
                    className={textareaClass}
                    value={selectedEnvironment.hazards}
                    onChange={(event) =>
                      updateEnvironment(selectedEnvironment.id, { hazards: event.target.value })
                    }
                    placeholder="Hazards, enemies, instability..."
                  />
                  <textarea
                    className={textareaClass}
                    value={selectedEnvironment.resources}
                    onChange={(event) =>
                      updateEnvironment(selectedEnvironment.id, { resources: event.target.value })
                    }
                    placeholder="Resources, relics, economic value..."
                  />
                </div>
                <textarea
                  className={textareaClass}
                  value={selectedEnvironment.notes}
                  onChange={(event) =>
                    updateEnvironment(selectedEnvironment.id, { notes: event.target.value })
                  }
                  placeholder="Set design notes, recurring props, creatures..."
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-6 text-sm text-gray-400">
              Add reusable environment containers for world locations and set pieces.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className={`${cardClass} xl:col-span-8`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ListIcon className="h-5 w-5 text-violet-300" />
              <div>
                <h3 className="text-lg font-semibold text-white">Lore Terms</h3>
                <p className="text-xs text-gray-400">Names, spells, relics, regions or cultural words.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddGlossary}
              className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/20"
            >
              Add Term
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {world.glossary.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedGlossaryId(entry.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${buttonTone(entry.id === selectedGlossaryId)}`}
              >
                {entry.term}
              </button>
            ))}
          </div>
          {selectedGlossary ? (
            <div className="mt-4 rounded-2xl border border-gray-700 bg-gray-900/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">{selectedGlossary.term}</div>
                <button
                  type="button"
                  onClick={() =>
                    updateWorld({
                      glossary: world.glossary.filter((item) => item.id !== selectedGlossary.id),
                    })
                  }
                  className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                >
                  Delete
                </button>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr]">
                <input
                  className={inputClass}
                  value={selectedGlossary.term}
                  onChange={(event) =>
                    updateGlossary(selectedGlossary.id, { term: event.target.value })
                  }
                  placeholder="Term"
                />
                <textarea
                  className={textareaClass}
                  value={selectedGlossary.meaning}
                  onChange={(event) =>
                    updateGlossary(selectedGlossary.id, { meaning: event.target.value })
                  }
                  placeholder="Meaning, relevance and visual cues..."
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-6 text-sm text-gray-400">
              Add lore terms if the world has its own language, relic classes or named institutions.
            </div>
          )}
        </div>
        <div className={`${cardClass} xl:col-span-4`}>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-300">
            Phase Readiness
          </div>
          <div className="mt-3 text-3xl font-bold text-white">{readinessCount}/4</div>
          <p className="mt-2 text-sm leading-6 text-gray-300">
            Once the universe core, map, factions and environment containers are defined, the
            project has enough structure to move into director planning and concept execution.
          </p>
          <div className="mt-4 space-y-2 text-sm">
            <div className={`rounded-lg border px-3 py-2 ${metricTone(readinessChecks[0])}`}>Universe logic captured</div>
            <div className={`rounded-lg border px-3 py-2 ${metricTone(readinessChecks[1])}`}>Map regions added</div>
            <div className={`rounded-lg border px-3 py-2 ${metricTone(readinessChecks[2])}`}>Faction layer defined</div>
            <div className={`rounded-lg border px-3 py-2 ${metricTone(readinessChecks[3])}`}>Environment containers ready</div>
          </div>
          <div className="mt-5 space-y-3">
            <button
              type="button"
              onClick={onOpenConcept}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/20"
            >
              Open {conceptLabel} with World Context
              <SparklesIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onNext}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              Continue to {nextLabel}
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectWorldbuildingPanel;
