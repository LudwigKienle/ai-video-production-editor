import React, { useMemo } from 'react';
import { ReviewData, ShotPrompt, ShotTask, StoryBible } from '../types';
import { buildRequestsExport, buildRequestsReportHtml, missingShotAssets, setShotTaskStatus, summarizeRequests } from '../services/reviewLogic';

interface RequestsWorkspaceProps {
  reviewData: ReviewData;
  setReviewData: React.Dispatch<React.SetStateAction<ReviewData>>;
  shotPrompts: ShotPrompt[];
  storyBible: StoryBible;
}

const RequestsWorkspace: React.FC<RequestsWorkspaceProps> = ({
  reviewData,
  setReviewData,
  shotPrompts,
  storyBible,
}) => {
  const changeRequests = reviewData.changeRequests ?? [];
  const shotTasks = reviewData.shotTasks ?? [];

  const requestSummaries = useMemo(
    () => summarizeRequests({ ...reviewData, changeRequests, shotTasks }, shotPrompts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changeRequests, shotPrompts, shotTasks],
  );

  const shotByNumber = useMemo(() => {
    const map = new Map<number, ShotPrompt>();
    shotPrompts.forEach((shot) => map.set(shot.shot, shot));
    return map;
  }, [shotPrompts]);

  const handleUpdateTaskStatus = (taskId: string, status: ShotTask['status']) => {
    setReviewData((prev) => setShotTaskStatus(prev, taskId, status));
  };

  const handleExportJson = () => {
    const payload = buildRequestsExport(storyBible.title, requestSummaries);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `director-requests-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    const html = buildRequestsReportHtml(storyBible.title, requestSummaries);
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
                const missing = missingShotAssets(shot);
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
