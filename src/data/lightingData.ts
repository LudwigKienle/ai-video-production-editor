import lightGolden from '../assets/visuals/light-golden.png';
import lightStudio from '../assets/visuals/light-studio.png';
import lightNeon from '../assets/visuals/light-neon.png';
import lightDramatic from '../assets/visuals/light-dramatic.png';
import lightNatural from '../assets/visuals/light-natural.png';
// New User Assets
import lightStudioSoftbox from '../assets/visuals/lighting-studio-softbox.jpg';
import lightGoldenHourUser from '../assets/visuals/lighting-golden-hour.png';
import lightCinematicWarm from '../assets/visuals/lighting-cinematic-warm.png';
import lightLowKeyBW from '../assets/visuals/lighting-low-key-bw.png';
import lightNaturalWindow from '../assets/visuals/lighting-natural-window.jpg';
import lightNeonUser from '../assets/visuals/lighting-neon-cyan-red.png';
import lightFantasyGold from '../assets/visuals/lighting-fantasy-gold.png';
import lightBioluminescent from '../assets/visuals/light-bioluminescent.jpg';
import lightBlueHour from '../assets/visuals/light-blue-hour.png';
import lightJellyfish from '../assets/visuals/light-jellyfish.jpg';
import lightCandlelight from '../assets/visuals/light-candlelight.jpg';
import lightRim from '../assets/visuals/light-rim.png';
// Batch 2 Lighting Assets
import lightSilhouette from '../assets/visuals/light-silhouette.png';
import lightRembrandt from '../assets/visuals/light-rembrandt.jpg';
import lightVolumetric from '../assets/visuals/light-volumetric.png';
import lightHard from '../assets/visuals/light-hard.png';
import lightChiaroscuro from '../assets/visuals/light-chiaroscuro.png';
import lightSplit from '../assets/visuals/light-split.png';
import lightPractical from '../assets/visuals/light-practical.png';
import lightButterfly from '../assets/visuals/light-butterfly.png';


export interface LightingPreset {
    id: string;
    label: string;
    prompt: string;
    image: string;
}

export const LIGHTING_PRESETS: LightingPreset[] = [
    {
        id: 'golden',
        label: 'Golden Hour',
        prompt: 'golden hour lighting, warm sunlight, sunset glow, lens flare, soft backlight, atmospheric',
        image: lightGoldenHourUser, // REPLACED
    },
    {
        id: 'studio',
        label: 'Studio',
        prompt: 'studio lighting, three-point lighting, professional photo shoot, softbox illumination, clean look',
        image: lightStudioSoftbox, // REPLACED
    },
    {
        id: 'cinematic',
        label: 'Cinematic Warm',
        prompt: 'cinematic lighting, warm tones, moody atmosphere, rich colors, filmic look, tungsten lighting',
        image: lightCinematicWarm, // NEW
    },
    {
        id: 'neon',
        label: 'Neon / Cyberpunk',
        prompt: 'neon lighting, cyberpunk atmosphere, vibrant pink and blue lights, high contrast, nightlife vibe',
        image: lightNeonUser, // REPLACED
    },
    {
        id: 'dramatic',
        label: 'Dramatic / Low Key',
        prompt: 'dramatic lighting, low key, high contrast, chiaroscuro, strong shadows, mystery, noir style',
        image: lightLowKeyBW, // REPLACED (Merged Dramatic/LowKey)
    },
    {
        id: 'fantasy',
        label: 'Fantasy / Ethereal',
        prompt: 'fantasy lighting, ethereal glow, magical atmosphere, soft gold highlights, dreamy, bioluminescent',
        image: lightFantasyGold, // NEW
    },
    {
        id: 'natural',
        label: 'Natural / Window',
        prompt: 'natural lighting, soft daylight, window light, diffuse shadows, realistic, balanced exposure',
        image: lightNaturalWindow, // REPLACED
    },
    {
        id: 'rembrandt',
        label: 'Rembrandt',
        prompt: 'rembrandt lighting, classic portrait, triangle of light on cheek, moody, dramatic shadows',
        image: lightRembrandt,
    },
    {
        id: 'split',
        label: 'Split Lighting',
        prompt: 'split lighting, heavy contrast, face half in shadow, mystery, dual personality',
        image: lightSplit,
    },
    {
        id: 'butterfly',
        label: 'Butterfly',
        prompt: 'butterfly lighting, glamour shot, shadow under nose, beauty lighting, flattering',
        image: lightButterfly,
    },
    {
        id: 'rim',
        label: 'Rim Lighting',
        prompt: 'rim lighting, backlight, halo effect, separation from background, cinematic silhouette',
        image: lightRim,
    },
    {
        id: 'silhouette',
        label: 'Silhouette',
        prompt: 'silhouette lighting, subject dark against bright background, mystery, form focus',
        image: lightSilhouette,
    },
    {
        id: 'practical',
        label: 'Practical',
        prompt: 'practical lighting, visible light sources, lamps, neons, realistic atmosphere',
        image: lightPractical,
    },
    {
        id: 'volumetric',
        label: 'Volumetric',
        prompt: 'volumetric lighting, god rays, atmospheric fog, dusty air, cinematic depth',
        image: lightVolumetric,
    },
    {
        id: 'biolum',
        label: 'Bioluminescence',
        prompt: 'bioluminescent lighting, glowing organic shapes, blue and green glow, alien atmosphere',
        image: lightBioluminescent,
    },
    {
        id: 'candle',
        label: 'Candlelight',
        prompt: 'candlelight, warm flickering light, intimate atmosphere, soft shadows, historical',
        image: lightCandlelight,
    },
    {
        id: 'hard',
        label: 'Hard Light',
        prompt: 'hard lighting, crisp shadows, high contrast, harsh sun, noon daylight',
        image: lightHard,
    },
    {
        id: 'blue_hour',
        label: 'Blue Hour',
        prompt: 'blue hour lighting, twilight, cold tones, moody exterior, before sunrise',
        image: lightBlueHour,
    },
    {
        id: 'chiaroscuro',
        label: 'Chiaroscuro',
        prompt: 'chiaroscuro lighting, strong contrast between light and dark, renaissance style, drama',
        image: lightChiaroscuro,
    }
];
