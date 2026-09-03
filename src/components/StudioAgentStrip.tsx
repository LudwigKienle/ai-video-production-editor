import React from 'react';
import type {
  StudioAgentApprovalBundle,
  StudioAgentCapabilityId,
  StudioAgentTask,
  StudioAgentTaskStep,
} from '../types';
import type { StudioAgentRuntimeState } from '../hooks/useStudioAgentRuntime';

type StudioAgentStripProps = {
  state: StudioAgentRuntimeState;
  activeTask?: StudioAgentTask | null;
  approvalBundle?: StudioAgentApprovalBundle | null;
  selectedClipId?: string | null;
  showQuickActions?: boolean;
  onExecute: (
    capabilityId: StudioAgentCapabilityId,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  onResumeTaskQueue?: () => Promise<unknown>;
  onApprovePending?: () => Promise<unknown>;
  onRejectPending?: () => unknown;
};

export const STUDIO_AGENT_STATUS_STYLES: Record<
  StudioAgentRuntimeState['status'],
  { dot: string; chip: string; label: string }
> = {
  idle: { dot: 'status-dot--muted', chip: '', label: 'Idle' },
  planning: { dot: 'status-dot--accent', chip: 'status-chip--accent', label: 'Planning' },
  awaiting_approval: { dot: 'status-dot--warm', chip: 'status-chip--warm', label: 'Needs approval' },
  acting: { dot: 'status-dot--accent', chip: 'status-chip--accent', label: 'Working' },
  verifying: { dot: 'status-dot--warm', chip: 'status-chip--warm', label: 'Verifying' },
  completed: { dot: 'status-dot--success', chip: 'status-chip--success', label: 'Verified' },
  error: { dot: 'status-dot--danger', chip: 'status-chip--danger', label: 'Needs review' },
};

const STATUS_STYLES = STUDIO_AGENT_STATUS_STYLES;

const TASK_STEP_STYLES: Record<
  StudioAgentTaskStep['status'],
  { chip: string; label: string }
> = {
  pending: { chip: '', label: 'Queued' },
  running: { chip: 'status-chip--accent', label: 'Running' },
  completed: { chip: 'status-chip--success', label: 'Done' },
  blocked: { chip: 'status-chip--warm', label: 'Blocked' },
  failed: { chip: 'status-chip--danger', label: 'Retry' },
};

const StudioAgentStrip: React.FC<StudioAgentStripProps> = ({
  state,
  activeTask,
  approvalBundle,
  selectedClipId,
  showQuickActions = true,
  onExecute,
  onResumeTaskQueue,
  onApprovePending,
  onRejectPending,
}) => {
  const statusMeta = STATUS_STYLES[state.status];
  const isBusy =
    state.status === 'planning'
    || state.status === 'acting'
    || state.status === 'verifying';
  const nextTaskStep = activeTask?.steps.find((step) => (
    step.status === 'pending'
    || step.status === 'blocked'
    || step.status === 'failed'
  )) || null;
  const quickActions: Array<{
    key: string;
    label: string;
    capabilityId: StudioAgentCapabilityId;
    input: Record<string, unknown>;
    disabled?: boolean;
  }> = [
    {
      key: 'workspace-project',
      label: 'Project Hub',
      capabilityId: 'navigate_workspace',
      input: { workspace: 'PROJECT' },
    },
    {
      key: 'phase-storyboard',
      label: 'Storyboard',
      capabilityId: 'set_project_phase',
      input: { phase: 'storyboard' },
    },
    {
      key: 'phase-filming',
      label: 'Filming',
      capabilityId: 'set_project_phase',
      input: { phase: 'filming' },
    },
    {
      key: 'phase-review',
      label: 'Review Phase',
      capabilityId: 'set_project_phase',
      input: { phase: 'review' },
    },
    {
      key: 'workspace-edit',
      label: 'Edit',
      capabilityId: 'navigate_workspace',
      input: { workspace: 'EDIT' },
    },
    {
      key: 'clip-focus',
      label: 'Focus Clip',
      capabilityId: 'select_timeline_clip',
      input: { clipId: selectedClipId || '' },
      disabled: !selectedClipId,
    },
  ];

  return (
    <section className="status-card status-card--agent" aria-label="Studio Agent">
      <div className="status-card__head">
        <span className={`status-dot ${statusMeta.dot}`} />
        <span className="status-card__title">Studio Agent</span>
        <span className={`status-chip ${statusMeta.chip}`}>{statusMeta.label}</span>
        {state.capabilityTitle && (
          <span className="status-card__meta">{state.capabilityTitle}</span>
        )}
        {activeTask && (
          <span className="status-chip">Queue {activeTask.status.replace(/_/g, ' ')}</span>
        )}
        {approvalBundle && (
          <span className="status-chip status-chip--success">Bundle active</span>
        )}
        <div className="status-card__actions">
          {showQuickActions && quickActions.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={isBusy || action.disabled}
              onClick={() => {
                void onExecute(action.capabilityId, action.input);
              }}
              data-studio-action={`studio-agent:${action.key}`}
              className="status-button"
            >
              {action.label}
            </button>
          ))}
          {activeTask && activeTask.status !== 'completed' && !state.pendingApproval && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                void onResumeTaskQueue?.();
              }}
              data-studio-action="studio-agent:resume-queue"
              className="status-button status-button--accent"
            >
              Resume Run
            </button>
          )}
          {state.pendingApproval && (
            <>
              <button
                type="button"
                onClick={() => {
                  void onApprovePending?.();
                }}
                data-studio-action="studio-agent:approve"
                className="status-button status-button--success"
              >
                {activeTask ? 'Approve Run' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onRejectPending?.();
                }}
                data-studio-action="studio-agent:reject"
                className="status-button status-button--danger"
              >
                Reject
              </button>
            </>
          )}
        </div>
      </div>
      <div className="status-card__body">
        <div className="status-card__text">{state.detail}</div>
        <div className="status-card__note">{state.snapshotSummary}</div>
        {activeTask && (
          <div className="status-task">
            <div className="status-task__head">
              <div className="min-w-0">
                <div className="status-task__title">{activeTask.title}</div>
                <div className="status-card__note">{activeTask.resultSummary || 'Queue ready.'}</div>
              </div>
              <div className="status-card__note">
                {nextTaskStep ? `Next: ${nextTaskStep.title}` : 'All queued steps are complete.'}
              </div>
            </div>
            <div className="status-task__steps">
              {activeTask.steps.map((step) => {
                const stepMeta = TASK_STEP_STYLES[step.status];
                return (
                  <div key={step.id} className="status-task__step">
                    <div className="min-w-0">
                      <div className="status-task__step-title">{step.title}</div>
                      <div className="status-card__note">
                        {step.detail || (step.status === 'pending' ? 'Waiting for its turn in the run.' : 'No detail yet.')}
                      </div>
                    </div>
                    <span className={`status-chip ${stepMeta.chip}`}>{stepMeta.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default StudioAgentStrip;
