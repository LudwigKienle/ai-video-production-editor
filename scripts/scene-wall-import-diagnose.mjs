import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const pickApiKey = (...candidates) =>
  candidates.find((value) => value && !String(value).includes('PLACEHOLDER_API_KEY'));

const API_KEY = pickApiKey(
  process.env.API_KEY,
  process.env.GEMINI_API_KEY,
  process.env.VITE_GEMINI_API_KEY,
);
const MODEL = process.env.SCENE_WALL_MODEL || 'gemini-3.1-pro-preview';

if (!API_KEY || API_KEY.includes('PLACEHOLDER_API_KEY')) {
  throw new Error('Missing valid API key. Set API_KEY, GEMINI_API_KEY, or VITE_GEMINI_API_KEY.');
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const SLUGLINE_REGEX = /^\s*(INT\.?|EXT\.?|INT\/EXT\.?|EXT\/INT\.?|I\/E\.?|E\/I\.?)[\w\s\-,'".()/:;!?]{3,}$/i;
const SLUGLINE_TAG_PREFIX_REGEX = /^\s*(?:\[SCENE\]\s*|SCENE\s*[:\-]\s*)/i;
const SCENE_HEADING_REGEX = /^\s*(?:\d{1,4}[A-Z]?(?:[.)-])?\s+)?(INT\.?|EXT\.?|INT\/EXT\.?|EXT\/INT\.?|I\/E\.?|E\/I\.?)\b/i;

const normalizeSlug = (value) =>
  (value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const normalizeSluglineCandidate = (line) =>
  (line || '')
    .replace(SLUGLINE_TAG_PREFIX_REGEX, '')
    .replace(/^\s*\d{1,4}[A-Z]?(?:[.)-])?\s+/, '')
    .replace(/\s+\d{1,4}[A-Z]?\s*$/, '')
    .replace(/^\s*I\s*N\s*T\s*\/\s*E\s*X\s*T\s*\./i, 'INT/EXT.')
    .replace(/^\s*E\s*X\s*T\s*\/\s*I\s*N\s*T\s*\./i, 'EXT/INT.')
    .replace(/^\s*I\s*\/\s*E\s*\./i, 'I/E.')
    .replace(/^\s*E\s*\/\s*I\s*\./i, 'E/I.')
    .replace(/^\s*I\s*N\s*T\s*\./i, 'INT.')
    .replace(/^\s*E\s*X\s*T\s*\./i, 'EXT.')
    .replace(/^\s*INT\s*\/\s*EXT\.?/i, 'INT/EXT.')
    .replace(/^\s*EXT\s*\/\s*INT\.?/i, 'EXT/INT.')
    .replace(/\s+/g, ' ')
    .trim();

const parseSluglinesFromScript = (scriptText) => {
  if (!scriptText || !scriptText.trim()) return [];
  return scriptText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => normalizeSluglineCandidate(line))
    .filter((line) => SLUGLINE_REGEX.test(line))
    .map((line) => normalizeSlug(line));
};

const splitScriptForBreakdown = (text, maxChunkChars = 9000) => {
  if (text.length <= maxChunkChars) return [text];
  const sceneHeader = /^\s*(?:\[SCENE\]\s*)?(?:\d{1,4}[A-Z]?(?:[.)-])?\s+)?(INT\.?|EXT\.?|INT\/EXT\.?|EST\.?|I\/E\.?)/i;
  const lines = text.split(/\r?\n/);
  const scenes = [];
  let current = [];
  let hasSceneHeaders = false;

  lines.forEach((line) => {
    if (sceneHeader.test(line.trim())) {
      hasSceneHeaders = true;
      if (current.length) scenes.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  });
  if (current.length) scenes.push(current.join('\n'));

  const chunks = [];
  const source = hasSceneHeaders ? scenes : text.split(/\n{2,}/);
  let buffer = '';

  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = '';
  };

  source.forEach((block) => {
    if (!block.trim()) return;
    if (!buffer) {
      buffer = block;
      return;
    }
    if (buffer.length + block.length + 2 <= maxChunkChars) {
      buffer = `${buffer}\n\n${block}`;
      return;
    }
    flush();
    if (block.length > maxChunkChars) {
      for (let i = 0; i < block.length; i += maxChunkChars) {
        chunks.push(block.slice(i, i + maxChunkChars));
      }
      buffer = '';
    } else {
      buffer = block;
    }
  });

  flush();
  return chunks.length ? chunks : [text.slice(0, maxChunkChars)];
};

const parseJsonFromText = (text) => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const first = Math.min(
      ...[trimmed.indexOf('{'), trimmed.indexOf('[')].filter((idx) => idx >= 0),
    );
    const last = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw _error;
  }
};

const withRetry = async (fn, maxRetries = 4) => {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt >= maxRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
};

const analyzeScriptForSceneWallChunk = async (scriptChunk) => {
  const excerpt = scriptChunk.substring(0, 14000);
  const content = `You are a senior editorial assistant creating a scene wall for a feature film.

Task:
- Extract EVERY scene in script order from this chunk.
- Prioritize real sluglines/headings (INT./EXT./INT/EXT./I/E).
- If a scene lacks a clean slugline, infer a concise fallback heading.
- Keep output deterministic and compact.

Rules:
1) Do not skip scenes.
2) Keep slugline uppercase.
3) Keep summary short (1 sentence max).
4) Extract character names and environment names only when explicitly present.
5) shotHints should only include explicit shot/blocking hints if present (max 6 per scene).

Return JSON only:
{
  "scenes": [
    {
      "slugline": "INT. HOUSE - NIGHT",
      "summary": "...",
      "characters": ["NAME"],
      "environments": ["HOUSE"],
      "shotHints": ["LOW ANGLE CLOSEUP"]
    }
  ]
}

SCRIPT CHUNK:
---
${excerpt}
---`;

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: MODEL,
      contents: content,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  slugline: { type: Type.STRING },
                  summary: { type: Type.STRING, nullable: true },
                  characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                  environments: { type: Type.ARRAY, items: { type: Type.STRING } },
                  shotHints: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['slugline'],
              },
            },
          },
          required: ['scenes'],
        },
      },
    }),
  );

  const parsed = parseJsonFromText(response.text || '{}');
  const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  return {
    scenes: scenes.map((scene) => ({
      slugline: normalizeSlug(scene.slugline || ''),
      summary: (scene.summary || '').trim(),
      characters: Array.from(
        new Set((scene.characters || []).map((name) => (name || '').trim()).filter(Boolean)),
      ).slice(0, 12),
      environments: Array.from(
        new Set((scene.environments || []).map((name) => (name || '').trim()).filter(Boolean)),
      ).slice(0, 8),
      shotHints: Array.from(
        new Set((scene.shotHints || []).map((hint) => (hint || '').trim()).filter(Boolean)),
      ).slice(0, 10),
    })),
  };
};

const mergeSceneWallEntries = (current, incoming) => {
  const next = [...current];
  incoming.forEach((entry) => {
    const slugline = normalizeSlug(entry.slugline || '');
    if (!slugline) return;
    const cleaned = {
      slugline,
      summary: (entry.summary || '').trim(),
      characters: Array.from(
        new Set((entry.characters || []).map((name) => (name || '').trim()).filter(Boolean)),
      ).slice(0, 12),
      environments: Array.from(
        new Set((entry.environments || []).map((name) => (name || '').trim()).filter(Boolean)),
      ).slice(0, 8),
      shotHints: Array.from(
        new Set((entry.shotHints || []).map((hint) => (hint || '').trim()).filter(Boolean)),
      ).slice(0, 10),
    };
    const previous = next[next.length - 1];
    if (previous && normalizeSlug(previous.slugline) === slugline) {
      next[next.length - 1] = {
        slugline: previous.slugline,
        summary: previous.summary || cleaned.summary,
        characters: Array.from(new Set([...(previous.characters || []), ...(cleaned.characters || [])])),
        environments: Array.from(new Set([...(previous.environments || []), ...(cleaned.environments || [])])),
        shotHints: Array.from(new Set([...(previous.shotHints || []), ...(cleaned.shotHints || [])])),
      };
      return;
    }
    next.push(cleaned);
  });
  return next;
};

const analyzeSceneWallChunkWithFallback = async (chunkText) => {
  try {
    const result = await analyzeScriptForSceneWallChunk(chunkText);
    return Array.isArray(result?.scenes) ? result.scenes : [];
  } catch (error) {
    if (chunkText.length < 1800) throw error;
    const fallbackChunks = splitScriptForBreakdown(
      chunkText,
      Math.max(2000, Math.floor(chunkText.length / 2)),
    );
    if (fallbackChunks.length <= 1) throw error;
    let merged = [];
    for (let i = 0; i < fallbackChunks.length; i += 1) {
      const partial = await analyzeScriptForSceneWallChunk(fallbackChunks[i]);
      merged = mergeSceneWallEntries(merged, partial.scenes || []);
    }
    return merged;
  }
};

const toCountMap = (arr) => {
  const map = new Map();
  arr.forEach((item) => map.set(item, (map.get(item) || 0) + 1));
  return map;
};

const countMissing = (expected, actual) => {
  const expectedCounts = toCountMap(expected);
  const actualCounts = toCountMap(actual);
  const missing = [];
  expectedCounts.forEach((count, key) => {
    const delta = count - (actualCounts.get(key) || 0);
    for (let i = 0; i < delta; i += 1) missing.push(key);
  });
  return missing;
};

const parsePdfScriptNode = async (filePath, options = {}) => {
  const buffer = await fs.readFile(filePath);
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data, disableWorker: true }).promise;
  const pageLimit = options.maxPages ?? pdf.numPages;
  const pageCount = Math.min(pdf.numPages, pageLimit);

  const allLineData = [];
  for (let i = 1; i <= pageCount; i += 1) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    if (!textContent.items?.length) continue;

    const lines = new Map();
    textContent.items.forEach((item) => {
      if (!item?.str || !Array.isArray(item.transform)) return;
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push(item);
    });
    const sortedY = Array.from(lines.keys()).sort((a, b) => b - a);
    for (const y of sortedY) {
      const items = lines.get(y).sort((a, b) => a.transform[4] - b.transform[4]);
      const text = items.map((item) => item.str).join('').replace(/\s+/g, ' ').trim();
      if (text) {
        allLineData.push({ text, x: items[0].transform[4] });
      }
    }
  }

  if (allLineData.length === 0) return '';

  const xCoordinates = allLineData.map((line) => Math.round(line.x));
  const xCounts = xCoordinates.reduce((acc, x) => {
    acc[x] = (acc[x] || 0) + 1;
    return acc;
  }, {});
  const sortedX = Object.entries(xCounts)
    .sort((a, b) => b[1] - a[1])
    .map((entry) => Number(entry[0]));

  const actionMargin = sortedX[0] || 50;
  const dialogueMargin = sortedX.find((x) => x > actionMargin + 20) || actionMargin * 2.5;
  const characterMargin = sortedX.find((x) => x > dialogueMargin + 20) || actionMargin * 3.5;

  const formattedLines = [];
  let lastLineType = null;
  let successfulClassifications = 0;
  const ignoredSectionsRegex = /^(REFERENCES \/\/|OUTFITS \/\/|CAST LIST)/i;
  let inIgnoredSection = false;

  const isAtMargin = (x, targetMargin) => Math.abs(x - targetMargin) < 25;

  for (const line of allLineData) {
    const { text, x } = line;
    if (ignoredSectionsRegex.test(text)) {
      inIgnoredSection = true;
      continue;
    }
    if (inIgnoredSection) continue;

    const isAllUpperCase = text === text.toUpperCase() && /[A-Z]/.test(text);
    const headingCandidate = text.replace(/\s+/g, ' ').trim();
    const isSceneHeading = SCENE_HEADING_REGEX.test(headingCandidate);

    if (isSceneHeading && (isAtMargin(x, actionMargin) || x <= actionMargin + 45)) {
      const normalizedSceneHeading = headingCandidate
        .replace(/^\s*\d{1,4}[A-Z]?(?:[.)-])?\s+/, '')
        .replace(/\s+\d{1,4}[A-Z]?\s*$/, '')
        .replace(/^\s*INT\s*\/\s*EXT\.?/i, 'INT/EXT.')
        .replace(/^\s*EXT\s*\/\s*INT\.?/i, 'EXT/INT.')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
      formattedLines.push(`\n[SCENE] ${normalizedSceneHeading}`);
      lastLineType = null;
      successfulClassifications += 1;
    } else if (isAllUpperCase && isAtMargin(x, characterMargin) && !text.endsWith(':') && text.length < 35) {
      formattedLines.push(`\n[CHARACTER] ${text}`);
      lastLineType = 'CHARACTER';
      successfulClassifications += 1;
    } else if (lastLineType === 'CHARACTER' && isAtMargin(x, dialogueMargin)) {
      formattedLines.push(`[DIALOGUE] ${text}`);
      successfulClassifications += 1;
    } else if (isAtMargin(x, actionMargin)) {
      formattedLines.push(`[ACTION] ${text}`);
      lastLineType = null;
    } else {
      formattedLines.push(text);
      lastLineType = null;
    }
  }

  if (successfulClassifications < 5) {
    return allLineData
      .map((line) => line.text)
      .filter((text) => !ignoredSectionsRegex.test(text))
      .join('\n');
  }

  return formattedLines.join('\n');
};

const analyzePdf = async (pdfPath) => {
  const scriptText = await parsePdfScriptNode(pdfPath);
  const parserSluglines = parseSluglinesFromScript(scriptText);
  const chunks = splitScriptForBreakdown(scriptText, 9000);

  let sceneEntries = [];
  for (let i = 0; i < chunks.length; i += 1) {
    process.stdout.write(`  chunk ${i + 1}/${chunks.length}\r`);
    let sceneChunk = [];
    try {
      sceneChunk = await analyzeSceneWallChunkWithFallback(chunks[i]);
    } catch (_error) {
      sceneChunk = parseSluglinesFromScript(chunks[i]).map((slugline) => ({ slugline }));
    }
    sceneEntries = mergeSceneWallEntries(sceneEntries, sceneChunk);
  }
  process.stdout.write('\n');

  const llmSluglines = sceneEntries.map((entry) => normalizeSlug(entry.slugline));
  const missingByParser = countMissing(parserSluglines, llmSluglines);
  const missingByLlm = countMissing(llmSluglines, parserSluglines);
  const characterSet = new Set(
    sceneEntries.flatMap((entry) => entry.characters || []).map((name) => name.trim()).filter(Boolean),
  );
  const environmentSet = new Set(
    sceneEntries.flatMap((entry) => entry.environments || []).map((name) => name.trim()).filter(Boolean),
  );

  return {
    file: pdfPath,
    pages: null,
    textLength: scriptText.length,
    chunks: chunks.length,
    parserSluglines: parserSluglines.length,
    llmScenes: sceneEntries.length,
    missingFromLlmCount: missingByParser.length,
    extraFromLlmCount: missingByLlm.length,
    sampleMissingFromLlm: missingByParser.slice(0, 20),
    sampleExtraFromLlm: missingByLlm.slice(0, 20),
    uniqueCharacters: characterSet.size,
    uniqueEnvironments: environmentSet.size,
    sampleCharacters: Array.from(characterSet).slice(0, 20),
    sampleEnvironments: Array.from(environmentSet).slice(0, 20),
  };
};

const main = async () => {
  const pdfPaths = process.argv.slice(2);
  if (pdfPaths.length === 0) {
    throw new Error('Usage: node scripts/scene-wall-import-diagnose.mjs <pdf-path> [pdf-path-2 ...]');
  }

  const reports = [];
  for (const inputPath of pdfPaths) {
    const fullPath = path.resolve(inputPath);
    console.log(`\nAnalyzing: ${fullPath}`);
    const report = await analyzePdf(fullPath);
    reports.push(report);
    console.log(JSON.stringify(report, null, 2));
  }

  console.log('\nCombined summary:');
  console.log(
    JSON.stringify(
      reports.map((report) => ({
        file: path.basename(report.file),
        chunks: report.chunks,
        parserSluglines: report.parserSluglines,
        llmScenes: report.llmScenes,
        missingFromLlmCount: report.missingFromLlmCount,
        uniqueCharacters: report.uniqueCharacters,
        uniqueEnvironments: report.uniqueEnvironments,
      })),
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error('\nScene wall diagnose failed:', error);
  process.exit(1);
});
