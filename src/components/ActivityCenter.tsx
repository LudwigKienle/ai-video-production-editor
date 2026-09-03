import React from 'react';
import { clearFinishedTasks, dismissTask, estimateProgress, type TaskRecord } from '../services/taskCenter';

const KIND_LABELS: Record<TaskRecord['kind'], string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  '3d': '3D',
  analysis: 'Analysis',
  upload: 'Upload',
  export: 'Export',
  agent: 'Agent',
  other: 'Task',
};

const formatElapsed = (task: TaskRecord) => {
  const end = task.finishedAt || Date.now();
  const seconds = Math.max(0, Math.round((end - task.startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const ActivityCenter: React.FC<{ tasks: TaskRecord[] }> = ({ tasks }) => {
  const active = tasks.filter((task) => task.status === 'running' || task.status === 'queued');
  const finished = tasks.filter((task) => task.status !== 'running' && task.status !== 'queued');

  return (
    <section className="status-card status-card--tasks" aria-label="Tasks">
      <div className="status-card__head">
        <span className={`status-dot ${active.length > 0 ? 'status-dot--accent' : 'status-dot--muted'}`} />
        <span className="status-card__title">Tasks</span>
        <span className="status-card__meta">
          {active.length > 0 ? `${active.length} running` : finished.length > 0 ? 'Nothing running' : 'Generations and exports show up here'}
        </span>
        {finished.length > 0 && (
          <div className="status-card__actions">
            <button type="button" className="status-button" onClick={clearFinishedTasks}>Clear</button>
          </div>
        )}
      </div>
      {tasks.length > 0 && (
        <ul className="task-list" role="list">
          {[...active, ...finished].map((task) => {
            const progress = estimateProgress(task);
            const isActive = task.status === 'running' || task.status === 'queued';
            return (
              <li key={task.id} className={`task-row task-row--${task.status}`}>
                <div className="task-row__head">
                  <span className="task-row__kind">{KIND_LABELS[task.kind]}</span>
                  <span className="task-row__label" title={task.label}>{task.label}</span>
                  {task.provider && <span className="task-row__provider">{task.provider}</span>}
                  <span className="task-row__time">{formatElapsed(task)}</span>
                  {isActive && task.cancel && (
                    <button type="button" className="task-row__action" onClick={() => task.cancel?.()} title="Cancel">Cancel</button>
                  )}
                  {!isActive && (
                    <button type="button" className="task-row__action" onClick={() => dismissTask(task.id)} title="Dismiss" aria-label="Dismiss">×</button>
                  )}
                </div>
                <div className="task-row__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                  <span
                    className={`task-row__fill ${task.progress === null && isActive ? 'task-row__fill--estimated' : ''}`}
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                {(task.message || task.error) && (
                  <div className={`task-row__message ${task.status === 'failed' ? 'task-row__message--error' : ''}`}>
                    {task.error || task.message}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default ActivityCenter;
