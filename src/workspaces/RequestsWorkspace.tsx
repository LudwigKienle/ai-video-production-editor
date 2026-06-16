import React, { useMemo } from 'react';
import { ReviewData, ShotPrompt, ShotTask, StoryBible } from '../types';

interface RequestsWorkspaceProps {
  reviewData: ReviewData;
  setReviewData: React.Dispatch<React.SetStateAction<ReviewData>>;
  shotPrompts: ShotPrompt[];
  storyBible: StoryBible;
}

const normalize = (value: string) => value.trim().toLowerCase();

const RequestsWorkspace: React.FC<RequestsWorkspaceProps> = ({
  reviewData,
  setReviewData,
  shotPrompts,
  storyBible,
}) => {
  const changeRequests = reviewData.changeRequests ?? [];
  const shotTasks = reviewData.shotTasks ?? [];

  const requestSummaries = useMemo(() => {
    return changeRequests.map((request) => {
      const target = normalize(request.targetName);
      const affectedShots = shotPrompts
        .filter((shot) => {
          if (request.type === 'character') {
            return shot.characters?.some((name) => normalize(name) === target);
          }
          if (request.type === 'environment') {
            return normalize(shot.environment || '') === target;
          }
          if (request.type === 'product' || request.type === 'brand') {
            const productMatch = shot.products?.some((name) => normalize(name) === target);
            const textMatch = normalize(shot.prompt || '').includes(target) || normalize(shot.description || '').includes(target);
            return Boolean(productMatch || textMatch);
          }
          return false;
        })
        .map((shot) => shot.shot);

      return {
        ...request,
        affectedShots,
        tasks: shotTasks.filter((task) => task.requestId === request.id),
      };
    });
  }, [changeRequests, shotPrompts, shotTasks]);

  const shotByNumber = useMemo(() => {
    const map = new Map<number, ShotPrompt>();
    shotPrompts.forEach((shot) => map.set(shot.shot, shot));
    return map;
  }, [shotPrompts]);

  const handleUpdateTaskStatus = (taskId: string, status: ShotTask['status']) => {
    setReviewData((prev) => ({
      ...prev,
      shotTasks: (prev.shotTasks ?? []).map((task) =>
        task.id === taskId ? { ...task, status, updatedAt: new Date().toISOString() } : task,
      ),
    }));
  };

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      project: { title: storyBible.title || 'Untitled Project' },
      requests: requestSummaries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `director-requests-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    const html = `
      <html>
        <head>
          <title>Director Requests</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            h1 { margin: 0 0 8px; }
            .section { margin-top: 20px; }
            .request { border: 1px solid #ddd; padding: 12px; margin-bottom: 12px; }
            .shots { color: #555; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>Director Requests</h1>
          <p>Project: ${storyBible.title || 'Untitled Project'}</p>
          <div class="section">
            ${requestSummaries
              .map((request) => {
                const shots = request.affectedShots.length ? `Shots: ${request.affectedShots.join(', ')}` : 'Shots: none';
                return `
                  <div class="request">
                    <strong>${request.type}</strong> · <strong>${request.targetName}</strong> · ${request.action}<br/>
                    ${request.note ? `<em>${request.note}</em><br/>` : ''}
                    <div class="shots">${shots}</div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </body>
      </html>
    `;
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Requests</p>
          <h1 className="text-2xl font-semibold">Artist Requests</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="app-button border border-slate-500/40" onClick={handleExportJson}>
            Export JSON
          </button>
          <button className="app-button border border-slate-500/40" onClick={handleExportPdf}>
            Export PDF
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {requestSummaries.length === 0 && (
          <p className="text-sm text-slate-400">No requests yet.</p>
        )}
        {requestSummaries.map((request) => (
          <div key={request.id} className="app-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {request.type} · {request.targetName} · {request.action}
                </div>
                {request.note && <div className="text-xs text-slate-400 mt-1">{request.note}</div>}
              </div>
              {request.affectedShots.length > 0 && (
                <div className="text-xs text-slate-400">Shots: {request.affectedShots.join(', ')}</div>
              )}
            </div>
            <div className="mt-3 space-y-2">
              {request.tasks.length === 0 && (
                <p className="text-xs text-slate-400">No tasks generated yet.</p>
              )}
              {request.tasks.map((task) => {
                const shot = shotByNumber.get(task.shotNumber);
                const missing = shot
                  ? [
                      !shot.imageUrl ? 'image' : null,
                      !shot.sketchUrl ? 'sketch' : null,
                      !shot.videoUrl ? 'video' : null,
                    ].filter(Boolean)
                  : [];
                return (
                  <div
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-500/20 p-2 text-xs text-slate-300"
                  >
                    <div>
                      <span>Shot {task.shotNumber}</span>
                      {missing.length > 0 && (
                        <span className="ml-2 text-[10px] text-rose-300">Missing: {missing.join(', ')}</span>
                      )}
                    </div>
                    <select
                      className="app-select text-xs"
                      value={task.status}
                      onChange={(e) => handleUpdateTaskStatus(task.id, e.target.value as ShotTask['status'])}
                    >
                      <option value="open">open</option>
                      <option value="in_progress">in progress</option>
                      <option value="done">done</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RequestsWorkspace;
