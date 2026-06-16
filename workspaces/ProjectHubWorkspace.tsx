import React, { useState, useRef, useEffect } from 'react';
import { MediaItem, StoryBible, ReferenceItem, ShotPrompt, ReviewFeedback, ScriptLength, CinematographyCritique, RecentProject } from '../types';
import {
    generateProductionGuidelines,
    generateScript,
    generateReferenceDetails,
    generateImageWithNano,
    generateShotImagePrompts,
    generateExtraShotPrompt,
    generateMotionPromptForShot,
    generateVideoWithVeo,
    analyzeScriptForReferences,
    generateImageWithImagen,
    generateImageWithReferences,
    generateImageWithGemini3Pro,
    analyzeProjectDraft,
    editScriptSelection,
    suggestNextPlotPoints,
    suggestVisualStyles,
    reviewCinematography,
    generateMoviePoster,
    shouldUsePreviousShotContext,
    generateCharacterProfile,
    generateCharacterOutfitPlan
} from '../services/geminiService';
import { generateSpeechWithElevenLabs, fetchElevenLabsVoices, ElevenLabsVoice } from '../services/elevenLabsService';
import { generateImageWithZTurbo, generateImageWithFlux, generateImageWithSeedream, generateImageWithSeedreamReferences, generateImageWithQwenImage, generateOpenPose, generateVideoWithWanI2V, generateVideoWithKling, generateVideoWithKlingMotionControl, generateVideoWithLtx, inpaintWithNanoBanana, inpaintWithFlux2Pro, editImageWithQwen } from '../services/replicateService';
import {
    ScriptIcon, MagicWandIcon, PdfIcon, UserCircleIcon, LandscapeIcon,
    FilmIcon, CameraIcon, ListIcon, GridIcon, EditIcon, PaletteIcon, BrushIcon, ClipboardCheckIcon, SparklesIcon, BrainIcon, ApertureIcon, BoxIcon, PlayIcon, FolderIcon
} from '../components/icons';
import { parsePdfScript } from '../services/pdfParsingService';
import { getBase64FromUrl, fileToBase64, getVideoDuration } from '../utils/helpers';
import { STYLE_PRESETS } from '../constants';
import SketchCanvas from '../components/SketchCanvas';

interface ProjectHubWorkspaceProps {
  storyBible: StoryBible;
  setStoryBible: (bible: StoryBible) => void;
  shotPrompts: ShotPrompt[];
  setShotPrompts: React.Dispatch<React.SetStateAction<ShotPrompt[]>>;
  onRoughCutReady: (newMedia: MediaItem[]) => void;
  apiKeyReady: boolean;
  setApiKeyReady: (isReady: boolean) => void;
  setMediaItems: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  references: ReferenceItem[];
  setReferences: React.Dispatch<React.SetStateAction<ReferenceItem[]>>;
  recentProjects: RecentProject[];
  onOpenRecentProject: (path: string) => void;
  onOpenProjectPicker: () => void;
}

type ProductionPhase = 'library' | 'script' | 'concept' | 'storyboard' | 'filming' | 'review';
type AspectRatioOption = '16:9' | '9:16' | '4:3' | '3:4' | '1:1' | '2.39:1';
type ModelAspectRatio = '16:9' | '9:16' | '4:3' | '3:4' | '1:1';
type CameraPreset = { id: string; label: string; prompt: string };
type LensPreset = { id: string; label: string; prompt: string; aspectRatioOverride?: AspectRatioOption; aspectRatioHint?: string };
type ReferenceSuggestion = { type: 'character' | 'environment' | 'product' | 'prop'; name: string; description: string };

const CINEMASCOPE_RATIO = 2.39;
const PHOTOREALISM_HINT = 'realistic lighting, natural textures, real-world detail, lifelike skin tones, no illustration, no CGI';

const isPhotorealisticStyle = (style: string) => /photo\s*real|photoreal/i.test(style);
const buildStylePrompt = (style: string) => {
    const clean = style.trim();
    if (!clean) return '';
    if (isPhotorealisticStyle(clean)) {
        return `${clean}, ${PHOTOREALISM_HINT}`;
    }
    return clean;
};

const resolveModelAspectRatio = (ratio: AspectRatioOption): ModelAspectRatio => (
    ratio === '2.39:1' ? '16:9' : ratio
);

const cropImageToAspectRatio = async (url: string, targetRatio: number): Promise<string> => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        const srcWidth = bitmap.width;
        const srcHeight = bitmap.height;
        const srcRatio = srcWidth / srcHeight;

        if (Math.abs(srcRatio - targetRatio) < 0.01) {
            bitmap.close();
            return url;
        }

        let cropWidth = srcWidth;
        let cropHeight = srcHeight;
        let sx = 0;
        let sy = 0;

        if (srcRatio > targetRatio) {
            cropWidth = Math.round(srcHeight * targetRatio);
            sx = Math.round((srcWidth - cropWidth) / 2);
        } else {
            cropHeight = Math.round(srcWidth / targetRatio);
            sy = Math.round((srcHeight - cropHeight) / 2);
        }

        const canvas = document.createElement('canvas');
        canvas.width = cropWidth;
        canvas.height = cropHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            bitmap.close();
            return url;
        }
        ctx.drawImage(bitmap, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        bitmap.close();

        const croppedBlob = await new Promise<Blob>((resolve) => {
            canvas.toBlob((result) => resolve(result || blob), blob.type || 'image/jpeg', 0.95);
        });
        return URL.createObjectURL(croppedBlob);
    } catch (error) {
        console.warn('Aspect ratio crop failed, using original image.', error);
        return url;
    }
};

const applyCinemascopeCrop = async (media: MediaItem, aspectRatio: AspectRatioOption): Promise<MediaItem> => {
    if (aspectRatio !== '2.39:1') return media;
    const croppedUrl = await cropImageToAspectRatio(media.url, CINEMASCOPE_RATIO);
    return { ...media, url: croppedUrl };
};

const CAMERA_PRESETS: CameraPreset[] = [
    { id: 'auto', label: 'Auto (No Camera Hint)', prompt: '' },
    { id: 'arri-alexa35', label: 'ARRI Alexa 35', prompt: 'shot on ARRI Alexa 35, cinematic digital, high dynamic range' },
    { id: 'red-vraptor', label: 'RED V-Raptor 8K', prompt: 'shot on RED V-Raptor 8K, ultra-detailed, crisp' },
    { id: 'sony-venice2', label: 'Sony Venice 2', prompt: 'shot on Sony Venice 2, rich cinematic color' },
    { id: 'blackmagic-6k', label: 'Blackmagic 6K', prompt: 'shot on Blackmagic 6K, filmic, Super 35' },
    { id: 'film-35mm', label: '35mm Film', prompt: 'shot on 35mm film, subtle grain, halation' },
    { id: 'film-16mm', label: '16mm Film', prompt: 'shot on 16mm film, visible grain, organic texture' },
    { id: 'imax-70mm', label: 'IMAX 70mm', prompt: 'shot on IMAX 70mm, large format, ultra clean detail' },
    { id: 'iphone-15', label: 'iPhone 15 Pro', prompt: 'shot on iPhone 15 Pro, handheld, modern mobile look' },
];

const LENS_PRESETS: LensPreset[] = [
    { id: 'auto', label: 'Auto (No Lens Hint)', prompt: '' },
    { id: '14mm', label: '14mm Ultra Wide', prompt: '14mm ultra-wide lens, dramatic perspective' },
    { id: '24mm', label: '24mm Wide', prompt: '24mm wide lens, expansive field of view' },
    { id: '35mm', label: '35mm', prompt: '35mm lens, natural perspective' },
    { id: '50mm', label: '50mm', prompt: '50mm standard lens, balanced framing' },
    { id: '85mm', label: '85mm Portrait', prompt: '85mm portrait lens, soft background separation' },
    { id: '135mm', label: '135mm Telephoto', prompt: '135mm telephoto lens, compressed perspective' },
    {
        id: 'anamorphic-40',
        label: '40mm Anamorphic 2x',
        prompt: '40mm anamorphic lens, oval bokeh, cinematic flares',
        aspectRatioOverride: '2.39:1',
        aspectRatioHint: 'cinemascope 2.39:1, anamorphic de-squeezed, widescreen framing'
    },
    { id: 'tilt-shift-45', label: '45mm Tilt-Shift', prompt: '45mm tilt-shift lens, selective focus' },
    { id: 'probe-24', label: '24mm Probe Macro', prompt: '24mm probe lens, macro close-up, deep focus' },
  { id: 'vintage-58', label: '58mm Vintage', prompt: '58mm vintage lens, swirly bokeh, dreamy highlights' },
];

const CAMERA_MOVEMENT_PRESETS = [
  { id: 'none', label: 'No Movement', prompt: '' },
  { id: 'zoom-in', label: 'Zoom In', prompt: 'slow zoom in' },
  { id: 'zoom-out', label: 'Zoom Out', prompt: 'slow zoom out' },
  { id: 'pan-left', label: 'Pan Left', prompt: 'smooth pan left' },
  { id: 'pan-right', label: 'Pan Right', prompt: 'smooth pan right' },
  { id: 'pan-up', label: 'Pan Up', prompt: 'smooth pan up' },
  { id: 'pan-down', label: 'Pan Down', prompt: 'smooth pan down' },
  { id: 'tilt-up', label: 'Tilt Up', prompt: 'gentle tilt up' },
  { id: 'tilt-down', label: 'Tilt Down', prompt: 'gentle tilt down' },
  { id: 'dolly-in', label: 'Dolly In', prompt: 'slow dolly in' },
  { id: 'dolly-out', label: 'Dolly Out', prompt: 'slow dolly out' },
  { id: 'truck-left', label: 'Truck Left', prompt: 'camera truck left' },
  { id: 'truck-right', label: 'Truck Right', prompt: 'camera truck right' },
  { id: 'orbit', label: 'Orbit', prompt: 'slow orbital move around subject' },
  { id: 'handheld', label: 'Handheld', prompt: 'handheld camera, subtle micro jitters' },
  { id: 'camera-shake', label: 'Camera Shake', prompt: 'noticeable camera shake, impact vibration' },
];

type PosePreset = {
    id: string;
    label: string;
    joints: Record<string, { x: number; y: number }>;
    links: Array<[string, string]>;
};

const POSE_PRESETS: PosePreset[] = [
    {
        id: 'hero-stand',
        label: 'Hero Stand',
        joints: {
            head: { x: 0.5, y: 0.16 },
            neck: { x: 0.5, y: 0.26 },
            hip: { x: 0.5, y: 0.52 },
            lShoulder: { x: 0.42, y: 0.3 },
            rShoulder: { x: 0.58, y: 0.3 },
            lElbow: { x: 0.36, y: 0.42 },
            rElbow: { x: 0.64, y: 0.42 },
            lWrist: { x: 0.32, y: 0.55 },
            rWrist: { x: 0.68, y: 0.55 },
            lKnee: { x: 0.45, y: 0.72 },
            rKnee: { x: 0.55, y: 0.72 },
            lAnkle: { x: 0.43, y: 0.92 },
            rAnkle: { x: 0.57, y: 0.92 },
        },
        links: [
            ['head', 'neck'],
            ['neck', 'lShoulder'],
            ['neck', 'rShoulder'],
            ['lShoulder', 'lElbow'],
            ['lElbow', 'lWrist'],
            ['rShoulder', 'rElbow'],
            ['rElbow', 'rWrist'],
            ['neck', 'hip'],
            ['hip', 'lKnee'],
            ['hip', 'rKnee'],
            ['lKnee', 'lAnkle'],
            ['rKnee', 'rAnkle'],
        ],
    },
    {
        id: 'walk-cycle',
        label: 'Walk Cycle',
        joints: {
            head: { x: 0.5, y: 0.18 },
            neck: { x: 0.5, y: 0.28 },
            hip: { x: 0.5, y: 0.54 },
            lShoulder: { x: 0.42, y: 0.32 },
            rShoulder: { x: 0.58, y: 0.32 },
            lElbow: { x: 0.36, y: 0.46 },
            rElbow: { x: 0.66, y: 0.42 },
            lWrist: { x: 0.32, y: 0.6 },
            rWrist: { x: 0.7, y: 0.52 },
            lKnee: { x: 0.42, y: 0.7 },
            rKnee: { x: 0.6, y: 0.64 },
            lAnkle: { x: 0.34, y: 0.9 },
            rAnkle: { x: 0.66, y: 0.85 },
        },
        links: [
            ['head', 'neck'],
            ['neck', 'lShoulder'],
            ['neck', 'rShoulder'],
            ['lShoulder', 'lElbow'],
            ['lElbow', 'lWrist'],
            ['rShoulder', 'rElbow'],
            ['rElbow', 'rWrist'],
            ['neck', 'hip'],
            ['hip', 'lKnee'],
            ['hip', 'rKnee'],
            ['lKnee', 'lAnkle'],
            ['rKnee', 'rAnkle'],
        ],
    },
    {
        id: 'seated',
        label: 'Seated',
        joints: {
            head: { x: 0.5, y: 0.22 },
            neck: { x: 0.5, y: 0.32 },
            hip: { x: 0.5, y: 0.6 },
            lShoulder: { x: 0.42, y: 0.36 },
            rShoulder: { x: 0.58, y: 0.36 },
            lElbow: { x: 0.36, y: 0.5 },
            rElbow: { x: 0.64, y: 0.5 },
            lWrist: { x: 0.34, y: 0.64 },
            rWrist: { x: 0.66, y: 0.64 },
            lKnee: { x: 0.42, y: 0.72 },
            rKnee: { x: 0.58, y: 0.72 },
            lAnkle: { x: 0.52, y: 0.86 },
            rAnkle: { x: 0.66, y: 0.86 },
        },
        links: [
            ['head', 'neck'],
            ['neck', 'lShoulder'],
            ['neck', 'rShoulder'],
            ['lShoulder', 'lElbow'],
            ['lElbow', 'lWrist'],
            ['rShoulder', 'rElbow'],
            ['rElbow', 'rWrist'],
            ['neck', 'hip'],
            ['hip', 'lKnee'],
            ['hip', 'rKnee'],
            ['lKnee', 'lAnkle'],
            ['rKnee', 'rAnkle'],
        ],
    },
];

const CHARACTER_BACKGROUND_OPTIONS = [
    { value: 'auto', label: 'Auto', prompt: '' },
    { value: 'white', label: 'White Studio', prompt: 'clean white studio background, seamless backdrop' },
    { value: 'black', label: 'Black Studio', prompt: 'deep black studio background, low spill' },
    { value: 'green', label: 'Green Screen', prompt: 'green screen background, chroma key' },
    { value: 'natural', label: 'Natural Environment', prompt: 'natural background that matches the scene environment' },
];

const CHARACTER_PERSPECTIVE_OPTIONS = [
    { value: 'auto', label: 'Auto', prompt: '' },
    { value: 'close_up', label: 'Close-up (Face)', prompt: 'tight close-up portrait of face' },
    { value: 'full_body', label: 'Full Body', prompt: 'full body shot, head to toe framing' },
    { value: 'side', label: 'Side Shot', prompt: 'side angle view, 3/4 profile' },
    { value: 'profile_full', label: 'Profile Full Body', prompt: 'full body profile shot' },
    { value: 'back', label: 'Back Shot', prompt: 'back view, rear angle' },
];

const ENVIRONMENT_TIME_OPTIONS = [
    { value: 'auto', label: 'Auto', prompt: '' },
    { value: 'day', label: 'Day', prompt: 'daytime lighting, sun overhead' },
    { value: 'night', label: 'Night', prompt: 'nighttime lighting, moody shadows' },
    { value: 'sunset', label: 'Sunset', prompt: 'golden hour sunset light' },
    { value: 'sunrise', label: 'Sunrise', prompt: 'soft sunrise light' },
];

const ASPECT_RATIO_OPTIONS: Array<{ value: AspectRatioOption; label: string; icon: { w: number; h: number } }> = [
    { value: '16:9', label: '16:9', icon: { w: 22, h: 12 } },
    { value: '9:16', label: '9:16', icon: { w: 10, h: 18 } },
    { value: '4:3', label: '4:3', icon: { w: 18, h: 14 } },
    { value: '3:4', label: '3:4', icon: { w: 14, h: 18 } },
    { value: '1:1', label: '1:1', icon: { w: 14, h: 14 } },
    { value: '2.39:1', label: '2.39', icon: { w: 24, h: 10 } },
];

const CONTEXT_TAG_OPTIONS = [
    { value: 'lighting', label: 'Lighting' },
    { value: 'wardrobe', label: 'Wardrobe' },
    { value: 'props', label: 'Props' },
    { value: 'other', label: 'Other' },
];

const getOptionPrompt = (options: { value: string; prompt: string }[], value?: string) => {
    return options.find(option => option.value === value)?.prompt || '';
};

const composeReferencePrompt = (reference: ReferenceItem) => {
    const basePrompt = reference.prompt || reference.description || reference.name;
    const extras: string[] = [];
    if (reference.type === 'character') {
        extras.push(getOptionPrompt(CHARACTER_BACKGROUND_OPTIONS, reference.characterBackground));
        extras.push(getOptionPrompt(CHARACTER_PERSPECTIVE_OPTIONS, reference.characterPerspective));
    }
    if (reference.type === 'environment') {
        extras.push(getOptionPrompt(ENVIRONMENT_TIME_OPTIONS, reference.environmentTimeOfDay));
    }
    return [basePrompt, ...extras].filter(Boolean).join('. ');
};

const convertBlobUrlToDataUrl = async (url: string) => {
    if (!url.startsWith('blob:')) return url;
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || url));
            reader.onerror = () => resolve(url);
            reader.readAsDataURL(blob);
        });
    } catch {
        return url;
    }
};

const stabilizeReferenceImageUrl = async (reference: ReferenceItem, url: string) => {
    if (reference.type !== 'product') return url;
    return convertBlobUrlToDataUrl(url);
};

const ReferenceCard: React.FC<{
    reference: ReferenceItem;
    onUpdate: (id: string, updates: Partial<ReferenceItem>) => void;
    onGenerateDetails: (id: string) => void;
    onRegenerateImage: (id: string) => void;
    onUpload: (id: string, file: File) => void;
    onRemove: (id: string) => void;
    onViewFull: (url: string, title?: string) => void;
    extraContent?: React.ReactNode;
}> = ({ reference, onUpdate, onGenerateDetails, onRegenerateImage, onUpload, onRemove, onViewFull, extraContent }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleUploadClick = () => fileInputRef.current?.click();
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) onUpload(reference.id, e.target.files[0]);
    };

    const getIcon = () => {
        switch (reference.type) {
            case 'character': return <UserCircleIcon className="w-12 h-12 opacity-20 mb-2"/>;
            case 'environment': return <LandscapeIcon className="w-12 h-12 opacity-20 mb-2"/>;
            case 'product': return <BoxIcon className="w-12 h-12 opacity-20 mb-2"/>;
            case 'prop': return <BoxIcon className="w-12 h-12 opacity-20 mb-2"/>;
            default: return <UserCircleIcon className="w-12 h-12 opacity-20 mb-2"/>;
        }
    };

    return (
        <div className="relative group bg-gray-800 rounded-xl overflow-hidden border border-gray-700 shadow-lg transition-all hover:border-indigo-500/50 hover:shadow-indigo-500/10 flex flex-col h-full">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />

            <div className="aspect-[3/4] relative bg-gray-900 flex-shrink-0">
                {reference.imageUrl ? (
                    <img src={reference.imageUrl} className="w-full h-full object-cover" alt={reference.name}/>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 p-4 text-center">
                        {getIcon()}
                        <span className="text-xs font-medium uppercase tracking-wider opacity-50">{reference.type}</span>
                         <button
                            onClick={() => onRegenerateImage(reference.id)}
                            className="mt-4 bg-gray-700 hover:bg-indigo-600 text-white text-xs font-bold py-2 px-4 rounded-full flex items-center gap-2 transition-all"
                        >
                            <MagicWandIcon className="w-3 h-3"/>
                            Generate
                        </button>
                    </div>
                )}

                {reference.isGenerating && (
                    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center backdrop-blur-sm z-10">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400 mb-2"></div>
                        <span className="text-xs text-indigo-300 animate-pulse">Generating...</span>
                    </div>
                )}

                <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/80 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-200 flex flex-col p-3 z-20">
                     <div className="flex justify-end">
                         <button onClick={() => onRemove(reference.id)} className="p-1.5 bg-red-500/20 hover:bg-red-500 text-red-300 hover:text-white rounded-full transition-colors" title="Remove">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                         </button>
                    </div>
                    <div className="mt-auto space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => onGenerateDetails(reference.id)} className="bg-gray-700 hover:bg-indigo-600 text-white text-xs py-2 rounded font-medium transition-colors">
                                Auto-Prompt
                            </button>
                            <button onClick={handleUploadClick} className="bg-gray-700 hover:bg-indigo-600 text-white text-xs py-2 rounded font-medium transition-colors">
                                Upload
                            </button>
                        </div>
                         {reference.imageUrl && (
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => onViewFull(reference.imageUrl!, reference.name)} className="bg-gray-700 hover:bg-gray-600 text-white text-xs py-2 rounded font-bold">
                                    Full View
                                </button>
                                <button onClick={() => onRegenerateImage(reference.id)} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-2 rounded font-bold flex items-center justify-center gap-2">
                                    <MagicWandIcon className="w-3 h-3"/> Re-roll
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="p-3 bg-gray-800 flex flex-col gap-2 flex-grow">
                 <input
                    type="text"
                    value={reference.name}
                    onChange={e => onUpdate(reference.id, { name: e.target.value })}
                    className="bg-transparent font-bold text-sm w-full text-white focus:outline-none focus:border-b focus:border-indigo-500 placeholder-gray-500"
                    placeholder="Name"
                />
                <textarea
                    value={reference.description}
                    onChange={e => onUpdate(reference.id, { description: e.target.value })}
                    placeholder="Brief description..."
                    rows={2}
                    className="w-full bg-gray-900/50 text-gray-400 text-xs p-2 rounded border border-gray-700 focus:border-indigo-500 focus:ring-0 resize-none flex-grow"
                />
                {extraContent && (
                    <div className="pt-2 border-t border-gray-700/60">
                        {extraContent}
                    </div>
                )}
            </div>
        </div>
    );
};

const AspectRatioPicker: React.FC<{
    value: AspectRatioOption;
    onChange: (value: AspectRatioOption) => void;
}> = ({ value, onChange }) => (
    <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-lg border border-gray-700">
        {ASPECT_RATIO_OPTIONS.map(option => {
            const isActive = value === option.value;
            return (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    aria-pressed={isActive}
                    title={option.value === '2.39:1' ? '2.39:1 Cinemascope' : option.label}
                    className={`px-2 py-1 rounded transition-colors ${isActive ? 'bg-indigo-600/80 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                >
                    <span className="flex items-center gap-1">
                        <span
                            className={`inline-flex items-center justify-center border rounded-sm ${isActive ? 'border-white/80 bg-white/10' : 'border-gray-500/70 bg-gray-900/60'}`}
                            style={{ width: option.icon.w, height: option.icon.h }}
                        />
                        <span className={`text-[10px] font-semibold ${isActive ? 'text-white' : 'text-gray-400'}`}>{option.label}</span>
                    </span>
                </button>
            );
        })}
    </div>
);

const FullResModal: React.FC<{
    url: string;
    title?: string;
    onClose: () => void;
}> = ({ url, title, onClose }) => (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
        <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                <div className="text-sm font-bold text-white">{title || 'Full View'}</div>
                <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold">&times;</button>
            </div>
            <div className="bg-black p-4 overflow-auto max-h-[80vh]">
                <img src={url} className="w-full h-auto object-contain" alt={title || 'Full View'} />
            </div>
        </div>
    </div>
);

const ShotInpaintModal: React.FC<{
    shot: ShotPrompt | null;
    onClose: () => void;
    onApply: (url: string, shotId: number) => void;
}> = ({ shot, onClose, onApply }) => {
    const baseCanvasRef = useRef<HTMLCanvasElement>(null);
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const [maskMode, setMaskMode] = useState<'paint' | 'erase'>('paint');
    const [brushSize, setBrushSize] = useState(28);
    const [maskHasPaint, setMaskHasPaint] = useState(false);
    const [inpaintPrompt, setInpaintPrompt] = useState('');
    const [inpaintModel, setInpaintModel] = useState<'nano-banana-pro' | 'flux-2-pro'>('nano-banana-pro');
    const [resolution, setResolution] = useState<'1K' | '2K' | '4K' | 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP'>('2K');
    const [isInpainting, setIsInpainting] = useState(false);
    const [status, setStatus] = useState('');
    const [canvasSize, setCanvasSize] = useState({ width: 16, height: 9 });
    const isDrawingRef = useRef(false);

    useEffect(() => {
        setResolution(inpaintModel === 'nano-banana-pro' ? '2K' : 'match_input_image');
    }, [inpaintModel]);

    const clearMask = () => {
        const maskCanvas = maskCanvasRef.current;
        const ctx = maskCanvas?.getContext('2d');
        if (!maskCanvas || !ctx) return;
        ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        setMaskHasPaint(false);
    };

    const loadImageToCanvas = (url: string) => {
        const img = new Image();
        img.onload = () => {
            const baseCanvas = baseCanvasRef.current;
            const maskCanvas = maskCanvasRef.current;
            if (!baseCanvas || !maskCanvas) return;
            const ctx = baseCanvas.getContext('2d');
            if (!ctx) return;
            baseCanvas.width = img.width;
            baseCanvas.height = img.height;
            ctx.clearRect(0, 0, img.width, img.height);
            ctx.drawImage(img, 0, 0);
            maskCanvas.width = img.width;
            maskCanvas.height = img.height;
            setCanvasSize({ width: img.width, height: img.height });
            clearMask();
        };
        img.src = url;
    };

    useEffect(() => {
        if (shot?.imageUrl) {
            loadImageToCanvas(shot.imageUrl);
            setStatus('');
        }
    }, [shot?.imageUrl]);

    if (!shot || !shot.imageUrl) return null;

    const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = maskCanvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = maskCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        const point = getCanvasPoint(event);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
        ctx.lineWidth = brushSize;
        ctx.globalCompositeOperation = maskMode === 'erase' ? 'destination-out' : 'source-over';
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        setMaskHasPaint(true);
        isDrawingRef.current = true;
        canvas.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current) return;
        const canvas = maskCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) return;
        const point = getCanvasPoint(event);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        setMaskHasPaint(true);
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current) return;
        isDrawingRef.current = false;
        maskCanvasRef.current?.releasePointerCapture(event.pointerId);
    };

    const buildMaskedImageDataUrl = () => {
        const baseCanvas = baseCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        if (!baseCanvas || !maskCanvas) return null;
        const offscreen = document.createElement('canvas');
        offscreen.width = baseCanvas.width;
        offscreen.height = baseCanvas.height;
        const ctx = offscreen.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(baseCanvas, 0, 0);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(maskCanvas, 0, 0);
        return offscreen.toDataURL('image/png');
    };

    const handleInpaint = async () => {
        if (!maskHasPaint) {
            setStatus('Paint a mask before inpainting.');
            return;
        }
        const maskedDataUrl = buildMaskedImageDataUrl();
        if (!maskedDataUrl) return;
        setIsInpainting(true);
        setStatus('Inpainting...');
        try {
            const prompt = inpaintPrompt || 'Reconstruct the masked area seamlessly.';
            const item = inpaintModel === 'nano-banana-pro'
                ? await inpaintWithNanoBanana(prompt, maskedDataUrl, resolution as '1K' | '2K' | '4K')
                : await inpaintWithFlux2Pro(prompt, maskedDataUrl, resolution as 'match_input_image' | '0.5 MP' | '1 MP' | '2 MP' | '4 MP');
            onApply(item.url, shot.shot);
            loadImageToCanvas(item.url);
            setStatus('Inpaint applied to shot.');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setStatus(`Inpaint failed: ${msg}`);
        } finally {
            setIsInpainting(false);
        }
    };

    const aspectRatioStyle = canvasSize.width && canvasSize.height ? { aspectRatio: `${canvasSize.width} / ${canvasSize.height}` } : undefined;

    return (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden">
                <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white">Inpaint Shot {shot.shot}</h3>
                        <p className="text-xs text-gray-400">Paint a mask over the area you want to replace.</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold">&times;</button>
                </div>
                <div className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
                    <div className="bg-black rounded-xl border border-gray-800 p-3">
                        <div className="relative w-full" style={aspectRatioStyle}>
                            <canvas ref={baseCanvasRef} className="absolute inset-0 w-full h-full rounded-lg" />
                            <canvas
                                ref={maskCanvasRef}
                                className="absolute inset-0 w-full h-full rounded-lg cursor-crosshair"
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                                onPointerLeave={handlePointerUp}
                            />
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <button onClick={() => setMaskMode('paint')} className={`px-3 py-2 rounded-lg text-xs font-bold ${maskMode === 'paint' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                                Paint
                            </button>
                            <button onClick={() => setMaskMode('erase')} className={`px-3 py-2 rounded-lg text-xs font-bold ${maskMode === 'erase' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                                Erase
                            </button>
                            <button onClick={clearMask} className="px-3 py-2 rounded-lg text-xs font-bold bg-gray-800 text-gray-300 hover:bg-gray-700">
                                Clear Mask
                            </button>
                        </div>
                        <div>
                            <label className="text-[10px] uppercase tracking-wide text-gray-500">Brush Size</label>
                            <input
                                type="range"
                                min={6}
                                max={120}
                                value={brushSize}
                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] uppercase tracking-wide text-gray-500">Prompt</label>
                            <textarea
                                value={inpaintPrompt}
                                onChange={(e) => setInpaintPrompt(e.target.value)}
                                className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-indigo-500"
                                rows={3}
                                placeholder="Replace with..."
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[10px] uppercase tracking-wide text-gray-500">Model</label>
                                <select
                                    value={inpaintModel}
                                    onChange={(e) => setInpaintModel(e.target.value as 'nano-banana-pro' | 'flux-2-pro')}
                                    className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-indigo-500"
                                >
                                    <option value="nano-banana-pro">Nano Banana Pro</option>
                                    <option value="flux-2-pro">Flux 2 Pro</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wide text-gray-500">Resolution</label>
                                <select
                                    value={resolution}
                                    onChange={(e) => setResolution(e.target.value as any)}
                                    className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-indigo-500"
                                >
                                    {inpaintModel === 'nano-banana-pro' ? (
                                        <>
                                            <option value="1K">1K</option>
                                            <option value="2K">2K</option>
                                            <option value="4K">4K</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value="match_input_image">Match Input</option>
                                            <option value="0.5 MP">0.5 MP</option>
                                            <option value="1 MP">1 MP</option>
                                            <option value="2 MP">2 MP</option>
                                            <option value="4 MP">4 MP</option>
                                        </>
                                    )}
                                </select>
                            </div>
                        </div>
                        <button
                            onClick={handleInpaint}
                            disabled={!maskHasPaint || isInpainting}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white font-bold py-2 rounded-lg text-sm"
                        >
                            {isInpainting ? 'Inpainting...' : 'Run Inpaint'}
                        </button>
                        {status && <p className="text-xs text-gray-400">{status}</p>}
                    </div>
                </div>
            </div>
        </div>
    );
};

const ProjectHubWorkspace: React.FC<ProjectHubWorkspaceProps> = ({ storyBible, setStoryBible, shotPrompts, setShotPrompts, onRoughCutReady, setMediaItems, references, setReferences, setApiKeyReady, recentProjects, onOpenRecentProject, onOpenProjectPicker }) => {
  const [activePhase, setActivePhase] = useState<ProductionPhase>('script');
  const [isLoading, setIsLoading] = useState<string | boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptInputMode, setScriptInputMode] = useState<'paste' | 'generate'>('paste');
  const [scriptGenerationPrompt, setScriptGenerationPrompt] = useState('');
  const [scriptLength, setScriptLength] = useState<ScriptLength>('trailer');
  const [referenceImageModel, setReferenceImageModel] = useState<'imagen' | 'nano' | 'gemini-pro' | 'z-turbo' | 'flux' | 'seedream' | 'qwen' | 'qwen-2512'>('imagen');
  const [videoModel, setVideoModel] = useState<'veo-3.1-fast-generate-preview' | 'veo-3.1-generate-preview' | 'wan-2.2-i2v-fast' | 'ltx-2-fast' | 'kling-v2.5-turbo-pro' | 'kling-v2.6-motion-control'>('veo-3.1-fast-generate-preview');
  const [referenceAspectRatio, setReferenceAspectRatio] = useState<AspectRatioOption>('16:9');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');
  const seedreamSize = imageSize === '4K' ? '4K' : '2K';
  const [visualStyle, setVisualStyle] = useState('');
  const [showPresets, setShowPresets] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<ReviewFeedback | null>(null);
  const [cameraPresetId, setCameraPresetId] = useState('auto');
  const [lensPresetId, setLensPresetId] = useState('auto');
  const [activeInpaintShotId, setActiveInpaintShotId] = useState<number | null>(null);
  const [extraShotIdea, setExtraShotIdea] = useState('');
  const [extraShotInsertAfter, setExtraShotInsertAfter] = useState<number>(1);
  const [extraShotSuggestions, setExtraShotSuggestions] = useState<ReferenceSuggestion[]>([]);
  const [isGeneratingExtraShot, setIsGeneratingExtraShot] = useState(false);
  const [fullResView, setFullResView] = useState<{ url: string; title?: string } | null>(null);
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [voiceListStatus, setVoiceListStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [voiceListError, setVoiceListError] = useState<string | null>(null);
  const stylePrompt = buildStylePrompt(visualStyle);
  const selectedLensPreset = LENS_PRESETS.find(preset => preset.id === lensPresetId);
  const activeInpaintShot = activeInpaintShotId
      ? shotPrompts.find(s => s.shot === activeInpaintShotId) || null
      : null;

  // Interactive Script Editing States
  const [selectedScriptText, setSelectedScriptText] = useState('');
  const [editInstruction, setEditInstruction] = useState('');
  const [showEditPopup, setShowEditPopup] = useState(false);
  const [plotSuggestions, setPlotSuggestions] = useState<string[]>([]);
  const [styleSuggestions, setStyleSuggestions] = useState<string[]>([]);

  const scriptFileInputRef = useRef<HTMLInputElement>(null);
  const scriptTextAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
      if (shotPrompts.length === 0) return;
      setExtraShotInsertAfter(prev => {
          if (!prev || prev < 1) return shotPrompts.length;
          if (prev > shotPrompts.length) return shotPrompts.length;
          return prev;
      });
  }, [shotPrompts.length]);

  // Helpers
  const updateBible = (updates: Partial<StoryBible>) => setStoryBible({ ...storyBible, ...updates });
  const getCameraMovementPreset = (presetId?: string) => CAMERA_MOVEMENT_PRESETS.find(preset => preset.id === presetId);
  const applyCameraMovementToPrompt = (prompt: string, movementPrompt: string) => {
      const cleanMovement = movementPrompt.trim();
      if (!cleanMovement) return prompt.trim();
      const base = prompt.trim();
      const lowerBase = base.toLowerCase();
      const lowerMovement = cleanMovement.toLowerCase();
      if (lowerBase.includes(lowerMovement)) return base;
      if (!base) return `Camera movement: ${cleanMovement}.`;
      return `${base}\nCamera movement: ${cleanMovement}.`;
  };
  const renderPosePreset = (preset: PosePreset, size: number = 512) => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = Math.max(2, Math.round(size * 0.012));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      preset.links.forEach(([from, to]) => {
          const start = preset.joints[from];
          const end = preset.joints[to];
          if (!start || !end) return;
          ctx.beginPath();
          ctx.moveTo(start.x * size, start.y * size);
          ctx.lineTo(end.x * size, end.y * size);
          ctx.stroke();
      });
      ctx.fillStyle = '#38bdf8';
      const radius = Math.max(3, Math.round(size * 0.015));
      Object.values(preset.joints).forEach(({ x, y }) => {
          ctx.beginPath();
          ctx.arc(x * size, y * size, radius, 0, Math.PI * 2);
          ctx.fill();
      });
      return canvas.toDataURL('image/png');
  };
  const getReferenceKey = (ref: { type: string; name: string }) => `${ref.type}:${ref.name.toLowerCase()}`;

  const addReferenceSuggestions = (items: ReferenceSuggestion[]) => {
      if (items.length === 0) return;
      const now = Date.now();
      setReferences(prev => {
          const existing = new Set(prev.map(ref => getReferenceKey(ref)));
          const additions = items
              .filter(item => !existing.has(getReferenceKey(item)))
              .map((item, index) => ({
                  id: `${item.type}-${now}-${index}`,
                  type: item.type,
                  name: item.name,
                  description: item.description,
                  prompt: '',
                  imageUrl: null,
                  isGenerating: false,
                  tags: []
              }));
          return additions.length > 0 ? [...prev, ...additions] : prev;
      });
      const addedKeys = new Set(items.map(item => getReferenceKey(item)));
      setExtraShotSuggestions(prev => prev.filter(item => !addedKeys.has(getReferenceKey(item))));
  };

  const handleError = (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('permission')) {
          setApiKeyReady(false);
      }
      setIsLoading(false);
  };

  const handleLoadElevenLabsVoices = async () => {
      setVoiceListStatus('loading');
      setVoiceListError(null);
      try {
          const voices = await fetchElevenLabsVoices();
          setElevenLabsVoices(voices);
          setVoiceListStatus('ready');
      } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setVoiceListStatus('error');
          setVoiceListError(msg);
      }
  };

  const getShotVoiceMatches = (shot: ShotPrompt) => {
      if (!shot.characters?.length) return [];
      const normalized = shot.characters.map(name => name.toLowerCase());
      return references.filter(ref => ref.type === 'character' && normalized.some(name => name.includes(ref.name.toLowerCase()) || ref.name.toLowerCase().includes(name)));
  };

  const resolveShotVoiceCharacter = (shot: ShotPrompt) => {
      if (shot.voiceCharacterId) {
          return references.find(ref => ref.id === shot.voiceCharacterId);
      }
      const matches = getShotVoiceMatches(shot);
      if (matches.length > 0) return matches[0];
      return references.find(ref => ref.type === 'character');
  };

  const handleGenerateShotVoiceover = async (shotNumber: number) => {
      const shot = shotPrompts.find(s => s.shot === shotNumber);
      if (!shot) return;
      const voiceText = shot.voiceoverText?.trim();
      if (!voiceText) {
          setError('Add voiceover text before generating audio.');
          return;
      }
      setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? { ...s, voiceoverIsGenerating: true } : s));
      try {
          const character = (shot.voiceChangerEnabled || shot.voiceCharacterId)
              ? resolveShotVoiceCharacter(shot)
              : undefined;
          const audioItem = await generateSpeechWithElevenLabs(voiceText, {
              voiceId: character?.elevenLabsVoiceId,
              modelId: character?.elevenLabsModelId,
              outputFormat: character?.elevenLabsOutputFormat,
          });
          const voiceLabel = character?.name ? `${character.name} Voiceover` : 'Voiceover';
          const namedItem = { ...audioItem, name: `Shot ${shotNumber} ${voiceLabel}` };
          setMediaItems(prev => [...prev, namedItem]);
          setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {
              ...s,
              voiceoverUrl: namedItem.url,
              voiceoverIsGenerating: false,
          } : s));
      } catch (e) {
          setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? { ...s, voiceoverIsGenerating: false } : s));
          handleError(e);
      }
  };

  const generateReferenceImage = async (prompt: string, aspectRatio: AspectRatioOption, baseImageUrl?: string): Promise<MediaItem> => {
      const modelAspectRatio = resolveModelAspectRatio(aspectRatio);
      let image: MediaItem;
      if (referenceImageModel === 'imagen') {
          image = await generateImageWithImagen(prompt, modelAspectRatio);
    } else if (referenceImageModel === 'gemini-pro') {
      image = await generateImageWithGemini3Pro(prompt, modelAspectRatio, imageSize);
    } else if (referenceImageModel === 'qwen-2512') {
      const baseImage = baseImageUrl ? await getBase64FromUrl(baseImageUrl) : undefined;
      image = await generateImageWithQwenImage(prompt, modelAspectRatio, baseImage);
    } else if (referenceImageModel === 'qwen') {
      if (!baseImageUrl) {
        throw new Error('Qwen 2511 requires a base image. Upload or generate an image first.');
      }
      const baseImage = await getBase64FromUrl(baseImageUrl);
      image = await editImageWithQwen(prompt, baseImage, { aspectRatio: modelAspectRatio });
      } else if (referenceImageModel === 'z-turbo') {
          image = await generateImageWithZTurbo(prompt, modelAspectRatio);
      } else if (referenceImageModel === 'flux') {
          image = await generateImageWithFlux(prompt, modelAspectRatio);
      } else if (referenceImageModel === 'seedream') {
          image = await generateImageWithSeedream(prompt, modelAspectRatio, seedreamSize);
      } else {
          image = await generateImageWithNano(prompt);
      }
      return await applyCinemascopeCrop(image, aspectRatio);
  };

  // --- Script Phase Logic ---
  const handleGenerateScript = async () => {
    if (!scriptGenerationPrompt.trim()) return setError("Please enter an idea.");
    setIsLoading('Writing Script (McKee & Campbell Mode)...');
    try {
        const generatedScript = await generateScript(scriptGenerationPrompt, scriptLength);
        updateBible({ script: generatedScript, title: scriptGenerationPrompt.slice(0, 30) });
        setScriptInputMode('paste');
        setIsLoading(false);
        // Auto-suggest styles after generation
        fetchStyleSuggestions(generatedScript);
    } catch (e) { handleError(e); }
  };

  const fetchStyleSuggestions = async (scriptText: string) => {
      try {
          const styles = await suggestVisualStyles(scriptText);
          setStyleSuggestions(styles);
      } catch (e) { console.error("Style suggestion failed", e); }
  };

  const handleScriptSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const target = e.target as HTMLTextAreaElement;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      if (start !== end) {
          setSelectedScriptText(target.value.substring(start, end));
          setShowEditPopup(true);
      } else {
          setShowEditPopup(false);
      }
  };

  const handleEditScriptSelection = async () => {
      if (!selectedScriptText || !editInstruction) return;
      setIsLoading("Rewriting selection...");
      try {
          const rewritten = await editScriptSelection(storyBible.script, selectedScriptText, editInstruction);
          const newScript = storyBible.script.replace(selectedScriptText, rewritten);
          updateBible({ script: newScript });
          setShowEditPopup(false);
          setEditInstruction('');
          setSelectedScriptText('');
      } catch (e) { handleError(e); } finally { setIsLoading(false); }
  };

  const handleSuggestNextBeats = async () => {
      setIsLoading("Brainstorming plot twists...");
      try {
          const suggestions = await suggestNextPlotPoints(storyBible.script);
          setPlotSuggestions(suggestions);
      } catch (e) { handleError(e); } finally { setIsLoading(false); }
  };

  const handleAppendBeat = (beat: string) => {
      const newScript = `${storyBible.script}\n\n[SUGGESTED BEAT]\n${beat}\n`;
      updateBible({ script: newScript });
      setPlotSuggestions([]);
  };

  const handleScriptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading('Reading Script...');
    try {
        let scriptContent = '';
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            setIsLoading('Parsing PDF...');
            scriptContent = await parsePdfScript(file);
        } else {
            scriptContent = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target?.result as string);
                reader.onerror = () => reject(new Error("Failed to read file"));
                reader.readAsText(file);
            });
        }
        updateBible({ script: scriptContent, title: file.name.replace(/\.[^/.]+$/, "") });
        fetchStyleSuggestions(scriptContent);
    } catch (err) { setError((err as Error).message); } finally { setIsLoading(false); }
  };

  const handleAnalyzeScript = async () => {
      if (!storyBible.script) return setError("No script to analyze.");
      setIsLoading("Analyzing Script for Breakdown...");
      try {
        const guidelines = await generateProductionGuidelines(storyBible);
        updateBible({ productionGuidelines: guidelines });

        const result = await analyzeScriptForReferences(storyBible.script);
        const newRefs: ReferenceItem[] = [
            ...result.characters.map((char, i) => ({ id: `char-${Date.now()}-${i}`, type: 'character' as const, name: char.name, description: char.description, prompt: '', imageUrl: null, isGenerating: false, tags: [] })),
            ...result.environments.map((env, i) => ({ id: `env-${Date.now()}-${i}`, type: 'environment' as const, name: env.name, description: env.description, prompt: '', imageUrl: null, isGenerating: false, tags: [] }))
        ];

        if (result.products) {
            newRefs.push(...result.products.map((prod, i) => ({ id: `prod-${Date.now()}-${i}`, type: 'product' as const, name: prod.name, description: prod.description, prompt: '', imageUrl: null, isGenerating: false, tags: [] })));
        }

        const filteredNewRefs = newRefs.filter(nr => !references.some(r => r.name.toLowerCase() === nr.name.toLowerCase()));
        setReferences(prev => [...prev, ...filteredNewRefs]);
        setActivePhase('concept');
        setIsLoading(false);
      } catch (e) { handleError(e); }
  };

  const addPreset = (preset: string) => {
      setVisualStyle(prev => {
          const cleanPreset = preset.replace(/,/g, ';');
          return prev ? `${prev}; ${cleanPreset}` : cleanPreset;
      });
  };

  // --- Concept Phase Logic ---
  const handleGenerateAllConcepts = async () => {
      setIsLoading("Generating Concept Art...");
      for (const ref of references) {
          if (ref.imageUrl) continue;
          try {
             let currentRef = ref;
             if (!currentRef.prompt) {
                 const { prompt, tags } = await generateReferenceDetails(
                     ref.type,
                     ref.name,
                     ref.description,
                     storyBible.script,
                     stylePrompt
                 );
                 currentRef = { ...currentRef, prompt: stylePrompt ? `${stylePrompt}. ${prompt}` : prompt, tags };
                 setReferences(prev => prev.map(r => r.id === ref.id ? currentRef : r));
             }
             if (referenceImageModel === 'qwen' && !currentRef.imageUrl) {
                 setError('Qwen 2511 needs a base image for concept generation. Upload a reference or pick another model.');
                 continue;
             }
             setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, isGenerating: true } : r));
             const imagePrompt = composeReferencePrompt(currentRef);
             const image = await generateReferenceImage(imagePrompt, referenceAspectRatio, currentRef.imageUrl || undefined);
             const stableUrl = await stabilizeReferenceImageUrl(currentRef, image.url);
             setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, imageUrl: stableUrl, isGenerating: false } : r));
          } catch (e) {
              console.error(e);
              setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, isGenerating: false } : r));
              handleError(e);
              break;
          }
      }
      setIsLoading(false);
  };

  const handleGenerateAllPrompts = async () => {
      setIsLoading("Writing prompts for all assets...");
      for (const ref of references) {
          if (!ref.prompt || ref.prompt === ref.description) {
              try {
                  const { prompt, tags } = await generateReferenceDetails(
                      ref.type,
                      ref.name,
                      ref.description,
                      storyBible.script,
                      stylePrompt
                  );
                  setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, prompt, tags } : r));
              } catch(e) { console.error(e); }
          }
      }
      setIsLoading(false);
  };

  const updateCharacterOutfit = (characterId: string, outfitId: string, updates: Partial<{ name: string; description?: string; prompt: string; imageUrl?: string; isGenerating?: boolean }>) => {
      setReferences(prev => prev.map(ref => {
          if (ref.id !== characterId) return ref;
          const outfits = (ref.outfits || []).map(outfit => (
              outfit.id === outfitId ? { ...outfit, ...updates } : outfit
          ));
          return { ...ref, outfits };
      }));
  };

  const generateOutfitImage = async (character: ReferenceItem, outfitPrompt: string) => {
      if (!character.imageUrl) throw new Error('Base character image is required.');
      const baseReference = await getBase64FromUrl(character.imageUrl);
      const modelAspectRatio = resolveModelAspectRatio(referenceAspectRatio);
      const outfitModel = (referenceImageModel === 'seedream' || referenceImageModel === 'gemini-pro' || referenceImageModel === 'nano')
          ? referenceImageModel
          : 'seedream';
      let imageMedia: MediaItem;
      if (outfitModel === 'seedream') {
          imageMedia = await generateImageWithSeedreamReferences(
              outfitPrompt,
              [baseReference],
              modelAspectRatio,
              seedreamSize
          );
      } else {
          const modelToUse = outfitModel === 'gemini-pro' ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
          imageMedia = await generateImageWithReferences(
              outfitPrompt,
              [baseReference],
              undefined,
              modelToUse,
              { aspectRatio: modelAspectRatio, imageSize }
          );
      }
      return applyCinemascopeCrop(imageMedia, referenceAspectRatio);
  };

  const handleGenerateCharacterProfile = async (characterId: string) => {
      const character = references.find(ref => ref.id === characterId);
      if (!character) return;
      setIsLoading(`Building profile for ${character.name}...`);
      try {
          const profile = await generateCharacterProfile({
              name: character.name,
              description: character.description || character.prompt,
              script: storyBible.script
          });
          setReferences(prev => prev.map(ref => ref.id === characterId ? { ...ref, ...profile } : ref));
      } catch (e) {
          handleError(e);
      } finally {
          setIsLoading(false);
      }
  };

  const handleGenerateCharacterOutfits = async (characterId: string) => {
      const character = references.find(ref => ref.id === characterId);
      if (!character) return;
      if (!character.imageUrl) {
          setError('Generate a base character image before creating outfits.');
          return;
      }
      setReferences(prev => prev.map(ref => ref.id === characterId ? { ...ref, isGeneratingOutfits: true } : ref));
      try {
          const basePrompt = composeReferencePrompt(character);
          const outfitPlan = await generateCharacterOutfitPlan({
              name: character.name,
              description: character.description || character.prompt,
              basePrompt,
              script: storyBible.script
          });

          const outfits = outfitPlan.map((outfit) => ({
              id: `outfit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              name: outfit.name,
              description: outfit.description,
              prompt: outfit.prompt,
              imageUrl: undefined,
              isGenerating: true
          }));

          setReferences(prev => prev.map(ref => ref.id === characterId ? { ...ref, outfits } : ref));

          for (const outfit of outfits) {
              try {
                  const outfitPrompt = [
                      stylePrompt,
                      outfit.prompt,
                      basePrompt,
                      character.characterPerspective && character.characterPerspective !== 'auto' ? '' : 'full body shot to show outfit',
                      'same character identity and face, consistent hair and body type'
                  ].filter(Boolean).join('. ');

                  const imageMedia = await generateOutfitImage(character, outfitPrompt);
                  updateCharacterOutfit(characterId, outfit.id, { imageUrl: imageMedia.url, isGenerating: false });
              } catch (error) {
                  updateCharacterOutfit(characterId, outfit.id, { isGenerating: false });
                  console.error('Outfit generation failed:', error);
              }
          }
      } catch (e) {
          handleError(e);
      } finally {
          setReferences(prev => prev.map(ref => ref.id === characterId ? { ...ref, isGeneratingOutfits: false } : ref));
      }
  };

  const handleRegenerateOutfitImage = async (characterId: string, outfitId: string) => {
      const character = references.find(ref => ref.id === characterId);
      const outfit = character?.outfits?.find(item => item.id === outfitId);
      if (!character || !outfit) return;
      updateCharacterOutfit(characterId, outfitId, { isGenerating: true });
      try {
          const basePrompt = composeReferencePrompt(character);
          const outfitPrompt = [
              stylePrompt,
              outfit.prompt,
              basePrompt,
              character.characterPerspective && character.characterPerspective !== 'auto' ? '' : 'full body shot to show outfit',
              'same character identity and face, consistent hair and body type'
          ].filter(Boolean).join('. ');
          const imageMedia = await generateOutfitImage(character, outfitPrompt);
          updateCharacterOutfit(characterId, outfitId, { imageUrl: imageMedia.url, isGenerating: false });
      } catch (error) {
          updateCharacterOutfit(characterId, outfitId, { isGenerating: false });
          console.error('Outfit regeneration failed:', error);
      }
  };

  // --- Storyboard Phase Logic ---
  const handleGenerateExtraShot = async () => {
      if (!storyBible.script) {
          setError("No script available for context.");
          return;
      }
      const idea = extraShotIdea.trim();
      if (!idea) {
          setError("Add a short idea or shot type first.");
          return;
      }
      if (isGeneratingExtraShot) return;

      const orderedShots = [...shotPrompts].sort((a, b) => a.shot - b.shot);
      const afterShot = orderedShots.find(s => s.shot === extraShotInsertAfter);
      const beforeShot = orderedShots.find(s => s.shot === extraShotInsertAfter + 1);

      setIsGeneratingExtraShot(true);
      setIsLoading("Generating extra shot...");
      try {
          const result = await generateExtraShotPrompt({
              script: storyBible.script,
              productionGuidelines: storyBible.productionGuidelines,
              stylePrompt,
              idea,
              afterShot: afterShot ? { shot: afterShot.shot, description: afterShot.description, prompt: afterShot.prompt } : undefined,
              beforeShot: beforeShot ? { shot: beforeShot.shot, description: beforeShot.description, prompt: beforeShot.prompt } : undefined,
          });

          const newShot: ShotPrompt = {
              shot: 0,
              description: result.shot.description,
              prompt: result.shot.prompt,
              characters: result.shot.characters || [],
              environment: result.shot.environment ?? null,
              products: result.shot.products || [],
              cameraPresetId,
              lensPresetId,
              cameraMovementPreset: 'none',
              contextReferences: [],
              motionPrompt: '',
              motionPromptIsGenerating: false,
              motionReferenceUrl: undefined,
              motionControlMode: 'std',
              motionControlOrientation: 'image',
              motionControlKeepSound: false,
              openPoseSourceUrl: undefined,
              openPoseReferenceUrl: undefined,
              openPoseIsGenerating: false,
              voiceoverText: '',
              voiceCharacterId: undefined,
              voiceChangerEnabled: true,
              voiceoverUrl: undefined,
              voiceoverIsGenerating: false,
          };

          const insertIndex = afterShot
              ? orderedShots.findIndex(s => s.shot === afterShot.shot)
              : orderedShots.length - 1;
          const updatedShots = [...orderedShots];
          if (updatedShots.length === 0) {
              updatedShots.push(newShot);
          } else if (insertIndex >= 0) {
              updatedShots.splice(insertIndex + 1, 0, newShot);
          } else {
              updatedShots.push(newShot);
          }
          const renumbered = updatedShots.map((shot, index) => ({ ...shot, shot: index + 1 }));

          setShotPrompts(renumbered);
          setActiveInpaintShotId(null);
          setExtraShotIdea('');
          if (result.references?.length) {
              setExtraShotSuggestions(result.references);
          } else {
              setExtraShotSuggestions([]);
          }

          const insertedShotNumber = insertIndex >= 0 ? insertIndex + 2 : renumbered.length;
          setExtraShotInsertAfter(Math.min(insertedShotNumber, renumbered.length));
      } catch (e) {
          handleError(e);
      } finally {
          setIsGeneratingExtraShot(false);
          setIsLoading(false);
      }
  };

  const handleGenerateStoryboard = async () => {
      setIsLoading("Generating Context-Aware Shot List...");
      try {
          const prompts = await generateShotImagePrompts(
              storyBible.script,
              storyBible.productionGuidelines,
              stylePrompt
          );
          setShotPrompts(prompts.map(p => ({
              ...p,
              characters: p.characters || [],
              cameraPresetId,
              lensPresetId,
              cameraMovementPreset: 'none',
              contextReferences: [],
              motionPrompt: '',
              motionPromptIsGenerating: false,
              motionReferenceUrl: undefined,
              motionControlMode: 'std',
              motionControlOrientation: 'image',
              motionControlKeepSound: false,
              openPoseSourceUrl: undefined,
              openPoseReferenceUrl: undefined,
              openPoseIsGenerating: false,
              voiceoverText: p.voiceoverText || '',
              voiceCharacterId: undefined,
              voiceChangerEnabled: true,
              voiceoverUrl: undefined,
              voiceoverIsGenerating: false,
          })));
          setIsLoading(false);
      } catch(e) { handleError(e); }
  };

  const handleGenerateOpenPose = async (shotNumber: number) => {
      const shot = shotPrompts.find(s => s.shot === shotNumber);
      if (!shot?.openPoseSourceUrl) {
          setError('Upload a pose source image first.');
          return;
      }
      setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? { ...s, openPoseIsGenerating: true } : s));
      try {
          const source = await getBase64FromUrl(shot.openPoseSourceUrl);
          const pose = await generateOpenPose(source);
          setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {
              ...s,
              openPoseReferenceUrl: pose.url,
              openPoseIsGenerating: false
          } : s));
      } catch (e) {
          setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? { ...s, openPoseIsGenerating: false } : s));
          handleError(e);
      }
  };

  const handleGenerateShotImage = async (shotNumber: number) => {
    const shot = shotPrompts.find(s => s.shot === shotNumber);
    if(!shot) return;

    setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {...s, isGenerating: true, isEditing: false} : s));

    try {
        const previousShot = [...shotPrompts]
            .filter(s => s.shot < shotNumber)
            .sort((a, b) => b.shot - a.shot)[0];
        let usePreviousShotContext = shot.usePreviousShotContext;
        let previousShotReason = shot.previousShotContextReason;

        if (previousShot?.imageUrl && usePreviousShotContext === undefined) {
            try {
                const decision = await shouldUsePreviousShotContext({
                    script: storyBible.script,
                    previousShot: {
                        description: previousShot.description,
                        prompt: previousShot.prompt,
                        environment: previousShot.environment
                    },
                    currentShot: {
                        description: shot.description,
                        prompt: shot.prompt,
                        environment: shot.environment
                    }
                });
                usePreviousShotContext = decision.usePreviousShot;
                previousShotReason = decision.reason;
                setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {
                    ...s,
                    usePreviousShotContext,
                    previousShotContextReason: previousShotReason
                } : s));
            } catch (error) {
                console.warn('Continuity check failed, skipping previous shot context.', error);
            }
        }

        const refsData: { [key: string]: { base64: string; mimeType: string; } } = {};
        const activeRefs: ReferenceItem[] = [];

        // Match Characters
        shot.characters.forEach(charName => {
             const matchingRefs = references.filter(r => r.imageUrl && r.type === 'character' && r.name.toLowerCase().includes(charName.toLowerCase()));
             if (matchingRefs.length > 0) {
                 // Simple matching logic
                 activeRefs.push(matchingRefs[0]);
             }
        });

        // Match Environment
        if (shot.environment) {
            const envRef = references.find(r => r.imageUrl && r.type === 'environment' && shot.environment!.toLowerCase().includes(r.name.toLowerCase()));
            if (envRef && !activeRefs.some(r => r.id === envRef.id)) activeRefs.push(envRef);
        }

        // Match Products (Commercial Context)
        if (shot.products) {
            shot.products.forEach(prodName => {
                const prodRef = references.find(r => r.imageUrl && r.type === 'product' && prodName.toLowerCase().includes(r.name.toLowerCase()));
                if (prodRef && !activeRefs.some(r => r.id === prodRef.id)) activeRefs.push(prodRef);
            });
        }

        await Promise.all(activeRefs.map(async r => { refsData[r.name] = await getBase64FromUrl(r.imageUrl!); }));

        const contextReferences = shot.contextReferences || [];
        const contextImages: { base64: string; mimeType: string }[] = [];
        const contextPromptBits: string[] = [];

        if (usePreviousShotContext && previousShot?.imageUrl) {
            contextImages.push(await getBase64FromUrl(previousShot.imageUrl));
            contextPromptBits.push('Maintain continuity with the previous shot: match lighting, time of day, and camera placement.');
        }

        const tagBuckets: Record<string, string[]> = {
            lighting: [],
            wardrobe: [],
            props: [],
            other: [],
        };

        const formatContextLabel = (ref: { name: string; purpose: string }) => {
            const name = ref.name?.trim() || 'Reference';
            const purpose = ref.purpose?.trim();
            return purpose ? `${name} - ${purpose}` : name;
        };

        for (const ref of contextReferences) {
            const tag = ref.tag || 'other';
            if (!tagBuckets[tag]) tagBuckets.other = tagBuckets.other || [];
            tagBuckets[tag]?.push(formatContextLabel(ref));
            if (ref.imageUrl) {
                contextImages.push(await getBase64FromUrl(ref.imageUrl));
            }
        }

        const tagOrder: Array<'lighting' | 'wardrobe' | 'props' | 'other'> = ['lighting', 'wardrobe', 'props', 'other'];
        const tagLabels: Record<'lighting' | 'wardrobe' | 'props' | 'other', string> = {
            lighting: 'Lighting references',
            wardrobe: 'Wardrobe references',
            props: 'Props references',
            other: 'Additional references',
        };
        for (const tag of tagOrder) {
            const items = tagBuckets[tag];
            if (items && items.length > 0) {
                contextPromptBits.push(`${tagLabels[tag]}: ${items.join('; ')}.`);
            }
        }

        let poseData: { base64: string; mimeType: string } | undefined;
        if (shot.openPoseReferenceUrl) {
            poseData = await getBase64FromUrl(shot.openPoseReferenceUrl);
            contextPromptBits.push('Match the pose from the provided OpenPose map for body position and limb angles.');
        }

        let sketchData: { base64: string; mimeType: string } | undefined;
        if (shot.sketchUrl) {
             const res = await fetch(shot.sketchUrl);
             const blob = await res.blob();
             const base64 = await fileToBase64(new File([blob], 'sketch.png', { type: 'image/png' }));
             sketchData = { base64, mimeType: 'image/png' };
        }

        const cameraPreset = CAMERA_PRESETS.find(preset => preset.id === (shot.cameraPresetId || cameraPresetId));
        const lensPreset = LENS_PRESETS.find(preset => preset.id === (shot.lensPresetId || lensPresetId));
        const effectiveAspectRatio = lensPreset?.aspectRatioOverride || referenceAspectRatio;
        const modelAspectRatio = resolveModelAspectRatio(effectiveAspectRatio);
        const aspectRatioHint = effectiveAspectRatio === '2.39:1'
            ? (lensPreset?.aspectRatioHint || 'cinemascope 2.39:1, anamorphic de-squeezed, widescreen framing')
            : '';
        const cameraLensPrompt = [cameraPreset?.prompt, lensPreset?.prompt].filter(Boolean).join(', ');
        const finalPrompt = [stylePrompt, shot.prompt, cameraLensPrompt, aspectRatioHint, ...contextPromptBits].filter(Boolean).join('. ');
        const modelToUse = referenceImageModel === 'gemini-pro' ? 'gemini-3-pro-image-preview' : 'gemini-2.5-flash-image';
        const referenceImages = [...contextImages, ...Object.values(refsData)];
        const compositionData = poseData || sketchData;
        const supplementalReferences = poseData && sketchData
            ? [sketchData, ...referenceImages]
            : referenceImages;
        const seedreamInputs = compositionData ? [compositionData, ...supplementalReferences] : supplementalReferences;
        const seedreamPrompt = compositionData
            ? `${finalPrompt}\n\nUse the first input image as a strict composition reference${poseData ? ' (OpenPose pose map)' : ''}. Use remaining images as style/character/environment references.`
            : supplementalReferences.length
                ? `${finalPrompt}\n\nUse the input images as style/character/environment references.`
                : finalPrompt;
        const qwenInputs = compositionData ? [compositionData, ...supplementalReferences] : supplementalReferences;
        const qwenCompositionHint = compositionData
            ? `Use the first input image as a strict composition reference${poseData ? ' (OpenPose pose map)' : ''}. `
            : '';
        const qwenPrompt = qwenInputs.length
            ? `${finalPrompt}\n\n${qwenCompositionHint}Use the input images as context references.`
            : finalPrompt;
        const qwen2512Prompt = qwenInputs.length
            ? `${finalPrompt}\n\n${qwenCompositionHint}Use the input image as a reference.`
            : finalPrompt;

        let imageMedia: MediaItem;
        if (referenceImageModel === 'qwen-2512') {
            const baseImage = qwenInputs[0];
            imageMedia = await generateImageWithQwenImage(qwen2512Prompt, modelAspectRatio, baseImage);
        } else if (referenceImageModel === 'qwen') {
            if (qwenInputs.length === 0) {
                throw new Error('Qwen 2511 requires at least one reference or sketch image for storyboards.');
            }
            const [baseImage, ...extraImages] = qwenInputs;
            imageMedia = await editImageWithQwen(qwenPrompt, baseImage, {
                aspectRatio: modelAspectRatio,
                extraImages,
            });
        } else if (referenceImageModel === 'seedream') {
            if (seedreamInputs.length > 0) {
                imageMedia = await generateImageWithSeedreamReferences(
                    seedreamPrompt,
                    seedreamInputs,
                    modelAspectRatio,
                    seedreamSize
                );
            } else {
                imageMedia = await generateImageWithSeedream(
                    finalPrompt,
                    modelAspectRatio,
                    seedreamSize
                );
            }
        } else {
            imageMedia = await generateImageWithReferences(
                finalPrompt,
                supplementalReferences,
                compositionData,
                modelToUse,
                { aspectRatio: modelAspectRatio, imageSize: imageSize }
            );
        }

        const finalImage = await applyCinemascopeCrop(imageMedia, effectiveAspectRatio);
        setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {...s, imageUrl: finalImage.url, isGenerating: false} : s));
    } catch (e) {
        console.error(e);
        setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {...s, isGenerating: false} : s));
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
            handleError(e);
        } else if (msg.includes('Qwen 2511')) {
            setError(msg);
        } else {
             setError("Failed to generate shot. Try removing complex references or sketching simpler composition.");
        }
    }
  };

  const handleGenerateAllShotImages = async () => {
      const shotsToGenerate = shotPrompts.filter(s => !s.imageUrl && !s.isGenerating);
      if (shotsToGenerate.length === 0) return setError("No pending shots to generate.");

      setIsLoading("Batch Generating Storyboard Images...");

      for (const shot of shotsToGenerate) {
          try {
            await handleGenerateShotImage(shot.shot);
          } catch (e) {
              console.error(`Failed to generate shot ${shot.shot}`, e);
          }
      }
      setIsLoading(false);
  };

  const applyCameraLensToAllShots = () => {
      setShotPrompts(prev => prev.map(shot => ({
          ...shot,
          cameraPresetId,
          lensPresetId
      })));
  };

  const handleReviewShotCinematography = async (shotNumber: number) => {
      const shot = shotPrompts.find(s => s.shot === shotNumber);
      if(!shot || !shot.imageUrl) return;

      setIsLoading(`Analyzing Shot ${shotNumber} cinematography...`);
      try {
          const res = await fetch(shot.imageUrl);
          const blob = await res.blob();
          const base64 = await fileToBase64(new File([blob], 'shot.png', {type: blob.type}));

          const critique = await reviewCinematography({ base64, mimeType: blob.type }, storyBible.script, shot.description);
          setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {...s, cinematographyCritique: critique} : s));
      } catch (e) {
          handleError(e);
      } finally {
          setIsLoading(false);
      }
  };

  // --- Filming Phase Logic ---

  const handleGenerateMotionPrompt = async (shotNumber: number) => {
        const shot = shotPrompts.find(s => s.shot === shotNumber);
        if (!shot) return;
        setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? { ...s, motionPromptIsGenerating: true } : s));
        try {
            const motionPrompt = await generateMotionPromptForShot(
                storyBible.script,
                shot.shot,
                shot.description,
                stylePrompt
            );
            const movementPreset = getCameraMovementPreset(shot.cameraMovementPreset);
            const finalPrompt = applyCameraMovementToPrompt(motionPrompt.trim(), movementPreset?.prompt || '');
            setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {
                ...s,
                motionPrompt: finalPrompt,
                motionPromptIsGenerating: false
            } : s));
        } catch (e) {
            setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? { ...s, motionPromptIsGenerating: false } : s));
            handleError(e);
        }
  };

  const handleGenerateShotVideo = async (shotNumber: number) => {
        const shot = shotPrompts.find(s => s.shot === shotNumber);
        if(!shot || !shot.imageUrl) return;

        setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {...s, isFilming: true} : s));

        try {
            // Check if motion prompt exists, if not generate it on the fly (though typically handled by bulk action, single action should be robust)
            let motionPrompt = shot.motionPrompt?.trim();
            if (!motionPrompt) {
                motionPrompt = await generateMotionPromptForShot(
                    storyBible.script,
                    shot.shot,
                    shot.description,
                    stylePrompt
                );
                motionPrompt = motionPrompt.trim();
            }
            const movementPreset = getCameraMovementPreset(shot.cameraMovementPreset);
            if (movementPreset?.prompt) {
                motionPrompt = applyCameraMovementToPrompt(motionPrompt, movementPreset.prompt);
            }
            setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? { ...s, motionPrompt } : s));
            const response = await fetch(shot.imageUrl!);
            const blob = await response.blob();
            const base64 = await fileToBase64(new File([blob], "shot.png", {type: blob.type}));

            const video = videoModel.startsWith('veo-')
                ? await generateVideoWithVeo(
                    motionPrompt,
                    (msg) => console.log(`Filming Shot ${shot.shot}: ${msg}`),
                    '16:9',
                    { base64, mimeType: blob.type },
                    videoModel
                )
                : videoModel === 'wan-2.2-i2v-fast'
                    ? await generateVideoWithWanI2V(motionPrompt, { base64, mimeType: blob.type })
                    : videoModel === 'kling-v2.6-motion-control'
                        ? await (async () => {
                            if (!shot.motionReferenceUrl) {
                                throw new Error('Kling Motion Control requires a reference video.');
                            }
                            const refResponse = await fetch(shot.motionReferenceUrl);
                            const refBlob = await refResponse.blob();
                            const refMimeType = refBlob.type || 'video/mp4';
                            const refBase64 = await fileToBase64(new File([refBlob], 'motion_ref.mp4', { type: refMimeType }));
                            return generateVideoWithKlingMotionControl(
                                motionPrompt,
                                { base64, mimeType: blob.type },
                                { base64: refBase64, mimeType: refMimeType },
                                {
                                    mode: shot.motionControlMode || 'std',
                                    characterOrientation: shot.motionControlOrientation || 'image',
                                    keepOriginalSound: shot.motionControlKeepSound ?? false
                                }
                            );
                        })()
                        : videoModel === 'kling-v2.5-turbo-pro'
                            ? await generateVideoWithKling(motionPrompt, { base64, mimeType: blob.type })
                        : await generateVideoWithLtx(motionPrompt, { image: { base64, mimeType: blob.type } });

            setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {...s, videoUrl: video.url, isFilming: false} : s));
        } catch (e) {
            console.error(e);
            setShotPrompts(prev => prev.map(s => s.shot === shotNumber ? {...s, isFilming: false} : s));
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
                handleError(e);
            } else {
                setError(`Failed to film Shot ${shotNumber}: ${msg}`);
            }
        }
  };

  const handleGenerateAllVideos = async () => {
      const readyShots = shotPrompts.filter(s => s.imageUrl && !s.videoUrl);
      if(readyShots.length === 0) {
          const hasVideos = shotPrompts.some(s => s.videoUrl);
          if (hasVideos) return setError("All ready shots have already been filmed.");
          return setError("No storyboard images to film.");
      }
      if (videoModel === 'kling-v2.6-motion-control' && readyShots.some(s => !s.motionReferenceUrl)) {
          return setError("Kling Motion Control requires a reference video for each shot.");
      }

      setIsLoading("Production in progress... Filming scenes sequentially.");

      // We iterate and wait to avoid overwhelming the API if rate limits exist,
      // but also to provide progress updates.
      for (const shot of readyShots) {
          try {
            await handleGenerateShotVideo(shot.shot);
          } catch (e) {
              console.error("Batch filming interrupted", e);
              break;
          }
      }
      setIsLoading(false);
  };

  const handleExportRoughCut = () => {
      const videos = shotPrompts
        .filter(s => s.videoUrl)
        .map(s => ({
            id: `video-shot-${s.shot}-${Date.now()}`,
            name: `Shot ${s.shot}: ${s.description.slice(0, 20)}...`,
            type: 'video' as const,
            url: s.videoUrl!,
            source: 'generated' as const,
            duration: 5 // Default Veo duration usually ~5-6s, we can get actual metadata later
        }));

      if (videos.length === 0) return setError("No filmed content to export.");
      onRoughCutReady(videos);
  };

  const escapeXml = (value: string) => {
      return value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
  };

  const formatDuration = (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return '5s';
      const trimmed = Number(seconds.toFixed(3));
      return `${trimmed}s`;
  };

  const buildFcpxml = async () => {
      const shots = shotPrompts.filter(s => s.videoUrl);
      if (shots.length === 0) {
          throw new Error('No filmed content to export.');
      }

      const assets = [];
      const clips = [];
      let offset = 0;

      for (let i = 0; i < shots.length; i++) {
          const shot = shots[i];
          let duration = 5;
          if (shot.videoUrl) {
              try {
                  duration = await getVideoDuration(shot.videoUrl);
              } catch (e) {
                  duration = 5;
              }
          }
          const assetId = `r${i + 2}`;
          const assetName = `Shot ${shot.shot}`;
          const src = escapeXml(shot.videoUrl!);
          const clipDuration = formatDuration(duration);
          assets.push(`    <asset id="${assetId}" name="${escapeXml(assetName)}" src="${src}" start="0s" duration="${clipDuration}" hasVideo="1" hasAudio="1"/>`);
          clips.push(`        <asset-clip name="${escapeXml(assetName)}" ref="${assetId}" offset="${formatDuration(offset)}" start="0s" duration="${clipDuration}"/>`);
          offset += duration;
      }

      const totalDuration = formatDuration(offset);
      return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n  <resources>\n    <format id="r1" name="FFVideoFormat1080p30" frameDuration="1/30s" width="1920" height="1080"/>\n${assets.join('\n')}\n  </resources>\n  <library>\n    <event name="AI Video Production Editor">\n      <project name="Rough Cut">\n        <sequence duration="${totalDuration}" format="r1" tcStart="0s" tcFormat="NDF">\n          <spine>\n${clips.join('\n')}\n          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n`;
  };

  const handleExportXml = async (target: 'premiere' | 'resolve') => {
      try {
          const xml = await buildFcpxml();
          const blob = new Blob([xml], { type: 'application/xml' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `ai_video_studio_${target}.fcpxml`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
      } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
      }
  };

  // --- Review Phase Logic ---
  const handleAnalyzeDraft = async () => {
      setIsLoading("Analyzing Project Draft for Consistency...");
      try {
          const draftData = shotPrompts.map(s => ({
              shot: s.shot,
              description: s.description,
              prompt: s.prompt,
              imageUrl: s.imageUrl
          }));

          const feedback = await analyzeProjectDraft(storyBible.script, storyBible.productionGuidelines, draftData);
          setReviewFeedback(feedback);

          if (feedback.shotSpecificFeedback) {
              setShotPrompts(prev => prev.map(shot => {
                  const specific = feedback.shotSpecificFeedback.find(f => f.shot === shot.shot);
                  return specific ? { ...shot, aiFeedback: specific.feedback } : shot;
              }));
          }

      } catch (e) {
          handleError(e);
      } finally {
          setIsLoading(false);
      }
  };

  const handleCreatePoster = async () => {
      setIsLoading("Designing Movie Poster...");
      try {
          const poster = await generateMoviePoster(storyBible, references, stylePrompt);
          updateBible({ posterUrl: poster.url });
      } catch (e) { handleError(e); } finally { setIsLoading(false); }
  };

  const phases = [
      { id: 'library', label: 'Library', icon: FolderIcon },
      { id: 'script', label: 'Script', icon: ScriptIcon },
      { id: 'concept', label: 'Concept', icon: UserCircleIcon },
      { id: 'storyboard', label: 'Storyboard', icon: GridIcon },
      { id: 'filming', label: 'Filming', icon: FilmIcon },
      { id: 'review', label: 'Review', icon: ClipboardCheckIcon },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-900">
        {/* Top Navigation Stepper */}
        <div className="bg-gray-800 border-b border-gray-700 pt-4 pb-0 px-4">
            <div className="max-w-3xl mx-auto flex justify-between items-center relative">
                <div className="absolute top-5 left-0 right-0 h-0.5 bg-gray-700 -z-0"></div>
                {phases.map((phase, index) => {
                    const isActive = activePhase === phase.id;
                    const isPast = phases.findIndex(p => p.id === activePhase) > index;
                    return (
                        <button
                            key={phase.id}
                            onClick={() => setActivePhase(phase.id as ProductionPhase)}
                            className={`relative z-10 flex flex-col items-center gap-2 focus:outline-none group pb-4 ${isActive ? 'border-b-2 border-indigo-500' : 'border-b-2 border-transparent'}`}
                        >
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${isActive ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/30' : isPast ? 'bg-gray-700 border-indigo-500 text-indigo-400' : 'bg-gray-800 border-gray-600 text-gray-500 group-hover:border-gray-500'}`}>
                                <phase.icon className="w-5 h-5" />
                            </div>
                            <span className={`text-xs font-bold uppercase tracking-wide ${isActive ? 'text-white' : 'text-gray-500'}`}>{phase.label}</span>
                        </button>
                    )
                })}
            </div>
        </div>

        {/* Main Workspace Area */}
        <div className="flex-grow overflow-hidden relative">
            {isLoading && (
                <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-indigo-500 mb-4"></div>
                    <p className="text-xl font-bold text-white animate-pulse">{isLoading}</p>
                </div>
            )}

            <div className="h-full overflow-y-auto p-6 custom-scrollbar">
                <div className="max-w-7xl mx-auto">
                    {error && (
                        <div className="mb-6 bg-red-500/10 border border-red-500/50 text-red-200 p-4 rounded-lg flex justify-between items-center">
                            <p>{error}</p>
                            <button onClick={() => setError(null)} className="text-white hover:text-red-100">&times;</button>
                        </div>
                    )}

                    {/* Library Phase */}
                    {activePhase === 'library' && (
                        <div className="space-y-6">
                            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-700 pb-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-white">Recent Projects</h2>
                                    <p className="text-gray-400 text-sm">Jump back into your saved projects.</p>
                                </div>
                                <button
                                    onClick={onOpenProjectPicker}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg"
                                >
                                    Open Project…
                                </button>
                            </div>
                            {recentProjects.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-gray-700 rounded-2xl bg-gray-800/30">
                                    <FolderIcon className="w-12 h-12 text-gray-600 mb-4"/>
                                    <p className="text-gray-400 text-sm">No recent projects yet. Save a project to see it here.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                    {recentProjects.map(project => (
                                        <div key={project.path} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-col gap-3">
                                            <div>
                                                <p className="text-sm font-semibold text-white truncate">{project.name}</p>
                                                <p className="text-xs text-gray-400 truncate">{project.path}</p>
                                            </div>
                                            <div className="text-[10px] uppercase tracking-wider text-gray-500">
                                                <span>Opened {new Date(project.lastOpened).toLocaleString()}</span>
                                                {project.lastSavedAt && (
                                                    <span className="block">Saved {new Date(project.lastSavedAt).toLocaleString()}</span>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => onOpenRecentProject(project.path)}
                                                className="mt-auto px-3 py-2 rounded-lg text-xs font-bold bg-gray-700 text-white hover:bg-gray-600"
                                            >
                                                Open Project
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Script Phase */}
                    {activePhase === 'script' && (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
                            <div className="lg:col-span-4 flex flex-col gap-6">
                                <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg">
                                    <h3 className="text-lg font-bold text-white mb-4">Story Bible</h3>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Project Title</label>
                                            <input
                                                type="text"
                                                value={storyBible.title || ''}
                                                onChange={e => updateBible({title: e.target.value})}
                                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 transition-shadow font-bold text-white"
                                                placeholder="Enter project title..."
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Logline</label>
                                            <textarea
                                                value={storyBible.logline}
                                                onChange={e => updateBible({logline: e.target.value})}
                                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 transition-shadow"
                                                rows={3}
                                                placeholder="In a world where..."
                                            />
                                        </div>
                                        <div>
                                            <div className="flex justify-between items-center mb-1">
                                                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Visual Style</label>
                                                <button onClick={() => setShowPresets(!showPresets)} className="text-xs text-indigo-400 hover:text-white flex items-center gap-1">
                                                    <PaletteIcon className="w-3 h-3"/> Presets
                                                </button>
                                            </div>

                                            {showPresets && (
                                                <div className="mb-3 bg-gray-900 p-3 rounded-lg border border-gray-700 animate-fadeIn">
                                                    <div className="space-y-3">
                                                        <div>
                                                            <span className="text-xs text-gray-500 block mb-1">Style</span>
                                                            <div className="flex flex-wrap gap-1">
                                                                {STYLE_PRESETS.visual.map(p => (
                                                                    <button key={p} onClick={() => addPreset(p)} className="text-[10px] bg-gray-800 hover:bg-indigo-600 px-2 py-1 rounded border border-gray-700">{p.split(',')[0]}</button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            <textarea
                                                value={visualStyle}
                                                onChange={e => setVisualStyle(e.target.value)}
                                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 transition-shadow"
                                                rows={3}
                                                placeholder="e.g., Cyberpunk, Neo-Noir..."
                                            />
                                        </div>
                                        {styleSuggestions.length > 0 && (
                                            <div>
                                                <span className="text-xs font-bold text-indigo-300 block mb-2">AI Suggested Styles:</span>
                                                <div className="flex flex-wrap gap-2">
                                                    {styleSuggestions.map(style => (
                                                        <button key={style} onClick={() => addPreset(style)} className="flex items-center gap-1 text-[10px] bg-indigo-900/50 hover:bg-indigo-600 text-indigo-100 px-2 py-1 rounded-full border border-indigo-700 transition-colors">
                                                            <SparklesIcon className="w-3 h-3"/> {style}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="bg-indigo-900/30 rounded-xl p-6 border border-indigo-500/30">
                                    <h3 className="text-md font-bold text-indigo-300 mb-2">Ready to breakdown?</h3>
                                    <p className="text-sm text-indigo-200 mb-4">AI will extract characters, locations, and brand assets from your script.</p>
                                    <button
                                        onClick={handleAnalyzeScript}
                                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold py-3 px-4 rounded-lg shadow-lg transition-all transform hover:translate-y-[-1px]"
                                    >
                                        Analyze Script
                                    </button>
                                </div>
                            </div>
                            <div className="lg:col-span-8 flex flex-col h-[70vh]">
                                <div className="bg-gray-800 rounded-xl border border-gray-700 flex-grow flex flex-col overflow-hidden shadow-xl relative">
                                    <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-800/50">
                                        <div className="flex gap-2">
                                            <button onClick={() => setScriptInputMode('paste')} className={`px-3 py-1 rounded text-sm font-medium ${scriptInputMode === 'paste' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Editor</button>
                                            <button onClick={() => setScriptInputMode('generate')} className={`px-3 py-1 rounded text-sm font-medium flex items-center gap-1 ${scriptInputMode === 'generate' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}><MagicWandIcon className="w-3 h-3"/> AI Writer</button>
                                        </div>
                                        <div className="flex gap-2 items-center">
                                             {storyBible.script && (
                                                <button onClick={handleSuggestNextBeats} className="text-xs bg-purple-900/50 hover:bg-purple-600 text-purple-200 px-3 py-1 rounded border border-purple-500/30 flex items-center gap-1">
                                                    <BrainIcon className="w-3 h-3"/> What's Next?
                                                </button>
                                             )}
                                            <input type="file" ref={scriptFileInputRef} onChange={handleScriptUpload} className="hidden" accept=".pdf,.txt" />
                                            <button onClick={() => scriptFileInputRef.current?.click()} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"><PdfIcon className="w-3 h-3"/> Import Script</button>
                                        </div>
                                    </div>

                                    {scriptInputMode === 'generate' && (
                                        <div className="p-4 bg-gray-900 border-b border-gray-700">
                                            <div className="flex flex-col gap-2">
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={scriptGenerationPrompt}
                                                        onChange={e => setScriptGenerationPrompt(e.target.value)}
                                                        placeholder="Describe your story idea..."
                                                        className="flex-grow bg-gray-800 border border-gray-600 rounded-lg p-2 text-sm focus:ring-1 focus:ring-indigo-500"
                                                    />
                                                    <select
                                                        value={scriptLength}
                                                        onChange={(e) => setScriptLength(e.target.value as ScriptLength)}
                                                        className="bg-gray-800 border border-gray-600 rounded-lg p-2 text-sm text-gray-300"
                                                    >
                                                        <option value="teaser">Teaser (30s)</option>
                                                        <option value="commercial">Commercial / Ad (30-60s)</option>
                                                        <option value="trailer">Trailer (60s)</option>
                                                        <option value="short">Short (5-10m)</option>
                                                        <option value="feature">Feature Treatment</option>
                                                    </select>
                                                </div>
                                                <button onClick={handleGenerateScript} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-lg text-sm w-full">Generate (McKee Mode)</button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="relative flex-grow">
                                        <textarea
                                            ref={scriptTextAreaRef}
                                            value={storyBible.script}
                                            onChange={e => updateBible({ script: e.target.value })}
                                            onSelect={handleScriptSelect}
                                            className="w-full h-full bg-gray-900 p-8 font-mono text-sm text-gray-300 leading-relaxed resize-none focus:outline-none"
                                            placeholder="INT. SCENE - DAY..."
                                            spellCheck={false}
                                        />

                                        {/* Interactive Edit Popup */}
                                        {showEditPopup && selectedScriptText && (
                                            <div className="absolute bottom-4 right-4 left-4 bg-gray-800 border border-indigo-500 rounded-lg shadow-2xl p-4 animate-slideUp z-20">
                                                <div className="flex justify-between items-start mb-2">
                                                    <h4 className="text-sm font-bold text-white flex items-center gap-2"><MagicWandIcon className="w-4 h-4 text-indigo-400"/> Edit Selection</h4>
                                                    <button onClick={() => setShowEditPopup(false)} className="text-gray-400 hover:text-white">&times;</button>
                                                </div>
                                                <p className="text-xs text-gray-400 mb-2 truncate italic border-l-2 border-gray-600 pl-2">"{selectedScriptText}"</p>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={editInstruction}
                                                        onChange={e => setEditInstruction(e.target.value)}
                                                        placeholder="e.g., Make dialogue funnier, add more tension..."
                                                        className="flex-grow bg-gray-900 border border-gray-600 rounded p-2 text-sm text-white"
                                                        onKeyDown={e => e.key === 'Enter' && handleEditScriptSelection()}
                                                    />
                                                    <button onClick={handleEditScriptSelection} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-xs font-bold">Rewrite</button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Plot Suggestions Overlay */}
                                        {plotSuggestions.length > 0 && (
                                            <div className="absolute top-4 right-4 w-64 bg-gray-800 border border-purple-500 rounded-lg shadow-xl p-3 z-20 animate-fadeIn">
                                                <div className="flex justify-between items-center mb-2">
                                                    <h4 className="text-xs font-bold text-purple-300">Plot Suggestions</h4>
                                                    <button onClick={() => setPlotSuggestions([])} className="text-gray-500 hover:text-white">&times;</button>
                                                </div>
                                                <div className="space-y-2">
                                                    {plotSuggestions.map((s, i) => (
                                                        <button key={i} onClick={() => handleAppendBeat(s)} className="w-full text-left text-xs p-2 bg-gray-700 hover:bg-purple-900/50 rounded border border-gray-600 hover:border-purple-500 transition-colors">
                                                            {s}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Concept Phase */}
                    {activePhase === 'concept' && (
                        <div className="space-y-8">
                            <div className="flex justify-between items-end border-b border-gray-700 pb-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-white">Concept & Casting</h2>
                                    <p className="text-gray-400 text-sm mt-1">Review extracted assets and generate visual references.</p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <AspectRatioPicker value={referenceAspectRatio} onChange={setReferenceAspectRatio} />
                                    <div className="flex items-center gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
                                        {(referenceImageModel === 'gemini-pro' || referenceImageModel === 'seedream') && (
                                            <select
                                                value={imageSize}
                                                onChange={(e) => setImageSize(e.target.value as any)}
                                                className="bg-gray-700 text-white text-xs font-bold py-1 px-2 rounded focus:outline-none"
                                            >
                                                {referenceImageModel === 'seedream' ? (
                                                    <>
                                                        <option value="2K">2K</option>
                                                        <option value="4K">4K</option>
                                                    </>
                                                ) : (
                                                    <>
                                                        <option value="1K">1K</option>
                                                        <option value="2K">2K</option>
                                                        <option value="4K">4K</option>
                                                    </>
                                                )}
                                            </select>
                                        )}
                                        <div className="h-4 w-px bg-gray-600"></div>
                                        <span className="text-xs font-bold text-gray-400 px-2">Model:</span>
                                        <button onClick={() => setReferenceImageModel('imagen')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'imagen' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Imagen (HQ)</button>
                                        <button onClick={() => setReferenceImageModel('gemini-pro')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'gemini-pro' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Gemini 3 Pro</button>
                                        <button onClick={() => setReferenceImageModel('qwen-2512')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'qwen-2512' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Qwen 2512</button>
                                        <button onClick={() => setReferenceImageModel('qwen')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'qwen' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Qwen 2511 (Context)</button>
                                        <button onClick={() => setReferenceImageModel('nano')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'nano' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Flash (Fast)</button>
                                        <button onClick={() => setReferenceImageModel('z-turbo')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'z-turbo' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Z-Turbo (Fastest)</button>
                                        <button onClick={() => setReferenceImageModel('flux')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'flux' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Flux Pro</button>
                                        <button onClick={() => { if (imageSize === '1K') setImageSize('2K'); setReferenceImageModel('seedream'); }} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'seedream' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Seedream 4.5</button>
                                    </div>
                                    <button
                                        onClick={handleGenerateAllPrompts}
                                        className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-6 rounded-lg shadow-lg flex items-center gap-2 transition-transform transform hover:scale-105"
                                    >
                                        <EditIcon className="w-5 h-5"/> Write All Prompts
                                    </button>
                                    <button
                                        onClick={handleGenerateAllConcepts}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg flex items-center gap-2 transition-transform transform hover:scale-105"
                                    >
                                        <MagicWandIcon className="w-5 h-5"/> Generate All
                                    </button>
                                    <button
                                        onClick={() => { handleGenerateStoryboard(); setActivePhase('storyboard'); }}
                                        className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg flex items-center gap-2 transition-transform transform hover:scale-105"
                                    >
                                        Next: Storyboard <span className="text-green-200">→</span>
                                    </button>
                                </div>
                            </div>

                            {styleSuggestions.length > 0 && (
                                <div className="flex gap-2 overflow-x-auto pb-2">
                                    <span className="text-xs font-bold text-gray-500 py-1">Suggested Styles:</span>
                                    {styleSuggestions.map(style => (
                                        <button key={style} onClick={() => setVisualStyle(prev => prev ? `${prev}, ${style}` : style)} className="text-[10px] bg-gray-800 hover:bg-indigo-700 text-indigo-300 px-3 py-1 rounded-full border border-indigo-500/30 whitespace-nowrap">
                                            {style}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Commercial/Ad Specific: Product & Brand Assets */}
                            {(scriptLength === 'commercial' || references.some(r => r.type === 'product')) && (
                                <div>
                                    <div className="flex items-center gap-2 mb-4">
                                        <div className="p-2 bg-pink-500/20 rounded-lg">
                                            <BoxIcon className="w-6 h-6 text-pink-400"/>
                                        </div>
                                        <h3 className="text-xl font-bold text-white">Product & Brand Assets</h3>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                        {references.filter(r => r.type === 'product').map(ref => (
                                            <ReferenceCard
                                                key={ref.id}
                                                reference={ref}
                                                onUpdate={(id, u) => setReferences(prev => prev.map(r => r.id === id ? {...r, ...u} : r))}
                                                onGenerateDetails={async (id) => {
                                                    const { prompt, tags } = await generateReferenceDetails(
                                                        ref.type,
                                                        ref.name,
                                                        ref.description,
                                                        storyBible.script,
                                                        stylePrompt
                                                    );
                                                    setReferences(prev => prev.map(r => r.id === id ? { ...r, prompt, tags } : r));
                                                }}
                                                onRegenerateImage={async (id) => {
                                                     setReferences(prev => prev.map(r => r.id === id ? { ...r, isGenerating: true } : r));
                                                     try {
                                                         const imagePrompt = composeReferencePrompt(ref);
                                                         const img = await generateReferenceImage(imagePrompt, referenceAspectRatio, ref.imageUrl || undefined);
                                                         const stableUrl = await stabilizeReferenceImageUrl(ref, img.url);
                                                         setReferences(prev => prev.map(r => r.id === id ? { ...r, imageUrl: stableUrl, isGenerating: false } : r));
                                                     } catch(e) {
                                                         setReferences(prev => prev.map(r => r.id === id ? { ...r, isGenerating: false } : r));
                                                         handleError(e);
                                                     }
                                                }}
                                                onUpload={(id, file) => setReferences(prev => prev.map(r => r.id === id ? { ...r, imageUrl: URL.createObjectURL(file) } : r))}
                                                onRemove={(id) => setReferences(prev => prev.filter(r => r.id !== id))}
                                                onViewFull={(url, title) => setFullResView({ url, title })}
                                            />
                                        ))}
                                        <button onClick={() => setReferences(prev => [...prev, { id: `prod-${Date.now()}`, type: 'product', name: 'New Product', description: '', prompt: '', imageUrl: null, isGenerating: false, tags: [] }])} className="aspect-[3/4] rounded-xl border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 hover:border-pink-500 hover:text-pink-400 transition-all group bg-gray-900/30">
                                            <div className="w-12 h-12 rounded-full border-2 border-gray-600 flex items-center justify-center group-hover:border-pink-500 mb-2 transition-colors">
                                                <span className="text-2xl font-light">+</span>
                                            </div>
                                            <span className="text-sm font-medium">Add Product/Logo</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Characters Section */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="p-2 bg-indigo-500/20 rounded-lg">
                                        <UserCircleIcon className="w-6 h-6 text-indigo-400"/>
                                    </div>
                                    <h3 className="text-xl font-bold text-white">Characters</h3>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                                    {references.filter(r => r.type === 'character').map(ref => (
                                        <ReferenceCard
                                            key={ref.id}
                                            reference={ref}
                                            onUpdate={(id, u) => setReferences(prev => prev.map(r => r.id === id ? {...r, ...u} : r))}
                                            onGenerateDetails={async (id) => {
                                                const { prompt, tags } = await generateReferenceDetails(
                                                    ref.type,
                                                    ref.name,
                                                    ref.description,
                                                    storyBible.script,
                                                    stylePrompt
                                                );
                                                setReferences(prev => prev.map(r => r.id === id ? { ...r, prompt, tags } : r));
                                            }}
                                            onRegenerateImage={async (id) => {
                                                 setReferences(prev => prev.map(r => r.id === id ? { ...r, isGenerating: true } : r));
                                                 try {
                                                     const imagePrompt = composeReferencePrompt(ref);
                                                     const img = await generateReferenceImage(imagePrompt, referenceAspectRatio, ref.imageUrl || undefined);
                                                     const stableUrl = await stabilizeReferenceImageUrl(ref, img.url);
                                                     setReferences(prev => prev.map(r => r.id === id ? { ...r, imageUrl: stableUrl, isGenerating: false } : r));
                                                 } catch(e) {
                                                     setReferences(prev => prev.map(r => r.id === id ? { ...r, isGenerating: false } : r));
                                                     handleError(e);
                                                 }
                                            }}
                                            onUpload={(id, file) => setReferences(prev => prev.map(r => r.id === id ? { ...r, imageUrl: URL.createObjectURL(file) } : r))}
                                            onRemove={(id) => setReferences(prev => prev.filter(r => r.id !== id))}
                                            onViewFull={(url, title) => setFullResView({ url, title })}
                                            extraContent={(
                                                <div className="space-y-2">
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <label className="text-[10px] uppercase tracking-wide text-gray-500">Background</label>
                                                            <select
                                                                value={ref.characterBackground || 'auto'}
                                                                onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, characterBackground: e.target.value as any } : r))}
                                                                className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                            >
                                                                {CHARACTER_BACKGROUND_OPTIONS.map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] uppercase tracking-wide text-gray-500">Perspective</label>
                                                            <select
                                                                value={ref.characterPerspective || 'auto'}
                                                                onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, characterPerspective: e.target.value as any } : r))}
                                                                className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                            >
                                                                {CHARACTER_PERSPECTIVE_OPTIONS.map(option => (
                                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-wrap gap-2">
                                                        <button
                                                            onClick={() => handleGenerateCharacterProfile(ref.id)}
                                                            className="text-[10px] px-2 py-1 rounded bg-gray-700 text-white hover:bg-gray-600"
                                                        >
                                                            Auto Profile
                                                        </button>
                                                        <button
                                                            onClick={() => handleGenerateCharacterOutfits(ref.id)}
                                                            className="text-[10px] px-2 py-1 rounded bg-indigo-700 text-white hover:bg-indigo-600"
                                                        >
                                                            {ref.isGeneratingOutfits ? 'Generating Outfits...' : 'Generate Outfits'}
                                                        </button>
                                                    </div>
                                                    <p className="text-[10px] text-gray-500">Outfits use context models (Seedream 4.5 or Gemini).</p>

                                                    <textarea
                                                        value={ref.personalityNotes || ''}
                                                        onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, personalityNotes: e.target.value } : r))}
                                                        placeholder="Personality & emotional tone"
                                                        rows={2}
                                                        className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                    />
                                                    <textarea
                                                        value={ref.voiceNotes || ''}
                                                        onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, voiceNotes: e.target.value } : r))}
                                                        placeholder="Voice, accent, cadence"
                                                        rows={2}
                                                        className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                    />
                                                    <div className="grid grid-cols-1 gap-2">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] uppercase tracking-wide text-gray-500">ElevenLabs Voice List</span>
                                                            <button
                                                                onClick={handleLoadElevenLabsVoices}
                                                                className="text-[10px] text-indigo-300 hover:text-indigo-200 font-semibold"
                                                            >
                                                                {voiceListStatus === 'loading' ? 'Loading…' : 'Fetch Voices'}
                                                            </button>
                                                        </div>
                                                        {voiceListError && (
                                                            <p className="text-[10px] text-red-300">{voiceListError}</p>
                                                        )}
                                                        {elevenLabsVoices.length > 0 && (
                                                            <select
                                                                value={ref.elevenLabsVoiceId || ''}
                                                                onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, elevenLabsVoiceId: e.target.value } : r))}
                                                                className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                            >
                                                                <option value="">Select voice…</option>
                                                                {elevenLabsVoices.map(voice => (
                                                                    <option key={voice.voice_id} value={voice.voice_id}>
                                                                        {voice.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        )}
                                                        <input
                                                            value={ref.elevenLabsVoiceId || ''}
                                                            onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, elevenLabsVoiceId: e.target.value } : r))}
                                                            placeholder="ElevenLabs Voice ID (e.g. JBFqnCBsd6RMkjVDRZzb)"
                                                            className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                        />
                                                        <input
                                                            value={ref.elevenLabsModelId || ''}
                                                            onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, elevenLabsModelId: e.target.value } : r))}
                                                            placeholder="ElevenLabs Model ID (e.g. eleven_multilingual_v2)"
                                                            className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                        />
                                                        <input
                                                            value={ref.elevenLabsOutputFormat || ''}
                                                            onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, elevenLabsOutputFormat: e.target.value } : r))}
                                                            placeholder="ElevenLabs Output Format (e.g. mp3_44100_128)"
                                                            className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                        />
                                                    </div>
                                                    <textarea
                                                        value={ref.backstory || ''}
                                                        onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, backstory: e.target.value } : r))}
                                                        placeholder="Backstory & history"
                                                        rows={2}
                                                        className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                    />
                                                    <textarea
                                                        value={ref.characterGoals || ''}
                                                        onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, characterGoals: e.target.value } : r))}
                                                        placeholder="Needs, goals, or motivations"
                                                        rows={2}
                                                        className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                    />
                                                    <textarea
                                                        value={ref.characterArc || ''}
                                                        onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, characterArc: e.target.value } : r))}
                                                        placeholder="Arc / change over story"
                                                        rows={2}
                                                        className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                    />
                                                    <textarea
                                                        value={ref.designNotes || ''}
                                                        onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, designNotes: e.target.value } : r))}
                                                        placeholder="Design notes (wardrobe, silhouette, materials)"
                                                        rows={2}
                                                        className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                    />

                                                    {(ref.outfits || []).length > 0 && (
                                                        <div className="pt-2 border-t border-gray-700/60 space-y-2">
                                                            <div className="text-[10px] uppercase tracking-wide text-gray-500">Outfit Variations</div>
                                                            <div className="grid grid-cols-1 gap-2">
                                                                {(ref.outfits || []).map(outfit => (
                                                                    <div key={outfit.id} className="flex gap-2 bg-gray-900/60 border border-gray-700 rounded-lg p-2">
                                                                        <div className="w-16 h-16 bg-gray-800 rounded-md overflow-hidden flex items-center justify-center text-gray-500 text-[10px]">
                                                                            {outfit.imageUrl ? (
                                                                                <img src={outfit.imageUrl} className="w-full h-full object-cover" alt={outfit.name} />
                                                                            ) : (
                                                                                <span>{outfit.isGenerating ? '...' : 'No Image'}</span>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex-1 space-y-1">
                                                                            <input
                                                                                value={outfit.name}
                                                                                onChange={(e) => updateCharacterOutfit(ref.id, outfit.id, { name: e.target.value })}
                                                                                className="w-full bg-gray-800 text-white text-xs p-1.5 rounded border border-gray-600 focus:border-indigo-500"
                                                                            />
                                                                            <textarea
                                                                                value={outfit.prompt}
                                                                                onChange={(e) => updateCharacterOutfit(ref.id, outfit.id, { prompt: e.target.value })}
                                                                                rows={2}
                                                                                className="w-full bg-gray-800 text-white text-[10px] p-1.5 rounded border border-gray-600 focus:border-indigo-500"
                                                                            />
                                                                            <div className="flex flex-wrap gap-2">
                                                                                <button
                                                                                    onClick={() => handleRegenerateOutfitImage(ref.id, outfit.id)}
                                                                                    className="text-[10px] px-2 py-1 rounded bg-gray-700 text-white hover:bg-gray-600"
                                                                                >
                                                                                    {outfit.isGenerating ? 'Generating...' : 'Regenerate'}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            />
                                        ))}
                                    <button onClick={() => setReferences(prev => [...prev, { id: `char-${Date.now()}`, type: 'character', name: 'New Character', description: '', prompt: '', imageUrl: null, isGenerating: false, tags: [] }])} className="aspect-[3/4] rounded-xl border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 hover:border-indigo-500 hover:text-indigo-400 transition-all group bg-gray-900/30">
                                        <div className="w-12 h-12 rounded-full border-2 border-gray-600 flex items-center justify-center group-hover:border-indigo-500 mb-2 transition-colors">
                                            <span className="text-2xl font-light">+</span>
                                        </div>
                                        <span className="text-sm font-medium">Add Character</span>
                                    </button>
                                </div>
                            </div>

                            {/* Environments Section */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="p-2 bg-teal-500/20 rounded-lg">
                                        <LandscapeIcon className="w-6 h-6 text-teal-400"/>
                                    </div>
                                    <h3 className="text-xl font-bold text-white">Environments</h3>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                    {references.filter(r => r.type === 'environment').map(ref => (
                                        <ReferenceCard
                                            key={ref.id}
                                            reference={ref}
                                            onUpdate={(id, u) => setReferences(prev => prev.map(r => r.id === id ? {...r, ...u} : r))}
                                            onGenerateDetails={async (id) => {
                                                const { prompt, tags } = await generateReferenceDetails(
                                                    ref.type,
                                                    ref.name,
                                                    ref.description,
                                                    storyBible.script,
                                                    stylePrompt
                                                );
                                                setReferences(prev => prev.map(r => r.id === id ? { ...r, prompt, tags } : r));
                                            }}
                                            onRegenerateImage={async (id) => {
                                                 setReferences(prev => prev.map(r => r.id === id ? { ...r, isGenerating: true } : r));
                                                 try {
                                                     const imagePrompt = composeReferencePrompt(ref);
                                                     const img = await generateReferenceImage(imagePrompt, referenceAspectRatio, ref.imageUrl || undefined);
                                                     const stableUrl = await stabilizeReferenceImageUrl(ref, img.url);
                                                     setReferences(prev => prev.map(r => r.id === id ? { ...r, imageUrl: stableUrl, isGenerating: false } : r));
                                                 } catch(e) {
                                                     setReferences(prev => prev.map(r => r.id === id ? { ...r, isGenerating: false } : r));
                                                     handleError(e);
                                                 }
                                            }}
                                            onUpload={(id, file) => setReferences(prev => prev.map(r => r.id === id ? { ...r, imageUrl: URL.createObjectURL(file) } : r))}
                                            onRemove={(id) => setReferences(prev => prev.filter(r => r.id !== id))}
                                            onViewFull={(url, title) => setFullResView({ url, title })}
                                            extraContent={(
                                                <div>
                                                    <label className="text-[10px] uppercase tracking-wide text-gray-500">Time of Day</label>
                                                    <select
                                                        value={ref.environmentTimeOfDay || 'auto'}
                                                        onChange={(e) => setReferences(prev => prev.map(r => r.id === ref.id ? { ...r, environmentTimeOfDay: e.target.value as any } : r))}
                                                        className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                    >
                                                        {ENVIRONMENT_TIME_OPTIONS.map(option => (
                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}
                                            />
                                    ))}
                                     <button onClick={() => setReferences(prev => [...prev, { id: `env-${Date.now()}`, type: 'environment', name: 'New Location', description: '', prompt: '', imageUrl: null, isGenerating: false, tags: [] }])} className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 hover:border-teal-500 hover:text-teal-400 transition-all group bg-gray-900/30">
                                        <div className="w-12 h-12 rounded-full border-2 border-gray-600 flex items-center justify-center group-hover:border-teal-500 mb-2 transition-colors">
                                            <span className="text-2xl font-light">+</span>
                                        </div>
                                        <span className="text-sm font-medium">Add Location</span>
                                    </button>
                                </div>
                            </div>

                            {/* Props & Insignia Section */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="p-2 bg-amber-500/20 rounded-lg">
                                        <BoxIcon className="w-6 h-6 text-amber-400"/>
                                    </div>
                                    <h3 className="text-xl font-bold text-white">Props, Weapons & Insignia</h3>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                    {references.filter(r => r.type === 'prop').map(ref => (
                                        <ReferenceCard
                                            key={ref.id}
                                            reference={ref}
                                            onUpdate={(id, u) => setReferences(prev => prev.map(r => r.id === id ? {...r, ...u} : r))}
                                            onGenerateDetails={async (id) => {
                                                const { prompt, tags } = await generateReferenceDetails(
                                                    'prop',
                                                    ref.name,
                                                    ref.description,
                                                    storyBible.script,
                                                    stylePrompt
                                                );
                                                setReferences(prev => prev.map(r => r.id === id ? { ...r, prompt, tags } : r));
                                            }}
                                            onRegenerateImage={async (id) => {
                                                 setReferences(prev => prev.map(r => r.id === id ? { ...r, isGenerating: true } : r));
                                                 try {
                                                     const imagePrompt = composeReferencePrompt(ref);
                                                     const img = await generateReferenceImage(imagePrompt, referenceAspectRatio, ref.imageUrl || undefined);
                                                     setReferences(prev => prev.map(r => r.id === id ? { ...r, imageUrl: img.url, isGenerating: false } : r));
                                                 } catch(e) {
                                                     setReferences(prev => prev.map(r => r.id === id ? { ...r, isGenerating: false } : r));
                                                     handleError(e);
                                                 }
                                            }}
                                            onUpload={(id, file) => setReferences(prev => prev.map(r => r.id === id ? { ...r, imageUrl: URL.createObjectURL(file) } : r))}
                                            onRemove={(id) => setReferences(prev => prev.filter(r => r.id !== id))}
                                            onViewFull={(url, title) => setFullResView({ url, title })}
                                        />
                                    ))}
                                     <button onClick={() => setReferences(prev => [...prev, { id: `prop-${Date.now()}`, type: 'prop', name: 'New Prop', description: '', prompt: '', imageUrl: null, isGenerating: false, tags: [] }])} className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-700 flex flex-col items-center justify-center text-gray-500 hover:border-amber-500 hover:text-amber-400 transition-all group bg-gray-900/30">
                                        <div className="w-12 h-12 rounded-full border-2 border-gray-600 flex items-center justify-center group-hover:border-amber-500 mb-2 transition-colors">
                                            <span className="text-2xl font-light">+</span>
                                        </div>
                                        <span className="text-sm font-medium">Add Prop/Emblem</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Storyboard Phase */}
                    {activePhase === 'storyboard' && (
                         <div className="space-y-6">
                             <div className="flex justify-between items-center sticky top-0 bg-gray-900/95 backdrop-blur z-30 py-4 border-b border-gray-800">
                                <div>
                                    <h2 className="text-2xl font-bold text-white">Storyboard</h2>
                                    <p className="text-gray-400 text-sm">Visualize the narrative flow. Click "Edit" to refine prompts.</p>
                                </div>
                                <div className="flex gap-3 flex-wrap">
                                    <AspectRatioPicker value={referenceAspectRatio} onChange={setReferenceAspectRatio} />
                                    <div className="flex items-center gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700 mr-2">
                                        {(referenceImageModel === 'gemini-pro' || referenceImageModel === 'seedream') && (
                                            <select
                                                value={imageSize}
                                                onChange={(e) => setImageSize(e.target.value as any)}
                                                className="bg-gray-700 text-white text-xs font-bold py-1 px-2 rounded focus:outline-none"
                                            >
                                                {referenceImageModel === 'seedream' ? (
                                                    <>
                                                        <option value="2K">2K</option>
                                                        <option value="4K">4K</option>
                                                    </>
                                                ) : (
                                                    <>
                                                        <option value="1K">1K</option>
                                                        <option value="2K">2K</option>
                                                        <option value="4K">4K</option>
                                                    </>
                                                )}
                                            </select>
                                        )}
                                        <div className="h-4 w-px bg-gray-600"></div>
                                        <span className="text-xs font-bold text-gray-400 px-2">Model:</span>
                                        <button onClick={() => setReferenceImageModel('gemini-pro')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'gemini-pro' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Gemini 3 Pro</button>
                                        <button onClick={() => setReferenceImageModel('qwen-2512')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'qwen-2512' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Qwen 2512</button>
                                        <button onClick={() => setReferenceImageModel('qwen')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'qwen' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Qwen 2511 (Context)</button>
                                        <button onClick={() => setReferenceImageModel('nano')} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'nano' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Flash (Fast)</button>
                                        <button onClick={() => { if (imageSize === '1K') setImageSize('2K'); setReferenceImageModel('seedream'); }} className={`px-3 py-1 rounded text-xs font-bold transition-colors ${referenceImageModel === 'seedream' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Seedream 4.5</button>
                                    </div>
                                    <div className="flex items-center gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
                                        <div className="flex items-center gap-1 pl-1">
                                            <CameraIcon className="w-4 h-4 text-gray-400"/>
                                            <span className="text-xs font-bold text-gray-400">Camera</span>
                                        </div>
                                        <select
                                            value={cameraPresetId}
                                            onChange={(e) => setCameraPresetId(e.target.value)}
                                            className="bg-gray-700 text-white text-xs font-bold py-1 px-2 rounded focus:outline-none"
                                        >
                                            {CAMERA_PRESETS.map(preset => (
                                                <option key={preset.id} value={preset.id}>{preset.label}</option>
                                            ))}
                                        </select>
                                        <div className="flex items-center gap-1">
                                            <ApertureIcon className="w-4 h-4 text-gray-400"/>
                                            <span className="text-xs font-bold text-gray-400">Lens</span>
                                        </div>
                                        <select
                                            value={lensPresetId}
                                            onChange={(e) => setLensPresetId(e.target.value)}
                                            className="bg-gray-700 text-white text-xs font-bold py-1 px-2 rounded focus:outline-none"
                                        >
                                            {LENS_PRESETS.map(preset => (
                                                <option key={preset.id} value={preset.id}>{preset.label}</option>
                                            ))}
                                        </select>
                                        {selectedLensPreset?.aspectRatioOverride && (
                                            <span className="text-[10px] text-amber-300 font-semibold px-2" title="Lens overrides aspect ratio">
                                                Auto AR {selectedLensPreset.aspectRatioOverride}
                                            </span>
                                        )}
                                        {shotPrompts.length > 0 && (
                                            <button
                                                onClick={applyCameraLensToAllShots}
                                                className="px-3 py-1 rounded text-xs font-bold bg-gray-700 text-white hover:bg-gray-600"
                                            >
                                                Apply to All
                                            </button>
                                        )}
                                    </div>
                                    {shotPrompts.length === 0 && (
                                        <button onClick={handleGenerateStoryboard} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg transition-transform transform hover:scale-105">
                                            Generate from Script
                                        </button>
                                    )}
                                    {shotPrompts.length > 0 && (
                                        <button
                                            onClick={handleGenerateAllShotImages}
                                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg flex items-center gap-2 transition-transform transform hover:scale-105"
                                        >
                                            <MagicWandIcon className="w-5 h-5"/> Generate All Shots
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setActivePhase('filming')}
                                        className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg flex items-center gap-2 transition-transform transform hover:scale-105"
                                    >
                                        Next: Filming <span className="text-green-200">→</span>
                                    </button>
                                </div>
                            </div>

                            {shotPrompts.length > 0 && (
                                <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-4">
                                    <div className="flex flex-col gap-4">
                                        <div className="flex flex-col lg:flex-row gap-3 items-start">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Insert after</span>
                                                <select
                                                    value={extraShotInsertAfter}
                                                    onChange={(e) => setExtraShotInsertAfter(Number(e.target.value))}
                                                    className="bg-gray-700 text-white text-xs font-bold py-1 px-2 rounded focus:outline-none"
                                                >
                                                    {shotPrompts
                                                        .slice()
                                                        .sort((a, b) => a.shot - b.shot)
                                                        .map(shot => (
                                                            <option key={shot.shot} value={shot.shot}>Shot {shot.shot}</option>
                                                        ))}
                                                </select>
                                            </div>
                                            <textarea
                                                value={extraShotIdea}
                                                onChange={(e) => setExtraShotIdea(e.target.value)}
                                                placeholder="Extra shot idea or type (e.g., 'insert close-up of the pendant under rain')"
                                                className="flex-1 min-h-[60px] bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm text-gray-200"
                                            />
                                            <button
                                                onClick={handleGenerateExtraShot}
                                                disabled={isGeneratingExtraShot || !extraShotIdea.trim()}
                                                className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg text-sm"
                                            >
                                                {isGeneratingExtraShot ? 'Generating...' : 'Add Extra Shot'}
                                            </button>
                                        </div>
                                        {extraShotSuggestions.length > 0 && (
                                            <div className="flex flex-col gap-2">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Suggested references</span>
                                                    <button
                                                        onClick={() => addReferenceSuggestions(extraShotSuggestions)}
                                                        className="text-xs font-semibold text-indigo-300 hover:text-indigo-200"
                                                    >
                                                        Add all
                                                    </button>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    {extraShotSuggestions.map((ref) => (
                                                        <button
                                                            key={`${ref.type}-${ref.name}`}
                                                            onClick={() => addReferenceSuggestions([ref])}
                                                            className="text-xs font-semibold bg-gray-900 border border-gray-700 text-gray-200 px-3 py-1 rounded-full hover:border-indigo-500"
                                                        >
                                                            Add {ref.type}: {ref.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {shotPrompts.length > 0 ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 pb-20">
                                    {shotPrompts.map(shot => {
                                        const cameraPreset = CAMERA_PRESETS.find(preset => preset.id === (shot.cameraPresetId || cameraPresetId));
                                        const lensPreset = LENS_PRESETS.find(preset => preset.id === (shot.lensPresetId || lensPresetId));
                                        const cameraLabel = cameraPreset?.label || 'Auto';
                                        const lensLabel = lensPreset?.label || 'Auto';
                                        const voiceMatches = getShotVoiceMatches(shot);
                                        const voiceCharacter = resolveShotVoiceCharacter(shot);
                                        const hasVoiceConflict = voiceMatches.length > 1 && !shot.voiceCharacterId;
                                        const hasVoiceOverrideMismatch = !!shot.voiceCharacterId && voiceMatches.length > 0 && !voiceMatches.some(match => match.id === shot.voiceCharacterId);
                                        const shotUploadId = `shot-upload-${shot.shot}`;
                                        const poseSourceUploadId = `pose-source-upload-${shot.shot}`;
                                        const poseMapUploadId = `pose-map-upload-${shot.shot}`;
                                        const contextReferences = shot.contextReferences || [];

                                        return (
                                        <div key={shot.shot} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 shadow-lg flex flex-col transition-all hover:border-indigo-500/30">
                                            <div className="relative aspect-video bg-black group">
                                                <input
                                                    id={shotUploadId}
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (!file) return;
                                                        const url = URL.createObjectURL(file);
                                                        setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, imageUrl: url } : s));
                                                        e.currentTarget.value = '';
                                                    }}
                                                />
                                                {shot.isSketching ? (
                                                    <div className="w-full h-full bg-gray-900 relative">
                                                        <SketchCanvas
                                                            width={420}
                                                            height={236}
                                                            className="w-full h-full"
                                                            initialImage={shot.sketchUrl || shot.imageUrl}
                                                            onSave={(dataUrl) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {...s, sketchUrl: dataUrl, isSketching: false} : s))}
                                                        />
                                                        <button
                                                            onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {...s, isSketching: false} : s))}
                                                            className="absolute top-2 right-2 text-xs bg-gray-700 text-white px-2 py-1 rounded"
                                                        >
                                                            Done
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {shot.imageUrl ? (
                                                            <img src={shot.imageUrl} className="w-full h-full object-cover"/>
                                                        ) : shot.sketchUrl ? (
                                                            <img src={shot.sketchUrl} className="w-full h-full object-contain bg-gray-900 opacity-80"/>
                                                        ) : (
                                                            <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 bg-gray-900">
                                                                <GridIcon className="w-12 h-12 opacity-20 mb-2"/>
                                                                <p className="text-xs font-medium uppercase tracking-widest opacity-50">Shot {shot.shot}</p>
                                                            </div>
                                                        )}

                                                        {!shot.isGenerating && (
                                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2 items-center justify-center">
                                                                <button onClick={() => handleGenerateShotImage(shot.shot)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-full flex items-center gap-2 shadow-lg transform transition-transform hover:scale-110">
                                                                    <MagicWandIcon className="w-4 h-4"/>
                                                                    {shot.imageUrl ? 'Regenerate' : 'Generate Shot'}
                                                                </button>
                                                                <button
                                                                    onClick={() => document.getElementById(shotUploadId)?.click()}
                                                                    className="bg-gray-800/90 hover:bg-gray-700 text-white text-xs font-bold py-1.5 px-4 rounded-full flex items-center gap-2"
                                                                >
                                                                    <PlayIcon className="w-3 h-3"/>
                                                                    Upload Frame
                                                                </button>
                                                                <button onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {...s, isSketching: true} : s))} className="bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-1.5 px-4 rounded-full flex items-center gap-2">
                                                                    <BrushIcon className="w-3 h-3"/>
                                                                    {shot.sketchUrl ? 'Edit Sketch' : 'Sketch Layout'}
                                                                </button>
                                                                {(shot.imageUrl || shot.sketchUrl) && (
                                                                    <button
                                                                        onClick={() => setFullResView({ url: shot.imageUrl || shot.sketchUrl!, title: `Shot ${shot.shot}` })}
                                                                        className="bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-1.5 px-4 rounded-full"
                                                                    >
                                                                        Full View
                                                                    </button>
                                                                )}
                                                                <button
                                                                    onClick={() => setActiveInpaintShotId(shot.shot)}
                                                                    disabled={!shot.imageUrl}
                                                                    className="bg-gray-800/90 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold py-1.5 px-4 rounded-full flex items-center gap-2"
                                                                >
                                                                    <SparklesIcon className="w-3 h-3"/>
                                                                    Inpaint Shot
                                                                </button>
                                                            </div>
                                                        )}

                                                        {shot.isGenerating && (
                                                             <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
                                                                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-indigo-400 mb-2"></div>
                                                                <span className="text-xs font-bold text-indigo-400">Creating...</span>
                                                            </div>
                                                        )}

                                                        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md text-white text-xs font-black px-2.5 py-1 rounded-md border border-white/10">
                                                            SHOT {shot.shot}
                                                        </div>
                                                        {shot.sketchUrl && (
                                                             <div className="absolute top-3 right-3 bg-blue-900/80 backdrop-blur-md text-blue-200 text-[10px] font-bold px-2 py-1 rounded border border-blue-500/30 flex items-center gap-1">
                                                                <BrushIcon className="w-3 h-3"/> SKETCH REF
                                                            </div>
                                                        )}
                                                        {shot.openPoseReferenceUrl && (
                                                            <div className="absolute top-12 right-3 bg-emerald-900/80 backdrop-blur-md text-emerald-200 text-[10px] font-bold px-2 py-1 rounded border border-emerald-500/30">
                                                                POSE MAP
                                                            </div>
                                                        )}

                                                        {shot.aiFeedback && (
                                                            <div className="absolute bottom-0 left-0 right-0 bg-yellow-900/90 text-yellow-100 text-xs p-2 border-t border-yellow-500/50">
                                                                <span className="font-bold mr-1">💡 Suggestion:</span> {shot.aiFeedback}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>

                                            <div className="p-4 flex-grow flex flex-col">
                                                <div className="flex justify-between items-start mb-2">
                                                    <h4 className="font-bold text-white text-sm line-clamp-1">Action Description</h4>
                                                    <button
                                                        onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {...s, isEditing: !s.isEditing} : s))}
                                                        className={`p-1 rounded hover:bg-gray-700 ${shot.isEditing ? 'text-indigo-400' : 'text-gray-500'}`}
                                                    >
                                                        <EditIcon className="w-4 h-4"/>
                                                    </button>
                                                </div>

                                                {shot.isEditing ? (
                                                    <div className="space-y-2 animate-fadeIn">
                                                        <textarea
                                                            value={shot.description}
                                                            onChange={e => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {...s, description: e.target.value} : s))}
                                                            className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                            rows={2}
                                                        />
                                                        <textarea
                                                            value={shot.prompt}
                                                            onChange={e => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {...s, prompt: e.target.value} : s))}
                                                            className="w-full bg-gray-900 text-indigo-200 text-xs p-2 rounded border border-gray-600 focus:border-indigo-500 font-mono"
                                                            rows={3}
                                                            placeholder="Image Prompt..."
                                                        />
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div>
                                                                <label className="text-[10px] uppercase tracking-wide text-gray-500 flex items-center gap-1">
                                                                    <CameraIcon className="w-3 h-3 text-gray-500"/>
                                                                    Camera
                                                                </label>
                                                                <select
                                                                    value={shot.cameraPresetId || cameraPresetId}
                                                                    onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {...s, cameraPresetId: e.target.value } : s))}
                                                                    className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                                >
                                                                    {CAMERA_PRESETS.map(preset => (
                                                                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="text-[10px] uppercase tracking-wide text-gray-500 flex items-center gap-1">
                                                                    <ApertureIcon className="w-3 h-3 text-gray-500"/>
                                                                    Lens
                                                                </label>
                                                                <select
                                                                    value={shot.lensPresetId || lensPresetId}
                                                                    onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {...s, lensPresetId: e.target.value } : s))}
                                                                    className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                                >
                                                                    {LENS_PRESETS.map(preset => (
                                                                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div className="pt-2 border-t border-gray-700/60">
                                                            <div className="flex items-center justify-between mb-2">
                                                                <span className="text-[10px] uppercase tracking-wide text-gray-500">Continuity Context</span>
                                                                <span className="text-[10px] text-gray-500">
                                                                    {shot.usePreviousShotContext === true ? 'Forced On' : shot.usePreviousShotContext === false ? 'Forced Off' : 'Auto'}
                                                                </span>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                        ...s,
                                                                        usePreviousShotContext: undefined,
                                                                        previousShotContextReason: undefined
                                                                    } : s))}
                                                                    className={`px-2 py-1 rounded text-[10px] font-bold ${shot.usePreviousShotContext === undefined ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                                                                >
                                                                    Auto
                                                                </button>
                                                                <button
                                                                    onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                        ...s,
                                                                        usePreviousShotContext: true,
                                                                        previousShotContextReason: 'Forced on by user'
                                                                    } : s))}
                                                                    className={`px-2 py-1 rounded text-[10px] font-bold ${shot.usePreviousShotContext === true ? 'bg-emerald-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                                                                >
                                                                    Force On
                                                                </button>
                                                                <button
                                                                    onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                        ...s,
                                                                        usePreviousShotContext: false,
                                                                        previousShotContextReason: 'Forced off by user'
                                                                    } : s))}
                                                                    className={`px-2 py-1 rounded text-[10px] font-bold ${shot.usePreviousShotContext === false ? 'bg-gray-600 text-white' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'}`}
                                                                >
                                                                    Force Off
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <div className="pt-2 border-t border-gray-700/60 space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[10px] uppercase tracking-wide text-gray-500">Voiceover (ElevenLabs)</span>
                                                                {shot.voiceoverUrl && (
                                                                    <button
                                                                        onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, voiceoverUrl: undefined } : s))}
                                                                        className="text-[10px] text-red-300 hover:text-red-200 font-semibold"
                                                                    >
                                                                        Clear
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <textarea
                                                                value={shot.voiceoverText || ''}
                                                                onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, voiceoverText: e.target.value } : s))}
                                                                placeholder="Voiceover text for this shot..."
                                                                rows={3}
                                                                className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                            />
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <label className="text-[10px] uppercase tracking-wide text-gray-500">Voice Character</label>
                                                                    <select
                                                                        value={shot.voiceCharacterId || 'auto'}
                                                                        onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                            ...s,
                                                                            voiceCharacterId: e.target.value === 'auto' ? undefined : e.target.value
                                                                        } : s))}
                                                                        className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-600 focus:border-indigo-500"
                                                                    >
                                                                        <option value="auto">Auto (match shot)</option>
                                                                        {references.filter(r => r.type === 'character').map(ref => (
                                                                            <option key={ref.id} value={ref.id}>{ref.name}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <label className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-gray-500">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={shot.voiceChangerEnabled ?? true}
                                                                        onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, voiceChangerEnabled: e.target.checked } : s))}
                                                                    />
                                                                    Voice Changer
                                                                </label>
                                                            </div>
                                                            {hasVoiceConflict && (
                                                                <p className="text-[10px] text-amber-300">Multiple cast matches: {voiceMatches.map(match => match.name).join(', ')}. Select a voice.</p>
                                                            )}
                                                            {hasVoiceOverrideMismatch && (
                                                                <p className="text-[10px] text-amber-300">Selected voice is not in this shot’s cast.</p>
                                                            )}
                                                            {!shot.voiceCharacterId && voiceMatches.length === 0 && (shot.voiceChangerEnabled ?? true) && (
                                                                <p className="text-[10px] text-gray-500">No cast match — using default ElevenLabs voice.</p>
                                                            )}
                                                            <button
                                                                onClick={() => handleGenerateShotVoiceover(shot.shot)}
                                                                disabled={!shot.voiceoverText?.trim() || shot.voiceoverIsGenerating}
                                                                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white font-bold py-2 rounded-lg text-xs"
                                                            >
                                                                {shot.voiceoverIsGenerating ? 'Generating Voice...' : 'Generate Voiceover'}
                                                            </button>
                                                            {shot.voiceoverUrl && (
                                                                <audio controls src={shot.voiceoverUrl} className="w-full" />
                                                            )}
                                                        </div>
                                                        <div className="pt-2 border-t border-gray-700/60">
                                                            <div className="flex items-center justify-between mb-2">
                                                                <span className="text-[10px] uppercase tracking-wide text-gray-500">Context References</span>
                                                                <button
                                                                    onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                        ...s,
                                                                        contextReferences: [
                                                                            ...(s.contextReferences || []),
                                                                            { id: `ctx-${Date.now()}`, name: '', purpose: '', tag: 'other', imageUrl: undefined }
                                                                        ]
                                                                    } : s))}
                                                                    className="text-[10px] text-indigo-300 hover:text-indigo-200 font-semibold"
                                                                >
                                                                    + Add
                                                                </button>
                                                            </div>
                                                            <div className="space-y-2">
                                                                {contextReferences.map((ref, index) => {
                                                                    const refUploadId = `ctx-upload-${shot.shot}-${ref.id}`;
                                                                    return (
                                                                        <div key={ref.id} className="flex gap-2 bg-gray-900/60 border border-gray-700 rounded-lg p-2">
                                                                            <input
                                                                                id={refUploadId}
                                                                                type="file"
                                                                                accept="image/*"
                                                                                className="hidden"
                                                                                onChange={(e) => {
                                                                                    const file = e.target.files?.[0];
                                                                                    if (!file) return;
                                                                                    const url = URL.createObjectURL(file);
                                                                                    setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                        ...s,
                                                                                        contextReferences: (s.contextReferences || []).map(ctx => ctx.id === ref.id ? { ...ctx, imageUrl: url } : ctx)
                                                                                    } : s));
                                                                                    e.currentTarget.value = '';
                                                                                }}
                                                                            />
                                                                            <div className="w-16 h-16 bg-gray-800 rounded-md overflow-hidden flex items-center justify-center text-gray-500 text-[10px]">
                                                                                {ref.imageUrl ? (
                                                                                    <img src={ref.imageUrl} className="w-full h-full object-cover" alt={ref.name || `Context ${index + 1}`} />
                                                                                ) : (
                                                                                    <span>No Image</span>
                                                                                )}
                                                                            </div>
                                                                            <div className="flex-1 space-y-1">
                                                                                <input
                                                                                    value={ref.name}
                                                                                    onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                        ...s,
                                                                                        contextReferences: (s.contextReferences || []).map(ctx => ctx.id === ref.id ? { ...ctx, name: e.target.value } : ctx)
                                                                                    } : s))}
                                                                                    placeholder="Name (e.g., Wardrobe)"
                                                                                    className="w-full bg-gray-800 text-white text-xs p-1.5 rounded border border-gray-600 focus:border-indigo-500"
                                                                                />
                                                                                <input
                                                                                    value={ref.purpose}
                                                                                    onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                        ...s,
                                                                                        contextReferences: (s.contextReferences || []).map(ctx => ctx.id === ref.id ? { ...ctx, purpose: e.target.value } : ctx)
                                                                                    } : s))}
                                                                                    placeholder="Purpose (e.g., match lighting)"
                                                                                    className="w-full bg-gray-800 text-white text-xs p-1.5 rounded border border-gray-600 focus:border-indigo-500"
                                                                                />
                                                                                <select
                                                                                    value={ref.tag || 'other'}
                                                                                    onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                        ...s,
                                                                                        contextReferences: (s.contextReferences || []).map(ctx => ctx.id === ref.id ? { ...ctx, tag: e.target.value as any } : ctx)
                                                                                    } : s))}
                                                                                    className="w-full bg-gray-800 text-white text-xs p-1.5 rounded border border-gray-600 focus:border-indigo-500"
                                                                                >
                                                                                    {CONTEXT_TAG_OPTIONS.map(option => (
                                                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                                                    ))}
                                                                                </select>
                                                                                <div className="flex flex-wrap gap-2">
                                                                                    <button
                                                                                        onClick={() => document.getElementById(refUploadId)?.click()}
                                                                                        className="text-[10px] px-2 py-1 rounded bg-gray-700 text-white hover:bg-gray-600"
                                                                                    >
                                                                                        Upload
                                                                                    </button>
                                                                                    {ref.imageUrl && (
                                                                                        <button
                                                                                            onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                                ...s,
                                                                                                contextReferences: (s.contextReferences || []).map(ctx => ctx.id === ref.id ? { ...ctx, imageUrl: undefined } : ctx)
                                                                                            } : s))}
                                                                                            className="text-[10px] px-2 py-1 rounded bg-gray-700 text-white hover:bg-gray-600"
                                                                                        >
                                                                                            Clear
                                                                                        </button>
                                                                                    )}
                                                                                    <button
                                                                                        onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                            ...s,
                                                                                            contextReferences: (s.contextReferences || []).filter(ctx => ctx.id !== ref.id)
                                                                                        } : s))}
                                                                                        className="text-[10px] px-2 py-1 rounded bg-red-900/60 text-red-200 hover:bg-red-700"
                                                                                    >
                                                                                        Remove
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                        <div className="pt-2 border-t border-gray-700/60 space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[10px] uppercase tracking-wide text-gray-500">OpenPose Composition</span>
                                                                {shot.openPoseReferenceUrl && (
                                                                    <button
                                                                        onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, openPoseReferenceUrl: undefined } : s))}
                                                                        className="text-[10px] text-gray-400 hover:text-gray-200"
                                                                    >
                                                                        Clear Pose
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <p className="text-[10px] text-gray-500">Lock character position with a pose map. Upload a frame or pick a preset.</p>
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-2 space-y-2">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-[10px] uppercase tracking-wide text-gray-500">Pose Source</span>
                                                                        <div className="flex items-center gap-2">
                                                                            <input
                                                                                id={poseSourceUploadId}
                                                                                type="file"
                                                                                accept="image/*"
                                                                                className="hidden"
                                                                                onChange={(e) => {
                                                                                    const file = e.target.files?.[0];
                                                                                    if (!file) return;
                                                                                    const url = URL.createObjectURL(file);
                                                                                    setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                        ...s,
                                                                                        openPoseSourceUrl: url,
                                                                                        openPoseReferenceUrl: undefined,
                                                                                        openPoseIsGenerating: false
                                                                                    } : s));
                                                                                    e.currentTarget.value = '';
                                                                                }}
                                                                            />
                                                                            <button
                                                                                onClick={() => document.getElementById(poseSourceUploadId)?.click()}
                                                                                className="text-[10px] text-indigo-300 hover:text-indigo-200 font-semibold"
                                                                            >
                                                                                {shot.openPoseSourceUrl ? 'Replace' : 'Upload'}
                                                                            </button>
                                                                            {shot.openPoseSourceUrl && (
                                                                                <button
                                                                                    onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                        ...s,
                                                                                        openPoseSourceUrl: undefined
                                                                                    } : s))}
                                                                                    className="text-[10px] text-gray-400 hover:text-gray-200"
                                                                                >
                                                                                    Clear
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {shot.openPoseSourceUrl ? (
                                                                        <img src={shot.openPoseSourceUrl} className="w-full h-24 object-cover rounded border border-gray-700" alt={`Shot ${shot.shot} pose source`} />
                                                                    ) : (
                                                                        <div className="w-full h-24 rounded border border-dashed border-gray-700 flex items-center justify-center text-[10px] text-gray-500">
                                                                            Upload a pose source image
                                                                        </div>
                                                                    )}
                                                                    <button
                                                                        onClick={() => handleGenerateOpenPose(shot.shot)}
                                                                        disabled={!shot.openPoseSourceUrl || shot.openPoseIsGenerating}
                                                                        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white text-[10px] font-bold py-1.5 rounded"
                                                                    >
                                                                        {shot.openPoseIsGenerating ? 'Generating OpenPose...' : 'Generate OpenPose'}
                                                                    </button>
                                                                </div>
                                                                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-2 space-y-2">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-[10px] uppercase tracking-wide text-gray-500">Pose Map (OpenPose)</span>
                                                                        <div className="flex items-center gap-2">
                                                                            <input
                                                                                id={poseMapUploadId}
                                                                                type="file"
                                                                                accept="image/*"
                                                                                className="hidden"
                                                                                onChange={(e) => {
                                                                                    const file = e.target.files?.[0];
                                                                                    if (!file) return;
                                                                                    const url = URL.createObjectURL(file);
                                                                                    setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                        ...s,
                                                                                        openPoseReferenceUrl: url,
                                                                                        openPoseIsGenerating: false
                                                                                    } : s));
                                                                                    e.currentTarget.value = '';
                                                                                }}
                                                                            />
                                                                            <button
                                                                                onClick={() => document.getElementById(poseMapUploadId)?.click()}
                                                                                className="text-[10px] text-indigo-300 hover:text-indigo-200 font-semibold"
                                                                            >
                                                                                {shot.openPoseReferenceUrl ? 'Replace' : 'Upload'}
                                                                            </button>
                                                                            {shot.openPoseReferenceUrl && (
                                                                                <button
                                                                                    onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                        ...s,
                                                                                        openPoseReferenceUrl: undefined
                                                                                    } : s))}
                                                                                    className="text-[10px] text-gray-400 hover:text-gray-200"
                                                                                >
                                                                                    Clear
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {shot.openPoseReferenceUrl ? (
                                                                        <img src={shot.openPoseReferenceUrl} className="w-full h-24 object-cover rounded border border-gray-700" alt={`Shot ${shot.shot} pose map`} />
                                                                    ) : (
                                                                        <div className="w-full h-24 rounded border border-dashed border-gray-700 flex items-center justify-center text-[10px] text-gray-500">
                                                                            Upload a pose map or pick a preset
                                                                        </div>
                                                                    )}
                                                                    {shot.openPoseReferenceUrl && (
                                                                        <button
                                                                            onClick={() => setFullResView({ url: shot.openPoseReferenceUrl!, title: `Shot ${shot.shot} Pose Map` })}
                                                                            className="text-[10px] text-gray-400 hover:text-gray-200"
                                                                        >
                                                                            View Full
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {POSE_PRESETS.map(preset => (
                                                                    <button
                                                                        key={preset.id}
                                                                        onClick={() => {
                                                                            const url = renderPosePreset(preset);
                                                                            if (!url) return;
                                                                            setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? {
                                                                                ...s,
                                                                                openPoseReferenceUrl: url,
                                                                                openPoseIsGenerating: false
                                                                            } : s));
                                                                        }}
                                                                        className="text-[10px] px-2 py-1 rounded bg-gray-700 text-white hover:bg-gray-600"
                                                                    >
                                                                        {preset.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        <p className="text-gray-300 text-sm leading-snug line-clamp-3">{shot.description}</p>
                                                        <div className="mt-auto pt-3 border-t border-gray-700/50">
                                                            <p className="text-gray-500 text--[10px] uppercase tracking-wider font-bold mb-1">Prompt</p>
                                                            <p className="text-indigo-300/70 text-xs font-mono line-clamp-2">{shot.prompt}</p>
                                                        </div>
                                                        <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                                                            Camera: <span className="text-gray-300 font-semibold">{cameraLabel}</span> · Lens: <span className="text-gray-300 font-semibold">{lensLabel}</span>
                                                        </div>
                                                        {shot.usePreviousShotContext && (
                                                            <div className="text-[10px] text-emerald-300 uppercase tracking-wider font-bold" title={shot.previousShotContextReason || ''}>
                                                                Continuity: Using previous shot
                                                            </div>
                                                        )}
                                                        {shot.voiceoverUrl && (
                                                            <div className="text-[10px] text-amber-300 uppercase tracking-wider font-bold">
                                                                Voice: {voiceCharacter?.name || 'ElevenLabs'}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                <div className="mt-3 pt-2 flex flex-wrap gap-1">
                                                    {shot.characters.map((char, i) => (
                                                        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-purple-500/10 text-purple-300 rounded border border-purple-500/20">{char}</span>
                                                    ))}
                                                    {shot.environment && (
                                                        <span className="text-[10px] px-1.5 py-0.5 bg-teal-500/10 text-teal-300 rounded border border-teal-500/20">{shot.environment}</span>
                                                    )}
                                                    {shot.products && shot.products.map((prod, i) => (
                                                        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-pink-500/10 text-pink-300 rounded border border-pink-500/20">{prod}</span>
                                                    ))}
                                                </div>

                                                {/* Cinematography Score Badge */}
                                                {shot.cinematographyCritique && (
                                                    <div className="mt-3 p-2 bg-gray-900 rounded border border-gray-700">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <ApertureIcon className="w-3 h-3 text-indigo-400"/>
                                                            <span className="text-[10px] font-bold text-gray-300 uppercase">Cinematography Score</span>
                                                        </div>
                                                        <div className="flex gap-1 h-1 bg-gray-700 rounded-full overflow-hidden">
                                                            <div className="bg-indigo-500 h-full" style={{width: `${(shot.cinematographyCritique.lightingScore * 10)}%`}} title="Lighting"></div>
                                                            <div className="bg-teal-500 h-full" style={{width: `${(shot.cinematographyCritique.compositionScore * 10)}%`}} title="Composition"></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-32 border-2 border-dashed border-gray-700 rounded-2xl bg-gray-800/30">
                                    <div className="p-4 bg-gray-800 rounded-full mb-4">
                                        <GridIcon className="w-12 h-12 text-gray-600"/>
                                    </div>
                                    <h3 className="text-xl font-bold text-white mb-2">Start Storyboarding</h3>
                                    <p className="text-gray-400 max-w-md text-center mb-6">Analyze the script to automatically generate a shot list, then visualize each scene.</p>
                                    <button onClick={handleGenerateStoryboard} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg">
                                        Generate Shot List
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Filming Phase */}
                    {activePhase === 'filming' && (
                         <div className="space-y-6">
                            <div className="flex justify-between items-center border-b border-gray-700 pb-4 sticky top-0 bg-gray-900/95 backdrop-blur z-30">
                                <div>
                                    <h2 className="text-2xl font-bold text-white">Principal Photography</h2>
                                    <p className="text-gray-400 text-sm mt-1">Turn your storyboard visuals into high-quality video clips using Veo, Wan, Kling, or LTX.</p>
                                </div>
                                <div className="flex gap-3 items-center">
                                    <div className="flex items-center gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700 mr-2">
                                        <span className="text-xs font-bold text-gray-400 px-2">Video Model:</span>
                                        <select
                                            value={videoModel}
                                            onChange={(e) => setVideoModel(e.target.value as any)}
                                            className="bg-gray-700 text-white text-xs font-bold py-1 px-2 rounded focus:outline-none"
                                        >
                                            <option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast</option>
                                            <option value="veo-3.1-generate-preview">Veo 3.1 (High Quality)</option>
                                            <option value="wan-2.2-i2v-fast">Wan 2.2 I2V Fast</option>
                                            <option value="kling-v2.6-motion-control">Kling 2.6 Motion Control</option>
                                            <option value="kling-v2.5-turbo-pro">Kling 2.6 Turbo Pro</option>
                                            <option value="ltx-2-fast">LTX 2 Fast</option>
                                        </select>
                                        {videoModel === 'kling-v2.6-motion-control' && (
                                            <span className="text-[10px] text-amber-300 font-semibold px-2">Motion ref required</span>
                                        )}
                                    </div>
                                    <button
                                        onClick={handleGenerateAllVideos}
                                        disabled={shotPrompts.filter(s => s.imageUrl && !s.videoUrl).length === 0}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-transform transform hover:scale-105"
                                    >
                                        <CameraIcon className="w-5 h-5"/> Film All Remaining
                                    </button>
                                    <button
                                        onClick={() => setActivePhase('review')}
                                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg flex items-center gap-2 disabled:opacity-50 transition-transform transform hover:scale-105"
                                    >
                                        Next: Review <span className="text-blue-200">→</span>
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-6 pb-20">
                                {shotPrompts.length > 0 ? (
                                    shotPrompts.map(shot => {
                                        const motionRefUploadId = `motion-ref-upload-${shot.shot}`;
                                        const needsMotionRef = videoModel === 'kling-v2.6-motion-control' && !shot.motionReferenceUrl;
                                        return (
                                        <div key={shot.shot} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 shadow-lg flex flex-col md:flex-row h-auto md:min-h-[16rem] transition-all hover:border-indigo-500/30">
                                            {/* Storyboard Reference (Left) */}
                                            <div className="w-full md:w-1/3 bg-black relative flex-shrink-0 border-r border-gray-700">
                                                {shot.imageUrl ? (
                                                    <img src={shot.imageUrl} className="w-full h-full object-cover opacity-80" alt={`Storyboard Shot ${shot.shot}`}/>
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-600 bg-gray-900">
                                                        <GridIcon className="w-12 h-12 opacity-20"/>
                                                    </div>
                                                )}
                                                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded">
                                                    STORYBOARD
                                                </div>
                                            </div>

                                            {/* Action/Video Area (Middle/Right) */}
                                            <div className="flex-grow flex flex-col md:flex-row">
                                                {/* Shot Details */}
                                                <div className="p-4 flex-grow flex flex-col justify-between border-r border-gray-700 min-w-[200px]">
                                                    <div>
                                                        <h4 className="font-bold text-white mb-2">Shot {shot.shot}</h4>
                                                        <p className="text-gray-400 text-xs line-clamp-3 mb-3">{shot.description}</p>
                                                        <div className="bg-gray-900/60 border border-gray-700/60 rounded-lg p-3 space-y-3">
                                                            <div className="space-y-1">
                                                                <span className="text-[10px] uppercase tracking-wider text-gray-500">Prompt</span>
                                                                <textarea
                                                                    value={shot.prompt}
                                                                    onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, prompt: e.target.value } : s))}
                                                                    rows={2}
                                                                    className="w-full bg-gray-900 text-indigo-200 text-xs font-mono p-2 rounded border border-indigo-500/20 focus:border-indigo-500"
                                                                />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-[10px] uppercase tracking-wider text-gray-500">Motion Prompt</span>
                                                                    <button
                                                                        onClick={() => handleGenerateMotionPrompt(shot.shot)}
                                                                        disabled={shot.motionPromptIsGenerating}
                                                                        className="text-[10px] text-indigo-300 hover:text-indigo-200 font-semibold disabled:text-gray-500"
                                                                    >
                                                                        {shot.motionPrompt ? 'Regenerate' : 'Generate'}
                                                                    </button>
                                                                </div>
                                                                <textarea
                                                                    value={shot.motionPrompt || ''}
                                                                    onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, motionPrompt: e.target.value } : s))}
                                                                    placeholder="Edit or generate a motion prompt..."
                                                                    rows={2}
                                                                    className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-700 focus:border-indigo-500"
                                                                />
                                                                {shot.motionPromptIsGenerating && (
                                                                    <div className="text-[10px] text-amber-300">Generating motion prompt...</div>
                                                                )}
                                                            </div>
                                                            <div className="space-y-1">
                                                                <span className="text-[10px] uppercase tracking-wider text-gray-500">Camera Movement Preset</span>
                                                                <select
                                                                    value={shot.cameraMovementPreset || 'none'}
                                                                    onChange={(e) => {
                                                                        const presetId = e.target.value;
                                                                        const preset = getCameraMovementPreset(presetId);
                                                                        setShotPrompts(prev => prev.map(s => {
                                                                            if (s.shot !== shot.shot) return s;
                                                                            const nextPrompt = preset?.prompt
                                                                                ? applyCameraMovementToPrompt(s.motionPrompt || '', preset.prompt)
                                                                                : s.motionPrompt || '';
                                                                            return { ...s, cameraMovementPreset: presetId, motionPrompt: nextPrompt };
                                                                        }));
                                                                    }}
                                                                    className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-700 focus:border-indigo-500"
                                                                >
                                                                    {CAMERA_MOVEMENT_PRESETS.map(preset => (
                                                                        <option key={preset.id} value={preset.id}>{preset.label}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            {videoModel === 'kling-v2.6-motion-control' && (
                                                                <div className="space-y-2">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-[10px] uppercase tracking-wider text-gray-500">Motion Reference Video</span>
                                                                        <div className="flex items-center gap-2">
                                                                            <input
                                                                                id={motionRefUploadId}
                                                                                type="file"
                                                                                accept="video/*"
                                                                                className="hidden"
                                                                                onChange={(e) => {
                                                                                    const file = e.target.files?.[0];
                                                                                    if (!file) return;
                                                                                    const url = URL.createObjectURL(file);
                                                                                    setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, motionReferenceUrl: url } : s));
                                                                                    e.currentTarget.value = '';
                                                                                }}
                                                                            />
                                                                            <button
                                                                                onClick={() => document.getElementById(motionRefUploadId)?.click()}
                                                                                className="text-[10px] text-indigo-300 hover:text-indigo-200 font-semibold"
                                                                            >
                                                                                {shot.motionReferenceUrl ? 'Replace' : 'Upload'}
                                                                            </button>
                                                                            {shot.motionReferenceUrl && (
                                                                                <button
                                                                                    onClick={() => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, motionReferenceUrl: undefined } : s))}
                                                                                    className="text-[10px] text-gray-400 hover:text-gray-200"
                                                                                >
                                                                                    Clear
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {shot.motionReferenceUrl ? (
                                                                        <video src={shot.motionReferenceUrl} controls className="w-full h-20 rounded border border-gray-700 object-cover" />
                                                                    ) : (
                                                                        <div className="w-full h-20 rounded border border-dashed border-gray-700 flex items-center justify-center text-[10px] text-gray-500">
                                                                            Reference video required for motion control
                                                                        </div>
                                                                    )}
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                        <div>
                                                                            <span className="text-[10px] uppercase tracking-wider text-gray-500">Mode</span>
                                                                            <select
                                                                                value={shot.motionControlMode || 'std'}
                                                                                onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, motionControlMode: e.target.value as 'std' | 'pro' } : s))}
                                                                                className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-700 focus:border-indigo-500"
                                                                            >
                                                                                <option value="std">Standard</option>
                                                                                <option value="pro">Pro</option>
                                                                            </select>
                                                                        </div>
                                                                        <div>
                                                                            <span className="text-[10px] uppercase tracking-wider text-gray-500">Character Orientation</span>
                                                                            <select
                                                                                value={shot.motionControlOrientation || 'image'}
                                                                                onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, motionControlOrientation: e.target.value as 'image' | 'video' } : s))}
                                                                                className="w-full bg-gray-900 text-white text-xs p-2 rounded border border-gray-700 focus:border-indigo-500"
                                                                            >
                                                                                <option value="image">Match Image</option>
                                                                                <option value="video">Match Video</option>
                                                                            </select>
                                                                        </div>
                                                                    </div>
                                                                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={shot.motionControlKeepSound ?? false}
                                                                            onChange={(e) => setShotPrompts(prev => prev.map(s => s.shot === shot.shot ? { ...s, motionControlKeepSound: e.target.checked } : s))}
                                                                        />
                                                                        Keep reference audio
                                                                    </label>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="mt-4">
                                                        {shot.isFilming ? (
                                                            <div className="flex items-center gap-2 text-yellow-400 text-xs font-bold animate-pulse">
                                                                <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                                                                Filming in progress...
                                                            </div>
                                                        ) : shot.videoUrl ? (
                                                            <div className="flex items-center gap-2 text-green-400 text-xs font-bold">
                                                                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                                                Filming Complete
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-2 text-gray-500 text-xs font-bold">
                                                                <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                                                                Ready to Film
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Video Result / Action Button */}
                                                <div className="w-full md:w-1/2 bg-black relative flex items-center justify-center">
                                                    {shot.videoUrl ? (
                                                        <div className="w-full h-full relative group">
                                                            <video src={shot.videoUrl} controls className="w-full h-full object-cover"/>
                                                            <div className="absolute top-2 right-2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded animate-pulse pointer-events-none">REC</div>
                                                            <button
                                                                onClick={() => handleGenerateShotVideo(shot.shot)}
                                                                disabled={needsMotionRef}
                                                                className="absolute bottom-2 right-2 bg-gray-800/80 hover:bg-indigo-600 disabled:bg-gray-800/80 text-white text-xs px-3 py-1 rounded backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                                            >
                                                                Re-Film
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900/50 p-6">
                                                            {shot.isFilming ? (
                                                                <div className="flex flex-col items-center">
                                                                    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-indigo-500 mb-2"></div>
                                                                    <span className="text-xs text-indigo-400 font-mono">Generative Video Rendering...</span>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleGenerateShotVideo(shot.shot)}
                                                                    disabled={!shot.imageUrl || needsMotionRef}
                                                                    className="group flex flex-col items-center gap-2 text-gray-500 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >
                                                                    <div className="w-16 h-16 rounded-full border-2 border-gray-600 group-hover:border-indigo-500 flex items-center justify-center transition-all group-hover:scale-110 group-hover:shadow-lg group-hover:shadow-indigo-500/20">
                                                                        <CameraIcon className="w-8 h-8"/>
                                                                    </div>
                                                                    <span className="text-sm font-bold">Film Shot</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                    })
                                ) : (
                                    <div className="flex flex-col items-center justify-center py-24 text-gray-600">
                                        <FilmIcon className="w-24 h-24 mb-4 opacity-20"/>
                                        <p className="text-lg">No storyboard shots available.</p>
                                        <p className="text-sm">Complete the storyboard phase first.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Review Phase */}
                    {activePhase === 'review' && (
                        <div className="space-y-6">
                            <div className="flex justify-between items-center border-b border-gray-700 pb-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-white">Project Review & Analysis</h2>
                                    <p className="text-gray-400 text-sm mt-1">AI-powered continuity checks and quality assurance.</p>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={handleAnalyzeDraft}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg flex items-center gap-2 transition-transform transform hover:scale-105"
                                    >
                                        <MagicWandIcon className="w-5 h-5"/> Analyze Project
                                    </button>
                                    <button
                                        onClick={handleExportRoughCut}
                                        disabled={shotPrompts.filter(s => s.videoUrl).length === 0}
                                        className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg flex items-center gap-2 disabled:opacity-50 transition-transform transform hover:scale-105"
                                    >
                                        <ListIcon className="w-5 h-5"/> Export to Timeline
                                    </button>
                                    <button
                                        onClick={() => handleExportXml('premiere')}
                                        disabled={shotPrompts.filter(s => s.videoUrl).length === 0}
                                        className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg flex items-center gap-2 disabled:opacity-50 transition-transform transform hover:scale-105"
                                    >
                                        <PdfIcon className="w-5 h-5"/> XML for Premiere
                                    </button>
                                    <button
                                        onClick={() => handleExportXml('resolve')}
                                        disabled={shotPrompts.filter(s => s.videoUrl).length === 0}
                                        className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg flex items-center gap-2 disabled:opacity-50 transition-transform transform hover:scale-105"
                                    >
                                        <PdfIcon className="w-5 h-5"/> XML for Resolve
                                    </button>
                                </div>
                            </div>

                            {reviewFeedback ? (
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
                                    {/* Score Card */}
                                    <div className="lg:col-span-1 space-y-6">
                                        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg text-center">
                                            <h3 className="text-gray-400 font-bold uppercase text-xs mb-2">Overall Quality Score</h3>
                                            <div className="relative inline-flex items-center justify-center">
                                                <svg className="w-32 h-32 transform -rotate-90">
                                                    <circle className="text-gray-700" strokeWidth="8" stroke="currentColor" fill="transparent" r="58" cx="64" cy="64"/>
                                                    <circle className={`${reviewFeedback.overallScore > 7 ? 'text-green-500' : reviewFeedback.overallScore > 4 ? 'text-yellow-500' : 'text-red-500'} transition-all duration-1000 ease-out`} strokeWidth="8" strokeDasharray={365} strokeDashoffset={365 - (365 * reviewFeedback.overallScore) / 10} strokeLinecap="round" stroke="currentColor" fill="transparent" r="58" cx="64" cy="64"/>
                                                </svg>
                                                <span className="absolute text-4xl font-black text-white">{reviewFeedback.overallScore}</span>
                                            </div>
                                            <p className="mt-4 text-sm text-gray-300 italic">"{reviewFeedback.summary}"</p>
                                        </div>

                                        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 shadow-lg">
                                            <h4 className="font-bold text-white mb-3 flex items-center gap-2"><ClipboardCheckIcon className="w-4 h-4 text-indigo-400"/> Critical Feedback</h4>

                                            <div className="space-y-4">
                                                <div>
                                                    <span className="text-green-400 text-xs font-bold uppercase">Strengths</span>
                                                    <ul className="list-disc list-inside text-sm text-gray-300 mt-1 space-y-1">
                                                        {reviewFeedback.strengths.map((s, i) => <li key={i}>{s}</li>)}
                                                    </ul>
                                                </div>
                                                <div>
                                                    <span className="text-red-400 text-xs font-bold uppercase">Weaknesses</span>
                                                    <ul className="list-disc list-inside text-sm text-gray-300 mt-1 space-y-1">
                                                        {reviewFeedback.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                                                    </ul>
                                                </div>
                                                 <div>
                                                    <span className="text-yellow-400 text-xs font-bold uppercase">Continuity Issues</span>
                                                    <ul className="list-disc list-inside text-sm text-gray-300 mt-1 space-y-1">
                                                        {reviewFeedback.continuityIssues.length > 0 ? reviewFeedback.continuityIssues.map((c, i) => <li key={i}>{c}</li>) : <li className="text-gray-500 italic">None detected.</li>}
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Detailed Breakdown */}
                                    <div className="lg:col-span-2 bg-gray-800 rounded-xl border border-gray-700 shadow-lg overflow-hidden">
                                        <div className="p-4 border-b border-gray-700 bg-gray-900/50">
                                            <h3 className="font-bold text-white">Shot-by-Shot Analysis</h3>
                                        </div>
                                        <div className="overflow-y-auto max-h-[600px] p-4 space-y-4 custom-scrollbar">
                                            {shotPrompts.map(shot => {
                                                const feedbackItem = reviewFeedback.shotSpecificFeedback.find(f => f.shot === shot.shot);
                                                return (
                                                    <div key={shot.shot} className="flex gap-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700/50 hover:border-gray-600 transition-colors">
                                                        <div className="w-32 h-20 bg-black rounded flex-shrink-0 overflow-hidden relative group">
                                                            {shot.imageUrl ? <img src={shot.imageUrl} className="w-full h-full object-cover"/> : <div className="w-full h-full flex items-center justify-center text-gray-700 font-bold text-xs">NO IMG</div>}
                                                            {shot.videoUrl && <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full"></div>}
                                                        </div>
                                                        <div className="flex-grow">
                                                            <div className="flex justify-between mb-1">
                                                                <h4 className="font-bold text-white text-sm">Shot {shot.shot}</h4>
                                                            </div>
                                                            <p className="text-gray-400 text-xs mb-2 line-clamp-2">{shot.description}</p>
                                                            {feedbackItem ? (
                                                                <div className="text-xs bg-indigo-900/30 text-indigo-200 p-2 rounded border-l-2 border-indigo-500">
                                                                    <span className="font-bold">AI Critique:</span> {feedbackItem.feedback}
                                                                </div>
                                                            ) : <span className="text-xs text-gray-600 italic">No specific feedback.</span>}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-gray-700 rounded-2xl bg-gray-800/30">
                                    <div className="p-4 bg-gray-800 rounded-full mb-4">
                                        <MagicWandIcon className="w-12 h-12 text-gray-600"/>
                                    </div>
                                    <h3 className="text-xl font-bold text-white mb-2">Ready for Review</h3>
                                    <p className="text-gray-400 max-w-md text-center mb-6">Let the AI Producer analyze your project draft for continuity, pacing, and visual consistency before export.</p>
                                    <button onClick={handleAnalyzeDraft} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-lg shadow-lg">
                                        Run Analysis
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
        <ShotInpaintModal
            shot={activeInpaintShot}
            onClose={() => setActiveInpaintShotId(null)}
            onApply={(url, shotId) => setShotPrompts(prev => prev.map(s => s.shot === shotId ? { ...s, imageUrl: url } : s))}
        />
        {fullResView && (
            <FullResModal
                url={fullResView.url}
                title={fullResView.title}
                onClose={() => setFullResView(null)}
            />
        )}
    </div>
  );
};

export default ProjectHubWorkspace;
