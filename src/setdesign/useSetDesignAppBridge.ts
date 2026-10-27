/**
 * Connects the set design bus to the app: the scene document lives in App state (saved with the
 * project), and the app-level actions the setdesign MCP module and the workspace use are provided
 * here: WebGL frame rendering, putting frames on storyboard shots and on references.
 *
 * Returns the setdesign tools in the shape registerStudioTools expects, for apps that do not yet
 * publish src/mcp modules through collectStudioTools.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { MediaItem, ReferenceItem, SetDesignState, Workspace } from '../types';
import { findReference, withImageVersion } from '../services/projectAgentTools.ts';
import { SETDESIGN_TOOLS } from '../mcp/modules/setdesignTools.ts';
import type { StudioState, StudioToolContext } from '../mcp/toolModules.ts';
import type { CaptureRequest } from './agentTools.ts';
import { setDesignBus } from './bus.ts';

type Options = {
  scene: SetDesignState | null;
  setScene: (next: SetDesignState) => void;
  /** Changes when another project is opened; clears undo history. */
  projectKey: string | null;
  addMedia: (item: MediaItem) => void;
  applyToShot: (payload: { shotNumber: number; imageUrl: string }) => void;
  getReferences: () => ReferenceItem[];
  setReferences: (update: (prev: ReferenceItem[]) => ReferenceItem[]) => void;
  setActiveWorkspace: (workspace: Workspace) => void;
  /** Storyboard shots (camera from shot). */
  getShots?: () => Array<{ shot: number; description?: string; lensPresetId?: string; cameraYaw?: number; cameraPitch?: number }>;
};

/** Same descriptions collectStudioTools publishes (paid tools marked). */
export const SET_DESIGN_TOOL_LIST = SETDESIGN_TOOLS.map((tool) => ({
  name: tool.name,
  description: `${tool.cost === 'paid' ? '[KOSTET CREDITS] ' : ''}${tool.description}${tool.writes ? ' (changes the project)' : ''}`,
  parameters: tool.parameters,
}));

export const useSetDesignAppBridge = (options: Options) => {
  const ref = useRef(options);
  ref.current = options;

  useEffect(() => setDesignBus.attachHost({
    getScene: () => ref.current.scene,
    setScene: (next) => ref.current.setScene(next),
  }), []);

  useEffect(() => { setDesignBus.reset(); }, [options.projectKey]);

  useEffect(() => setDesignBus.provideServices({ getShots: () => ref.current.getShots?.() || [] }), []);

  /** Minimal tool context: set design tools only use these two actions. */
  const context = useMemo<StudioToolContext>(() => ({
    getState: () => ({ extras: {} } as unknown as StudioState),
    actions: {
      addMediaItem: (item) => ref.current.addMedia(item),
      setActiveWorkspace: (workspace) => ref.current.setActiveWorkspace(workspace),
    } as StudioToolContext['actions'],
  }), []);

  const executor = useMemo(() => Object.fromEntries(SETDESIGN_TOOLS.map((tool) => [tool.name, async (args: Record<string, unknown>) => tool.handler(args || {}, context)])), [context]);

  useEffect(() => {
    const detach = [
      setDesignBus.provideAction('renderFrame', async ({ request, scene }) => (await import('./renderFrame.ts')).captureSetFrame(request as CaptureRequest, scene as SetDesignState)),
      setDesignBus.provideAction('applyToShot', async (payload) => { ref.current.applyToShot(payload as { shotNumber: number; imageUrl: string }); }),
      setDesignBus.provideAction('applyToReference', async ({ reference, imageUrl }) => {
        const key = String(reference);
        const found = findReference(ref.current.getReferences(), { id: key, name: key });
        if (!found) throw new Error(`No reference "${key}". Use project_list_references for names.`);
        ref.current.setReferences((prev) => prev.map((item) => (item.id === found.id ? withImageVersion(item, String(imageUrl)) : item)));
        return found.name;
      }),
      // The workspace's "Referenzframe" button runs the same code path as the agent tool.
      setDesignBus.provideAction('captureFrame', (args) => executor.setdesign_capture_frame({ returnImage: false, ...args })),
    ];
    return () => detach.forEach((dispose) => dispose());
  }, [executor]);

  return executor;
};
