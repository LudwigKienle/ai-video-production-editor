/**
 * MCP tools: sequence markers, timeline editing (ripple delete, lift,
 * extract, edit points), program In/Out, playback resolution, J/K/L shuttle,
 * track heights / zoom, editor workspaces and the Import/Edit/Export mode bar.
 *
 * Project data (clips, playhead, markers in `extras.markers`) goes through
 * `ctx`; UI-local editor state (In/Out, playback resolution, workspace,
 * shuttle, track heights, zoom) through live commands that EditWorkspace and
 * Timeline register while mounted.
 */
import {
    addMarker,
    nextMarker,
    normalizeMarkers,
    previousMarker,
    removeMarker,
    rippleMarkers,
    updateMarker,
    MARKER_COLORS,
    type MarkerColorId,
    type SequenceMarker,
} from '../../workspaces/edit-pro/markers.ts';
import { adjacentEditPoint, editPoints, extractRange, liftRange, rangeEditTracks, rippleDeleteClip } from '../../workspaces/edit-pro/editOps.ts';
import { parseTimecodeInput } from '../../workspaces/edit-pro/timecodeInput.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import { findClip, numArg, registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';
import type { Workspace } from '../../types.ts';

export const TIMELINE_FPS = 24;
const COLOR_IDS = MARKER_COLORS.map((entry) => entry.id);

/** Live command names (registered by EditWorkspace / Timeline). */
export const EDIT_LIVE = {
    state: 'edit.state',
    inOut: 'edit.inOut.set',
    resolution: 'edit.playbackResolution.set',
    workspace: 'edit.workspace.set',
    shuttle: 'edit.shuttle',
    linked: 'edit.linkedSelection.set',
    sourceEdit: 'edit.source.edit',
    zoom: 'timeline.view.zoom',
    trackHeight: 'timeline.view.trackHeight',
} as const;

const markersOf = (ctx: StudioToolContext): SequenceMarker[] => normalizeMarkers(ctx.getState().extras.markers);
const saveMarkers = (ctx: StudioToolContext, markers: SequenceMarker[]) => ctx.actions.setExtra('markers', markers);
const sequenceEnd = (ctx: StudioToolContext) => ctx.getState().timelineClips.reduce((max, clip) => Math.max(max, clip.end), 0);

/** Seconds from a number, a plain number string ("16", "5.5" = seconds) or a timecode ("00:00:05:12", "+12" frames …). */
const timeArg = (args: Record<string, unknown>, key: string, ctx: StudioToolContext, fallback?: number): number => {
    const value = args[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
    if (typeof value === 'string' && value.trim()) {
        // Agents send "16" or "5.5" meaning seconds. The timecode field would read bare digits as
        // typed frames ("16" = 16 frames, "5.5" = 5 s 5 frames), so plain numbers are seconds here.
        const plain = /^\s*(\d+(?:[.,]\d+)?)\s*$/.exec(value);
        if (plain) return Math.max(0, Math.round(Number(plain[1].replace(',', '.')) * TIMELINE_FPS) / TIMELINE_FPS);
        const parsed = parseTimecodeInput(value, TIMELINE_FPS, ctx.getState().playheadPosition);
        if (parsed === null) throw new Error(`Cannot read time "${value}" (use seconds or hh:mm:ss:ff).`);
        return parsed;
    }
    if (fallback !== undefined) return fallback;
    throw new Error(`Parameter "${key}" is required (seconds or timecode).`);
};

const colorArg = (args: Record<string, unknown>): MarkerColorId | undefined => {
    if (args.color === undefined) return undefined;
    if (!COLOR_IDS.includes(args.color as MarkerColorId)) throw new Error(`Unknown colour ${String(args.color)} (use ${COLOR_IDS.join(', ')}).`);
    return args.color as MarkerColorId;
};

const openEdit = (ctx: StudioToolContext) => ({ openWorkspace: () => ctx.actions.setActiveWorkspace('EDIT'), workspace: 'EDIT' as Workspace });

/** Program In/Out: explicit args win, otherwise the marks set in the editor. */
async function resolveRange(args: Record<string, unknown>, ctx: StudioToolContext): Promise<{ start: number; end: number }> {
    let inPoint: number | null = args.in !== undefined ? timeArg(args, 'in', ctx) : null;
    let outPoint: number | null = args.out !== undefined ? timeArg(args, 'out', ctx) : null;
    if (inPoint === null && outPoint === null) {
        const live = await invokeLiveCommand(EDIT_LIVE.state, {}, { ...openEdit(ctx), timeoutMs: 1500 }).catch(() => null) as { programIn?: number | null; programOut?: number | null } | null;
        inPoint = live?.programIn ?? null;
        outPoint = live?.programOut ?? null;
    }
    if (inPoint === null && outPoint === null) throw new Error('No range: pass in/out or set program In/Out first (timeline_set_in_out).');
    const start = inPoint ?? 0;
    const end = outPoint ?? sequenceEnd(ctx);
    if (!(end > start)) throw new Error('Out must be after In.');
    return { start, end };
}

const makeId = () => `clip-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

async function rangeEdit(mode: 'lift' | 'extract', args: Record<string, unknown>, ctx: StudioToolContext) {
    const { start, end } = await resolveRange(args, ctx);
    const state = ctx.getState();
    const trackIds = Array.isArray(args.trackIds) && args.trackIds.length > 0
        ? (args.trackIds as unknown[]).filter((id): id is string => typeof id === 'string')
        : rangeEditTracks(state.timelineTracks);
    const op = mode === 'lift' ? liftRange : extractRange;
    const result = op(state.timelineClips, trackIds, start, end, { makeId, minLength: 1 / TIMELINE_FPS });
    if (result.changed) {
        ctx.actions.setTimelineClips(result.clips);
        if (mode === 'extract') saveMarkers(ctx, rippleMarkers(markersOf(ctx), start, end));
        if (state.selectedClipId && result.removedIds.includes(state.selectedClipId)) ctx.actions.selectClip(null);
        ctx.actions.setPlayhead(start);
        await invokeLiveCommand(EDIT_LIVE.inOut, { in: null, out: null }, { timeoutMs: 300 }).catch(() => null);
    }
    return { changed: result.changed, in: start, out: end, trackIds, removedClipIds: result.removedIds, addedClipIds: result.addedIds, clipCount: result.clips.length };
}

const live = (name: string, args: Record<string, unknown>, ctx: StudioToolContext) =>
    invokeLiveCommand(name, args, openEdit(ctx)).then((value) => (value && typeof value === 'object' ? value as Record<string, unknown> : { value }));

export const TIMELINE_TOOL_MODULE: StudioToolModule = {
    id: 'timeline',
    label: 'Timeline & Monitore (Schnitt)',
    tools: [
        /* ── Markers ── */
        {
            name: 'timeline_marker_list',
            description: `List sequence markers (id, time in seconds, name, color, comment, duration). Colors: ${COLOR_IDS.join(', ')}.`,
            parameters: { type: 'object', properties: {} },
            handler: (_args, ctx) => ({ fps: TIMELINE_FPS, markers: markersOf(ctx) }),
        },
        {
            name: 'timeline_marker_add',
            description: 'Add a sequence marker (like pressing M). time = seconds or timecode, defaults to the playhead. A marker on the same frame is reused.',
            writes: true,
            parameters: {
                type: 'object',
                properties: {
                    time: { type: 'string', description: 'Seconds (e.g. "5.5") or timecode "00:00:05:12"; default: playhead.' },
                    name: { type: 'string' },
                    color: { type: 'string', enum: COLOR_IDS },
                    comment: { type: 'string' },
                    duration: { type: 'number', description: 'Range length in seconds (0 = point marker).' },
                },
            },
            handler: (args, ctx) => {
                const time = timeArg(args, 'time', ctx, ctx.getState().playheadPosition);
                const result = addMarker(markersOf(ctx), time, {
                    fps: TIMELINE_FPS,
                    name: typeof args.name === 'string' ? args.name : undefined,
                    color: colorArg(args),
                    comment: typeof args.comment === 'string' ? args.comment : undefined,
                });
                let markers = result.markers;
                if (args.duration !== undefined) markers = updateMarker(markers, result.marker.id, { duration: numArg(args, 'duration') }, TIMELINE_FPS);
                saveMarkers(ctx, markers);
                return { created: result.created, marker: markers.find((marker) => marker.id === result.marker.id) ?? result.marker };
            },
        },
        {
            name: 'timeline_marker_update',
            description: 'Change name, color, comment, time or duration of a marker.',
            writes: true,
            parameters: {
                type: 'object',
                properties: {
                    markerId: { type: 'string' },
                    name: { type: 'string' },
                    color: { type: 'string', enum: COLOR_IDS },
                    comment: { type: 'string' },
                    time: { type: 'string', description: 'Seconds or timecode.' },
                    duration: { type: 'number' },
                },
                required: ['markerId'],
            },
            handler: (args, ctx) => {
                const markerId = str(args, 'markerId');
                const markers = markersOf(ctx);
                if (!markers.some((marker) => marker.id === markerId)) throw new Error(`Marker ${markerId} not found.`);
                const next = updateMarker(markers, markerId, {
                    name: typeof args.name === 'string' ? args.name : undefined,
                    comment: typeof args.comment === 'string' ? args.comment : undefined,
                    color: colorArg(args),
                    time: args.time !== undefined ? timeArg(args, 'time', ctx) : undefined,
                    duration: args.duration !== undefined ? numArg(args, 'duration') : undefined,
                }, TIMELINE_FPS);
                saveMarkers(ctx, next);
                return { marker: next.find((marker) => marker.id === markerId) };
            },
        },
        {
            name: 'timeline_marker_remove',
            description: 'Delete a sequence marker.',
            writes: true,
            parameters: { type: 'object', properties: { markerId: { type: 'string' } }, required: ['markerId'] },
            handler: (args, ctx) => {
                const markerId = str(args, 'markerId');
                const markers = markersOf(ctx);
                const next = removeMarker(markers, markerId);
                if (next === markers) throw new Error(`Marker ${markerId} not found.`);
                saveMarkers(ctx, next);
                return { removed: markerId, count: next.length };
            },
        },
        {
            name: 'timeline_marker_goto',
            description: 'Move the playhead to the next / previous marker (Shift+M / Cmd+Shift+M) or to a marker id.',
            parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['next', 'previous'] }, markerId: { type: 'string' } } },
            handler: (args, ctx) => {
                const markers = markersOf(ctx);
                const time = ctx.getState().playheadPosition;
                const target = typeof args.markerId === 'string'
                    ? markers.find((marker) => marker.id === args.markerId) ?? null
                    : args.direction === 'previous' ? previousMarker(markers, time, TIMELINE_FPS) : nextMarker(markers, time, TIMELINE_FPS);
                if (!target) return { moved: false, playhead: time };
                ctx.actions.setPlayhead(target.time);
                return { moved: true, playhead: target.time, marker: target };
            },
        },

        /* ── Clips ── */
        {
            name: 'timeline_list_clips',
            description: 'List the tracks and the clips on the timeline (id, media name and type, track, start/end/duration in seconds, source in/out, speed, selected, GPU effects). Optional trackId, or time (seconds) to list only the clips under that time. Use the ids with fx_*, timeline_select_clip and other clip tools.',
            parameters: {
                type: 'object',
                properties: {
                    trackId: { type: 'string', description: 'Only this track.' },
                    time: { type: 'number', description: 'Only clips under this time, in seconds.' },
                },
            },
            handler: (args, ctx) => {
                const state = ctx.getState();
                const at = args.time !== undefined && args.time !== '' ? timeArg(args, 'time', ctx) : null;
                const trackId = typeof args.trackId === 'string' && args.trackId ? args.trackId : null;
                const mediaById = new Map(state.mediaItems.map((item) => [item.id, item]));
                const order = new Map(state.timelineTracks.map((track, index) => [track.id, index]));
                const clips = state.timelineClips
                    .filter((clip) => (!trackId || clip.trackId === trackId) && (at === null || (clip.start <= at && at < clip.end)))
                    .sort((a, b) => (order.get(a.trackId) ?? 99) - (order.get(b.trackId) ?? 99) || a.start - b.start)
                    .map((clip) => {
                        const media = mediaById.get(clip.mediaId);
                        return {
                            id: clip.id,
                            name: clip.textConfig?.content ? `Text: ${clip.textConfig.content}` : media?.name ?? clip.mediaId,
                            mediaType: clip.textConfig ? 'text' : media?.type ?? null,
                            trackId: clip.trackId,
                            start: clip.start,
                            end: clip.end,
                            duration: clip.end - clip.start,
                            sourceIn: clip.sourceIn ?? 0,
                            sourceOut: clip.sourceOut ?? null,
                            speed: clip.speed,
                            selected: clip.id === state.selectedClipId,
                            fx: (clip.fxStack ?? []).map((entry) => entry.effectId),
                        };
                    });
                return {
                    playhead: state.playheadPosition,
                    selectedClipId: state.selectedClipId,
                    tracks: state.timelineTracks.map((track) => ({ id: track.id, name: track.name, type: track.type, locked: track.isLocked, muted: track.isMuted })),
                    clips,
                };
            },
        },
        {
            name: 'timeline_select_clip',
            description: 'Select a timeline clip (like clicking it): by clipId, or by time (seconds) for the topmost video clip under that time (optional trackId). Effect Controls and fx_* tools then act on it. moveTo = "start" also moves the playhead to the clip start.',
            parameters: {
                type: 'object',
                properties: {
                    clipId: { type: 'string' },
                    time: { type: 'number', description: 'Pick the clip under this time (seconds) instead of an id.' },
                    trackId: { type: 'string' },
                    moveTo: { type: 'string', enum: ['none', 'start'] },
                },
            },
            handler: (args, ctx) => {
                const state = ctx.getState();
                let clip = typeof args.clipId === 'string' && args.clipId ? state.timelineClips.find((entry) => entry.id === args.clipId) : undefined;
                if (!clip && args.time !== undefined && args.time !== '') {
                    const at = timeArg(args, 'time', ctx);
                    const trackId = typeof args.trackId === 'string' && args.trackId ? args.trackId : null;
                    // Topmost first: video tracks are listed bottom-up (V1 first), so prefer the highest index.
                    const order = new Map(state.timelineTracks.map((track, index) => [track.id, index]));
                    const videoTracks = new Set(state.timelineTracks.filter((track) => track.type === 'video').map((track) => track.id));
                    clip = state.timelineClips
                        .filter((entry) => entry.start <= at && at < entry.end && (trackId ? entry.trackId === trackId : videoTracks.has(entry.trackId)))
                        .sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0))[0];
                }
                if (!clip) throw new Error(args.clipId ? `Clip ${String(args.clipId)} not found.` : 'Pass clipId, or a time with a clip under it (see timeline_list_clips).');
                ctx.actions.selectClip(clip.id);
                if (args.moveTo === 'start') ctx.actions.setPlayhead(clip.start);
                return { selectedClipId: clip.id, trackId: clip.trackId, start: clip.start, end: clip.end };
            },
        },

        /* ── Playhead / edit points ── */
        {
            name: 'timeline_set_playhead',
            description: 'Set the playhead: seconds (16 or "16", "2.5"), timecode "00:00:05:12", relative "+12" / "-12" frames or "-1:00", or "2.5s".',
            parameters: { type: 'object', properties: { time: { type: 'string' } }, required: ['time'] },
            handler: (args, ctx) => {
                const time = Math.min(Math.max(0, sequenceEnd(ctx)), timeArg(args, 'time', ctx));
                ctx.actions.setPlayhead(time);
                return { playhead: time };
            },
        },
        {
            name: 'timeline_goto_edit_point',
            description: 'Jump to the previous / next cut (Up / Down arrow). Optional trackIds limit the cuts considered.',
            parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['next', 'previous'] }, trackIds: { type: 'array', items: { type: 'string' } } }, required: ['direction'] },
            handler: (args, ctx) => {
                const state = ctx.getState();
                const ids = Array.isArray(args.trackIds) ? (args.trackIds as unknown[]).filter((id): id is string => typeof id === 'string') : undefined;
                const target = adjacentEditPoint(editPoints(state.timelineClips, ids), state.playheadPosition, args.direction === 'previous' ? -1 : 1);
                if (target === null) return { moved: false, playhead: state.playheadPosition };
                ctx.actions.setPlayhead(target);
                return { moved: true, playhead: target };
            },
        },

        /* ── Editing ── */
        {
            name: 'timeline_ripple_delete',
            description: 'Delete a clip and close the gap on its track (Shift+Delete). Selected clip if clipId is omitted.',
            writes: true,
            parameters: { type: 'object', properties: { clipId: { type: 'string' } } },
            handler: (args, ctx) => {
                const clip = findClip(ctx, args.clipId);
                const track = ctx.getState().timelineTracks.find((entry) => entry.id === clip.trackId);
                if (track?.isLocked) throw new Error(`Track ${track.name || track.id} is locked.`);
                ctx.actions.setTimelineClips(rippleDeleteClip(ctx.getState().timelineClips, clip.id));
                if (ctx.getState().selectedClipId === clip.id) ctx.actions.selectClip(null);
                return { removed: clip.id, closedGap: clip.end - clip.start };
            },
        },
        {
            name: 'timeline_lift',
            description: 'Lift (;): remove the In/Out range from the targeted tracks (or trackIds), leaving a gap. Uses in/out args or the program In/Out.',
            writes: true,
            parameters: { type: 'object', properties: { in: { type: 'string', description: 'Seconds or timecode.' }, out: { type: 'string' }, trackIds: { type: 'array', items: { type: 'string' } } } },
            handler: (args, ctx) => rangeEdit('lift', args, ctx),
        },
        {
            name: 'timeline_extract',
            description: "Extract ('): remove the In/Out range and close the gap (later clips and markers move left).",
            writes: true,
            parameters: { type: 'object', properties: { in: { type: 'string' }, out: { type: 'string' }, trackIds: { type: 'array', items: { type: 'string' } } } },
            handler: (args, ctx) => rangeEdit('extract', args, ctx),
        },
        {
            name: 'timeline_source_edit',
            description: 'Insert (,) or overwrite (.) the source monitor range at the playhead / program In (pro editor).',
            writes: true,
            parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['insert', 'overwrite'] }, mediaId: { type: 'string', description: 'Optional: load this project media into the source monitor first.' } }, required: ['mode'] },
            handler: (args, ctx) => live(EDIT_LIVE.sourceEdit, { mode: args.mode === 'overwrite' ? 'overwrite' : 'insert', mediaId: args.mediaId }, ctx),
        },

        /* ── Editor state (UI-local, live commands) ── */
        {
            name: 'timeline_editor_state',
            description: 'Read the editor UI state: pro workspace, tool, program/source In/Out, playback resolution, linked selection, shuttle rate.',
            parameters: { type: 'object', properties: {} },
            handler: (_args, ctx) => live(EDIT_LIVE.state, {}, ctx),
        },
        {
            name: 'timeline_set_in_out',
            description: 'Set or clear the program In/Out marks (I / O). Pass null-like "" to clear one side; clear=true clears both.',
            parameters: { type: 'object', properties: { in: { type: 'string' }, out: { type: 'string' }, clear: { type: 'boolean' } } },
            handler: async (args, ctx) => {
                if (args.clear === true) return live(EDIT_LIVE.inOut, { in: null, out: null }, ctx);
                const payload: Record<string, unknown> = {};
                if (args.in !== undefined) payload.in = args.in === '' ? null : timeArg(args, 'in', ctx);
                if (args.out !== undefined) payload.out = args.out === '' ? null : timeArg(args, 'out', ctx);
                return live(EDIT_LIVE.inOut, payload, ctx);
            },
        },
        {
            name: 'timeline_set_playback_resolution',
            description: 'Playback resolution of the program / source monitor: full, half, quarter (GPU effect preview only; export stays full).',
            parameters: { type: 'object', properties: { program: { type: 'string', enum: ['full', 'half', 'quarter'] }, source: { type: 'string', enum: ['full', 'half', 'quarter'] } } },
            handler: (args, ctx) => live(EDIT_LIVE.resolution, { program: args.program, source: args.source }, ctx),
        },
        {
            name: 'timeline_shuttle',
            description: 'J/K/L shuttle: rate -4, -2, -1, 0, 1, 2, 4 (0 stops), or key "j" | "k" | "l" to step like the keyboard.',
            parameters: { type: 'object', properties: { rate: { type: 'number', minimum: -4, maximum: 4 }, key: { type: 'string', enum: ['j', 'k', 'l'] } } },
            handler: (args, ctx) => live(EDIT_LIVE.shuttle, { rate: args.rate, key: args.key }, ctx),
        },
        {
            name: 'timeline_linked_selection',
            description: 'Turn linked selection (move video and audio of the same media together) on or off.',
            parameters: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] },
            handler: (args, ctx) => live(EDIT_LIVE.linked, { enabled: args.enabled === true }, ctx),
        },
        {
            name: 'timeline_track_height',
            description: 'Track heights in px (28–220): set height for trackId (or all tracks), or step=1 / -1 for all (Shift+= / Shift+-), reset=true for defaults.',
            parameters: { type: 'object', properties: { trackId: { type: 'string' }, height: { type: 'number', minimum: 28, maximum: 220 }, step: { type: 'integer', enum: [-1, 1] }, reset: { type: 'boolean' } } },
            handler: (args, ctx) => live(EDIT_LIVE.trackHeight, { trackId: args.trackId, height: args.height, step: args.step, reset: args.reset }, ctx),
        },
        {
            name: 'timeline_zoom',
            description: 'Timeline zoom: direction in / out / fit (= / - / \\) or pixelsPerSecond (3–400).',
            parameters: { type: 'object', properties: { direction: { type: 'string', enum: ['in', 'out', 'fit'] }, pixelsPerSecond: { type: 'number', minimum: 3, maximum: 400 } } },
            handler: (args, ctx) => live(EDIT_LIVE.zoom, { direction: args.direction, pixelsPerSecond: args.pixelsPerSecond }, ctx),
        },
        {
            name: 'timeline_layout_set',
            description: 'Switch the editor layout (Edit page workspaces): schnitt, farbe, effekte, audio, klassisch. reset=true restores the default panel arrangement.',
            parameters: { type: 'object', properties: { layout: { type: 'string', enum: ['schnitt', 'farbe', 'effekte', 'audio', 'klassisch'] }, reset: { type: 'boolean' } }, required: ['layout'] },
            handler: (args, ctx) => {
                const map: Record<string, string> = { schnitt: 'editing', farbe: 'color', effekte: 'effects', audio: 'audio', klassisch: 'classic', editing: 'editing', color: 'color', effects: 'effects', classic: 'classic' };
                const workspace = map[str(args, 'layout').toLowerCase()];
                if (!workspace) throw new Error('layout must be schnitt, farbe, effekte, audio or klassisch.');
                return live(EDIT_LIVE.workspace, { workspace, reset: args.reset === true }, ctx).then((result) => ({ ...result, layout: str(args, 'layout').toLowerCase() }));
            },
        },
        {
            name: 'timeline_mode_switch',
            description: 'Header mode bar: importieren (IMPORT page), bearbeiten (EDIT), exportieren (EXPORT).',
            parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['importieren', 'bearbeiten', 'exportieren'] } }, required: ['mode'] },
            handler: (args, ctx) => {
                const map: Record<string, Workspace> = { importieren: 'IMPORT', bearbeiten: 'EDIT', exportieren: 'EXPORT', import: 'IMPORT', edit: 'EDIT', export: 'EXPORT' };
                const workspace = map[str(args, 'mode').toLowerCase()];
                if (!workspace) throw new Error('mode must be importieren, bearbeiten or exportieren.');
                ctx.actions.setActiveWorkspace(workspace);
                return { activeWorkspace: workspace };
            },
        },
    ],
};

registerStudioToolModule(TIMELINE_TOOL_MODULE);
