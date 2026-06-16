


import React, { useState, useEffect, useRef } from 'react';
import { TimelineClip, MediaItem, AudioScoreRequest } from '../types';
import { ColorIcon, AudioIcon, MagicWandIcon, MusicNoteIcon } from '../components/icons';
import { getAudioSuggestions, transcribeAudio, suggestColorGrade, gradeImageFromPrompt, generateSmartScore, generateSoundEffect } from '../services/geminiService';
import { fileToBase64, extractFrameFromVideo } from '../utils/helpers';

interface PostWorkspaceProps {
    selectedClip: TimelineClip | null;
    selectedMedia: MediaItem | null;
    onUpdateFilters: (clipId: string, filters: TimelineClip['filters']) => void;
    timelineClips: TimelineClip[];
    mediaItems: MediaItem[];
}

const AudioMixerPanel: React.FC<Pick<PostWorkspaceProps, 'timelineClips' | 'mediaItems'>> = ({ timelineClips, mediaItems }) => {
    const [suggestions, setSuggestions] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [transcription, setTranscription] = useState('');
    const [scoreRequests, setScoreRequests] = useState<AudioScoreRequest[]>([]);
    const [generatedAudio, setGeneratedAudio] = useState<MediaItem[]>([]);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    const handleGetSuggestions = async () => {
        setIsLoading(true);
        try {
            const result = await getAudioSuggestions(timelineClips, mediaItems);
            setSuggestions(result);
        } catch (e) {
            setSuggestions("Error getting suggestions: " + (e as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateScore = async () => {
        setIsLoading(true);
        try {
            const requests = await generateSmartScore(timelineClips, mediaItems);
            setScoreRequests(requests);

            // Auto-generate audio for these requests
            const newAudio: MediaItem[] = [];
            for(const req of requests) {
                try {
                    // For music/sfx we effectively use a sound generation proxy (TTS or similar for this demo)
                    const item = await generateSoundEffect(`${req.type === 'music' ? 'Music: ' : 'SFX: '}${req.mood}. ${req.sceneDescription}`, req.duration);
                    newAudio.push(item);
                } catch(e) { console.error(e); }
            }
            setGeneratedAudio(newAudio);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    }

    const handleToggleRecording = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorderRef.current = new MediaRecorder(stream);
                audioChunksRef.current = [];

                mediaRecorderRef.current.ondataavailable = (event) => {
                    audioChunksRef.current.push(event.data);
                };

                mediaRecorderRef.current.onstop = async () => {
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    setIsLoading(true);
                    setTranscription('Transcribing...');
                    try {
                        const base64 = await fileToBase64(audioBlob as File);
                        const result = await transcribeAudio({ base64, mimeType: audioBlob.type });
                        setTranscription(result);
                    } catch(e) {
                        setTranscription('Error: ' + (e as Error).message);
                    } finally {
                        setIsLoading(false);
                    }
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorderRef.current.start();
                setIsRecording(true);
                setTranscription('');
            } catch (err) {
                console.error("Error accessing microphone:", err);
                alert("Could not access microphone. Please check permissions.");
            }
        }
    };

    return (
        <div className="p-4 h-full flex flex-col md:flex-row gap-4 overflow-hidden">
            <div className="md:w-1/3 h-full flex flex-col bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                 <h3 className="text-lg font-semibold mb-2 text-white text-center">Sound Design</h3>
                 <button onClick={handleGetSuggestions} disabled={isLoading} className="flex items-center justify-center gap-2 w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg mb-4 disabled:bg-gray-600">
                    <MagicWandIcon className="w-5 h-5"/>
                    {isLoading ? 'Thinking...' : 'Analyze Timeline'}
                 </button>
                 <div className="bg-gray-900 rounded p-4 flex-grow overflow-y-auto">
                    {suggestions ? (
                        <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans">{suggestions}</pre>
                    ) : (
                        <p className="text-gray-500 text-sm">Get AI recommendations for music style and sound effects based on your visual edit.</p>
                    )}
                 </div>
            </div>

            <div className="md:w-1/3 h-full flex flex-col bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                 <h3 className="text-lg font-semibold mb-2 text-white text-center">AI Composer</h3>
                 <button onClick={handleGenerateScore} disabled={isLoading} className="flex items-center justify-center gap-2 w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2 px-4 rounded-lg mb-4 disabled:bg-gray-600">
                    <MusicNoteIcon className="w-5 h-5"/>
                    {isLoading ? 'Composing...' : 'Generate Score & SFX'}
                 </button>
                 <div className="bg-gray-900 rounded p-4 flex-grow overflow-y-auto space-y-2">
                    {generatedAudio.length > 0 ? (
                        generatedAudio.map((audio, i) => (
                            <div key={i} className="bg-gray-800 p-2 rounded border border-gray-700 flex justify-between items-center">
                                <div>
                                    <p className="text-xs font-bold text-purple-300 truncate w-40">{audio.name}</p>
                                    <p className="text-[10px] text-gray-400">{audio.duration}s</p>
                                </div>
                                <audio src={audio.url} controls className="h-6 w-24" />
                            </div>
                        ))
                    ) : (
                        <p className="text-gray-500 text-sm">Automatically generate specific audio clips synced to your timeline events.</p>
                    )}
                 </div>
            </div>

            <div className="md:w-1/3 h-full flex flex-col bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                 <h3 className="text-lg font-semibold mb-2 text-white text-center">Voice Over</h3>
                 <button onClick={handleToggleRecording} disabled={isLoading} className={`flex items-center justify-center gap-2 w-full text-white font-bold py-2 px-4 rounded-lg mb-4 disabled:bg-gray-600 ${isRecording ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}>
                    <AudioIcon className="w-5 h-5"/>
                    {isRecording ? 'Stop Recording' : 'Record & Transcribe'}
                 </button>
                 <div className="bg-gray-900 rounded p-4 flex-grow overflow-y-auto">
                     {transcription ? (
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">{transcription}</p>
                    ) : (
                        <p className="text-gray-500 text-sm">Record a voice over and get an instant AI transcription.</p>
                    )}
                 </div>
            </div>
        </div>
    )
}

const DEFAULT_FILTERS = { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 };

const ColorGradingPanel: React.FC<Pick<PostWorkspaceProps, 'selectedClip' | 'selectedMedia' | 'onUpdateFilters'>> = ({ selectedClip, selectedMedia, onUpdateFilters }) => {
    const [frame, setFrame] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<string | false>(false);
    const [aiGrade, setAiGrade] = useState<{ analysis: string; suggestions: any[] } | null>(null);
    const [prompt, setPrompt] = useState('');

    useEffect(() => {
        const getFrame = async () => {
            if (selectedMedia?.type === 'video' && selectedMedia.url) {
                const frameData = await extractFrameFromVideo(selectedMedia.url, selectedClip!.start);
                setFrame(frameData);
            } else if (selectedMedia?.type === 'image') {
                setFrame(selectedMedia.url);
            } else {
                setFrame(null);
            }
        };
        getFrame();
    }, [selectedClip?.id, selectedMedia?.id]); // Removed selectedClip?.start from dependency to avoid flicker on minor drags

    useEffect(() => {
        const getAiSuggestions = async () => {
            if (frame) {
                setIsLoading("Analyzing colors...");
                setAiGrade(null);
                try {
                    const base64 = frame.split(',')[1];
                    const mimeType = frame.substring(5, frame.indexOf(';'));
                    const result = await suggestColorGrade(base64, mimeType);
                    setAiGrade(result);
                } catch (e) {
                    console.error("Failed to get AI grade suggestions:", e);
                } finally {
                    setIsLoading(false);
                }
            }
        };
        // Debounce automatic analysis or trigger manually? For now auto on frame load
        if (frame && !aiGrade) getAiSuggestions();
    }, [frame]);

    const handleFilterChange = (name: string, value: number) => {
        if (!selectedClip) return;
        const newFilters = { ...(selectedClip.filters || DEFAULT_FILTERS), [name]: value };
        onUpdateFilters(selectedClip.id, newFilters);
    };

    const applyAiSuggestion = (filters: any) => {
        if (!selectedClip) return;
        onUpdateFilters(selectedClip.id, filters);
    };

    const handlePromptGrade = async () => {
        if (!prompt || !frame) return;
        setIsLoading("Applying custom grade...");
        try {
            const base64 = frame.split(',')[1];
            const mimeType = frame.substring(5, frame.indexOf(';'));
            const result = await gradeImageFromPrompt(base64, mimeType, prompt);
            onUpdateFilters(selectedClip!.id, result.filters);
        } catch (e) {
            console.error("Failed to apply prompt grade:", e);
        } finally {
            setIsLoading(false);
        }
    };

    if (!selectedClip || !selectedMedia) {
        return <div className="p-4 text-center text-gray-400 h-full flex items-center justify-center">Select a video or image clip from the timeline to start color grading.</div>
    }

    const filters = selectedClip.filters || DEFAULT_FILTERS;
    const clipStyle = {
      filter: `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%) hue-rotate(${filters.hueRotate}deg)`,
    };

    return (
        <div className="p-4 h-full flex flex-col lg:flex-row gap-4 overflow-hidden">
            <div className="lg:w-1/2 h-1/2 lg:h-full flex flex-col bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-2 text-white text-center">Manual Controls</h3>
                <div className="relative aspect-video bg-black rounded overflow-hidden mb-4">
                    {frame ? <img src={frame} style={clipStyle} className="w-full h-full object-contain transition-all duration-300"/> : <div className="w-full h-full flex items-center justify-center text-gray-500">Loading Preview...</div>}
                </div>
                <div className="space-y-3 overflow-y-auto pr-2 -mr-2 text-sm">
                     <div>
                        <label htmlFor="brightness" className="mb-1 text-xs text-gray-300 flex justify-between">Brightness <span>{filters.brightness}%</span></label>
                        <input type="range" id="brightness" name="brightness" min="0" max="200" value={filters.brightness} onChange={e => handleFilterChange('brightness', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                    </div>
                    <div>
                        <label htmlFor="contrast" className="mb-1 text-xs text-gray-300 flex justify-between">Contrast <span>{filters.contrast}%</span></label>
                        <input type="range" id="contrast" name="contrast" min="0" max="200" value={filters.contrast} onChange={e => handleFilterChange('contrast', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                    </div>
                    <div>
                        <label htmlFor="saturate" className="mb-1 text-xs text-gray-300 flex justify-between">Saturation <span>{filters.saturate}%</span></label>
                        <input type="range" id="saturate" name="saturate" min="0" max="200" value={filters.saturate} onChange={e => handleFilterChange('saturate', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                    </div>
                    <div>
                        <label htmlFor="hueRotate" className="mb-1 text-xs text-gray-300 flex justify-between">Hue <span>{filters.hueRotate}°</span></label>
                        <input type="range" id="hueRotate" name="hueRotate" min="0" max="360" value={filters.hueRotate} onChange={e => handleFilterChange('hueRotate', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                    </div>
                </div>
            </div>
            <div className="lg:w-1/2 h-1/2 lg:h-full flex flex-col bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-2 text-white text-center flex items-center justify-center gap-2"><MagicWandIcon className="w-5 h-5"/> AI Colorist</h3>
                 <div className="flex-grow flex flex-col overflow-y-auto pr-2 -mr-2">
                     {isLoading && <div className="text-center text-yellow-400 p-2">{isLoading}</div>}
                     {aiGrade ? (
                        <>
                            <div className="bg-gray-900/50 p-2 rounded mb-3">
                                <h4 className="font-semibold text-indigo-300 text-sm">Analysis:</h4>
                                <p className="text-xs text-gray-300 italic">{aiGrade.analysis}</p>
                            </div>
                            <h4 className="font-semibold text-indigo-300 text-sm mb-2">Suggestions:</h4>
                            <div className="space-y-2">
                                {aiGrade.suggestions.map((s, i) => (
                                    <button key={i} onClick={() => applyAiSuggestion(s.filters)} className="w-full text-left bg-gray-700 hover:bg-indigo-800/50 p-2 rounded transition-colors border border-gray-600">
                                        {s.name}
                                    </button>
                                ))}
                            </div>
                        </>
                     ) : !isLoading && <p className="text-gray-500 text-center text-sm">Waiting for AI analysis...</p>}
                 </div>
                 <div className="mt-auto pt-2 border-t border-gray-700">
                    <label className="text-sm font-medium text-gray-300">Or describe your own look:</label>
                    <div className="flex gap-2 mt-1">
                        <input type="text" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g., Cold, neon-lit cyberpunk" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-sm"/>
                        <button onClick={handlePromptGrade} disabled={!prompt || !!isLoading} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 rounded-lg disabled:bg-gray-600">Apply</button>
                    </div>
                 </div>
            </div>
        </div>
    );
};


const PostWorkspace: React.FC<PostWorkspaceProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'color' | 'audio'>('color');

    if (props.timelineClips.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 p-8">
                <div className="p-4 bg-gray-800 rounded-full border border-gray-700 mb-4">
                    <ColorIcon className="w-12 h-12 text-indigo-500" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-2">Post-Production</h2>
                <p className="max-w-md">Add clips to the timeline in the 'Edit' workspace to begin color grading and audio mixing.</p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <div className="flex-shrink-0 flex justify-center border-b border-gray-700">
                <button
                  onClick={() => setActiveTab('color')}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'color' ? 'text-indigo-400 border-indigo-400' : 'text-gray-400 border-transparent hover:text-white'}`}
                >
                    <ColorIcon className="w-5 h-5"/> Color Grading
                </button>
                <button
                  onClick={() => setActiveTab('audio')}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'audio' ? 'text-indigo-400 border-indigo-400' : 'text-gray-400 border-transparent hover:text-white'}`}
                >
                    <AudioIcon className="w-5 h-5"/> Audio Tools
                </button>
            </div>
            <div className="flex-grow min-h-0">
                {activeTab === 'color' && <ColorGradingPanel {...props} />}
                {activeTab === 'audio' && <AudioMixerPanel {...props} />}
            </div>
        </div>
    )
};

export default PostWorkspace;
