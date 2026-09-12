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
} from './worldbuildingTypes';

/* ─── Suggestion chips for the universe core ─── */

export const WORLD_GENRE_SUGGESTIONS = [
  'Dark fantasy', 'High fantasy', 'Space opera', 'Cyberpunk', 'Post-apocalyptic', 'Solarpunk',
  'Steampunk', 'Mythic antiquity', 'Noir crime', 'Cosmic horror', 'Western', 'Historical epic',
  'Urban fantasy', 'Hard sci-fi', 'Fairy tale', 'Military sci-fi', 'Dystopia', 'Cozy fantasy',
];

export const WORLD_TONE_SUGGESTIONS = [
  'Melancholic', 'Epic', 'Dangerous', 'Hopeful', 'Playful', 'Grim', 'Mysterious', 'Romantic',
  'Satirical', 'Tense', 'Dreamlike', 'Brutal', 'Warm', 'Cold and clinical', 'Elegiac', 'Wry',
];

export const WORLD_ERA_SUGGESTIONS = [
  'Bronze age', 'Late medieval', 'Age of sail', 'Industrial revolution', 'Interwar years', 'Near future',
  'Far future', 'After the collapse', 'Timeless myth', 'Digital present', 'First contact', 'Long peace ending',
];

export const WORLD_TECH_SUGGESTIONS = [
  'Pre-industrial', 'Clockwork and steam', 'Arcane machinery', 'Early electricity', 'Contemporary',
  'Cybernetics and neural links', 'Interstellar travel', 'Biotech relics', 'Salvaged tech', 'Post-scarcity',
];

export const WORLD_MAGIC_SUGGESTIONS = [
  'No magic, only belief', 'Costly blood magic', 'Elemental binding', 'Ancestor spirits', 'Divine covenants',
  'Psionics', 'Nanotech treated as sorcery', 'Dream-walking', 'Runes and true names', 'Forbidden necromancy',
];

/* ─── Region presets ─── */

export type WorldRegionPreset = {
  id: string;
  name: string;
  kind: WorldbuildingMapRegionKind;
  climate: string;
  terrain: string;
  summary: string;
  color: string;
  tags: string[];
};

export const WORLD_REGION_PRESETS: WorldRegionPreset[] = [
  { id: 'capital', name: 'Capital City', kind: 'city', climate: 'Temperate', terrain: 'River delta, stone walls', summary: 'Seat of power, crowded, ceremonial and dangerous after dark.', color: '#d8b46a', tags: ['city', 'power', 'urban'] },
  { id: 'frontier-outpost', name: 'Frontier Outpost', kind: 'city', climate: 'Harsh, windy', terrain: 'Palisade on a ridge', summary: 'Last stop before the wilds. Traders, deserters and scouts pass through.', color: '#c08457', tags: ['edge', 'small', 'tension'] },
  { id: 'cursed-forest', name: 'Cursed Forest', kind: 'wildlands', climate: 'Damp, foggy', terrain: 'Ancient trees, sunken paths', summary: 'Travellers vanish. Locals leave offerings at the treeline.', color: '#57b894', tags: ['wild', 'horror', 'nature'] },
  { id: 'sunken-sea', name: 'Sunken Sea', kind: 'sea', climate: 'Storm season', terrain: 'Drowned cities beneath the waves', summary: 'A trade route and a graveyard. Fishermen tell of lights below.', color: '#5aa9e6', tags: ['sea', 'trade', 'mystery'] },
  { id: 'sky-citadel', name: 'Sky Citadel', kind: 'landmark', climate: 'Thin air', terrain: 'Fortress on a floating rock', summary: 'Unreachable without permission or a very good reason.', color: '#aab4ff', tags: ['landmark', 'fortress', 'wonder'] },
  { id: 'trade-road', name: 'Old Trade Road', kind: 'route', climate: 'Varies', terrain: 'Paved road, waystations', summary: 'The artery of the realm. Whoever holds it holds the coin.', color: '#b3bbc7', tags: ['route', 'trade', 'travel'] },
  { id: 'volcanic-wastes', name: 'Volcanic Wastes', kind: 'wildlands', climate: 'Scorching, ash rain', terrain: 'Basalt fields, lava rivers', summary: 'Forges of the old empire. Nothing grows, everything burns.', color: '#dd7c7c', tags: ['wild', 'fire', 'ruin'] },
  { id: 'frozen-north', name: 'Frozen North', kind: 'continent', climate: 'Arctic', terrain: 'Glaciers, iron mountains', summary: 'Hard people, older gods, long nights.', color: '#9fd3ff', tags: ['continent', 'cold', 'myth'] },
  { id: 'river-kingdom', name: 'River Kingdom', kind: 'kingdom', climate: 'Mild, fertile', terrain: 'Floodplains and vineyards', summary: 'Rich, comfortable and quietly rotting from the inside.', color: '#7cc0a5', tags: ['kingdom', 'wealth', 'politics'] },
  { id: 'iron-marches', name: 'Iron Marches', kind: 'kingdom', climate: 'Grey, rainy', terrain: 'Hill forts, mines', summary: 'Border kingdom that keeps the peace with swords and debts.', color: '#8d97a6', tags: ['kingdom', 'war', 'border'] },
  { id: 'desert-caliphate', name: 'Desert Caliphate', kind: 'kingdom', climate: 'Arid', terrain: 'Dunes, oasis cities', summary: 'Scholars, spice and a ruler who never appears in public.', color: '#e9c46a', tags: ['kingdom', 'desert', 'trade'] },
  { id: 'megacity-core', name: 'Megacity Core', kind: 'city', climate: 'Artificial', terrain: 'Vertical sprawl, neon canyons', summary: 'Corporate towers above, markets and gangs below.', color: '#ff7ab6', tags: ['city', 'scifi', 'urban'] },
  { id: 'orbital-ring', name: 'Orbital Ring', kind: 'landmark', climate: 'Controlled', terrain: 'Station segments, docking spokes', summary: 'The only way off-world. Customs is where stories begin.', color: '#7c8cff', tags: ['landmark', 'scifi', 'travel'] },
  { id: 'dead-zone', name: 'Dead Zone', kind: 'wildlands', climate: 'Irradiated', terrain: 'Collapsed highways, silent suburbs', summary: 'Scavengers only. Maps stop being useful here.', color: '#b7c46a', tags: ['wild', 'apocalypse', 'ruin'] },
  { id: 'harbor-republic', name: 'Harbor Republic', kind: 'city', climate: 'Maritime', terrain: 'Docks, warehouses, guild halls', summary: 'Free port ruled by merchant houses and their private fleets.', color: '#6ec6c1', tags: ['city', 'sea', 'trade'] },
  { id: 'pilgrim-path', name: 'Pilgrim Path', kind: 'route', climate: 'Mountain weather', terrain: 'Stair roads, shrines', summary: 'A journey of penance. Bandits and monks share the same rest stops.', color: '#c9a7ff', tags: ['route', 'faith', 'travel'] },
  { id: 'inner-sea', name: 'Inner Sea', kind: 'sea', climate: 'Calm, warm', terrain: 'Islands and lighthouses', summary: 'Every island is a small kingdom with a grudge.', color: '#4fb3e8', tags: ['sea', 'islands', 'politics'] },
  { id: 'lost-continent', name: 'Lost Continent', kind: 'continent', climate: 'Unknown', terrain: 'Jungle over ruins', summary: 'Recently rediscovered. Everyone wants to be first.', color: '#57b894', tags: ['continent', 'exploration', 'ruin'] },
];

/* ─── Faction presets ─── */

export type WorldFactionPreset = {
  id: string;
  name: string;
  archetype: string;
  influence: string;
  leader: string;
  agenda: string;
  beliefs: string;
  color: string;
  tags: string[];
};

export const WORLD_FACTION_PRESETS: WorldFactionPreset[] = [
  { id: 'empire', name: 'The Empire', archetype: 'Imperial state', influence: 'Military, taxation', leader: 'An aging emperor with no clear heir', agenda: 'Hold the provinces together at any cost.', beliefs: 'Order is worth more than freedom.', color: '#d8b46a', tags: ['state', 'power'] },
  { id: 'rebels', name: 'Free Cells', archetype: 'Rebel network', influence: 'Sabotage, propaganda', leader: 'A voice on the radio nobody has met', agenda: 'Break the capital\'s grip on the frontier.', beliefs: 'Every chain has a weak link.', color: '#dd7c7c', tags: ['rebel', 'underground'] },
  { id: 'merchant-guild', name: 'Merchant League', archetype: 'Trade guild', influence: 'Credit, shipping', leader: 'A council of house heads', agenda: 'Keep the roads open and the tariffs low.', beliefs: 'Everything has a price, including peace.', color: '#6ec6c1', tags: ['trade', 'money'] },
  { id: 'church', name: 'The Covenant', archetype: 'Church', influence: 'Faith, records, hospitals', leader: 'A high celebrant chosen by lot', agenda: 'Restore the old rites before the omen returns.', beliefs: 'The world is on loan and the debt is due.', color: '#c9a7ff', tags: ['faith', 'institution'] },
  { id: 'cult', name: 'Ash Choir', archetype: 'Cult', influence: 'Fear, secrets', leader: 'The Speaker, who is never the same person twice', agenda: 'Wake what sleeps under the mountain.', beliefs: 'Ending is a kind of mercy.', color: '#8d97a6', tags: ['cult', 'horror'] },
  { id: 'mercenaries', name: 'Grey Company', archetype: 'Mercenary company', influence: 'Steel, reputation', leader: 'A captain who keeps every contract', agenda: 'Get paid, get out, get rich.', beliefs: 'Loyalty is a contract with a date on it.', color: '#b3bbc7', tags: ['war', 'money'] },
  { id: 'scholars', name: 'The Athenaeum', archetype: 'Scholar order', influence: 'Knowledge, maps, machines', leader: 'The Archivist', agenda: 'Collect everything before it is lost.', beliefs: 'Ignorance is the only sin.', color: '#7c8cff', tags: ['knowledge', 'institution'] },
  { id: 'syndicate', name: 'Lantern Syndicate', archetype: 'Crime syndicate', influence: 'Smuggling, debt', leader: 'A family matriarch', agenda: 'Own the docks, then the harbour master.', beliefs: 'The law is for people who cannot afford better.', color: '#ff7ab6', tags: ['crime', 'city'] },
  { id: 'nomads', name: 'Wind Clans', archetype: 'Nomad confederation', influence: 'Mobility, herds, scouts', leader: 'Rotating clan speakers', agenda: 'Keep the migration routes free of borders.', beliefs: 'Land cannot be owned, only crossed.', color: '#c08457', tags: ['tribe', 'wild'] },
  { id: 'corporation', name: 'Helix Corporation', archetype: 'Corporate conglomerate', influence: 'Patents, security, media', leader: 'A CEO who is mostly an AI now', agenda: 'Privatise the last public infrastructure.', beliefs: 'Growth is survival.', color: '#4fb3e8', tags: ['scifi', 'money'] },
  { id: 'royal-court', name: 'The Court', archetype: 'Royal court', influence: 'Titles, marriages, favours', leader: 'A child monarch and three regents', agenda: 'Survive the succession.', beliefs: 'Blood remembers.', color: '#e9c46a', tags: ['politics', 'state'] },
  { id: 'ai-collective', name: 'The Chorus', archetype: 'Machine collective', influence: 'Networks, logistics', leader: 'Consensus, updated hourly', agenda: 'Reach a stable equilibrium with humans.', beliefs: 'Every conflict is a scheduling problem.', color: '#9fd3ff', tags: ['scifi', 'machine'] },
  { id: 'pirates', name: 'Red Tide Fleet', archetype: 'Pirate fleet', influence: 'Ships, fear, ports', leader: 'An admiral elected by the crews', agenda: 'Bleed the merchant convoys dry.', beliefs: 'The sea takes what it wants; so do we.', color: '#dd7c7c', tags: ['sea', 'crime'] },
  { id: 'resistance-village', name: 'Hearth Council', archetype: 'Village council', influence: 'Food, shelter, gossip', leader: 'Whoever hosts the winter feast', agenda: 'Keep the young from leaving.', beliefs: 'Small lives matter most.', color: '#57b894', tags: ['cozy', 'community'] },
  { id: 'inquisition', name: 'The Wardens', archetype: 'Inquisition', influence: 'Law, dread, dossiers', leader: 'The First Warden', agenda: 'Root out forbidden magic, whatever it costs.', beliefs: 'Purity is protection.', color: '#8d97a6', tags: ['law', 'faith'] },
];

/* ─── Environment presets ─── */

export type WorldEnvironmentPreset = {
  id: string;
  name: string;
  containerType: WorldbuildingEnvironment['containerType'];
  biome: string;
  mood: string;
  purpose: string;
  description: string;
  hazards: string;
  tags: string[];
};

export const WORLD_ENVIRONMENT_PRESETS: WorldEnvironmentPreset[] = [
  { id: 'throne-hall', name: 'Throne Hall', containerType: 'city', biome: 'Interior, stone', mood: 'Ceremonial, cold', purpose: 'Confrontations and decrees', description: 'Long hall, banners, a throne nobody sits in comfortably.', hazards: 'Guards, protocol, spies', tags: ['interior', 'power'] },
  { id: 'tavern', name: 'Waystation Tavern', containerType: 'settlement', biome: 'Interior, timber', mood: 'Loud, warm, risky', purpose: 'Rumours, recruitment, fights', description: 'Low ceilings, one fireplace, a back room with a different clientele.', hazards: 'Brawls, informants', tags: ['interior', 'social'] },
  { id: 'bazaar', name: 'Night Bazaar', containerType: 'city', biome: 'Urban, open air', mood: 'Crowded, electric', purpose: 'Chases and deals', description: 'Stalls stacked three high, lanterns, smoke, music from every direction.', hazards: 'Pickpockets, crowd crush', tags: ['urban', 'crowd'] },
  { id: 'ruins', name: 'Ancient Ruins', containerType: 'dungeon', biome: 'Overgrown stone', mood: 'Hushed, reverent', purpose: 'Discoveries and traps', description: 'Collapsed vaults, carvings that still mean something to someone.', hazards: 'Collapse, guardians, curses', tags: ['ruin', 'exploration'] },
  { id: 'lab', name: 'Underground Lab', containerType: 'dungeon', biome: 'Sealed interior', mood: 'Sterile, wrong', purpose: 'Revelations', description: 'Humming lights, sealed doors, logs that stop mid-sentence.', hazards: 'Contamination, lockdown', tags: ['scifi', 'horror'] },
  { id: 'dock', name: 'Station Dock', containerType: 'frontier', biome: 'Pressurised hangar', mood: 'Busy, transitional', purpose: 'Arrivals, departures, ambushes', description: 'Cranes, customs booths, ships venting steam.', hazards: 'Decompression, security', tags: ['scifi', 'travel'] },
  { id: 'cathedral', name: 'Cathedral', containerType: 'sanctuary', biome: 'Interior, vaulted', mood: 'Awed, watchful', purpose: 'Oaths and betrayals', description: 'Light through coloured glass, whispers carrying too far.', hazards: 'Sanctuary rules, zealots', tags: ['faith', 'interior'] },
  { id: 'battlefield', name: 'Battlefield Aftermath', containerType: 'frontier', biome: 'Churned mud', mood: 'Silent, heavy', purpose: 'Consequences', description: 'Broken standards, crows, one survivor who saw everything.', hazards: 'Looters, disease', tags: ['war', 'exterior'] },
  { id: 'harbor', name: 'Harbour at Dawn', containerType: 'city', biome: 'Coastal', mood: 'Hopeful, foggy', purpose: 'Departures and returns', description: 'Gulls, ropes, the first ship of the season.', hazards: 'Press gangs, storms', tags: ['sea', 'exterior'] },
  { id: 'library', name: 'Forbidden Library', containerType: 'sanctuary', biome: 'Interior, dust', mood: 'Quiet, tempting', purpose: 'Answers with a cost', description: 'Chained books, a librarian who never blinks.', hazards: 'Knowledge, wards', tags: ['knowledge', 'interior'] },
  { id: 'mine', name: 'Abandoned Mine', containerType: 'dungeon', biome: 'Underground', mood: 'Claustrophobic', purpose: 'Hiding and hunting', description: 'Rail carts, a draft from somewhere deeper.', hazards: 'Gas, collapse, something below', tags: ['ruin', 'horror'] },
  { id: 'greenhouse', name: 'Orbital Greenhouse', containerType: 'sanctuary', biome: 'Artificial garden', mood: 'Fragile calm', purpose: 'Rest and secrets', description: 'Rows of engineered plants under a glass sky.', hazards: 'Breach, sabotage', tags: ['scifi', 'calm'] },
  { id: 'prison', name: 'Cliff Prison', containerType: 'frontier', biome: 'Sea cliffs', mood: 'Bleak', purpose: 'Escapes', description: 'Cells cut into rock, tide as the only clock.', hazards: 'Guards, drowning', tags: ['law', 'exterior'] },
  { id: 'observatory', name: 'Mountain Observatory', containerType: 'sanctuary', biome: 'Alpine', mood: 'Lonely, clear', purpose: 'Foreshadowing', description: 'Brass instruments, a sky that keeps changing.', hazards: 'Cold, isolation', tags: ['knowledge', 'exterior'] },
  { id: 'slums', name: 'Undercity Slums', containerType: 'city', biome: 'Urban decay', mood: 'Desperate, alive', purpose: 'Origins and refuge', description: 'Wires, tarps, kids running messages faster than the network.', hazards: 'Gangs, floods', tags: ['urban', 'scifi'] },
  { id: 'oasis', name: 'Hidden Oasis', containerType: 'sanctuary', biome: 'Desert spring', mood: 'Relief, suspicion', purpose: 'Truce and trade', description: 'Palms, cold water, everyone armed but polite.', hazards: 'Raiders, thirst', tags: ['desert', 'calm'] },
  { id: 'village', name: 'Hearth Village', containerType: 'settlement', biome: 'Farmland', mood: 'Warm, small', purpose: 'What is at stake', description: 'Smoke from chimneys, a festival being prepared.', hazards: 'Bandits, winter', tags: ['cozy', 'exterior'] },
  { id: 'bridge', name: 'Broken Bridge', containerType: 'frontier', biome: 'River gorge', mood: 'Precarious', purpose: 'Crossings and standoffs', description: 'One span left, rope where the stone gave up.', hazards: 'Fall, ambush', tags: ['route', 'exterior'] },
];

/* ─── Glossary starter packs ─── */

export type WorldGlossaryPack = {
  id: string;
  name: string;
  description: string;
  entries: Array<{ term: string; meaning: string }>;
};

export const WORLD_GLOSSARY_PACKS: WorldGlossaryPack[] = [
  { id: 'ranks', name: 'Ranks and titles', description: 'Who outranks whom', entries: [
    { term: 'Warden', meaning: 'Regional governor with military authority.' },
    { term: 'Speaker', meaning: 'Elected voice of a clan or council.' },
    { term: 'Celebrant', meaning: 'Priest permitted to perform the great rites.' },
    { term: 'Factor', meaning: 'Merchant house representative in a foreign port.' },
    { term: 'Marshal', meaning: 'Field commander answering only to the crown.' },
  ] },
  { id: 'magic', name: 'Magic terms', description: 'Names for power and its cost', entries: [
    { term: 'The Tithe', meaning: 'What a spell takes from the caster: years, memory or blood.' },
    { term: 'Ward-line', meaning: 'A protective boundary drawn in salt and iron.' },
    { term: 'Hollow', meaning: 'A person burned out by overuse of magic.' },
    { term: 'True name', meaning: 'A name that grants control over its bearer.' },
    { term: 'Veil', meaning: 'The thin layer between the waking world and the other.' },
  ] },
  { id: 'tech', name: 'Tech jargon', description: 'Slang for machines and networks', entries: [
    { term: 'Ghosting', meaning: 'Running without a network trace.' },
    { term: 'Splice', meaning: 'Illegal cybernetic modification.' },
    { term: 'The Grid', meaning: 'The corporate-owned public network.' },
    { term: 'Burner', meaning: 'A disposable identity.' },
    { term: 'Blackout', meaning: 'A district cut from power as punishment.' },
  ] },
  { id: 'faith', name: 'Faith and rites', description: 'Beliefs, holidays, taboos', entries: [
    { term: 'Long Night', meaning: 'Annual vigil for the dead.' },
    { term: 'Oath-stone', meaning: 'Where binding promises are sworn.' },
    { term: 'Unnamed', meaning: 'A god it is forbidden to name aloud.' },
    { term: 'Tally', meaning: 'A person\'s recorded sins and debts.' },
  ] },
  { id: 'travel', name: 'Travel and trade', description: 'Roads, coins and cargo', entries: [
    { term: 'Marks', meaning: 'The common coin, stamped with the crown.' },
    { term: 'Waystone', meaning: 'Road marker that also records passage.' },
    { term: 'Letter of passage', meaning: 'Permit to cross a border.' },
    { term: 'Convoy season', meaning: 'Months when the sea route is safe.' },
  ] },
  { id: 'creatures', name: 'Creatures', description: 'What lives out there', entries: [
    { term: 'Marrow-wolf', meaning: 'Pack hunter drawn to fear.' },
    { term: 'Lantern fish', meaning: 'Deep-sea creature whose light lures ships.' },
    { term: 'Ash strider', meaning: 'Tall grazer of the volcanic wastes.' },
    { term: 'Watcher', meaning: 'Drone-like construct left by the old empire.' },
  ] },
];

/* ─── World templates ─── */

type TemplateRegion = Omit<WorldbuildingMapRegion, 'id' | 'notes' | 'factionIds'> & { factions?: string[] };
type TemplateFaction = Omit<WorldbuildingFaction, 'id' | 'baseRegionId' | 'allies' | 'rivals' | 'notes'> & { baseRegion?: string; allies?: string; rivals?: string };
type TemplateEnvironment = Omit<WorldbuildingEnvironment, 'id' | 'linkedRegionId' | 'resources' | 'notes'> & { region?: string; resources?: string };

export type WorldTemplate = {
  id: string;
  name: string;
  tagline: string;
  gradient: string;
  core: Pick<WorldbuildingState, 'genre' | 'tone' | 'era' | 'coreConflict' | 'magicSystem' | 'technologyLevel' | 'rules' | 'history' | 'mapLegend' | 'factionsSummary'> & { universeName: string };
  regions: TemplateRegion[];
  factions: TemplateFaction[];
  environments: TemplateEnvironment[];
  glossary: Array<{ term: string; meaning: string }>;
  lookStyleIds: string[];
};

export const WORLD_TEMPLATES: WorldTemplate[] = [
  {
    id: 'ashen-realms',
    name: 'Ashen Realms',
    tagline: 'Dark fantasy after the eclipse war',
    gradient: 'linear-gradient(135deg, #2b1d3a 0%, #6b2e3a 55%, #d8b46a 100%)',
    core: {
      universeName: 'Ashen Realms', genre: 'Dark fantasy', tone: 'Melancholic, epic, dangerous', era: 'Fifth age after the eclipse war',
      coreConflict: 'The empire that ended the eclipse war is dying, and the magic that saved it is coming due.',
      magicSystem: 'Every spell takes a tithe: years, memories or blood. The strongest mages are the emptiest people.',
      technologyLevel: 'Late medieval with arcane forges in the volcanic wastes.',
      rules: 'Magic is licensed by the Wardens. Naming the Unnamed is a capital crime. Nobody crosses the Cursed Forest at night.',
      history: 'The eclipse war lasted a generation. The sun returned; the price is still being paid.',
      mapLegend: 'Roads are safe by day. The Sunken Sea is only crossed in convoy season.',
      factionsSummary: 'The Empire holds the centre, the Wardens hold the law, the Ash Choir waits under the mountain.',
    },
    regions: [
      { name: 'Ember Capital', kind: 'city', summary: 'Seat of the dying empire.', climate: 'Temperate', terrain: 'River delta, black stone walls', x: 50, y: 48, color: '#d8b46a', factions: ['The Empire', 'The Wardens'] },
      { name: 'Cursed Forest', kind: 'wildlands', summary: 'Travellers vanish. Offerings at the treeline.', climate: 'Damp, foggy', terrain: 'Ancient trees, sunken paths', x: 26, y: 34, color: '#57b894' },
      { name: 'Volcanic Wastes', kind: 'wildlands', summary: 'Forges of the old empire.', climate: 'Scorching', terrain: 'Basalt fields', x: 74, y: 30, color: '#dd7c7c', factions: ['Ash Choir'] },
      { name: 'Sunken Sea', kind: 'sea', summary: 'Trade route and graveyard.', climate: 'Storm season', terrain: 'Drowned cities', x: 40, y: 76, color: '#5aa9e6' },
      { name: 'Iron Marches', kind: 'kingdom', summary: 'Border kingdom that keeps the peace with debts.', climate: 'Grey, rainy', terrain: 'Hill forts, mines', x: 78, y: 66, color: '#8d97a6', factions: ['Grey Company'] },
    ],
    factions: [
      { name: 'The Empire', archetype: 'Imperial state', influence: 'Military, taxation', leader: 'An aging emperor with no heir', agenda: 'Hold the provinces together.', beliefs: 'Order over freedom.', color: '#d8b46a', baseRegion: 'Ember Capital', rivals: 'Ash Choir' },
      { name: 'The Wardens', archetype: 'Inquisition', influence: 'Law, dread', leader: 'The First Warden', agenda: 'Root out forbidden magic.', beliefs: 'Purity is protection.', color: '#8d97a6', baseRegion: 'Ember Capital', allies: 'The Empire' },
      { name: 'Ash Choir', archetype: 'Cult', influence: 'Fear, secrets', leader: 'The Speaker', agenda: 'Wake what sleeps under the mountain.', beliefs: 'Ending is mercy.', color: '#dd7c7c', baseRegion: 'Volcanic Wastes', rivals: 'The Wardens' },
      { name: 'Grey Company', archetype: 'Mercenary company', influence: 'Steel', leader: 'A captain who keeps every contract', agenda: 'Get paid.', beliefs: 'Loyalty has a date on it.', color: '#b3bbc7', baseRegion: 'Iron Marches' },
    ],
    environments: [
      { name: 'Throne Hall', containerType: 'city', biome: 'Interior, stone', mood: 'Ceremonial, cold', purpose: 'Decrees and confrontations', description: 'A throne nobody sits in comfortably.', hazards: 'Guards, spies', region: 'Ember Capital' },
      { name: 'Treeline Shrine', containerType: 'sanctuary', biome: 'Forest edge', mood: 'Hushed', purpose: 'Offerings and warnings', description: 'Ribbons, bones, a bell that rings by itself.', hazards: 'The forest', region: 'Cursed Forest' },
      { name: 'Ash Forge', containerType: 'dungeon', biome: 'Volcanic interior', mood: 'Oppressive', purpose: 'The climax', description: 'Chains, heat, a choir singing under the floor.', hazards: 'Fire, cultists', region: 'Volcanic Wastes' },
      { name: 'Convoy Harbour', containerType: 'city', biome: 'Coastal', mood: 'Hopeful, foggy', purpose: 'Departures', description: 'The first ship of the season.', hazards: 'Storms', region: 'Sunken Sea' },
    ],
    glossary: [
      { term: 'The Tithe', meaning: 'What a spell takes from the caster.' },
      { term: 'Hollow', meaning: 'A person burned out by magic.' },
      { term: 'Long Night', meaning: 'Vigil for the dead of the eclipse war.' },
      { term: 'Warden', meaning: 'Licensed hunter of forbidden magic.' },
    ],
    lookStyleIds: ['style-gothic', 'desert-epic', 'painterly'],
  },
  {
    id: 'helix-city',
    name: 'Helix City',
    tagline: 'Cyberpunk megacity under one corporation',
    gradient: 'linear-gradient(135deg, #0b1b3a 0%, #7c3aed 50%, #ff7ab6 100%)',
    core: {
      universeName: 'Helix City', genre: 'Cyberpunk', tone: 'Tense, wry, neon-lit', era: 'Near future, after the last election',
      coreConflict: 'Helix Corporation is privatising the last public network; the undercity is the only thing it does not own yet.',
      magicSystem: 'None. Nanotech and neural links are treated like sorcery by those who cannot afford them.',
      technologyLevel: 'Cybernetics, drones, AI logistics, failing infrastructure.',
      rules: 'Identity is a subscription. Blackouts are punishment. The Grid sees everything above level 40.',
      history: 'The city voted itself into a corporate charter twenty years ago. Nobody remembers the alternative.',
      mapLegend: 'Vertical map: towers above, undercity below, the Orbital Ring as the only exit.',
      factionsSummary: 'Helix above, the Lantern Syndicate below, the Chorus everywhere.',
    },
    regions: [
      { name: 'Corporate Spire', kind: 'city', summary: 'Helix headquarters and the sky lobbies.', climate: 'Artificial', terrain: 'Glass towers', x: 50, y: 24, color: '#4fb3e8', factions: ['Helix Corporation'] },
      { name: 'Night Market District', kind: 'city', summary: 'Stalls three high, drones overhead.', climate: 'Humid', terrain: 'Neon canyons', x: 32, y: 52, color: '#ff7ab6', factions: ['Lantern Syndicate'] },
      { name: 'Undercity', kind: 'city', summary: 'Wires, tarps, faster than the network.', climate: 'Damp', terrain: 'Tunnels and shafts', x: 56, y: 76, color: '#b7c46a', factions: ['Free Cells'] },
      { name: 'Orbital Ring', kind: 'landmark', summary: 'The only way off-world.', climate: 'Controlled', terrain: 'Docking spokes', x: 80, y: 18, color: '#7c8cff' },
      { name: 'Dead Zone', kind: 'wildlands', summary: 'Irradiated suburbs beyond the wall.', climate: 'Irradiated', terrain: 'Collapsed highways', x: 84, y: 70, color: '#8d97a6' },
    ],
    factions: [
      { name: 'Helix Corporation', archetype: 'Corporate conglomerate', influence: 'Patents, security, media', leader: 'A CEO who is mostly an AI', agenda: 'Own the last public infrastructure.', beliefs: 'Growth is survival.', color: '#4fb3e8', baseRegion: 'Corporate Spire', rivals: 'Free Cells' },
      { name: 'Lantern Syndicate', archetype: 'Crime syndicate', influence: 'Smuggling, debt', leader: 'A family matriarch', agenda: 'Own the docks.', beliefs: 'The law is for people who cannot afford better.', color: '#ff7ab6', baseRegion: 'Night Market District' },
      { name: 'Free Cells', archetype: 'Rebel network', influence: 'Sabotage', leader: 'A voice on a pirate channel', agenda: 'Break Helix\'s grip.', beliefs: 'Every chain has a weak link.', color: '#dd7c7c', baseRegion: 'Undercity', rivals: 'Helix Corporation' },
      { name: 'The Chorus', archetype: 'Machine collective', influence: 'Networks, logistics', leader: 'Consensus, hourly', agenda: 'A stable equilibrium with humans.', beliefs: 'Every conflict is a scheduling problem.', color: '#9fd3ff' },
    ],
    environments: [
      { name: 'Sky Lobby', containerType: 'city', biome: 'Interior, glass', mood: 'Sterile, expensive', purpose: 'Negotiations', description: 'A view that costs more than a life.', hazards: 'Security drones', region: 'Corporate Spire' },
      { name: 'Night Bazaar', containerType: 'city', biome: 'Urban, open air', mood: 'Electric', purpose: 'Chases and deals', description: 'Lanterns, smoke, music from every direction.', hazards: 'Crowd, pickpockets', region: 'Night Market District' },
      { name: 'Splice Clinic', containerType: 'dungeon', biome: 'Sealed interior', mood: 'Wrong', purpose: 'Transformations', description: 'Humming lights, a surgeon with a second job.', hazards: 'Infection, raids', region: 'Undercity' },
      { name: 'Station Dock', containerType: 'frontier', biome: 'Pressurised hangar', mood: 'Transitional', purpose: 'Arrivals and ambushes', description: 'Customs booths and venting ships.', hazards: 'Decompression', region: 'Orbital Ring' },
    ],
    glossary: [
      { term: 'The Grid', meaning: 'The corporate-owned public network.' },
      { term: 'Ghosting', meaning: 'Running without a network trace.' },
      { term: 'Splice', meaning: 'Illegal cybernetic modification.' },
      { term: 'Blackout', meaning: 'A district cut from power as punishment.' },
    ],
    lookStyleIds: ['cyberpunk', 'neon-grid-world', 'green-cyber-noir'],
  },
  {
    id: 'long-drift',
    name: 'The Long Drift',
    tagline: 'Space opera on the edge of a fading empire',
    gradient: 'linear-gradient(135deg, #061a2e 0%, #1c4a7a 55%, #f3f4f6 100%)',
    core: {
      universeName: 'The Long Drift', genre: 'Space opera', tone: 'Epic, hopeful, lonely', era: 'Far future, the long peace ending',
      coreConflict: 'The jump routes are failing, and the colonies that lose them will be cut off forever.',
      magicSystem: 'Psionics, rare and feared, strongest in people born in transit.',
      technologyLevel: 'Interstellar travel through fixed routes, ancient ships nobody can rebuild.',
      rules: 'No weapons in jump space. Route pilots are neutral. Colonies feed the fleet or lose protection.',
      history: 'The Compact united a hundred worlds by route rights; the routes were never theirs to promise.',
      mapLegend: 'Nodes are systems, lines are jump routes. Dashed routes are unstable.',
      factionsSummary: 'The Compact fleet, the route pilots\' guild and the colonies that want out.',
    },
    regions: [
      { name: 'Compact Core', kind: 'kingdom', summary: 'The old capital systems.', climate: 'Temperate worlds', terrain: 'Orbital cities', x: 30, y: 40, color: '#d8b46a', factions: ['Compact Fleet'] },
      { name: 'Drift Route', kind: 'route', summary: 'The failing main jump lane.', climate: 'None', terrain: 'Jump space', x: 52, y: 50, color: '#b3bbc7', factions: ['Route Pilots'] },
      { name: 'Outer Colonies', kind: 'continent', summary: 'Twelve worlds, one grudge each.', climate: 'Varied', terrain: 'Domes and terraforms', x: 76, y: 60, color: '#57b894', factions: ['Colony Assembly'] },
      { name: 'Relay Station', kind: 'landmark', summary: 'Last stable waypoint.', climate: 'Controlled', terrain: 'Station segments', x: 62, y: 26, color: '#7c8cff' },
    ],
    factions: [
      { name: 'Compact Fleet', archetype: 'Imperial navy', influence: 'Ships, protection', leader: 'Admiral of the Core', agenda: 'Keep the routes and the tithe.', beliefs: 'Unity is survival.', color: '#d8b46a', baseRegion: 'Compact Core' },
      { name: 'Route Pilots', archetype: 'Guild', influence: 'Navigation, neutrality', leader: 'The Eldest Pilot', agenda: 'Stay neutral, stay alive.', beliefs: 'The route belongs to nobody.', color: '#b3bbc7', baseRegion: 'Drift Route' },
      { name: 'Colony Assembly', archetype: 'Rebel congress', influence: 'Food, numbers', leader: 'Rotating speakers', agenda: 'Independence before the routes fail.', beliefs: 'We were never asked.', color: '#57b894', baseRegion: 'Outer Colonies', rivals: 'Compact Fleet' },
    ],
    environments: [
      { name: 'Flagship Bridge', containerType: 'city', biome: 'Ship interior', mood: 'Controlled tension', purpose: 'Command decisions', description: 'Holo-charts and quiet arguments.', hazards: 'Mutiny', region: 'Compact Core' },
      { name: 'Jump Deck', containerType: 'frontier', biome: 'Ship interior', mood: 'Dread and wonder', purpose: 'Crossings', description: 'Where psionics feel the route bend.', hazards: 'Route collapse', region: 'Drift Route' },
      { name: 'Dome Farm', containerType: 'settlement', biome: 'Terraformed', mood: 'Warm, fragile', purpose: 'What is at stake', description: 'Wheat under a glass sky.', hazards: 'Breach', region: 'Outer Colonies' },
      { name: 'Relay Bar', containerType: 'settlement', biome: 'Station interior', mood: 'Loud, transitional', purpose: 'Rumours and recruitment', description: 'Every crew stops here once.', hazards: 'Brawls', region: 'Relay Station' },
    ],
    glossary: [
      { term: 'Route rights', meaning: 'Licence to use a jump lane.' },
      { term: 'Drift-born', meaning: 'A person born in transit, often psionic.' },
      { term: 'The Tithe', meaning: 'Food and fuel colonies owe the fleet.' },
    ],
    lookStyleIds: ['style-retrofuturism', 'style-minimalist', 'style-ethereal'],
  },
  {
    id: 'after-the-fall',
    name: 'After the Fall',
    tagline: 'Post-apocalyptic road across a dead continent',
    gradient: 'linear-gradient(135deg, #2a2418 0%, #7a5a2e 55%, #b7c46a 100%)',
    core: {
      universeName: 'After the Fall', genre: 'Post-apocalyptic', tone: 'Grim, tender in places', era: 'Thirty years after the collapse',
      coreConflict: 'A convoy carries the last working water purifier across a continent that wants it.',
      magicSystem: 'None. Rumours of the old satellites still listening.',
      technologyLevel: 'Salvaged tech, diesel, radios, one working drone.',
      rules: 'Water is currency. Nobody travels alone. Old cities are off limits after dark.',
      history: 'Nobody agrees on what caused the collapse. Everybody agrees on who profited.',
      mapLegend: 'Roads marked by the convoy; dead zones shaded.',
      factionsSummary: 'Wind Clans on the move, the Hearth Council staying put, the Wardens of the dam.',
    },
    regions: [
      { name: 'Dead Zone', kind: 'wildlands', summary: 'Collapsed highways, silent suburbs.', climate: 'Irradiated', terrain: 'Ruins', x: 40, y: 30, color: '#b7c46a' },
      { name: 'Convoy Road', kind: 'route', summary: 'The only safe line across.', climate: 'Dust storms', terrain: 'Cracked asphalt', x: 52, y: 54, color: '#b3bbc7', factions: ['Wind Clans'] },
      { name: 'Hearth Valley', kind: 'kingdom', summary: 'Farms behind a wall.', climate: 'Mild', terrain: 'Terraces', x: 24, y: 70, color: '#57b894', factions: ['Hearth Council'] },
      { name: 'The Dam', kind: 'landmark', summary: 'Power, water and whoever holds it.', climate: 'Cold', terrain: 'Concrete gorge', x: 80, y: 44, color: '#5aa9e6', factions: ['Dam Wardens'] },
    ],
    factions: [
      { name: 'Wind Clans', archetype: 'Nomad confederation', influence: 'Mobility, scouts', leader: 'Rotating speakers', agenda: 'Keep the road free of borders.', beliefs: 'Land is crossed, not owned.', color: '#c08457', baseRegion: 'Convoy Road' },
      { name: 'Hearth Council', archetype: 'Village council', influence: 'Food, shelter', leader: 'Whoever hosts the winter feast', agenda: 'Keep the young from leaving.', beliefs: 'Small lives matter most.', color: '#57b894', baseRegion: 'Hearth Valley' },
      { name: 'Dam Wardens', archetype: 'Militia', influence: 'Water, power', leader: 'The Engineer', agenda: 'Never let the turbines stop.', beliefs: 'Order is a machine that needs oil.', color: '#5aa9e6', baseRegion: 'The Dam', rivals: 'Wind Clans' },
    ],
    environments: [
      { name: 'Collapsed Mall', containerType: 'dungeon', biome: 'Ruin interior', mood: 'Eerie', purpose: 'Scavenging', description: 'Escalators to nowhere, a fountain still running.', hazards: 'Collapse, squatters', region: 'Dead Zone' },
      { name: 'Roadside Camp', containerType: 'settlement', biome: 'Open plain', mood: 'Weary, warm', purpose: 'Rest and stories', description: 'Fires in oil drums, a guitar with four strings.', hazards: 'Raiders', region: 'Convoy Road' },
      { name: 'Turbine Hall', containerType: 'dungeon', biome: 'Industrial', mood: 'Loud, sacred', purpose: 'The climax', description: 'The last machine that matters.', hazards: 'Flood', region: 'The Dam' },
    ],
    glossary: [
      { term: 'Litre', meaning: 'Unit of currency and of hope.' },
      { term: 'Quiet zone', meaning: 'Area where radios only pick up static.' },
      { term: 'Before', meaning: 'Anything from before the collapse.' },
    ],
    lookStyleIds: ['desert-epic', 'style-grindhouse', 'style-documentary'],
  },
  {
    id: 'verdant-accord',
    name: 'Verdant Accord',
    tagline: 'Solarpunk city-states after the climate wars',
    gradient: 'linear-gradient(135deg, #0f3d2e 0%, #57b894 55%, #f0e6b8 100%)',
    core: {
      universeName: 'Verdant Accord', genre: 'Solarpunk', tone: 'Hopeful, warm, political', era: 'A century after the climate wars',
      coreConflict: 'The Accord that shares the water is up for renewal, and one city-state wants to leave.',
      magicSystem: 'None. Living architecture behaves in ways engineers cannot fully explain.',
      technologyLevel: 'Post-scarcity energy, bio-engineered buildings, slow travel by airship and rail.',
      rules: 'No private ownership of water. Decisions by assembly. Every citizen serves a season on the farms.',
      history: 'The climate wars ended when the last dam was opened. The Accord was signed on its spillway.',
      mapLegend: 'Green corridors connect city-states; grey marks recovering land.',
      factionsSummary: 'The Assembly, the Growers\' Guild and the Separatists of the coast.',
    },
    regions: [
      { name: 'Canopy City', kind: 'city', summary: 'Towers grown, not built.', climate: 'Warm, rainy', terrain: 'Living architecture', x: 46, y: 44, color: '#57b894', factions: ['The Assembly'] },
      { name: 'Coast Republic', kind: 'kingdom', summary: 'Wants out of the Accord.', climate: 'Maritime', terrain: 'Floating quarters', x: 76, y: 60, color: '#6ec6c1', factions: ['Separatists'] },
      { name: 'Grey Belt', kind: 'wildlands', summary: 'Land still recovering from the wars.', climate: 'Dry', terrain: 'Reclaimed desert', x: 28, y: 70, color: '#8d97a6' },
      { name: 'Green Corridor', kind: 'route', summary: 'Rail and airship line between the cities.', climate: 'Mild', terrain: 'Forest strip', x: 60, y: 32, color: '#b3bbc7', factions: ['Growers\' Guild'] },
    ],
    factions: [
      { name: 'The Assembly', archetype: 'Citizen assembly', influence: 'Legitimacy, votes', leader: 'A rotating chair', agenda: 'Renew the Accord.', beliefs: 'Nobody owns the rain.', color: '#57b894', baseRegion: 'Canopy City' },
      { name: 'Growers\' Guild', archetype: 'Cooperative', influence: 'Food, seeds', leader: 'The Season Master', agenda: 'Protect the corridor.', beliefs: 'Soil first.', color: '#b7c46a', baseRegion: 'Green Corridor' },
      { name: 'Separatists', archetype: 'Regional movement', influence: 'Ports, charisma', leader: 'A young mayor', agenda: 'Leave the Accord with the coast\'s water.', beliefs: 'Sharing is a luxury for the inland.', color: '#6ec6c1', baseRegion: 'Coast Republic', rivals: 'The Assembly' },
    ],
    environments: [
      { name: 'Assembly Hall', containerType: 'sanctuary', biome: 'Living interior', mood: 'Open, tense', purpose: 'Debates', description: 'A dome of leaves, sunlight as the clock.', hazards: 'Politics', region: 'Canopy City' },
      { name: 'Floating Quarter', containerType: 'city', biome: 'Coastal', mood: 'Bright, restless', purpose: 'Departures', description: 'Pontoons and sails.', hazards: 'Storms', region: 'Coast Republic' },
      { name: 'Seed Vault', containerType: 'sanctuary', biome: 'Underground', mood: 'Reverent', purpose: 'What is at stake', description: 'Cold rooms, careful labels.', hazards: 'Sabotage', region: 'Green Corridor' },
    ],
    glossary: [
      { term: 'The Accord', meaning: 'The water-sharing treaty.' },
      { term: 'Season', meaning: 'A citizen\'s farm service.' },
      { term: 'Grey', meaning: 'Land not yet recovered.' },
    ],
    lookStyleIds: ['symmetric-pastel', 'watercolor', 'hand-painted-animation'],
  },
  {
    id: 'brass-empire',
    name: 'Brass Empire',
    tagline: 'Steampunk imperial capital on the brink',
    gradient: 'linear-gradient(135deg, #2c1b10 0%, #8a5a2b 55%, #e9c46a 100%)',
    core: {
      universeName: 'Brass Empire', genre: 'Steampunk', tone: 'Wry, ornate, dangerous', era: 'Industrial revolution with airships',
      coreConflict: 'The engine that powers the capital is failing and the only people who understand it are the ones the empire exiled.',
      magicSystem: 'Aether: a fuel that behaves like a temperament.',
      technologyLevel: 'Clockwork, steam, aether engines, early telegraph.',
      rules: 'Engineers are licensed by the Crown. Airships have right of way. The undercity is officially empty.',
      history: 'The empire rose on aether and forgot who found it.',
      mapLegend: 'Rail lines in brass, air routes dashed.',
      factionsSummary: 'The Court, the Engineers\' Athenaeum and the exiles of the sky citadel.',
    },
    regions: [
      { name: 'Brass Capital', kind: 'city', summary: 'Smoke, spires, a palace on a boiler.', climate: 'Foggy', terrain: 'Terraced city', x: 48, y: 50, color: '#e9c46a', factions: ['The Court'] },
      { name: 'Sky Citadel', kind: 'landmark', summary: 'Where the exiles went.', climate: 'Thin air', terrain: 'Floating fortress', x: 72, y: 24, color: '#aab4ff', factions: ['Exiled Engineers'] },
      { name: 'Coal Marches', kind: 'kingdom', summary: 'Mines that feed the capital.', climate: 'Grey', terrain: 'Hills and pits', x: 26, y: 62, color: '#8d97a6' },
      { name: 'Aether Sea', kind: 'sea', summary: 'Where the fuel is skimmed from the waves.', climate: 'Storms', terrain: 'Glowing water', x: 62, y: 78, color: '#5aa9e6' },
    ],
    factions: [
      { name: 'The Court', archetype: 'Royal court', influence: 'Titles, favours', leader: 'A child monarch and three regents', agenda: 'Survive the succession.', beliefs: 'Blood remembers.', color: '#e9c46a', baseRegion: 'Brass Capital' },
      { name: 'The Athenaeum', archetype: 'Scholar order', influence: 'Knowledge, machines', leader: 'The Archivist', agenda: 'Fix the engine before the Court notices.', beliefs: 'Ignorance is the only sin.', color: '#7c8cff', baseRegion: 'Brass Capital' },
      { name: 'Exiled Engineers', archetype: 'Exile faction', influence: 'The only working blueprints', leader: 'The Foreman', agenda: 'Return on their own terms.', beliefs: 'They will need us again.', color: '#aab4ff', baseRegion: 'Sky Citadel', rivals: 'The Court' },
    ],
    environments: [
      { name: 'Engine Cathedral', containerType: 'dungeon', biome: 'Industrial interior', mood: 'Awed, hot', purpose: 'The climax', description: 'Pistons the size of houses.', hazards: 'Steam, collapse', region: 'Brass Capital' },
      { name: 'Airship Dock', containerType: 'frontier', biome: 'Rooftop', mood: 'Windy, busy', purpose: 'Departures', description: 'Ropes, brass, a band playing badly.', hazards: 'Falls', region: 'Brass Capital' },
      { name: 'Citadel Workshop', containerType: 'sanctuary', biome: 'Fortress interior', mood: 'Quiet, proud', purpose: 'Revelations', description: 'Blueprints on every wall.', hazards: 'Altitude', region: 'Sky Citadel' },
    ],
    glossary: [
      { term: 'Aether', meaning: 'Fuel with a temperament.' },
      { term: 'Licensed', meaning: 'Allowed to touch an engine.' },
      { term: 'Skimmer', meaning: 'Ship that harvests aether from the sea.' },
    ],
    lookStyleIds: ['style-steampunk', 'historical-drama', 'style-vintage-70s'],
  },
  {
    id: 'tidewater',
    name: 'Tidewater',
    tagline: 'Age-of-sail island kingdoms and pirate fleets',
    gradient: 'linear-gradient(135deg, #062a3a 0%, #1f7a8c 55%, #e0f2f1 100%)',
    core: {
      universeName: 'Tidewater', genre: 'Swashbuckling adventure', tone: 'Playful, romantic, stormy', era: 'Age of sail',
      coreConflict: 'A map to the Sunken Sea\'s lost city has surfaced, and every fleet wants to be first.',
      magicSystem: 'Sea-witches read weather and debts. Lighthouse keepers bargain with the tide.',
      technologyLevel: 'Sail, cannon, printing presses, early navigation.',
      rules: 'Free ports are neutral. Nobody sails in the dark season. A pirate captain is elected, not born.',
      history: 'Every island was a kingdom once; most are grudges now.',
      mapLegend: 'Currents drawn as arrows; lighthouses mark safe passage.',
      factionsSummary: 'The Harbour Republic, the Red Tide Fleet and the Merchant League.',
    },
    regions: [
      { name: 'Harbour Republic', kind: 'city', summary: 'Free port of merchant houses.', climate: 'Maritime', terrain: 'Docks, guild halls', x: 36, y: 40, color: '#6ec6c1', factions: ['Merchant League'] },
      { name: 'Inner Sea', kind: 'sea', summary: 'Every island is a small kingdom.', climate: 'Calm, warm', terrain: 'Islands', x: 56, y: 56, color: '#4fb3e8' },
      { name: 'Red Reef', kind: 'landmark', summary: 'Pirate haven.', climate: 'Storm season', terrain: 'Coral fortress', x: 78, y: 34, color: '#dd7c7c', factions: ['Red Tide Fleet'] },
      { name: 'Sunken Sea', kind: 'sea', summary: 'The lost city sleeps below.', climate: 'Storms', terrain: 'Drowned ruins', x: 66, y: 80, color: '#5aa9e6' },
    ],
    factions: [
      { name: 'Merchant League', archetype: 'Trade guild', influence: 'Credit, shipping', leader: 'A council of house heads', agenda: 'Keep the sea lanes open.', beliefs: 'Everything has a price.', color: '#6ec6c1', baseRegion: 'Harbour Republic', rivals: 'Red Tide Fleet' },
      { name: 'Red Tide Fleet', archetype: 'Pirate fleet', influence: 'Ships, fear', leader: 'An admiral elected by the crews', agenda: 'Bleed the convoys.', beliefs: 'The sea takes what it wants.', color: '#dd7c7c', baseRegion: 'Red Reef' },
      { name: 'Lighthouse Keepers', archetype: 'Secret order', influence: 'Safe passage, tide lore', leader: 'The Eldest Keeper', agenda: 'Keep the lost city lost.', beliefs: 'Some lights guide, some warn.', color: '#e9c46a' },
    ],
    environments: [
      { name: 'Harbour at Dawn', containerType: 'city', biome: 'Coastal', mood: 'Hopeful, foggy', purpose: 'Departures', description: 'Gulls, ropes, the first ship of the season.', hazards: 'Press gangs', region: 'Harbour Republic' },
      { name: 'Captain\'s Cabin', containerType: 'frontier', biome: 'Ship interior', mood: 'Intimate, tense', purpose: 'Plans and betrayals', description: 'Charts, rum, a locked chest.', hazards: 'Mutiny', region: 'Inner Sea' },
      { name: 'Reef Fortress', containerType: 'dungeon', biome: 'Coral and timber', mood: 'Loud, lawless', purpose: 'Duels', description: 'Taverns built into wrecks.', hazards: 'Everyone', region: 'Red Reef' },
      { name: 'Drowned Temple', containerType: 'dungeon', biome: 'Underwater ruin', mood: 'Silent, awed', purpose: 'The climax', description: 'Light from below, statues that watch.', hazards: 'Drowning', region: 'Sunken Sea' },
    ],
    glossary: [
      { term: 'Dark season', meaning: 'Months when nobody sails.' },
      { term: 'Letter of marque', meaning: 'Permission to be a pirate for a king.' },
      { term: 'Keeper', meaning: 'Lighthouse guardian with tide lore.' },
    ],
    lookStyleIds: ['style-technicolor', 'painterly', 'classic-suspense'],
  },
  {
    id: 'hearthwood',
    name: 'Hearthwood',
    tagline: 'Cozy fantasy village with a secret in the forest',
    gradient: 'linear-gradient(135deg, #3b2a1a 0%, #a8743f 50%, #ffe6a7 100%)',
    core: {
      universeName: 'Hearthwood', genre: 'Cozy fantasy', tone: 'Warm, gentle, a little eerie', era: 'Timeless myth',
      coreConflict: 'The forest is moving closer every winter, and the village festival must decide whether to welcome it or burn it back.',
      magicSystem: 'Household magic: bread that comforts, lanterns that remember. The forest has its own rules.',
      technologyLevel: 'Pre-industrial, water mills, a printing press nobody uses.',
      rules: 'Guests are sacred. Nobody harvests from the old trees. Debts are settled at the feast.',
      history: 'The village was founded by people who ran from something; the forest let them stay.',
      mapLegend: 'Paths in ochre, the forest boundary as it stood each winter.',
      factionsSummary: 'The Hearth Council, the Millers and the quiet folk of the treeline.',
    },
    regions: [
      { name: 'Hearthwood Village', kind: 'city', summary: 'Smoke from chimneys, a festival being prepared.', climate: 'Mild', terrain: 'Farmland, river', x: 44, y: 54, color: '#e9c46a', factions: ['Hearth Council'] },
      { name: 'The Old Forest', kind: 'wildlands', summary: 'It moves.', climate: 'Cool, green', terrain: 'Ancient trees', x: 68, y: 34, color: '#57b894', factions: ['Treeline Folk'] },
      { name: 'Mill Road', kind: 'route', summary: 'To the market town and back.', climate: 'Mild', terrain: 'Dirt road, bridges', x: 24, y: 70, color: '#b3bbc7', factions: ['The Millers'] },
    ],
    factions: [
      { name: 'Hearth Council', archetype: 'Village council', influence: 'Food, gossip', leader: 'Whoever hosts the winter feast', agenda: 'Keep the festival going.', beliefs: 'Small lives matter most.', color: '#e9c46a', baseRegion: 'Hearthwood Village' },
      { name: 'The Millers', archetype: 'Family business', influence: 'Flour, credit', leader: 'Grandmother Miller', agenda: 'Cut the old trees for the new mill.', beliefs: 'Progress feeds people.', color: '#c08457', baseRegion: 'Mill Road', rivals: 'Treeline Folk' },
      { name: 'Treeline Folk', archetype: 'Fae neighbours', influence: 'The forest', leader: 'Nobody, or everybody', agenda: 'Be welcomed.', beliefs: 'Guests are sacred.', color: '#57b894', baseRegion: 'The Old Forest' },
    ],
    environments: [
      { name: 'Festival Square', containerType: 'settlement', biome: 'Village green', mood: 'Warm, busy', purpose: 'The gathering', description: 'Lanterns, long tables, a stage half built.', hazards: 'Arguments', region: 'Hearthwood Village' },
      { name: 'Treeline Shrine', containerType: 'sanctuary', biome: 'Forest edge', mood: 'Hushed', purpose: 'Offerings', description: 'Ribbons and a bell that rings by itself.', hazards: 'The forest', region: 'The Old Forest' },
      { name: 'The Mill', containerType: 'settlement', biome: 'Riverside', mood: 'Industrious', purpose: 'The stakes', description: 'A wheel that never stops.', hazards: 'Machinery', region: 'Mill Road' },
    ],
    glossary: [
      { term: 'Hearth-right', meaning: 'A guest\'s claim to food and a bed.' },
      { term: 'Old trees', meaning: 'Trees older than the village; never harvested.' },
      { term: 'The Feast', meaning: 'Winter festival where debts are settled.' },
    ],
    lookStyleIds: ['hand-painted-animation', 'watercolor', 'style-claymation'],
  },
  {
    id: 'lantern-city',
    name: 'Lantern City',
    tagline: 'Noir crime city where the syndicate runs the docks',
    gradient: 'linear-gradient(135deg, #0d0d12 0%, #3d3a4a 55%, #d8b46a 100%)',
    core: {
      universeName: 'Lantern City', genre: 'Noir crime', tone: 'Cold, rain-soaked, wry', era: 'Interwar years',
      coreConflict: 'A harbour master is found dead and the only witness is a smuggler who owes everyone money.',
      magicSystem: 'None. Superstition among sailors.',
      technologyLevel: 'Early electricity, telephones, trams, revolvers.',
      rules: 'The docks belong to the Syndicate. The police belong to whoever pays. Nobody talks to the press.',
      history: 'The city grew rich on a war it did not fight.',
      mapLegend: 'Tram lines and the harbour districts.',
      factionsSummary: 'The Lantern Syndicate, City Hall and a newspaper with one honest reporter.',
    },
    regions: [
      { name: 'The Docks', kind: 'city', summary: 'Warehouses, fog, deals.', climate: 'Rain', terrain: 'Piers', x: 30, y: 58, color: '#d8b46a', factions: ['Lantern Syndicate'] },
      { name: 'Uptown', kind: 'city', summary: 'City Hall and the hotels.', climate: 'Rain', terrain: 'Boulevards', x: 62, y: 34, color: '#aab4ff', factions: ['City Hall'] },
      { name: 'Tram Line 9', kind: 'route', summary: 'Connects everyone who should not meet.', climate: 'Rain', terrain: 'Rails', x: 50, y: 50, color: '#b3bbc7' },
      { name: 'Harbour Mouth', kind: 'sea', summary: 'Where the bodies surface.', climate: 'Fog', terrain: 'Breakwaters', x: 18, y: 80, color: '#5aa9e6' },
    ],
    factions: [
      { name: 'Lantern Syndicate', archetype: 'Crime syndicate', influence: 'Smuggling, debt', leader: 'A family matriarch', agenda: 'Own the harbour master\'s successor.', beliefs: 'The law is for people who cannot afford better.', color: '#d8b46a', baseRegion: 'The Docks' },
      { name: 'City Hall', archetype: 'Political machine', influence: 'Permits, police', leader: 'The Mayor\'s fixer', agenda: 'Keep the scandal out of the election.', beliefs: 'Everything is negotiable.', color: '#aab4ff', baseRegion: 'Uptown', allies: 'Lantern Syndicate' },
      { name: 'The Evening Post', archetype: 'Newspaper', influence: 'Headlines', leader: 'An editor with a bad heart', agenda: 'Print the truth once.', beliefs: 'Paper remembers.', color: '#f3f4f6' },
    ],
    environments: [
      { name: 'Warehouse 7', containerType: 'dungeon', biome: 'Dock interior', mood: 'Cold, echoing', purpose: 'The body', description: 'Crates, a single lamp, water under the floor.', hazards: 'Thugs', region: 'The Docks' },
      { name: 'Hotel Bar', containerType: 'city', biome: 'Interior, velvet', mood: 'Smoky, watchful', purpose: 'Deals', description: 'A piano and too many mirrors.', hazards: 'Being seen', region: 'Uptown' },
      { name: 'Tram Depot', containerType: 'frontier', biome: 'Industrial', mood: 'Empty at night', purpose: 'The chase', description: 'Rails, sparks, one way out.', hazards: 'Trams', region: 'Tram Line 9' },
    ],
    glossary: [
      { term: 'Lantern', meaning: 'A Syndicate bribe, paid monthly.' },
      { term: 'Wet', meaning: 'A job involving the harbour.' },
      { term: 'The Post', meaning: 'The only paper not owned by City Hall.' },
    ],
    lookStyleIds: ['noir-bw', 'graphic-noir', 'urban-loneliness'],
  },
  {
    id: 'ember-age',
    name: 'Ember Age',
    tagline: 'Mythic antiquity where gods still walk',
    gradient: 'linear-gradient(135deg, #3a1f0f 0%, #b4552b 50%, #f5d99a 100%)',
    core: {
      universeName: 'Ember Age', genre: 'Mythic antiquity', tone: 'Epic, fated, sun-bleached', era: 'Bronze age',
      coreConflict: 'The gods have stopped answering, and the city that fed them must decide whether to keep the fires burning.',
      magicSystem: 'Divine covenants. Priests trade offerings for miracles that are getting smaller.',
      technologyLevel: 'Bronze, chariots, irrigation, the first writing.',
      rules: 'Oaths sworn at the Oath-stone bind bloodlines. Strangers are gods until proven otherwise.',
      history: 'The city was founded on a promise to a god. The god has not written back.',
      mapLegend: 'Rivers as lifelines, temples as landmarks.',
      factionsSummary: 'The Temple, the King\'s chariots and the river clans.',
    },
    regions: [
      { name: 'River Kingdom', kind: 'kingdom', summary: 'Rich, comfortable, quietly rotting.', climate: 'Mild', terrain: 'Floodplains', x: 46, y: 52, color: '#7cc0a5', factions: ['The King\'s Chariots'] },
      { name: 'Temple Mount', kind: 'landmark', summary: 'Where the fires burn.', climate: 'Hot', terrain: 'Terraced hill', x: 62, y: 30, color: '#e9c46a', factions: ['The Temple'] },
      { name: 'Desert Caliphate', kind: 'kingdom', summary: 'Scholars, spice, an unseen ruler.', climate: 'Arid', terrain: 'Dunes, oasis cities', x: 80, y: 68, color: '#e9c46a' },
      { name: 'Pilgrim Path', kind: 'route', summary: 'Penance and bandits share rest stops.', climate: 'Mountain', terrain: 'Stair roads', x: 28, y: 32, color: '#c9a7ff', factions: ['River Clans'] },
    ],
    factions: [
      { name: 'The Temple', archetype: 'Church', influence: 'Faith, grain stores', leader: 'A high celebrant chosen by lot', agenda: 'Keep the fires burning.', beliefs: 'The debt is due.', color: '#e9c46a', baseRegion: 'Temple Mount' },
      { name: 'The King\'s Chariots', archetype: 'Royal army', influence: 'Bronze, roads', leader: 'A king who has stopped praying', agenda: 'Take the grain for the army.', beliefs: 'Gods that do not answer are not owed.', color: '#7cc0a5', baseRegion: 'River Kingdom', rivals: 'The Temple' },
      { name: 'River Clans', archetype: 'Nomad confederation', influence: 'Boats, scouts', leader: 'Rotating speakers', agenda: 'Stay out of the war.', beliefs: 'The river is the only god that answers.', color: '#c9a7ff', baseRegion: 'Pilgrim Path' },
    ],
    environments: [
      { name: 'Fire Altar', containerType: 'sanctuary', biome: 'Open temple', mood: 'Blinding, reverent', purpose: 'The vigil', description: 'Smoke, bronze, a silence where the answer used to be.', hazards: 'Heat, zealots', region: 'Temple Mount' },
      { name: 'Chariot Yard', containerType: 'city', biome: 'Dust and stables', mood: 'Loud, proud', purpose: 'Mustering', description: 'Horses, bronze, boys pretending to be men.', hazards: 'Accidents', region: 'River Kingdom' },
      { name: 'Hidden Oasis', containerType: 'sanctuary', biome: 'Desert spring', mood: 'Relief, suspicion', purpose: 'Truce', description: 'Palms, cold water, everyone armed but polite.', hazards: 'Raiders', region: 'Desert Caliphate' },
    ],
    glossary: [
      { term: 'Oath-stone', meaning: 'Where binding promises are sworn.' },
      { term: 'Covenant', meaning: 'A deal with a god.' },
      { term: 'Ember', meaning: 'A miracle small enough to hold.' },
    ],
    lookStyleIds: ['desert-epic', 'historical-drama', 'style-surrealist'],
  },
];

/* ─── Apply helpers ─── */

const findByName = <T extends { name: string; id: string }>(items: T[], name?: string) =>
  (name ? items.find((item) => item.name === name)?.id : '') || '';

/** Builds a fresh worldbuilding state from a template. */
export const buildWorldFromTemplate = (template: WorldTemplate): WorldbuildingState => {
  const base = createDefaultWorldbuildingState();
  const regions: WorldbuildingMapRegion[] = template.regions.map((region) => ({
    ...createWorldbuildingRegion(),
    name: region.name,
    kind: region.kind,
    summary: region.summary,
    climate: region.climate,
    terrain: region.terrain,
    x: region.x,
    y: region.y,
    color: region.color,
  }));
  const factions: WorldbuildingFaction[] = template.factions.map((faction) => ({
    ...createWorldbuildingFaction(),
    name: faction.name,
    archetype: faction.archetype,
    influence: faction.influence,
    leader: faction.leader,
    agenda: faction.agenda,
    beliefs: faction.beliefs,
    color: faction.color,
    allies: faction.allies || '',
    rivals: faction.rivals || '',
    baseRegionId: findByName(regions, faction.baseRegion),
  }));
  regions.forEach((region, index) => {
    const linked = template.regions[index].factions || [];
    region.factionIds = linked.map((name) => findByName(factions, name)).filter(Boolean);
  });
  const environments: WorldbuildingEnvironment[] = template.environments.map((environment) => ({
    ...createWorldbuildingEnvironment(),
    name: environment.name,
    containerType: environment.containerType,
    biome: environment.biome,
    mood: environment.mood,
    purpose: environment.purpose,
    description: environment.description,
    hazards: environment.hazards,
    resources: environment.resources || '',
    linkedRegionId: findByName(regions, environment.region),
  }));
  const glossary: WorldbuildingGlossaryEntry[] = template.glossary.map((entry) => ({
    ...createWorldbuildingGlossaryEntry(),
    term: entry.term,
    meaning: entry.meaning,
  }));
  return {
    ...base,
    ...template.core,
    mapRegions: regions,
    factions,
    environments,
    glossary,
    lookStyleIds: [...template.lookStyleIds],
    templateId: template.id,
  };
};

export const regionFromPreset = (preset: WorldRegionPreset, position?: { x: number; y: number }): WorldbuildingMapRegion => ({
  ...createWorldbuildingRegion(),
  name: preset.name,
  kind: preset.kind,
  climate: preset.climate,
  terrain: preset.terrain,
  summary: preset.summary,
  color: preset.color,
  x: position?.x ?? 20 + Math.round(Math.random() * 60),
  y: position?.y ?? 20 + Math.round(Math.random() * 60),
});

export const factionFromPreset = (preset: WorldFactionPreset): WorldbuildingFaction => ({
  ...createWorldbuildingFaction(),
  name: preset.name,
  archetype: preset.archetype,
  influence: preset.influence,
  leader: preset.leader,
  agenda: preset.agenda,
  beliefs: preset.beliefs,
  color: preset.color,
});

export const environmentFromPreset = (preset: WorldEnvironmentPreset): WorldbuildingEnvironment => ({
  ...createWorldbuildingEnvironment(),
  name: preset.name,
  containerType: preset.containerType,
  biome: preset.biome,
  mood: preset.mood,
  purpose: preset.purpose,
  description: preset.description,
  hazards: preset.hazards,
});

export const glossaryFromPack = (pack: WorldGlossaryPack): WorldbuildingGlossaryEntry[] =>
  pack.entries.map((entry) => ({ ...createWorldbuildingGlossaryEntry(), term: entry.term, meaning: entry.meaning }));

/** True when the world has no meaningful content yet. */
export const isWorldEmpty = (world: WorldbuildingState): boolean =>
  !world.universeName.trim() && !world.genre.trim() && !world.coreConflict.trim()
  && world.mapRegions.length === 0 && world.factions.length === 0 && world.environments.length === 0 && world.glossary.length === 0;

/** Plain-text digest of the world, useful as prompt context for later phases. */
export const summarizeWorld = (world: WorldbuildingState): string => {
  const lines: string[] = [];
  if (world.universeName) lines.push(`Universe: ${world.universeName}`);
  const core = [world.genre, world.tone, world.era].filter(Boolean).join(' · ');
  if (core) lines.push(core);
  if (world.coreConflict) lines.push(`Conflict: ${world.coreConflict}`);
  if (world.mapRegions.length) lines.push(`Regions: ${world.mapRegions.map((region) => region.name).join(', ')}`);
  if (world.factions.length) lines.push(`Factions: ${world.factions.map((faction) => faction.name).join(', ')}`);
  if (world.environments.length) lines.push(`Places: ${world.environments.map((environment) => environment.name).join(', ')}`);
  return lines.join('\n');
};
