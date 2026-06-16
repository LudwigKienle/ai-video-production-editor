import { generateTextWithGemini3Pro } from './geminiService';
import { generateTextWithGemini3ProReplicate, generateTextWithGpt5NanoReplicate } from './replicateService';
import { SetDesignAsset, SetDesignLight, SetDesignState } from '../types';

export type SetDesignMutation =
    | { type: 'create_asset'; asset: Partial<SetDesignAsset> & { primitive?: 'box' | 'sphere' | 'plane'; name: string } }
    | { type: 'remove_asset'; nameOrId: string }
    | { type: 'update_transform'; nameOrId: string; position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number }; scale?: { x: number; y: number; z: number }; relative?: boolean }
    | { type: 'create_light'; light: Partial<SetDesignLight> & { type: 'ambient' | 'directional' | 'point' } }
    | { type: 'update_light'; nameOrId: string; updates: Partial<SetDesignLight> }
    | { type: 'remove_light'; nameOrId: string }
    | { type: 'camera_look_at'; target: { x: number; y: number; z: number } }
    | { type: 'camera_position'; position: { x: number; y: number; z: number } }
    | { type: 'generate_asset'; prompt: string; name: string }
    | {
        type: 'update_material';
        nameOrId: string;
        material: { color?: string; metalness?: number; roughness?: number; opacity?: number; transparent?: boolean };
    }
    | { type: 'search_sketchfab'; query: string; name_hint?: string; position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number }; scale?: { x: number; y: number; z: number } };

type SceneSummary = {
    assets: { id: string; name: string; position: any; rotation?: any; scale?: any; material?: any }[];
    lights: { id: string; type: string; intensity?: number; color?: string; position?: any }[];
    camera?: any;
};

type DirectorHistory = Array<{ role: 'user' | 'assistant'; text: string }>;

const hasReplicateKey = () => {
    if (typeof window === 'undefined') return false;
    try {
        return !!localStorage.getItem('replicate_api_key');
    } catch {
        return false;
    }
};

const extractJsonObject = (text: string) => {
    const stripped = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return stripped.slice(firstBrace, lastBrace + 1);
    }
    return stripped;
};

const parseDirectorResponse = (text: string) => {
    const cleaned = extractJsonObject(text);
    return JSON.parse(cleaned) as { reply?: string; mutations?: SetDesignMutation[] };
};

const callDirectorModel = async (prompt: string) => {
    try {
        return await generateTextWithGemini3Pro(prompt);
    } catch (error) {
        if (!hasReplicateKey()) {
            throw error;
        }
        let lastError: unknown = error;
        try {
            return await generateTextWithGemini3ProReplicate(prompt, {
                systemPrompt: 'Return only valid JSON. No markdown.',
            });
        } catch (replicateError) {
            lastError = replicateError;
            try {
                return await generateTextWithGpt5NanoReplicate(prompt, {
                    systemPrompt: 'Return only valid JSON. No markdown.',
                });
            } catch (gptError) {
                lastError = gptError;
            }
        }
        throw lastError;
    }
};

export const generateSetMutations = async (
    prompt: string,
    currentScene: SceneSummary,
    history: DirectorHistory = []
): Promise<{ reply: string; mutations: SetDesignMutation[] }> => {
    const historyBlock = history.length > 0
        ? `Conversation History:\n${history.map(entry => `${entry.role.toUpperCase()}: ${entry.text}`).join('\n')}`
        : 'Conversation History: (none)';
    const systemPrompt = `
    You are an AI Director controlling a 3D Set Design scene (Three.js).
    Your goal is to translate the User's natural language command into mutations and respond briefly.

    Current Scene State:
    ${JSON.stringify(currentScene, null, 2)}

    ${historyBlock}

    Available Mutation Types:
    1. create_asset: { type: 'create_asset', asset: { name: string, primitive?: 'box'|'sphere'|'plane', position?: {x,y,z}, ... } }
       - If user asks for a shape (cube, sphere), use 'primitive'.
       - If user asks for a complex object (chair, dragon), DO NOT use 'primitive'. Instead, use 'generate_asset'.
    2. generate_asset: { type: 'generate_asset', name: string, prompt: string }
       - Use this when the user wants a specific 3D model generated (e.g. "a vintage chair"). The prompt is the description for the 3D generator (Rodin).
    3. remove_asset: { type: 'remove_asset', nameOrId: string }
       - Try to match name from Current Scene.
    4. update_transform: { type: 'update_transform', nameOrId: string, position?, rotation?, scale?, relative?: boolean }
       - If user says "move up by 2", use relative: true, position: {x:0, y:2, z:0}.
       - If user says "move to 0,0,0", use relative: false.
    5. update_material: { type: 'update_material', nameOrId: string, material: { color?: string, metalness?: number, roughness?: number, opacity?: number, transparent?: boolean } }
       - Interprels visual properties.
       - "Make it red" -> color: "#ff0000"
       - "Make it gold/metallic" -> color: "#ffd700", metalness: 1.0, roughness: 0.2
       - "Make it glass/transparent" -> opacity: 0.3, roughness: 0.0, transparent: true
    6. create_light: { type: 'create_light', light: { type: 'point'|'directional'|'ambient', color: string, intensity: number, position?: {x,y,z} } }
    7. update_light: { type: 'update_light', nameOrId: string, updates: { ... } }
    8. remove_light: { type: 'remove_light', nameOrId: string }
    9. camera_look_at: { type: 'camera_look_at', target: {x,y,z} }
    10. camera_position: { type: 'camera_position', position: {x,y,z} }
    11. search_sketchfab: { type: 'search_sketchfab', query: string, name_hint?: string, position?:{x,y,z}, rotation?:{x,y,z}, scale?:{x,y,z} }
       - Use this when the user asks for a specific existing model (e.g. "find a red car on sketchfab", "add a gladiator model").
       - query: the search term for Sketchfab.
       - name_hint: optional name for the asset.
       - position/rotation/scale: optional transform if specified (e.g. "place at center", "rotate 90 degrees").

    Rules:
    - Return ONLY valid JSON object: {"reply":"...","mutations":[...]}.
    - If unclear, ask a clarification question and return an empty mutations array.
    - Interpret "left/right" as X axis, "up/down" as Y axis, "forward/back" as Z axis.
    - Default color for lights is white (#ffffff) unless specified.
    - Default intensity for lights is 1.0.

    User Command: "${prompt}"
  `;

    try {
        const response = await callDirectorModel(systemPrompt);
        const parsed = parseDirectorResponse(response);
        return {
            reply: parsed.reply || 'Done.',
            mutations: parsed.mutations || [],
        };
    } catch (error) {
        console.error('Failed to parse AI Director mutations', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return { reply: `AI Director failed to respond. ${message}`, mutations: [] };
    }
};
