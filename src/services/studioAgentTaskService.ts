import type {
  ScriptLength,
  StudioAgentCapabilityId,
  StudioAgentPolicy,
  StudioAgentTask,
  StudioAgentTaskStep,
} from '../types';
import { getStudioAgentCapability } from './studioAutomationService';

type BuildProjectRunTaskOptions = {
  prompt?: string;
  length?: ScriptLength;
  mode?: 'fast' | 'slow';
  scriptExists: boolean;
  conceptLimit?: number;
  storyboardLimit?: number;
  videoLimit?: number;
  includeVideos?: boolean;
};

const nowIso = () => new Date().toISOString();
const buildId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const resolvePolicy = (
  capabilityId: StudioAgentCapabilityId,
): StudioAgentPolicy => {
  const capability = getStudioAgentCapability(capabilityId);
  return capability?.policy
    || (capability?.requiresHumanReview ? 'approval_required' : 'safe_auto')
    || 'safe_auto';
};

const buildCapabilityStep = (
  capabilityId: StudioAgentCapabilityId,
  input?: Record<string, unknown>,
): StudioAgentTaskStep => {
  const capability = getStudioAgentCapability(capabilityId);
  return {
    id: buildId(`step-${capabilityId}`),
    title: capability?.title || capabilityId,
    status: 'pending',
    capabilityId,
    input,
    policy: resolvePolicy(capabilityId),
    updatedAt: nowIso(),
  };
};

export const buildStudioAgentProjectRunTask = ({
  prompt,
  length,
  mode,
  scriptExists,
  conceptLimit,
  storyboardLimit,
  videoLimit,
  includeVideos = false,
}: BuildProjectRunTaskOptions): StudioAgentTask => {
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmedPrompt && !scriptExists) {
    throw new Error('A prompt is required when the project does not have a script yet.');
  }

  const steps: StudioAgentTaskStep[] = [];
  if (trimmedPrompt) {
    steps.push(buildCapabilityStep('write_project_script', {
      prompt: trimmedPrompt,
      length,
      mode,
    }));
  } else {
    steps.push({
      id: buildId('step-use-existing-script'),
      title: 'Use Existing Script',
      status: 'completed',
      detail: 'Reused the current project script as the run starting point.',
      policy: 'safe_auto',
      updatedAt: nowIso(),
    });
  }

  steps.push(buildCapabilityStep(
    'generate_project_concepts',
    typeof conceptLimit === 'number' && Number.isFinite(conceptLimit)
      ? { limit: conceptLimit }
      : undefined,
  ));
  steps.push(buildCapabilityStep('run_director_pass'));
  steps.push(buildCapabilityStep('apply_director_treatment'));
  steps.push(buildCapabilityStep(
    'generate_storyboard_images',
    typeof storyboardLimit === 'number' && Number.isFinite(storyboardLimit)
      ? { limit: storyboardLimit }
      : undefined,
  ));

  if (includeVideos) {
    steps.push(buildCapabilityStep(
      'generate_storyboard_videos',
      typeof videoLimit === 'number' && Number.isFinite(videoLimit)
        ? { limit: videoLimit }
        : undefined,
    ));
  }

  const createdAt = nowIso();
  return {
    id: buildId('studio-agent-task'),
    title: includeVideos ? 'Project Run + Filming' : 'Project Run',
    goal: trimmedPrompt || 'Continue the current project from script through storyboard.',
    agent: 'automation',
    status: 'queued',
    policy: steps.some((step) => step.policy === 'approval_required')
      ? 'approval_required'
      : 'safe_auto',
    steps,
    createdAt,
    updatedAt: createdAt,
    resultSummary: `Queued ${steps.length} steps.`,
  };
};

export const getNextStudioAgentTaskStep = (
  task: StudioAgentTask,
): StudioAgentTaskStep | null =>
  task.steps.find(
    (step) =>
      step.status === 'pending'
      || step.status === 'blocked'
      || step.status === 'failed',
  ) || null;

export const patchStudioAgentTaskStep = (
  task: StudioAgentTask,
  stepId: string,
  patch: Partial<StudioAgentTaskStep>,
): StudioAgentTask => {
  const updatedAt = patch.updatedAt || nowIso();
  return {
    ...task,
    updatedAt,
    steps: task.steps.map((step) => (
      step.id === stepId
        ? {
            ...step,
            ...patch,
            updatedAt,
          }
        : step
    )),
  };
};

export const patchStudioAgentTask = (
  task: StudioAgentTask,
  patch: Partial<StudioAgentTask>,
): StudioAgentTask => ({
  ...task,
  ...patch,
  updatedAt: patch.updatedAt || nowIso(),
});

export const summarizeStudioAgentTask = (
  task: StudioAgentTask,
): string => {
  const totalSteps = task.steps.length;
  const completedSteps = task.steps.filter((step) => step.status === 'completed').length;
  const runningStep = task.steps.find((step) => step.status === 'running');
  const nextStep = getNextStudioAgentTaskStep(task);

  if (task.status === 'completed') {
    return `Completed ${completedSteps} of ${totalSteps} steps.`;
  }

  if (task.status === 'awaiting_approval') {
    return `Completed ${completedSteps} of ${totalSteps} steps. Waiting for approval on ${nextStep?.title || task.title}.`;
  }

  if (task.status === 'failed') {
    return `Completed ${completedSteps} of ${totalSteps} steps. Next: ${nextStep?.title || 'review the run'}.`;
  }

  if (runningStep) {
    return `Completed ${completedSteps} of ${totalSteps} steps. Running ${runningStep.title}.`;
  }

  if (nextStep) {
    return `Completed ${completedSteps} of ${totalSteps} steps. Next: ${nextStep.title}.`;
  }

  return `${task.title} is queued.`;
};
