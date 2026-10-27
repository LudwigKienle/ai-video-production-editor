/**
 * MCP tools: Analysis (Review › Analysis / QC). Neurocinematics quick scan
 * (scene-change frames) and deep analysis (whole video), audio
 * psychoacoustics and target-audience fit, all with Gemini. Source video,
 * script context and the last result are the app's analysis state; the
 * audience fields live in the story bible.
 */
import { guardPaidTools } from '../paidGuard.ts';
import type { AudioPsychoacousticsResult, NeurocinematicsAnalysisResult, StoryBible } from '../../types';
import { getExtra, requireExtra, setExtra, type AnalysisExtra } from '../projectExtras.ts';
import { mediaInputSchema, pickMediaUrl, urlToPayload } from '../mediaInput.ts';
import { createServiceLoader } from '../serviceLoader.ts';
import { numArg, registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

const MODEL_PRO = 'gemini-3.1-pro-preview';
const MODEL_FLASH = 'gemini-3.1-flash-preview';
const MODEL_KEYS = { quick: 'analysis_model_quick_v1', deep: 'analysis_model_deep_v1', audio: 'analysis_model_audio_v1' } as const;
const MODEL_DEFAULTS = { quick: MODEL_FLASH, deep: MODEL_PRO, audio: MODEL_FLASH } as const;

type Frame = { base64: string; mimeType: string; timestamp: string };
type AnalysisServices = {
  analyzeFramesWithNeurocinematics: (frames: Frame[], script?: string, model?: string) => Promise<NeurocinematicsAnalysisResult>;
  analyzeVideoWithNeurocinematics: (video: string, script?: string, focusRange?: string, model?: string) => Promise<NeurocinematicsAnalysisResult>;
  analyzeAudioPsychoacoustics: (audio: { base64: string; mimeType: string }, script?: string, model?: string) => Promise<AudioPsychoacousticsResult>;
  analyzeTargetAudience: (script: string, audience: string, model?: string) => Promise<string>;
  sampleQuickScanFrames: (videoUrl: string, start: number, end: number, count: number) => Promise<Frame[]>;
  getVideoDuration: (url: string) => Promise<number>;
};

export const analysisServices = createServiceLoader<AnalysisServices>(async () => {
  const [gemini, sampling] = await Promise.all([import('../../services/geminiService.ts'), import('../../utils/videoFrameSampling.ts')]);
  return {
    analyzeFramesWithNeurocinematics: gemini.analyzeFramesWithNeurocinematics,
    analyzeVideoWithNeurocinematics: gemini.analyzeVideoWithNeurocinematics as AnalysisServices['analyzeVideoWithNeurocinematics'],
    analyzeAudioPsychoacoustics: gemini.analyzeAudioPsychoacoustics,
    analyzeTargetAudience: gemini.analyzeTargetAudience,
    sampleQuickScanFrames: sampling.sampleQuickScanFrames,
    getVideoDuration: sampling.getVideoDuration,
  };
});

const storage = (): Storage | null => {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
};
const modelFor = (kind: keyof typeof MODEL_KEYS, override?: unknown) => {
  if (typeof override === 'string' && override.trim()) return override.trim();
  try { return storage()?.getItem(MODEL_KEYS[kind])?.trim() || MODEL_DEFAULTS[kind]; } catch { return MODEL_DEFAULTS[kind]; }
};

const analysisOf = (ctx: StudioToolContext): AnalysisExtra => getExtra(ctx, 'analysis') ?? { videoUrl: null, scriptText: '', result: null };

const formatTime = (time: number) => `${Math.floor(time / 60)}:${Math.floor(time % 60).toString().padStart(2, '0')}`;

/** Source video and script: arguments win, else what the Analysis page holds. Updates the page source when given. */
const resolveSource = (ctx: StudioToolContext, args: Record<string, unknown>) => {
  const current = analysisOf(ctx);
  const given = pickMediaUrl(ctx, args, 'video');
  const scriptText = typeof args.scriptText === 'string' ? args.scriptText : current.scriptText;
  const videoUrl = given ?? current.videoUrl;
  if (!videoUrl) throw new Error('No video: pass videoUrl, videoPath or videoMediaId (or set one with analysis_set_source).');
  if (given !== null && given !== current.videoUrl) setExtra(ctx, 'analysis', { videoUrl: given, scriptText, result: null });
  else if (scriptText !== current.scriptText) setExtra(ctx, 'analysis', { ...current, scriptText });
  return { videoUrl, scriptText };
};

const focusRange = (args: Record<string, unknown>) => {
  if (args.rangeStart === undefined && args.rangeEnd === undefined) return null;
  const start = numArg(args, 'rangeStart', 0);
  const end = numArg(args, 'rangeEnd');
  if (end <= start) throw new Error('End time must be greater than start time.');
  return { start, end, label: `${formatTime(start)} - ${formatTime(end)}` };
};

const RANGE_PROPS = {
  rangeStart: { type: 'number' as const, description: 'Focus range start in seconds ("Focus Time Range").' },
  rangeEnd: { type: 'number' as const, description: 'Focus range end in seconds.' },
};

const storeResult = (ctx: StudioToolContext, videoUrl: string, scriptText: string, result: NeurocinematicsAnalysisResult) => {
  setExtra(ctx, 'analysis', { videoUrl, scriptText, result });
};

const runDeep = async (ctx: StudioToolContext, args: Record<string, unknown>, source: { videoUrl: string; scriptText: string }) => {
  const range = focusRange(args);
  const model = modelFor('deep', args.model);
  const result = await (await analysisServices.get()).analyzeVideoWithNeurocinematics(source.videoUrl, source.scriptText, range?.label, model);
  storeResult(ctx, source.videoUrl, source.scriptText, result);
  return { mode: 'deep', model, focusRange: range?.label ?? null, result };
};

export const ANALYSIS_TOOL_MODULE: StudioToolModule = {
  id: 'analysis',
  label: 'Review: Analysis',
  tools: [
    {
      name: 'analysis_get',
      description: 'Read the Analysis page: source video, script context, the last neurocinematics result (overall feedback and per-scene notes with timestamps), the target audience with its fit analysis, and the Gemini model ids used for quick/deep/audio.',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => {
        const analysis = analysisOf(ctx);
        const story = getExtra(ctx, 'storyBible');
        return {
          videoUrl: analysis.videoUrl,
          scriptText: analysis.scriptText,
          result: analysis.result,
          targetAudience: story?.targetAudience ?? '',
          audienceAnalysis: story?.audienceAnalysis ?? null,
          models: { quick: modelFor('quick'), deep: modelFor('deep'), audio: modelFor('audio') },
        };
      },
    },
    {
      name: 'analysis_set_source',
      description: 'Load a video to analyse ("Select File"/drop) and/or set the script context. A new video clears the previous result.',
      writes: true,
      parameters: { type: 'object', properties: { ...mediaInputSchema('video', 'Video to analyse'), scriptText: { type: 'string' } } },
      handler: (args, ctx) => {
        const current = analysisOf(ctx);
        const videoUrl = pickMediaUrl(ctx, args, 'video');
        const scriptText = typeof args.scriptText === 'string' ? args.scriptText : current.scriptText;
        const next: AnalysisExtra = videoUrl && videoUrl !== current.videoUrl ? { videoUrl, scriptText, result: null } : { ...current, scriptText };
        setExtra(ctx, 'analysis', next);
        return { videoUrl: next.videoUrl, scriptText: next.scriptText };
      },
    },
    {
      name: 'analysis_clear_video',
      description: 'Remove the source video and the current analysis result from the page ("Remove"). The video file itself is not touched.',
      writes: true,
      destructive: true,
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => {
        setExtra(ctx, 'analysis', { ...analysisOf(ctx), videoUrl: null, result: null });
        return { cleared: true };
      },
    },
    {
      name: 'analysis_set_models',
      description: `Set the Gemini model ids for quick scan, deep analysis and audio analysis (defaults ${MODEL_FLASH} / ${MODEL_PRO} / ${MODEL_FLASH}); an empty string restores the default.`,
      writes: true,
      parameters: { type: 'object', properties: { quick: { type: 'string' }, deep: { type: 'string' }, audio: { type: 'string' } } },
      handler: (args) => {
        const store = storage();
        for (const kind of Object.keys(MODEL_KEYS) as Array<keyof typeof MODEL_KEYS>) {
          if (typeof args[kind] !== 'string') continue;
          try {
            const value = (args[kind] as string).trim();
            if (value) store?.setItem(MODEL_KEYS[kind], value); else store?.removeItem(MODEL_KEYS[kind]);
          } catch { /* storage unavailable */ }
        }
        return { models: { quick: modelFor('quick'), deep: modelFor('deep'), audio: modelFor('audio') } };
      },
    },
    {
      name: 'analysis_run_quick',
      description: 'Quick Scan: sample 4-12 frames at scene changes (optionally within a focus range) and analyse them with Gemini. With autoUpgradeDeep the deep analysis runs afterwards (second paid call; default off here).',
      writes: true,
      cost: 'paid',
      parameters: {
        type: 'object',
        properties: { ...mediaInputSchema('video', 'Video (default: the page source)'), scriptText: { type: 'string' }, frameCount: { type: 'number', minimum: 4, maximum: 12 }, ...RANGE_PROPS, model: { type: 'string' }, autoUpgradeDeep: { type: 'boolean' } },
      },
      handler: async (args, ctx) => {
        const source = resolveSource(ctx, args);
        const range = focusRange(args);
        const services = await analysisServices.get();
        const duration = range ? range.end : await services.getVideoDuration(source.videoUrl);
        const frames = await services.sampleQuickScanFrames(source.videoUrl, range?.start ?? 0, duration, numArg(args, 'frameCount', 6));
        if (frames.length === 0) throw new Error('Unable to extract frames for quick analysis.');
        const model = modelFor('quick', args.model);
        const result = await services.analyzeFramesWithNeurocinematics(frames, source.scriptText, model);
        storeResult(ctx, source.videoUrl, source.scriptText, result);
        const quick = { mode: 'quick', model, frames: frames.map((frame) => frame.timestamp), result };
        if (args.autoUpgradeDeep !== true) return quick;
        return { quick, deep: await runDeep(ctx, args, source) };
      },
    },
    {
      name: 'analysis_run_deep',
      description: 'Deep Analysis: upload the whole video to Gemini (Pro model by default) and get per-scene neurocinematics feedback, optionally for a focus range.',
      writes: true,
      cost: 'paid',
      parameters: { type: 'object', properties: { ...mediaInputSchema('video', 'Video (default: the page source)'), scriptText: { type: 'string' }, ...RANGE_PROPS, model: { type: 'string' } } },
      handler: async (args, ctx) => runDeep(ctx, args, resolveSource(ctx, args)),
    },
    {
      name: 'analysis_run_audio',
      description: 'Analyze Audio: psychoacoustic review of a soundtrack (overall, mix notes, emotional arc, issues, suggestions, segments) with Gemini.',
      cost: 'paid',
      parameters: { type: 'object', properties: { ...mediaInputSchema('audio', 'Audio file'), scriptText: { type: 'string' }, model: { type: 'string' } } },
      handler: async (args, ctx) => {
        const url = pickMediaUrl(ctx, args, 'audio');
        if (!url) throw new Error('Pass audioUrl, audioPath or audioMediaId.');
        const payload = await urlToPayload(url, 'audio/wav');
        const script = typeof args.scriptText === 'string' ? args.scriptText : analysisOf(ctx).scriptText;
        const model = modelFor('audio', args.model);
        return { model, result: await (await analysisServices.get()).analyzeAudioPsychoacoustics(payload, script, model) };
      },
    },
    {
      name: 'analysis_set_target_audience',
      description: 'Set the target audience description ("Target Audience Fit"), stored in the story bible.',
      writes: true,
      parameters: { type: 'object', properties: { targetAudience: { type: 'string' } }, required: ['targetAudience'] },
      handler: (args, ctx) => {
        const story = requireExtra(ctx, 'storyBible');
        const targetAudience = typeof args.targetAudience === 'string' ? args.targetAudience : '';
        setExtra(ctx, 'storyBible', { ...story, targetAudience } as StoryBible);
        return { targetAudience };
      },
    },
    {
      name: 'analysis_run_audience_fit',
      description: 'Analyze Audience Fit: Gemini rates the script context against the target audience; the text is saved in the story bible (replaces the previous one).',
      writes: true,
      cost: 'paid',
      parameters: { type: 'object', properties: { scriptText: { type: 'string' }, targetAudience: { type: 'string' } } },
      handler: async (args, ctx) => {
        const story = requireExtra(ctx, 'storyBible');
        const script = typeof args.scriptText === 'string' && args.scriptText.trim() ? args.scriptText : analysisOf(ctx).scriptText;
        const audience = str(args, 'targetAudience', story.targetAudience || '');
        if (!script.trim() || !audience.trim()) throw new Error('Provide both script text and a target audience description.');
        const audienceAnalysis = await (await analysisServices.get()).analyzeTargetAudience(script, audience);
        setExtra(ctx, 'storyBible', { ...requireExtra(ctx, 'storyBible'), targetAudience: audience, audienceAnalysis } as StoryBible);
        return { targetAudience: audience, audienceAnalysis };
      },
    },
  ],
};

registerStudioToolModule(guardPaidTools(ANALYSIS_TOOL_MODULE));
