import { startTask } from './taskCenter.ts';

export type VgenvJob = {
  id: string;
  status: 'preparing' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress?: number;
  duration?: number;
  price?: { currency: 'CNY' | 'USD'; amount_micros: number } | null;
  output?: { url: string; expires_at: string | null } | null;
  error?: { code?: string; message?: string } | null;
  localPath?: string;
};

export type VgenvInput = {
  prompt: string;
  duration: number;
  resolution: '480p' | '768p';
  aspectRatio: string;
  promptMode: 'raw' | 'enhance';
  firstFrame?: string;
  lastFrame?: string;
};

export const vgenvApi = () => {
  if (!window.electron?.vgenv) throw new Error('vgenv is available only in the desktop app.');
  return window.electron.vgenv;
};

export const formatVgenvPrice = (price: VgenvJob['price']) =>
  price ? `${price.currency} ${(price.amount_micros / 1_000_000).toFixed(4)}` : 'Final server price unavailable';

/** Poll an existing job. A rejected download leaves its job ID available for retry. */
export const waitForVgenvJob = async (
  projectPath: string,
  id: string,
  onUpdate: (job: VgenvJob) => void,
  signal?: AbortSignal,
) => {
  const task = startTask({ label: 'MiniMax H3 (vgenv)', kind: 'video', provider: 'vgenv' });
  let remoteCancelled = false;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Status polling stopped', 'AbortError');
      const job = await vgenvApi().get({ projectPath, id });
      if (signal?.aborted) throw new DOMException('Status polling stopped', 'AbortError');
      onUpdate(job);
      task.update({ message: `vgenv: ${job.status}`, progress: typeof job.progress === 'number' ? job.progress / 100 : null });
      if (job.status === 'succeeded') {
        task.complete('Video ready for download');
        return job;
      }
      if (job.status === 'failed') throw new Error(job.error?.message || job.error?.code || 'vgenv generation failed.');
      if (job.status === 'cancelled') {
        remoteCancelled = true;
        task.cancel();
        throw new Error('vgenv confirmed cancellation.');
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 3000);
        const abort = () => { clearTimeout(timer); reject(new DOMException('Status polling stopped', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
      });
    }
  } catch (error) {
    if (signal?.reason === 'remote-cancelled') task.cancel();
    else if (!remoteCancelled) task.fail(error);
    throw error;
  }
};
