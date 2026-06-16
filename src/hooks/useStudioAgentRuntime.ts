import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ProjectRealtimeActor,
  ScriptLength,
  StudioAgentApprovalMode,
  StudioAgentApprovalRequest,
  StudioAgentCapabilityId,
  StudioAgentSnapshot,
  Workspace,
} from '../types';
import {
  getStudioAgentCapability,
  summarizeStudioAgentSnapshot,
} from '../services/studioAutomationService';

export type StudioAgentRuntimeState = {
  status:
    | 'idle'
    | 'planning'
    | 'awaiting_approval'
    | 'acting'
    | 'verifying'
    | 'completed'
    | 'error';
  capabilityId?: StudioAgentCapabilityId;
  capabilityTitle?: string;
  detail: string;
  snapshotSummary: string;
  updatedAt: string;
  pendingApproval?: StudioAgentApprovalRequest | null;
};

type UseStudioAgentRuntimeParams = {
  snapshot: StudioAgentSnapshot;
  actor?: ProjectRealtimeActor;
  enabled?: boolean;
  approvalMode?: StudioAgentApprovalMode;
  onNavigateWorkspace: (workspace: Workspace) => void | Promise<void>;
  onSetProjectPhase: (phase: string) => void | Promise<void>;
  onSelectTimelineClip: (clipId: string) => void | Promise<void>;
  onWriteProjectScript?: (payload: {
    prompt: string;
    length?: ScriptLength;
    mode?: 'fast' | 'slow';
  }) => Promise<{ detail: string }>;
  onImproveProjectScript?: (payload: {
    instruction?: string;
    targetScore?: number;
    maxPasses?: number;
  }) => Promise<{ detail: string }>;
  onRunDirectorPass?: () => Promise<{ detail: string }>;
  onApplyDirectorTreatment?: () => Promise<{ detail: string }>;
  onGenerateProjectConcepts?: (payload: {
    limit?: number;
  }) => Promise<{ detail: string }>;
  onGenerateStoryboardImages?: (payload: {
    limit?: number;
  }) => Promise<{ detail: string }>;
  onGenerateStoryboardVideos?: (payload: {
    limit?: number;
  }) => Promise<{ detail: string }>;
  onResearchWeb?: (payload: {
    query: string;
    kind?: string;
  }) => Promise<{ detail: string }>;
  onAnalyzeImageAsset?: (payload: {
    imageUrl: string;
    objective?: string;
  }) => Promise<{ detail: string }>;
  onEditImageAsset?: (payload: {
    imageUrl: string;
    prompt: string;
    referenceImageUrl?: string;
  }) => Promise<{ detail: string }>;
  onRelightImageAsset?: (payload: {
    imageUrl: string;
    prompt: string;
  }) => Promise<{ detail: string }>;
  onAgentActivity?: (activity: {
    status: 'completed' | 'error';
    capabilityId: StudioAgentCapabilityId;
    capabilityTitle: string;
    detail: string;
    createdAt: string;
  }) => void;
};

const nowIso = () => new Date().toISOString();
const buildId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const nextPaint = () =>
  new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => resolve());
  });

const waitForVerification = async (
  predicate: (snapshot: StudioAgentSnapshot) => boolean,
  snapshotRef: MutableRefObject<StudioAgentSnapshot>,
  maxAttempts = 16,
) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await nextPaint();
    if (predicate(snapshotRef.current)) {
      return snapshotRef.current;
    }
  }
  return snapshotRef.current;
};

export const useStudioAgentRuntime = ({
  snapshot,
  actor,
  enabled = true,
  approvalMode = 'important_only',
  onNavigateWorkspace,
  onSetProjectPhase,
  onSelectTimelineClip,
  onWriteProjectScript,
  onImproveProjectScript,
  onRunDirectorPass,
  onApplyDirectorTreatment,
  onGenerateProjectConcepts,
  onGenerateStoryboardImages,
  onGenerateStoryboardVideos,
  onResearchWeb,
  onAnalyzeImageAsset,
  onEditImageAsset,
  onRelightImageAsset,
  onAgentActivity,
}: UseStudioAgentRuntimeParams) => {
  const snapshotRef = useRef(snapshot);
  const cancelledReasonRef = useRef<string | null>(null);
  const pendingExecutionRef = useRef<{
    capabilityId: StudioAgentCapabilityId;
    input: Record<string, unknown>;
    taskId?: string;
  } | null>(null);
  const [state, setState] = useState<StudioAgentRuntimeState>(() => ({
    status: 'idle',
    detail: 'Ready for workspace and phase control.',
    snapshotSummary: summarizeStudioAgentSnapshot(snapshot),
    updatedAt: nowIso(),
    pendingApproval: null,
  }));

  useEffect(() => {
    snapshotRef.current = snapshot;
    setState((prev) => ({
      ...prev,
      snapshotSummary: summarizeStudioAgentSnapshot(snapshot),
      updatedAt: prev.status === 'acting' || prev.status === 'verifying' ? prev.updatedAt : nowIso(),
    }));
  }, [snapshot]);

  const runCapability = useCallback(
    async (
      capabilityId: StudioAgentCapabilityId,
      input: Record<string, unknown>,
      options?: { skipApproval?: boolean; taskId?: string },
    ) => {
      const capability = getStudioAgentCapability(capabilityId);
      if (!capability) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          capabilityId,
          detail: `Capability ${capabilityId} is not registered.`,
          updatedAt: nowIso(),
        }));
        return { ok: false, detail: `Capability ${capabilityId} is not registered.` };
      }

      if (!enabled) {
        const detail = 'Studio Agent is in manual mode. Enable Agent Mode in settings to run agent actions.';
        setState((prev) => ({
          ...prev,
          status: 'error',
          capabilityId,
          capabilityTitle: capability.title,
          detail,
          updatedAt: nowIso(),
          pendingApproval: null,
        }));
        return { ok: false, detail };
      }

      cancelledReasonRef.current = null;

      const basePolicy =
        capability.policy || (capability.requiresHumanReview ? 'approval_required' : 'safe_auto');
      const policy =
        approvalMode === 'every_action' && basePolicy !== 'blocked'
          ? 'approval_required'
          : basePolicy;

      const throwIfCancelled = () => {
        if (cancelledReasonRef.current) {
          throw new Error(cancelledReasonRef.current);
        }
      };

      if (
        policy === 'approval_required' &&
        !options?.skipApproval
      ) {
        const approvalRequest: StudioAgentApprovalRequest = {
          id: buildId('approval'),
          capabilityId,
          reason: `${capability.title} changes project state or may incur cost. Approval is required before execution.`,
          createdAt: nowIso(),
          taskId: options?.taskId,
          requestedBy:
            actor || {
              id: 'studio-agent',
              name: 'Studio Agent',
            },
        };
        pendingExecutionRef.current = { capabilityId, input, taskId: options?.taskId };
        setState({
          status: 'awaiting_approval',
          capabilityId,
          capabilityTitle: capability.title,
          detail: approvalRequest.reason,
          snapshotSummary: summarizeStudioAgentSnapshot(snapshotRef.current),
          updatedAt: nowIso(),
          pendingApproval: approvalRequest,
        });
        return {
          ok: false,
          needsApproval: true,
          detail: approvalRequest.reason,
        };
      }

      const before = snapshotRef.current;
      setState({
        status: 'planning',
        capabilityId,
        capabilityTitle: capability.title,
        detail: `Observed ${summarizeStudioAgentSnapshot(before)}. Preparing ${capability.title.toLowerCase()}.`,
        snapshotSummary: summarizeStudioAgentSnapshot(before),
        updatedAt: nowIso(),
        pendingApproval: null,
      });

      try {
        await nextPaint();
        throwIfCancelled();

        setState((prev) => ({
          ...prev,
          status: 'acting',
          detail: `Running ${capability.title}.`,
          updatedAt: nowIso(),
        }));

        let immediateDetail: string | null = null;
        if (capabilityId === 'write_project_script') {
          const response = await onWriteProjectScript?.({
            prompt: String(input.prompt || ''),
            length:
              typeof input.length === 'string' && input.length.trim()
                ? (String(input.length) as ScriptLength)
                : undefined,
            mode:
              input.mode === 'fast' || input.mode === 'slow'
                ? input.mode
                : undefined,
          });
          immediateDetail = response?.detail || 'Project script written.';
        } else if (capabilityId === 'improve_project_script') {
          const response = await onImproveProjectScript?.({
            instruction:
              typeof input.instruction === 'string' && input.instruction.trim()
                ? String(input.instruction)
                : undefined,
            targetScore:
              typeof input.targetScore === 'number' && Number.isFinite(input.targetScore)
                ? Number(input.targetScore)
                : undefined,
            maxPasses:
              typeof input.maxPasses === 'number' && Number.isFinite(input.maxPasses)
                ? Number(input.maxPasses)
                : undefined,
          });
          immediateDetail = response?.detail || 'Project script improved.';
        } else if (capabilityId === 'navigate_workspace') {
          const workspace = String(input.workspace || '') as Workspace;
          await onNavigateWorkspace(workspace);
        } else if (capabilityId === 'set_project_phase') {
          const phase = String(input.phase || '');
          await onNavigateWorkspace('PROJECT');
          await onSetProjectPhase(phase);
        } else if (capabilityId === 'select_timeline_clip') {
          const clipId = String(input.clipId || '');
          await onNavigateWorkspace('EDIT');
          await onSelectTimelineClip(clipId);
        } else if (capabilityId === 'run_director_pass') {
          const response = await onRunDirectorPass?.();
          immediateDetail = response?.detail || 'Director pass completed.';
        } else if (capabilityId === 'apply_director_treatment') {
          const response = await onApplyDirectorTreatment?.();
          immediateDetail = response?.detail || 'Director treatment applied.';
        } else if (capabilityId === 'generate_project_concepts') {
          const response = await onGenerateProjectConcepts?.({
            limit:
              typeof input.limit === 'number' && Number.isFinite(input.limit)
                ? Number(input.limit)
                : undefined,
          });
          immediateDetail = response?.detail || 'Project concept generation completed.';
        } else if (capabilityId === 'generate_storyboard_images') {
          const response = await onGenerateStoryboardImages?.({
            limit:
              typeof input.limit === 'number' && Number.isFinite(input.limit)
                ? Number(input.limit)
                : undefined,
          });
          immediateDetail = response?.detail || 'Storyboard image generation completed.';
        } else if (capabilityId === 'generate_storyboard_videos') {
          const response = await onGenerateStoryboardVideos?.({
            limit:
              typeof input.limit === 'number' && Number.isFinite(input.limit)
                ? Number(input.limit)
                : undefined,
          });
          immediateDetail = response?.detail || 'Storyboard video generation completed.';
        } else if (capabilityId === 'research_web') {
          const response = await onResearchWeb?.({
            query: String(input.query || ''),
            kind:
              typeof input.kind === 'string' && input.kind.trim()
                ? String(input.kind)
                : undefined,
          });
          immediateDetail = response?.detail || 'Research completed.';
        } else if (capabilityId === 'analyze_image_asset') {
          const response = await onAnalyzeImageAsset?.({
            imageUrl: String(input.imageUrl || ''),
            objective:
              typeof input.objective === 'string'
                ? String(input.objective)
                : undefined,
          });
          immediateDetail = response?.detail || 'Image analysis completed.';
        } else if (capabilityId === 'edit_image_asset') {
          const response = await onEditImageAsset?.({
            imageUrl: String(input.imageUrl || ''),
            prompt: String(input.prompt || ''),
            referenceImageUrl:
              typeof input.referenceImageUrl === 'string'
                ? String(input.referenceImageUrl)
                : undefined,
          });
          immediateDetail = response?.detail || 'Image edit completed.';
        } else if (capabilityId === 'relight_image_asset') {
          const response = await onRelightImageAsset?.({
            imageUrl: String(input.imageUrl || ''),
            prompt: String(input.prompt || ''),
          });
          immediateDetail = response?.detail || 'Relight completed.';
        } else {
          throw new Error(`${capability.title} is cataloged but not wired yet.`);
        }
        throwIfCancelled();

        setState((prev) => ({
          ...prev,
          status: 'verifying',
          detail: `Verifying ${capability.title}.`,
          updatedAt: nowIso(),
        }));

        const after = await waitForVerification(
          (current) =>
            (capabilityId === 'navigate_workspace' &&
              current.activeWorkspace === input.workspace) ||
            (capabilityId === 'set_project_phase' &&
              current.activeWorkspace === 'PROJECT' &&
              current.activeProjectPhase === input.phase) ||
            (capabilityId === 'select_timeline_clip' &&
              current.activeWorkspace === 'EDIT' &&
              current.selectedClipId === input.clipId) ||
            capabilityId === 'write_project_script' ||
            capabilityId === 'improve_project_script' ||
            capabilityId === 'run_director_pass' ||
            capabilityId === 'apply_director_treatment' ||
            capabilityId === 'generate_project_concepts' ||
            capabilityId === 'generate_storyboard_images' ||
            capabilityId === 'generate_storyboard_videos' ||
            capabilityId === 'research_web' ||
            capabilityId === 'analyze_image_asset' ||
            capabilityId === 'edit_image_asset' ||
            capabilityId === 'relight_image_asset',
          snapshotRef,
        );
        throwIfCancelled();

        const isVerified =
          capabilityId === 'write_project_script' ||
          capabilityId === 'improve_project_script' ||
          (capabilityId === 'navigate_workspace' &&
            after.activeWorkspace === input.workspace) ||
          (capabilityId === 'set_project_phase' &&
            after.activeWorkspace === 'PROJECT' &&
            after.activeProjectPhase === input.phase) ||
          (capabilityId === 'select_timeline_clip' &&
            after.activeWorkspace === 'EDIT' &&
            after.selectedClipId === input.clipId) ||
          capabilityId === 'run_director_pass' ||
          capabilityId === 'apply_director_treatment' ||
          capabilityId === 'generate_project_concepts' ||
          capabilityId === 'generate_storyboard_images' ||
          capabilityId === 'generate_storyboard_videos' ||
          capabilityId === 'research_web' ||
          capabilityId === 'analyze_image_asset' ||
          capabilityId === 'edit_image_asset' ||
          capabilityId === 'relight_image_asset';

        if (!isVerified) {
          throw new Error(`State verification failed after ${capability.title}.`);
        }

        const detail = immediateDetail
          ? immediateDetail
          : capabilityId === 'navigate_workspace'
            ? `Workspace ${String(input.workspace)} is active.`
            : capabilityId === 'set_project_phase'
              ? `Project Hub phase ${String(input.phase)} is active.`
              : capabilityId === 'select_timeline_clip'
                ? `Timeline clip ${String(input.clipId).slice(0, 8)} is focused.`
                : `${capability.title} completed.`;

        setState({
          status: 'completed',
          capabilityId,
          capabilityTitle: capability.title,
          detail,
          snapshotSummary: summarizeStudioAgentSnapshot(after),
          updatedAt: nowIso(),
          pendingApproval: null,
        });
        cancelledReasonRef.current = null;

        onAgentActivity?.({
          status: 'completed',
          capabilityId,
          capabilityTitle: capability.title,
          detail,
          createdAt: nowIso(),
        });

        return { ok: true, detail };
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : `Failed to run ${capability.title}.`;
        const wasCancelled =
          Boolean(cancelledReasonRef.current) &&
          detail === cancelledReasonRef.current;

        if (wasCancelled) {
          setState((prev) => ({
            ...prev,
            status: 'idle',
            capabilityId,
            capabilityTitle: capability.title,
            detail,
            snapshotSummary: summarizeStudioAgentSnapshot(snapshotRef.current),
            updatedAt: nowIso(),
            pendingApproval: null,
          }));
          cancelledReasonRef.current = null;
          return { ok: false, cancelled: true, detail };
        }

        setState({
          status: 'error',
          capabilityId,
          capabilityTitle: capability.title,
          detail,
          snapshotSummary: summarizeStudioAgentSnapshot(snapshotRef.current),
          updatedAt: nowIso(),
          pendingApproval: null,
        });
        onAgentActivity?.({
          status: 'error',
          capabilityId,
          capabilityTitle: capability.title,
          detail,
          createdAt: nowIso(),
        });
        return { ok: false, detail };
      }
    },
    [
      actor,
      approvalMode,
      enabled,
      onAgentActivity,
      onAnalyzeImageAsset,
      onApplyDirectorTreatment,
      onEditImageAsset,
      onGenerateProjectConcepts,
      onGenerateStoryboardImages,
      onGenerateStoryboardVideos,
      onImproveProjectScript,
      onNavigateWorkspace,
      onRelightImageAsset,
      onResearchWeb,
      onRunDirectorPass,
      onSelectTimelineClip,
      onSetProjectPhase,
      onWriteProjectScript,
    ],
  );

  const approvePending = useCallback(async () => {
    const pending = pendingExecutionRef.current;
    if (!pending) {
      return { ok: false, detail: 'No approval is pending.' };
    }
    pendingExecutionRef.current = null;
    return runCapability(pending.capabilityId, pending.input, {
      skipApproval: true,
      taskId: pending.taskId,
    });
  }, [runCapability]);

  const rejectPending = useCallback((reason?: string) => {
    pendingExecutionRef.current = null;
    setState((prev) => ({
      ...prev,
      status: 'idle',
      detail: reason || 'Approval rejected. No action executed.',
      updatedAt: nowIso(),
      pendingApproval: null,
    }));
    return { ok: false, detail: reason || 'Approval rejected.' };
  }, []);

  const cancelCurrent = useCallback((reason?: string) => {
    const detail = reason || 'Studio Agent execution cancelled.';
    cancelledReasonRef.current = detail;
    pendingExecutionRef.current = null;
    setState((prev) => ({
      ...prev,
      status: 'idle',
      detail,
      updatedAt: nowIso(),
      pendingApproval: null,
    }));
    return { ok: false, detail };
  }, []);

  return {
    state,
    execute: runCapability,
    approvePending,
    rejectPending,
    cancelCurrent,
  };
};
