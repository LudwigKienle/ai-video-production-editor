import { useEffect, useState } from 'react';
import { subscribeTasks, type TaskRecord } from '../services/taskCenter';

/** Live view of the Task Center; re-renders once a second while jobs run so progress estimates advance. */
export const useTaskCenter = () => {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => subscribeTasks(setTasks), []);

  const hasActive = tasks.some((task) => task.status === 'running' || task.status === 'queued');
  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [hasActive]);

  return tasks;
};
