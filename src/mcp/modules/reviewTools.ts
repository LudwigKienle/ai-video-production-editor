/**
 * MCP tools: Review group pages "Director" (REVIEW) and "Requests" (REQUESTS).
 * Same reducers as the pages (services/reviewLogic.ts); data is the project's
 * `reviewData` and `namingTemplates`.
 */
import type { ChangeRequest, DirectorFeedback, ReviewData, ShotAnnotation, ShotTask } from '../../types';
import {
  addChangeRequest,
  buildRequestsExport,
  buildRequestsReportHtml,
  findFeedback,
  getProjectNamingTemplate,
  missingShotAssets,
  normalizeReviewData,
  removeChangeRequest,
  removeShotAnnotation,
  saveShotAnnotation,
  setProjectNamingTemplate,
  setShotTaskStatus,
  summarizeRequests,
  upsertFeedback,
} from '../../services/reviewLogic.ts';
import { renderNamingTemplate } from '../../utils/naming.ts';
import { getExtra, setExtra } from '../projectExtras.ts';
import { mediaInputSchema, payloadToDataUrl, pickMediaUrl, urlToPayload } from '../mediaInput.ts';
import { numArg, registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

const FEEDBACK_SCOPES: DirectorFeedback['scope'][] = ['concept', 'shot', 'video'];
const REQUEST_TYPES: ChangeRequest['type'][] = ['character', 'environment', 'product', 'brand'];
const REQUEST_ACTIONS: ChangeRequest['action'][] = ['redo', 'replace', 'remove'];
const TASK_STATUSES: ShotTask['status'][] = ['open', 'in_progress', 'done'];
const ANNOTATION_TYPES: ShotAnnotation['assetType'][] = ['image', 'sketch', 'start_frame', 'end_frame', 'openpose'];

const oneOf = <T extends string>(value: unknown, allowed: T[], key: string): T => {
  if (typeof value === 'string' && (allowed as string[]).includes(value)) return value as T;
  throw new Error(`Parameter "${key}" must be one of: ${allowed.join(', ')}.`);
};

const review = (ctx: StudioToolContext): ReviewData => normalizeReviewData(getExtra(ctx, 'reviewData'));
const shots = (ctx: StudioToolContext) => getExtra(ctx, 'shotPrompts') ?? [];
const templates = (ctx: StudioToolContext) => getExtra(ctx, 'namingTemplates') ?? [];

const annotationSummary = (entry: ShotAnnotation) => ({
  id: entry.id,
  shotNumber: entry.shotNumber,
  assetType: entry.assetType,
  assetLabel: entry.assetLabel,
  hasImage: Boolean(entry.imageUrl || entry.imagePath),
  imagePath: entry.imagePath ?? null,
  updatedAt: entry.updatedAt ?? entry.createdAt,
});

const targetSuggestions = (ctx: StudioToolContext) => {
  const story = getExtra(ctx, 'storyBible');
  const references = getExtra(ctx, 'references') ?? [];
  const list = shots(ctx);
  const sorted = (set: Set<string>) => [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const characters = new Set<string>();
  story?.characters?.forEach((character) => character.name && characters.add(character.name));
  references.forEach((ref) => ref.type === 'character' && ref.name && characters.add(ref.name));
  list.forEach((shot) => shot.characters?.forEach((name) => name && characters.add(name)));
  const environments = new Set<string>();
  list.forEach((shot) => shot.environment && environments.add(shot.environment));
  references.forEach((ref) => ref.type === 'environment' && ref.name && environments.add(ref.name));
  const products = new Set<string>();
  list.forEach((shot) => shot.products?.forEach((name) => name && products.add(name)));
  references.forEach((ref) => (ref.type === 'product' || ref.type === 'prop') && ref.name && products.add(ref.name));
  return { character: sorted(characters), environment: sorted(environments), product: sorted(products), brand: sorted(products) };
};

const namingTokens = (ctx: StudioToolContext, overrides: Record<string, unknown>) => {
  const story = getExtra(ctx, 'storyBible');
  const pick = (key: string, fallback: string | number) => {
    const value = overrides[key];
    return typeof value === 'string' || typeof value === 'number' ? value : fallback;
  };
  return {
    project: pick('project', story?.title || 'project'),
    type: pick('type', 'video'),
    name: pick('name', 'example'),
    scene: pick('scene', 1),
    shot: pick('shot', 1),
    user: pick('user', 'user'),
    version: pick('version', 1),
    date: new Date(),
  };
};

export const REVIEW_TOOL_MODULE: StudioToolModule = {
  id: 'review',
  label: 'Review: Director & Requests',
  tools: [
    {
      name: 'review_get',
      description:
        'Read the Director review page: concept/shot/video scores (1-10) and notes, change requests with the shots they hit, shot tasks, markup annotations per shot asset, missing assets per shot, the project naming template, and target-name suggestions for new change requests.',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => {
        const data = review(ctx);
        const list = shots(ctx);
        const summaries = summarizeRequests(data, list);
        const template = getProjectNamingTemplate(templates(ctx));
        return {
          isDirector: getExtra(ctx, 'isDirector') ?? null,
          concept: findFeedback(data, 'concept', 'concept') ?? null,
          shots: list.map((shot) => ({
            shot: shot.shot,
            description: shot.description,
            feedback: findFeedback(data, 'shot', String(shot.shot)) ?? null,
            missing: missingShotAssets(shot),
            changeRequestIds: summaries.filter((request) => request.affectedShots.includes(shot.shot)).map((request) => request.id),
            annotations: (data.shotAnnotations ?? []).filter((entry) => entry.shotNumber === shot.shot).map(annotationSummary),
          })),
          videos: ctx.getState().mediaItems
            .filter((item) => item.type === 'video')
            .map((item) => ({ mediaId: item.id, name: item.name, feedback: findFeedback(data, 'video', item.id) ?? null })),
          changeRequests: summaries,
          namingTemplate: template?.template ?? null,
          suggestions: targetSuggestions(ctx),
        };
      },
    },
    {
      name: 'review_set_feedback',
      description:
        'Set the director score (1-10) and/or note for the concept (scope "concept"), a storyboard shot (scope "shot", targetId = shot number) or a video in the media bin (scope "video", targetId = media item id). A new entry without a score gets 7, the page default.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: FEEDBACK_SCOPES },
          targetId: { type: 'string', description: '"concept", a shot number, or a video media item id.' },
          score: { type: 'number', minimum: 1, maximum: 10 },
          note: { type: 'string' },
        },
        required: ['scope'],
      },
      handler: (args, ctx) => {
        const scope = oneOf(args.scope, FEEDBACK_SCOPES, 'scope');
        const targetId = scope === 'concept' ? 'concept' : str({ targetId: args.targetId === undefined ? undefined : String(args.targetId) }, 'targetId');
        if (scope === 'shot' && !shots(ctx).some((shot) => String(shot.shot) === targetId)) throw new Error(`Shot ${targetId} not found.`);
        if (scope === 'video' && !ctx.getState().mediaItems.some((item) => item.id === targetId)) throw new Error(`Video ${targetId} not found.`);
        if (args.score === undefined && args.note === undefined) throw new Error('Pass a score and/or a note.');
        const next = upsertFeedback(review(ctx), scope, targetId, {
          score: args.score === undefined ? undefined : numArg(args, 'score'),
          note: typeof args.note === 'string' ? args.note : undefined,
        });
        setExtra(ctx, 'reviewData', next);
        return { feedback: findFeedback(next, scope, targetId) };
      },
    },
    {
      name: 'review_add_change_request',
      description:
        'Add a director change request (redo/replace/remove a character, environment, product or brand). Opens one shot task per storyboard shot that uses the target; returns the request, the affected shots and the new tasks.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: REQUEST_TYPES },
          targetName: { type: 'string', description: 'Name as used in the shots (see review_get suggestions).' },
          action: { type: 'string', enum: REQUEST_ACTIONS },
          note: { type: 'string' },
        },
        required: ['type', 'targetName', 'action'],
      },
      handler: (args, ctx) => {
        const result = addChangeRequest(
          review(ctx),
          {
            type: oneOf(args.type, REQUEST_TYPES, 'type'),
            targetName: str(args, 'targetName'),
            action: oneOf(args.action, REQUEST_ACTIONS, 'action'),
            note: typeof args.note === 'string' ? args.note : '',
          },
          shots(ctx),
        );
        setExtra(ctx, 'reviewData', result.data);
        return { request: result.request, affectedShots: result.tasks.map((task) => task.shotNumber), tasks: result.tasks };
      },
    },
    {
      name: 'review_remove_change_request',
      description: "Remove a change request and all of its shot tasks (as the page's Remove button).",
      writes: true,
      destructive: true,
      parameters: { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'] },
      handler: (args, ctx) => {
        const requestId = str(args, 'requestId');
        const data = review(ctx);
        if (!(data.changeRequests ?? []).some((request) => request.id === requestId)) throw new Error(`Change request ${requestId} not found.`);
        const removedTasks = (data.shotTasks ?? []).filter((task) => task.requestId === requestId).length;
        setExtra(ctx, 'reviewData', removeChangeRequest(data, requestId));
        return { removed: requestId, removedTasks };
      },
    },
    {
      name: 'review_set_annotation',
      description:
        'Attach a markup image (flattened PNG/JPEG with drawings on top of the frame) to a shot asset, replacing the previous markup. Same as saving the Annotate dialog.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          shotNumber: { type: 'number' },
          assetType: { type: 'string', enum: ANNOTATION_TYPES },
          assetLabel: { type: 'string', description: 'Label shown on the card, e.g. "Image", "Start Frame".' },
          ...mediaInputSchema('image', 'Markup image'),
        },
        required: ['shotNumber', 'assetType'],
      },
      handler: async (args, ctx) => {
        const shotNumber = numArg(args, 'shotNumber');
        if (!shots(ctx).some((shot) => shot.shot === shotNumber)) throw new Error(`Shot ${shotNumber} not found.`);
        const assetType = oneOf(args.assetType, ANNOTATION_TYPES, 'assetType');
        const url = pickMediaUrl(ctx, args, 'image');
        if (!url) throw new Error('Pass imageUrl, imagePath or imageMediaId.');
        const dataUrl = url.startsWith('data:') ? url : payloadToDataUrl(await urlToPayload(url, 'image/png'));
        const label = typeof args.assetLabel === 'string' && args.assetLabel.trim() ? args.assetLabel.trim() : assetType.replace('_', ' ');
        const next = saveShotAnnotation(review(ctx), { shotNumber, assetType, assetLabel: label }, dataUrl);
        setExtra(ctx, 'reviewData', next);
        const saved = (next.shotAnnotations ?? []).find((entry) => entry.shotNumber === shotNumber && entry.assetType === assetType)!;
        return { annotation: annotationSummary(saved) };
      },
    },
    {
      name: 'review_remove_annotation',
      description: 'Remove the markup image of one shot asset.',
      writes: true,
      destructive: true,
      parameters: {
        type: 'object',
        properties: { shotNumber: { type: 'number' }, assetType: { type: 'string', enum: ANNOTATION_TYPES } },
        required: ['shotNumber', 'assetType'],
      },
      handler: (args, ctx) => {
        const shotNumber = numArg(args, 'shotNumber');
        const assetType = oneOf(args.assetType, ANNOTATION_TYPES, 'assetType');
        const data = review(ctx);
        if (!(data.shotAnnotations ?? []).some((entry) => entry.shotNumber === shotNumber && entry.assetType === assetType)) {
          throw new Error(`No markup on shot ${shotNumber} (${assetType}).`);
        }
        setExtra(ctx, 'reviewData', removeShotAnnotation(data, shotNumber, assetType));
        return { removed: { shotNumber, assetType } };
      },
    },
    {
      name: 'review_get_annotation_image',
      description: 'Return the markup image of one shot asset as a data URL (or its saved path).',
      parameters: {
        type: 'object',
        properties: { shotNumber: { type: 'number' }, assetType: { type: 'string', enum: ANNOTATION_TYPES } },
        required: ['shotNumber', 'assetType'],
      },
      handler: (args, ctx) => {
        const shotNumber = numArg(args, 'shotNumber');
        const assetType = oneOf(args.assetType, ANNOTATION_TYPES, 'assetType');
        const entry = (review(ctx).shotAnnotations ?? []).find((item) => item.shotNumber === shotNumber && item.assetType === assetType);
        if (!entry) throw new Error(`No markup on shot ${shotNumber} (${assetType}).`);
        return { annotation: annotationSummary(entry), imageUrl: entry.imageUrl ?? null };
      },
    },
    {
      name: 'review_set_naming_template',
      description: `Set the project naming template used for every saved asset file, e.g. "{project}_{type}_s{scene}_sh{shot}_v{version}" (tokens: project, type, name, scene, shot, user, date:YYYYMMDD, version). An empty template removes the project template.`,
      writes: true,
      destructive: true,
      parameters: { type: 'object', properties: { template: { type: 'string' } }, required: ['template'] },
      handler: (args, ctx) => {
        const value = typeof args.template === 'string' ? args.template : '';
        const next = setProjectNamingTemplate(templates(ctx), value);
        setExtra(ctx, 'namingTemplates', next);
        const template = getProjectNamingTemplate(next);
        return {
          template: template?.template ?? null,
          preview: template ? renderNamingTemplate(template.template, namingTokens(ctx, {})) : null,
        };
      },
    },
    {
      name: 'review_preview_naming',
      description: 'Render a file name from the project naming template (or a given template) with sample or given tokens.',
      parameters: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Defaults to the project template.' },
          type: { type: 'string' }, name: { type: 'string' }, scene: { type: 'number' }, shot: { type: 'number' }, version: { type: 'number' }, user: { type: 'string' },
        },
      },
      handler: (args, ctx) => {
        const template = (typeof args.template === 'string' && args.template.trim()) || getProjectNamingTemplate(templates(ctx))?.template || '{project}_{type}_{date:YYYYMMDD}_v{version}';
        return { template, fileName: renderNamingTemplate(template, namingTokens(ctx, args)) };
      },
    },
  ],
};

export const REQUESTS_TOOL_MODULE: StudioToolModule = {
  id: 'requests',
  label: 'Review: Artist requests',
  tools: [
    {
      name: 'requests_list',
      description:
        "Read the artist Requests page: every director change request with the shots it currently matches, its shot tasks (open / in_progress / done) and what each task's shot is still missing (image, sketch, video).",
      parameters: { type: 'object', properties: { status: { type: 'string', enum: TASK_STATUSES, description: 'Only tasks with this status.' } } },
      handler: (args, ctx) => {
        const list = shots(ctx);
        const byNumber = new Map(list.map((shot) => [shot.shot, shot]));
        const status = typeof args.status === 'string' ? oneOf(args.status, TASK_STATUSES, 'status') : null;
        return {
          requests: summarizeRequests(review(ctx), list).map((request) => ({
            ...request,
            tasks: request.tasks
              .filter((task) => !status || task.status === status)
              .map((task) => ({ ...task, missing: missingShotAssets(byNumber.get(task.shotNumber)) })),
          })),
        };
      },
    },
    {
      name: 'requests_set_task_status',
      description: 'Set the status of a shot task (open, in_progress, done), as the status select on the Requests page.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { taskId: { type: 'string' }, status: { type: 'string', enum: TASK_STATUSES } },
        required: ['taskId', 'status'],
      },
      handler: (args, ctx) => {
        const taskId = str(args, 'taskId');
        const next = setShotTaskStatus(review(ctx), taskId, oneOf(args.status, TASK_STATUSES, 'status'));
        setExtra(ctx, 'reviewData', next);
        return { task: (next.shotTasks ?? []).find((task) => task.id === taskId) };
      },
    },
    {
      name: 'requests_export',
      description:
        'Export the Requests page: "json" returns the same JSON as the Export JSON button, "html" the printable report behind Export PDF (print or save it yourself). Nothing is downloaded.',
      parameters: { type: 'object', properties: { format: { type: 'string', enum: ['json', 'html'] } }, required: ['format'] },
      handler: (args, ctx) => {
        const format = oneOf(args.format, ['json', 'html'], 'format');
        const summaries = summarizeRequests(review(ctx), shots(ctx));
        const title = getExtra(ctx, 'storyBible')?.title;
        return format === 'json'
          ? { format, export: buildRequestsExport(title, summaries) }
          : { format, html: buildRequestsReportHtml(title, summaries) };
      },
    },
  ],
};

registerStudioToolModule(REVIEW_TOOL_MODULE);
registerStudioToolModule(REQUESTS_TOOL_MODULE);
