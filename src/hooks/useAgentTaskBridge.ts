import { useEffect } from 'react';
import { startTask, type TaskHandle } from '../services/taskCenter';
import { cancelMidjourneyJob, isMidjourneyAgentAvailable, onMidjourneyEvent } from '../services/midjourneyAgentService';
import { isLocalAgentsAvailable, onLocalAgentEvent, cancelLocalAgent, type LocalAgentId } from '../services/localAgentsService';

/**
 * Jeff (Midjourney) jobs and local-agent turns run in the Electron main process and
 * report through IPC events; this hook mirrors them into the task center so the
 * Activity drawer shows everything that is running, not only API calls.
 */
export const useAgentTaskBridge = () => {
  useEffect(() => {
    const disposers: Array<() => void> = [];

    if (isMidjourneyAgentAvailable()) {
      const jobs = new Map<string, TaskHandle>();
      disposers.push(onMidjourneyEvent((event) => {
        if (event.type !== 'job' || !event.id) return;
        let task = jobs.get(event.id);
        if (!task) {
          const label = event.id;
          task = startTask({ label: `Midjourney · ${(event.prompt || 'job').slice(0, 48)}`, kind: 'image', provider: 'midjourney', estimatedMs: 3 * 60 * 1000, message: 'Starting…', cancel: () => { void cancelMidjourneyJob(label); } });
          jobs.set(event.id, task);
        }
        switch (event.phase) {
          case 'starting': if ((event.attempt || 1) > 1) task.update({ message: `Retrying with a softened prompt (attempt ${event.attempt})…`, progress: 0.05 }); break;
          case 'waiting': task.update({ message: `Waiting for a free Midjourney slot (${event.running ?? '?'}/${event.limit ?? '?'} rendering)…`, progress: 0.02 }); break;
          case 'moderated': task.update({ message: 'Prompt blocked by Midjourney moderation. Softening and retrying…', progress: 0.05 }); break;
          case 'failed': task.fail(event.error || 'Midjourney job failed'); jobs.delete(event.id); break;
          case 'uploading': task.update({ message: `Uploading ${event.name || 'reference'}…`, progress: 0.1 }); break;
          case 'submitting': task.update({ message: 'Submitting prompt…', progress: 0.2 }); break;
          case 'queued': task.update({ message: 'Queued at Midjourney…', progress: 0.3 }); break;
          case 'rendering': task.update({ message: typeof event.percent === 'number' ? `Rendering ${event.percent}%` : 'Rendering…', progress: typeof event.percent === 'number' ? 0.3 + (event.percent / 100) * 0.6 : null }); break;
          case 'downloading': task.update({ message: 'Downloading grid…', progress: 0.92 }); break;
          case 'done': task.complete(`${event.count || 4} images`); jobs.delete(event.id); break;
          default: break;
        }
      }));
    }

    if (isLocalAgentsAvailable()) {
      const turns = new Map<LocalAgentId, TaskHandle>();
      const label = (agent: LocalAgentId) => (agent === 'claude-code' ? 'Claude Code' : agent === 'codex' ? 'Codex' : agent);
      disposers.push(onLocalAgentEvent((event) => {
        if (event.type === 'turn') {
          if (event.phase === 'start') {
            turns.get(event.agent)?.complete();
            turns.set(event.agent, startTask({ label: `${label(event.agent)} is working`, kind: 'agent', provider: event.agent, estimatedMs: 90_000, message: 'Thinking…', cancel: () => { void cancelLocalAgent(event.agent); } }));
          } else {
            const task = turns.get(event.agent);
            if (task) { if (event.phase === 'error') task.fail(event.error || 'Agent turn failed'); else task.complete(event.stopReason ? `Finished (${event.stopReason})` : 'Finished'); }
            turns.delete(event.agent);
          }
        } else if (event.type === 'update') {
          const update = event.update as any;
          const task = turns.get(event.agent);
          if (task && (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') && update.title) task.update({ message: update.status === 'completed' ? `Done: ${update.title}` : update.title });
        } else if (event.type === 'permission') {
          turns.get(event.agent)?.update({ message: 'Waiting for your permission…' });
        } else if (event.type === 'exit') {
          const task = turns.get(event.agent);
          if (task) { task.fail(`${label(event.agent)} exited (${event.code ?? '?'})`); turns.delete(event.agent); }
        }
      }));
    }

    return () => disposers.forEach((dispose) => dispose());
  }, []);
};
