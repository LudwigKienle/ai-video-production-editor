
import React, { useState, useRef, useEffect } from 'react';
import { MediaItem } from '../types';
import { BrushIcon, EraserIcon, MagicWandIcon, LayersIcon, UploadIcon } from './icons';
import { editImage } from '../services/geminiService';
import SketchCanvas from './SketchCanvas';
import { fileToBase64 } from '../utils/helpers';

interface ImageEditorModalProps {
    isOpen: boolean;
    mediaItem: MediaItem | null;
    onClose: () => void;
    onSave: (newMedia: MediaItem) => void;
}

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({ isOpen, mediaItem, onClose, onSave }) => {
    const [prompt, setPrompt] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [mode, setMode] = useState<'paint' | 'reference'>('paint');
    const [referenceImage, setReferenceImage] = useState<{ file: File; url: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // We reuse the SketchCanvas but here it acts more like a mask/overlay painter for visual reference
    // In a real "Inpainting" scenario, we'd send the mask.
    // Since we are using standard Gemini Image Edit (Img+Text), we send the whole image and instructions.
    // The "Paint" mode here helps the user visualize what they want to change.

    if (!isOpen || !mediaItem) return null;

    const handleGenerate = async () => {
        if (!prompt) return;
        setIsProcessing(true);
        try {
            const response = await fetch(mediaItem.url);
            const blob = await response.blob();
            const base64 = await fileToBase64(new File([blob], mediaItem.name, { type: blob.type }));

            let refImgData = undefined;
            if (referenceImage) {
                const refBase64 = await fileToBase64(referenceImage.file);
                refImgData = { base64: refBase64, mimeType: referenceImage.file.type };
            }

            const newMedia = await editImage(prompt, { base64, mimeType: blob.type }, refImgData);
            onSave(newMedia);
            onClose();
        } catch (e) {
            console.error(e);
            alert("Edit failed. Please try again.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const file = e.target.files[0];
            setReferenceImage({ file, url: URL.createObjectURL(file) });
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[80]">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex overflow-hidden">
                {/* Canvas Area */}
                <div className="flex-grow bg-black relative flex items-center justify-center p-4">
                    <img src={mediaItem.url} alt="Original" className="max-w-full max-h-full object-contain absolute z-0 opacity-50 pointer-events-none" />

                    {/* Visual Overlay for "Marking" - Conceptual inpainting interface */}
                    <div className="relative z-10 w-full h-full flex items-center justify-center">
                         <img src={mediaItem.url} alt="Edit Target" className="max-w-full max-h-full object-contain shadow-2xl" />
                         {/* In a fuller implementation, we would overlay a SketchCanvas here to create a mask */}
                    </div>

                    <div className="absolute top-4 left-4 bg-gray-800/80 p-2 rounded-lg text-xs text-white">
                        Editing: {mediaItem.name}
                    </div>
                </div>

                {/* Sidebar Tools */}
                <div className="w-80 bg-gray-800 border-l border-gray-700 p-6 flex flex-col gap-6">
                    <div>
                        <h3 className="text-xl font-bold text-white mb-1">Magic Editor</h3>
                        <p className="text-sm text-gray-400">Generative Fill & Edit</p>
                    </div>

                    <div className="flex bg-gray-700 p-1 rounded-lg">
                        <button
                            onClick={() => setMode('paint')}
                            className={`flex-1 py-2 rounded-md text-sm font-bold flex items-center justify-center gap-2 ${mode === 'paint' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            <BrushIcon className="w-4 h-4"/> Edit
                        </button>
                        <button
                            onClick={() => setMode('reference')}
                            className={`flex-1 py-2 rounded-md text-sm font-bold flex items-center justify-center gap-2 ${mode === 'reference' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            <LayersIcon className="w-4 h-4"/> Reference
                        </button>
                    </div>

                    <div className="flex-grow space-y-4">
                        {mode === 'paint' && (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-300">Describe what you want to change, add, or remove.</p>
                                <textarea
                                    value={prompt}
                                    onChange={e => setPrompt(e.target.value)}
                                    placeholder="e.g. Add a red hat, remove the background, make it look like a painting..."
                                    className="w-full h-32 bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 resize-none text-white"
                                />
                            </div>
                        )}

                        {mode === 'reference' && (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-300">Upload an image to guide the style or content of the edit.</p>
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-gray-600 rounded-lg h-32 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-gray-700/50 transition-all"
                                >
                                    {referenceImage ? (
                                        <img src={referenceImage.url} className="h-full w-full object-cover rounded-lg" />
                                    ) : (
                                        <>
                                            <UploadIcon className="w-8 h-8 text-gray-500 mb-2"/>
                                            <span className="text-xs text-gray-500">Click to Upload</span>
                                        </>
                                    )}
                                    <input type="file" ref={fileInputRef} onChange={handleRefUpload} className="hidden" accept="image/*" />
                                </div>
                                {referenceImage && (
                                    <button onClick={() => setReferenceImage(null)} className="text-xs text-red-400 hover:text-white w-full text-right">Remove Reference</button>
                                )}
                                <textarea
                                    value={prompt}
                                    onChange={e => setPrompt(e.target.value)}
                                    placeholder="Instructions for how to use this reference..."
                                    className="w-full h-24 bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 resize-none text-white"
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex gap-2">
                         <button onClick={onClose} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 rounded-lg">Cancel</button>
                         <button
                            onClick={handleGenerate}
                            disabled={!prompt || isProcessing}
                            className="flex-[2] bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isProcessing ? (
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                            ) : (
                                <><MagicWandIcon className="w-5 h-5"/> Generate</>
                            )}
                         </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ImageEditorModal;
