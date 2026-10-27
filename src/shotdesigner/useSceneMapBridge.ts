/**
 * App.tsx binds the Scene Map bridge once with this hook, so MCP tools work even while the Scene
 * Map page is closed. Values are read through refs: always current, no re-registration.
 */
import { useEffect, useRef } from 'react';
import type { ReferenceItem, SceneMapState, SetDesignState, ShotPrompt } from '../types';
import { bindSceneMapBridge, getBridge } from './session.ts';
import type { StageHost } from './planModel.ts';

export type SceneMapBridgeInput = {
  setDesign: SetDesignState | null | undefined;
  setSetDesign: (next: SetDesignState) => void;
  shotPrompts: ShotPrompt[];
  setShotPrompts: (next: ShotPrompt[]) => void;
  references: ReferenceItem[];
  sceneMap: SceneMapState | null | undefined;
  setSceneMap: (next: SceneMapState) => void;
  projectPath?: string | null;
  projectName?: string;
  openSceneMap?: () => void;
};

export const useSceneMapBridge = (input: SceneMapBridgeInput, enabled = true) => {
  const ref = useRef(input);
  ref.current = input;
  useEffect(() => {
    if (!enabled) return undefined;
    const bridge = {
      getSetDesign: () => ref.current.setDesign,
      setSetDesign: (next: StageHost) => {
        // Keep the synchronous ref ahead of React so back-to-back commands see their own result.
        ref.current = { ...ref.current, setDesign: next as unknown as SetDesignState };
        ref.current.setSetDesign(next as unknown as SetDesignState);
      },
      getShotPrompts: () => ref.current.shotPrompts,
      setShotPrompts: (next: ShotPrompt[]) => { ref.current = { ...ref.current, shotPrompts: next }; ref.current.setShotPrompts(next); },
      getReferences: () => ref.current.references,
      getSceneMap: () => ref.current.sceneMap,
      setSceneMap: (next: SceneMapState) => { ref.current = { ...ref.current, sceneMap: next }; ref.current.setSceneMap(next); },
      getProjectPath: () => ref.current.projectPath ?? null,
      getProjectName: () => ref.current.projectName || 'Kameraplan',
      openSceneMap: () => ref.current.openSceneMap?.(),
    };
    const previous = getBridge();
    bindSceneMapBridge(bridge);
    return () => { if (getBridge() === bridge) bindSceneMapBridge(previous && previous !== bridge ? previous : null); };
  }, [enabled]);
};
