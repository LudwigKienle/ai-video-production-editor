/**
 * MCP (compositing_nodes_* tools): the Compositing › Node Studio view (Natron
 * style graph with effect nodes, AI node staging and a viewer still render).
 * CompositingNodeStudioView calls this hook once; open it first with
 * compositing_ai_open_tool {tool:"nodes"}.
 */
import { useRef } from 'react';
import { useLivePage } from '../../mcp/livePage';
import type { MediaItem } from '../../types';

type Effect = { id: string; label: string; kind: string; description: string };
type GraphNode = { id: string; type?: string; label?: string; params?: Record<string, unknown> };

export type NodeStudioLiveProps = {
  graph: { nodes: GraphNode[]; edges?: unknown[] };
  updateNode: (nodeId: string, updates: { params?: Record<string, unknown>; label?: string }) => void;
  selectedNodeId: string; setSelectedNodeId: (id: string) => void;
  addedEffects: Array<Effect & { instanceId: string }>;
  setAddedEffects: (updater: (prev: Array<Effect & { instanceId: string }>) => Array<Effect & { instanceId: string }>) => void;
  effectGroups: Array<{ id: string; label: string; effects: Effect[] }>;
  addEffectNode: (effect: Effect) => void;
  aiNodeSettings: Record<string, Record<string, unknown>>;
  updateAiNodeSetting: (instanceId: string, updates: Record<string, unknown>) => void;
  queueAiNode: (instanceId: string) => void;
  playhead: number; setPlayhead: (frame: number) => void;
  renderStatus: string | null; renderResult: MediaItem | null; isRendering: boolean;
  renderViewerStill: () => Promise<void>;
};

export function useNodeStudioLiveCommands(props: NodeStudioLiveProps): void {
  const latest = useRef(props);
  latest.current = props;
  const p = () => latest.current;
  const allEffects = () => p().effectGroups.flatMap((group) => group.effects);

  useLivePage('compositing_nodes', {
    settings: {
      playhead: { value: props.playhead, set: props.setPlayhead as never, type: 'number', min: 0 },
      selectedNodeId: { value: props.selectedNodeId, set: props.setSelectedNodeId as never, type: 'string' },
    },
    info: () => ({
      nodes: props.graph.nodes.map(({ id, type, label, params }) => ({ id, type, label, params })),
      effects: props.addedEffects.map(({ instanceId, id, label, kind }) => ({ instanceId, effectId: id, label, kind, ai: props.aiNodeSettings[instanceId] ?? null })),
      catalog: props.effectGroups.map((group) => ({ id: group.id, label: group.label, effects: group.effects.map(({ id, label, kind }) => ({ id, label, kind })) })),
      renderStatus: props.renderStatus,
      renderResult: props.renderResult ? { id: props.renderResult.id, name: props.renderResult.name } : null,
    }),
    actions: {
      add_effect: async (args, { waitForCommit }) => {
        const effect = allEffects().find((entry) => entry.id === args.effectId);
        if (!effect) throw new Error(`Unknown effect ${String(args.effectId)} (see get_state catalog).`);
        p().addEffectNode(effect);
        await waitForCommit();
        const added = p().addedEffects[p().addedEffects.length - 1];
        return { instanceId: added?.instanceId ?? null };
      },
      remove_effect: (args) => {
        if (!p().addedEffects.some((entry) => entry.instanceId === args.instanceId)) throw new Error(`Effect node ${String(args.instanceId)} not found.`);
        p().setAddedEffects((prev) => prev.filter((entry) => entry.instanceId !== args.instanceId));
        return { removed: args.instanceId };
      },
      set_node_params: (args) => {
        const node = p().graph.nodes.find((entry) => entry.id === args.nodeId);
        if (!node) throw new Error(`Node ${String(args.nodeId)} not found.`);
        p().updateNode(node.id, { params: (args.params as Record<string, unknown>) ?? {}, ...(typeof args.label === 'string' ? { label: args.label } : {}) });
        return { nodeId: node.id };
      },
      set_ai_node: (args) => {
        if (!p().addedEffects.some((entry) => entry.instanceId === args.instanceId)) throw new Error(`Effect node ${String(args.instanceId)} not found.`);
        const updates: Record<string, unknown> = {};
        for (const key of ['prompt', 'model', 'strength', 'maskMode']) if (args[key] !== undefined) updates[key] = args[key];
        p().updateAiNodeSetting(String(args.instanceId), updates);
        return { instanceId: args.instanceId };
      },
      stage_ai_node: (args) => { p().queueAiNode(String(args.instanceId)); return { staged: args.instanceId, status: p().renderStatus }; },
      render_still: async (_args, { waitForCommit }) => {
        const before = p().renderResult;
        await p().renderViewerStill();
        await waitForCommit();
        if (p().renderResult === before) throw new Error(p().renderStatus || 'Nothing was rendered.');
        return { result: p().renderResult?.id };
      },
    },
  });
}
