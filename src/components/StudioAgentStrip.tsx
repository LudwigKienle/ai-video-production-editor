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

const STATUS_STYLES: Record<
  StudioAgentRuntimeState['status'],
  { badge: string; label: string }
> = {
  idle: {
    badge: 'border-slate-500/30 bg-slate-500/10 text-slate-200',
    label: 'Idle',
  },
  planning: {
    badge: 'border-sky-400/20 bg-sky-400/10 text-sky-200',
    label: 'Planning',
  },
  awaiting_approval: {
    badge: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
    label: 'Awaiting Approval',
  },
  acting: {
    badge: 'border-indigo-400/20 bg-indigo-400/10 text-indigo-200',
    label: 'Acting',
  },
  verifying: {
    badge: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
    label: 'Verifying',
  },
  completed: {
    badge: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
    label: 'Verified',
  },
  error: {
    badge: 'border-rose-400/20 bg-rose-400/10 text-rose-200',
    label: 'Needs review',
  },
};

const TASK_STEP_STYLES: Record<
  StudioAgentTaskStep['status'],
  { badge: string; label: string }
> = {
  pending: {
    badge: 'border-white/10 bg-white/5 text-slate-200',
    label: 'Queued',
  },
  running: {
    badge: 'border-sky-400/20 bg-sky-400/10 text-sky-200',
    label: 'Running',
  },
  completed: {
    badge: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200',
    label: 'Done',
  },
  blocked: {
    badge: 'border-amber-400/20 bg-amber-400/10 text-amber-200',
    label: 'Blocked',
  },
  failed: {
    badge: 'border-rose-400/20 bg-rose-400/10 text-rose-200',
    label: 'Retry',
  },
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
    <div className="agent-strip rounded-2xl border border-white/10 bg-gradient-to-r from-slate-950/90 via-slate-950/75 to-indigo-950/45 px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${statusMeta.badge}`}>
              Studio Agent {statusMeta.label}
            </span>
            {state.capabilityTitle && (
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                {state.capabilityTitle}
              </span>
            )}
            {activeTask && (
              <span className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-indigo-100">
                Queue {activeTask.status.replace(/_/g, ' ')}
              </span>
            )}
            {approvalBundle && (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-100">
                Bundle Active
              </span>
            )}
          </div>
          <div className="mt-2 text-sm text-white">{state.detail}</div>
          <div className="mt-1 text-xs text-slate-300">{state.snapshotSummary}</div>
          {activeTask && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                    Run Queue
                  </div>
                  <div className="mt-1 text-sm font-medium text-white">{activeTask.title}</div>
                  <div className="mt-1 text-xs text-slate-300">
                    {activeTask.resultSummary || 'Queue ready.'}
                  </div>
                </div>
                <div className="text-xs text-slate-300">
                  {nextTaskStep ? `Next: ${nextTaskStep.title}` : 'All queued steps are complete.'}
                </div>
              </div>
              <div className="mt-3 grid gap-2 xl:grid-cols-2">
                {activeTask.steps.map((step) => {
                  const stepMeta = TASK_STEP_STYLES[step.status];
                  return (
                    <div
                      key={step.id}
                      className="rounded-xl border border-white/8 bg-white/[0.04] px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white">{step.title}</div>
                          <div className="mt-1 text-[11px] text-slate-300">
                            {step.detail || (step.status === 'pending' ? 'Waiting for its turn in the run.' : 'No detail yet.')}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${stepMeta.badge}`}>
                          {stepMeta.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {showQuickActions && quickActions.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={isBusy || action.disabled}
              onClick={() => {
                void onExecute(action.capabilityId, action.input);
              }}
              data-studio-action={`studio-agent:${action.key}`}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:border-indigo-300/40 hover:bg-indigo-400/10 disabled:cursor-not-allowed disabled:opacity-45"
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
              className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-100 transition hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-45"
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
                className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-100 transition hover:bg-emerald-500/20"
              >
                {activeTask ? 'Approve Run' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onRejectPending?.();
                }}
                data-studio-action="studio-agent:reject"
                className="rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-500/20"
              >
                Reject
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudioAgentStrip;
