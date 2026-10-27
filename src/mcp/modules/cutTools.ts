/**
 * MCP tools: Cut page (smart edit buttons, trim editor, blade, quick
 * transitions, source tape). Project edits run the pure functions of
 * `workspaces/cut-pro/editOps.ts` on the current timeline and write the result
 * with `setTimelineClips`; the page's viewer state (viewer mode, source clip,
 * In/Out marks, trim selection) is reached through live commands.
 */
import {
    appendToEnd, applyTrim, isEditFailure, bladeAt, buildSourceTape, closeUp, editPoints, findEditPoint, neighbours,
    pickTargetTrack, placeOnTop, quickTransitionDuration, rippleOverwrite, setTransitionOut, smartInsert,
    sortMedia, sourceOverwrite, tapeLength, CLOSE_UP_SCALE,
    type EditResult, type PoolSort, type QuickTransition, type TrimTarget, type TrimTool,
} from '../../workspaces/cut-pro/editOps.ts';
import { editSourceFor } from '../../workspaces/cut-pro/cutState.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import { numArg, registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';

const FPS = 24;
/** Value of TransitionType.CROSS_FADE (kept literal so this module has no enum import). */
const CROSS_FADE = 'Cross Fade';

let idCounter = 0;
const makeId = () => `clip-${Date.now()}-${(idCounter += 1)}`;

const mediaLengthFor = (media: MediaItem[]) => (mediaId: string) => {
    const item = media.find((entry) => entry.id === mediaId);
    if (!item) return 5;
    return item.type === 'image' ? Number.POSITIVE_INFINITY : Math.max(0.05, item.duration || 5);
};

const sourceFromArgs = (ctx: StudioToolContext, args: Record<string, unknown>) => {
    const mediaId = str(args, 'mediaId');
    const media = ctx.getState().mediaItems.find((entry) => entry.id === mediaId);
    if (!media) throw new Error(`Media ${mediaId} not found.`);
    const markIn = typeof args.sourceIn === 'number' ? numArg(args, 'sourceIn') : null;
    const markOut = typeof args.sourceOut === 'number' ? numArg(args, 'sourceOut') : null;
    const source = editSourceFor(media, { in: markIn, out: markOut });
    if (!source) throw new Error('sourceIn/sourceOut leave no usable range.');
    return source;
};

const targetTrackFor = (ctx: StudioToolContext, mediaType: MediaItem['type'], requested: unknown) => {
    const state = ctx.getState();
    if (typeof requested === 'string' && requested) {
        const track = state.timelineTracks.find((entry) => entry.id === requested);
        if (!track) throw new Error(`Track ${requested} not found.`);
        return track;
    }
    const track = pickTargetTrack(state.timelineTracks, mediaType, null);
    if (!track) throw new Error(`No unlocked ${mediaType === 'audio' ? 'audio' : 'video'} track.`);
    return track;
};

const newTrack = (type: 'video' | 'audio', existing: TimelineTrack[]): TimelineTrack => {
    const count = existing.filter((track) => track.type === type).length + 1;
    return { id: `${type}-${Date.now()}-${(idCounter += 1)}`, name: `${type === 'video' ? 'V' : 'A'}${count}`, type, isLocked: false, isMuted: false, isTargeted: false, isSolo: false };
};

/**
 * Runs an edit; when it needs a free track above, adds one (like the page does) and
 * retries once. Writes clips, selection and playhead.
 */
const runEdit = (ctx: StudioToolContext, edit: () => EditResult<TimelineClip>, addTrack = true) => {
    let result = edit();
    let addedTrackId: string | null = null;
    if (isEditFailure(result) && result.needsTrack && addTrack) {
        const tracks = ctx.getState().timelineTracks;
        const track = newTrack(result.needsTrack, tracks);
        ctx.actions.setTimelineTracks([...tracks, track]);
        addedTrackId = track.id;
        result = edit();
    }
    if (isEditFailure(result)) throw new Error(result.message);
    ctx.actions.setTimelineClips(result.clips);
    ctx.actions.selectClip(result.selectId);
    if (typeof result.playhead === 'number') ctx.actions.setPlayhead(result.playhead);
    const clip = result.clips.find((entry) => entry.id === result.selectId) || null;
    return { clipId: result.selectId, trackId: result.trackId ?? null, addedTrackId, clip, playhead: result.playhead ?? null, clipCount: result.clips.length };
};

const at = (ctx: StudioToolContext, args: Record<string, unknown>, key = 'at') =>
    Math.max(0, typeof args[key] === 'number' || typeof args[key] === 'string' ? numArg(args, key) : ctx.getState().playheadPosition);

const sourceProps = {
    mediaId: { type: 'string' as const, description: 'Media pool item id (see project media list).' },
    sourceIn: { type: 'number' as const, description: 'Source In in media seconds (default 0).' },
    sourceOut: { type: 'number' as const, description: 'Source Out in media seconds (default: media end).' },
};

const VIEWER_COMMAND_OPTIONS = (ctx: StudioToolContext) => ({ openWorkspace: () => ctx.actions.setActiveWorkspace('TRIM'), workspace: 'TRIM' as const });

export const CUT_TOOL_MODULE: StudioToolModule = {
    id: 'cut',
    label: 'Cut page',
    tools: [
        {
            name: 'cut_smart_insert',
            description: 'Smart Insert: insert a media range at the edit point nearest the playhead (or "at") on the target track; later clips on all unlocked tracks ripple right.',
            writes: true,
            parameters: { type: 'object', properties: { ...sourceProps, trackId: { type: 'string' }, at: { type: 'number', description: 'Sequence seconds, default playhead.' } }, required: ['mediaId'] },
            handler: (args, ctx) => {
                const source = sourceFromArgs(ctx, args);
                const track = targetTrackFor(ctx, source.mediaType, args.trackId);
                const time = at(ctx, args);
                return runEdit(ctx, () => { const s = ctx.getState(); return smartInsert(s.timelineClips, s.timelineTracks, track.id, source, time, makeId); }, false);
            },
        },
        {
            name: 'cut_append',
            description: 'Append: put a media range after the last clip of the sequence on the target track.',
            writes: true,
            parameters: { type: 'object', properties: { ...sourceProps, trackId: { type: 'string' } }, required: ['mediaId'] },
            handler: (args, ctx) => {
                const source = sourceFromArgs(ctx, args);
                const track = targetTrackFor(ctx, source.mediaType, args.trackId);
                return runEdit(ctx, () => { const s = ctx.getState(); return appendToEnd(s.timelineClips, s.timelineTracks, track.id, source, makeId); }, false);
            },
        },
        {
            name: 'cut_ripple_overwrite',
            description: 'Ripple Overwrite: replace the clip under the playhead (or "at") on the target track with the media range; the rest of the sequence ripples by the length difference.',
            writes: true,
            parameters: { type: 'object', properties: { ...sourceProps, trackId: { type: 'string' }, at: { type: 'number' } }, required: ['mediaId'] },
            handler: (args, ctx) => {
                const source = sourceFromArgs(ctx, args);
                const track = targetTrackFor(ctx, source.mediaType, args.trackId);
                const time = at(ctx, args);
                return runEdit(ctx, () => { const s = ctx.getState(); return rippleOverwrite(s.timelineClips, s.timelineTracks, track.id, source, time, makeId); }, false);
            },
        },
        {
            name: 'cut_close_up',
            description: `Close Up: duplicate the video clip under the playhead (from the playhead to its end, or rangeStart..rangeEnd) onto a free track above, punched in by "scale" (default ${CLOSE_UP_SCALE}). Adds a video track when needed.`,
            writes: true,
            parameters: { type: 'object', properties: { trackId: { type: 'string', description: 'Track of the clip to punch in on (default: top-most clip under the playhead).' }, at: { type: 'number' }, scale: { type: 'number', minimum: 1, maximum: 4 }, rangeStart: { type: 'number' }, rangeEnd: { type: 'number' } } },
            handler: (args, ctx) => {
                const time = at(ctx, args);
                const scale = Math.min(4, Math.max(1, numArg(args, 'scale', CLOSE_UP_SCALE)));
                const range = typeof args.rangeStart === 'number' && typeof args.rangeEnd === 'number' ? { start: numArg(args, 'rangeStart'), end: numArg(args, 'rangeEnd') } : null;
                const trackId = typeof args.trackId === 'string' ? args.trackId : null;
                return runEdit(ctx, () => { const s = ctx.getState(); return closeUp(s.timelineClips, s.timelineTracks, trackId, time, makeId, { scale, range }); });
            },
        },
        {
            name: 'cut_place_on_top',
            description: 'Place on Top: put the media range at the playhead (or "at") on the first free track above everything there. Adds a track when needed.',
            writes: true,
            parameters: { type: 'object', properties: { ...sourceProps, at: { type: 'number' } }, required: ['mediaId'] },
            handler: (args, ctx) => {
                const source = sourceFromArgs(ctx, args);
                const time = at(ctx, args);
                return runEdit(ctx, () => { const s = ctx.getState(); return placeOnTop(s.timelineClips, s.timelineTracks, source, time, makeId); });
            },
        },
        {
            name: 'cut_source_overwrite',
            description: 'Source Overwrite: lay the media range on a free track above so that the source frame "sourceAnchor" (media seconds, default sourceIn) lines up with the playhead (or "at"). Adds a track when needed.',
            writes: true,
            parameters: { type: 'object', properties: { ...sourceProps, sourceAnchor: { type: 'number' }, trackId: { type: 'string', description: 'Base track; the clip goes above it.' }, at: { type: 'number' } }, required: ['mediaId'] },
            handler: (args, ctx) => {
                const source = sourceFromArgs(ctx, args);
                const time = at(ctx, args);
                const anchor = numArg(args, 'sourceAnchor', source.sourceIn);
                const base = typeof args.trackId === 'string' ? args.trackId : pickTargetTrack(ctx.getState().timelineTracks, 'video', null)?.id ?? null;
                return runEdit(ctx, () => { const s = ctx.getState(); return sourceOverwrite(s.timelineClips, s.timelineTracks, base, source, anchor, time, makeId); });
            },
        },
        {
            name: 'cut_trim',
            description: 'Trim editor: mode "ripple" | "trim" (no ripple) | "roll" move an edge of clipId ("edge": "in" or "out"); "slip" | "slide" move the whole clip. "frames" is signed (24 fps). Clamped to media handles and neighbours; returns the applied frames.',
            writes: true,
            parameters: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['ripple', 'trim', 'roll', 'slip', 'slide'] },
                    frames: { type: 'number', description: 'Signed frame count, e.g. -1, 5.' },
                    clipId: { type: 'string', description: 'Default: selected clip.' },
                    edge: { type: 'string', enum: ['in', 'out'], description: 'For ripple/trim/roll. Default out.' },
                },
                required: ['mode', 'frames'],
            },
            handler: (args, ctx) => {
                const state = ctx.getState();
                const mode = str(args, 'mode') as 'ripple' | 'trim' | 'roll' | 'slip' | 'slide';
                if (!['ripple', 'trim', 'roll', 'slip', 'slide'].includes(mode)) throw new Error(`Unknown mode ${mode}.`);
                const frames = Math.round(numArg(args, 'frames'));
                const clipId = typeof args.clipId === 'string' && args.clipId ? args.clipId : state.selectedClipId;
                const clip = state.timelineClips.find((entry) => entry.id === clipId);
                if (!clip) throw new Error(clipId ? `Clip ${clipId} not found.` : 'No clip selected; pass clipId.');
                let target: TrimTarget;
                if (mode === 'slip' || mode === 'slide') target = { kind: 'clip', clipId: clip.id };
                else {
                    const edge = args.edge === 'in' ? 'in' : 'out';
                    const near = neighbours(state.timelineClips, clip);
                    target = edge === 'out'
                        ? { kind: 'edit', trackId: clip.trackId, time: clip.end, outgoingId: clip.id, incomingId: near.adjacentAfter?.id ?? null, side: mode === 'roll' ? 'both' : 'out' }
                        : { kind: 'edit', trackId: clip.trackId, time: clip.start, outgoingId: near.adjacentBefore?.id ?? null, incomingId: clip.id, side: mode === 'roll' ? 'both' : 'in' };
                }
                const tool: TrimTool = mode === 'trim' ? 'normal' : mode;
                const result = applyTrim(state.timelineClips, target, tool, frames / FPS, mediaLengthFor(state.mediaItems));
                if (result.applied !== 0) ctx.actions.setTimelineClips(result.clips);
                const appliedFrames = Math.round(result.applied * FPS);
                return { clipId: clip.id, mode, requestedFrames: frames, appliedFrames, clamped: appliedFrames !== frames, clip: result.clips.find((entry) => entry.id === clip.id) ?? null };
            },
        },
        {
            name: 'cut_blade',
            description: 'Blade (Cmd+B): cut every clip under the playhead (or "at") on all unlocked tracks, or only on trackIds.',
            writes: true,
            parameters: { type: 'object', properties: { at: { type: 'number' }, trackIds: { type: 'array', items: { type: 'string' } } } },
            handler: (args, ctx) => {
                const state = ctx.getState();
                const time = at(ctx, args);
                const trackIds = Array.isArray(args.trackIds) ? args.trackIds.filter((entry): entry is string => typeof entry === 'string') : null;
                const result = bladeAt(state.timelineClips, state.timelineTracks, time, makeId, trackIds);
                if (result.cut > 0) ctx.actions.setTimelineClips(result.clips);
                return { at: time, cut: result.cut, message: result.cut ? `${result.cut} clip(s) cut.` : 'Nothing under the playhead.' };
            },
        },
        {
            name: 'cut_transition_add',
            description: 'Quick transition at the end of a clip (outgoing side of the cut): "cut" removes it, "dissolve" = 1 s cross dissolve, "smooth" = short smooth cut (4 frames). Optional duration (seconds) overrides.',
            writes: true,
            parameters: { type: 'object', properties: { clipId: { type: 'string', description: 'Outgoing clip, default selected.' }, kind: { type: 'string', enum: ['cut', 'dissolve', 'smooth'] }, duration: { type: 'number' } }, required: ['kind'] },
            handler: (args, ctx) => {
                const state = ctx.getState();
                const kind = str(args, 'kind') as QuickTransition;
                if (!['cut', 'dissolve', 'smooth'].includes(kind)) throw new Error(`Unknown kind ${kind}.`);
                const clipId = typeof args.clipId === 'string' && args.clipId ? args.clipId : state.selectedClipId;
                const clip = state.timelineClips.find((entry) => entry.id === clipId);
                if (!clip) throw new Error(clipId ? `Clip ${clipId} not found.` : 'No clip selected; pass clipId.');
                const after = neighbours(state.timelineClips, clip).adjacentAfter;
                let duration = quickTransitionDuration(kind, clip.end - clip.start, after ? after.end - after.start : null, FPS);
                if (duration !== null && typeof args.duration === 'number') duration = Math.max(1 / FPS, Math.min(clip.end - clip.start, numArg(args, 'duration')));
                const transition = duration === null ? null : { type: CROSS_FADE, duration };
                ctx.actions.setTimelineClips(setTransitionOut(state.timelineClips, clip.id, transition) as TimelineClip[]);
                return { clipId: clip.id, kind, transition };
            },
        },
        {
            name: 'cut_source_tape_get',
            description: 'Source tape: all media pool items as one continuous tape (sorted like the pool). Returns each item with its tape start/end in seconds.',
            parameters: { type: 'object', properties: { sort: { type: 'string', enum: ['added', 'name', 'type', 'duration'] }, descending: { type: 'boolean' } } },
            handler: (args, ctx) => {
                const sort = (['added', 'name', 'type', 'duration'].includes(String(args.sort)) ? args.sort : 'added') as PoolSort;
                const items = sortMedia(ctx.getState().mediaItems, sort, args.descending === true);
                const tape = buildSourceTape(items);
                return { length: tapeLength(tape), segments: tape.map((segment) => ({ ...segment, name: items.find((item) => item.id === segment.mediaId)?.name ?? '' })) };
            },
        },
        {
            name: 'cut_edit_points_get',
            description: 'List the cuts of a track (or all tracks) with outgoing and incoming clip ids, for cut_trim and cut_transition_add.',
            parameters: { type: 'object', properties: { trackId: { type: 'string' } } },
            handler: (args, ctx) => {
                const state = ctx.getState();
                const trackIds = typeof args.trackId === 'string' ? [args.trackId] : state.timelineTracks.map((track) => track.id);
                const edits = trackIds.flatMap((trackId) => editPoints(state.timelineClips, trackId)
                    .map((time) => findEditPoint(state.timelineClips, trackId, time, 1e-3))
                    .filter((hit): hit is NonNullable<typeof hit> => Boolean(hit))
                    .map((hit) => ({ trackId, time: hit.time, outgoingId: hit.outgoing?.id ?? null, incomingId: hit.incoming?.id ?? null, transition: hit.outgoing?.transitionOut ?? null })));
                return { edits };
            },
        },
        {
            name: 'cut_viewer_state_get',
            description: 'Read the Cut page viewer state (viewer mode source/tape/timeline, loaded source clip, In/Out marks, trim selection, zoom). Opens the Cut page if needed.',
            parameters: { type: 'object', properties: {} },
            handler: async (_args, ctx) => ({ state: await invokeLiveCommand('cut.state.get', {}, VIEWER_COMMAND_OPTIONS(ctx)) }),
        },
        {
            name: 'cut_viewer_set',
            description: 'Change the Cut page viewer: mode ("source" | "tape" | "timeline"), load a source mediaId, set markIn/markOut (media seconds, null clears), sourceTime, or select a cut for trimming (trimClipId + trimEdge "in"/"out"/"clip"; trimClipId null closes the trim view).',
            parameters: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['source', 'tape', 'timeline'] },
                    mediaId: { type: 'string' },
                    sourceTime: { type: 'number' },
                    markIn: { type: 'number' },
                    markOut: { type: 'number' },
                    clearMarks: { type: 'boolean' },
                    trimClipId: { type: 'string' },
                    trimEdge: { type: 'string', enum: ['in', 'out', 'clip'] },
                    closeTrim: { type: 'boolean' },
                },
            },
            handler: async (args, ctx) => ({ state: await invokeLiveCommand('cut.state.set', args, VIEWER_COMMAND_OPTIONS(ctx)) }),
        },
    ],
};

registerStudioToolModule(CUT_TOOL_MODULE);
