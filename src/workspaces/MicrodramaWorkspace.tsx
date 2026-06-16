import React, { useState, useEffect } from 'react';
import { Workspace, StoryBible, ShotPrompt, ReferenceItem, MediaItem } from '../types';

interface MicrodramaWorkspaceProps {
    storyBible: StoryBible;
    setStoryBible: React.Dispatch<React.SetStateAction<StoryBible>>;
    shotPrompts: ShotPrompt[];
    setShotPrompts: React.Dispatch<React.SetStateAction<ShotPrompt[]>>;
    mediaItems: MediaItem[];
    setMediaItems: React.Dispatch<React.SetStateAction<MediaItem[]>>;
    references: ReferenceItem[];
    setReferences: React.Dispatch<React.SetStateAction<ReferenceItem[]>>;
    apiKeyReady: boolean;
}

// Inline custom SVGs for complete independence and robustness
const FireIcon = () => (
    <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

const ScriptIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
);

const VideoIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const AudioIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
    </svg>
);

const SparklesIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
);

const CheckIcon = ({ className = "w-5 h-5 text-green-500" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
);

const ExclamationIcon = ({ className = "w-5 h-5 text-amber-500" }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
);

// Style presets from the ai-video-production-pipeline skill
const SUBGENRE_PRESETS = [
    {
        id: 'contemporary',
        name: 'Contemporary Drama',
        style: 'realistic, modern, urban, social media aesthetic',
        palette: 'warm neutrals, soft pastels, vibrant accents',
        lighting: 'natural, golden hour, soft, phone screen glow',
        description: 'Perfect for viral modern-day romance or career climbs.'
    },
    {
        id: 'billionaire',
        name: 'Billionaire Romance',
        style: 'luxurious, high-end, sophisticated, rich texture',
        palette: 'black, gold, silver, rich deep colors',
        lighting: 'dramatic, high contrast, cinematic, selective rim lights',
        description: 'Heavy corporate power play, hidden contracts, high glamour.'
    },
    {
        id: 'enemies_to_lovers',
        name: 'Enemies to Lovers',
        style: 'dramatic, intense, highly dynamic framing',
        palette: 'contrasting colors, bold reds, deep shadows, dramatic skin tones',
        lighting: 'high contrast, dramatic chiaroscuro, intense spotlighting',
        description: 'Sizzling chemistry, sudden standoffs, tight breathing gaps.'
    },
    {
        id: 'historical',
        name: 'Historical Period',
        style: 'period accurate, vintage, elegant, textured film stock',
        palette: 'rich jewel tones, sepia, vintage copper',
        lighting: 'dramatic, candlelit, classical low-key',
        description: 'Vengeful royalty, forbidden historical ties, elegance.'
    },
    {
        id: 'fantasy',
        name: 'Mystical Fantasy',
        style: 'mystical, ethereal, magical, cinematic bloom',
        palette: 'deep purples, golds, mystical midnight blues',
        lighting: 'magical glow, dramatic dark shadow, ethereal backlight',
        description: 'Werewolves, vampires, secret mates, alphas.'
    },
    {
        id: 'smalltown',
        name: 'Cozy Small Town',
        style: 'cozy, intimate, warm, organic feel',
        palette: 'earth tones, warm amber, natural wood colors',
        lighting: 'soft natural, morning rays, warm golden hour warmth',
        description: 'Healing paths, reunion, secrets, warm intimacy.'
    }
];

const FOCAL_LENGTH_PRESETS = [
    { value: '13mm', label: '13mm (0.5x) Ultra-Wide', desc: 'Action, deep spaces, multiple characters. Distorts edges if tilted.', eq: '13mm' },
    { value: '24mm', label: '24mm (1.0x) Main Wide', desc: 'Natural vision, high dynamic range. Keep 1-1.5m away to avoid distortion.', eq: '24mm' },
    { value: '28mm', label: '28mm (1.2x) Street Wide', desc: 'Minimal facial distortion, tracking shots. Natural scale.', eq: '28mm' },
    { value: '48mm', label: '48mm (2.0x) portrait Crop', desc: 'Flattering compression, portrait & beauty. Best depth separation.', eq: '48mm' },
    { value: '77mm', label: '77mm (3.0x) telephoto', desc: 'Extreme close-up details, high emotion. Tight framing.', eq: '77mm' }
];

const ARCHETYPE_PRESETS = [
    {
        id: 'ice_king',
        name: 'The Ice King CEO',
        desc: 'Cold, ruthless, tailored suit, luxury wristwatch, razor-sharp gaze.',
        prompt: 'ultra photorealistic, [Age]-year-old male Ice King CEO, steel-gray eyes, cold ruthless expression, impeccably tailored dark navy suit, luxury watch peek, professional close-up portrait, cinematic high-contrast lighting, realistic skin textures, 85mm lens --ar 9:16 --v 7 --style raw --quality 5'
    },
    {
        id: 'fallen_heiress',
        name: 'The Fallen Heiress',
        desc: 'Proud princess becomes pauper overnight. Worn trench coat, elegant stature.',
        prompt: 'ultra photorealistic, [Age]-year-old elegant female, proud expression, posture of a princess, slightly worn trench coat, holding a vintage gold family necklace, neutral studio background, realistic textures, cinematic lighting --ar 9:16 --v 7 --style raw --quality 5'
    },
    {
        id: 'fake_fiancee',
        name: 'The Fake Fiancée',
        desc: 'Contract love, business casual blazer, awkward sweet body language.',
        prompt: 'ultra photorealistic, [Age]-year-old female fake fiancée, awkward sweet expression, oversized diamond engagement ring clearly visible, business casual beige blazer, studio lighting, soft shadows, sharp focus, 50mm lens --ar 9:16 --v 7 --style raw --quality 5'
    },
    {
        id: 'fated_mate',
        name: 'The Fated Mate',
        desc: 'Human with hidden wolf mate destiny, messy hair, ancient werewolf amulet.',
        prompt: 'ultra photorealistic, [Age]-year-old female with natural messy hair, minimal makeup, wearing an ancient glowing silver werewolf pendant, looking shocked, forest-green background, magical warm rim light, cinematic depth of field, 85mm --ar 9:16 --v 7 --style raw --quality 5'
    },
    {
        id: 'cursed_alpha',
        name: 'The Cursed Alpha',
        desc: 'Imposing werewolf leader, amber eyes, black leather jacket, runic scars.',
        prompt: 'ultra photorealistic, imposing rugged [Age]-year-old male alpha werewolf, amber glowing eyes, dark leather jacket, glowing runic neck scars, high-contrast dramatic side-lighting, smoke embers around him, dark backdrop, epic cinematic mood --ar 9:16 --v 7 --style raw --quality 5'
    },
    {
        id: 'phoenix',
        name: 'The Phoenix Rising',
        desc: 'Betrayed woman returning for revenge. Crimson silk dress, bold red lips.',
        prompt: 'ultra photorealistic, stunning [Age]-year-old female returning with a cold vengeful smile, signature bold crimson dress, bold red lipstick, subtle survival neck scar, luxurious setting, high-end studio portrait look, rim lighting, 105mm lens --ar 9:16 --v 7 --style raw --quality 5'
    }
];

const ENVIRONMENT_PRESETS = [
    {
        id: 'power_office',
        name: 'The Power Office',
        desc: 'Billionaire high-rise windows, rainy night skyline, massive mahogany desk.',
        prompt: 'ultra photorealistic, interior of a high-rise billionaire power office, floor-to-ceiling windows, rainy night city skyline outside, massive mahogany desk, crystal whiskey decanter, luxury executive chair, dramatic high-contrast split-tone lighting, cinematic atmosphere --ar 9:16 --v 7 --style raw --quality 5'
    },
    {
        id: 'penthouse',
        name: 'The Penthouse Palace',
        desc: 'White and gold marble, Grand crystal chandelier, reflection floors.',
        prompt: 'ultra photorealistic, luxury modern penthouse interior, white and gold color scheme, marble flooring with reflections, grand crystal chandelier, floor-to-ceiling glass doors, warm ambient lighting, highly detailed textures --ar 9:16 --v 7 --style raw --quality 5'
    },
    {
        id: 'moonlit_forest',
        name: 'The Moonlit Forest',
        desc: 'Gnarled trees, foggy ground, shafts of moonlight, blue atmosphere.',
        prompt: 'ultra photorealistic, ancient mysterious forest at night, foggy ground level, shafts of moonlight filtering through tree canopy, gnarled branches, mystical blue atmosphere, dramatic silhouettes, hyper-detailed moss textures --ar 9:16 --v 7 --style raw --quality 5'
    },
    {
        id: 'alphas_den',
        name: 'The Alpha\'s Den',
        desc: 'Stone walls, crackling fireplace, heavy leather couch, wolf furs.',
        prompt: 'ultra photorealistic, interior of an alpha werewolf\'s cozy rustic den, stone walls, crackling fireplace fire, heavy leather couches, wolf furs and pelts, warm flickering lighting, detailed wood grain textures, moody atmosphere --ar 9:16 --v 7 --style raw --quality 5'
    }
];

const MicrodramaWorkspace: React.FC<MicrodramaWorkspaceProps> = ({
    storyBible,
    setStoryBible,
    shotPrompts,
    setShotPrompts,
    mediaItems,
    setMediaItems,
    references,
    setReferences,
    apiKeyReady
}) => {
    const [activeTab, setActiveTab] = useState<'script' | 'video' | 'audio'>('script');

    // 1. Script Tab State (Detonation Formula)
    const [hookText, setHookText] = useState('');
    const [escalationText, setEscalationText] = useState('');
    const [freezeText, setFreezeText] = useState('');
    const [selectedCliffhanger, setSelectedCliffhanger] = useState('decision');

    // Load initial text if exists in storyBible
    useEffect(() => {
        if (storyBible.script && !hookText && !escalationText && !freezeText) {
            const parts = storyBible.script.split('\n=== PHASE');
            if (parts.length >= 3) {
                setHookText(parts[0].replace('=== PHASE 1: THE HOOK (0-15s) ===\n', '').trim());
                setEscalationText(parts[1].replace(' 2: THE ESCALATION (15-60s) ===\n', '').trim());
                setFreezeText(parts[2].replace(' 3: THE FREEZE (60-90s) ===\n', '').trim());
            } else {
                setHookText(storyBible.script.substring(0, 300));
                setEscalationText(storyBible.script.substring(300, 1000));
                setFreezeText(storyBible.script.substring(1000));
            }
        }
    }, [storyBible.script]);

    const handleSaveScriptToBible = () => {
        const fullScript = `=== PHASE 1: THE HOOK (0-15s) ===\n${hookText}\n\n=== PHASE 2: THE ESCALATION (15-60s) ===\n${escalationText}\n\n=== PHASE 3: THE FREEZE (60-90s) ===\n${freezeText}`;
        setStoryBible(prev => ({
            ...prev,
            script: fullScript,
            projectType: 'micro-drama' // Set custom project type to indicate vertical mobile drama
        }));
        alert('Detonation screenplay successfully saved to the active Story Bible!');
    };

    // AI Helper to draft high-tension screenplay drafts
    const handleAIScriptDraft = (genreId: string) => {
        const genre = SUBGENRE_PRESETS.find(p => p.id === genreId) || SUBGENRE_PRESETS[0];
        let h = '', esc = '', fr = '';

        if (genreId === 'billionaire') {
            h = `[SLAP!] The crystal goblet shatters on the polished marble. \n\nEVELYN (crying)\n"You married me... just for my bone marrow?!"\n\nPRESIDENT DAMIAN (coldly buttoning his Armani cuff)\n"Be glad your blood is at least useful to my true love, Evelyn."`;
            esc = `Evelyn backs away, her bare feet bleeding on the shards. She runs out into the pouring rain, but Damian's security guards block the gate.\n\nDamian steps out with an umbrella, looking down like a god.\n\nDAMIAN\n"Sign the divorce, and the marrow transplant happens tomorrow."\n\nAt exactly 40 seconds: Evelyn laughs, wiping her blood and tears. She stands tall.\n\nEVELYN\n"Damian... you think you own this city? The anonymous shareholder who bought 51% of your corporation this morning... is ME."`;
            fr = `Damian's phone buzzes. He answers, his face turning pale as ashes.\n\nDAMIAN (trembling)\n"W-what? The new chairwoman is a woman named... Evelyn Vance?"\n\nEvelyn smiles coldly, stepping past him into the rain.\n\n[FREEZE FRAME ON DAMIAN'S TOTAL DISBELIEF]`;
        } else if (genreId === 'enemies_to_lovers') {
            h = `ALEXANDER pins SARAH against the brick wall. A heavy silver knife is held between them. Sarah's breath is hot in the winter air.\n\nSARAH (grinning)\n"Kill me, Alexander. Or kiss me. Stop boring me."`;
            esc = `Alexander's grip tightens, but his eyes flicker down to her lips. Rain begins to fall, washing the soot off their faces.\n\nALEXANDER\n"If I let you live, you'll burn my empire down by dawn."\n\nSARAH\n"Then you better hold me very tight."\n\nAt exactly 40 seconds: Sarah pulls the trigger of a hidden pocket pistol. Click. It's empty. Alexander smirked, opening his hand to reveal her bullets.\n\nALEXANDER\n"Nice try, kitten. But I taught you that trick."`;
            fr = `Sarah gasps as Alexander drops the knife, grabbing her waist and pulling her into an intense, rain-soaked kiss. The sound of police sirens wail in the distance.\n\n[FREEZE FRAME ON SARAH'S SHOCKED EYELASHES AND UNRESOLVED BREATH]`;
        } else {
            h = `[CRASH!] The front door swings open. \n\nLUCAS (pointing, hands shaking)\n"I saw the signature. It was you! You sold our family secret!"`;
            esc = `Lucas demands answers. The room is silent except for the grandfather clock. \n\nLucas steps closer, cornering the suspect. \n\nAt 40 seconds: The suspect turns around, revealing Lucas's supposedly deceased brother, alive and wearing a luxurious signet ring.\n\nBROTHER\n"Lucas... I had to sell it. To save you."`;
            fr = `The brother raises a key. "Choose right now: follow me, or the bomb in the basement detonate in 10 seconds."\n\n[FREEZE FRAME ON LUCAS FACING THE ULTIMATUM]`;
        }

        setHookText(h);
        setEscalationText(esc);
        setFreezeText(fr);
    };

    // 2. Video Tab State (Video Prompt Formula Engine)
    const [selectedSubgenre, setSelectedSubgenre] = useState('billionaire');
    const [selectedEngine, setSelectedEngine] = useState<'kling' | 'veo' | 'seadance'>('kling');
    const [focalLength, setFocalLength] = useState('48mm');
    const [shotDescription, setShotDescription] = useState('The betrayed wife standing in the pouring rain, laughing with tears on her face.');
    const [characterName, setCharacterName] = useState('Evelyn (betrayed wife, white elegant dress)');
    const [outputPrompt, setOutputPrompt] = useState('');
    const [characterAge, setCharacterAge] = useState<number>(28);

    const handleApplyArchetype = (archetypeId: string) => {
        const archetype = ARCHETYPE_PRESETS.find(a => a.id === archetypeId);
        if (archetype) {
            const resolvedPrompt = archetype.prompt.replace('[Age]', characterAge.toString());
            setCharacterName(archetype.name);
            setShotDescription(resolvedPrompt);
        }
    };

    const handleApplyEnvironment = (envId: string) => {
        const env = ENVIRONMENT_PRESETS.find(e => e.id === envId);
        if (env) {
            setShotDescription(env.prompt);
        }
    };

    // Trigger prompt updates when specs change
    useEffect(() => {
        const sub = SUBGENRE_PRESETS.find(p => p.id === selectedSubgenre) || SUBGENRE_PRESETS[0];
        const focal = FOCAL_LENGTH_PRESETS.find(f => f.value === focalLength) || FOCAL_LENGTH_PRESETS[0];

        let formula = '';
        if (selectedEngine === 'kling') {
            formula = `Cinematic ${focal.value === '48mm' ? 'Portrait close-up' : 'Medium wide'} 9:16 vertical shot: ${characterName} ${shotDescription}. Pouring rain, golden street lamp light, extreme raw emotion with a tear rolling down her cheek. Subgenre: ${sub.name}. Style: ${sub.style}. Lighting: ${sub.lighting}. Color Palette: ${sub.palette}. Smooth camera motion, expressive facial performance, film quality vertical cinematography.`;
        } else if (selectedEngine === 'veo') {
            formula = `High-quality cinematic vertical 9:16 footage: ${shotDescription} featuring ${characterName}. Shot Type: ${focal.value === '48mm' ? 'Close portrait' : 'Wide landscape framing cropped to 9:16'} with deep emotional intimacy. ${sub.name} aesthetic, Lighting Style: ${sub.lighting}, Palette: ${sub.palette}. Professional phone-cinematography camera movement, realistic dynamic hair movement, atmospheric cinematic production values.`;
        } else {
            formula = `Professional cinematic vertical 9:16 video: ${shotDescription}. Character: ${characterName}. Tight ${focal.value} lens framing, deep emotional tension, ${sub.name} subgenre. Ultra-realistic human facial motion, lighting: ${sub.lighting}, palette: ${sub.palette}. Smooth professional camera work, natural skin texture, deep romance movie emotional authenticity.`;
        }
        setOutputPrompt(formula);
    }, [selectedSubgenre, selectedEngine, focalLength, shotDescription, characterName]);

    const handleAddShotPrompt = () => {
        const nextNum = shotPrompts.length > 0 ? Math.max(...shotPrompts.map(s => s.shot)) + 1 : 1;
        const newShot: ShotPrompt = {
            shot: nextNum,
            prompt: outputPrompt,
            description: shotDescription,
            characters: [characterName.split(' ')[0]],
            environment: 'Rainy City Street',
            cameraAngle: focalLength,
            lightingPresetId: selectedSubgenre,
            videoUrl: undefined
        };
        setShotPrompts(prev => [...prev, newShot]);
        alert(`Successfully added Shot #${nextNum} to the main project storyboard!`);
    };

    // 3. Audio Tab State (Mobile Optimization Desk)
    const [hpfEnabled, setHpfEnabled] = useState(true);
    const [dialogueBoost, setDialogueBoost] = useState(3.5); // +3.5dB at 2.5kHz
    const [intimacyBoost, setIntimacyBoost] = useState(3.0); // +3dB at 3kHz
    const [airShelf, setAirShelf] = useState(2.0); // +2dB at 12kHz
    const [targetLoudness, setTargetLoudness] = useState(-10); // -10 LUFS
    const [cliffhangerAudio, setCliffhangerAudio] = useState('suspended');

    const handleSaveAudioSpec = () => {
        const audioSpec = `=== MOBILE-FIRST AUDIO DESIGN SPECS ===
* Low-End Control: ${hpfEnabled ? 'STEEP HIGH-PASS FILTER AT 80HZ (Bass Management for Mobile Speakers)' : 'Bypass HPF'}
* Dialogue Clarity EQ: +${dialogueBoost}dB Boost at 2.5kHz (Optimized for noisy commutes)
* Intimacy EQ: +${intimacyBoost}dB Vocal Boost at 3.0kHz (Brings whisper scenes forward)
* Crispness EQ: +${airShelf}dB High-Shelf at 12kHz (Air & clarity on standard earbuds)
* Target Loudness: ${targetLoudness} LUFS (Integrated, high volume matching feeds)
* Peak Limiter Ceiling: -3.0 dB (Prevent phone amp clipping)
* Cliffhanger Ending Treatment: ${cliffhangerAudio === 'suspended' ? 'Unresolved Suspended Chords (sus2/sus4/diminished)' : cliffhangerAudio === 'silence' ? 'Sudden Vacuum Silence (Anticipatory anxiety spike)' : '110 BPM Subliminal Heartbeat pulse'}`;

        setStoryBible(prev => ({
            ...prev,
            productionGuidelines: `${prev.productionGuidelines || ''}\n\n${audioSpec}`.trim()
        }));
        alert('Specialized Mobile-First Audio specs appended to Project Production Guidelines!');
    };

    // Checklist validators
    const scriptValidations = [
        { name: 'Peak-Conflict Hook (0-15s)', pass: hookText.length > 50 && (hookText.toLowerCase().includes('slap') || hookText.toLowerCase().includes('blood') || hookText.toLowerCase().includes(' betrayal') || hookText.toLowerCase().includes('!') || hookText.toLowerCase().includes('sign')) },
        { name: '40-Second Dopamine Jolt / Reversal', pass: escalationText.length > 100 && (escalationText.toLowerCase().includes('40 second') || escalationText.toLowerCase().includes('exactly 40') || escalationText.toLowerCase().includes('reversal') || escalationText.toLowerCase().includes('turnout') || escalationText.toLowerCase().includes('reveal')) },
        { name: 'Cliffhanger Freeze (No Closure)', pass: freezeText.length > 50 && (freezeText.toLowerCase().includes('freeze') || freezeText.toLowerCase().includes('cliffhanger') || freezeText.toLowerCase().includes('unresolved') || freezeText.toLowerCase().includes('ultimatum') || freezeText.toLowerCase().includes('?')) }
    ];

    return (
        <div className="studio-workspace h-full flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
            {/* Workspace Header banner */}
            <div className="px-6 py-4 bg-gradient-to-r from-red-950/40 via-purple-950/30 to-gray-900 border-b border-red-900/30 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2 text-red-500">
                        <FireIcon />
                        Microdrama Studio Workspace
                    </h1>
                    <p className="text-xs text-gray-400 mt-0.5">Automated 9:16 Mobile-First Production & Screenplay Pipeline (爆点 Formula)</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('script')}
                        className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-2 transition ${activeTab === 'script' ? 'bg-red-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                    >
                        <ScriptIcon /> Screenplay (爆点)
                    </button>
                    <button
                        onClick={() => setActiveTab('video')}
                        className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-2 transition ${activeTab === 'video' ? 'bg-red-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                    >
                        <VideoIcon /> Video Prompt Formula
                    </button>
                    <button
                        onClick={() => setActiveTab('audio')}
                        className={`px-4 py-2 text-xs font-semibold rounded-lg flex items-center gap-2 transition ${activeTab === 'audio' ? 'bg-red-600 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                    >
                        <AudioIcon /> Mobile EQ & Audio
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

                {/* TAB 1: SCREENPLAY PLANNER */}
                {activeTab === 'script' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Interactive Editor Form */}
                        <div className="lg:col-span-2 space-y-4 bg-gray-900/40 border border-gray-800 rounded-xl p-5">
                            <div className="flex justify-between items-center mb-2">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    <ScriptIcon /> Screenplay Draft (90s Beat Timeline)
                                </h2>
                                <div className="flex gap-1.5">
                                    <button
                                        onClick={() => handleAIScriptDraft('billionaire')}
                                        className="px-2.5 py-1 text-[11px] bg-amber-600/25 text-amber-300 border border-amber-500/30 rounded hover:bg-amber-600/40 transition"
                                    >
                                        💡 Billionaire Drama Presets
                                    </button>
                                    <button
                                        onClick={() => handleAIScriptDraft('enemies_to_lovers')}
                                        className="px-2.5 py-1 text-[11px] bg-red-600/25 text-red-300 border border-red-500/30 rounded hover:bg-red-600/40 transition"
                                    >
                                        ⚡ Intense Enemies Presets
                                    </button>
                                </div>
                            </div>

                            {/* Phase 1 Input */}
                            <div className="space-y-1">
                                <label className="block text-xs font-medium text-red-400">Phase 1: The Hook (0 - 15 Seconds) — Immediate high crisis / betrayal</label>
                                <textarea
                                    value={hookText}
                                    onChange={(e) => setHookText(e.target.value)}
                                    placeholder="Enter mid-crisis (in media res). No setup. e.g., SLAP! 'You betrayed our contract marriage!'"
                                    className="w-full h-32 bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-red-500 text-gray-200"
                                />
                            </div>

                            {/* Phase 2 Input */}
                            <div className="space-y-1">
                                <label className="block text-xs font-medium text-purple-400">Phase 2: The Escalation (15 - 60 Seconds) — Mini-conflicts & 40s Climax Reversal</label>
                                <textarea
                                    value={escalationText}
                                    onChange={(e) => setEscalationText(e.target.value)}
                                    placeholder="Layer intense mini-conflicts. REMEMBER to specify a major climax twist/reversal at precisely the 40-second mark!"
                                    className="w-full h-40 bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 text-gray-200"
                                />
                            </div>

                            {/* Phase 3 Input */}
                            <div className="space-y-1">
                                <label className="block text-xs font-medium text-amber-400">Phase 3: The Freeze (60 - 90 Seconds) — Abrupt high-stakes cliffhanger</label>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mb-2">
                                    {['decision', 'identity', 'threat', 'break', 'powershift'].map((cat) => (
                                        <button
                                            key={cat}
                                            onClick={() => setSelectedCliffhanger(cat)}
                                            className={`py-1 text-[10px] uppercase font-bold rounded border transition ${selectedCliffhanger === cat ? 'bg-amber-600 border-amber-500 text-white' : 'bg-gray-950 border-gray-800 hover:border-gray-700 text-gray-400'}`}
                                        >
                                            {cat === 'powershift' ? 'Power Shift' : `${cat} freeze`}
                                        </button>
                                    ))}
                                </div>
                                <textarea
                                    value={freezeText}
                                    onChange={(e) => setFreezeText(e.target.value)}
                                    placeholder="Withhold resolution completely. Freeze characters at a devastating decision point, reveal, or sudden physical threat!"
                                    className="w-full h-32 bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500 text-gray-200"
                                />
                            </div>

                            <button
                                onClick={handleSaveScriptToBible}
                                className="w-full bg-red-600 hover:bg-red-500 py-2.5 rounded-lg text-sm font-semibold text-white transition flex justify-center items-center gap-2 mt-4 shadow-lg shadow-red-950/20"
                            >
                                <ScriptIcon /> Save Screenplay to Project Bible
                            </button>
                        </div>

                        {/* Real-time Detonation Assessment Sidebar */}
                        <div className="space-y-4">
                            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
                                <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wider">爆点 Pacing Checklist</h3>
                                <div className="space-y-3">
                                    {scriptValidations.map((val, idx) => (
                                        <div key={idx} className="flex items-start gap-3 p-2.5 rounded-lg bg-gray-950/60 border border-gray-800/80">
                                            {val.pass ? <CheckIcon /> : <ExclamationIcon />}
                                            <div>
                                                <h4 className="text-xs font-semibold text-gray-200">{val.name}</h4>
                                                <p className="text-[10px] text-gray-400 mt-0.5">
                                                    {idx === 0 && 'Must start directly mid-crisis (e.g. slaps, betrayals, sudden reveals).'}
                                                    {idx === 1 && 'Pacing requires a powerful plot twist/reversal at the 40-second mark.'}
                                                    {idx === 2 && 'Must deny closure completely using one of the 5 cliffhanger templates.'}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-gradient-to-br from-red-950/20 to-gray-950 border border-red-900/20 rounded-xl p-5">
                                <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">Technical Framing Tips</h3>
                                <p className="text-xs text-gray-300 leading-relaxed">
                                    When drafting the actions, frame human drama in <b>48mm (2.0x) portrait focal lengths</b> to compress faces beautifully and simulate optical bokeh on modern mobile sensors (iPhone 15 Pro).
                                    Avoid placing character heads on the portrait edge boundaries to prevent wide-angle stretching.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 2: VIDEO PROMPT ENGINE */}
                {activeTab === 'video' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Prompt Customization Form */}
                        <div className="lg:col-span-2 space-y-4 bg-gray-900/40 border border-gray-800 rounded-xl p-5">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                                <SparklesIcon /> Engine-Specific Video Prompt Builder (9:16 Vertical)
                            </h2>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="block text-xs font-medium text-gray-400">Subgenre & Visual Aesthetics</label>
                                    <select
                                        value={selectedSubgenre}
                                        onChange={(e) => setSelectedSubgenre(e.target.value)}
                                        className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-gray-200"
                                    >
                                        {SUBGENRE_PRESETS.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="block text-xs font-medium text-gray-400">Target Video Model Engine</label>
                                    <div className="grid grid-cols-3 gap-1">
                                        {['kling', 'veo', 'seadance'].map((eng) => (
                                            <button
                                                key={eng}
                                                onClick={() => setSelectedEngine(eng as any)}
                                                className={`py-2 text-xs font-bold rounded border transition ${selectedEngine === eng ? 'bg-red-600 border-red-500 text-white' : 'bg-gray-950 border-gray-800 text-gray-400 hover:border-gray-700'}`}
                                            >
                                                {eng === 'kling' ? 'Kling 2.6 (Emotions)' : eng === 'veo' ? 'Veo 3 (Camera Moves)' : 'SeaDance (Intimacy)'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* High-Converting Character & Environment Presets */}
                            <div className="p-4 bg-gray-950/60 border border-gray-800 rounded-lg space-y-4">
                                <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                                    <div>
                                        <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider">Character Archetypes (Midjourney V7 formula)</h3>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Loads ready-to-render character profiles with emotional triggers.</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-400 font-medium">Set Character Age:</span>
                                        <input
                                            type="number"
                                            value={characterAge}
                                            onChange={(e) => setCharacterAge(Math.max(18, Math.min(100, parseInt(e.target.value) || 28)))}
                                            className="w-14 bg-gray-900 border border-gray-800 rounded p-1 text-xs text-center text-white"
                                            min="18"
                                            max="100"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {ARCHETYPE_PRESETS.map((arch) => (
                                        <button
                                            key={arch.id}
                                            onClick={() => handleApplyArchetype(arch.id)}
                                            className="p-2 text-[11px] text-left bg-gray-900 border border-gray-800 rounded-lg hover:border-red-500 hover:bg-gray-900/80 transition flex flex-col justify-between"
                                            title={arch.desc}
                                        >
                                            <span className="font-bold text-white block">{arch.name}</span>
                                            <span className="text-[9px] text-gray-500 mt-1 truncate w-full">{arch.desc}</span>
                                        </button>
                                    ))}
                                </div>

                                <div className="pt-2 border-t border-gray-800/40">
                                    <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">Cinematic 9:16 Environment Presets</h3>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                        {ENVIRONMENT_PRESETS.map((env) => (
                                            <button
                                                key={env.id}
                                                onClick={() => handleApplyEnvironment(env.id)}
                                                className="p-2 text-[11px] text-left bg-gray-900 border border-gray-800 rounded-lg hover:border-purple-500 hover:bg-gray-900/80 transition flex flex-col justify-between"
                                                title={env.desc}
                                            >
                                                <span className="font-bold text-white block">{env.name}</span>
                                                <span className="text-[9px] text-gray-500 mt-1 truncate w-full">{env.desc}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="block text-xs font-medium text-gray-400">iPhone Pro Portrait Lens Crop</label>
                                    <select
                                        value={focalLength}
                                        onChange={(e) => setFocalLength(e.target.value)}
                                        className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-gray-200"
                                    >
                                        {FOCAL_LENGTH_PRESETS.map(f => (
                                            <option key={f.value} value={f.value}>{f.label} — {f.desc}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="block text-xs font-medium text-gray-400">Lead Character Name / Subject</label>
                                    <input
                                        type="text"
                                        value={characterName}
                                        onChange={(e) => setCharacterName(e.target.value)}
                                        placeholder="e.g. Evelyn (betrayed wife, white silk dress)"
                                        className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-gray-200"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <label className="block text-xs font-medium text-gray-400">Shot Action & Narrative Description</label>
                                <textarea
                                    value={shotDescription}
                                    onChange={(e) => setShotDescription(e.target.value)}
                                    placeholder="Describe the action and expression in detail..."
                                    className="w-full h-20 bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-sm text-gray-200 focus:outline-none"
                                />
                            </div>

                            {/* Output Prompt Formula Field */}
                            <div className="space-y-1 bg-gray-950/90 border border-gray-800/80 rounded-lg p-4 mt-2">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="block text-[10px] font-bold text-red-400 uppercase tracking-wider">Generated Model-Calibrated Prompt</label>
                                    <span className="text-[9px] bg-gray-800 px-1.5 py-0.5 rounded text-gray-400 uppercase font-mono">{selectedEngine} engine preset active</span>
                                </div>
                                <p className="text-xs text-gray-100 font-mono select-all break-words leading-relaxed">{outputPrompt}</p>
                            </div>

                            <button
                                onClick={handleAddShotPrompt}
                                className="w-full bg-red-600 hover:bg-red-500 py-2.5 rounded-lg text-sm font-semibold text-white transition flex justify-center items-center gap-2 shadow-lg shadow-red-950/20"
                            >
                                <VideoIcon /> Inject into Storyboard / Shot List
                            </button>
                        </div>

                        {/* Presets and Guidance Sidebar */}
                        <div className="space-y-4">
                            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
                                <h3 className="text-sm font-bold text-white mb-3">Engine Highlights</h3>
                                <ul className="space-y-3 text-xs text-gray-300">
                                    <li className="flex items-start gap-2">
                                        <span className="text-red-500 font-bold">•</span>
                                        <div>
                                            <b>Kling:</b> Exceptional for close-up micro expressions, crying, slaps, and complex physical interactions.
                                        </div>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-purple-500 font-bold">•</span>
                                        <div>
                                            <b>Veo 3:</b> Superb high-resolution wide landscapes and heavy camera movements. Ideal for dramatic entrances.
                                        </div>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-500 font-bold">•</span>
                                        <div>
                                            <b>SeaDance:</b> Outstanding photorealistic romantic skin textures, slow breathing loops, and intimate whispering.
                                        </div>
                                    </li>
                                </ul>
                            </div>

                            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Visual Style Spec</h3>
                                <div className="p-3 bg-gray-950 rounded-lg text-xs space-y-1.5">
                                    <div className="text-gray-400">Current Palette:</div>
                                    <div className="font-semibold text-white">{(SUBGENRE_PRESETS.find(p => p.id === selectedSubgenre) || SUBGENRE_PRESETS[0]).palette}</div>
                                    <div className="text-gray-400 mt-2">Current Lighting:</div>
                                    <div className="font-semibold text-white">{(SUBGENRE_PRESETS.find(p => p.id === selectedSubgenre) || SUBGENRE_PRESETS[0]).lighting}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 3: MOBILE AUDIO MIXING DESK */}
                {activeTab === 'audio' && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Audio Controls Panel */}
                        <div className="lg:col-span-2 space-y-5 bg-gray-900/40 border border-gray-800 rounded-xl p-5">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-2">
                                <AudioIcon /> Mobile-First EQ & Audio Mastering Console
                            </h2>

                            {/* EQ Sliders and Toggles */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-3 bg-gray-950 rounded-lg border border-gray-800">
                                        <div>
                                            <h3 className="text-xs font-semibold text-white">Steep HPF Filter (80Hz)</h3>
                                            <p className="text-[10px] text-gray-400 mt-0.5">Cuts low distortion on tiny phone speakers.</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={hpfEnabled}
                                            onChange={(e) => setHpfEnabled(e.target.checked)}
                                            className="w-4 h-4 text-red-600 bg-gray-900 border-gray-800 rounded focus:ring-red-500 focus:ring-1"
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <div className="flex justify-between text-xs text-gray-300">
                                            <span>Dialogue Boost at 2.5kHz (Clarity)</span>
                                            <span className="text-red-400 font-bold">+{dialogueBoost.toFixed(1)} dB</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="8"
                                            step="0.5"
                                            value={dialogueBoost}
                                            onChange={(e) => setDialogueBoost(parseFloat(e.target.value))}
                                            className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-red-600"
                                        />
                                        <p className="text-[9px] text-gray-500">Intelligibility in noisy environments.</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-xs text-gray-300">
                                            <span>Vocal Intimacy Boost at 3.0kHz</span>
                                            <span className="text-red-400 font-bold">+{intimacyBoost.toFixed(1)} dB</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="6"
                                            step="0.5"
                                            value={intimacyBoost}
                                            onChange={(e) => setIntimacyBoost(parseFloat(e.target.value))}
                                            className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-red-600"
                                        />
                                        <p className="text-[9px] text-gray-500">Brings vocals forward for close-up face framing.</p>
                                    </div>

                                    <div className="space-y-1">
                                        <div className="flex justify-between text-xs text-gray-300">
                                            <span>Crisp High-Shelf Boost at 12kHz</span>
                                            <span className="text-red-400 font-bold">+{airShelf.toFixed(1)} dB</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="5"
                                            step="0.5"
                                            value={airShelf}
                                            onChange={(e) => setAirShelf(parseFloat(e.target.value))}
                                            className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-red-600"
                                        />
                                        <p className="text-[9px] text-gray-500">Crystalline sparkle on earbuds.</p>
                                    </div>
                                </div>
                            </div>

                            {/* Loudness & Ending Treatment */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-800/60">
                                <div className="space-y-1">
                                    <label className="block text-xs font-medium text-gray-400">Target Loudness (Integrated)</label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            min="-16"
                                            max="-6"
                                            step="1"
                                            value={targetLoudness}
                                            onChange={(e) => setTargetLoudness(parseInt(e.target.value))}
                                            className="flex-1 h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-red-600"
                                        />
                                        <span className="text-xs font-bold text-white font-mono">{targetLoudness} LUFS</span>
                                    </div>
                                    <p className="text-[9px] text-gray-500">Social standard feed volume matches.</p>
                                </div>

                                <div className="space-y-1">
                                    <label className="block text-xs font-medium text-gray-400">Cliffhanger Audio Design</label>
                                    <select
                                        value={cliffhangerAudio}
                                        onChange={(e) => setCliffhangerAudio(e.target.value)}
                                        className="w-full bg-gray-950 border border-gray-800 rounded-lg p-2.5 text-xs text-gray-200 focus:ring-1 focus:ring-red-500"
                                    >
                                        <option value="suspended">Hold Unresolved Suspended Chords (sus2/sus4/diminished)</option>
                                        <option value="silence">Sudden Vacuum of Silence (Anxiety cliffhanger spike)</option>
                                        <option value="heartbeat">Subliminal Low 110 BPM Heartbeat pulse</option>
                                    </select>
                                </div>
                            </div>

                            <button
                                onClick={handleSaveAudioSpec}
                                className="w-full bg-red-600 hover:bg-red-500 py-2.5 rounded-lg text-sm font-semibold text-white transition flex justify-center items-center gap-2 shadow-lg shadow-red-950/20"
                            >
                                <AudioIcon /> Inject Audio Specifications into Guidelines
                            </button>
                        </div>

                        {/* Interactive EQ Graph Visualizer */}
                        <div className="space-y-4">
                            <div className="bg-gray-900/40 border border-gray-800 rounded-xl p-5">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 text-center">Mobile EQ Profile Curve</h3>
                                <div className="relative w-full h-44 bg-gray-950 rounded-lg border border-gray-800 overflow-hidden flex items-center justify-center">
                                    {/* Simulated EQ Grid lines */}
                                    <div className="absolute inset-0 grid grid-cols-5 grid-rows-4 pointer-events-none opacity-20">
                                        {[...Array(5)].map((_, i) => <div key={`col-${i}`} className="border-r border-gray-600 h-full" />)}
                                        {[...Array(4)].map((_, i) => <div key={`row-${i}`} className="border-b border-gray-600 w-full" />)}
                                    </div>

                                    {/* Frequency Tags */}
                                    <div className="absolute bottom-1.5 left-2 text-[8px] text-gray-600">80Hz</div>
                                    <div className="absolute bottom-1.5 left-1/3 text-[8px] text-gray-600">1kHz</div>
                                    <div className="absolute bottom-1.5 left-2/3 text-[8px] text-gray-600">4kHz</div>
                                    <div className="absolute bottom-1.5 right-2 text-[8px] text-gray-600">15kHz</div>

                                    {/* Interactive EQ Spline Curve using dynamic SVG */}
                                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
                                        <path
                                            d={`M 0,25
                                                C ${hpfEnabled ? '10,48 15,48' : '10,25 15,25'}
                                                25,25 35,25
                                                C 45,25 55,${25 - dialogueBoost * 2.2} 60,${25 - dialogueBoost * 2.2}
                                                C 65,${25 - intimacyBoost * 2} 70,${25 - (dialogueBoost + intimacyBoost) * 1.3} 80,${25 - airShelf * 2.2}
                                                Q 90,${25 - airShelf * 2.2} 100,${25 - airShelf * 2.2}`}
                                            fill="none"
                                            stroke="#ef4444"
                                            strokeWidth="1.5"
                                        />
                                    </svg>
                                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                        <span className="text-[9px] text-gray-400 font-mono">Mobile Filter Active</span>
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-400 mt-2.5 leading-relaxed text-center">
                                    The curve displays high-pass filter bass cuts below 80Hz, followed by mid-frequency dialogue gains and a crystal-clear high shelf sparkle.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};

export default MicrodramaWorkspace;
