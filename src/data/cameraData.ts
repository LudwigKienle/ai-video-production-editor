import defaultCamera from '../assets/cameras/default-camera.png';
import arriAlexa35 from '../assets/cameras/arri-alexa35.png';
import redVraptor from '../assets/cameras/red-vraptor.png';
import sonyVenice2 from '../assets/cameras/sony-venice2.png';
import blackmagic6k from '../assets/cameras/blackmagic-6k.png';
import film35mm from '../assets/cameras/film-35mm.png';
import film16mm from '../assets/cameras/film-16mm.png';
import imax70mm from '../assets/cameras/imax-70mm.png';
import iphone15 from '../assets/cameras/iphone-15.png';

import defaultLens from '../assets/lenses/default-lens.png';
import lens14mm from '../assets/lenses/14mm.png';
import lens24mm from '../assets/lenses/24mm.png';
import lens35mm from '../assets/lenses/35mm.png';
import lens50mm from '../assets/lenses/50mm.png';
import lens85mm from '../assets/lenses/85mm.png';
import lens135mm from '../assets/lenses/135mm.png';
import lensAnamorphic40 from '../assets/lenses/anamorphic-40.png';
import lensTiltShift45 from '../assets/lenses/tilt-shift-45.png';
import lensProbe24 from '../assets/lenses/probe-24.png';
import lensVintage58 from '../assets/lenses/vintage-58.png';

import { AspectRatioOption } from '../workspaces/ImageGenerationWorkspace';

export type CameraPreset = {
    id: string;
    label: string;
    prompt: string;
    image: string;
};

export type LensPreset = {
    id: string;
    label: string;
    prompt: string;
    image: string;
    focalLength: string;
    type: 'Spherical' | 'Anamorphic' | 'Specialty';
    aspectRatioOverride?: AspectRatioOption;
    aspectRatioHint?: string;
};

export const CAMERA_PRESETS: CameraPreset[] = [
    { id: 'auto', label: 'Auto Camera', prompt: '', image: defaultCamera },
    { id: 'arri-alexa35', label: 'ARRI Alexa 35', prompt: 'shot on ARRI Alexa 35, cinematic digital, high dynamic range', image: arriAlexa35 },
    { id: 'red-vraptor', label: 'RED V-Raptor 8K', prompt: 'shot on RED V-Raptor 8K, ultra-detailed, crisp', image: redVraptor },
    { id: 'sony-venice2', label: 'Sony Venice 2', prompt: 'shot on Sony Venice 2, rich cinematic color', image: sonyVenice2 },
    { id: 'blackmagic-6k', label: 'Blackmagic 6K', prompt: 'shot on Blackmagic 6K, filmic, Super 35', image: blackmagic6k },
    { id: 'film-35mm', label: '35mm Film', prompt: 'shot on 35mm film, subtle grain, halation', image: film35mm },
    { id: 'film-16mm', label: '16mm Film', prompt: 'shot on 16mm film, visible grain, organic texture', image: film16mm },
    { id: 'imax-70mm', label: 'IMAX 70mm', prompt: 'shot on IMAX 70mm, large format, ultra clean detail', image: imax70mm },
    { id: 'iphone-15', label: 'iPhone 15 Pro', prompt: 'shot on iPhone 15 Pro, handheld, modern mobile look', image: iphone15 },
];

export const LENS_PRESETS: LensPreset[] = [
    { id: 'auto', label: 'Auto Lens', prompt: '', image: defaultLens, focalLength: '-', type: 'Spherical' },
    { id: '14mm', label: '14mm Ultra Wide', prompt: '14mm ultra-wide lens, dramatic perspective', image: lens14mm, focalLength: '14mm', type: 'Spherical' },
    { id: '24mm', label: '24mm Wide', prompt: '24mm wide lens, expansive field of view', image: lens24mm, focalLength: '24mm', type: 'Spherical' },
    { id: '35mm', label: '35mm', prompt: '35mm lens, natural perspective', image: lens35mm, focalLength: '35mm', type: 'Spherical' },
    { id: '50mm', label: '50mm', prompt: '50mm standard lens, balanced framing', image: lens50mm, focalLength: '50mm', type: 'Spherical' },
    { id: '85mm', label: '85mm Portrait', prompt: '85mm portrait lens, soft background separation', image: lens85mm, focalLength: '85mm', type: 'Spherical' },
    { id: '135mm', label: '135mm Telephoto', prompt: '135mm telephoto lens, compressed perspective', image: lens135mm, focalLength: '135mm', type: 'Spherical' },
    {
        id: 'anamorphic-40',
        label: '40mm Anamorphic',
        prompt: '40mm anamorphic lens, oval bokeh, cinematic flares',
        image: lensAnamorphic40,
        focalLength: '40mm',
        type: 'Anamorphic',
        aspectRatioOverride: '239:100',
        aspectRatioHint: 'cinemascope 2.39:1, anamorphic de-squeezed, widescreen framing',
    },
    { id: 'tilt-shift-45', label: '45mm Tilt-Shift', prompt: '45mm tilt-shift lens, selective focus', image: lensTiltShift45, focalLength: '45mm', type: 'Specialty' },
    { id: 'probe-24', label: '24mm Probe Macro', prompt: '24mm probe lens, macro close-up, deep focus', image: lensProbe24, focalLength: '24mm', type: 'Specialty' },
    { id: 'vintage-58', label: '58mm Vintage', prompt: '58mm vintage lens, swirly bokeh, dreamy highlights', image: lensVintage58, focalLength: '58mm', type: 'Specialty' },
];
