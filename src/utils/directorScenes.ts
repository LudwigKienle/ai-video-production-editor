import type { DirectorShot, ShotPrompt } from '../types';

export type ScriptSceneBlock = {
    sceneNumber: number;
    slugline: string;
    text: string;
};

/** A scene (or one part of a long scene) as the Director sees it. */
export type DirectorSceneChunk = ScriptSceneBlock & {
    part: number;
    partCount: number;
};

// Sluglines: "INT. KITCHEN - DAY", "12 EXT. ROOF", "INT./EXT. CAR", "I/E", "EST. CITY". Word boundaries keep "Intro", "Extra", "Establishing" out.
const SLUGLINE_REGEX = /^\s*(?:\[SCENE\]\s*)?(?:SCENE\s*[:-]\s*)?(?:\d{1,4}[A-Z]?(?:[.)-])?\s+)?(?:INT\.?\s*\/\s*EXT\b|EXT\.?\s*\/\s*INT\b|I\/E\b|E\/I\b|INT\b|EXT\b|EST\b)/i;
// German sluglines: "INNEN. KÜCHE – TAG", "3 AUSSEN/INNEN", or mixed case only with a dot ("Innen. Küche"), so prose like "Innen ist es dunkel" stays text.
const GERMAN_SLUGLINE_UPPER_REGEX = /^\s*(?:\d{1,4}[A-Z]?(?:[.)-])?\s+)?(?:INNEN|AUSSEN|AUẞEN)(?:\s*\/\s*(?:INNEN|AUSSEN|AUẞEN))?\b/;
const GERMAN_SLUGLINE_DOT_REGEX = /^\s*(?:\d{1,4}[A-Z]?(?:[.)-])?\s+)?(?:innen|au(?:ss|ß)en)\./i;
// Headings that are not sluglines: "Scene 3", "Szene 3:", "## Scene 3 — Harbour", "Chapter 2", "Bild 4", "SC. 4".
const ALT_HEADING_REGEX = /^\s*(?:#{1,4}\s*)?\[?(?:scene|szene|chapter|kapitel|sequence|sequenz|bild|sc\.?)\s*\d{1,4}[A-Z]?\]?(?=$|[\s:.)\]—–-])/i;

export const isSceneHeading = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 90) return false;
    return SLUGLINE_REGEX.test(trimmed)
        || GERMAN_SLUGLINE_UPPER_REGEX.test(trimmed)
        || GERMAN_SLUGLINE_DOT_REGEX.test(trimmed)
        || ALT_HEADING_REGEX.test(trimmed);
};

/**
 * Scenes in script order, numbered from 1. Text before the first heading (title, logline)
 * is not a scene. Without any heading the whole script is scene 1.
 */
export const splitScriptIntoScenes = (scriptText: string): ScriptSceneBlock[] => {
    if (!scriptText || !scriptText.trim()) return [];
    const lines = scriptText.replace(/\r\n?/g, '\n').split('\n');
    const blocks: ScriptSceneBlock[] = [];
    let currentLines: string[] = [];
    let currentSlugline = '';

    const flush = () => {
        const text = currentLines.join('\n').trim();
        if (text) {
            const sceneNumber = blocks.length + 1;
            blocks.push({ sceneNumber, slugline: currentSlugline || `SCENE ${sceneNumber}`, text });
        }
        currentLines = [];
        currentSlugline = '';
    };

    lines.forEach((line) => {
        const trimmed = line.trim();
        if (isSceneHeading(trimmed)) {
            flush();
            currentSlugline = trimmed.replace(/\s+/g, ' ').toUpperCase();
            currentLines = [line];
            return;
        }
        if (currentLines.length > 0) currentLines.push(line);
    });
    flush();

    return blocks.length > 0 ? blocks : [{ sceneNumber: 1, slugline: 'SCENE 1', text: scriptText.trim() }];
};

/** Splits scenes longer than maxChars at paragraph breaks; parts keep the scene number and their order. */
export const splitScenesForDirector = (scenes: ScriptSceneBlock[], maxChars = 2600): DirectorSceneChunk[] => {
    const chunks: DirectorSceneChunk[] = [];
    scenes.forEach((scene) => {
        if (scene.text.length <= maxChars) {
            chunks.push({ ...scene, part: 1, partCount: 1 });
            return;
        }
        const pieces: string[] = [];
        let buffer = '';
        scene.text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean).forEach((paragraph) => {
            if (buffer && buffer.length + paragraph.length + 2 > maxChars) {
                pieces.push(buffer);
                buffer = '';
            }
            if (paragraph.length > maxChars) {
                for (let index = 0; index < paragraph.length; index += maxChars) {
                    pieces.push(paragraph.slice(index, index + maxChars));
                }
                return;
            }
            buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
        });
        if (buffer) pieces.push(buffer);
        pieces.forEach((text, index) => {
            chunks.push({ ...scene, text, part: index + 1, partCount: pieces.length });
        });
    });
    return chunks;
};

/** Roughly one shot per 350 characters of script, 3 to 14 per chunk. */
export const targetShotCount = (text: string) => Math.min(14, Math.max(3, Math.round(text.trim().length / 350)));

/** Packs chunks into model calls of at most maxChars and maxChunks, in script order. */
export const batchDirectorChunks = (chunks: DirectorSceneChunk[], maxChars = 8600, maxChunks = 5): DirectorSceneChunk[][] => {
    const batches: DirectorSceneChunk[][] = [];
    let current: DirectorSceneChunk[] = [];
    let currentChars = 0;
    chunks.forEach((chunk) => {
        if (current.length > 0 && (currentChars + chunk.text.length > maxChars || current.length >= maxChunks)) {
            batches.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(chunk);
        currentChars += chunk.text.length;
    });
    if (current.length > 0) batches.push(current);
    return batches;
};

/**
 * Orders shots by scene (script order) while keeping the order the Director wrote them in
 * inside a scene, so the parts of a long scene do not interleave. Renumbers globally and per scene.
 */
export const orderDirectorShots = (shots: DirectorShot[], sceneOrder: number[]): DirectorShot[] => {
    const rank = new Map(sceneOrder.map((sceneNumber, index) => [sceneNumber, index]));
    const sceneOf = (shot: DirectorShot) => (Number.isFinite(shot.sceneNumber) ? Number(shot.sceneNumber) : sceneOrder[0] ?? 1);
    const ordered = shots
        .map((shot, index) => ({ shot, index, scene: sceneOf(shot) }))
        .sort((a, b) => ((rank.get(a.scene) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.scene) ?? Number.MAX_SAFE_INTEGER)) || a.scene - b.scene || a.index - b.index);
    const perScene = new Map<number, number>();
    return ordered.map(({ shot, scene }, index) => {
        const sceneShotNumber = (perScene.get(scene) || 0) + 1;
        perScene.set(scene, sceneShotNumber);
        return { ...shot, shotNumber: index + 1, sceneNumber: scene, sceneShotNumber, shotLabel: `${scene}.${sceneShotNumber}` };
    });
};

/**
 * A new shot list for some scenes replaces only those scenes; everything else keeps its
 * numbers, frames and videos. replaceUnnumbered also drops shots without a scene number
 * (used when the treatment covers the whole script).
 */
export const mergeShotsIntoScenes = (
    existing: ShotPrompt[],
    incoming: ShotPrompt[],
    sceneNumbers: number[],
    options: { replaceUnnumbered?: boolean } = {},
): ShotPrompt[] => {
    if (existing.length === 0 || sceneNumbers.length === 0) return incoming;
    const replaced = new Set(sceneNumbers);
    const isReplaced = (shot: ShotPrompt) => (Number.isFinite(shot.sceneNumber)
        ? replaced.has(Number(shot.sceneNumber))
        : Boolean(options.replaceUnnumbered));
    const kept = existing.filter((shot) => !isReplaced(shot));
    let nextNumber = kept.reduce((max, shot) => Math.max(max, shot.shot), 0);
    const renumbered = incoming.map((shot) => ({ ...shot, shot: ++nextNumber }));
    const sceneKey = (shot: ShotPrompt) => (Number.isFinite(shot.sceneNumber) ? Number(shot.sceneNumber) : Number.POSITIVE_INFINITY);
    const orderKey = (shot: ShotPrompt) => (Number.isFinite(shot.sceneShotNumber) ? Number(shot.sceneShotNumber) : shot.shot);
    return [...kept, ...renumbered].sort((a, b) => sceneKey(a) - sceneKey(b) || orderKey(a) - orderKey(b) || a.shot - b.shot);
};

/** The existing shots an apply would replace. */
export const shotsReplacedByMerge = (
    existing: ShotPrompt[],
    sceneNumbers: number[],
    options: { replaceUnnumbered?: boolean } = {},
) => {
    const replaced = new Set(sceneNumbers);
    return existing.filter((shot) => (Number.isFinite(shot.sceneNumber)
        ? replaced.has(Number(shot.sceneNumber))
        : Boolean(options.replaceUnnumbered)));
};
