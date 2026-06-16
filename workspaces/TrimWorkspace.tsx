
import React, { useState, useEffect, useRef } from 'react';
import { TimelineClip, MediaItem } from '../types';
import { ScissorsIcon } from '../components/icons';

interface TrimWorkspaceProps {
    selectedClip: TimelineClip | null;
    selectedMedia: MediaItem | null;
    onTrim: (clipId: string, newDuration: number) => void;
    onCancel: () => void;
}

const TrimWorkspace: React.FC<TrimWorkspaceProps> = ({ selectedClip, selectedMedia, onTrim, onCancel }) => {
    const [duration, setDuration] = useState(selectedClip?.duration || 0);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        setDuration(selectedClip?.duration || 0);
    }, [selectedClip]);

    if (!selectedClip || !selectedMedia) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 p-8">
                <div className="p-4 bg-gray-800 rounded-full border border-gray-700 mb-4">
                    <ScissorsIcon className="w-12 h-12 text-indigo-500" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-2">Trim Clip</h2>
                <p className="max-w-md">Please select a clip from the 'Edit' workspace to trim it here.</p>
            </div>
        );
    }

    const handleDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let newDuration = parseFloat(e.target.value);
        if (isNaN(newDuration)) newDuration = 0;

        const maxDuration = selectedMedia.duration || Infinity;
        if (newDuration > maxDuration) newDuration = maxDuration;
        if (newDuration < 0.1) newDuration = 0.1;

        setDuration(newDuration);
        if (videoRef.current) {
            videoRef.current.currentTime = 0; // Reset preview on trim
        }
    };

    const handleApplyTrim = () => {
        onTrim(selectedClip.id, duration);
        onCancel(); // Return to edit workspace
    };

    const sourceDuration = selectedMedia.duration || duration;

    const mediaPreview = () => {
        if (selectedMedia.type === 'video') {
            // Use a fragment URL to limit video playback for preview purposes
            const previewUrl = `${selectedMedia.url}#t=0,${duration}`;
            return (
                <video
                    ref={videoRef}
                    key={`${selectedMedia.id}-${duration}`}
                    src={previewUrl}
                    controls
                    className="w-full h-full object-contain"
                />
            );
        } else if (selectedMedia.type === 'image') {
            return <img src={selectedMedia.url} alt={selectedMedia.name} className="w-full h-full object-contain" />;
        }
        return <div className="text-gray-400">Audio trimming not yet supported in this view.</div>;
    };


    return (
        <div className="p-4 h-full flex flex-col md:flex-row gap-4 overflow-hidden">
            <div className="md:w-3/4 h-1/2 md:h-full flex items-center justify-center bg-black rounded-lg">
                {mediaPreview()}
            </div>
            <div className="md:w-1/4 h-1/2 md:h-full bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col">
                <h3 className="text-lg font-semibold mb-4 text-white">Trim Controls</h3>
                <p className="text-sm text-gray-400 mb-6">Adjust the duration of the clip. Changes will affect the position of all subsequent clips on the timeline.</p>

                <div className="space-y-4">
                    <div>
                        <label htmlFor="clipName" className="block text-sm font-medium text-gray-300">Clip Name</label>
                        <p id="clipName" className="text-lg text-white truncate">{selectedMedia.name}</p>
                    </div>
                     <div>
                        <label htmlFor="sourceDuration" className="block text-sm font-medium text-gray-300">Source Duration</label>
                        <p id="sourceDuration" className="text-lg text-white">{sourceDuration.toFixed(2)}s</p>
                    </div>
                    <div>
                        <label htmlFor="newDuration" className="block text-sm font-medium text-gray-300">New Duration (s)</label>
                        <input
                            type="number"
                            id="newDuration"
                            value={duration.toFixed(2)}
                            onChange={handleDurationChange}
                            step="0.1"
                            min="0.1"
                            max={sourceDuration.toFixed(2)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 mt-1 focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                <div className="mt-auto flex flex-col gap-2">
                    <button onClick={handleApplyTrim} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg">
                        Apply and Return
                    </button>
                    <button onClick={onCancel} className="w-full bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TrimWorkspace;
