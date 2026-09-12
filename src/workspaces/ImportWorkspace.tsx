import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MediaItem, RecentProject, ReferenceItem, ShotPrompt, TimelineClip } from '../types';
import MediaBin from '../components/MediaBin';
import type { LibraryAsset } from '../hooks/useLibraryAssets';
import { AudioIcon, ImageIcon, UploadIcon, VideoIcon, FolderIcon, FilmIcon, AddIcon, InfoIcon } from '../components/icons';
import type { OpenTimelineIOImportMode } from '../utils/openTimelineIOImport';
import { formatTimecode } from '../utils/timecode';

/**
 * Media page — modelled on the Resolve media page: sources on the left,
 * a source viewer on top, the media pool below it and metadata on the right.
 * Selection lives in exactly one place (the viewer) so every panel agrees.
 */

interface ImportWorkspaceProps {
  mediaItems: MediaItem[];
  timelineClips?: TimelineClip[];
  onAddMedia: (files: FileList) => void;
  onAddToTimeline: (mediaId: string) => void;
  onImportTimelineOtio?: (file: File, mode: OpenTimelineIOImportMode) => Promise<string | void> | string | void;
  projectName?: string | null;
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  onImportLibraryAsset?: (asset: LibraryAsset, options?: Record<string, unknown>) => Promise<void> | void;
}

const formatBytesish = (item: MediaItem) => (item.source === 'generated' ? item.generatedBy || 'Generated' : item.source === 'unsplash' ? 'Unsplash' : 'Uploaded');

const ImportWorkspace: React.FC<ImportWorkspaceProps> = ({
  mediaItems,
  timelineClips = [],
  onAddMedia,
  onAddToTimeline,
  onImportTimelineOtio,
  projectName,
  currentProjectName,
  currentProjectPath,
  references,
  shotPrompts,
  recentProjects,
  onImportLibraryAsset,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const otioInputRef = useRef<HTMLInputElement>(null);
  const [timelineImportMode, setTimelineImportMode] = useState<OpenTimelineIOImportMode>('replace');
  const [timelineImportStatus, setTimelineImportStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);

  const counts = useMemo(() => ({
    video: mediaItems.filter((item) => item.type === 'video').length,
    image: mediaItems.filter((item) => item.type === 'image').length,
    audio: mediaItems.filter((item) => item.type === 'audio').length,
  }), [mediaItems]);

  // Keep the viewer pointed at something sensible: the newest import when nothing is selected.
  const previousCount = useRef(mediaItems.length);
  useEffect(() => {
    if (mediaItems.length > previousCount.current) {
      setSelectedId(mediaItems[mediaItems.length - 1]?.id ?? null);
    } else if (selectedId && !mediaItems.some((item) => item.id === selectedId)) {
      setSelectedId(null);
    }
    previousCount.current = mediaItems.length;
  }, [mediaItems, selectedId]);

  const selected = useMemo(() => mediaItems.find((item) => item.id === selectedId) || null, [mediaItems, selectedId]);
  useEffect(() => { setDimensions(null); }, [selectedId]);

  const usageCount = useMemo(() => (selected ? timelineClips.filter((clip) => clip.mediaId === selected.id).length : 0), [timelineClips, selected]);

  const handleTimelineImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onImportTimelineOtio) return;
    setTimelineImportStatus(`Importing ${file.name}…`);
    try {
      const result = await onImportTimelineOtio(file, timelineImportMode);
      setTimelineImportStatus(result || `Imported ${file.name}.`);
    } catch (error) {
      setTimelineImportStatus(error instanceof Error ? error.message : 'OTIO import failed.');
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files?.length) onAddMedia(event.dataTransfer.files);
  };

  const sources = (
    <div className="media-page__sources">
      <div className="media-page__panel-title">Media Storage</div>

      <div
        className={`media-drop ${dragOver ? 'media-drop--over' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click(); }}
      >
        <UploadIcon className="w-6 h-6" />
        <strong>Drop files here</strong>
        <span>or click to browse · video, image, audio</span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          className="hidden"
          onChange={(event) => { if (event.target.files?.length) onAddMedia(event.target.files); event.target.value = ''; }}
        />
      </div>

      <div className="media-page__counts">
        <div className="media-page__count"><VideoIcon className="w-3.5 h-3.5" /><strong>{counts.video}</strong><span>Video</span></div>
        <div className="media-page__count"><ImageIcon className="w-3.5 h-3.5" /><strong>{counts.image}</strong><span>Images</span></div>
        <div className="media-page__count"><AudioIcon className="w-3.5 h-3.5" /><strong>{counts.audio}</strong><span>Audio</span></div>
      </div>

      <div className="media-page__section">
        <div className="media-page__section-title">Timeline interchange</div>
        <p className="media-page__hint">Import an OpenTimelineIO cut from editorial or VFX tools.</p>
        <div className="edit-seg" role="tablist" aria-label="OTIO import mode">
          {(['replace', 'append'] as OpenTimelineIOImportMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={timelineImportMode === mode}
              className={`edit-seg__item ${timelineImportMode === mode ? 'edit-seg__item--active' : ''}`}
              onClick={() => setTimelineImportMode(mode)}
            >
              {mode === 'replace' ? 'Replace' : 'Append'}
            </button>
          ))}
        </div>
        <input
          ref={otioInputRef}
          type="file"
          accept=".otio,.json,application/json,application/vnd.opentimelineio+json"
          onChange={handleTimelineImportChange}
          className="hidden"
        />
        <button
          type="button"
          className="edit-text-btn edit-text-btn--outline w-full justify-center"
          onClick={() => otioInputRef.current?.click()}
          disabled={!onImportTimelineOtio}
        >
          <FilmIcon className="w-3.5 h-3.5" />
          Import .otio
        </button>
        {timelineImportStatus && <p className="media-page__status">{timelineImportStatus}</p>}
      </div>

      <div className="media-page__section media-page__section--grow">
        <div className="media-page__section-title">Project</div>
        <div className="media-page__project">
          <FolderIcon className="w-4 h-4" />
          <div>
            <strong>{projectName || currentProjectName || 'Untitled project'}</strong>
            <small title={currentProjectPath || undefined}>{currentProjectPath || 'No folder chosen'}</small>
          </div>
        </div>
      </div>
    </div>
  );

  const viewer = (
    <div className="media-viewer">
      <div className="media-viewer__bar">
        <span className="media-viewer__label">Source</span>
        <small className="media-viewer__meta">
          {selected ? `${selected.type}${selected.duration ? ` · ${formatTimecode(selected.duration)}` : ''}` : 'Nothing selected'}
        </small>
      </div>
      <div className="media-viewer__stage">
        {selected?.type === 'video' && (
          <video
            key={selected.id}
            src={selected.url}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => setDimensions({ w: event.currentTarget.videoWidth, h: event.currentTarget.videoHeight })}
          />
        )}
        {selected?.type === 'image' && (
          <img
            key={selected.id}
            src={selected.url}
            alt={selected.name}
            draggable={false}
            onLoad={(event) => setDimensions({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
          />
        )}
        {selected?.type === 'audio' && (
          <div className="media-viewer__audio">
            <AudioIcon className="w-8 h-8" />
            <audio key={selected.id} src={selected.url} controls />
          </div>
        )}
        {!selected && (
          <div className="media-viewer__empty">
            <FilmIcon className="w-6 h-6" />
            <strong>{mediaItems.length === 0 ? 'No media yet' : 'Select a clip to preview it'}</strong>
            <span>{mediaItems.length === 0 ? 'Drop files on the left to bring footage into the project.' : 'Click a clip in the media pool · double-click adds it to the timeline.'}</span>
          </div>
        )}
      </div>
      <div className="media-viewer__foot">
        <strong title={selected?.name}>{selected?.name || '—'}</strong>
        {selected && (
          <button type="button" className="edit-text-btn edit-text-btn--primary" onClick={() => onAddToTimeline(selected.id)}>
            <AddIcon className="w-3.5 h-3.5" />
            Add to timeline
          </button>
        )}
      </div>
    </div>
  );

  const metadata = (
    <div className="media-page__meta">
      <div className="media-page__panel-title"><InfoIcon className="w-3.5 h-3.5" />Metadata</div>
      {selected ? (
        <dl className="media-meta">
          <div><dt>Name</dt><dd title={selected.name}>{selected.name}</dd></div>
          <div><dt>Type</dt><dd className="capitalize">{selected.type}</dd></div>
          {selected.duration ? <div><dt>Duration</dt><dd className="media-meta__mono">{formatTimecode(selected.duration)}</dd></div> : null}
          {dimensions ? <div><dt>Resolution</dt><dd className="media-meta__mono">{dimensions.w} × {dimensions.h}</dd></div> : null}
          <div><dt>Source</dt><dd>{formatBytesish(selected)}</dd></div>
          {selected.generatedBy && <div><dt>Model</dt><dd>{selected.generatedBy}</dd></div>}
          <div><dt>In timeline</dt><dd>{usageCount === 0 ? 'Unused' : `${usageCount} clip${usageCount === 1 ? '' : 's'}`}</dd></div>
          {(selected.videoVersions?.length || selected.imageVersions?.length) ? (
            <div><dt>Versions</dt><dd>{selected.videoVersions?.length || selected.imageVersions?.length}</dd></div>
          ) : null}
          {selected.prompt && (
            <div className="media-meta__block"><dt>Prompt</dt><dd>{selected.prompt}</dd></div>
          )}
          {selected.analysisNotes?.length ? (
            <div className="media-meta__block"><dt>Notes</dt><dd>{selected.analysisNotes.join(' · ')}</dd></div>
          ) : null}
        </dl>
      ) : (
        <p className="media-page__hint">Select a clip in the media pool to see its details here.</p>
      )}
    </div>
  );

  return (
    <div className="studio-workspace media-page">
      <aside className="media-page__side">{sources}</aside>
      <div className="media-page__center">
        {viewer}
        <div className="media-page__pool">
          <MediaBin
            mediaItems={mediaItems}
            timelineClips={timelineClips}
            onAddMedia={onAddMedia}
            onAddToTimeline={onAddToTimeline}
            onLoadMediaToSource={setSelectedId}
            onSelectMedia={setSelectedId}
            selectedMediaId={selectedId}
            currentProjectName={projectName || currentProjectName}
            currentProjectPath={currentProjectPath}
            references={references}
            shotPrompts={shotPrompts}
            recentProjects={recentProjects}
            onImportLibraryAsset={onImportLibraryAsset}
          />
        </div>
      </div>
      <aside className="media-page__side media-page__side--right">{metadata}</aside>
    </div>
  );
};

export default ImportWorkspace;
