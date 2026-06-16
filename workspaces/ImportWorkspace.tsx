
import React from 'react';
import { MediaItem } from '../types';
import MediaBin from '../components/MediaBin';

interface ImportWorkspaceProps {
  mediaItems: MediaItem[];
  onAddMedia: (files: FileList) => void;
  onAddToTimeline: (mediaId: string) => void;
}

const ImportWorkspace: React.FC<ImportWorkspaceProps> = ({ mediaItems, onAddMedia, onAddToTimeline }) => {
  return (
    <div className="p-4 h-full flex flex-col">
      <div className="text-center mb-4 flex-shrink-0">
        <h2 className="text-2xl font-bold">Import Media</h2>
        <p className="text-gray-400">Upload your video and image files, or generate new ones using AI effects from the Edit panel.</p>
      </div>
      <div className="flex-grow min-h-0">
        <MediaBin mediaItems={mediaItems} onAddMedia={onAddMedia} onAddToTimeline={onAddToTimeline} />
      </div>
    </div>
  );
};

export default ImportWorkspace;
