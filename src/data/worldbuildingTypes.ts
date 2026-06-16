import type {
  WorldbuildingEnvironment,
  WorldbuildingFaction,
  WorldbuildingGlossaryEntry,
  WorldbuildingMapRegion,
  WorldbuildingMapRegionKind,
  WorldbuildingState,
} from '../types';

const buildId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

export const WORLD_REGION_KIND_OPTIONS: Array<{
  value: WorldbuildingMapRegionKind;
  label: string;
}> = [
  { value: 'continent', label: 'Continent' },
  { value: 'kingdom', label: 'Kingdom' },
  { value: 'city', label: 'City' },
  { value: 'wildlands', label: 'Wildlands' },
  { value: 'landmark', label: 'Landmark' },
  { value: 'sea', label: 'Sea' },
  { value: 'route', label: 'Route' },
];

export const WORLD_ENVIRONMENT_CONTAINER_OPTIONS: Array<{
  value: WorldbuildingEnvironment['containerType'];
  label: string;
}> = [
  { value: 'region', label: 'Region' },
  { value: 'city', label: 'City' },
  { value: 'dungeon', label: 'Dungeon' },
  { value: 'settlement', label: 'Settlement' },
  { value: 'frontier', label: 'Frontier' },
  { value: 'sanctuary', label: 'Sanctuary' },
];

export const createWorldbuildingRegion = (): WorldbuildingMapRegion => ({
  id: buildId('world-region'),
  name: 'New Region',
  kind: 'kingdom',
  summary: '',
  climate: '',
  terrain: '',
  x: 48,
  y: 44,
  color: '#a78bfa',
  notes: '',
  factionIds: [],
});

export const createWorldbuildingFaction = (): WorldbuildingFaction => ({
  id: buildId('world-faction'),
  name: 'New Faction',
  archetype: '',
  influence: '',
  leader: '',
  baseRegionId: '',
  color: '#f59e0b',
  agenda: '',
  beliefs: '',
  allies: '',
  rivals: '',
  notes: '',
});

export const createWorldbuildingEnvironment = (): WorldbuildingEnvironment => ({
  id: buildId('world-environment'),
  name: 'New Environment',
  containerType: 'region',
  linkedRegionId: '',
  biome: '',
  mood: '',
  purpose: '',
  description: '',
  hazards: '',
  resources: '',
  notes: '',
});

export const createWorldbuildingGlossaryEntry = (): WorldbuildingGlossaryEntry => ({
  id: buildId('world-glossary'),
  term: 'New Term',
  meaning: '',
});

export const createDefaultWorldbuildingState = (): WorldbuildingState => ({
  universeName: '',
  genre: '',
  tone: '',
  era: '',
  coreConflict: '',
  magicSystem: '',
  technologyLevel: '',
  rules: '',
  history: '',
  mapLegend: '',
  factionsSummary: '',
  mapRegions: [],
  factions: [],
  environments: [],
  glossary: [],
});
