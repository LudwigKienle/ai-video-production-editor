import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import type {
  CollaborativeProjectDoc,
  CollaborativeReviewThread,
  CollaborativeSelectionState,
  ReviewData,
  ShotPrompt,
  TimelineClip,
  TimelineTrack,
} from '../types';

type SnapshotInput = {
  shotPrompts: ShotPrompt[];
  reviewData: ReviewData;
  timelineClips: TimelineClip[];
  timelineTracks?: TimelineTrack[];
  selectedClipId?: string | null;
};

type CollaborativeProjectSessionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

type CollaborativeProjectSessionParams = {
  projectId: string;
  hocuspocusUrl?: string | null;
  token?: string | null;
  awareness?: CollaborativeSelectionState;
};

const nowIso = () => new Date().toISOString();

const buildThreadId = (prefix: string, key: string) =>
  `${prefix}-${String(key).trim().replace(/\s+/g, '-').toLowerCase()}`;

const toStableId = (
  prefix: string,
  value: Record<string, unknown>,
  index: number,
) => {
  if (typeof value.id === 'string' && value.id.trim()) return value.id;
  return `${prefix}-${index}`;
};

const syncMapEntries = <T extends Record<string, unknown>>(
  map: Y.Map<T>,
  entries: T[],
  getKey: (entry: T, index: number) => string,
) => {
  const nextKeys = new Set<string>();
  entries.forEach((entry, index) => {
    const key = getKey(entry, index);
    nextKeys.add(key);
    map.set(key, entry);
  });
  Array.from(map.keys()).forEach((key) => {
    if (!nextKeys.has(key)) {
      map.delete(key);
    }
  });
};

const mapValuesSorted = <T extends Record<string, unknown>>(
  map: Y.Map<T>,
  compare: (a: T, b: T) => number,
) => Array.from(map.values()).sort(compare);

const buildDefaultReviewThreads = (
  reviewData: ReviewData,
): CollaborativeReviewThread[] => {
  const threads = new Map<string, CollaborativeReviewThread>();

  reviewData.comments.forEach((comment) => {
    const id = buildThreadId('variant', comment.variantId);
    const existing = threads.get(id);
    const nextCommentIds = [...(existing?.commentIds || []), comment.id];
    threads.set(id, {
      id,
      title: `Variant ${comment.variantId}`,
      scope: 'variant',
      variantId: comment.variantId,
      commentIds: nextCommentIds,
      updatedAt: comment.createdAt,
    });
  });

  (reviewData.directorFeedback || []).forEach((entry) => {
    if (entry.scope === 'shot') {
      const id = buildThreadId('shot', entry.targetId);
      threads.set(id, {
        id,
        title: `Shot ${entry.targetId}`,
        scope: 'shot',
        shotNumber: Number(entry.targetId) || undefined,
        commentIds: [],
        updatedAt: entry.updatedAt || entry.createdAt,
      });
      return;
    }
    if (entry.scope === 'video') {
      const id = buildThreadId('variant', entry.targetId);
      const existing = threads.get(id);
      threads.set(id, {
        id,
        title: `Variant ${entry.targetId}`,
        scope: 'variant',
        variantId: entry.targetId,
        commentIds: existing?.commentIds || [],
        updatedAt: entry.updatedAt || entry.createdAt,
      });
      return;
    }
    const id = buildThreadId('project', entry.targetId);
    threads.set(id, {
      id,
      title: 'Project Review',
      scope: 'project',
      commentIds: [],
      updatedAt: entry.updatedAt || entry.createdAt,
    });
  });

  return Array.from(threads.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
};

export const fromProjectSnapshot = (
  snapshot: SnapshotInput,
): CollaborativeProjectDoc => ({
  storyboard: snapshot.shotPrompts.map((shot) => ({
    ...shot,
    shotId: String(shot.shot),
    updatedAt: nowIso(),
  })),
  timeline: {
    clips: snapshot.timelineClips.map((clip) => ({
      ...clip,
      updatedAt: nowIso(),
    })),
    tracks: snapshot.timelineTracks || [],
    activeClipId: snapshot.selectedClipId || null,
    updatedAt: nowIso(),
  },
  review: {
    data: {
      reviewSets: snapshot.reviewData.reviewSets || [],
      variants: snapshot.reviewData.variants || [],
      comments: snapshot.reviewData.comments || [],
      decisions: snapshot.reviewData.decisions || [],
      tasks: snapshot.reviewData.tasks || [],
      directorFeedback: snapshot.reviewData.directorFeedback || [],
      changeRequests: snapshot.reviewData.changeRequests || [],
      shotTasks: snapshot.reviewData.shotTasks || [],
      shotAnnotations: snapshot.reviewData.shotAnnotations || [],
    },
    threads: buildDefaultReviewThreads(snapshot.reviewData),
  },
});

export const toProjectSnapshot = (doc: CollaborativeProjectDoc) => ({
  shotPrompts: doc.storyboard
    .map((shot) => ({
      ...shot,
      shot: Number(shot.shot) || shot.shot,
    }))
    .sort((a, b) => a.shot - b.shot),
  reviewData: {
    reviewSets: doc.review.data.reviewSets || [],
    variants: doc.review.data.variants || [],
    comments: doc.review.data.comments || [],
    decisions: doc.review.data.decisions || [],
    tasks: doc.review.data.tasks || [],
    directorFeedback: doc.review.data.directorFeedback || [],
    changeRequests: doc.review.data.changeRequests || [],
    shotTasks: doc.review.data.shotTasks || [],
    shotAnnotations: doc.review.data.shotAnnotations || [],
  },
  timelineClips: (doc.timeline.clips || []).sort((a, b) => a.start - b.start),
  timelineTracks: doc.timeline.tracks || [],
  selectedClipId: doc.timeline.activeClipId || null,
});

export type CollaborativeProjectSession = ReturnType<
  typeof createCollaborativeProjectSession
>;

export const createCollaborativeProjectSession = (
  params: CollaborativeProjectSessionParams,
) => {
  const doc = new Y.Doc();
  const storyboardMap = doc.getMap<any>('storyboard');
  const timelineClipMap = doc.getMap<any>('timeline-clips');
  const timelineMetaMap = doc.getMap<any>('timeline-meta');
  const reviewSetMap = doc.getMap<any>('review-sets');
  const reviewVariantMap = doc.getMap<any>('review-variants');
  const reviewCommentMap = doc.getMap<any>('review-comments');
  const reviewDecisionMap = doc.getMap<any>('review-decisions');
  const reviewTaskMap = doc.getMap<any>('review-tasks');
  const reviewFeedbackMap = doc.getMap<any>('review-feedback');
  const reviewChangeRequestMap = doc.getMap<any>('review-change-requests');
  const reviewShotTaskMap = doc.getMap<any>('review-shot-tasks');
  const reviewShotAnnotationMap = doc.getMap<any>('review-shot-annotations');
  const reviewThreadMap = doc.getMap<any>('review-threads');

  let status: CollaborativeProjectSessionStatus = 'idle';
  const snapshotListeners = new Set<(doc: CollaborativeProjectDoc) => void>();
  const awarenessListeners = new Set<
    (states: CollaborativeSelectionState[]) => void
  >();
  const statusListeners = new Set<
    (nextStatus: CollaborativeProjectSessionStatus) => void
  >();

  const provider =
    params.hocuspocusUrl?.trim()
      ? new HocuspocusProvider({
          url: params.hocuspocusUrl.trim(),
          name: `project:${params.projectId}`,
          document: doc,
          token: params.token || null,
          onStatus: ({ status: nextStatus }) => {
            status =
              nextStatus === 'connected'
                ? 'connected'
                : nextStatus === 'connecting'
                  ? 'connecting'
                  : 'disconnected';
            statusListeners.forEach((listener) => listener(status));
          },
          onAwarenessChange: ({ states }) => {
            const normalized = states
              .map((entry) => {
                const selection = entry.selection;
                if (!selection || typeof selection !== 'object') return null;
                return selection as CollaborativeSelectionState;
              })
              .filter(Boolean) as CollaborativeSelectionState[];
            awarenessListeners.forEach((listener) => listener(normalized));
          },
        })
      : null;

  const emitSnapshot = () => {
    const snapshot = readSnapshot();
    snapshotListeners.forEach((listener) => listener(snapshot));
  };

  const setStatus = (nextStatus: CollaborativeProjectSessionStatus) => {
    status = nextStatus;
    statusListeners.forEach((listener) => listener(nextStatus));
  };

  const readSnapshot = (): CollaborativeProjectDoc => ({
    storyboard: mapValuesSorted(
      storyboardMap,
      (a, b) => (Number(a.shot) || 0) - (Number(b.shot) || 0),
    ),
    timeline: {
      clips: mapValuesSorted(
        timelineClipMap,
        (a, b) => (Number(a.start) || 0) - (Number(b.start) || 0),
      ),
      tracks: (timelineMetaMap.get('tracks') as TimelineTrack[] | undefined) || [],
      activeClipId:
        (timelineMetaMap.get('activeClipId') as string | null | undefined) || null,
      notes: (timelineMetaMap.get('notes') as string[] | undefined) || [],
      markers:
        (timelineMetaMap.get('markers') as Array<{
          id: string;
          label: string;
          time: number;
        }> | undefined) || [],
      updatedAt:
        (timelineMetaMap.get('updatedAt') as string | undefined) || nowIso(),
    },
    review: {
      data: {
        reviewSets: mapValuesSorted(
          reviewSetMap,
          (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
        ),
        variants: mapValuesSorted(
          reviewVariantMap,
          (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
        ),
        comments: mapValuesSorted(
          reviewCommentMap,
          (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
        ),
        decisions: mapValuesSorted(
          reviewDecisionMap,
          (a, b) => String(a.decidedAt || '').localeCompare(String(b.decidedAt || '')),
        ),
        tasks: mapValuesSorted(
          reviewTaskMap,
          (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
        ),
        directorFeedback: mapValuesSorted(
          reviewFeedbackMap,
          (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
        ),
        changeRequests: mapValuesSorted(
          reviewChangeRequestMap,
          (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
        ),
        shotTasks: mapValuesSorted(
          reviewShotTaskMap,
          (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
        ),
        shotAnnotations: mapValuesSorted(
          reviewShotAnnotationMap,
          (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
        ),
      },
      threads: mapValuesSorted(
        reviewThreadMap,
        (a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')),
      ),
    },
  });

  const syncDocFromSnapshot = (
    snapshot: SnapshotInput,
    mode: 'seed' | 'replace' = 'replace',
  ) => {
    const normalized = fromProjectSnapshot(snapshot);
    const transactionOrigin = mode === 'seed' ? 'seed' : 'replace';

    doc.transact(() => {
      if (mode === 'seed' && storyboardMap.size > 0) {
        return;
      }

      syncMapEntries(
        storyboardMap,
        normalized.storyboard,
        (entry) => entry.shotId || String(entry.shot),
      );
      syncMapEntries(
        timelineClipMap,
        normalized.timeline.clips,
        (entry) => entry.id,
      );
      timelineMetaMap.set('tracks', normalized.timeline.tracks || []);
      timelineMetaMap.set(
        'activeClipId',
        normalized.timeline.activeClipId || null,
      );
      timelineMetaMap.set('updatedAt', normalized.timeline.updatedAt);
      timelineMetaMap.set('notes', normalized.timeline.notes || []);
      timelineMetaMap.set('markers', normalized.timeline.markers || []);

      syncMapEntries(
        reviewSetMap,
        normalized.review.data.reviewSets,
        (entry, index) => toStableId('review-set', entry, index),
      );
      syncMapEntries(
        reviewVariantMap,
        normalized.review.data.variants,
        (entry, index) => toStableId('review-variant', entry, index),
      );
      syncMapEntries(
        reviewCommentMap,
        normalized.review.data.comments,
        (entry, index) => toStableId('review-comment', entry, index),
      );
      syncMapEntries(
        reviewDecisionMap,
        normalized.review.data.decisions,
        (entry, index) => toStableId('review-decision', entry, index),
      );
      syncMapEntries(
        reviewTaskMap,
        normalized.review.data.tasks,
        (entry, index) => toStableId('review-task', entry, index),
      );
      syncMapEntries(
        reviewFeedbackMap,
        normalized.review.data.directorFeedback || [],
        (entry, index) => toStableId('review-feedback', entry, index),
      );
      syncMapEntries(
        reviewChangeRequestMap,
        normalized.review.data.changeRequests || [],
        (entry, index) => toStableId('review-change-request', entry, index),
      );
      syncMapEntries(
        reviewShotTaskMap,
        normalized.review.data.shotTasks || [],
        (entry, index) => toStableId('review-shot-task', entry, index),
      );
      syncMapEntries(
        reviewShotAnnotationMap,
        normalized.review.data.shotAnnotations || [],
        (entry, index) => toStableId('review-shot-annotation', entry, index),
      );
      syncMapEntries(
        reviewThreadMap,
        normalized.review.threads,
        (entry) => entry.id,
      );
    }, transactionOrigin);
  };

  const updateAwarenessState = (
    selection: Partial<CollaborativeSelectionState>,
  ) => {
    if (!provider?.awareness) return;
    const existing =
      (provider.awareness.getLocalState()?.selection as
        | CollaborativeSelectionState
        | undefined) || params.awareness;
    provider.setAwarenessField('selection', {
      ...existing,
      ...selection,
      updatedAt: nowIso(),
    });
  };

  const handleDocChange = () => {
    emitSnapshot();
  };

  doc.on('update', handleDocChange);

  return {
    doc,
    provider,
    getStatus: () => status,
    connect: async () => {
      if (!provider) {
        setStatus('connected');
        return true;
      }
      setStatus('connecting');
      try {
        await provider.connect();
        if (params.awareness) {
          updateAwarenessState(params.awareness);
        }
        setStatus('connected');
        return true;
      } catch {
        setStatus('error');
        return false;
      }
    },
    disconnect: () => {
      provider?.disconnect();
      provider?.destroy();
      doc.off('update', handleDocChange);
      doc.destroy();
      setStatus('disconnected');
    },
    readSnapshot,
    seedFromSnapshot: (snapshot: SnapshotInput) => {
      syncDocFromSnapshot(snapshot, 'seed');
    },
    syncLocalSnapshot: (snapshot: SnapshotInput) => {
      syncDocFromSnapshot(snapshot, 'replace');
    },
    setAwarenessState: updateAwarenessState,
    onSnapshotChange: (listener: (doc: CollaborativeProjectDoc) => void) => {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
    onAwarenessChange: (
      listener: (states: CollaborativeSelectionState[]) => void,
    ) => {
      awarenessListeners.add(listener);
      return () => awarenessListeners.delete(listener);
    },
    onStatusChange: (
      listener: (nextStatus: CollaborativeProjectSessionStatus) => void,
    ) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
  };
};
