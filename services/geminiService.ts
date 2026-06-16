import { GoogleGenAI, Modality, Type, GenerateContentResponse, Operation, Chat, FunctionDeclaration, GenerateImagesResponse } from "@google/genai";
import { MediaItem, ScriptAnalysisResult, StoryBible, ChatMessage, ShotPrompt, ReviewFeedback, ScriptLength, CinematographyCritique, AudioScoreRequest, TimelineClip, ReferenceItem, NeurocinematicsAnalysisResult } from '../types';
import { getVideoDuration, fileToBase64, decode } from "../utils/helpers";

export const analyzeVideoWithNeurocinematics = async (videoUrl: string, script?: string): Promise<NeurocinematicsAnalysisResult> => {
    const ai = getAiClient();

    // Fetch video blob and convert to base64
    const response = await fetch(videoUrl);
    const blob = await response.blob();
    const file = new File([blob], "temp_video", { type: blob.type });
    const base64Video = await fileToBase64(file);

    const contents = [
        {
            role: 'user',
            parts: [
                {
                    text: `Analyze this video clip based on the following scientific filmmaking principles:

                1. **Neurocinematics (Mirror Neurons & Embodiment):** Does the staging and camera work allow the viewer to physically simulate the action?
                2. **Event Segmentation Theory:** Do the cuts align with natural perceptual boundaries (completion of an action/thought)? Identify any jarring cuts.
                3. **The Kuleshov Effect:** Analyze the semantic relationship between shots. Is the combination creating new meaning, or is it disjointed?
                4. **Cognitive Load & Visual Hierarchy:** Is the viewer's eye guided effectively?
                5. **Sound Design (Psychoacoustics):** (If audio exists) Does the sound match the emotional intent?

                Context (Script/Story): ${script || "No script provided. Infer context from visual narrative."}

                Return a JSON object with:
                - overallFeedback: High-level analysis of the 5 principles.
                - scenes: A breakdown of key moments/shots with specific feedback and "Improvement Suggestions".
                ` },
                { inlineData: { data: base64Video.split(',')[1], mimeType: blob.type } }
            ]
        }
    ];

    const result = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.0-flash-exp", // Use a model with video understanding
        contents: contents,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    overallFeedback: {
                        type: Type.OBJECT,
                        properties: {
                            neurocinematics: { type: Type.STRING },
                            kuleshovEffect: { type: Type.STRING },
                            cognitivePsychology: { type: Type.STRING },
                            soundDesign: { type: Type.STRING }
                        },
                        required: ["neurocinematics", "kuleshovEffect", "cognitivePsychology", "soundDesign"]
                    },
                    scenes: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING },
                                timestamp: { type: Type.STRING },
                                description: { type: Type.STRING },
                                visualFeedback: { type: Type.STRING },
                                soundFeedback: { type: Type.STRING },
                                scientificPrinciple: { type: Type.STRING },
                                improvementSuggestion: { type: Type.STRING }
                            },
                            required: ["id", "timestamp", "description", "visualFeedback", "soundFeedback", "scientificPrinciple", "improvementSuggestion"]
                        }
                    }
                },
                required: ["overallFeedback", "scenes"]
            }
        }
    }));

    try {
        return JSON.parse(result.text.trim());
    } catch (e) {
        throw new Error("Failed to parse Neurocinematics analysis.");
    }
};

declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}

const withRetry = async <T>(
    apiCall: () => Promise<T>,
    maxRetries = 5,
    initialDelay = 2000
): Promise<T> => {
    let attempt = 0;
    while (true) {
        try {
            return await apiCall();
        } catch (error: any) {
            const errorMessage = error.message || '';
            const isPermissionError = errorMessage.includes('403') || errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('The caller does not have permission');
            const isQuotaError = errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('quota');

            if (isPermissionError) {
                throw error;
            }

            attempt++;
            if (attempt >= maxRetries) {
                throw error;
            }

            const delay = initialDelay * Math.pow(2, attempt - 1);

            if (isQuotaError) {
                console.warn(`Quota exceeded (429). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 1000));
            } else if (errorMessage.includes("overloaded")) {
                console.warn(`Model overloaded. Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else if (!errorMessage.includes("400") && !errorMessage.includes("404")) {
                console.warn(`API Error (${errorMessage}). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

const getAiClient = () => {
    // Check process.env first (for web dev), then LocalStorage (for desktop/user key)
    const envKey = process.env.API_KEY;
    const storageKey = localStorage.getItem('gemini_api_key');

    const apiKey = envKey || storageKey;

    if (!apiKey) {
        throw new Error("API Key is missing. Please enter your Google Gemini API Key in the settings.");
    }
    return new GoogleGenAI({ apiKey });
};

// ... (Rest of the file remains exactly the same as previous version)
export const generateVideoWithVeo = async (
    prompt: string,
    onProgress: (message: string) => void,
    aspectRatio: '16:9' | '9:16',
    referenceImage?: { base64: string; mimeType: string; },
    model: string = 'veo-3.1-fast-generate-preview'
): Promise<MediaItem> => {
    onProgress(`Initializing video generation (${model})...`);
    const ai = getAiClient();

    const requestPayload: any = {
        model: model,
        prompt,
        config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio,
        }
    };

    if (referenceImage) {
        onProgress("Preparing image-to-video reference...");
        requestPayload.image = {
            imageBytes: referenceImage.base64,
            mimeType: referenceImage.mimeType,
        }
    }

    let operation: Operation<any> = await withRetry(() => ai.models.generateVideos(requestPayload));

    onProgress("Video generation started. This may take a few minutes...");
    let checks = 0;
    while (!operation.done) {
        checks++;
        const progressMessages = [
            "Warming up the digital canvas...",
            "Teaching pixels to dance...",
            "Composing a symphony of light and sound...",
            "Rendering dreams into reality frame by frame...",
            "Almost there, adding the final touches of magic...",
        ];
        const messageIndex = Math.min(checks, progressMessages.length - 1);
        onProgress(`Polling for results... (${progressMessages[messageIndex]})`);

        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    if (operation.error) {
        throw new Error(`Video generation failed: ${operation.error.message}`);
    }

    onProgress("Fetching generated video...");
    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;

    if (!downloadLink) {
        throw new Error("Could not retrieve video download link.");
    }

    // Note: For Veo, we might need the key in the fetch URL if strictly using REST,
    // but the SDK usually handles this. If raw fetch is needed:
    const apiKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
    const response = await fetch(`${downloadLink}&key=${apiKey}`);

    if (!response.ok) {
        throw new Error("Failed to download the generated video.");
    }
    const videoBlob = await response.blob();
    const videoUrl = URL.createObjectURL(videoBlob);

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(videoUrl);
    } catch (e) {
        console.error("Could not get duration of generated video", e);
        duration = 5; // Fallback duration
    }

    return {
        id: `veo-${Date.now()}`,
        name: `veo_video_${prompt.slice(0, 15)}.mp4`,
        type: 'video',
        url: videoUrl,
        source: 'generated',
        duration,
    };
};

export const generateImageWithNano = async (prompt: string): Promise<MediaItem> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: [{ text: prompt }],
        },
        config: {
            responseModalities: [Modality.IMAGE],
        },
    }));

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                return {
                    id: `nano-${Date.now()}`,
                    name: `nano_image_${prompt.slice(0, 15)}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated'
                };
            }
        }
    }

    console.error("Image generation (Nano) failed. Full API response:", JSON.stringify(response, null, 2));
    throw new Error("Image generation failed.");
};

export const generateImageWithGemini3Pro = async (prompt: string, aspectRatio: string, imageSize: string): Promise<MediaItem> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: {
            parts: [{ text: prompt }],
        },
        config: {
            imageConfig: {
                aspectRatio: aspectRatio,
                imageSize: imageSize
            },
        },
    }));

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                return {
                    id: `gemini-pro-${Date.now()}`,
                    name: `pro_image_${prompt.slice(0, 15)}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated'
                };
            }
        }
    }

    console.error("Image generation (Gemini 3 Pro) failed.", JSON.stringify(response, null, 2));
    throw new Error("Image generation failed.");
};

export const generateImageWithImagen = async (prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'): Promise<MediaItem> => {
    const ai = getAiClient();
    const response: GenerateImagesResponse = await withRetry(() => ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio,
        },
    }));

    const base64ImageBytes: string | undefined = response.generatedImages?.[0]?.image?.imageBytes;
    if (!base64ImageBytes) {
        throw new Error("Imagen generation failed.");
    }
    const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
    return {
        id: `imagen-${Date.now()}`,
        name: `imagen_${prompt.slice(0, 15)}.jpg`,
        type: 'image',
        url: imageUrl,
        source: 'generated',
    };
};

export const editImage = async (prompt: string, image: { base64: string; mimeType: string }, referenceImage?: { base64: string; mimeType: string }): Promise<MediaItem> => {
    const ai = getAiClient();
    const parts: any[] = [
        { inlineData: { data: image.base64, mimeType: image.mimeType } },
        { text: prompt },
    ];

    if (referenceImage) {
        parts.push({ text: "Use the following image as a style or object reference for the edit:" });
        parts.push({ inlineData: { data: referenceImage.base64, mimeType: referenceImage.mimeType } });
    }

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
            parts: parts,
        },
        config: { responseModalities: [Modality.IMAGE] },
    }));

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                return {
                    id: `edit-${Date.now()}`,
                    name: `edited_${prompt.slice(0, 15)}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated',
                };
            }
        }
    }
    throw new Error("Image editing failed.");
};

export const analyzeImage = async (prompt: string, image: { base64: string, mimeType: string }): Promise<string> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { text: prompt },
                { inlineData: { data: image.base64, mimeType: image.mimeType } },
            ],
        },
    }));
    return response.text;
};

export const transcribeAudio = async (audio: { base64: string, mimeType: string }): Promise<string> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { text: 'Transcribe the following audio recording.' },
                { inlineData: { data: audio.base64, mimeType: audio.mimeType } },
            ]
        }
    }));
    return response.text;
};

export const runChat = async (
    history: ChatMessage[],
    mode: 'chat' | 'search' | 'maps' | 'thinking',
    tools?: FunctionDeclaration[],
): Promise<GenerateContentResponse> => {
    const ai = getAiClient();
    const contents: any[] = history.map(h => {
        if (h.role === 'tool') {
            return { role: 'tool', parts: h.toolResponses };
        }
        if (h.role === 'model' && h.toolCalls) {
            return { role: 'model', parts: [{ functionCall: h.toolCalls[0] }] };
        }
        return { role: h.role, parts: [{ text: h.text }] };
    });

    let model: string;
    let config: any = {};
    if (tools && tools.length > 0) {
        config.tools = [{ functionDeclarations: tools }];
    }
    switch (mode) {
        case 'search': model = 'gemini-2.5-flash'; config.tools = [{ googleSearch: {} }]; break;
        case 'maps': model = 'gemini-2.5-flash'; config.tools = [{ googleMaps: {} }]; break;
        case 'thinking': model = 'gemini-2.5-pro'; config.thinkingConfig = { thinkingBudget: 32768 }; break;
        default: model = tools ? 'gemini-2.5-pro' : 'gemini-2.5-flash'; break;
    }

    const response = await withRetry(() => ai.models.generateContent({ model, contents, config }));
    return response;
};

export const analyzeScriptForReferences = async (script: string): Promise<ScriptAnalysisResult> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are a film director's assistant. Analyze the script below to extract Characters, Environments, and Products (if it is a commercial).

        **Crucial Requirement: Multiple Outfits**
        - Analyze the script for an "OUTFITS" section or character descriptions in scene headers.
        - If a character appears in multiple distinct outfits, CREATE A SEPARATE ENTRY for each variation (e.g., "Betsy (Bikini)", "Betsy (Dress)").

        **Commercial/Ads:**
        - If the script promotes a product or brand, extract it as a "Product" entry. This includes Logos, specific items (e.g., "Perfume Bottle"), or branded props.

        Script: --- ${script} ---`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    characters: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING, description: "Character Name (and Outfit Variant if applicable)" },
                                description: { type: Type.STRING, description: "Visual description of appearance and clothing." }
                            },
                            required: ['name', 'description']
                        }
                    },
                    environments: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                description: { type: Type.STRING }
                            },
                            required: ['name', 'description']
                        }
                    },
                    products: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                description: { type: Type.STRING, description: "Visual details of the product, logo, or brand asset." }
                            },
                            required: ['name', 'description']
                        }
                    }
                },
                required: ['characters', 'environments']
            },
        },
    }));
    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error("Could not understand the AI's analysis.");
    }
}

export const generateScript = async (prompt: string, length: ScriptLength): Promise<string> => {
    const ai = getAiClient();

    let lengthInstruction = "";
    switch (length) {
        case 'teaser': lengthInstruction = "Write a high-impact 30-second teaser script (approx 0.5 - 1 page). Focus on hooks and mystery."; break;
        case 'trailer': lengthInstruction = "Write a 60-90 second trailer script (approx 1-2 pages). Follow a 3-act structure: Setup, Confrontation, Climax."; break;
        case 'short': lengthInstruction = "Write a 5-10 minute short film script (approx 5-10 pages). Develop characters and a complete narrative arc."; break;
        case 'feature': lengthInstruction = "Write a detailed Treatment and the First Scene for a 90-minute feature film. Do not write the full 90 pages. Outline the major beats of the Feature Film first, then write the opening scene in standard screenplay format."; break;
        case 'commercial': lengthInstruction = "Write a compelling 15-60 second TV Commercial / Ad script. Focus on: 1. The Hook (Grab attention immediately), 2. The Value Proposition (Solve a problem), 3. The Call to Action (CTA). Keep dialogue snappy. Mention specific products/logos visually."; break;
    }

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are an expert screenwriter embodying the storytelling principles of Robert McKee (Story) and Joseph Campbell (The Hero's Journey).

        Task: Write a script based on the idea: "${prompt}".
        Format: Standard Final Draft Industry Format (Scene Headings in CAPS, Character names centered, Dialogue centered).

        ${lengthInstruction}

        Apply McKee's principle of "Conflict" in every scene. Ensure the dialogue has subtext.`,
        config: { thinkingConfig: { thinkingBudget: 4096 } }
    }));

    return response.text;
};

export const editScriptSelection = async (fullScript: string, selection: string, instruction: string): Promise<string> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are a professional script doctor.

        Context (Full Script):
        ---
        ${fullScript.substring(0, 2000)}... (truncated context)
        ---

        Selected Text to Edit:
        "${selection}"

        Instruction: "${instruction}"

        Return ONLY the rewritten version of the Selected Text. Maintain standard screenplay format.`,
    }));
    return response.text;
};

export const suggestNextPlotPoints = async (script: string): Promise<string[]> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Based on the following script, suggest 3 divergent plot progressions or "next beats" for the story.

        Script so far:
        ---
        ${script.substring(script.length - 3000)}
        ---

        Return a JSON array of 3 strings. Each string should be a concise plot beat description.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                minItems: 3,
                maxItems: 3
            }
        }
    }));
    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        return ["Continue the confrontation", "Introduce a twist", "Reveal a secret"];
    }
};

export const suggestVisualStyles = async (script: string): Promise<string[]> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Analyze the mood and genre of this script. Suggest 5 distinct visual styles (e.g., "Gritty Noir", "Vibrant 3D Animation", "Hand-drawn Anime", "Photorealistic Cinematic", "Symmetric Pastel").

        Script excerpt: "${script.substring(0, 1000)}..."

        Return a JSON array of strings.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
            }
        }
    }));
    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        return ["Cinematic Photorealistic", "Stylized Animation"];
    }
};

export const generateProductionGuidelines = async (bible: StoryBible): Promise<string> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `Create production guidelines. Logline: ${bible.logline}. Script: ${bible.script}`,
    }));
    return response.text;
};

export const generateReferenceDetails = async (
    type: 'character' | 'environment' | 'product' | 'prop',
    name: string,
    description: string,
    scriptContext?: string,
    style?: string
): Promise<{ prompt: string, tags: string[] }> => {
    const ai = getAiClient();

    // Construct a rich context prompt
    const userPrompt = `
        You are a Concept Artist. Generate a detailed, high-quality image generation prompt for a ${type} named "${name}".

        **Base Description:** "${description}"

        **Visual Style:** "${style || 'Cinematic, Photorealistic'}"

        **Script Context:**
        ---
        ${scriptContext?.substring(0, 3000) || ''}... (truncated)
        ---

        **Instructions:**
        1. Analyze the script to understand the ${type}'s role, appearance details mentioned (clothing, features, lighting), and mood.
        2. Combine the "Base Description" with the script context.
        3. Apply the "Visual Style" strictly.
        4. ${type === 'product' ? 'Focus on high-end Product Photography: Sharp focus, studio lighting, clean background or contextual lifestyle setting as per script, reflections, and premium material rendering.' : ''}
        5. ${type === 'prop' ? 'Focus on clear, production-ready prop design: readable silhouette, material detail, and context of use in-scene.' : ''}
        6. Output a single, cohesive, detailed prompt suitable for a text-to-image model (like Midjourney or Imagen).
        7. Also extract 5 relevant tags.

        Return JSON { prompt: string, tags: string[] }.
    `;

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: userPrompt,
        config: { responseMimeType: "application/json" },
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch {
        // Fallback if JSON parsing fails
        return { prompt: `${style}. ${description}`, tags: [] };
    }
};

export const generateCharacterProfile = async (payload: {
    name: string;
    description: string;
    script: string;
}): Promise<{
    personalityNotes: string;
    voiceNotes: string;
    backstory: string;
    characterGoals: string;
    characterArc: string;
    designNotes: string;
}> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are a character designer for film. Create a concise, production-ready character profile.

Character Name: ${payload.name}
Description: ${payload.description}

Script (context): ${payload.script.substring(0, 3000)}

Return JSON only with: personalityNotes, voiceNotes, backstory, characterGoals, characterArc, designNotes.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    personalityNotes: { type: Type.STRING },
                    voiceNotes: { type: Type.STRING },
                    backstory: { type: Type.STRING },
                    characterGoals: { type: Type.STRING },
                    characterArc: { type: Type.STRING },
                    designNotes: { type: Type.STRING },
                },
                required: ["personalityNotes", "voiceNotes", "backstory", "characterGoals", "characterArc", "designNotes"]
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error("Failed to parse character profile:", e);
        throw new Error("Could not generate character profile.");
    }
};

export const generateCharacterOutfitPlan = async (payload: {
    name: string;
    description: string;
    basePrompt?: string;
    script: string;
}): Promise<Array<{ name: string; description: string; prompt: string }>> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are a costume designer. Based on the script, list the outfit variations needed for this character across scenes.

Character: ${payload.name}
Description: ${payload.description}
Base Visual Prompt: ${payload.basePrompt || 'n/a'}

Script (context): ${payload.script.substring(0, 4000)}

Return JSON with an array "outfits" (name, description, prompt). The prompt should describe the outfit on the same character, preserving identity.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    outfits: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                description: { type: Type.STRING },
                                prompt: { type: Type.STRING },
                            },
                            required: ["name", "description", "prompt"]
                        }
                    }
                },
                required: ["outfits"]
            }
        }
    }));

    try {
        const result = JSON.parse(response.text.trim());
        return Array.isArray(result.outfits) ? result.outfits : [];
    } catch (e) {
        console.error("Failed to parse outfit plan:", e);
        throw new Error("Could not generate outfit variations.");
    }
};


export const generateShotImagePrompts = async (
    script: string,
    productionGuidelines: string,
    stylePrompt?: string
): Promise<ShotPrompt[]> => {
    const ai = getAiClient();
    const resolvedStyle = stylePrompt?.trim();
    const styleBlock = resolvedStyle
        ? `**Visual Style:** ${resolvedStyle}
        - Apply this style consistently in every prompt.
        - Do not mention photorealism unless it appears in the visual style.`
        : `**Visual Style:** Cinematic, photorealistic`;
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are a world-class Director of Photography (DoP) and Storyboard Artist. Your task is to translate a film script into a series of highly technical, cinematic, and actionable visual prompts for an image generation AI.

        **Expert Cinematography Instructions:**
        1. **Lighting:** Define the lighting setup for every shot (e.g., "High-key", "Low-key noir", "Rembrandt lighting", "Soft diffused window light", "Practical neons"). Ensure the lighting reflects the emotional beat of the scene as per the script.
        2. **Composition:** Specify lens choices (e.g., "35mm wide", "85mm portrait", "Anamorphic"), camera angles ("Low angle hero shot", "Dutch tilt", "Over-the-shoulder"), and depth of field ("Shallow depth of field with bokeh").
        3. **Continuity:** Analyze the script sequentially. When generating the prompt for Shot 2, you MUST consider the visual state established in Shot 1 to maintain continuity.
        4. **Color:** Specify a color palette that supports the narrative (e.g., "Cold blues and cyans for isolation", "Warm golden hues for nostalgia").
        5. **Products/Branding:** If this is a commercial, explicitly identify any products or logos mentioned in the shot.
        6. **Style:** Follow the Visual Style below for every shot and include it explicitly in each prompt.

        ${styleBlock}

        For each distinct shot or action sequence in the script, generate a single, detailed prompt consistent with the visual style.

        Return the output as a single JSON object with a key "shots".

        **Production Guidelines:**
        ---
        ${productionGuidelines}
        ---

        **Script:**
        ---
        ${script}
        ---
        `,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    shots: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                shot: { type: Type.NUMBER, description: "The sequential shot number." },
                                description: { type: Type.STRING, description: "A brief description of the shot from the script." },
                                prompt: { type: Type.STRING, description: "The detailed, cinematic image generation prompt, explicitly including lighting, lens choice, and continuity details." },
                                characters: { type: Type.ARRAY, description: "A list of character names in the shot.", items: { type: Type.STRING } },
                                environment: { type: Type.STRING, description: "The name of the environment/location for this shot.", nullable: true },
                                products: { type: Type.ARRAY, description: "List of products or logos appearing in this shot.", items: { type: Type.STRING } }
                            },
                            required: ["shot", "description", "prompt", "characters", "environment"]
                        }
                    }
                },
                required: ['shots']
            },
        },
    }));

    try {
        const jsonStr = response.text.trim();
        const result = JSON.parse(jsonStr);
        if (!result.shots || !Array.isArray(result.shots)) {
            throw new Error(`AI response is not in the expected format ({ shots: [...] }). Response: ${jsonStr}`);
        }
        return result.shots;
    } catch (e) {
        console.error("Failed to parse shot prompts from AI response:", e);
        console.error("Raw AI response:", response.text);
        throw new Error("Could not understand the AI's storyboard analysis. Please try again.");
    }
};

export const generateExtraShotPrompt = async (payload: {
    script: string;
    productionGuidelines: string;
    stylePrompt?: string;
    idea: string;
    afterShot?: { shot: number; description: string; prompt?: string };
    beforeShot?: { shot: number; description: string; prompt?: string };
}): Promise<{
    shot: {
        description: string;
        prompt: string;
        characters: string[];
        environment: string | null;
        products?: string[];
    };
    references: Array<{
        type: 'character' | 'environment' | 'product' | 'prop';
        name: string;
        description: string;
    }>;
}> => {
    const ai = getAiClient();
    const resolvedStyle = payload.stylePrompt?.trim();
    const styleBlock = resolvedStyle
        ? `**Visual Style:** ${resolvedStyle}
        - Apply this style consistently in every prompt.
        - Do not mention photorealism unless it appears in the visual style.`
        : `**Visual Style:** Cinematic, photorealistic`;
    const placementNotes = [
        payload.afterShot
            ? `Insert after Shot ${payload.afterShot.shot}: ${payload.afterShot.description}`
            : undefined,
        payload.beforeShot
            ? `Next shot is Shot ${payload.beforeShot.shot}: ${payload.beforeShot.description}`
            : undefined,
    ].filter(Boolean);
    const placementBlock = placementNotes.length
        ? `**Placement Context:**\n${placementNotes.join('\n')}`
        : '';
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are a world-class Director of Photography (DoP) and Storyboard Artist. Generate one additional shot based on the idea below and the script context.

        **Expert Cinematography Instructions:**
        1. **Lighting:** Define the lighting setup (e.g., "High-key", "Low-key noir", "Rembrandt lighting", "Soft diffused window light", "Practical neons").
        2. **Composition:** Specify lens choice, camera angle, and depth of field.
        3. **Continuity:** Maintain continuity with adjacent shots.
        4. **Color:** Specify a supporting color palette.
        5. **Products/Branding:** If this is a commercial, identify products or logos.
        6. **Style:** Follow the Visual Style below and include it explicitly in the prompt.

        ${styleBlock}
        ${placementBlock}

        **Shot Idea / Type:**
        ${payload.idea}

        **Production Guidelines:**
        ---
        ${payload.productionGuidelines}
        ---

        **Script:**
        ---
        ${payload.script}
        ---

        Return JSON with:
        - "shot": { description, prompt, characters, environment, products }
        - "references": optional suggested visual references (character/environment/product/prop) with name and description.
        `,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    shot: {
                        type: Type.OBJECT,
                        properties: {
                            description: { type: Type.STRING },
                            prompt: { type: Type.STRING },
                            characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                            environment: { type: Type.STRING, nullable: true },
                            products: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ["description", "prompt", "characters", "environment"]
                    },
                    references: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                type: { type: Type.STRING },
                                name: { type: Type.STRING },
                                description: { type: Type.STRING }
                            },
                            required: ["type", "name", "description"]
                        }
                    }
                },
                required: ["shot"]
            }
        },
    }));

    try {
        const result = JSON.parse(response.text.trim());
        return {
            shot: result.shot,
            references: Array.isArray(result.references) ? result.references : []
        };
    } catch (e) {
        console.error("Failed to parse extra shot response:", e);
        console.error("Raw AI response:", response.text);
        throw new Error("Could not generate the extra shot. Please try again.");
    }
};

export const shouldUsePreviousShotContext = async (payload: {
    script: string;
    previousShot: { description: string; prompt?: string; environment?: string | null };
    currentShot: { description: string; prompt?: string; environment?: string | null };
}): Promise<{ usePreviousShot: boolean; reason: string }> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are a storyboard continuity assistant. Decide if the previous shot image should be used as a visual continuity reference for the current shot.

Use the previous shot as context when the action, environment, time of day, lighting, or character placement should stay consistent. Do NOT use it if the scene changes location/time or the shot is a hard reset.

Return JSON only.

Script (for context): ${payload.script.substring(0, 2500)}

Previous Shot:
Description: ${payload.previousShot.description}
Environment: ${payload.previousShot.environment || 'unspecified'}
Prompt: ${payload.previousShot.prompt || 'n/a'}

Current Shot:
Description: ${payload.currentShot.description}
Environment: ${payload.currentShot.environment || 'unspecified'}
Prompt: ${payload.currentShot.prompt || 'n/a'}
        `,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    usePreviousShot: { type: Type.BOOLEAN, description: "Whether to use the previous shot image as a context reference." },
                    reason: { type: Type.STRING, description: "Short reason for the decision." }
                },
                required: ["usePreviousShot", "reason"]
            }
        },
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error("Failed to parse previous shot context decision:", e);
        throw new Error("Could not determine whether to use previous shot context.");
    }
};

export const analyzeProjectDraft = async (
    script: string,
    guidelines: string,
    shotList: { shot: number; description: string; prompt: string; imageUrl?: string }[]
): Promise<ReviewFeedback> => {
    const ai = getAiClient();

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are a professional Film Editor and Director. Review the following "Draft" of a film production against the original Script and Production Guidelines.

        Analyze the shot list (which represents the visual storyboard or filmed footage) for:
        1. **Script Adherence:** Does the visual flow match the narrative?
        2. **Visual Continuity:** Are there potential jumps in logic, lighting, or character placement based on the descriptions/prompts?
        3. **Enhancement:** Which shots feel weak or generic? How can they be improved?

        Return a comprehensive review in JSON format.

        **Script:**
        ${script.substring(0, 5000)}... (truncated)

        **Guidelines:**
        ${guidelines.substring(0, 2000)}...

        **Shot List (Draft):**
        ${JSON.stringify(shotList.map(s => ({ shot: s.shot, desc: s.description, prompt: s.prompt })), null, 2)}
        `,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    overallScore: { type: Type.NUMBER, description: "Score from 1-10 based on quality and coherence." },
                    summary: { type: Type.STRING, description: "Executive summary of the draft status." },
                    strengths: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of what is working well." },
                    weaknesses: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of critical issues." },
                    continuityIssues: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific continuity errors found." },
                    shotSpecificFeedback: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                shot: { type: Type.NUMBER },
                                feedback: { type: Type.STRING, description: "Specific advice to enhance this shot." }
                            },
                            required: ["shot", "feedback"]
                        }
                    }
                },
                required: ["overallScore", "summary", "strengths", "weaknesses", "shotSpecificFeedback"]
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        console.error("Failed to parse review:", e);
        throw new Error("Could not parse AI review.");
    }
};

export const reviewCinematography = async (
    image: { base64: string, mimeType: string },
    scriptContext: string,
    shotDescription: string
): Promise<CinematographyCritique> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
            parts: [
                {
                    text: `You are a strict, world-renowned Director of Photography (DoP) like Roger Deakins. Critique this shot based on the script context.

                Script Context: "${scriptContext}"
                Shot Description: "${shotDescription}"

                Analyze:
                1. Lighting: Does it match the emotional tone? Is it too flat?
                2. Composition: Rule of thirds, leading lines, headroom.
                3. Storytelling: Does the visual reinforce the narrative beat?

                Provide a score (1-10) for each and constructive, technical feedback.` },
                { inlineData: { data: image.base64, mimeType: image.mimeType } }
            ]
        },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    lightingScore: { type: Type.NUMBER },
                    compositionScore: { type: Type.NUMBER },
                    storyRelevanceScore: { type: Type.NUMBER },
                    feedback: { type: Type.STRING, description: "Professional critique." },
                    technicalSuggestions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Specific technical fixes (e.g. 'Use a rim light')." }
                },
                required: ["lightingScore", "compositionScore", "storyRelevanceScore", "feedback", "technicalSuggestions"]
            }
        }
    }));
    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error("Could not parse cinematography review.");
    }
};

export const generateImageWithReferences = async (
    prompt: string,
    referenceImages: { base64: string; mimeType: string }[],
    sketchImage?: { base64: string; mimeType: string },
    model: 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' = 'gemini-2.5-flash-image',
    config?: { aspectRatio?: string, imageSize?: string }
): Promise<MediaItem> => {
    const ai = getAiClient();

    // Construct prompt parts
    const parts: any[] = [{ text: prompt }];

    // If we have a sketch, add it first with context
    if (sketchImage) {
        parts.push({ text: "Use the following image as a strict Composition Reference (Sketch). Follow the layout, framing, and positioning of elements exactly." });
        parts.push({ inlineData: { data: sketchImage.base64, mimeType: sketchImage.mimeType } });
    }

    // Add character/environment references
    if (referenceImages.length > 0) {
        parts.push({ text: "Use the following images as Style/Character/Environment/Product References:" });
        referenceImages.forEach(img => {
            parts.push({ inlineData: { data: img.base64, mimeType: img.mimeType } });
        });
    }

    const contents = { parts };

    let modelConfig: any = {};
    if (model === 'gemini-3-pro-image-preview') {
        modelConfig = {
            imageConfig: {
                aspectRatio: config?.aspectRatio || "16:9",
                imageSize: config?.imageSize || "1K"
            }
        };
    } else {
        modelConfig = {
            responseModalities: [Modality.IMAGE],
        };
    }

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: model,
        contents,
        config: modelConfig,
    }));

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                return {
                    id: `ref-shot-${Date.now()}`,
                    name: `shot_${prompt.slice(0, 15)}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated'
                };
            }
        }
    }

    // Fallback logic if the first attempt fails
    console.warn("Image generation with references failed. Retrying without references as a fallback.");
    try {
        const fallbackImage = await generateImageWithNano(prompt);
        // Prepend name to indicate it's a fallback
        fallbackImage.name = `(fallback)_${fallbackImage.name}`;
        return fallbackImage;
    } catch (fallbackError) {
        console.error("Fallback image generation also failed:", fallbackError);
        throw new Error("Image generation failed.");
    }
};

export const generateMotionPromptForShot = async (
    script: string,
    shotNumber: number,
    shotDescription: string,
    stylePrompt?: string
): Promise<string> => {
    const ai = getAiClient();
    const resolvedStyle = stylePrompt?.trim();
    const styleLine = resolvedStyle ? `**Visual Style:** ${resolvedStyle}` : '**Visual Style:** Cinematic, photorealistic';
    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `I have an image for a shot in a trailer. I need a detailed image-to-video prompt for a model like Veo. The prompt should describe the motion and action while preserving the visual style.

        ${styleLine}

        **Shot Description from Script:** "${shotDescription}" (This is Shot ${shotNumber})

        **Full Script Context:**
        ---
        ${script}
        ---

        Generate only the motion prompt.`,
    }));
    return response.text;
};

export const getAudioSuggestions = async (timelineClips: any[], mediaItems: MediaItem[]): Promise<string> => {
    const ai = getAiClient();
    const sceneDescriptions = timelineClips
        .filter(c => c.track === 'video')
        .map((clip: any, index: number) => {
            const media = mediaItems.find(m => m.id === clip.mediaId);
            return `Scene ${index + 1} (Duration: ${clip.duration.toFixed(1)}s): A shot of ${media?.name.replace(/_/g, ' ')}`;
        }).join('\n');

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `You are a post-production sound designer. Recommend music styles and SFX. Scene List: ${sceneDescriptions}`,
    }));
    return response.text;
};

export const generateSmartScore = async (timelineClips: TimelineClip[], mediaItems: MediaItem[]): Promise<AudioScoreRequest[]> => {
    const ai = getAiClient();
    // 1. Analyze the timeline to understand the narrative arc
    const timelineDescription = timelineClips
        .sort((a, b) => a.start - b.start)
        .map((clip, i) => {
            const media = mediaItems.find(m => m.id === clip.mediaId);
            return `Shot ${i + 1} (${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s): ${media?.name || 'Unknown'}`;
        }).join('\n');

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Analyze this video editing timeline and suggest a list of audio assets (Music or SFX) needed to create a cohesive soundscape.

        Timeline:
        ${timelineDescription}

        Return a JSON array of audio requests. For music, suggest a mood. For SFX, be specific.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        sceneDescription: { type: Type.STRING },
                        mood: { type: Type.STRING },
                        duration: { type: Type.NUMBER },
                        type: { type: Type.STRING, enum: ['music', 'sfx', 'ambience'] }
                    },
                    required: ['sceneDescription', 'mood', 'duration', 'type']
                }
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        return [];
    }
};

export const generateMusicPromptForTimeline = async (
    timelineClips: TimelineClip[],
    mediaItems: MediaItem[]
): Promise<{ prompt: string; duration: number; mood: string; bpm?: number; instruments?: string[]; mixNotes?: string }> => {
    const ai = getAiClient();
    const timelineDescription = timelineClips
        .sort((a, b) => a.start - b.start)
        .map((clip, i) => {
            const media = mediaItems.find(m => m.id === clip.mediaId);
            return `Shot ${i + 1} (${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s): ${media?.name || 'Unknown'}`;
        }).join('\n');
    const totalDuration = timelineClips.reduce((max, clip) => Math.max(max, clip.end), 0);

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are a music supervisor. Analyze the edit and produce a single concise prompt for a music generator.

Timeline:
${timelineDescription}

Total Duration: ${totalDuration.toFixed(1)}s

Return JSON with:
- prompt: a rich, single-paragraph music prompt
- duration: total duration in seconds
- mood: 2-4 words describing emotional tone
- bpm: optional BPM suggestion
- instruments: optional list of key instruments
- mixNotes: optional mixing notes (e.g., \"duck under dialogue\", \"big rise at 0:45\")`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    prompt: { type: Type.STRING },
                    duration: { type: Type.NUMBER },
                    mood: { type: Type.STRING },
                    bpm: { type: Type.NUMBER, nullable: true },
                    instruments: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                    mixNotes: { type: Type.STRING, nullable: true },
                },
                required: ["prompt", "duration", "mood"]
            }
        }
    }));

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error("Failed to parse music prompt.");
    }
};

export const generateSoundEffect = async (description: string, duration: number): Promise<MediaItem> => {
    // Note: Gemini 2.5 Flash Native Audio is primarily for speech, but we can try to use it for simple SFX or fallback to TTS with specific instructions.

    const prompt = `(Sound Effect Simulation): ${description}`;

    try {
        const item = await generateSpeechWithTTS(prompt);
        item.name = `SFX: ${description}`;
        item.duration = duration; // Override duration
        return item;
    } catch (e) {
        throw new Error("Could not generate SFX");
    }
};

export const generateSpeechWithTTS = async (prompt: string, multiSpeaker?: { speaker: string, voice: string }[]): Promise<MediaItem> => {
    const ai = getAiClient();
    const speechConfig: any = { responseModalities: [Modality.AUDIO] };
    if (multiSpeaker && multiSpeaker.length > 0) {
        speechConfig.speechConfig = {
            multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: multiSpeaker.map(s => ({
                    speaker: s.speaker,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } }
                }))
            }
        };
    } else {
        speechConfig.speechConfig = {
            voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
        };
    }

    const response: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: speechConfig,
    }));

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
        throw new Error("Speech generation failed to produce audio data.");
    }

    const pcmData = decode(base64Audio);
    // Helper `createWavBlob` assumed to be available locally or re-implemented
    const createWavBlob = (pcmData: Uint8Array, sampleRate: number, numChannels: number, bitsPerSample: number): Blob => {
        const dataSize = pcmData.length;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        const writeString = (offset: number, str: string) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };

        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);
        new Uint8Array(buffer, 44).set(pcmData);

        return new Blob([buffer], { type: 'audio/wav' });
    };

    const audioBlob = createWavBlob(pcmData, 24000, 1, 16);
    const audioUrl = URL.createObjectURL(audioBlob);

    let duration: number | undefined;
    try {
        duration = await getVideoDuration(audioUrl);
    } catch (e) {
        duration = 5;
    }

    return {
        id: `tts-${Date.now()}`,
        name: `tts_audio_${prompt.slice(0, 15)}.wav`,
        type: 'audio',
        url: audioUrl,
        source: 'generated',
        duration,
    };
};

export const suggestColorGrade = async (
    imageBase64: string,
    mimeType: string,
): Promise<{ analysis: string; suggestions: Array<{ name: string; filters: any }> }> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() =>
        ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    {
                        text: `Analyze color palette. Suggest 3 color grades with JSON {name, filters: {brightness, contrast, saturate, hueRotate}}`,
                    },
                    { inlineData: { data: imageBase64, mimeType } },
                ],
            },
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        analysis: { type: Type.STRING },
                        suggestions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    filters: {
                                        type: Type.OBJECT,
                                        properties: {
                                            brightness: { type: Type.NUMBER },
                                            contrast: { type: Type.NUMBER },
                                            saturate: { type: Type.NUMBER },
                                            hueRotate: { type: Type.NUMBER },
                                        },
                                        required: ['brightness', 'contrast', 'saturate', 'hueRotate'],
                                    },
                                },
                                required: ['name', 'filters'],
                            },
                        },
                    },
                    required: ['analysis', 'suggestions'],
                },
            },
        }),
    );

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error('Could not understand the AI response for color grading.');
    }
};

export const gradeImageFromPrompt = async (
    imageBase64: string,
    mimeType: string,
    prompt: string,
): Promise<{ filters: any }> => {
    const ai = getAiClient();
    const response: GenerateContentResponse = await withRetry(() =>
        ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    {
                        text: `Apply color grade based on: "${prompt}". Return JSON {filters: {brightness, contrast, saturate, hueRotate}}.`,
                    },
                    { inlineData: { data: imageBase64, mimeType } },
                ],
            },
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        filters: {
                            type: Type.OBJECT,
                            properties: {
                                brightness: { type: Type.NUMBER },
                                contrast: { type: Type.NUMBER },
                                saturate: { type: Type.NUMBER },
                                hueRotate: { type: Type.NUMBER },
                            },
                            required: ['brightness', 'contrast', 'saturate', 'hueRotate'],
                        },
                    },
                    required: ['filters'],
                },
            },
        }),
    );

    try {
        return JSON.parse(response.text.trim());
    } catch (e) {
        throw new Error('Could not understand the AI response for prompt-based grading.');
    }
};

export const generateMoviePoster = async (bible: StoryBible, references: ReferenceItem[], style: string): Promise<MediaItem> => {
    const ai = getAiClient();

    // 1. Construct context for prompt generation
    const charactersDescription = references
        .filter(r => r.type === 'character')
        .map(r => `${r.name}: ${r.description}`)
        .join('\n');

    const environmentsDescription = references
        .filter(r => r.type === 'environment')
        .map(r => `${r.name}: ${r.description}`)
        .join('\n');

    // 2. Ask Gemini to act as Art Director and write the Image Prompt
    const promptResponse: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `You are an expert Movie Poster Designer and Art Director.

        **Project Info:**
        Title: "${bible.title || 'Untitled Project'}"
        Logline: "${bible.logline}"
        Style: "${style}"

        **Key Visual Elements:**
        Characters:
        ${charactersDescription}

        Environments:
        ${environmentsDescription}

        **Task:**
        Write a highly detailed, single text-to-image prompt to generate a professional, cinematic movie poster (Aspect Ratio 2:3).

        **Requirements:**
        - Include the title text "${bible.title || 'Untitled'}" prominently in the visual description (e.g. "Bold typography at the bottom reading...").
        - Describe the composition (e.g. "floating heads," "hero silhouette," "ensemble cast," "minimalist symbolic").
        - Define lighting, color palette, and mood matching the logline.
        - Ensure character visual consistency based on the descriptions provided.

        Output ONLY the prompt text.`,
    }));

    const imagePrompt = promptResponse.text.trim();

    // 3. Generate Image with high quality model
    // Using Gemini 3 Pro Image for best text rendering capabilities
    const imageResponse: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: [{ text: imagePrompt }] },
        config: {
            imageConfig: {
                aspectRatio: "3:4", // Closest to 2:3 poster format available in standard ratios
                imageSize: "2K"
            },
        },
    }));

    const candidate = imageResponse.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const base64ImageBytes: string = part.inlineData.data;
                const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                return {
                    id: `poster-${Date.now()}`,
                    name: `Poster - ${bible.title}.png`,
                    type: 'image',
                    url: imageUrl,
                    source: 'generated'
                };
            }
        }
    }
    throw new Error("Failed to generate poster image.");
};
