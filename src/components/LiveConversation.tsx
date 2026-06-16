import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob as GenAIBlob, FunctionDeclaration } from '@google/genai';
import { decode, encode, decodeAudioData } from '../utils/helpers';
import { AudioIcon } from './icons';

interface LiveConversationProps {
  apiKeyReady: boolean;
  onClose: () => void;
  directorTools?: FunctionDeclaration[];
  directorToolExecutor?: { [key: string]: Function };
  systemInstruction?: string;
}

const LiveConversation: React.FC<LiveConversationProps> = ({ apiKeyReady, onClose, directorTools, directorToolExecutor, systemInstruction }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [transcription, setTranscription] = useState<{ user: string; model: string; history: string[] }>({ user: '', model: '', history: [] });
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);

  useEffect(() => {
    // Cleanup on component unmount
    return () => {
        stopConversation();
    };
  }, []);

  const stopConversation = () => {
    sessionPromiseRef.current?.then(session => session.close());
    sessionPromiseRef.current = null;

    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;

    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
    }
    audioContextRef.current = null;

    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close();
    }
    outputAudioContextRef.current = null;

    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();

    if (isConnected) {
        setIsConnected(false);
    }
  };

  const startConversation = async () => {
    if (!apiKeyReady) {
      setError("API Key not ready.");
      return;
    }
    setError(null);
    setTranscription({ user: '', model: '', history: [] });

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

        const outputNode = outputAudioContextRef.current.createGain();
        outputNode.connect(outputAudioContextRef.current.destination);

        sessionPromiseRef.current = ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: () => {
                    setIsConnected(true);
                    const source = audioContextRef.current!.createMediaStreamSource(stream);
                    const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
                    scriptProcessorRef.current = scriptProcessor;

                    scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const pcmBlob: GenAIBlob = {
                            data: encode(new Uint8Array(new Int16Array(inputData.map(x => x * 32768)).buffer)),
                            mimeType: 'audio/pcm;rate=16000',
                        };
                        sessionPromiseRef.current?.then((session) => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                    };
                    source.connect(scriptProcessor);
                    scriptProcessor.connect(audioContextRef.current!.destination);
                },
                onmessage: async (message: LiveServerMessage) => {
                    if (message.serverContent?.inputTranscription) {
                        setTranscription(prev => ({ ...prev, user: message.serverContent.inputTranscription.text }));
                    }
                    if (message.serverContent?.outputTranscription) {
                         setTranscription(prev => ({ ...prev, model: message.serverContent.outputTranscription.text }));
                    }
                    if (message.serverContent?.turnComplete) {
                        setTranscription(prev => ({
                            user: '', model: '',
                            history: [...prev.history, `You: ${prev.user}`, `AI: ${prev.model}`]
                        }));
                        setActiveTool(null);
                    }

                    // Handle Tool Calls
                    if (message.toolCall) {
                        for (const fc of message.toolCall.functionCalls) {
                            setActiveTool(fc.name);
                            let result: any = { success: false, message: "Tool not found" };
                            if (directorToolExecutor && directorToolExecutor[fc.name]) {
                                try {
                                    result = await directorToolExecutor[fc.name](fc.args);
                                } catch(e) {
                                    result = { success: false, message: (e as Error).message };
                                }
                            }
                            sessionPromiseRef.current?.then(session => {
                                session.sendToolResponse({
                                    functionResponses: {
                                        id: fc.id,
                                        name: fc.name,
                                        response: { result },
                                    }
                                });
                            });
                        }
                    }

                    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                    if (audioData && outputAudioContextRef.current) {
                        nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
                        const audioBuffer = await decodeAudioData(decode(audioData), outputAudioContextRef.current, 24000, 1);
                        const source = outputAudioContextRef.current.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(outputNode);
                        source.addEventListener('ended', () => { sourcesRef.current.delete(source); });
                        source.start(nextStartTimeRef.current);
                        nextStartTimeRef.current += audioBuffer.duration;
                        sourcesRef.current.add(source);
                    }
                },
                onerror: (e: ErrorEvent) => {
                    setError(`Connection Error: ${e.message}`);
                    stopConversation();
                },
                onclose: () => {
                    stopConversation();
                },
            },
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' }}},
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                tools: directorTools ? [{ functionDeclarations: directorTools }] : undefined,
                systemInstruction: systemInstruction || "You are a video editor assistant. Help the user edit their timeline.",
            },
        });

    } catch (err) {
        setError(`Failed to start session: ${(err as Error).message}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-[60]">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col">
        <header className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <AudioIcon className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-bold">Live Director Mode</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">&times;</button>
        </header>

        <div className="flex-grow p-4 overflow-y-auto flex flex-col relative">
          <div className="flex-grow space-y-2">
            {transcription.history.map((line, i) => (
                <p key={i} className={`text-sm ${line.startsWith('You:') ? 'text-indigo-300' : 'text-gray-200'}`}>{line}</p>
            ))}
            {transcription.user && <p className="text-sm text-indigo-300">You: {transcription.user}...</p>}
            {transcription.model && <p className="text-sm text-gray-200">AI: {transcription.model}...</p>}
          </div>

          {activeTool && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                  <div className="bg-indigo-600 text-white px-4 py-2 rounded-full shadow-lg animate-bounce flex items-center gap-2">
                      <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                      Running Action: {activeTool}
                  </div>
              </div>
          )}

          {error && <p className="text-red-400 text-center mt-4">{error}</p>}
        </div>

        <div className="p-4 border-t border-gray-700 text-center">
            <button
              onClick={isConnected ? stopConversation : startConversation}
              className={`px-6 py-3 font-bold rounded-lg text-white transition-colors flex items-center justify-center gap-2 w-full ${isConnected ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'}`}
            >
                <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-white animate-pulse' : 'bg-green-200'}`}></div>
                {isConnected ? 'Stop Director Mode' : 'Start Director Mode'}
            </button>
            <p className="text-xs text-gray-400 mt-2">
                Try saying: "Split this clip", "Mute music", or "Zoom in".
            </p>
        </div>
      </div>
    </div>
  );
};

export default LiveConversation;