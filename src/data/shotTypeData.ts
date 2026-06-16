import shotCloseup from '../assets/visuals/shot-closeup.png';
import shotWide from '../assets/visuals/shot-wide.png';
import shotLowAngle from '../assets/visuals/shot-low-angle.png'; // Keeping as backup or remove if unused
import shotOverhead from '../assets/visuals/shot-overhead.png'; // Keeping as backup or remove if unused
// New User Assets
import shotExtremeWide from '../assets/visuals/shot-extreme-wide.jpg';
import shotMacroEye from '../assets/visuals/shot-macro-eye.jpg';
import shotBRoll from '../assets/visuals/shot-b-roll.jpg';
// import shotWideHiker from '../assets/visuals/shot-wide-hiker.jpg'; // Unused
import shotMediumBack from '../assets/visuals/shot-medium-back.jpg';
import shotFullBody from '../assets/visuals/shot-full-body-hiker.jpg';
import shotPortraitScarf from '../assets/visuals/shot-portrait-scarf.jpg';
import shotMediumStreet from '../assets/visuals/shot-medium-street.jpg';
// Second Batch User Assets
import shotOverheadStreet from '../assets/visuals/shot-overhead-street.jpg';
import shotLowAngleClimber from '../assets/visuals/shot-low-angle-climber.jpg';
import shotCowboy from '../assets/visuals/shot-cowboy.png';
import shotDollyZoom from '../assets/visuals/shot-dolly-zoom.png';
import shotWormsEye from '../assets/visuals/shot-worms-eye.jpg';
import shotDutchAngle from '../assets/visuals/shot-dutch-angle.png';
import shotEstablishing from '../assets/visuals/shot-establishing.png';
// Third Batch User Assets
import shotRackFocus from '../assets/visuals/shot-rack-focus.png';
import shotPanning from '../assets/visuals/shot-panning.png';
import shotTracking from '../assets/visuals/shot-tracking.png';
import shotHighAngle from '../assets/visuals/shot-high-angle.jpg';
import shotPov from '../assets/visuals/shot-pov.png';
import shotTilt from '../assets/visuals/shot-tilt.jpg';

export interface ShotTypePreset {
    id: string;
    label: string;
    prompt: string;
    image: string;
}

export const SHOT_TYPE_PRESETS: ShotTypePreset[] = [
    {
        id: 'closeup',
        label: 'Close Up',
        prompt: 'close-up shot, detailed facial features, emotional connection, shallow depth of field',
        image: shotPortraitScarf,
    },
    {
        id: 'extreme_closeup',
        label: 'Macro / Extreme Close Up',
        prompt: 'extreme close-up macro shot, iris detail, skin texture, intense focus, abstract composition',
        image: shotMacroEye,
    },
    {
        id: 'medium',
        label: 'Medium Shot',
        prompt: 'medium shot, waist-up framing, narrative context, 35mm lens, street photography style',
        image: shotMediumStreet,
    },
    {
        id: 'full_body',
        label: 'Full Body',
        prompt: 'full body shot, character in environment, wide stance, contextual framing, head to toe visibility',
        image: shotFullBody,
    },
    {
        id: 'ots',
        label: 'Over The Shoulder',
        prompt: 'over the shoulder shot, third person perspective, narrative depth, looking at horizon',
        image: shotMediumBack,
    },
    {
        id: 'wide',
        label: 'Wide Shot',
        prompt: 'wide angle shot, establishing shot, environment focus, cinematic landscape',
        image: shotWide,
    },
    {
        id: 'extreme_wide',
        label: 'Extreme Wide',
        prompt: 'extreme wide shot, epic landscape, tiny human figure for scale, majestic scenery, 14mm lens',
        image: shotExtremeWide,
    },
    {
        id: 'low_angle',
        label: 'Low Angle',
        prompt: 'low angle shot, looking up from below, worm\'s eye view, imposing perspective, dramatic scale',
        image: shotLowAngleClimber, // REPLACED: User's climber image
    },
    {
        id: 'overhead',
        label: 'Overhead',
        prompt: 'overhead shot, top-down view, bird\'s eye view, drone footage style, geometric composition',
        image: shotOverheadStreet, // REPLACED: User's street image
    },
    {
        id: 'b_roll',
        label: 'Detail / B-Roll',
        prompt: 'cinematic b-roll, atmospheric detail, scene setting, moody lighting, textural focus',
        image: shotBRoll,
    },
    {
        id: 'cowboy',
        label: 'Cowboy Shot',
        prompt: 'cowboy shot, mid-thigh up framing, american western composition, confident stance',
        image: shotCowboy,
    },
    {
        id: 'pov',
        label: 'Point of View',
        prompt: 'point of view shot, first person perspective, immersive, handheld camera movement',
        image: shotPov,
    },
    {
        id: 'dutch',
        label: 'Dutch Angle',
        prompt: 'dutch angle shot, tilted horizon, uneasy atmosphere, dynamic composition, psychological tension',
        image: shotDutchAngle,
    },
    {
        id: 'high_angle',
        label: 'High Angle',
        prompt: 'high angle shot, looking down on subject, vulnerability, minimizing perspective',
        image: shotHighAngle,
    },
    {
        id: 'worms_eye',
        label: "Worm's Eye View",
        prompt: "worm's eye view, ground level shot, looking up, imposing scale, dramatic perspective",
        image: shotWormsEye,
    },
    {
        id: 'rack_focus',
        label: 'Rack Focus',
        prompt: 'rack focus shot, shifting focus from foreground to background, cinematic depth, storytelling focus',
        image: shotRackFocus,
    },
    {
        id: 'dolly_zoom',
        label: 'Dolly Zoom',
        prompt: 'dolly zoom effect, vertigo shot, background compression, psychological intensity',
        image: shotDollyZoom,
    },
    {
        id: 'tracking',
        label: 'Tracking Shot',
        prompt: 'tracking shot, following subject movement, smooth camera motion, dynamic energy',
        image: shotTracking,
    },
    {
        id: 'panning',
        label: 'Panning Shot',
        prompt: 'panning shot, horizontal camera movement, revealing environment, sweeping view',
        image: shotPanning,
    },
    {
        id: 'tilt',
        label: 'Tilt Shot',
        prompt: 'tilt shot, vertical camera movement, revealing height or scale, dramatic reveal',
        image: shotTilt,
    },
    {
        id: 'establishing',
        label: 'Establishing Shot',
        prompt: 'establishing shot, ultra wide, setting the scene, context, narrative introduction',
        image: shotEstablishing,
    }
];
