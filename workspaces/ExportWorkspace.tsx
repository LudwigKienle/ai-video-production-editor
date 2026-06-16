
import React, { useState, useRef } from 'react';
import { MediaItem, TimelineClip, TimelineTrack } from '../types';
import { ExportIcon } from '../components/icons';
import PreviewPlayer, { PreviewPlayerHandle } from '../components/PreviewPlayer';

interface ExportWorkspaceProps {
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
}

type ExportStatus = 'IDLE' | 'RENDERING' | 'DONE' | 'ERROR';

const ExportWorkspace: React.FC<ExportWorkspaceProps> = ({ mediaItems, timelineClips }) => {
    const [status, setStatus] = useState<ExportStatus>('IDLE');
    const [progress, setProgress] = useState(0);
    const [settings, setSettings] = useState({
        filename: 'my-ai-video.webm',
    });
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

    // Rendering State
    const [renderPlayhead, setRenderPlayhead] = useState(0);
    const [isRendering, setIsRendering] = useState(false);

    const playerRef = useRef<PreviewPlayerHandle>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const requestRef = useRef<number>(0);

    const handleSettingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSettings(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const startRender = async () => {
        if (timelineClips.length === 0) {
            setStatus('ERROR');
            return;
        }

        setStatus('RENDERING');
        setRenderPlayhead(0);
        setIsRendering(true);
        chunksRef.current = [];

        // Wait for player to mount and be ready
        setTimeout(() => {
            const canvas = playerRef.current?.getCanvas();
            const audioCtx = playerRef.current?.getAudioContext();

            if (!canvas) {
                setStatus('ERROR');
                return;
            }

            const stream = canvas.captureStream(30); // 30 FPS
            // Note: For full audio export, we'd need to route the audio graph to a MediaStreamDestination.
            // Current PreviewPlayer implementation handles audio via HTMLAudioElements for preview.
            // For MVP Canvas export, we capture video only or mix in if we refactor audio engine to WebAudio fully.
            // To keep it robust, we stick to Video stream + simple audio capture if possible,
            // or just video for now as "Real-Time Canvas Export" implies the visual component primarily.

            const combinedStream = new MediaStream([...stream.getTracks()]);

            const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp9' });

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                setDownloadUrl(url);
                setStatus('DONE');
                setIsRendering(false);
            };

            mediaRecorderRef.current = recorder;
            recorder.start();

            // Start playback loop
            const totalDuration = Math.max(...timelineClips.map(c => c.end));
            const startTime = Date.now();

            const renderLoop = () => {
                const elapsed = (Date.now() - startTime) / 1000;
                setRenderPlayhead(elapsed);
                setProgress(Math.min((elapsed / totalDuration) * 100, 100));

                if (elapsed >= totalDuration) {
                    recorder.stop();
                } else {
                    requestRef.current = requestAnimationFrame(renderLoop);
                }
            };

            requestRef.current = requestAnimationFrame(renderLoop);

        }, 500);
    };

    const handleReset = () => {
        setStatus('IDLE');
        setProgress(0);
        setDownloadUrl(null);
        setRenderPlayhead(0);
    }

    // Dummy tracks for the renderer to use
    const tracks: TimelineTrack[] = [
        { id: 'video-1', type: 'video', isLocked: false, isMuted: false },
        { id: 'audio-1', type: 'audio', isLocked: false, isMuted: false }
    ];

    const renderContent = () => {
        switch (status) {
            case 'IDLE':
                return (
                    <>
                        <h2 className="text-3xl font-bold text-white mb-2">Export Project</h2>
                        <p className="text-gray-400 mb-8">Record your canvas in real-time to generate a video file.</p>
                        <div className="max-w-sm mx-auto text-left mb-8">
                            <label htmlFor="filename" className="block text-sm font-medium text-gray-300 mb-1">Filename</label>
                            <input type="text" name="filename" id="filename" value={settings.filename} onChange={handleSettingChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500" />
                        </div>
                        <button onClick={startRender} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-lg transition-transform transform hover:scale-105">
                            Start Render
                        </button>
                    </>
                );
            case 'RENDERING':
                return (
                    <div className="w-full h-full flex flex-col items-center justify-center">
                        <h2 className="text-2xl font-bold text-white mb-4">Rendering... {Math.round(progress)}%</h2>

                        {/* Hidden Player for Rendering */}
                        <div className="w-[640px] h-[360px] border border-indigo-500 rounded-lg overflow-hidden shadow-2xl mb-4 relative">
                            <PreviewPlayer
                                ref={playerRef}
                                timelineClips={timelineClips}
                                timelineTracks={tracks}
                                mediaItems={mediaItems}
                                playheadPosition={renderPlayhead}
                                isPlaying={isRendering}
                            />
                             <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                                <div className="text-red-500 font-bold animate-pulse">REC</div>
                             </div>
                        </div>
                        <p className="text-gray-400 animate-pulse">Please wait while we capture your masterpiece.</p>
                    </div>
                );
            case 'DONE':
                 return (
                    <>
                        <h2 className="text-3xl font-bold text-green-400 mb-4">Export Complete!</h2>
                        <p className="text-gray-400 mb-6">Your video has been successfully rendered.</p>
                        <a href={downloadUrl!} download={settings.filename} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-lg transition-transform transform hover:scale-105 inline-block">
                            Download Video
                        </a>
                        <button onClick={handleReset} className="mt-4 ml-4 text-gray-400 hover:text-white">Export another</button>
                    </>
                );
            case 'ERROR':
                 return (
                    <>
                        <h2 className="text-3xl font-bold text-red-400 mb-4">Export Failed</h2>
                        <p className="text-gray-400 mb-6">Could not start export. Ensure you have clips on the timeline.</p>
                        <button onClick={handleReset} className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-6 rounded-lg">
                            Go Back
                        </button>
                    </>
                );
        }
    }


    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-gray-900">
            {status !== 'RENDERING' && (
                <div className="p-4 bg-gray-800 rounded-full border border-gray-700 mb-4">
                    <ExportIcon className="w-12 h-12 text-indigo-500" />
                </div>
            )}
            {renderContent()}
        </div>
    );
};

export default ExportWorkspace;
