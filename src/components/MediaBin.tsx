import React, { useMemo, useRef, useState } from 'react';
import { MediaItem, RecentProject, ReferenceItem, ShotPrompt, TimelineClip, TimelineTrack } from '../types';
import { useLibraryAssets, LibraryAsset, LibraryAssetKind } from '../hooks/useLibraryAssets';
import { UploadIcon, VideoIcon, ImageIcon, AudioIcon, DownloadIcon, BoxIcon, SearchIcon, FolderIcon } from './icons';

interface MediaBinProps {
  mediaItems: MediaItem[];
  timelineClips: TimelineClip[];
  timelineTracks?: TimelineTrack[];
  activeTrackId?: string | null;
  playheadPosition?: number;
  onAddMedia: (files: FileList) => void;
  onAddToTimeline: (mediaId: string) => void;
  onLoadMediaToSource?: (mediaId: string) => void;
  onLoadLibraryAssetToSource?: (asset: LibraryAsset) => void;
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  onImportLibraryAsset?: (
    asset: LibraryAsset,
    options?: {
      addToTimeline?: boolean;
      collectToProject?: boolean;
      trackId?: string;
      startTime?: number;
      sourceIn?: number;
      sourceOut?: number;
      timelineIn?: number;
      timelineOut?: number;
      mode?: 'insert' | 'overwrite';
    }
  ) => Promise<void> | void;
}

type ProjectSmartBinId = 'all' | 'broll' | 'unused' | 'generated' | 'voiceover' | 'music' | 'coverage' | 'angles' | 'gap-match';

const BROLL_KEYWORDS = [
  'b-roll',
  'broll',
  'cutaway',
  'cut away',
  'insert',
  'detail',
  'establishing',
  'atmosphere',
  'texture',
  'montage',
  'plate',
  'motion ref',
  'storyboard',
  'alt',
];

const ALT_ANGLE_KEYWORDS = [
  'angle',
  'angles',
  'alt angle',
  'alternate',
  'profile',
  'three-quarter',
  'front',
  'back',
  'side',
  'low angle',
  'high angle',
  'overhead',
  'wide',
  'close-up',
  'close up',
  'medium',
  'insert',
  'detail',
  'overthe shoulder',
  'shoulder',
];

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'before',
  'between',
  'camera',
  'close',
  'could',
  'first',
  'frame',
  'image',
  'project',
  'scene',
  'shot',
  'their',
  'there',
  'these',
  'video',
  'voice',
  'would',
]);

const MIN_PREVIEW_TRIM_WINDOW = 0.5;
const EMPTY_TIMELINE_TRACKS: TimelineTrack[] = [];
const EMPTY_REFERENCES: ReferenceItem[] = [];
const EMPTY_SHOT_PROMPTS: ShotPrompt[] = [];
const EMPTY_RECENT_PROJECTS: RecentProject[] = [];

const formatDuration = (value?: number) => {
  if (!value || value <= 0) return null;
  if (value >= 60) {
    const minutes = Math.floor(value / 60);
    const seconds = Math.round(value % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}s`;
};

const isProxyBackedVideo = (item: MediaItem) =>
  item.type === 'video' && Boolean(item.sourceUrl && item.sourceUrl !== item.url);

const isLikelyImageUrl = (url: string) => {
  if (!url) return false;
  if (url.startsWith('data:image')) return true;
  if (url.startsWith('blob:')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(url.split('?')[0]);
};

const isArchiveMedia = (value: { url?: string | null; name?: string; generatedBy?: string }) =>
  Boolean(value.url && /\.(zip|exr)(?:$|[?#])/i.test(value.url)) ||
  Boolean(value.name && /\.zip$/i.test(value.name)) ||
  /EXR|ACES HDR/i.test(value.generatedBy || '');

const MediaBin: React.FC<MediaBinProps> = ({
  mediaItems,
  timelineClips,
  timelineTracks = EMPTY_TIMELINE_TRACKS,
  activeTrackId = null,
  playheadPosition = 0,
  onAddMedia,
  onAddToTimeline,
  onLoadMediaToSource,
  onLoadLibraryAssetToSource,
  currentProjectName,
  currentProjectPath,
  references = EMPTY_REFERENCES,
  shotPrompts = EMPTY_SHOT_PROMPTS,
  recentProjects = EMPTY_RECENT_PROJECTS,
  onImportLibraryAsset,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeView, setActiveView] = useState<'project' | 'library'>('project');
  const [projectSearch, setProjectSearch] = useState('');
  const [projectBin, setProjectBin] = useState<ProjectSmartBinId>('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'footage' | 'audio' | 'stills'>('footage');
  const [collectStatuses, setCollectStatuses] = useState<Record<string, 'queued' | 'copying' | 'collected' | 'error'>>({});
  const [trimStateByAssetId, setTrimStateByAssetId] = useState<Record<string, { sourceIn: number; sourceOut: number }>>({});
  const collectQueueRef = useRef<Promise<void>>(Promise.resolve());

  const { assets: libraryAssets, isLoading: libraryLoading, error: libraryError } = useLibraryAssets({
    currentProjectName,
    currentProjectPath,
    mediaItems,
    references,
    shotPrompts,
    recentProjects,
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onAddMedia(e.target.files);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleProjectDragStart = (e: React.DragEvent<HTMLDivElement>, mediaId: string) => {
    e.dataTransfer.setData('application/x-media-id', mediaId);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const getTrimmedAsset = (asset: LibraryAsset): LibraryAsset => {
    const trim = trimStateByAssetId[asset.id];
    if (!trim || asset.kind !== 'video') return asset;
    return {
      ...asset,
      trimInSeconds: trim.sourceIn,
      trimOutSeconds: trim.sourceOut,
    };
  };

  const handleLibraryDragStart = (e: React.DragEvent<HTMLDivElement>, asset: LibraryAsset) => {
    if (!asset.url) return;
    e.dataTransfer.setData('application/x-library-asset', JSON.stringify(getTrimmedAsset(asset)));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleLibraryImport = async (
    asset: LibraryAsset,
    options?: { addToTimeline?: boolean; collectToProject?: boolean; trackId?: string; startTime?: number; sourceIn?: number; sourceOut?: number },
  ) => {
    if (!onImportLibraryAsset) return;
    const queuedAsset = getTrimmedAsset(asset);
    setCollectStatuses((prev) => ({ ...prev, [asset.id]: 'queued' }));
    const nextTask = collectQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        setCollectStatuses((prev) => ({ ...prev, [asset.id]: 'copying' }));
        try {
          await onImportLibraryAsset(queuedAsset, {
            ...options,
            sourceIn: options?.sourceIn ?? queuedAsset.trimInSeconds,
            sourceOut: options?.sourceOut ?? queuedAsset.trimOutSeconds,
          });
          setCollectStatuses((prev) => ({ ...prev, [asset.id]: 'collected' }));
        } catch (error) {
          console.error('Library import failed', error);
          setCollectStatuses((prev) => ({ ...prev, [asset.id]: 'error' }));
        }
      });
    collectQueueRef.current = nextTask;
    await nextTask;
  };

  const hasLibrarySupport = Boolean(onImportLibraryAsset);
  const canCollectIntoProject = Boolean(hasLibrarySupport && currentProjectPath);
  const usedMediaIds = useMemo(() => new Set(timelineClips.map((clip) => clip.mediaId)), [timelineClips]);
  const voiceoverUrls = useMemo(
    () => new Set(shotPrompts.map((shot) => shot.voiceoverUrl).filter((value): value is string => Boolean(value))),
    [shotPrompts],
  );

  const buildMediaSearchText = (item: MediaItem) =>
    [
      item.name,
      item.prompt,
      item.generatedBy,
      item.originUrl,
      item.originProjectPath,
      item.url,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  const buildClipSearchText = (clip: TimelineClip | null | undefined) => {
    if (!clip) return '';
    const media = mediaItems.find((item) => item.id === clip.mediaId);
    return media ? buildMediaSearchText(media) : '';
  };

  const getTrackClips = (trackId: string) =>
    timelineClips
      .filter((clip) => clip.trackId === trackId)
      .sort((a, b) => (a.start === b.start ? a.id.localeCompare(b.id) : a.start - b.start));

  const videoGaps = useMemo(() => {
    const gaps: Array<{ trackId: string; start: number; end: number; duration: number; previousClip: TimelineClip | null; nextClip: TimelineClip | null }> = [];
    timelineTracks
      .filter((track) => track.type === 'video')
      .forEach((track) => {
        const clips = getTrackClips(track.id);
        let cursor = 0;
        clips.forEach((clip, index) => {
          if (clip.start - cursor >= 0.75) {
            gaps.push({
              trackId: track.id,
              start: cursor,
              end: clip.start,
              duration: clip.start - cursor,
              previousClip: index > 0 ? clips[index - 1] : null,
              nextClip: clip,
            });
          }
          cursor = Math.max(cursor, clip.end);
        });
      });
    return gaps;
  }, [timelineClips, timelineTracks]);

  const currentGap = useMemo(() => {
    const onActiveTrack = activeTrackId
      ? videoGaps.find((gap) => gap.trackId === activeTrackId && playheadPosition >= gap.start && playheadPosition <= gap.end)
      : undefined;
    if (onActiveTrack) return onActiveTrack;
    const atPlayhead = videoGaps.find((gap) => playheadPosition >= gap.start && playheadPosition <= gap.end);
    if (atPlayhead) return atPlayhead;
    return [...videoGaps].sort((a, b) => b.duration - a.duration)[0] || null;
  }, [activeTrackId, playheadPosition, videoGaps]);

  const currentGapTokens = useMemo(() => {
    const tokenSet = new Set<string>();
    [currentGap?.previousClip, currentGap?.nextClip]
      .map((clip) => buildClipSearchText(clip))
      .forEach((text) => {
        text.split(/[^a-z0-9]+/).forEach((token) => {
          if (token.length < 5 || STOPWORDS.has(token)) return;
          tokenSet.add(token);
        });
      });
    return tokenSet;
  }, [currentGap, mediaItems]);

  const currentCutTokens = useMemo(() => {
    const tokenSet = new Set<string>();
    mediaItems
      .filter((item) => usedMediaIds.has(item.id))
      .map((item) => buildMediaSearchText(item))
      .forEach((text) => {
        text.split(/[^a-z0-9]+/).forEach((token) => {
          if (token.length < 5 || STOPWORDS.has(token)) return;
          tokenSet.add(token);
        });
      });
    return tokenSet;
  }, [mediaItems, usedMediaIds]);

  const isVoiceoverMedia = (item: MediaItem) => {
    if (item.type !== 'audio') return false;
    if (voiceoverUrls.has(item.url) || (item.originUrl && voiceoverUrls.has(item.originUrl))) {
      return true;
    }
    const text = buildMediaSearchText(item);
    return /\b(voiceover|voice over|narration|narrator|dialogue|speech|tts|elevenlabs)\b/.test(text);
  };

  const isMusicMedia = (item: MediaItem) => {
    if (item.type !== 'audio' || isVoiceoverMedia(item)) return false;
    const text = buildMediaSearchText(item);
    if (/\b(music|score|soundtrack|song|beat|theme|ambient|ambience)\b/.test(text)) {
      return true;
    }
    return item.source === 'generated' || /music assistant/i.test(item.generatedBy || '');
  };

  const isGeneratedShot = (item: MediaItem) => {
    if (item.type === 'audio') return false;
    return item.source === 'generated' || Boolean(item.generatedBy) || Boolean(item.prompt);
  };

  const isAltAngleMedia = (item: MediaItem) => {
    if (item.type === 'audio') return false;
    const text = buildMediaSearchText(item);
    return ALT_ANGLE_KEYWORDS.some((keyword) => text.includes(keyword));
  };

  const getCurrentCutContextScore = (item: MediaItem) => {
    const tokens = buildMediaSearchText(item).split(/[^a-z0-9]+/);
    return tokens.reduce((score, token) => {
      if (token.length < 5 || !currentCutTokens.has(token)) return score;
      return score + 1;
    }, 0);
  };

  const getCurrentGapContextScore = (item: MediaItem) => {
    const tokens = buildMediaSearchText(item).split(/[^a-z0-9]+/);
    return tokens.reduce((score, token) => {
      if (token.length < 5 || !currentGapTokens.has(token)) return score;
      return score + 1;
    }, 0);
  };

  const getBrollScore = (item: MediaItem) => {
    if (item.type === 'audio') return 0;
    const text = buildMediaSearchText(item);
    const keywordScore = BROLL_KEYWORDS.reduce((score, keyword) => score + (text.includes(keyword) ? 2 : 0), 0);
    const unusedScore = usedMediaIds.has(item.id) ? 0 : 2;
    const mediaTypeScore = item.type === 'video' ? 2 : 1;
    const generatedScore = isGeneratedShot(item) ? 1 : 0;
    const contextScore = Math.min(3, getCurrentCutContextScore(item));
    return keywordScore + unusedScore + mediaTypeScore + generatedScore + contextScore;
  };

  const getGapFitScore = (item: MediaItem, gap = currentGap) => {
    if (!gap || item.type === 'audio') return 0;
    const itemDuration = Math.max(1, item.duration || gap.duration || 1);
    const durationDelta = Math.abs(itemDuration - gap.duration);
    const durationScore = Math.max(0, 4 - durationDelta);
    const contextScore = Math.min(4, getCurrentGapContextScore(item));
    const brollScore = Math.min(4, getBrollScore(item));
    const unusedBonus = usedMediaIds.has(item.id) ? 0 : 2;
    return durationScore + contextScore + brollScore + unusedBonus;
  };

  const collectedAssetUrls = useMemo(() => {
    const collected = new Set<string>();
    mediaItems.forEach((item) => {
      if (item.originUrl && item.url && item.url !== item.originUrl) {
        collected.add(item.originUrl);
      }
    });
    return collected;
  }, [mediaItems]);

  const resolveAssetTrim = (asset: LibraryAsset) => {
    const duration = Math.max(0, asset.duration || 0);
    const existing = trimStateByAssetId[asset.id];
    if (existing) {
      return {
        sourceIn: Math.max(0, Math.min(existing.sourceIn, Math.max(0, duration - MIN_PREVIEW_TRIM_WINDOW))),
        sourceOut: Math.max(existing.sourceIn + MIN_PREVIEW_TRIM_WINDOW, Math.min(duration || existing.sourceOut, existing.sourceOut)),
      };
    }
    if (!duration) {
      return { sourceIn: 0, sourceOut: 0 };
    }
    return { sourceIn: 0, sourceOut: duration };
  };

  const updateAssetTrim = (asset: LibraryAsset, next: { sourceIn?: number; sourceOut?: number }) => {
    if (!asset.duration || asset.kind !== 'video') return;
    setTrimStateByAssetId((prev) => {
      const current = prev[asset.id] || { sourceIn: 0, sourceOut: asset.duration || 0 };
      const sourceIn = Math.max(0, Math.min(next.sourceIn ?? current.sourceIn, Math.max(0, (next.sourceOut ?? current.sourceOut) - MIN_PREVIEW_TRIM_WINDOW)));
      const sourceOut = Math.max(sourceIn + MIN_PREVIEW_TRIM_WINDOW, Math.min(asset.duration || current.sourceOut, next.sourceOut ?? current.sourceOut));
      return {
        ...prev,
        [asset.id]: { sourceIn, sourceOut },
      };
    });
  };

  const filteredProjectMedia = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    const matchesSearch = (item: MediaItem) => {
      if (!term) return true;
      return buildMediaSearchText(item).includes(term);
    };

    return [...mediaItems]
      .filter((item) => {
        if (!matchesSearch(item)) return false;
        switch (projectBin) {
          case 'broll':
            return getBrollScore(item) >= 5;
          case 'unused':
            return !usedMediaIds.has(item.id) && item.type !== 'audio';
          case 'coverage':
            return videoGaps.length > 0 && item.type !== 'audio' && getGapFitScore(item) >= 7;
          case 'angles':
            return isAltAngleMedia(item);
          case 'gap-match':
            return Boolean(currentGap) && item.type !== 'audio' && getGapFitScore(item) >= 8;
          case 'generated':
            return isGeneratedShot(item);
          case 'voiceover':
            return isVoiceoverMedia(item);
          case 'music':
            return isMusicMedia(item);
          case 'all':
          default:
            return true;
        }
      })
      .sort((a, b) => {
        if (projectBin === 'broll') {
          return getBrollScore(b) - getBrollScore(a) || a.name.localeCompare(b.name);
        }
        if (projectBin === 'coverage' || projectBin === 'gap-match') {
          return getGapFitScore(b) - getGapFitScore(a) || a.name.localeCompare(b.name);
        }
        if (projectBin === 'angles') {
          return Number(isAltAngleMedia(b)) - Number(isAltAngleMedia(a)) || a.name.localeCompare(b.name);
        }
        if (projectBin === 'unused') {
          return Number(usedMediaIds.has(a.id)) - Number(usedMediaIds.has(b.id)) || a.name.localeCompare(b.name);
        }
        if (projectBin === 'generated') {
          return Number(isGeneratedShot(b)) - Number(isGeneratedShot(a)) || a.name.localeCompare(b.name);
        }
        return a.name.localeCompare(b.name);
      });
  }, [currentCutTokens, currentGap, currentGapTokens, mediaItems, projectBin, projectSearch, usedMediaIds, videoGaps.length]);

  const projectBinMeta = useMemo(
    () => [
      { id: 'all' as const, label: 'All', count: mediaItems.length, hint: 'Everything in this project.' },
      {
        id: 'broll' as const,
        label: 'Best B-roll',
        count: mediaItems.filter((item) => getBrollScore(item) >= 5).length,
        hint: 'Unused cutaways ranked against the current edit.',
      },
      {
        id: 'unused' as const,
        label: 'Unused Takes',
        count: mediaItems.filter((item) => !usedMediaIds.has(item.id) && item.type !== 'audio').length,
        hint: 'Shots not yet placed in the timeline.',
      },
      {
        id: 'generated' as const,
        label: 'Generated Shots',
        count: mediaItems.filter((item) => isGeneratedShot(item)).length,
        hint: 'AI-generated visual material.',
      },
      {
        id: 'coverage' as const,
        label: 'Needs Coverage',
        count: videoGaps.length > 0 ? mediaItems.filter((item) => item.type !== 'audio' && getGapFitScore(item) >= 7).length : 0,
        hint: videoGaps.length > 0 ? 'Unused material that best fits uncovered gaps.' : 'No significant video gaps detected.',
      },
      {
        id: 'angles' as const,
        label: 'Alt Angles',
        count: mediaItems.filter((item) => isAltAngleMedia(item)).length,
        hint: 'Potential alternate angle coverage and inserts.',
      },
      {
        id: 'gap-match' as const,
        label: 'Best Match for Current Gap',
        count: currentGap ? mediaItems.filter((item) => item.type !== 'audio' && getGapFitScore(item) >= 8).length : 0,
        hint: currentGap ? `Ranked against the ${currentGap.duration.toFixed(1)}s gap around the playhead.` : 'Move the playhead into a gap to rank shots against it.',
      },
      {
        id: 'voiceover' as const,
        label: 'Voiceover',
        count: mediaItems.filter((item) => isVoiceoverMedia(item)).length,
        hint: 'Narration and TTS cues.',
      },
      {
        id: 'music' as const,
        label: 'Music',
        count: mediaItems.filter((item) => isMusicMedia(item)).length,
        hint: 'Score beds and music stems.',
      },
    ],
    [currentCutTokens, currentGap, mediaItems, usedMediaIds, videoGaps.length, voiceoverUrls],
  );

  const filteredLibraryAssets = useMemo(() => {
    const term = librarySearch.trim().toLowerCase();
    const rankKind = (kind: LibraryAssetKind) => {
      if (kind === 'video') return 0;
      if (kind === 'audio') return 1;
      if (kind === 'image') return 2;
      return 3;
    };

    return libraryAssets
      .filter((asset) => asset.origin === 'recent' && asset.url)
      .filter((asset) => {
        if (libraryFilter === 'footage') return asset.kind === 'video';
        if (libraryFilter === 'audio') return asset.kind === 'audio';
        if (libraryFilter === 'stills') return asset.kind === 'image' || asset.kind === 'reference';
        return true;
      })
      .filter((asset) => {
        if (!term) return true;
        return (
          asset.name.toLowerCase().includes(term) ||
          asset.projectName.toLowerCase().includes(term) ||
          (asset.detail || '').toLowerCase().includes(term) ||
          (asset.prompt || '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        const kindDelta = rankKind(a.kind) - rankKind(b.kind);
        if (kindDelta !== 0) return kindDelta;
        return a.name.localeCompare(b.name);
      });
  }, [libraryAssets, libraryFilter, librarySearch]);

  return (
    <div className="bg-gray-800/50 p-4 flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold text-white">Media Bin</h3>
        {hasLibrarySupport && (
          <div className="inline-flex rounded-lg border border-gray-700 bg-gray-900/60 p-1 text-[11px]">
            <button
              onClick={() => setActiveView('project')}
              className={`px-2.5 py-1 rounded ${activeView === 'project' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Project
            </button>
            <button
              onClick={() => setActiveView('library')}
              className={`px-2.5 py-1 rounded ${activeView === 'library' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Library
            </button>
          </div>
        )}
      </div>
      <div className="flex-grow overflow-y-auto pr-2 -mr-2">
        {activeView === 'project' ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3 text-[11px] text-gray-400">
                <div>Smart bins are ranked against the current cut.</div>
                <div>
                  {timelineClips.length} clips in timeline
                  {currentGap && ` · current gap ${currentGap.duration.toFixed(1)}s`}
                </div>
              </div>
              <div className="relative">
                <SearchIcon className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="Search current project media, prompts, generators..."
                  className="w-full bg-gray-950/80 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-xs text-gray-200"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {projectBinMeta.map((bin) => (
                  <button
                    key={bin.id}
                    onClick={() => setProjectBin(bin.id)}
                    title={bin.hint}
                    className={`px-2.5 py-1 rounded border text-[11px] ${
                      projectBin === bin.id
                        ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                        : 'border-gray-700 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {bin.label} ({bin.count})
                  </button>
                ))}
              </div>
            </div>

            {filteredProjectMedia.length === 0 ? (
              mediaItems.length === 0 ? (
                <div className="text-center text-gray-500 flex flex-col items-center justify-center h-56 border border-dashed border-gray-700 rounded-lg">
                  <UploadIcon className="w-12 h-12 mb-2" />
                  <p>Your media will appear here.</p>
                  <p>Upload files or collect footage from the library.</p>
                </div>
              ) : (
                <div className="text-center text-gray-500 flex flex-col items-center justify-center h-40 border border-dashed border-gray-700 rounded-lg">
                  <FolderIcon className="w-10 h-10 mb-2" />
                  <p>No media matches this smart bin.</p>
                </div>
              )
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {filteredProjectMedia.map((item) => {
                  const durationLabel = formatDuration(item.duration);
                  const usageLabel = usedMediaIds.has(item.id) ? 'In Cut' : 'Unused';
                  const hasProxy = isProxyBackedVideo(item);
                  const isArchive = isArchiveMedia(item);
                  const proxyLabel = hasProxy
                    ? `Proxy ready${durationLabel ? ` · ${durationLabel}` : ''}`
                    : null;
                  return (
                    <div
                      key={item.id}
                      draggable={!isArchive}
                      onDragStart={(e) => handleProjectDragStart(e, item.id)}
                      className={`relative group aspect-square bg-gray-900 rounded-md overflow-hidden border-2 border-transparent hover:border-indigo-500 transition-all ${isArchive ? 'cursor-default' : 'cursor-pointer'}`}
                      onClick={() => {
                        if (!isArchive) onAddToTimeline(item.id);
                      }}
                    >
                      <div className="absolute top-1 left-1 z-10 flex max-w-[75%] flex-col items-start gap-1">
                        {item.generatedBy && (
                          <div className="bg-black/70 text-[10px] text-gray-200 px-2 py-1 rounded max-w-full truncate">
                            {item.generatedBy}
                          </div>
                        )}
                        {proxyLabel && (
                          <div
                            className="bg-sky-950/85 text-[10px] text-sky-100 px-2 py-1 rounded border border-sky-700/70 max-w-full truncate"
                            title="Auto Cut uses the desktop proxy. Export keeps the original source linked."
                          >
                            {proxyLabel}
                          </div>
                        )}
                      </div>
                      <div className="absolute top-1 right-1 bg-black/70 text-[10px] text-indigo-100 px-2 py-1 rounded z-10">
                        {usageLabel}
                      </div>
                      {item.type === 'image' ? (
                        isLikelyImageUrl(item.url) ? (
                          <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                            <BoxIcon className="w-12 h-12 text-gray-500" />
                          </div>
                        )
                      ) : item.type === 'video' && !isArchive ? (
                        <video src={item.url} className="w-full h-full object-cover" muted playsInline />
                      ) : isArchive ? (
                        <div className="w-full h-full bg-gray-800 flex flex-col items-center justify-center gap-2 text-gray-500">
                          <BoxIcon className="w-12 h-12" />
                          <span className="text-[10px] uppercase tracking-[0.18em]">EXR ZIP</span>
                        </div>
                      ) : (
                        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                          <AudioIcon className="w-12 h-12 text-gray-500" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2">
                        <p className="text-white text-xs text-center break-words">{item.name}</p>
                        <p className="text-indigo-400 text-xs mt-1">{isArchive ? 'Download HDR frames' : 'Drag or Click to add'}</p>
                        {hasProxy && (
                          <p className="text-[10px] text-sky-200 mt-2 text-center">
                            Auto Cut uses the proxy. Export relinks the original file.
                          </p>
                        )}
                        {item.prompt && (
                          <p className="text-[10px] text-gray-300 mt-2 line-clamp-3 text-center">{item.prompt}</p>
                        )}
                        <a
                          href={item.url}
                          download
                          onClick={(event) => event.stopPropagation()}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-white bg-gray-700/80 hover:bg-gray-600 px-2 py-1 rounded"
                        >
                          <DownloadIcon className="w-3 h-3" />
                          Download
                        </a>
                        {onLoadMediaToSource && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onLoadMediaToSource(item.id);
                            }}
                            className="mt-2 inline-flex items-center gap-1 text-xs text-white bg-indigo-600/80 hover:bg-indigo-500 px-2 py-1 rounded"
                          >
                            Load to Source
                          </button>
                        )}
                      </div>
                      <div className="absolute bottom-1 left-1 flex items-center gap-1">
                        {durationLabel && !hasProxy && (
                          <div className="bg-gray-900/70 text-[10px] text-gray-200 px-2 py-1 rounded">
                            {durationLabel}
                          </div>
                        )}
                        {projectBin === 'broll' && getBrollScore(item) >= 5 && (
                          <div className="bg-emerald-900/70 text-[10px] text-emerald-200 px-2 py-1 rounded">
                            B-roll Match {getBrollScore(item)}
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-1 right-1 bg-gray-900/70 p-1 rounded">
                        {isArchive ? <BoxIcon className="w-4 h-4 text-gray-300" /> :
                         item.type === 'image' ? <ImageIcon className="w-4 h-4 text-gray-300" /> :
                         item.type === 'video' ? <VideoIcon className="w-4 h-4 text-gray-300" /> :
                         <AudioIcon className="w-4 h-4 text-gray-300" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-700/70 bg-gray-900/40 p-3 space-y-3">
              <div className="flex items-center gap-2 text-[11px] text-gray-400">
                <FolderIcon className="w-4 h-4" />
                {canCollectIntoProject
                  ? 'Collect footage from saved projects directly into this edit and drop it onto tracks.'
                  : 'Pull footage from saved projects into this edit without leaving the page.'}
              </div>
              <div className="relative">
                <SearchIcon className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={librarySearch}
                  onChange={(event) => setLibrarySearch(event.target.value)}
                  placeholder="Search library footage, projects, prompts..."
                  className="w-full bg-gray-950/80 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-xs text-gray-200"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'footage', label: 'Footage' },
                  { id: 'audio', label: 'Audio' },
                  { id: 'stills', label: 'Stills' },
                  { id: 'all', label: 'All' },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setLibraryFilter(option.id as typeof libraryFilter)}
                    className={`px-2.5 py-1 rounded border text-[11px] ${
                      libraryFilter === option.id
                        ? 'border-indigo-500 bg-indigo-600/20 text-indigo-200'
                        : 'border-gray-700 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {libraryLoading && <div className="text-xs text-gray-500">Loading library assets...</div>}
              {libraryError && <div className="text-xs text-amber-300">{libraryError}</div>}
            </div>

            {filteredLibraryAssets.length === 0 && !libraryLoading ? (
              <div className="text-center text-gray-500 flex flex-col items-center justify-center h-40 border border-dashed border-gray-700 rounded-lg">
                <FolderIcon className="w-10 h-10 mb-2" />
                <p>No matching library assets found.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {filteredLibraryAssets.map((asset) => {
                  const trim = resolveAssetTrim(asset);
                  const trimDuration = asset.kind === 'video' && asset.duration
                    ? Math.max(MIN_PREVIEW_TRIM_WINDOW, trim.sourceOut - trim.sourceIn)
                    : undefined;
                  const status = collectStatuses[asset.id] || (asset.url && collectedAssetUrls.has(asset.url) ? 'collected' : undefined);
                  const isPending = status === 'queued' || status === 'copying';
                  const durationLabel = formatDuration(asset.duration);
                  const isArchive = isArchiveMedia(asset);
                  return (
                    <div
                      key={asset.id}
                      draggable={Boolean(asset.url && hasLibrarySupport && !isArchive)}
                      onDragStart={(event) => handleLibraryDragStart(event, asset)}
                      className="relative group aspect-square bg-gray-900 rounded-md overflow-hidden border border-gray-700 hover:border-indigo-500 transition-all"
                    >
                      {(asset.kind === 'image' || asset.kind === 'reference') && asset.url ? (
                        isLikelyImageUrl(asset.url) ? (
                          <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                            <BoxIcon className="w-12 h-12 text-gray-500" />
                          </div>
                        )
                      ) : asset.kind === 'video' && asset.url && !isArchive ? (
                        <video
                          src={asset.url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={(event) => {
                            const duration = event.currentTarget.duration;
                            if (!Number.isFinite(duration) || duration <= 0) return;
                            const current = trimStateByAssetId[asset.id];
                            if (!current) {
                              setTrimStateByAssetId((prev) => ({
                                ...prev,
                                [asset.id]: { sourceIn: 0, sourceOut: duration },
                              }));
                            }
                          }}
                          onMouseMove={(event) => {
                            if (!asset.duration) return;
                            const rect = event.currentTarget.getBoundingClientRect();
                            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                            const start = trim.sourceIn;
                            const end = trim.sourceOut || asset.duration;
                            event.currentTarget.currentTime = start + (end - start) * ratio;
                          }}
                        />
                      ) : isArchive ? (
                        <div className="w-full h-full bg-gray-800 flex flex-col items-center justify-center gap-2 text-gray-500">
                          <BoxIcon className="w-12 h-12" />
                          <span className="text-[10px] uppercase tracking-[0.18em]">EXR ZIP</span>
                        </div>
                      ) : asset.kind === 'audio' ? (
                        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                          <AudioIcon className="w-12 h-12 text-gray-500" />
                        </div>
                      ) : (
                        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                          <BoxIcon className="w-12 h-12 text-gray-500" />
                        </div>
                      )}
                      <div className="absolute top-1 left-1 right-1 flex items-start justify-between gap-1">
                        <div className="bg-black/70 text-[10px] text-gray-200 px-2 py-1 rounded max-w-[65%] truncate">
                          {asset.projectName}
                        </div>
                        <div className="bg-black/70 text-[10px] text-indigo-200 px-2 py-1 rounded uppercase">
                          {asset.kind}
                        </div>
                      </div>
                      {status && (
                        <div className={`absolute top-9 right-1 text-[10px] px-2 py-1 rounded ${
                          status === 'collected'
                            ? 'bg-emerald-900/80 text-emerald-200'
                            : status === 'error'
                              ? 'bg-rose-900/80 text-rose-200'
                              : 'bg-amber-900/80 text-amber-200'
                        }`}>
                          {status === 'queued' ? 'Queued' : status === 'copying' ? 'Copying…' : status === 'collected' ? 'Collected' : 'Copy Failed'}
                        </div>
                      )}
                      <div className="absolute bottom-1 left-1 flex items-center gap-1">
                        {durationLabel && (
                          <div className="bg-gray-900/70 text-[10px] text-gray-200 px-2 py-1 rounded">
                            {durationLabel}
                          </div>
                        )}
                        {trimDuration && trimDuration < (asset.duration || 0) && (
                          <div className="bg-sky-900/70 text-[10px] text-sky-200 px-2 py-1 rounded">
                            In/Out {formatDuration(trimDuration)}
                          </div>
                        )}
                        {canCollectIntoProject && !isArchive && (
                          <div className="bg-emerald-900/70 text-[10px] text-emerald-200 px-2 py-1 rounded">
                            Drag to track
                          </div>
                        )}
                      </div>
                      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                        <p className="text-white text-xs font-medium line-clamp-2">{asset.name}</p>
                        {(asset.detail || asset.prompt) && (
                          <p className="text-gray-300 text-[10px] mt-1 line-clamp-2">{asset.detail || asset.prompt}</p>
                        )}
                        {asset.kind === 'video' && asset.duration && !isArchive && (
                          <div className="mt-2 rounded border border-gray-700 bg-gray-950/70 p-2 space-y-2">
                            <div className="flex items-center justify-between text-[10px] text-gray-400">
                              <span>Hover-scrub + clip picker</span>
                              <span>{formatDuration(trim.sourceIn)} to {formatDuration(trim.sourceOut)}</span>
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500">In</label>
                              <input
                                type="range"
                                min={0}
                                max={asset.duration}
                                step={0.1}
                                value={trim.sourceIn}
                                onChange={(event) => updateAssetTrim(asset, { sourceIn: Number(event.target.value) })}
                                className="w-full"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500">Out</label>
                              <input
                                type="range"
                                min={0}
                                max={asset.duration}
                                step={0.1}
                                value={trim.sourceOut}
                                onChange={(event) => updateAssetTrim(asset, { sourceOut: Number(event.target.value) })}
                                className="w-full"
                              />
                            </div>
                          </div>
                        )}
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          {onLoadLibraryAssetToSource && (
                            <button
                              onClick={() => onLoadLibraryAssetToSource(getTrimmedAsset(asset))}
                              disabled={isPending || !asset.url || isArchive}
                              className="text-xs text-white bg-slate-700 hover:bg-slate-600 disabled:opacity-60 disabled:cursor-not-allowed px-2 py-1.5 rounded"
                            >
                              Load to Source
                            </button>
                          )}
                          <button
                            onClick={() => void handleLibraryImport(asset, {
                              collectToProject: canCollectIntoProject,
                              sourceIn: trim.sourceIn,
                              sourceOut: trim.sourceOut,
                            })}
                            disabled={isPending}
                            className="text-xs text-white bg-gray-700/90 hover:bg-gray-600 disabled:opacity-60 disabled:cursor-not-allowed px-2 py-1.5 rounded"
                          >
                            {isPending
                              ? status === 'queued' ? 'Queued…' : 'Copying…'
                              : canCollectIntoProject
                                ? 'Collect into Project'
                                : 'Import by Reference'}
                          </button>
                          <button
                            onClick={() => void handleLibraryImport(asset, {
                              addToTimeline: true,
                              collectToProject: canCollectIntoProject,
                              sourceIn: trim.sourceIn,
                              sourceOut: trim.sourceOut,
                            })}
                            disabled={isPending || isArchive}
                            className="text-xs text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed px-2 py-1.5 rounded"
                          >
                            {canCollectIntoProject ? 'Collect + Add to Timeline' : 'Import + Add to Timeline'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileChange}
        multiple
        accept="video/*,image/*,audio/*"
      />
      <button
        onClick={handleUploadClick}
        className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-transform transform hover:scale-105"
      >
        <UploadIcon className="w-5 h-5" />
        Upload Media
      </button>
    </div>
  );
};

export default MediaBin;
