import type { CreativeDNAProfile, MediaItem } from '../types';
import { analyzeImage, editImage, relightImageWithGemini3Pro } from './geminiService';
import {
  editImageWithFlux,
  editImageWithQwen,
  relightImageWithReplicate,
} from './replicateService';
import { getBase64FromUrl } from '../utils/helpers';
import { buildCreativeDNAGuidance } from './creativeDnaService';

export type LookAgentToolId =
  | 'edit'
  | 'inpaint'
  | 'style_transfer'
  | 'relight'
  | 'analyze';

export type LookAgentProvider = 'gemini' | 'replicate';

export type LookAgentReferenceImage = {
  base64: string;
  mimeType: string;
  label?: string;
};

export type LookAgentRunParams = {
  tool: LookAgentToolId;
  prompt: string;
  source: { base64: string; mimeType: string };
  sourceMedia?: MediaItem | null;
  referenceImage?: LookAgentReferenceImage | null;
  provider?: LookAgentProvider;
  creativeDNA?: CreativeDNAProfile | null;
  aspectRatio?: string;
  imageSize?: string;
};

export type LookAgentRunResult = {
  ok: boolean;
  tool: LookAgentToolId;
  provider: LookAgentProvider;
  media?: MediaItem;
  analysis?: string;
  effectivePrompt: string;
};

const buildPrompt = (
  tool: LookAgentToolId,
  prompt: string,
  creativeDNA?: CreativeDNAProfile | null,
) => {
  const prefix =
    tool === 'relight'
      ? 'Relight the image while preserving identity, framing, and geometry.'
      : tool === 'analyze'
        ? 'Analyze this frame for cinematic quality, continuity, lighting, composition, and editorial usefulness.'
        : tool === 'style_transfer'
          ? 'Edit the image using the provided reference for style, texture, color language, and visual attitude.'
          : tool === 'inpaint'
            ? 'Edit the image with an inpainting mindset. Preserve untouched areas and only modify the requested region or object.'
            : 'Edit the image while preserving the strongest composition and subject identity cues.';

  const dna = creativeDNA ? buildCreativeDNAGuidance(creativeDNA) : '';
  return [prefix, prompt.trim(), dna].filter(Boolean).join(' ');
};

export const resolveLookAgentSource = async (
  mediaOrUrl: MediaItem | string,
): Promise<{ base64: string; mimeType: string }> => {
  const url = typeof mediaOrUrl === 'string' ? mediaOrUrl : mediaOrUrl.url;
  const { base64, mimeType } = await getBase64FromUrl(url);
  return {
    base64,
    mimeType: mimeType || 'image/png',
  };
};

export const analyzeImageAsset = async (params: {
  mediaOrUrl: MediaItem | string;
  prompt: string;
  creativeDNA?: CreativeDNAProfile | null;
}) => {
  const source = await resolveLookAgentSource(params.mediaOrUrl);
  const effectivePrompt = buildPrompt(
    'analyze',
    params.prompt,
    params.creativeDNA,
  );
  const analysis = await analyzeImage(effectivePrompt, source);
  return {
    analysis,
    effectivePrompt,
  };
};

export const runLookAgentTool = async (
  params: LookAgentRunParams,
): Promise<LookAgentRunResult> => {
  const provider = params.provider || 'gemini';
  const effectivePrompt = buildPrompt(
    params.tool,
    params.prompt,
    params.creativeDNA,
  );

  if (params.tool === 'analyze') {
    const analysis = await analyzeImage(effectivePrompt, params.source);
    const sourceMedia = params.sourceMedia;
    return {
      ok: true,
      tool: params.tool,
      provider,
      effectivePrompt,
      analysis,
      media: sourceMedia
        ? {
            ...sourceMedia,
            analysisNotes: [...(sourceMedia.analysisNotes || []), analysis],
          }
        : undefined,
    };
  }

  if (params.tool === 'relight') {
    const media =
      provider === 'replicate'
        ? await relightImageWithReplicate(effectivePrompt, params.source, {
            aspectRatio: params.aspectRatio || 'match_input_image',
          })
        : await relightImageWithGemini3Pro(
            effectivePrompt,
            params.source,
            params.aspectRatio || '16:9',
            params.imageSize || '2K',
          );

    return {
      ok: true,
      tool: params.tool,
      provider,
      effectivePrompt,
      media: {
        ...media,
        generatedBy:
          provider === 'replicate' ? 'Look Agent Relight (Replicate)' : 'Look Agent Relight (Gemini)',
      },
    };
  }

  if (provider === 'replicate') {
    const media =
      params.tool === 'inpaint'
        ? await editImageWithFlux(effectivePrompt, params.source)
        : await editImageWithQwen(effectivePrompt, params.source, {
            aspectRatio: params.aspectRatio || 'match_input_image',
            extraImages: params.referenceImage ? [params.referenceImage] : undefined,
          });

    return {
      ok: true,
      tool: params.tool,
      provider,
      effectivePrompt,
      media: {
        ...media,
        generatedBy:
          params.tool === 'style_transfer'
            ? 'Look Agent Style Transfer (Qwen)'
            : params.tool === 'inpaint'
              ? 'Look Agent Inpaint (Flux)'
              : 'Look Agent Edit (Replicate)',
      },
    };
  }

  const media = await editImage(
    effectivePrompt,
    params.source,
    params.referenceImage || undefined,
  );

  return {
    ok: true,
    tool: params.tool,
    provider,
    effectivePrompt,
    media: {
      ...media,
      generatedBy:
        params.tool === 'style_transfer'
          ? 'Look Agent Style Transfer (Gemini)'
          : params.tool === 'inpaint'
            ? 'Look Agent Inpaint (Gemini)'
            : 'Look Agent Edit (Gemini)',
    },
  };
};
