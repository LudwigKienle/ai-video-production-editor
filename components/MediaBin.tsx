
import React, { useRef } from 'react';
import { MediaItem } from '../types';
import { UploadIcon, VideoIcon, ImageIcon, AudioIcon } from './icons';

interface MediaBinProps {
  mediaItems: MediaItem[];
  onAddMedia: (files: FileList) => void;
  onAddToTimeline: (mediaId: string) => void;
}

const MediaBin: React.FC<MediaBinProps> = ({ mediaItems, onAddMedia, onAddToTimeline }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      onAddMedia(e.target.files);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, mediaId: string) => {
      e.dataTransfer.setData('application/x-media-id', mediaId);
      e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="bg-gray-800/50 p-4 flex flex-col h-full">
      <h3 className="text-lg font-semibold mb-4 text-white">Media Bin</h3>
      <div className="flex-grow overflow-y-auto pr-2 -mr-2">
        {mediaItems.length === 0 ? (
          <div className="text-center text-gray-500 flex flex-col items-center justify-center h-full">
            <UploadIcon className="w-12 h-12 mb-2" />
            <p>Your media will appear here.</p>
            <p>Upload files to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {mediaItems.map(item => (
              <div
                key={item.id}
                draggable={true}
                onDragStart={(e) => handleDragStart(e, item.id)}
                className="relative group cursor-pointer aspect-square bg-gray-900 rounded-md overflow-hidden border-2 border-transparent hover:border-indigo-500 transition-all"
                onClick={() => onAddToTimeline(item.id)}
              >
                {item.type === 'image' ? (
                  <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
                ) : item.type === 'video' ? (
                  <video src={item.url} className="w-full h-full object-cover" />
                ) : (
                   <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                       <AudioIcon className="w-12 h-12 text-gray-500" />
                   </div>
                )}
                 <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2">
                    <p className="text-white text-xs text-center break-words">{item.name}</p>
                    <p className="text-indigo-400 text-xs mt-1">Drag or Click to add</p>
                </div>
                <div className="absolute bottom-1 right-1 bg-gray-900/70 p-1 rounded">
                    {item.type === 'image' ? <ImageIcon className="w-4 h-4 text-gray-300" /> :
                     item.type === 'video' ? <VideoIcon className="w-4 h-4 text-gray-300" /> :
                     <AudioIcon className="w-4 h-4 text-gray-300" />}
                </div>
              </div>
            ))}
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
