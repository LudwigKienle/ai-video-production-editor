/**
 * MCP (compositing_ai_* tools): the Compositing page's tools mode — Merge,
 * Keyer (CorridorKey), Pose (OpenPose, Wan Animate Replace), Reframe (Luma
 * Ray2), Kling Bridge (Kling O3), switching tools, timeline clips as sources
 * and "add result to timeline". CompositingWorkspace calls this hook once
 * (above its comp-mode early return); actions run the page's own handlers.
 */
import { useRef } from 'react';
import { useLivePage } from '../../mcp/livePage';
import type { LiveSetting } from '../../mcp/livePageCore';
import type { MediaItem, TimelineClip } from '../../types';

type Setter<T> = (value: T) => void;
type Tool = { id: string; label: string; view: string; tab?: string };
type SourceKind = 'none' | 'file' | 'media' | 'seed';

export type CompositingAiLiveProps = {
  pageMode: string; setPageMode: Setter<never>;
  tools: Tool[]; selectTool: (tool: never) => void; activeToolId: string;
  mediaItems: MediaItem[]; timelineClips: TimelineClip[]; selectedClipId: string | null;
  readyForGeneration: boolean; hasDesktopCorridorKey: boolean;
  onAddToTimeline?: (item: MediaItem) => void;
  // Merge
  setBackgroundMediaId: Setter<string>; setBackgroundSource: Setter<never>; setBackgroundFile: Setter<File | null>;
  setOverlayMediaId: Setter<string>; setOverlaySource: Setter<never>; setOverlayFile: Setter<File | null>;
  blendMode: string; setBlendMode: Setter<never>; overlayOpacity: number; setOverlayOpacity: Setter<number>;
  compositeStatus: string | null; compositeResult: MediaItem | null; handleComposite: () => Promise<void>;
  // Keyer
  corridorKeyRepoPath: string; setCorridorKeyRepoPath: Setter<string>; corridorKeyEnvStatus: unknown;
  setCorridorKeySourceMediaId: Setter<string>; setCorridorKeySourceKind: Setter<never>; setCorridorKeySourceFile: Setter<File | null>;
  setCorridorKeyAlphaMediaId: Setter<string>; setCorridorKeyAlphaKind: Setter<never>; setCorridorKeyAlphaFile: Setter<File | null>;
  corridorKeyOptions: Record<string, unknown>; setCorridorKeyOptions: Setter<never>;
  corridorKeyMaxFrames: string; setCorridorKeyMaxFrames: Setter<string>;
  corridorKeyStatus: string | null; corridorKeyResult: unknown;
  handlePrepareCorridorKey: () => Promise<void>; handleRunCorridorKey: () => Promise<void>;
  // OpenPose / Animate Replace
  openPoseOptions: Record<string, boolean>; setOpenPoseOptions: Setter<never>; setOpenPoseFile: Setter<File | null>;
  openPoseStatus: string | null; openPoseResult: MediaItem | null; handleGenerateOpenPose: () => Promise<void>;
  setMotionVideoUrl: Setter<string | null>; setMotionVideo: Setter<File | null>; setCharacterImage: Setter<File | null>;
  animateSettings: Record<string, unknown>; setAnimateSettings: Setter<never>;
  animateStatus: string | null; animateResult: MediaItem | null; handleAnimateReplace: () => Promise<void>;
  // Reframe
  setReframeVideoMediaId: Setter<string>; setReframeVideoSource: Setter<never>; setReframeVideoUrl: Setter<string | null>; setReframeVideoFile: Setter<File | null>;
  reframePrompt: string; setReframePrompt: Setter<string>; reframeAspect: string; setReframeAspect: Setter<never>;
  reframeGuideFrame: string; setReframeGuideFrame: Setter<never>;
  reframeUseManualWindow: boolean; setReframeUseManualWindow: Setter<boolean>;
  reframeWindow: Record<string, string>; setReframeWindow: Setter<never>;
  reframeStatus: string | null; reframeResult: MediaItem | null; handleLumaReframe: () => Promise<void>;
  // Kling Bridge
  klingBridgePrompt: string; setKlingBridgePrompt: Setter<string>;
  klingBridgeDuration: number; setKlingBridgeDuration: Setter<number>;
  klingBridgeAspect: string; setKlingBridgeAspect: Setter<never>;
  klingBridgeStatus: string | null; klingBridgeResult: MediaItem | null; handleKlingBridge: () => Promise<void>;
};

const fileFromUrl = async (url: string, name: string, fallbackType: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || fallbackType });
};

const RESULT_OF: Record<string, keyof CompositingAiLiveProps> = {
  layer: 'compositeResult', pose: 'openPoseResult', animate: 'animateResult', reframe: 'reframeResult', kling: 'klingBridgeResult',
};

export function useCompositingAiLiveCommands(props: CompositingAiLiveProps): void {
  const latest = useRef(props);
  latest.current = props;
  const p = () => latest.current;

  const mediaUrl = (args: Record<string, unknown>) => {
    if (typeof args.mediaId === 'string' && args.mediaId) {
      const item = p().mediaItems.find((entry) => entry.id === args.mediaId);
      if (!item) throw new Error(`Media item ${args.mediaId} not found.`);
      return { url: item.url, mediaId: item.id, name: item.name };
    }
    const url = String(args.url ?? args.imagePath ?? args.videoPath ?? '').trim();
    return url ? { url, mediaId: null, name: url.split(/[?#]/)[0].split('/').pop() || 'input' } : null;
  };
  const clipMedia = (clipId: unknown) => {
    const id = typeof clipId === 'string' && clipId ? clipId : p().selectedClipId;
    const clip = p().timelineClips.find((entry) => entry.id === id);
    if (!clip) throw new Error(id ? `Clip ${id} not found.` : 'No clip selected; pass clipId.');
    const media = p().mediaItems.find((entry) => entry.id === clip.mediaId);
    if (!media) throw new Error(`Clip ${clip.id} has no media.`);
    return media;
  };
  const openTool = async (toolId: string, waitForCommit: () => Promise<void>) => {
    const tool = p().tools.find((entry) => entry.id === toolId);
    if (!tool) throw new Error(`tool must be one of ${p().tools.map((entry) => entry.id).join(', ')}.`);
    if (p().pageMode !== 'tools') { p().setPageMode('tools' as never); await waitForCommit(); }
    p().selectTool(tool as never);
    await waitForCommit();
    return tool.id;
  };
  const needsKeys = () => { if (!p().readyForGeneration) throw new Error('Connect your API keys first (Settings).'); };
  const run = async (status: () => string | null, result: () => unknown, handler: () => Promise<void>, waitForCommit: () => Promise<void>) => {
    const before = result();
    await handler();
    await waitForCommit();
    if (result() === before) throw new Error(status() || 'The tool produced no result.');
    return { status: status() };
  };

  const settings: Record<string, LiveSetting> = {
    blendMode: { value: props.blendMode, set: props.setBlendMode as never, type: 'string' },
    overlayOpacity: { value: props.overlayOpacity, set: props.setOverlayOpacity as never, type: 'number', min: 0, max: 100 },
    corridorKeyRepoPath: { value: props.corridorKeyRepoPath, set: props.setCorridorKeyRepoPath as never, type: 'string' },
    corridorKeyOptions: { value: props.corridorKeyOptions, set: ((value: Record<string, unknown>) => props.setCorridorKeyOptions({ ...latest.current.corridorKeyOptions, ...value } as never)) as never, type: 'json' },
    corridorKeyMaxFrames: { value: props.corridorKeyMaxFrames, set: props.setCorridorKeyMaxFrames as never, type: 'string' },
    openPoseOptions: { value: props.openPoseOptions, set: ((value: Record<string, boolean>) => props.setOpenPoseOptions({ ...latest.current.openPoseOptions, ...value } as never)) as never, type: 'json' },
    animateSettings: { value: props.animateSettings, set: ((value: Record<string, unknown>) => props.setAnimateSettings({ ...latest.current.animateSettings, ...value } as never)) as never, type: 'json' },
    reframePrompt: { value: props.reframePrompt, set: props.setReframePrompt as never, type: 'string' },
    reframeAspect: { value: props.reframeAspect, set: props.setReframeAspect as never, type: 'string', options: ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9', '9:21'] },
    reframeGuideFrame: { value: props.reframeGuideFrame, set: props.setReframeGuideFrame as never, type: 'string', options: ['none', 'background', 'overlay'] },
    reframeUseManualWindow: { value: props.reframeUseManualWindow, set: props.setReframeUseManualWindow as never, type: 'boolean' },
    reframeWindow: { value: props.reframeWindow, set: ((value: Record<string, unknown>) => props.setReframeWindow({ ...latest.current.reframeWindow, ...Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)])) } as never)) as never, type: 'json' },
    klingBridgePrompt: { value: props.klingBridgePrompt, set: props.setKlingBridgePrompt as never, type: 'string' },
    klingBridgeDuration: { value: props.klingBridgeDuration, set: props.setKlingBridgeDuration as never, type: 'number', options: [3, 5, 8, 10, 12, 15] },
    klingBridgeAspect: { value: props.klingBridgeAspect, set: props.setKlingBridgeAspect as never, type: 'string', options: ['16:9', '9:16', '1:1'] },
  };

  useLivePage('compositing_ai', {
    settings,
    info: () => ({
      pageMode: props.pageMode,
      activeTool: props.activeToolId,
      tools: props.tools.map(({ id, label }) => ({ id, label })),
      readyForGeneration: props.readyForGeneration,
      corridorKey: { available: props.hasDesktopCorridorKey, env: props.corridorKeyEnvStatus, status: props.corridorKeyStatus, result: props.corridorKeyResult },
      status: { merge: props.compositeStatus, openPose: props.openPoseStatus, animate: props.animateStatus, reframe: props.reframeStatus, kling: props.klingBridgeStatus },
      results: Object.fromEntries(Object.entries(RESULT_OF).map(([key, prop]) => {
        const item = props[prop] as MediaItem | null;
        return [key, item ? { id: item.id, name: item.name, url: item.url } : null];
      })),
    }),
    actions: {
      open_tool: async (args, { waitForCommit }) => ({ tool: await openTool(String(args.tool), waitForCommit) }),
      /** Sets an input of a tool from a media bin item, URL/path or a timeline clip. */
      set_input: async (args, { waitForCommit }) => {
        const role = String(args.role);
        const source = args.clipId !== undefined || args.fromSelectedClip === true
          ? (() => { const media = clipMedia(args.clipId); return { url: media.url, mediaId: media.id, name: media.name }; })()
          : mediaUrl(args);
        const clear = !source;
        const q = p();
        switch (role) {
          case 'background':
          case 'overlay': {
            const [setId, setSrc, setFile] = role === 'background' ? [q.setBackgroundMediaId, q.setBackgroundSource, q.setBackgroundFile] : [q.setOverlayMediaId, q.setOverlaySource, q.setOverlayFile];
            if (clear) { setSrc('none' as never); setId(''); setFile(null); break; }
            if (source.mediaId) { setId(source.mediaId); setSrc('media' as never); } else { setFile(await fileFromUrl(source.url, source.name, 'image/png')); setSrc('file' as never); }
            break;
          }
          case 'key_source':
          case 'key_alpha': {
            const [setId, setKind, setFile] = role === 'key_source' ? [q.setCorridorKeySourceMediaId, q.setCorridorKeySourceKind, q.setCorridorKeySourceFile] : [q.setCorridorKeyAlphaMediaId, q.setCorridorKeyAlphaKind, q.setCorridorKeyAlphaFile];
            if (clear) { setKind('none' as never); setId(''); setFile(null); break; }
            if (source.mediaId) { setId(source.mediaId); setKind('media' as never); } else { setFile(await fileFromUrl(source.url, source.name, 'video/mp4')); setKind('file' as never); }
            break;
          }
          case 'reframe': {
            if (clear) { q.setReframeVideoSource('none' as SourceKind as never); q.setReframeVideoMediaId(''); q.setReframeVideoUrl(null); q.setReframeVideoFile(null); break; }
            if (source.mediaId) { q.setReframeVideoMediaId(source.mediaId); q.setReframeVideoSource('media' as never); } else { q.setReframeVideoFile(await fileFromUrl(source.url, source.name, 'video/mp4')); q.setReframeVideoSource('file' as never); }
            break;
          }
          case 'motion':
            q.setMotionVideo(null);
            q.setMotionVideoUrl(clear ? null : source.url);
            break;
          case 'openpose':
            q.setOpenPoseFile(clear ? null : await fileFromUrl(source.url, source.name, 'image/png'));
            break;
          case 'character':
            q.setCharacterImage(clear ? null : await fileFromUrl(source.url, source.name, 'image/png'));
            break;
          default:
            throw new Error('role must be background, overlay, key_source, key_alpha, reframe, motion, openpose or character.');
        }
        await waitForCommit();
        return { role, source: source ? { mediaId: source.mediaId, name: source.name } : null };
      },
      composite: async (_args, { waitForCommit }) => {
        await openTool('layer', waitForCommit);
        return run(() => p().compositeStatus, () => p().compositeResult, () => p().handleComposite(), waitForCommit);
      },
      corridorkey_prepare: async (_args, { waitForCommit }) => {
        if (!p().hasDesktopCorridorKey) throw new Error('CorridorKey needs the desktop app.');
        await openTool('key', waitForCommit);
        await p().handlePrepareCorridorKey();
        await waitForCommit();
        return { status: p().corridorKeyStatus, env: p().corridorKeyEnvStatus };
      },
      corridorkey_run: async (_args, { waitForCommit }) => {
        if (!p().hasDesktopCorridorKey) throw new Error('CorridorKey needs the desktop app.');
        await openTool('key', waitForCommit);
        return run(() => p().corridorKeyStatus, () => p().corridorKeyResult, () => p().handleRunCorridorKey(), waitForCommit);
      },
      openpose: async (_args, { waitForCommit }) => {
        needsKeys();
        await openTool('pose', waitForCommit);
        return run(() => p().openPoseStatus, () => p().openPoseResult, () => p().handleGenerateOpenPose(), waitForCommit);
      },
      animate_replace: async (_args, { waitForCommit }) => {
        needsKeys();
        await openTool('pose', waitForCommit);
        return run(() => p().animateStatus, () => p().animateResult, () => p().handleAnimateReplace(), waitForCommit);
      },
      reframe: async (_args, { waitForCommit }) => {
        needsKeys();
        await openTool('reframe', waitForCommit);
        return run(() => p().reframeStatus, () => p().reframeResult, () => p().handleLumaReframe(), waitForCommit);
      },
      kling_bridge: async (_args, { waitForCommit }) => {
        needsKeys();
        await openTool('kling', waitForCommit);
        return run(() => p().klingBridgeStatus, () => p().klingBridgeResult, () => p().handleKlingBridge(), waitForCommit);
      },
      add_result_to_timeline: (args) => {
        const key = String(args.result);
        const prop = RESULT_OF[key];
        if (!prop) throw new Error(`result must be one of ${Object.keys(RESULT_OF).join(', ')}.`);
        const item = p()[prop] as MediaItem | null;
        if (!item) throw new Error(`No ${key} result yet.`);
        if (!p().onAddToTimeline) throw new Error('Adding to the timeline is not available.');
        p().onAddToTimeline!(item);
        return { added: item.id };
      },
    },
  });
}
