/**
 * Director review and artist requests as pure reducers on `ReviewData`.
 * ReviewWorkspace, RequestsWorkspace and the MCP review_/requests_ tools all
 * use these functions, so the page and an agent change review data the same way.
 */
import type {
  ChangeRequest,
  DirectorFeedback,
  NamingTemplate,
  ReviewData,
  ShotAnnotation,
  ShotPrompt,
  ShotTask,
} from '../types';

export const DEFAULT_FEEDBACK_SCORE = 7;

const buildId = () => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export const clampScore = (value: number) => Math.min(10, Math.max(1, Math.round(value)));

const normalize = (value: string) => value.trim().toLowerCase();

export const normalizeReviewData = (value?: Partial<ReviewData> | null): ReviewData => ({
  reviewSets: value?.reviewSets ?? [],
  variants: value?.variants ?? [],
  comments: value?.comments ?? [],
  decisions: value?.decisions ?? [],
  tasks: value?.tasks ?? [],
  directorFeedback: value?.directorFeedback ?? [],
  changeRequests: value?.changeRequests ?? [],
  shotTasks: value?.shotTasks ?? [],
  shotAnnotations: value?.shotAnnotations ?? [],
});

export function requestMatchesShot(request: Pick<ChangeRequest, 'type' | 'targetName'>, shot: ShotPrompt): boolean {
  const target = normalize(request.targetName);
  if (!target) return false;
  if (request.type === 'character') {
    return shot.characters?.some((name) => normalize(name) === target) ?? false;
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
}

export const getAffectedShotNumbers = (request: Pick<ChangeRequest, 'type' | 'targetName'>, shots: ShotPrompt[]) =>
  shots.filter((shot) => requestMatchesShot(request, shot)).map((shot) => shot.shot);

export const findFeedback = (data: ReviewData, scope: DirectorFeedback['scope'], targetId: string) =>
  (data.directorFeedback ?? []).find((entry) => entry.scope === scope && entry.targetId === targetId);

/**
 * Create or update the score/note for the concept, a shot or a video.
 * A new entry without a score gets the score the page shows by default (7).
 */
export function upsertFeedback(
  data: ReviewData,
  scope: DirectorFeedback['scope'],
  targetId: string,
  updates: { score?: number; note?: string },
  now = new Date().toISOString(),
): ReviewData {
  const entries = data.directorFeedback ?? [];
  const index = entries.findIndex((entry) => entry.scope === scope && entry.targetId === targetId);
  if (index === -1) {
    const entry: DirectorFeedback = {
      id: buildId(),
      scope,
      targetId,
      score: clampScore(typeof updates.score === 'number' ? updates.score : DEFAULT_FEEDBACK_SCORE),
      note: updates.note ?? '',
      createdAt: now,
      updatedAt: now,
    };
    return { ...data, directorFeedback: [...entries, entry] };
  }
  const existing = entries[index];
  const next = [...entries];
  next[index] = {
    ...existing,
    ...(updates.note !== undefined ? { note: updates.note } : {}),
    score: clampScore(typeof updates.score === 'number' ? updates.score : existing.score),
    updatedAt: now,
  };
  return { ...data, directorFeedback: next };
}

/** Adds a change request and opens one shot task per affected shot. */
export function addChangeRequest(
  data: ReviewData,
  input: { type: ChangeRequest['type']; targetName: string; action: ChangeRequest['action']; note?: string },
  shots: ShotPrompt[],
  now = new Date().toISOString(),
): { data: ReviewData; request: ChangeRequest; tasks: ShotTask[] } {
  const targetName = input.targetName.trim();
  if (!targetName) throw new Error('A change request needs a target name.');
  const request: ChangeRequest = {
    id: buildId(),
    type: input.type,
    targetName,
    action: input.action,
    note: (input.note ?? '').trim(),
    createdAt: now,
    updatedAt: now,
  };
  const tasks: ShotTask[] = getAffectedShotNumbers(request, shots).map((shotNumber) => ({
    id: buildId(),
    requestId: request.id,
    shotNumber,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }));
  return {
    data: {
      ...data,
      changeRequests: [...(data.changeRequests ?? []), request],
      shotTasks: [...(data.shotTasks ?? []), ...tasks],
    },
    request,
    tasks,
  };
}

/** Removes a change request together with its shot tasks. */
export function removeChangeRequest(data: ReviewData, requestId: string): ReviewData {
  return {
    ...data,
    changeRequests: (data.changeRequests ?? []).filter((request) => request.id !== requestId),
    shotTasks: (data.shotTasks ?? []).filter((task) => task.requestId !== requestId),
  };
}

export function setShotTaskStatus(
  data: ReviewData,
  taskId: string,
  status: ShotTask['status'],
  now = new Date().toISOString(),
): ReviewData {
  if (!(data.shotTasks ?? []).some((task) => task.id === taskId)) throw new Error(`Task ${taskId} not found.`);
  return {
    ...data,
    shotTasks: (data.shotTasks ?? []).map((task) => (task.id === taskId ? { ...task, status, updatedAt: now } : task)),
  };
}

/** Stores the flattened markup PNG for one asset of a shot (replaces the previous one). */
export function saveShotAnnotation(
  data: ReviewData,
  target: { shotNumber: number; assetType: ShotAnnotation['assetType']; assetLabel: string },
  imageUrl: string,
  now = new Date().toISOString(),
): ReviewData {
  const entries = data.shotAnnotations ?? [];
  const index = entries.findIndex((entry) => entry.shotNumber === target.shotNumber && entry.assetType === target.assetType);
  if (index === -1) {
    const entry: ShotAnnotation = {
      id: buildId(),
      shotNumber: target.shotNumber,
      assetType: target.assetType,
      assetLabel: target.assetLabel,
      imageUrl,
      createdAt: now,
      updatedAt: now,
    };
    return { ...data, shotAnnotations: [...entries, entry] };
  }
  const next = [...entries];
  next[index] = { ...entries[index], assetLabel: target.assetLabel, imageUrl, updatedAt: now };
  return { ...data, shotAnnotations: next };
}

export function removeShotAnnotation(data: ReviewData, shotNumber: number, assetType: ShotAnnotation['assetType']): ReviewData {
  return {
    ...data,
    shotAnnotations: (data.shotAnnotations ?? []).filter((entry) => !(entry.shotNumber === shotNumber && entry.assetType === assetType)),
  };
}

export const getProjectNamingTemplate = (templates: NamingTemplate[]) => {
  const projectTemplates = templates.filter((template) => template.scope === 'project');
  return projectTemplates.find((template) => template.isDefault) || projectTemplates[0] || null;
};

/** Sets the project naming template; an empty value removes it (as on the page). */
export function setProjectNamingTemplate(templates: NamingTemplate[], value: string, now = new Date().toISOString()): NamingTemplate[] {
  const trimmed = value.trim();
  const existing = templates.find((template) => template.scope === 'project');
  if (!trimmed) return templates.filter((template) => template.scope !== 'project');
  if (existing) {
    return templates.map((template) =>
      template.id === existing.id ? { ...template, template: trimmed, isDefault: true, updatedAt: now } : template,
    );
  }
  return [...templates, { id: buildId(), scope: 'project', template: trimmed, isDefault: true, createdAt: now, updatedAt: now }];
}

export type RequestSummary = ChangeRequest & {
  affectedShots: number[];
  tasks: ShotTask[];
};

/** What the artist sees on the Requests page: requests with live-matched shots and their tasks. */
export function summarizeRequests(data: ReviewData, shots: ShotPrompt[]): RequestSummary[] {
  const tasks = data.shotTasks ?? [];
  return (data.changeRequests ?? []).map((request) => ({
    ...request,
    affectedShots: getAffectedShotNumbers(request, shots),
    tasks: tasks.filter((task) => task.requestId === request.id),
  }));
}

/** Which assets a shot is still missing (shown as "Missing: …" on both pages). */
export function missingShotAssets(shot: ShotPrompt | undefined): Array<'image' | 'sketch' | 'video'> {
  if (!shot) return [];
  const missing: Array<'image' | 'sketch' | 'video'> = [];
  if (!shot.imageUrl) missing.push('image');
  if (!shot.sketchUrl) missing.push('sketch');
  if (!shot.videoUrl) missing.push('video');
  return missing;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));

/** JSON export of the Requests page. */
export const buildRequestsExport = (projectTitle: string | undefined, summaries: RequestSummary[], now = new Date().toISOString()) => ({
  exportedAt: now,
  project: { title: projectTitle || 'Untitled Project' },
  requests: summaries,
});

/** Printable HTML of the Requests page (all user text escaped). */
export function buildRequestsReportHtml(projectTitle: string | undefined, summaries: RequestSummary[]): string {
  const items = summaries
    .map((request) => {
      const shots = request.affectedShots.length ? `Shots: ${request.affectedShots.join(', ')}` : 'Shots: none';
      return `
                  <div class="request">
                    <strong>${escapeHtml(request.type)}</strong> · <strong>${escapeHtml(request.targetName)}</strong> · ${escapeHtml(request.action)}<br/>
                    ${request.note ? `<em>${escapeHtml(request.note)}</em><br/>` : ''}
                    <div class="shots">${shots}</div>
                  </div>
                `;
    })
    .join('');
  return `
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
          <p>Project: ${escapeHtml(projectTitle || 'Untitled Project')}</p>
          <div class="section">
            ${items}
          </div>
        </body>
      </html>
    `;
}
