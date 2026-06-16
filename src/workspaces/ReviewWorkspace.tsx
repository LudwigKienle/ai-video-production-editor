import React, { useEffect, useMemo, useState } from 'react';
import {
  ChangeRequest,
  DirectorFeedback,
  MediaItem,
  NamingTemplate,
  ProjectCollaborativeLock,
  ReviewData,
  ReferenceItem,
  ShotAnnotation,
  ShotTask,
  ShotPrompt,
  StoryBible,
  UserProfile,
} from '../types';
import { renderNamingTemplate } from '../utils/naming';
import AnnotationModal from '../components/AnnotationModal';

interface ReviewWorkspaceProps {
  reviewData: ReviewData;
  setReviewData: React.Dispatch<React.SetStateAction<ReviewData>>;
  projectName?: string | null;
  storyBible: StoryBible;
  references: ReferenceItem[];
  shotPrompts: ShotPrompt[];
  mediaItems: MediaItem[];
  profiles: UserProfile[];
  activeProfileId?: string | null;
  namingTemplates: NamingTemplate[];
  setNamingTemplates: React.Dispatch<React.SetStateAction<NamingTemplate[]>>;
  collaborativeLocks?: ProjectCollaborativeLock[];
}

type ReviewAssetCard = {
  id: string;
  label: string;
  type: 'image' | 'video';
  url: string;
  kind: 'image' | 'video' | 'sketch';
  annotation?: {
    shotNumber: number;
    assetType: ShotAnnotation['assetType'];
    assetLabel: string;
  };
  hasAnnotation?: boolean;
};

const buildId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const resolveProfileName = (profiles: UserProfile[], id?: string) => {
  if (!id) return 'Unknown';
  return profiles.find((profile) => profile.id === id)?.name || 'Unknown';
};

const clampScore = (value: number) => Math.min(10, Math.max(1, value));

const ReviewWorkspace: React.FC<ReviewWorkspaceProps> = ({
  reviewData,
  setReviewData,
  projectName,
  storyBible,
  references,
  shotPrompts,
  mediaItems,
  profiles,
  activeProfileId,
  namingTemplates,
  setNamingTemplates,
  collaborativeLocks = [],
}) => {
  const feedback = reviewData.directorFeedback ?? [];
  const changeRequests = reviewData.changeRequests ?? [];
  const shotAnnotations = reviewData.shotAnnotations ?? [];
  const projectTemplate = useMemo(() => {
    const projectTemplates = namingTemplates.filter((template) => template.scope === 'project');
    return projectTemplates.find((template) => template.isDefault) || projectTemplates[0] || null;
  }, [namingTemplates]);
  const [templateValue, setTemplateValue] = useState(projectTemplate?.template ?? '');
  const [requestTarget, setRequestTarget] = useState('');
  const [requestType, setRequestType] = useState<ChangeRequest['type']>('character');
  const [requestAction, setRequestAction] = useState<ChangeRequest['action']>('redo');
  const [requestNote, setRequestNote] = useState('');
  const [showImages, setShowImages] = useState(true);
  const [showVideos, setShowVideos] = useState(true);
  const [showSketches, setShowSketches] = useState(true);
  const [previewAsset, setPreviewAsset] = useState<{ label: string; type: 'image' | 'video'; url: string } | null>(null);
  const [annotationTarget, setAnnotationTarget] = useState<{
    shotNumber: number;
    assetType: ShotAnnotation['assetType'];
    assetLabel: string;
    imageUrl: string;
  } | null>(null);

  useEffect(() => {
    setTemplateValue(projectTemplate?.template ?? '');
  }, [projectTemplate?.template]);

  const upsertFeedback = (scope: DirectorFeedback['scope'], targetId: string, updates: Partial<DirectorFeedback>) => {
    setReviewData((prev) => {
      const entries = prev.directorFeedback ?? [];
      const index = entries.findIndex((entry) => entry.scope === scope && entry.targetId === targetId);
      const now = new Date().toISOString();
      if (index === -1) {
        const newEntry: DirectorFeedback = {
          id: buildId(),
          scope,
          targetId,
          score: clampScore(updates.score ?? 1),
          note: updates.note ?? '',
          createdAt: now,
          updatedAt: now,
        };
        return { ...prev, directorFeedback: [...entries, newEntry] };
      }
      const existing = entries[index];
      const updated: DirectorFeedback = {
        ...existing,
        ...updates,
        score: clampScore(typeof updates.score === 'number' ? updates.score : existing.score),
        updatedAt: now,
      };
      const next = [...entries];
      next[index] = updated;
      return { ...prev, directorFeedback: next };
    });
  };

  const getFeedback = (scope: DirectorFeedback['scope'], targetId: string) =>
    feedback.find((entry) => entry.scope === scope && entry.targetId === targetId);

  const getAnnotationForAsset = (shotNumber: number, assetType: ShotAnnotation['assetType']) =>
    shotAnnotations.find((annotation) => annotation.shotNumber === shotNumber && annotation.assetType === assetType);

  const normalize = (value: string) => value.trim().toLowerCase();

  const requestMatchesShot = (request: ChangeRequest, shot: ShotPrompt) => {
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
  };

  const getAffectedShotNumbers = (request: ChangeRequest) =>
    shotPrompts.filter((shot) => requestMatchesShot(request, shot)).map((shot) => shot.shot);

  const handleScoreChange =
    (scope: DirectorFeedback['scope'], targetId: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value);
      if (!Number.isFinite(value)) return;
      upsertFeedback(scope, targetId, { score: value });
    };

  const characterOptions = useMemo(() => {
    const names = new Set<string>();
    storyBible.characters?.forEach((character) => {
      if (character.name) names.add(character.name);
    });
    references.forEach((ref) => {
      if (ref.type === 'character' && ref.name) names.add(ref.name);
    });
    shotPrompts.forEach((shot) => {
      shot.characters?.forEach((name) => {
        if (name) names.add(name);
      });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [references, shotPrompts, storyBible.characters]);

  const environmentOptions = useMemo(() => {
    const names = new Set<string>();
    shotPrompts.forEach((shot) => {
      if (shot.environment) names.add(shot.environment);
    });
    references.forEach((ref) => {
      if (ref.type === 'environment' && ref.name) names.add(ref.name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [references, shotPrompts]);

  const productOptions = useMemo(() => {
    const names = new Set<string>();
    shotPrompts.forEach((shot) => {
      shot.products?.forEach((name) => {
        if (name) names.add(name);
      });
    });
    references.forEach((ref) => {
      if ((ref.type === 'product' || ref.type === 'prop') && ref.name) names.add(ref.name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [references, shotPrompts]);

  const suggestionOptions = useMemo(() => {
    if (requestType === 'environment') return environmentOptions;
    if (requestType === 'product' || requestType === 'brand') return productOptions;
    return characterOptions;
  }, [characterOptions, environmentOptions, productOptions, requestType]);

  const handleCreateChangeRequest = () => {
    const targetName = requestTarget.trim();
    if (!targetName) return;
    const now = new Date().toISOString();
    const newRequest: ChangeRequest = {
      id: buildId(),
      type: requestType,
      targetName,
      action: requestAction,
      note: requestNote.trim(),
      createdAt: now,
      updatedAt: now,
    };
    const affectedShots = getAffectedShotNumbers(newRequest);
    const newTasks: ShotTask[] = affectedShots.map((shotNumber) => ({
      id: buildId(),
      requestId: newRequest.id,
      shotNumber,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    }));
    setReviewData((prev) => ({
      ...prev,
      changeRequests: [...(prev.changeRequests ?? []), newRequest],
      shotTasks: [...(prev.shotTasks ?? []), ...newTasks],
    }));
    setRequestTarget('');
    setRequestNote('');
  };

  const handleRemoveChangeRequest = (id: string) => {
    setReviewData((prev) => ({
      ...prev,
      changeRequests: (prev.changeRequests ?? []).filter((request) => request.id !== id),
      shotTasks: (prev.shotTasks ?? []).filter((task) => task.requestId !== id),
    }));
  };

  const handleSaveNamingTemplate = () => {
    const trimmed = templateValue.trim();
    const now = new Date().toISOString();
    setNamingTemplates((prev) => {
      const existing = prev.find((template) => template.scope === 'project');
      if (!trimmed) {
        return prev.filter((template) => template.scope !== 'project');
      }
      if (existing) {
        return prev.map((template) =>
          template.id === existing.id ? { ...template, template: trimmed, isDefault: true, updatedAt: now } : template,
        );
      }
      const newTemplate: NamingTemplate = {
        id: buildId(),
        scope: 'project',
        template: trimmed,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      };
      return [...prev, newTemplate];
    });
  };

  const handleSaveAnnotation = (dataUrl: string) => {
    if (!annotationTarget) return;
    const now = new Date().toISOString();
    setReviewData((prev) => {
      const entries = prev.shotAnnotations ?? [];
      const index = entries.findIndex(
        (entry) => entry.shotNumber === annotationTarget.shotNumber && entry.assetType === annotationTarget.assetType,
      );
      if (index === -1) {
        const nextEntry: ShotAnnotation = {
          id: buildId(),
          shotNumber: annotationTarget.shotNumber,
          assetType: annotationTarget.assetType,
          assetLabel: annotationTarget.assetLabel,
          imageUrl: dataUrl,
          createdAt: now,
          updatedAt: now,
        };
        return { ...prev, shotAnnotations: [...entries, nextEntry] };
      }
      const existing = entries[index];
      const updated: ShotAnnotation = {
        ...existing,
        assetLabel: annotationTarget.assetLabel,
        imageUrl: dataUrl,
        updatedAt: now,
      };
      const next = [...entries];
      next[index] = updated;
      return { ...prev, shotAnnotations: next };
    });
    setAnnotationTarget(null);
  };

  const conceptFeedback = getFeedback('concept', 'concept') || { score: 7, note: '' };
  const videoItems = mediaItems.filter((item) => item.type === 'video');
  const requestSummaries = changeRequests.map((request) => ({
    ...request,
    affectedShots: getAffectedShotNumbers(request),
  }));
  const activeAnnotation =
    annotationTarget && getAnnotationForAsset(annotationTarget.shotNumber, annotationTarget.assetType);
  const conceptAssets = [
    ...(storyBible.posterUrl
      ? [{ id: 'poster', label: 'Poster', kind: 'image' as const, type: 'image' as const, url: storyBible.posterUrl }]
      : []),
    ...references
      .filter((ref) => !!ref.imageUrl)
      .map((ref) => ({
        id: ref.id,
        label: ref.name || ref.type,
        kind: 'image' as const,
        type: 'image' as const,
        url: ref.imageUrl as string,
      })),
  ];

  const isAssetVisible = (asset: { kind: 'image' | 'video' | 'sketch' }) => {
    if (asset.kind === 'video') return showVideos;
    if (asset.kind === 'sketch') return showSketches;
    return showImages;
  };

  const renderAssetCard = (asset: ReviewAssetCard) => (
    <div key={asset.id} className="rounded-lg border border-slate-500/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{asset.label}</div>
        {asset.annotation && (
          <button
            className="text-[10px] uppercase tracking-[0.18em] text-sky-300 hover:text-sky-200"
            onClick={() =>
              setAnnotationTarget({
                shotNumber: asset.annotation!.shotNumber,
                assetType: asset.annotation!.assetType,
                assetLabel: asset.annotation!.assetLabel,
                imageUrl: asset.url,
              })
            }
          >
            Annotate
          </button>
        )}
      </div>
      {asset.hasAnnotation && (
        <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-amber-300">Markup attached</div>
      )}
      {asset.type === 'video' ? (
        <video
          className="mt-2 h-36 w-full rounded-md bg-black object-cover cursor-pointer"
          src={asset.url}
          controls
          preload="metadata"
          onClick={() => setPreviewAsset(asset)}
        />
      ) : (
        <img
          className="mt-2 h-36 w-full rounded-md object-cover cursor-pointer"
          src={asset.url}
          alt={asset.label}
          loading="lazy"
          onClick={() => setPreviewAsset(asset)}
        />
      )}
    </div>
  );

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Director Page</p>
          <h1 className="text-2xl font-semibold">{projectName || 'Director Review'}</h1>
        </div>
        <div className="text-xs text-slate-400">
          Signed in as {resolveProfileName(profiles, activeProfileId || undefined)}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <span className="text-slate-400 uppercase tracking-[0.2em]">Assets</span>
        <button
          className={`rounded-full border px-3 py-1 ${showImages ? 'border-sky-400/40 bg-sky-400/10' : 'border-slate-500/30'}`}
          onClick={() => setShowImages((prev) => !prev)}
        >
          Images
        </button>
        <button
          className={`rounded-full border px-3 py-1 ${showVideos ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-slate-500/30'}`}
          onClick={() => setShowVideos((prev) => !prev)}
        >
          Videos
        </button>
        <button
          className={`rounded-full border px-3 py-1 ${showSketches ? 'border-amber-400/40 bg-amber-400/10' : 'border-slate-500/30'}`}
          onClick={() => setShowSketches((prev) => !prev)}
        >
          Sketches
        </button>
      </div>

      <div className="mt-6 grid gap-5">
        <section className="app-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Concept Review</h2>
              <p className="text-xs text-slate-400">Score the core concept and give improvement notes.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Score</span>
              <input
                className="app-input w-20 text-center text-sm"
                type="number"
                min={1}
                max={10}
                value={conceptFeedback.score}
                onChange={handleScoreChange('concept', 'concept')}
              />
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-500/20 p-3 text-sm text-slate-300">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Summary</div>
              <p className="mt-2">{storyBible.logline || 'No logline yet.'}</p>
              {storyBible.selectedStyle && <p className="mt-2 text-xs text-slate-400">Style: {storyBible.selectedStyle}</p>}
              {storyBible.targetAudience && (
                <p className="mt-1 text-xs text-slate-400">Audience: {storyBible.targetAudience}</p>
              )}
            </div>
            <div>
              <textarea
                className="app-textarea text-sm"
                rows={4}
                placeholder="Concept improvements, changes, or guidance."
                value={conceptFeedback.note}
                onChange={(e) => upsertFeedback('concept', 'concept', { note: e.target.value })}
              />
            </div>
          </div>
          {conceptAssets.filter(isAssetVisible).length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {conceptAssets.filter(isAssetVisible).map((asset) => renderAssetCard(asset))}
            </div>
          )}
        </section>

        <section className="app-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Character Change Requests</h2>
              <p className="text-xs text-slate-400">
                Mark characters for redo/replace/remove and auto-flag all shots containing them.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[140px_1fr_140px_1fr_120px]">
            <select
              className="app-select text-sm"
              value={requestType}
              onChange={(e) => setRequestType(e.target.value as ChangeRequest['type'])}
            >
              <option value="character">character</option>
              <option value="environment">environment</option>
              <option value="product">product</option>
              <option value="brand">brand</option>
            </select>
            <div>
              <input
                className="app-input text-sm"
                list="request-options"
                placeholder="Target name"
                value={requestTarget}
                onChange={(e) => setRequestTarget(e.target.value)}
              />
              <datalist id="request-options">
                {suggestionOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <select
              className="app-select text-sm"
              value={requestAction}
              onChange={(e) => setRequestAction(e.target.value as ChangeRequest['action'])}
            >
              <option value="redo">redo</option>
              <option value="replace">replace</option>
              <option value="remove">remove</option>
            </select>
            <input
              className="app-input text-sm"
              placeholder="Reason / direction"
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
            />
            <button className="app-button border border-slate-500/40" onClick={handleCreateChangeRequest}>
              Add
            </button>
          </div>
          {requestSummaries.length > 0 && (
            <div className="mt-4 space-y-2">
              {requestSummaries.map((request) => (
                <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-500/20 p-2 text-sm">
                  <div>
                    <span className="font-semibold">{request.type}</span> ·{' '}
                    <span className="font-semibold">{request.targetName}</span> ·{' '}
                    <span className="text-slate-300">{request.action}</span>
                    {request.note && <span className="text-slate-400"> · {request.note}</span>}
                    {request.affectedShots.length > 0 && (
                      <div className="text-xs text-slate-400">
                        Affects shots: {request.affectedShots.join(', ')}
                      </div>
                    )}
                  </div>
                  <button
                    className="text-xs text-rose-300 hover:text-rose-200"
                    onClick={() => handleRemoveChangeRequest(request.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="app-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Storyboard Review</h2>
              <p className="text-xs text-slate-400">Rate each shot and leave targeted improvements.</p>
            </div>
            <div className="text-xs text-slate-400">{shotPrompts.length} shots</div>
          </div>
          <div className="mt-4 grid gap-3">
            {shotPrompts.length === 0 && (
              <p className="text-sm text-slate-400">No storyboard shots yet.</p>
            )}
            {shotPrompts.map((shot) => {
              const entry = getFeedback('shot', String(shot.shot)) || { score: 7, note: '' };
              const shotLock = collaborativeLocks.find(
                (lock) => lock.scope === 'storyboard_shot' && lock.key === String(shot.shot),
              );
              const shotChangeRequests = requestSummaries.filter((request) =>
                request.affectedShots.includes(shot.shot),
              );
              const missingKinds = [
                !shot.imageUrl ? 'image' : null,
                !shot.sketchUrl ? 'sketch' : null,
                !shot.videoUrl ? 'video' : null,
              ].filter(Boolean) as Array<'image' | 'sketch' | 'video'>;
              const imageAnnotation = getAnnotationForAsset(shot.shot, 'image');
              const sketchAnnotation = getAnnotationForAsset(shot.shot, 'sketch');
              const startFrameAnnotation = getAnnotationForAsset(shot.shot, 'start_frame');
              const endFrameAnnotation = getAnnotationForAsset(shot.shot, 'end_frame');
              const annotationAssets = shotAnnotations
                .filter((annotation) => annotation.shotNumber === shot.shot && annotation.imageUrl)
                .map((annotation) => ({
                  id: `${annotation.id}-markup`,
                  label: `Markup · ${annotation.assetLabel}`,
                  kind: 'image' as const,
                  type: 'image' as const,
                  url: annotation.imageUrl as string,
                }));
              const shotAssets = [
                ...(shot.imageUrl
                  ? [
                      {
                        id: `${shot.shot}-image`,
                        label: 'Image',
                        kind: 'image' as const,
                        type: 'image' as const,
                        url: shot.imageUrl,
                        annotation: {
                          shotNumber: shot.shot,
                          assetType: 'image' as const,
                          assetLabel: 'Image',
                        },
                        hasAnnotation: Boolean(imageAnnotation),
                      },
                    ]
                  : []),
                ...(shot.sketchUrl
                  ? [
                      {
                        id: `${shot.shot}-sketch`,
                        label: 'Sketch',
                        kind: 'sketch' as const,
                        type: 'image' as const,
                        url: shot.sketchUrl,
                        annotation: {
                          shotNumber: shot.shot,
                          assetType: 'sketch' as const,
                          assetLabel: 'Sketch',
                        },
                        hasAnnotation: Boolean(sketchAnnotation),
                      },
                    ]
                  : []),
                ...(shot.startFrameUrl
                  ? [
                      {
                        id: `${shot.shot}-start-frame`,
                        label: 'Start Frame',
                        kind: 'image' as const,
                        type: 'image' as const,
                        url: shot.startFrameUrl,
                        annotation: {
                          shotNumber: shot.shot,
                          assetType: 'start_frame' as const,
                          assetLabel: 'Start Frame',
                        },
                        hasAnnotation: Boolean(startFrameAnnotation),
                      },
                    ]
                  : []),
                ...(shot.endFrameUrl
                  ? [
                      {
                        id: `${shot.shot}-end-frame`,
                        label: 'End Frame',
                        kind: 'image' as const,
                        type: 'image' as const,
                        url: shot.endFrameUrl,
                        annotation: {
                          shotNumber: shot.shot,
                          assetType: 'end_frame' as const,
                          assetLabel: 'End Frame',
                        },
                        hasAnnotation: Boolean(endFrameAnnotation),
                      },
                    ]
                  : []),
                ...(shot.videoUrl
                  ? [
                      {
                        id: `${shot.shot}-video`,
                        label: 'Video',
                        kind: 'video' as const,
                        type: 'video' as const,
                        url: shot.videoUrl,
                      },
                    ]
                  : []),
                ...(shot.motionReferenceUrl ? [
                  {
                    id: `${shot.shot}-motion`,
                    label: 'Motion Ref',
                    kind: 'video' as const,
                    type: 'video' as const,
                    url: shot.motionReferenceUrl,
                  },
                ] : []),
                ...(shot.openPoseSourceUrl ? [
                  {
                    id: `${shot.shot}-pose-source`,
                    label: 'OpenPose Src',
                    kind: 'image' as const,
                    type: 'image' as const,
                    url: shot.openPoseSourceUrl,
                  },
                ] : []),
                ...(shot.openPoseReferenceUrl ? [
                  {
                    id: `${shot.shot}-pose-ref`,
                    label: 'OpenPose Ref',
                    kind: 'image' as const,
                    type: 'image' as const,
                    url: shot.openPoseReferenceUrl,
                  },
                ] : []),
                ...annotationAssets,
              ];
              return (
                <div key={shot.shot} className="rounded-xl border border-slate-500/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold">Shot {shot.shot}</div>
                        {shotLock && (
                          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-amber-200">
                            Locked by {shotLock.claimedBy.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{shot.description || shot.prompt}</p>
                      {shotChangeRequests.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {shotChangeRequests.map((request) => (
                            <span
                              key={request.id}
                              className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200"
                            >
                              {request.action} {request.targetName}
                            </span>
                          ))}
                        </div>
                      )}
                      {missingKinds.length > 0 && (
                        <div className="mt-2 text-xs text-rose-300">
                          Missing: {missingKinds.join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Score</span>
                      <input
                        className="app-input w-20 text-center text-sm"
                        type="number"
                        min={1}
                        max={10}
                        value={entry.score}
                        onChange={handleScoreChange('shot', String(shot.shot))}
                      />
                    </div>
                  </div>
                  <textarea
                    className="app-textarea mt-3 text-sm"
                    rows={3}
                    placeholder="Shot improvements or change requests."
                    value={entry.note}
                    onChange={(e) => upsertFeedback('shot', String(shot.shot), { note: e.target.value })}
                  />
                  {shotAssets.filter(isAssetVisible).length > 0 && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {shotAssets.filter(isAssetVisible).map((asset) => renderAssetCard(asset))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="app-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Video Review</h2>
              <p className="text-xs text-slate-400">Rate each video output and list improvements.</p>
            </div>
            <div className="text-xs text-slate-400">{videoItems.length} videos</div>
          </div>
          <div className="mt-4 grid gap-3">
            {videoItems.length === 0 && (
              <p className="text-sm text-slate-400">No videos available yet.</p>
            )}
            {videoItems.map((video) => {
              const entry = getFeedback('video', video.id) || { score: 7, note: '' };
              return (
                <div key={video.id} className="rounded-xl border border-slate-500/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{video.name}</div>
                      <p className="text-xs text-slate-400">{video.source} · {video.duration ?? 0}s</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Score</span>
                      <input
                        className="app-input w-20 text-center text-sm"
                        type="number"
                        min={1}
                        max={10}
                        value={entry.score}
                        onChange={handleScoreChange('video', video.id)}
                      />
                    </div>
                  </div>
                  <textarea
                    className="app-textarea mt-3 text-sm"
                    rows={3}
                    placeholder="Video improvements or change requests."
                    value={entry.note}
                    onChange={(e) => upsertFeedback('video', video.id, { note: e.target.value })}
                  />
                  {showVideos && video.url && (
                    <video
                      className="mt-3 h-48 w-full rounded-md bg-black object-cover"
                      src={video.url}
                      controls
                      preload="metadata"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="app-card p-4">
          <h2 className="text-lg font-semibold">Artist Naming Convention</h2>
          <p className="mt-2 text-xs text-slate-400">
            Tokens: &#123;project&#125; &#123;type&#125; &#123;name&#125; &#123;scene&#125; &#123;shot&#125; &#123;user&#125; &#123;date:YYYYMMDD&#125; &#123;version&#125;
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-[1fr_220px]">
            <input
              className="app-input text-sm"
              placeholder="{project}_{type}_{date:YYYYMMDD}_v{version}"
              value={templateValue}
              onChange={(e) => setTemplateValue(e.target.value)}
            />
            <button className="app-button border border-slate-500/40" onClick={handleSaveNamingTemplate}>
              Save template
            </button>
          </div>
          <div className="mt-2 rounded-lg border border-slate-500/20 p-2 text-xs text-slate-400">
            Preview:{' '}
            {renderNamingTemplate(templateValue || '{project}_{type}_{date:YYYYMMDD}_v{version}', {
              project: projectName || 'project',
              type: 'video',
              name: 'example',
              scene: 1,
              shot: 1,
              user: resolveProfileName(profiles, activeProfileId || undefined),
              version: 1,
              date: new Date(),
            })}
          </div>
        </section>
      </div>

      {previewAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setPreviewAsset(null)}
        >
          <div className="app-card w-full max-w-5xl p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{previewAsset.label}</div>
              <button className="app-button" onClick={() => setPreviewAsset(null)}>
                Close
              </button>
            </div>
            <div className="mt-3">
              {previewAsset.type === 'video' ? (
                <video className="w-full max-h-[70vh] rounded-md bg-black" src={previewAsset.url} controls autoPlay />
              ) : (
                <img className="w-full max-h-[70vh] rounded-md object-contain" src={previewAsset.url} alt={previewAsset.label} />
              )}
            </div>
          </div>
        </div>
      )}

      {annotationTarget && (
        <AnnotationModal
          isOpen={!!annotationTarget}
          title={`Shot ${annotationTarget.shotNumber} · ${annotationTarget.assetLabel}`}
          imageUrl={annotationTarget.imageUrl}
          initialMarkupUrl={activeAnnotation?.imageUrl || null}
          onClose={() => setAnnotationTarget(null)}
          onSave={handleSaveAnnotation}
        />
      )}
    </div>
  );
};

export default ReviewWorkspace;
