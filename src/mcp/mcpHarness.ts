/**
 * Test harness: publishes tool modules through the real renderer → MCP bridge
 * (`registerStudioTools`) against a fake `window.electron.studioTools`, then
 * calls tools exactly like the MCP server's `tools/call` does.
 */
import { registerStudioTools } from '../services/localAgentsService.ts';
import { collectStudioTools, type StudioActions, type StudioState, type StudioToolContext } from './toolModules.ts';

type Listed = { name: string; description: string; inputSchema: Record<string, unknown> };

export function createTestContext(partial: Partial<StudioState> = {}) {
  const state: StudioState = {
    activeWorkspace: 'EDIT',
    timelineClips: [],
    timelineTracks: [
      { id: 'v1', name: 'V1', type: 'video', isLocked: false, isMuted: false },
      { id: 'a1', name: 'A1', type: 'audio', isLocked: false, isMuted: false },
    ],
    mediaItems: [],
    playheadPosition: 0,
    selectedClipId: null,
    projectPath: null,
    extras: {},
    ...partial,
  };
  const actions: StudioActions = {
    setActiveWorkspace: (workspace) => { state.activeWorkspace = workspace; },
    updateClip: (clip) => { state.timelineClips = state.timelineClips.map((entry) => (entry.id === clip.id ? clip : entry)); },
    setTimelineClips: (clips) => { state.timelineClips = clips; },
    setTimelineTracks: (tracks) => { state.timelineTracks = tracks; },
    addMediaItem: (item) => { state.mediaItems = [...state.mediaItems, item]; },
    setPlayhead: (seconds) => { state.playheadPosition = seconds; },
    selectClip: (clipId) => { state.selectedClipId = clipId; },
    setExtra: (key, value) => { state.extras = { ...state.extras, [key]: value }; },
  };
  const ctx: StudioToolContext = { getState: () => state, actions };
  return { state, ctx };
}

export async function createMcpHarness(ctx: StudioToolContext) {
  let listed: Listed[] = [];
  let onCall: ((call: { callId: string; name: string; args: Record<string, unknown>; source?: string }) => void) | null = null;
  const replies = new Map<string, (reply: { result?: unknown; error?: string }) => void>();
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  const previousWindow = g.window;
  g.window = {
    ...(previousWindow ?? {}),
    electron: {
      studioTools: {
        register: async (list: Listed[]) => { listed = list; return { ok: true, count: list.length }; },
        onCall: (cb: typeof onCall) => { onCall = cb; return () => { onCall = null; }; },
        reply: (reply: { callId: string; result?: unknown; error?: string }) => replies.get(reply.callId)?.(reply),
      },
    },
  };
  const { declarations, executor } = collectStudioTools(() => ctx);
  const dispose = registerStudioTools(declarations as never, executor);
  let counter = 0;
  return {
    list: () => listed,
    async call(name: string, args: Record<string, unknown> = {}) {
      if (!onCall) throw new Error('Bridge not registered');
      const callId = `t${(counter += 1)}`;
      const reply = await new Promise<{ result?: unknown; error?: string }>((resolve) => {
        replies.set(callId, resolve);
        onCall!({ callId, name, args, source: 'mcp' });
      });
      if (reply.error) throw new Error(reply.error);
      return reply.result as Record<string, unknown>;
    },
    dispose() {
      dispose();
      g.window = previousWindow;
    },
  };
}
