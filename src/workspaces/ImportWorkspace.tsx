import React, { useRef, useState } from 'react';
import { MediaItem } from '../types';
import MediaBin from '../components/MediaBin';
import { AudioIcon, ImageIcon, UploadIcon, VideoIcon } from '../components/icons';
import type { OpenTimelineIOImportMode } from '../utils/openTimelineIOImport';

interface ImportWorkspaceProps {
  mediaItems: MediaItem[];
  onAddMedia: (files: FileList) => void;
  onAddToTimeline: (mediaId: string) => void;
  onImportTimelineOtio?: (file: File, mode: OpenTimelineIOImportMode) => Promise<string | void> | string | void;
}

const ImportWorkspace: React.FC<ImportWorkspaceProps> = ({ mediaItems, onAddMedia, onAddToTimeline, onImportTimelineOtio }) => {
  const otioInputRef = useRef<HTMLInputElement>(null);
  const [timelineImportMode, setTimelineImportMode] = useState<OpenTimelineIOImportMode>('replace');
  const [timelineImportStatus, setTimelineImportStatus] = useState('');
  const videoCount = mediaItems.filter((item) => item.type === 'video').length;
  const imageCount = mediaItems.filter((item) => item.type === 'image').length;
  const audioCount = mediaItems.filter((item) => item.type === 'audio').length;

  const handleTimelineImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onImportTimelineOtio) return;

    setTimelineImportStatus(`Importing ${file.name}...`);
    try {
      const result = await onImportTimelineOtio(file, timelineImportMode);
      setTimelineImportStatus(result || `Imported ${file.name}.`);
    } catch (error) {
      setTimelineImportStatus(error instanceof Error ? error.message : 'OTIO import failed.');
    }
  };

  return (
    <div className="studio-workspace p-6 h-full flex flex-col gap-5">
      <section className="workspace-hero flex-shrink-0">
        <div className="workspace-hero__content">
          <div className="workspace-hero__eyebrow">Project ingest</div>
          <h2 className="workspace-hero__title">Import Media</h2>
          <p className="workspace-hero__body">Bring in footage, images, audio, and generated assets before assembling the timeline.</p>
        </div>
        <div className="workspace-hero__icon">
          <UploadIcon className="w-7 h-7" />
        </div>
        <div className="workspace-stat-grid">
          <div className="workspace-stat">
            <VideoIcon className="workspace-stat__icon" />
            <div>
              <div className="workspace-stat__value">{videoCount}</div>
              <div className="workspace-stat__label">Videos</div>
            </div>
          </div>
          <div className="workspace-stat">
            <ImageIcon className="workspace-stat__icon" />
            <div>
              <div className="workspace-stat__value">{imageCount}</div>
              <div className="workspace-stat__label">Images</div>
            </div>
          </div>
          <div className="workspace-stat">
            <AudioIcon className="workspace-stat__icon" />
            <div>
              <div className="workspace-stat__value">{audioCount}</div>
              <div className="workspace-stat__label">Audio</div>
            </div>
          </div>
          <div className="workspace-stat">
            <UploadIcon className="workspace-stat__icon" />
            <div>
              <div className="workspace-stat__value">{mediaItems.length}</div>
              <div className="workspace-stat__label">Total assets</div>
            </div>
          </div>
        </div>
      </section>
      <section className="app-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-left">
          <div className="text-sm font-semibold text-white">Timeline Interchange</div>
          <p className="text-xs text-gray-400">Import OpenTimelineIO .otio files from editorial and VFX tools.</p>
          {timelineImportStatus && <p className="mt-2 text-xs text-indigo-300">{timelineImportStatus}</p>}
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex rounded-lg bg-gray-950 p-1">
            {(['replace', 'append'] as OpenTimelineIOImportMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTimelineImportMode(mode)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${timelineImportMode === mode ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {mode}
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
            onClick={() => otioInputRef.current?.click()}
            disabled={!onImportTimelineOtio}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-indigo-500 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UploadIcon className="h-4 w-4" />
            Import OTIO Timeline
          </button>
        </div>
      </section>
      <div className="flex-grow min-h-0">
        <MediaBin mediaItems={mediaItems} timelineClips={[]} onAddMedia={onAddMedia} onAddToTimeline={onAddToTimeline} />
      </div>
    </div>
  );
};

export default ImportWorkspace;
