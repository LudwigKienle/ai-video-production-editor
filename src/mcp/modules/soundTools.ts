/**
 * MCP tools for the Sound workspace (Fairlight / Pro Tools / Studio views).
 *
 * Every sound command (src/workspaces/sound-pro/commands.ts) is published as
 * its own tool `sound_<group>_<action>` — the UI buttons, shortcuts and these
 * tools run the very same command code. Extra tools read the mix, meters and
 * loudness and render mixdowns/stems with the same engine as the preview.
 *
 * The mix document lives in `extras.soundMix`; clip gain, mute and solo are
 * the shared timeline fields.
 */
import { registerStudioToolModule, type JsonSchema, type StudioTool, type StudioToolContext, type StudioToolResult } from '../toolModules.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import type { TimelineTrack } from '../../types.ts';
import { describeSoundCommands, runSoundCommand, SOUND_COMMANDS, type SoundCommand, type SoundPatch, type SoundState } from '../../workspaces/sound-pro/commands.ts';
import { formatDb, gainToDb, MIN_DB, normalizeSoundMix, STEM_BUS_IDS, STEM_ROLES, trackMixOf, type SoundMix } from '../../workspaces/sound-pro/model.ts';
import { bounceMix, stemMix } from '../../workspaces/sound-pro/engine/bounce.ts';
import { MixEngine, type EngineDocument } from '../../workspaces/sound-pro/engine/mixEngine.ts';
import { LoudnessMeter } from '../../workspaces/sound-pro/engine/loudness.ts';
import { encodeWav } from '../../workspaces/sound-pro/engine/wav.ts';
import { ENGINE_SAMPLE_RATE, getSoundRuntime, sourceCache } from '../../workspaces/sound-pro/engine/runtime.ts';

export const SOUND_EXTRA_KEY = 'soundMix';

/** `mixer.setFader` → `sound_mixer_set_fader` */
export const soundToolName = (commandId: string): string =>
  `sound_${commandId.replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()}`;

export const readSoundMix = (ctx: StudioToolContext): SoundMix => normalizeSoundMix(ctx.getState().extras?.[SOUND_EXTRA_KEY]);

const soundState = (ctx: StudioToolContext): SoundState => {
  const s = ctx.getState();
  return { mix: readSoundMix(ctx), clips: s.timelineClips, tracks: s.timelineTracks, media: s.mediaItems, playhead: s.playheadPosition };
};

const openSound = (ctx: StudioToolContext) => () => ctx.actions.setActiveWorkspace('SOUND');

/** Applies a command patch through the shared actions (same path as the UI). */
export const applySoundPatchToContext = async (ctx: StudioToolContext, patch: SoundPatch): Promise<string[]> => {
  const changed: string[] = [];
  if (patch.mix) {
    ctx.actions.setExtra(SOUND_EXTRA_KEY, patch.mix);
    changed.push('mix');
  }
  if (patch.clips) {
    ctx.actions.setTimelineClips(patch.clips);
    changed.push('clips');
  }
  if (patch.trackUpdates?.length || patch.addTrack) {
    const byId = new Map((patch.trackUpdates ?? []).map((u) => [u.trackId, u.updates]));
    let tracks: TimelineTrack[] = ctx.getState().timelineTracks.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t));
    if (patch.addTrack) {
      const count = tracks.filter((t) => t.type === patch.addTrack).length + 1;
      tracks = [...tracks, { id: `${patch.addTrack}-${Date.now().toString(36)}`, name: `${patch.addTrack === 'audio' ? 'A' : 'V'}${count}`, type: patch.addTrack, isLocked: false, isMuted: false }];
    }
    ctx.actions.setTimelineTracks(tracks);
    changed.push('tracks');
  }
  if (patch.playhead !== undefined) {
    ctx.actions.setPlayhead(patch.playhead);
    changed.push('playhead');
  }
  if (patch.transport) {
    await invokeLiveCommand('sound.transport', { action: patch.transport }, { openWorkspace: openSound(ctx), workspace: 'SOUND' });
    changed.push('transport');
  }
  return changed;
};

const runAsTool = async (ctx: StudioToolContext, command: SoundCommand, args: Record<string, unknown>): Promise<StudioToolResult> => {
  const outcome = runSoundCommand(soundState(ctx), command.id, args);
  if (outcome.ok === false) throw new Error('error' in outcome ? outcome.error : 'Befehl fehlgeschlagen.');
  if (!('patch' in outcome)) throw new Error('Befehl fehlgeschlagen.');
  if (command.group === 'Ansicht') openSound(ctx)();
  const changed = await applySoundPatchToContext(ctx, outcome.patch);
  const result = outcome.patch.result && typeof outcome.patch.result === 'object' ? (outcome.patch.result as Record<string, unknown>) : {};
  return { command: command.id, changed, ...result };
};

const READ_ONLY_GROUPS = new Set<SoundCommand['group']>([]);

const commandTools: StudioTool[] = SOUND_COMMANDS.map((command) => ({
  name: soundToolName(command.id),
  description: `${command.label}: ${command.description}${command.shortcut ? ` Tastenkürzel im Sound-Workspace: ${command.shortcut}.` : ''}`,
  parameters: command.params as unknown as JsonSchema,
  writes: !READ_ONLY_GROUPS.has(command.group) && command.group !== 'Transport',
  destructive: command.id === 'clip.delete' || command.id === 'edit.deleteSelection' || command.id === 'mix.reset' || command.id === 'bus.remove',
  handler: (args, ctx) => runAsTool(ctx, command, args),
}));

/* ─── read tools ─── */

const describeTrack = (mix: SoundMix, track: TimelineTrack, detail: boolean) => {
  const t = trackMixOf(mix, track.id);
  return {
    id: track.id,
    name: track.name ?? track.id,
    type: track.type,
    muted: track.isMuted,
    solo: Boolean(track.isSolo),
    faderDb: t.gainDb <= MIN_DB ? null : Number(t.gainDb.toFixed(2)),
    pan: t.pan,
    phaseInvert: t.phaseInvert,
    outputBusId: t.outputBusId,
    role: t.role,
    automationMode: t.automationMode,
    automation: Object.fromEntries(Object.entries(t.automation).map(([k, v]) => [k, detail ? v : `${v?.length ?? 0} Punkte`])),
    inserts: t.inserts.map((slot) => (detail ? slot : { id: slot.id, kind: slot.kind, bypass: slot.bypass })),
    sends: t.sends,
    recordArm: t.recordArm,
  };
};

const engineDoc = (ctx: StudioToolContext, mix: SoundMix = readSoundMix(ctx)): EngineDocument => {
  const s = ctx.getState();
  return { tracks: s.timelineTracks, clips: s.timelineClips, media: s.mediaItems, mix };
};

const contentEnd = (ctx: StudioToolContext): number => {
  const s = ctx.getState();
  const audible = new Set(s.mediaItems.filter((m) => m.type === 'audio' || m.type === 'video').map((m) => m.id));
  return s.timelineClips.filter((c) => audible.has(c.mediaId)).reduce((end, c) => Math.max(end, c.end), 0);
};

const ensureSources = async (ctx: StudioToolContext, start: number, end: number) => {
  const s = ctx.getState();
  const needed = new Set(s.timelineClips.filter((c) => c.end > start && c.start < end).map((c) => c.mediaId));
  return sourceCache.ensure(s.mediaItems.filter((m) => needed.has(m.id)));
};

const rangeArgs = (ctx: StudioToolContext, args: Record<string, unknown>) => {
  const s = ctx.getState();
  const mix = readSoundMix(ctx);
  const sel = args.useSelection === true ? mix.ui.selection : null;
  const start = typeof args.start === 'number' && Number.isFinite(args.start) ? Math.max(0, args.start) : sel?.start ?? 0;
  const endRaw = typeof args.end === 'number' && Number.isFinite(args.end) ? args.end : sel?.end ?? contentEnd(ctx);
  const end = Math.min(start + 4 * 3600, endRaw);
  if (!(end > start)) throw new Error(s.timelineClips.length ? 'Leerer Bereich: end muss nach start liegen.' : 'Die Timeline hat keine Audio-Clips.');
  return { start, end };
};

const fmt = (value: number, digits = 1) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

const RANGE_PROPS = {
  start: { type: 'number', description: 'Start in Sekunden (Standard: 0)' },
  end: { type: 'number', description: 'Ende in Sekunden (Standard: Ende des letzten Audio-Clips)' },
  useSelection: { type: 'boolean', description: 'Den Selector-Bereich der Sound-Seite verwenden' },
} as const;

const readTools: StudioTool[] = [
  {
    name: 'sound_get_mix',
    description: 'Liest die Mischung: Spuren (Fader dB, Pan, Mute/Solo, Ausgang, Stem-Rolle, Inserts, Sends, Automation), Busse, Master (Limiter, Ziel-LUFS), ADR-Cues und den Zustand der Sound-Seite (Ansicht fairlight/protools/studio, Edit-Modus, Werkzeug, Auswahl). Mit trackId alle Details einer Spur (Insert-Parameter, Automationspunkte).',
    parameters: { type: 'object', properties: { trackId: { type: 'string', description: 'optional: nur diese Spur mit allen Details' } } },
    handler: (args, ctx) => {
      const s = ctx.getState();
      const mix = readSoundMix(ctx);
      if (typeof args.trackId === 'string') {
        const track = s.timelineTracks.find((t) => t.id === args.trackId);
        if (!track) throw new Error(`Spur „${args.trackId}“ gibt es nicht.`);
        const clips = s.timelineClips.filter((c) => c.trackId === track.id).map((c) => ({
          id: c.id, mediaId: c.mediaId, start: c.start, end: c.end, clipGainDb: fmt(gainToDb(c.volume ?? 1), 2),
          volumeKeyframes: (c.keyframes ?? []).filter((k) => k.property === 'volume').length,
          fadeIn: mix.clips[c.id]?.fadeIn ?? null, fadeOut: mix.clips[c.id]?.fadeOut ?? null,
        }));
        return { track: describeTrack(mix, track, true), clips };
      }
      return {
        tracks: s.timelineTracks.map((t) => describeTrack(mix, t, false)),
        buses: mix.buses.map((b) => ({ ...b, gainDb: b.gainDb <= MIN_DB ? null : b.gainDb, inserts: b.inserts.map((x) => ({ id: x.id, kind: x.kind, bypass: x.bypass })) })),
        master: mix.master,
        adrCues: mix.adrCues,
        ui: mix.ui,
        stemBuses: Object.fromEntries(STEM_ROLES.map((r) => [r, STEM_BUS_IDS[r]])),
        hint: 'Clip-Gain = clip.volume (sound_clip_set_gain), Fader = sound_mixer_set_fader, Ansicht = sound_view_set.',
      };
    },
  },
  {
    name: 'sound_list_commands',
    description: 'Listet alle Sound-Befehle mit Gruppe, Beschreibung, Tastenkürzel, Parametern und dem passenden MCP-Toolnamen.',
    parameters: { type: 'object', properties: { group: { type: 'string', description: 'optional: Mixer, Bus, Clip, Bearbeiten, Automation, Ansicht, Transport, ADR, Studio' } } },
    handler: (args) => ({
      commands: describeSoundCommands()
        .filter((c) => typeof args.group !== 'string' || c.group === args.group)
        .map((c) => ({ tool: soundToolName(c.id), ...c })),
    }),
  },
  {
    name: 'sound_get_meters',
    description: 'Misst Pegel an einer Zeitposition (Standard: Abspielposition) über ein kurzes Fenster: Peak und RMS in dBFS je Spur, Bus und Master, Gain Reduction der Dynamics, dazu Momentary-Loudness des Masters. Gerechnet mit derselben Engine wie die Wiedergabe.',
    parameters: { type: 'object', properties: { time: { type: 'number', description: 'Sekunden, Standard: Abspielposition' }, window: { type: 'number', description: 'Messfenster in Sekunden (0.05–3, Standard 0.4)' } } },
    handler: async (args, ctx) => {
      const time = typeof args.time === 'number' && Number.isFinite(args.time) ? Math.max(0, args.time) : ctx.getState().playheadPosition;
      const windowSec = Math.min(3, Math.max(0.05, typeof args.window === 'number' ? args.window : 0.4));
      const start = Math.max(0, time - windowSec / 2);
      const { missing } = await ensureSources(ctx, start, start + windowSec);
      const engine = new MixEngine({ sampleRate: ENGINE_SAMPLE_RATE, getSource: (id) => sourceCache.get(id) });
      engine.setDocument(engineDoc(ctx));
      // pre-roll so filters and compressors settle
      const preroll = Math.round(Math.min(start, 0.2) * ENGINE_SAMPLE_RATE);
      const startFrame = Math.round(start * ENGINE_SAMPLE_RATE);
      const frames = Math.round(windowSec * ENGINE_SAMPLE_RATE);
      if (preroll > 0) {
        engine.render(startFrame - preroll, preroll, new Float32Array(preroll), new Float32Array(preroll));
      }
      engine.resetMeters();
      const l = new Float32Array(frames), r = new Float32Array(frames);
      engine.render(startFrame, frames, l, r);
      const meter = new LoudnessMeter(ENGINE_SAMPLE_RATE);
      meter.push(l, r, frames);
      const read = (m: Parameters<typeof MixEngine.readMeter>[0]) => {
        const v = MixEngine.readMeter(m);
        return { peakDb: v.peakDb.map((x) => fmt(x)), rmsDb: v.rmsDb.map((x) => fmt(x)), gainReductionDb: fmt(v.reductionDb) };
      };
      return {
        time, window: windowSec,
        tracks: Object.fromEntries(Object.entries(engine.meters.tracks).map(([id, m]) => [id, read(m)])),
        buses: Object.fromEntries(Object.entries(engine.meters.buses).map(([id, m]) => [id, read(m)])),
        master: { ...read(engine.meters.master), lufs: fmt(meter.summary().integratedLufs) },
        ...(missing.length ? { warnings: missing.map((n) => `Audio von „${n}“ nicht ladbar, zählt als stumm.`) } : {}),
      };
    },
  },
  {
    name: 'sound_measure_loudness',
    description: 'Misst die Loudness der Mischung nach EBU R128 / ITU-R BS.1770 über einen Bereich: Integrated LUFS, Loudness Range (LU), max. Momentary/Short-term, True Peak und Sample Peak (dBTP/dBFS), Abstand zum Master-Ziel. Optional nur ein Stem (dialog, music, effects, ambience).',
    parameters: { type: 'object', properties: { ...RANGE_PROPS, stem: { type: 'string', description: 'optional: dialog | music | effects | ambience' } } },
    handler: async (args, ctx) => {
      const { start, end } = rangeArgs(ctx, args);
      const { missing } = await ensureSources(ctx, start, end);
      let mix = readSoundMix(ctx);
      if (typeof args.stem === 'string') {
        if (!(STEM_ROLES as string[]).includes(args.stem)) throw new Error('stem muss dialog, music, effects oder ambience sein.');
        mix = stemMix(mix, STEM_BUS_IDS[args.stem as keyof typeof STEM_BUS_IDS], ctx.getState().timelineTracks.map((t) => t.id));
      }
      const result = bounceMix(engineDoc(ctx, mix), (id) => sourceCache.get(id), { sampleRate: ENGINE_SAMPLE_RATE, start, end });
      const l = result.loudness;
      const target = readSoundMix(ctx).master.targetLufs;
      return {
        start, end,
        integratedLufs: fmt(l.integratedLufs), rangeLu: fmt(l.rangeLu),
        momentaryMaxLufs: fmt(l.momentaryMaxLufs), shortTermMaxLufs: fmt(l.shortTermMaxLufs),
        truePeakDbtp: fmt(l.truePeakDb), samplePeakDbfs: fmt(l.samplePeakDb),
        targetLufs: target,
        offsetToTargetLu: Number.isFinite(l.integratedLufs) ? fmt(target - l.integratedLufs) : null,
        summary: Number.isFinite(l.integratedLufs) ? `${l.integratedLufs.toFixed(1)} LUFS (Ziel ${target}), True Peak ${formatDb(l.truePeakDb)} dBTP` : 'Stille im Bereich.',
        ...(missing.length ? { warnings: missing.map((n) => `Audio von „${n}“ nicht ladbar, zählt als stumm.`) } : {}),
      };
    },
  },
  {
    name: 'sound_mixdown',
    description: 'Rendert die Mischung (oder Stems) als WAV mit derselben Engine wie die Wiedergabe und legt das Ergebnis im Medienpool ab; mit Projektordner wird die Datei unter exports/audio/ gespeichert. Optional normalisiert auf das Master-Ziel (LUFS, True-Peak-begrenzt).',
    writes: true,
    parameters: {
      type: 'object',
      properties: {
        ...RANGE_PROPS,
        stems: { type: 'boolean', description: 'Zusätzlich je Stem-Bus (Dialog, Musik, Effekte, Atmo) eine Datei' },
        normalize: { type: 'boolean', description: 'Auf Master-Ziel-LUFS normalisieren (Standard: aus)' },
        bitDepth: { type: 'number', description: '16, 24 (Standard) oder 32 (float)' },
        name: { type: 'string', description: 'Dateiname ohne Endung (Standard: Mixdown)' },
        addToMediaPool: { type: 'boolean', description: 'Ergebnis in den Medienpool legen (Standard: ja)' },
      },
    },
    handler: async (args, ctx) => {
      const { start, end } = rangeArgs(ctx, args);
      const { missing } = await ensureSources(ctx, start, end);
      const runtime = getSoundRuntime();
      const s = ctx.getState();
      const bitDepth = args.bitDepth === 16 ? 'pcm16' : args.bitDepth === 32 ? 'float32' : 'pcm24';
      const base = (typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'Mixdown').replace(/[^\w\- äöüÄÖÜß]+/g, '_').slice(0, 60);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const mix = readSoundMix(ctx);
      const jobs: Array<{ label: string; mix: SoundMix; normalize: boolean }> = [{ label: base, mix, normalize: args.normalize === true }];
      if (args.stems === true) {
        for (const role of STEM_ROLES) jobs.push({ label: `${base}-${role}`, mix: stemMix(mix, STEM_BUS_IDS[role], s.timelineTracks.map((t) => t.id)), normalize: false });
      }
      const files: Array<Record<string, unknown>> = [];
      for (const job of jobs) {
        const result = bounceMix(engineDoc(ctx, job.mix), (id) => sourceCache.get(id), { sampleRate: ENGINE_SAMPLE_RATE, start, end, normalize: job.normalize });
        const bytes = encodeWav(result.channels, result.sampleRate, bitDepth);
        const fileName = `${job.label}-${stamp}.wav`;
        let url: string | null = null;
        let path: string | null = null;
        if (s.projectPath && runtime.writeProjectFile) {
          const written = await runtime.writeProjectFile(s.projectPath, `exports/audio/${fileName}`, bytes);
          url = written.url;
          path = written.path;
        } else if (runtime.createObjectUrl) {
          url = runtime.createObjectUrl(bytes, 'audio/wav');
        }
        let mediaId: string | null = null;
        if (url && args.addToMediaPool !== false) {
          mediaId = `media-mixdown-${Date.now().toString(36)}-${files.length}`;
          ctx.actions.addMediaItem({ id: mediaId, name: fileName, type: 'audio', url, source: 'generated', generatedBy: 'Sound-Mixdown', duration: end - start });
        }
        files.push({
          name: fileName, path, mediaId, bytes: bytes.byteLength,
          integratedLufs: fmt(result.loudness.integratedLufs), truePeakDbtp: fmt(result.loudness.truePeakDb), appliedGainDb: fmt(result.appliedGainDb, 2),
        });
      }
      return {
        start, end, sampleRate: ENGINE_SAMPLE_RATE, files,
        ...(missing.length ? { warnings: missing.map((n) => `Audio von „${n}“ nicht ladbar, im Mixdown stumm.`) } : {}),
      };
    },
  },
];

export const SOUND_TOOLS: StudioTool[] = [...readTools, ...commandTools];

registerStudioToolModule({ id: 'sound', label: 'Sound (Fairlight / Pro Tools / Studio)', tools: SOUND_TOOLS });
