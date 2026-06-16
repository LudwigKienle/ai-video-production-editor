
import { Effect, EffectStackPreset, EffectType, Transition, TransitionType } from './types';

export const EFFECTS: Effect[] = [
  {
    id: EffectType.VEOGEN,
    name: 'Generate Video (Veo)',
    type: 'ai',
    description: "Use Google's Veo model to generate a video from a text prompt."
  },
  {
    id: EffectType.IMAGEN_GEN,
    name: 'Generate Image (Imagen)',
    type: 'ai',
    description: "Use Imagen 4 for high-quality, photorealistic image generation."
  },
  {
    id: EffectType.GEMINI_3_PRO_IMAGE,
    name: 'Generate Image (Gemini 3 Pro)',
    type: 'ai',
    description: "Use Gemini 3 Pro for high-resolution (up to 4K) image generation."
  },
  {
    id: EffectType.REPLICATE_FLUX,
    name: 'Generate Image (Flux Pro)',
    type: 'ai',
    description: "Use Flux 1.1 Pro (Pruna AI) for state-of-the-art image synthesis."
  },
  {
    id: EffectType.REPLICATE_SEEDREAM,
    name: 'Generate Image (Seedream 4.5)',
    type: 'ai',
    description: 'Use Seedream 4.5 for strong spatial understanding and world knowledge.'
  },
  {
    id: EffectType.REPLICATE_FLUX_EDIT,
    name: 'Edit Image (Flux Fill)',
    type: 'ai',
    description: "Edit images using Flux Fill via Replicate."
  },
  {
    id: EffectType.REPLICATE_QWEN_EDIT,
    name: 'Edit Image (Qwen)',
    type: 'ai',
    description: 'Edit images with Qwen Image Edit on Replicate.'
  },
  {
    id: EffectType.REPLICATE_UPSCALER,
    name: 'Clarity Upscaler',
    type: 'ai',
    description: "Upscale and enhance image resolution using Real-ESRGAN."
  },
  {
    id: EffectType.OMNI_HUMAN,
    name: 'Avatar Video (OmniHuman)',
    type: 'ai',
    description: "Generate a talking avatar video from a reference image and audio."
  },
  {
    id: EffectType.WAN_ANIMATE_REPLACE,
    name: 'Avatar Replace (Wan Animate)',
    type: 'ai',
    description: "Replace a character in a video with your avatar image."
  },
  {
    id: EffectType.WAN_IMAGE_TO_VIDEO,
    name: 'Animate Image (Wan 2.2)',
    type: 'ai',
    description: "Animate a still image into video motion using Wan 2.2."
  },
  {
    id: EffectType.KLING_26,
    name: 'Generate Video (Kling 2.6)',
    type: 'ai',
    description: "Create cinematic video from text or a start image."
  },
  {
    id: EffectType.KLING_MOTION_CONTROL,
    name: 'Motion Control (Kling 2.6)',
    type: 'ai',
    description: "Drive motion with a video while keeping your avatar."
  },
  {
    id: EffectType.VIDEO_FROM_IMAGE,
    name: 'Generate Video from Image',
    type: 'ai',
    description: "Use Veo to generate a video starting from an uploaded image."
  },
  {
    id: EffectType.NANOGEN,
    name: 'Generate Image (Nano Banana 2)',
    type: 'ai',
    description: "Use Gemini Nano Banana 2 for fast image generation and editing."
  },
  {
    id: EffectType.NANO_EDIT,
    name: 'Edit Image (Nano Banana 2)',
    type: 'ai',
    description: "Use a text prompt to edit a selected image clip."
  },
  {
    id: EffectType.TTSGEN,
    name: 'Generate Speech (TTS)',
    type: 'ai',
    description: "Use Gemini to generate speech from a text prompt."
  },
  {
    id: EffectType.NATIVE_SOLID_COLOR,
    name: 'Solid Color',
    type: 'native',
    description: "Generate a solid color clip. Works offline without an API key."
  },
  {
    id: EffectType.CHROMA_KEY,
    name: 'Chroma Key (Green Screen)',
    type: 'native',
    description: 'Remove a color background (e.g., a green screen) from a clip.'
  },
  {
    id: EffectType.TEXT,
    name: 'Text Overlay',
    type: 'native',
    description: "Add and customize text on top of your clip."
  },
  {
    id: EffectType.GRAYSCALE,
    name: 'Grayscale',
    type: 'css',
    description: 'Convert the clip to black and white.'
  },
  {
    id: EffectType.SEPIA,
    name: 'Sepia',
    type: 'css',
    description: 'Apply a warm, brownish tint to the clip.'
  },
  {
    id: EffectType.INVERT,
    name: 'Invert',
    type: 'css',
    description: 'Invert the colors of the clip.'
  },
  {
    id: EffectType.BLUR,
    name: 'Blur',
    type: 'css',
    description: 'Apply a blur effect to the clip.'
  },
  {
    id: EffectType.VIBRANT,
    name: 'Vibrant',
    type: 'css',
    description: 'Boost saturation and contrast for punchier visuals.'
  },
  {
    id: EffectType.WARM_TONE,
    name: 'Warm Tone',
    type: 'css',
    description: 'Add warm cinematic tones with subtle amber highlights.'
  },
  {
    id: EffectType.COOL_TONE,
    name: 'Cool Tone',
    type: 'css',
    description: 'Shift tones cooler for night or steel-blue moods.'
  },
  {
    id: EffectType.NOIR,
    name: 'Noir High Contrast',
    type: 'css',
    description: 'Strong black-and-white contrast with deep shadows.'
  },
  {
    id: EffectType.VHS,
    name: 'VHS Texture',
    type: 'css',
    description: 'Retro low-fidelity look with soft blur and reduced saturation.'
  },
  {
    id: EffectType.VAN_GOGH,
    name: 'Van Gogh Stylize',
    type: 'css',
    description: 'Painterly strokes and rich color contrast inspired by oil canvases.'
  },
  {
    id: EffectType.ANIME,
    name: 'Anime Stylize',
    type: 'css',
    description: 'Punchy colors and cel-shaded contrast for anime-like frames.'
  },
  {
    id: EffectType.WATERCOLOR,
    name: 'Watercolor Stylize',
    type: 'css',
    description: 'Soft diffusion and color bleed for watercolor aesthetics.'
  },
  {
    id: EffectType.COMIC,
    name: 'Comic Ink Stylize',
    type: 'css',
    description: 'High-contrast inked look with bold comic-style punch.'
  },
  {
    id: EffectType.FIRE_OVERLAY,
    name: 'Fire Overlay',
    type: 'css',
    description: 'Adds dynamic heat and flame glow on top of your clip.'
  },
  {
    id: EffectType.LIGHTNING_OVERLAY,
    name: 'Lightning Overlay',
    type: 'css',
    description: 'Adds electric strikes and flash pulses for storm energy.'
  },
  {
    id: EffectType.EXPLOSION_OVERLAY,
    name: 'Explosion Burst',
    type: 'css',
    description: 'Cinematic shockwave burst overlay for impact moments.'
  },
  {
    id: EffectType.GLITCH_OVERLAY,
    name: 'Glitch Distortion',
    type: 'css',
    description: 'Digital glitch jitter with chromatic split and interference.'
  },
];

export const TRANSITIONS: Transition[] = [
    {
        id: TransitionType.CROSS_FADE,
        name: 'Cross Fade',
        duration: 1.0,
    },
    {
        id: TransitionType.FADE_TO_BLACK,
        name: 'Fade to Black',
        duration: 1.5,
    },
    {
        id: TransitionType.FADE_TO_WHITE,
        name: 'Fade to White',
        duration: 1.2,
    },
    {
        id: TransitionType.DIP_TO_WHITE,
        name: 'Dip to White',
        duration: 1.0,
    },
    {
        id: TransitionType.ZOOM_IN,
        name: 'Zoom In',
        duration: 0.8,
    },
    {
        id: TransitionType.SWIPE_LEFT,
        name: 'Swipe Left',
        duration: 0.7,
    },
    {
        id: TransitionType.GLITCH_CUT,
        name: 'Glitch Cut',
        duration: 0.55,
    },
    {
        id: TransitionType.WHIP_PAN,
        name: 'Whip Pan',
        duration: 0.45,
    },
    {
        id: TransitionType.LIGHTNING_FLASH,
        name: 'Lightning Flash',
        duration: 0.5,
    },
    {
        id: TransitionType.FILM_BURN,
        name: 'Film Burn',
        duration: 0.8,
    },
];

export const EFFECT_STACK_PRESETS: EffectStackPreset[] = [
    {
        id: 'stack-cinematic-punch',
        name: 'Cinematic Punch',
        description: 'Sharper contrast, richer color and subtle grain for trailer energy.',
        category: 'look',
        baseEffect: EffectType.VIBRANT,
        effects: [
            { effect: EffectType.VIBRANT, intensity: 100 },
            { effect: EffectType.WARM_TONE, intensity: 42 },
        ],
        filterOverrides: {
            contrast: 116,
            saturate: 118,
            grain: 10,
            halation: 8,
            bloom: 6,
            vignette: 12,
        },
    },
    {
        id: 'stack-noir-detective',
        name: 'Noir Detective',
        description: 'High-contrast monochrome with heavy vignette and grain.',
        category: 'look',
        baseEffect: EffectType.NOIR,
        effects: [
            { effect: EffectType.NOIR, intensity: 100 },
            { effect: EffectType.GLITCH_OVERLAY, intensity: 22 },
        ],
        filterOverrides: {
            contrast: 132,
            saturate: 8,
            grain: 24,
            bloom: 10,
            vignette: 42,
            brightness: 94,
        },
    },
    {
        id: 'stack-anime-pop',
        name: 'Anime Pop',
        description: 'Stylized anime look with brighter edges and color pop.',
        category: 'stylize',
        baseEffect: EffectType.ANIME,
        effects: [
            { effect: EffectType.ANIME, intensity: 100 },
            { effect: EffectType.COMIC, intensity: 36 },
        ],
        filterOverrides: {
            saturate: 132,
            contrast: 120,
            bloom: 8,
            halation: 6,
            brightness: 104,
        },
    },
    {
        id: 'stack-oil-canvas',
        name: 'Oil Canvas',
        description: 'Painterly palette inspired by oil painting textures.',
        category: 'stylize',
        baseEffect: EffectType.VAN_GOGH,
        effects: [
            { effect: EffectType.VAN_GOGH, intensity: 100 },
            { effect: EffectType.WATERCOLOR, intensity: 28 },
        ],
        filterOverrides: {
            saturate: 126,
            contrast: 112,
            grain: 6,
            bloom: 12,
            hueRotate: -4,
        },
    },
    {
        id: 'stack-thunder-impact',
        name: 'Thunder Impact',
        description: 'Storm flash impact with electric burst energy.',
        category: 'vfx',
        baseEffect: EffectType.LIGHTNING_OVERLAY,
        effects: [
            { effect: EffectType.LIGHTNING_OVERLAY, intensity: 100 },
            { effect: EffectType.EXPLOSION_OVERLAY, intensity: 58 },
            { effect: EffectType.GLITCH_OVERLAY, intensity: 42 },
        ],
        filterOverrides: {
            contrast: 118,
            bloom: 24,
            halation: 16,
            brightness: 102,
        },
    },
    {
        id: 'stack-fire-storm',
        name: 'Fire Storm',
        description: 'Hot dramatic palette with burning overlay and glow.',
        category: 'vfx',
        baseEffect: EffectType.FIRE_OVERLAY,
        effects: [
            { effect: EffectType.FIRE_OVERLAY, intensity: 100 },
            { effect: EffectType.EXPLOSION_OVERLAY, intensity: 46 },
            { effect: EffectType.VIBRANT, intensity: 32 },
        ],
        filterOverrides: {
            saturate: 122,
            contrast: 114,
            bloom: 22,
            halation: 22,
            hueRotate: -6,
        },
    },
];

export const STYLE_PRESETS = {
    visual: [
        "Cinematic, 35mm film grain, High Contrast",
        "Neo-Noir, Shadowy, Moody, High Contrast",
        "Cyberpunk, Neon lights, Wet pavement, Futuristic",
        "Symmetric Pastel, Centered framing, Soft palette, Flat lighting",
        "Documentary Style, Handheld, Natural Lighting, Gritty",
        "Hand-Painted Animation, Vibrant, Painted background, Warm light",
        "Vintage 1950s Technicolor, Saturated, Soft Focus",
        "Historical Drama, 19th century Berlin, Warm candlelight, Period costumes, Rich textures",
        "Hand-Painted Animation, Warm light, Soft gradients, Whimsical atmosphere",
        "Urban Loneliness, Quiet realism, Hard sunlight, Cinematic loneliness",
        "Classic Suspense, Dramatic shadows, 1950s cinema mood",
        "Black and White, High contrast, Film grain, Moody shadows",
        "Painterly, Visible brush strokes, Textured canvas, Expressive colors",
        "Watercolor, Soft edges, Textured paper, Gentle washes",
        "Neon Brutalist, Monochromatic orange haze, Brutalist scale, Atmospheric fog",
        "Green Cyber Noir, Green tint, Cybergoth, High contrast, Glossy textures",
        "Desert Epic, Desert tones, Haze, Brutalist scale, Epic wides",
        "Psychological Horror, Dark mood, Dim lighting, Unsettling atmosphere",
        "Daylight Horror, Bright daylight, Overexposed whites, Floral colors",
        "Neon Grid World, Dark background, Glowing neon lines, Digital world",
        "Graphic Noir, High contrast B&W, Single accent color, Comic noir",
        "Steampunk, Victorian industrial, Brass gears, Copper tones",
        "Vaporwave, 80s nostalgia, Neon pink/blue, Glitchy VHS",
        "Gothic, Dark moody atmosphere, Cathedral architecture, Fog, Shadows",
        "Minimalist, Clean lines, Negative space, Simple palette",
        "Surrealist, Dream-like, Bizarre juxtapositions, Impossible objects",
        "Documentary, Handheld, Natural lighting, Raw realism",
        "Vintage 70s, Warm yellow tones, Film grain, Retro aesthetic",
        "90s Anime, Cel shading, Hand drawn, Retro animation",
        "3D Animation, Bright colors, Soft lighting, Expressive characters",
        "Polaroid, Instant film look, Faded colors, Soft focus",
        "VHS, Tracking lines, Color bleed, Low resolution",
        "Technicolor, Saturated colors, Classic Hollywood look",
        "Grindhouse, Scratched film, Dirt, High contrast, B-movie",
        "Ethereal, Soft bloom, Dreamy lighting, Pastels",
        "Claymation, Stop motion, Plasticine texture, Handmade look",
        "Papercraft, Cut paper textures, Layered depth, Handmade aesthetic",
        "Infrared, Surreal colors, White foliage, Dark skies",
        "Pop Art, Warhol aesthetic, Bold colors, Halftone dots",
        "Glitch Art, Data mosh, Pixel sorting, Visual artifacts"
    ],
    lighting: [
        "Golden Hour, Warm soft light",
        "Blue Hour, Cold tones",
        "Rembrandt Lighting, Dramatic shadows",
        "Soft Diffused Window Light",
        "Harsh Overhead Fluorescent",
        "Volumetric Foggy Lighting"
    ],
    camera: [
        "Wide Angle Shot (24mm)",
        "Telephoto Close-up (85mm), Bokeh background",
        "Low Angle, Heroic",
        "High Angle, Bird's eye view",
        "Dutch Angle, Disorienting",
        "Macro Detail Shot"
    ]
};
