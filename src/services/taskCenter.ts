/**
 * Task Center — a tiny in-memory registry of long-running work (generations,
 * uploads, analyses) so the toolbar can show progress for everything at once.
 *
 * Services call `startTask()` and update the handle as they poll; UI code
 * subscribes with `subscribeTasks()` / `useTaskCenter()`.
 */

export type TaskKind = 'image' | 'video' | 'audio' | '3d' | 'analysis' | 'upload' | 'export' | 'agent' | 'other';
export type TaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type TaskRecord = {
  id: string;
  label: string;
  kind: TaskKind;
  provider?: string;
  status: TaskStatus;
  /** 0-1, or null when indeterminate. */
  progress: number | null;
  message?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  /** Rough expected duration in ms, used to animate indeterminate jobs. */
  estimatedMs?: number;
  error?: string;
  cancel?: () => void;
};

export type TaskHandle = {
  id: string;
  update: (patch: Partial<Pick<TaskRecord, 'progress' | 'message' | 'label' | 'estimatedMs' | 'status'>>) => void;
  complete: (message?: string) => void;
  fail: (error: unknown) => void;
  cancel: () => void;
};

type Listener = (tasks: TaskRecord[]) => void;

const tasks = new Map<string, TaskRecord>();
const listeners = new Set<Listener>();
const DONE_TTL_MS = 45_000;
const MAX_HISTORY = 12;

let counter = 0;
const nextId = () => `task-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;

const snapshot = () => Array.from(tasks.values()).sort((a, b) => {
  const rank = (task: TaskRecord) => (task.status === 'running' || task.status === 'queued' ? 0 : 1);
  return rank(a) - rank(b) || b.updatedAt - a.updatedAt;
});

const emit = () => {
  const list = snapshot();
  listeners.forEach((listener) => {
    try {
      listener(list);
    } catch (error) {
      console.error('Task listener failed', error);
    }
  });
};

const prune = () => {
  const now = Date.now();
  const finished = snapshot().filter((task) => task.status !== 'running' && task.status !== 'queued');
  finished.forEach((task, index) => {
    if (index >= MAX_HISTORY || (task.finishedAt && now - task.finishedAt > DONE_TTL_MS)) {
      tasks.delete(task.id);
    }
  });
};

const patchTask = (id: string, patch: Partial<TaskRecord>) => {
  const current = tasks.get(id);
  if (!current) return;
  tasks.set(id, { ...current, ...patch, updatedAt: Date.now() });
  emit();
};

export const startTask = (input: {
  label: string;
  kind?: TaskKind;
  provider?: string;
  message?: string;
  estimatedMs?: number;
  progress?: number | null;
  cancel?: () => void;
}): TaskHandle => {
  const id = nextId();
  const now = Date.now();
  tasks.set(id, {
    id,
    label: input.label,
    kind: input.kind || 'other',
    provider: input.provider,
    status: 'running',
    progress: input.progress ?? null,
    message: input.message,
    startedAt: now,
    updatedAt: now,
    estimatedMs: input.estimatedMs,
    cancel: input.cancel,
  });
  prune();
  emit();
  return {
    id,
    update: (patch) => patchTask(id, patch),
    complete: (message) => patchTask(id, { status: 'done', progress: 1, message: message || 'Done', finishedAt: Date.now() }),
    fail: (error) => patchTask(id, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error || 'Failed'),
      message: error instanceof Error ? error.message : String(error || 'Failed'),
      finishedAt: Date.now(),
    }),
    cancel: () => {
      const current = tasks.get(id);
      current?.cancel?.();
      patchTask(id, { status: 'cancelled', message: 'Cancelled', finishedAt: Date.now() });
    },
  };
};

/** Wraps a promise-returning job so success/failure is recorded automatically. */
export const trackTask = async <T>(
  input: Parameters<typeof startTask>[0],
  job: (task: TaskHandle) => Promise<T>,
): Promise<T> => {
  const task = startTask(input);
  try {
    const result = await job(task);
    task.complete();
    return result;
  } catch (error) {
    task.fail(error);
    throw error;
  }
};

export const subscribeTasks = (listener: Listener) => {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
};

export const getTasks = () => snapshot();

export const dismissTask = (id: string) => {
  const task = tasks.get(id);
  if (!task || task.status === 'running' || task.status === 'queued') return;
  tasks.delete(id);
  emit();
};

export const clearFinishedTasks = () => {
  snapshot().forEach((task) => {
    if (task.status !== 'running' && task.status !== 'queued') tasks.delete(task.id);
  });
  emit();
};

/** Estimated progress for indeterminate jobs: eases toward 90% over the expected duration. */
export const estimateProgress = (task: TaskRecord, now = Date.now()) => {
  if (task.status === 'done') return 1;
  if (typeof task.progress === 'number') return Math.min(1, Math.max(0, task.progress));
  const expected = task.estimatedMs || 60_000;
  const elapsed = now - task.startedAt;
  return Math.min(0.92, 1 - Math.exp(-elapsed / expected));
};

export const summarizeTasks = (list: TaskRecord[]) => {
  const active = list.filter((task) => task.status === 'running' || task.status === 'queued');
  const failed = list.filter((task) => task.status === 'failed');
  return { active, failed, activeCount: active.length, failedCount: failed.length };
};
