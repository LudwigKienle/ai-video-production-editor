/**
 * MCP tools for the Sound browser: AI voice / music / SFX generation, Demucs
 * stem separation, the local mastering pipeline and project/library audio.
 *
 * Paid tools (provider credits) carry `cost: 'paid'` and refuse to run
 * without `confirm: true`. Results land in the media pool and, unless
 * `placeOnTimeline: false`, on the timeline (a free audio track at the given
 * time or the playhead), routed to the matching stem bus.
 */
import { registerStudioToolModule, str, type JsonSchema, type StudioTool, type StudioToolContext } from '../toolModules.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types.ts';
import { getSoundAudioServices, type AudioPayload } from '../../workspaces/sound-pro/audioServices.ts';
import { runSoundCommand } from '../../workspaces/sound-pro/commands.ts';
import type { StemRole } from '../../workspaces/sound-pro/model.ts';
import { ENGINE_SAMPLE_RATE, sourceCache } from '../../workspaces/sound-pro/engine/runtime.ts';
import { applySoundPatchToContext, readSoundMix } from './soundTools.ts';

const requireConfirm = (args: Record<string, unknown>, what: string) => {
  if (args.confirm !== true) {
    throw new Error(`${what} verbraucht Provider-Credits. Nach Rückfrage beim Nutzer erneut mit confirm: true aufrufen.`);
  }
};

const CONFIRM: JsonSchema = { type: 'boolean', description: 'Muss true sein (verbraucht Provider-Credits).' };
const PLACE_PROPS: Record<string, JsonSchema> = {
  placeOnTimeline: { type: 'boolean', description: 'Ergebnis in die Timeline legen (Standard: ja)' },
  trackId: { type: 'string', description: 'optional: Zielspur (Standard: freie Audiospur, sonst neue Spur)' },
  start: { type: 'number', description: 'optional: Startzeit in Sekunden (Standard: Abspielposition)' },
};

/** Media duration in seconds: from the item, else by decoding, else 5 s. */
const mediaDuration = async (item: MediaItem): Promise<number> => {
  if (typeof item.duration === 'number' && item.duration > 0) return item.duration;
  await sourceCache.ensure([item]);
  const src = sourceCache.get(item.id);
  return src ? src.channels[0].length / (src.sampleRate || ENGINE_SAMPLE_RATE) : 5;
};

/** Puts media on the timeline: given track, else a free unlocked audio track, else a new audio track. */
export const placeOnTimeline = async (
  ctx: StudioToolContext,
  item: MediaItem,
  opts: { trackId?: string; start?: number; role?: StemRole | null },
): Promise<{ clipId: string; trackId: string; start: number; end: number }> => {
  const state = ctx.getState();
  const start = Math.max(0, typeof opts.start === 'number' && Number.isFinite(opts.start) ? opts.start : state.playheadPosition);
  const length = await mediaDuration(item);
  const end = start + length;
  const free = (track: TimelineTrack) => !track.isLocked && !state.timelineClips.some((c) => c.trackId === track.id && c.start < end && c.end > start);
  let tracks = state.timelineTracks;
  let track: TimelineTrack | undefined;
  if (opts.trackId) {
    track = tracks.find((t) => t.id === opts.trackId);
    if (!track) throw new Error(`Spur „${opts.trackId}“ gibt es nicht.`);
    if (track.isLocked) throw new Error(`Spur „${track.name ?? track.id}“ ist gesperrt.`);
  } else {
    track = tracks.find((t) => t.type === 'audio' && free(t));
  }
  if (!track) {
    const count = tracks.filter((t) => t.type === 'audio').length + 1;
    track = { id: `audio-${Date.now().toString(36)}-${count}`, name: `A${count}`, type: 'audio', isLocked: false, isMuted: false };
    tracks = [...tracks, track];
    ctx.actions.setTimelineTracks(tracks);
  }
  const clip: TimelineClip = {
    id: `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    mediaId: item.id,
    trackId: track.id,
    start,
    end,
    duration: length,
    speed: 1,
    sourceIn: 0,
    sourceOut: length,
    volume: 1,
    effect: null,
  };
  ctx.actions.setTimelineClips([...ctx.getState().timelineClips, clip]);
  if (opts.role) {
    const s = ctx.getState();
    const outcome = runSoundCommand({ mix: readSoundMix(ctx), clips: s.timelineClips, tracks: s.timelineTracks, media: s.mediaItems, playhead: s.playheadPosition }, 'mixer.setRole', { trackId: track.id, role: opts.role });
    if (outcome.ok && 'patch' in outcome) await applySoundPatchToContext(ctx, outcome.patch);
  }
  return { clipId: clip.id, trackId: track.id, start, end };
};

/** Adds generated media to the pool and optionally to the timeline. */
const deliver = async (ctx: StudioToolContext, items: MediaItem[], args: Record<string, unknown>, role: StemRole | null, label: string) => {
  const placed: Array<Record<string, unknown>> = [];
  let start = typeof args.start === 'number' ? args.start : undefined;
  for (const raw of items) {
    const item: MediaItem = { ...raw, generatedBy: raw.generatedBy || label };
    ctx.actions.addMediaItem(item);
    if (args.placeOnTimeline !== false) {
      const where = await placeOnTimeline(ctx, item, { trackId: typeof args.trackId === 'string' && items.length === 1 ? args.trackId : undefined, start, role });
      placed.push({ mediaId: item.id, ...where });
      start = where.start; // stems line up at the same start, each on its own free track
    } else {
      placed.push({ mediaId: item.id, name: item.name });
    }
  }
  return { media: items.map((m) => ({ id: m.id, name: m.name, duration: m.duration ?? null })), placed };
};

/** Resolves an audio source given as clipId, mediaId, assetId (library), url or filePath. */
const resolveSource = async (ctx: StudioToolContext, args: Record<string, unknown>): Promise<{ name: string; url: string; payload: () => Promise<AudioPayload>; startAt?: number }> => {
  const state = ctx.getState();
  const services = getSoundAudioServices();
  if (typeof args.clipId === 'string') {
    const clip = state.timelineClips.find((c) => c.id === args.clipId);
    if (!clip) throw new Error(`Clip „${args.clipId}“ gibt es nicht.`);
    const media = state.mediaItems.find((m) => m.id === clip.mediaId);
    if (!media || (media.type !== 'audio' && media.type !== 'video')) throw new Error('Der Clip hat keinen Ton.');
    return { name: media.name, url: media.url, payload: () => services.urlToPayload(media.url), startAt: clip.start };
  }
  if (typeof args.mediaId === 'string') {
    const media = state.mediaItems.find((m) => m.id === args.mediaId);
    if (!media) throw new Error(`Medium „${args.mediaId}“ gibt es nicht.`);
    return { name: media.name, url: media.url, payload: () => services.urlToPayload(media.url) };
  }
  if (typeof args.assetId === 'string') {
    const assets = await listLibraryAudio(ctx);
    const asset = assets.find((a) => a.id === args.assetId);
    if (!asset?.url) throw new Error(`Library-Asset „${args.assetId}“ gibt es nicht (sound_library_list).`);
    return { name: asset.name, url: asset.url, payload: () => services.urlToPayload(asset.url as string) };
  }
  // the MCP server turns *Path args into file:// URLs; both keys are accepted
  const url = typeof args.url === 'string' ? args.url : typeof args.filePath === 'string' ? (args.filePath.startsWith('/') ? `file://${args.filePath}` : args.filePath) : null;
  if (url) return { name: url.split('/').pop() || 'audio', url, payload: () => services.urlToPayload(url) };
  throw new Error('Quelle fehlt: clipId, mediaId, assetId, url oder filePath angeben.');
};

type LibraryAudio = { id: string; name: string; url?: string | null; duration?: number; projectName: string; origin: string; generatedBy?: string };

/** Library audio comes from the Sound page (it loads recent projects); opens the page if needed. */
const listLibraryAudio = async (ctx: StudioToolContext): Promise<LibraryAudio[]> => {
  const result = await invokeLiveCommand('sound.library.list', {}, { openWorkspace: () => ctx.actions.setActiveWorkspace('SOUND'), workspace: 'SOUND' }) as { assets?: LibraryAudio[] };
  return Array.isArray(result?.assets) ? result.assets : [];
};

const SOURCE_PROPS: Record<string, JsonSchema> = {
  clipId: { type: 'string', description: 'Timeline-Clip als Quelle' },
  mediaId: { type: 'string', description: 'Medium aus dem Medienpool' },
  assetId: { type: 'string', description: 'Audio aus der Bibliothek (sound_library_list)' },
  url: { type: 'string', description: 'https-, file- oder data-URL' },
  filePath: { type: 'string', description: 'lokaler Dateipfad' },
};

const tools: StudioTool[] = [
  {
    name: 'sound_generate_voice',
    description: 'Erzeugt Sprache aus Text (ElevenLabs oder MiniMax Speech 02 HD), legt sie in den Medienpool und an die Abspielposition auf eine freie Audiospur (Rolle Dialog). Verbraucht Credits: confirm: true nötig.',
    writes: true,
    cost: 'paid',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Was die Stimme sagt' },
        provider: { type: 'string', enum: ['elevenlabs', 'minimax'], description: 'Standard: elevenlabs' },
        voiceId: { type: 'string', description: 'ElevenLabs: Voice-ID' },
        modelId: { type: 'string', description: 'ElevenLabs: Modell (Standard eleven_multilingual_v2)' },
        outputFormat: { type: 'string', description: 'ElevenLabs: z. B. mp3_44100_128' },
        voice: { type: 'string', description: 'MiniMax: Stimme' },
        speed: { type: 'number', minimum: 0.5, maximum: 1.5, description: 'MiniMax: Tempo' },
        ...PLACE_PROPS,
        confirm: CONFIRM,
      },
      required: ['text', 'confirm'],
    },
    handler: async (args, ctx) => {
      const text = str(args, 'text');
      requireConfirm(args, 'Sprachgenerierung');
      const s = getSoundAudioServices();
      const provider = args.provider === 'minimax' ? 'minimax' : 'elevenlabs';
      const item = provider === 'minimax'
        ? await s.minimaxSpeech(text, { voice: typeof args.voice === 'string' ? args.voice : undefined, speed: typeof args.speed === 'number' ? Math.min(1.5, Math.max(0.5, args.speed)) : undefined })
        : await s.elevenLabsSpeech(text, { voiceId: typeof args.voiceId === 'string' ? args.voiceId : undefined, modelId: typeof args.modelId === 'string' ? args.modelId : undefined, outputFormat: typeof args.outputFormat === 'string' ? args.outputFormat : undefined });
      return { provider, ...(await deliver(ctx, [item], args, 'dialog', provider === 'minimax' ? 'Minimax Speech 02 HD' : 'ElevenLabs Voiceover')) };
    },
  },
  {
    name: 'sound_generate_music',
    description: 'Erzeugt Musik (Lyria 2: kurzer Cue mit Dauer; Sonauto v3: ganzer Song, optional instrumental), legt sie in den Medienpool und auf eine freie Audiospur (Rolle Musik). Verbraucht Credits: confirm: true nötig.',
    writes: true,
    cost: 'paid',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Stil, Tempo, Stimmung, Instrumente' },
        provider: { type: 'string', enum: ['lyria2', 'sonauto-v3'], description: 'Standard: lyria2' },
        duration: { type: 'number', minimum: 4, maximum: 120, description: 'Lyria 2: Sekunden (Standard 20)' },
        instrumental: { type: 'boolean', description: 'Sonauto: ohne Gesang (Standard: ja)' },
        ...PLACE_PROPS,
        confirm: CONFIRM,
      },
      required: ['prompt', 'confirm'],
    },
    handler: async (args, ctx) => {
      const prompt = str(args, 'prompt');
      requireConfirm(args, 'Musikgenerierung');
      const s = getSoundAudioServices();
      const provider = args.provider === 'sonauto-v3' ? 'sonauto-v3' : 'lyria2';
      if (provider === 'sonauto-v3' && !(await s.sonautoAvailable())) throw new Error('Für Sonauto fehlt der API-Key (Einstellungen).');
      const item = provider === 'sonauto-v3'
        ? await s.sonautoMusic(prompt, { instrumental: args.instrumental !== false })
        : await s.lyriaMusic(prompt, { duration: typeof args.duration === 'number' ? Math.min(120, Math.max(4, args.duration)) : 20 });
      return { provider, ...(await deliver(ctx, [item], args, 'music', provider === 'sonauto-v3' ? 'Sonauto v3 Music' : 'Lyria 2 Music')) };
    },
  },
  {
    name: 'sound_generate_sfx',
    description: 'Erzeugt einen Soundeffekt (Lyria 2) aus einer Beschreibung, legt ihn in den Medienpool und auf eine freie Audiospur (Rolle Effekte). Verbraucht Credits: confirm: true nötig.',
    writes: true,
    cost: 'paid',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'z. B. „Whoosh, Einschlag, Regen auf Blechdach“' },
        duration: { type: 'number', minimum: 2, maximum: 60, description: 'Sekunden (Standard 6)' },
        ...PLACE_PROPS,
        confirm: CONFIRM,
      },
      required: ['prompt', 'confirm'],
    },
    handler: async (args, ctx) => {
      const prompt = str(args, 'prompt');
      requireConfirm(args, 'SFX-Generierung');
      const item = await getSoundAudioServices().lyriaMusic(prompt, { duration: typeof args.duration === 'number' ? Math.min(60, Math.max(2, args.duration)) : 6 });
      return { provider: 'lyria2', ...(await deliver(ctx, [item], args, 'effects', 'Lyria 2 SFX')) };
    },
  },
  {
    name: 'sound_stems_separate',
    description: 'Trennt Audio mit Demucs in Stems (Vocals, Drums, Bass, Other). Quelle: clipId, mediaId, assetId (Bibliothek), url oder filePath. Ergebnisse in den Medienpool und, bei placeOnTimeline, jeweils auf eigene freie Spuren ab Clip-Start. Verbraucht Credits: confirm: true nötig.',
    writes: true,
    cost: 'paid',
    parameters: { type: 'object', properties: { ...SOURCE_PROPS, ...PLACE_PROPS, confirm: CONFIRM }, required: ['confirm'] },
    handler: async (args, ctx) => {
      const source = await resolveSource(ctx, args);
      requireConfirm(args, 'Stem-Trennung');
      const stems = await getSoundAudioServices().demucs(await source.payload());
      if (!stems.length) throw new Error('Demucs hat keine Stems geliefert.');
      const result = await deliver(ctx, stems, { ...args, start: typeof args.start === 'number' ? args.start : source.startAt, trackId: undefined }, null, 'Demucs Stem');
      return { source: source.name, ...result };
    },
  },
  {
    name: 'sound_mastering_status',
    description: 'Prüft die lokale Mastering-Umgebung (Python, pyloudnorm …): bereit, verfügbar, Pfade, Version, Fehler.',
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ status: await getSoundAudioServices().masteringStatus() }),
  },
  {
    name: 'sound_mastering_setup',
    description: 'Richtet die lokale Mastering-Umgebung ein (legt eine Python-Umgebung an und installiert die Pakete; dauert einige Minuten, keine Credits).',
    writes: true,
    parameters: { type: 'object', properties: {} },
    handler: async () => ({ status: await getSoundAudioServices().masteringSetup() }),
  },
  {
    name: 'sound_mastering_run',
    description: 'Mastert eine Audiodatei lokal: mode manual (EQ-Match an eine Referenz, Multiband-Kompression, Stereobreite, Limiter, Ziel-LUFS) oder spotify_auto (automatisches Streaming-Profil). Quelle wie bei sound_stems_separate, Referenz optional über referenceClipId/referenceMediaId/referenceUrl. Ergebnis (24-bit WAV) in den Medienpool, optional in die Timeline. Keine Credits.',
    writes: true,
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['manual', 'spotify_auto'], description: 'Standard: manual' },
        ...SOURCE_PROPS,
        referenceClipId: { type: 'string', description: 'optional: Referenz-Clip' },
        referenceMediaId: { type: 'string', description: 'optional: Referenz-Medium' },
        referenceUrl: { type: 'string', description: 'optional: Referenz-URL' },
        compressionStrength: { type: 'number', minimum: 0, maximum: 10, description: 'Standard 5' },
        stereoWidthPercent: { type: 'number', minimum: 0, maximum: 200, description: 'Standard 100' },
        targetLufs: { type: 'number', minimum: -30, maximum: -6, description: 'Standard −14' },
        eqMatchAmount: { type: 'number', minimum: 0, maximum: 1, description: 'optional' },
        limiterCeilingDbtp: { type: 'number', minimum: -6, maximum: 0, description: 'optional' },
        lowMidCrossoverHz: { type: 'number', description: 'optional' },
        midHighCrossoverHz: { type: 'number', description: 'optional' },
        placeOnTimeline: { type: 'boolean', description: 'Ergebnis in die Timeline legen (Standard: nein)' },
        trackId: PLACE_PROPS.trackId,
        start: PLACE_PROPS.start,
      },
    },
    handler: async (args, ctx) => {
      const s = getSoundAudioServices();
      const status = await s.masteringStatus();
      if (!status.ready) throw new Error(`Mastering-Umgebung nicht bereit${status.error ? `: ${status.error}` : ''}. Erst sound_mastering_setup.`);
      const target = await resolveSource(ctx, args);
      const refArgs = { clipId: args.referenceClipId, mediaId: args.referenceMediaId, url: args.referenceUrl };
      const reference = refArgs.clipId || refArgs.mediaId || refArgs.url ? await resolveSource(ctx, refArgs) : null;
      const mode = args.mode === 'spotify_auto' ? 'spotify_auto' : 'manual';
      const n = (key: string, fallback: number, min: number, max: number) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? Math.min(max, Math.max(min, args[key] as number)) : fallback);
      const opt = (key: string) => (typeof args[key] === 'number' && Number.isFinite(args[key]) ? (args[key] as number) : undefined);
      const result = await s.masteringRun({
        provider: 'local',
        mode,
        target: { ...(await target.payload()), name: target.name },
        reference: reference ? { ...(await reference.payload()), name: reference.name } : null,
        compressionStrength: n('compressionStrength', 5, 0, 10),
        stereoWidthPercent: n('stereoWidthPercent', 100, 0, 200),
        targetLufs: n('targetLufs', -14, -30, -6),
        advanced: { eqMatchAmount: opt('eqMatchAmount'), limiterCeilingDbtp: opt('limiterCeilingDbtp'), lowMidCrossoverHz: opt('lowMidCrossoverHz'), midHighCrossoverHz: opt('midHighCrossoverHz') },
        projectPath: ctx.getState().projectPath,
      });
      const item: MediaItem = {
        id: `audio-mastering-${Date.now()}`,
        name: result.outputName,
        type: 'audio',
        url: result.url,
        source: 'generated',
        generatedBy: mode === 'spotify_auto' ? 'Spotify Auto Master' : 'Custom DSP Mastering',
        prompt: `Song: ${target.name}; Reference: ${reference?.name || 'None'}`,
        originProjectPath: ctx.getState().projectPath,
      };
      const delivered = await deliver(ctx, [item], { ...args, placeOnTimeline: args.placeOnTimeline === true }, null, item.generatedBy as string);
      return {
        mode,
        outputName: result.outputName,
        beforeLufs: result.beforeLufs, afterLufs: result.afterLufs,
        beforeTruePeakDbtp: result.beforeTruePeakDbtp, afterTruePeakDbtp: result.afterTruePeakDbtp,
        spotifyReady: result.spotifyReady ?? null,
        warnings: result.warnings ?? [],
        ...delivered,
      };
    },
  },
  {
    name: 'sound_library_list',
    description: 'Listet Audio aus dem Projekt (Medienpool) und aus der Bibliothek (letzte Projekte): id/assetId, Name, Dauer, Projekt, Herkunft. Mit query filtern.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'optional: Suchtext (Name oder Projekt)' },
        scope: { type: 'string', enum: ['project', 'library', 'all'], description: 'Standard: all' },
      },
    },
    handler: async (args, ctx) => {
      const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const match = (...fields: Array<string | undefined>) => !q || fields.some((f) => f?.toLowerCase().includes(q));
      const scope = args.scope === 'project' || args.scope === 'library' ? args.scope : 'all';
      const project = scope === 'library' ? [] : ctx.getState().mediaItems
        .filter((m) => m.type === 'audio' && match(m.name, m.generatedBy))
        .map((m) => ({ mediaId: m.id, name: m.name, duration: m.duration ?? null, generatedBy: m.generatedBy ?? null, onTimeline: ctx.getState().timelineClips.some((c) => c.mediaId === m.id) }));
      const library = scope === 'project' ? [] : (await listLibraryAudio(ctx))
        .filter((a) => a.url && match(a.name, a.projectName))
        .map((a) => ({ assetId: a.id, name: a.name, duration: a.duration ?? null, project: a.projectName, origin: a.origin }));
      return { project, library };
    },
  },
  {
    name: 'sound_library_add_to_timeline',
    description: 'Legt Projekt-Audio (mediaId) oder Bibliotheks-Audio (assetId, wird dafür in den Medienpool übernommen) in die Timeline: Zielspur oder freie Audiospur, Start oder Abspielposition, optional mit Stem-Rolle.',
    writes: true,
    parameters: {
      type: 'object',
      properties: {
        mediaId: { type: 'string', description: 'Medium aus dem Medienpool' },
        assetId: { type: 'string', description: 'Audio aus der Bibliothek' },
        role: { type: 'string', enum: ['dialog', 'music', 'effects', 'ambience'], description: 'optional: Stem-Rolle der Zielspur' },
        trackId: PLACE_PROPS.trackId,
        start: PLACE_PROPS.start,
      },
    },
    handler: async (args, ctx) => {
      let item: MediaItem | undefined;
      if (typeof args.mediaId === 'string') {
        item = ctx.getState().mediaItems.find((m) => m.id === args.mediaId);
        if (!item) throw new Error(`Medium „${args.mediaId}“ gibt es nicht.`);
      } else if (typeof args.assetId === 'string') {
        const asset = (await listLibraryAudio(ctx)).find((a) => a.id === args.assetId);
        if (!asset?.url) throw new Error(`Library-Asset „${args.assetId}“ gibt es nicht (sound_library_list).`);
        item = ctx.getState().mediaItems.find((m) => m.url === asset.url);
        if (!item) {
          item = { id: `media-lib-${Date.now().toString(36)}`, name: asset.name, type: 'audio', url: asset.url, source: 'upload', duration: asset.duration, generatedBy: asset.generatedBy, originProjectPath: null };
          ctx.actions.addMediaItem(item);
        }
      } else throw new Error('mediaId oder assetId angeben.');
      if (item.type !== 'audio' && item.type !== 'video') throw new Error('Das Medium hat keinen Ton.');
      const role = typeof args.role === 'string' && ['dialog', 'music', 'effects', 'ambience'].includes(args.role) ? (args.role as StemRole) : null;
      return { mediaId: item.id, ...(await placeOnTimeline(ctx, item, { trackId: typeof args.trackId === 'string' ? args.trackId : undefined, start: typeof args.start === 'number' ? args.start : undefined, role })) };
    },
  },
];

export const SOUND_MEDIA_TOOLS = tools;

registerStudioToolModule({ id: 'sound-media', label: 'Sound: Generierung, Stems, Mastering, Bibliothek', tools });
