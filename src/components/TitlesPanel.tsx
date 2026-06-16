import React, { useEffect, useMemo, useState } from 'react';
import { MediaItem, TimelineClip, TitleMotionPreset } from '../types';

export type TitlePreset = {
  id: string;
  label: string;
  family: 'lower-third' | 'kinetic' | 'subtitle';
  description: string;
  content: string;
  textConfig: NonNullable<TimelineClip['textConfig']>;
  duration: number;
  transform?: TimelineClip['transform'];
  keyframes?: TimelineClip['keyframes'];
  safeNote: string;
};

type TitleReviewFinding = {
  id: string;
  clipId: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  suggestion: string;
};

interface TitlesPanelProps {
  timelineClips: TimelineClip[];
  mediaItems: MediaItem[];
  selectedClip: TimelineClip | null;
  apiKeyReady?: boolean;
  previewFrameUrl?: string | null;
  previewSourceLabel?: string;
  onCreateTitleClip: (preset: TitlePreset) => void;
  onApplyPresetToSelected: (preset: TitlePreset) => void;
  onApplyTreatmentToSelected: (treatment: 'subtitle-plate' | 'lower-third-bar' | 'clear') => void;
  onApplyMotionToSelected: (preset: TitleMotionPreset) => void;
  onToggleAutoContrastForSelected: (enabled: boolean) => void;
  onGenerateSubtitlesFromSelected: () => Promise<{ count: number; transcript: string }>;
  onUpdateSubtitleClipContent: (clipId: string, content: string) => void;
  onSplitSubtitleClip: (clipId: string) => void;
  onMergeSubtitleClip: (clipId: string, direction: 'previous' | 'next') => void;
  onSelectClip: (clipId: string | null) => void;
}

const TITLE_PRESETS: TitlePreset[] = [
  {
    id: 'lower-third-clean',
    label: 'Clean Lower Third',
    family: 'lower-third',
    description: 'Interview-safe nameplate anchored low and left with restrained scale.',
    content: 'Ava Stone\nCreative Director',
    textConfig: {
      content: 'Ava Stone\nCreative Director',
      font: 'Trebuchet MS',
      size: 42,
      color: '#F8FAFC',
      position: 'bottom-left',
      motionPreset: 'slide-in',
      background: {
        enabled: true,
        color: '#0f172a',
        opacity: 0.78,
        paddingX: 26,
        paddingY: 14,
        radius: 16,
        style: 'lower-third-bar',
      },
    },
    duration: 5,
    safeNote: 'Keep it on dialogue clips and leave two lines max.',
  },
  {
    id: 'lower-third-bold',
    label: 'Bold Lower Third',
    family: 'lower-third',
    description: 'Brand-forward ID slate for promos and creator intros.',
    content: 'Studio Session\nBehind the Scenes',
    textConfig: {
      content: 'Studio Session\nBehind the Scenes',
      font: 'Impact',
      size: 52,
      color: '#FDE68A',
      position: 'bottom-left',
      motionPreset: 'slide-in',
      background: {
        enabled: true,
        color: '#111827',
        opacity: 0.84,
        paddingX: 34,
        paddingY: 18,
        radius: 18,
        style: 'lower-third-bar',
      },
    },
    duration: 4,
    safeNote: 'Use sparingly over busy footage; it wants a clean frame.',
  },
  {
    id: 'kinetic-punch',
    label: 'Kinetic Punch',
    family: 'kinetic',
    description: 'Pop-on center card for hooks, chapter cards, and CTA moments.',
    content: 'CUT FASTER',
    textConfig: {
      content: 'CUT FASTER',
      font: 'Impact',
      size: 112,
      color: '#FFFFFF',
      position: 'center',
    },
    duration: 2.5,
    transform: {
      scale: 1,
      opacity: 1,
      position: { x: 50, y: 50 },
    },
    keyframes: [
      { id: 'kinetic-punch-opacity-0', time: 0, property: 'opacity', value: 0, easing: 'ease-out' },
      { id: 'kinetic-punch-opacity-1', time: 0.14, property: 'opacity', value: 1, easing: 'ease-out' },
      { id: 'kinetic-punch-scale-0', time: 0, property: 'scale', value: 0.82, easing: 'ease-out' },
      { id: 'kinetic-punch-scale-1', time: 0.18, property: 'scale', value: 1.08, easing: 'ease-out' },
      { id: 'kinetic-punch-scale-2', time: 0.4, property: 'scale', value: 1, easing: 'ease-in-out' },
    ],
    safeNote: 'Best on isolated beats under three seconds.',
  },
  {
    id: 'kinetic-rise',
    label: 'Kinetic Rise',
    family: 'kinetic',
    description: 'Soft upward reveal for chapter headings or emotional beat text.',
    content: 'Night Shift',
    textConfig: {
      content: 'Night Shift',
      font: 'Georgia',
      size: 84,
      color: '#FFFFFF',
      position: 'center',
    },
    duration: 3.5,
    transform: {
      scale: 1,
      opacity: 1,
      position: { x: 50, y: 50 },
    },
    keyframes: [
      { id: 'kinetic-rise-opacity-0', time: 0, property: 'opacity', value: 0, easing: 'ease-in' },
      { id: 'kinetic-rise-opacity-1', time: 0.22, property: 'opacity', value: 1, easing: 'ease-out' },
      { id: 'kinetic-rise-y-0', time: 0, property: 'y', value: 56, easing: 'ease-out' },
      { id: 'kinetic-rise-y-1', time: 0.35, property: 'y', value: 50, easing: 'ease-in-out' },
    ],
    safeNote: 'Works best on calmer inserts or act breaks.',
  },
  {
    id: 'subtitle-clean',
    label: 'Subtitle Clean',
    family: 'subtitle',
    description: 'Readable bottom-center subtitle style for two-line dialogue.',
    content: 'We only have one clean take left.',
    textConfig: {
      content: 'We only have one clean take left.',
      font: 'Arial',
      size: 42,
      color: '#FFFFFF',
      position: 'bottom-center',
      autoContrast: true,
      motionPreset: 'soft-fade',
      background: {
        enabled: true,
        color: '#020617',
        opacity: 0.72,
        paddingX: 20,
        paddingY: 10,
        radius: 18,
        style: 'plate',
      },
    },
    duration: 4,
    safeNote: 'Keep to 42 characters per line for best readability.',
  },
  {
    id: 'subtitle-doc',
    label: 'Subtitle Doc',
    family: 'subtitle',
    description: 'Slightly smaller documentary subtitle treatment for denser dialogue.',
    content: 'This is the part where the room goes silent.',
    textConfig: {
      content: 'This is the part where the room goes silent.',
      font: 'Helvetica',
      size: 36,
      color: '#F8FAFC',
      position: 'bottom-center',
      autoContrast: true,
      motionPreset: 'soft-fade',
      background: {
        enabled: true,
        color: '#111827',
        opacity: 0.68,
        paddingX: 18,
        paddingY: 9,
        radius: 16,
        style: 'plate',
      },
    },
    duration: 4,
    safeNote: 'Use when dialogue density matters more than graphic impact.',
  },
];

const colorToLuminance = (hex: string) => {
  const value = (hex || '').replace('#', '').trim();
  if (value.length !== 6) return 1;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const getClipLabel = (clip: TimelineClip, mediaItems: MediaItem[]) => {
  const media = mediaItems.find((item) => item.id === clip.mediaId);
  return media?.name || clip.id;
};

const buildTitleReview = (timelineClips: TimelineClip[], mediaItems: MediaItem[]): TitleReviewFinding[] => {
  const findings: TitleReviewFinding[] = [];

  timelineClips
    .filter((clip) => clip.textConfig)
    .forEach((clip) => {
      const textConfig = clip.textConfig!;
      const content = textConfig.content.trim();
      const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
      const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
      const clipLabel = getClipLabel(clip, mediaItems);
      const clipDuration = Math.max(0.1, clip.end - clip.start);
      const luminance = colorToLuminance(textConfig.color);

      if (lines.length > 2) {
        findings.push({
          id: `${clip.id}-lines`,
          clipId: clip.id,
          severity: 'high',
          title: `${clipLabel}: too many text lines`,
          detail: `${lines.length} lines are active on this title clip.`,
          suggestion: 'Keep overlays to one or two lines and split longer copy into separate beats.',
        });
      }

      if (maxLineLength > 42) {
        findings.push({
          id: `${clip.id}-length`,
          clipId: clip.id,
          severity: maxLineLength > 56 ? 'high' : 'medium',
          title: `${clipLabel}: long line length`,
          detail: `Longest line is ${maxLineLength} characters.`,
          suggestion: 'Break the copy earlier or shorten the phrasing for cleaner scan speed.',
        });
      }

      if ((textConfig.position === 'top-left' || textConfig.position === 'top-right' || textConfig.position === 'bottom-left' || textConfig.position === 'bottom-right')) {
        findings.push({
          id: `${clip.id}-safe`,
          clipId: clip.id,
          severity: 'medium',
          title: `${clipLabel}: edge-safe margin risk`,
          detail: `The title sits on an edge anchor (${textConfig.position}).`,
          suggestion: 'Nudge lower thirds inward or use center anchors when frames will be reframed for socials.',
        });
      }

      if (textConfig.position.includes('bottom') && textConfig.size < 34) {
        findings.push({
          id: `${clip.id}-small`,
          clipId: clip.id,
          severity: 'medium',
          title: `${clipLabel}: subtitle size may be too small`,
          detail: `Current subtitle size is ${textConfig.size}px.`,
          suggestion: 'Keep subtitles around 36px to 46px for phone and laptop readability.',
        });
      }

      if (clipDuration < 1.5 && content.length > 16) {
        findings.push({
          id: `${clip.id}-duration`,
          clipId: clip.id,
          severity: 'medium',
          title: `${clipLabel}: not enough screen time`,
          detail: `The text stays on for ${clipDuration.toFixed(1)}s.`,
          suggestion: 'Shorten the copy or extend the title clip to avoid unreadable flashes.',
        });
      }

      if (luminance > 0.92 && !content.includes('\n')) {
        findings.push({
          id: `${clip.id}-contrast`,
          clipId: clip.id,
          severity: 'low',
          title: `${clipLabel}: possible contrast risk`,
          detail: 'Very bright text without a backing plate can disappear on highlights.',
          suggestion: 'Consider a warmer off-white, larger type, or a dedicated title card when footage is high-key.',
        });
      }
    });

  return findings.sort((a, b) => {
    const severityRank = { high: 0, medium: 1, low: 2 };
    return severityRank[a.severity] - severityRank[b.severity];
  });
};

const TitlesPanel: React.FC<TitlesPanelProps> = ({
  timelineClips,
  mediaItems,
  selectedClip,
  apiKeyReady = false,
  previewFrameUrl,
  previewSourceLabel,
  onCreateTitleClip,
  onApplyPresetToSelected,
  onApplyTreatmentToSelected,
  onApplyMotionToSelected,
  onToggleAutoContrastForSelected,
  onGenerateSubtitlesFromSelected,
  onUpdateSubtitleClipContent,
  onSplitSubtitleClip,
  onMergeSubtitleClip,
  onSelectClip,
}) => {
  const reviewFindings = useMemo(() => buildTitleReview(timelineClips, mediaItems), [mediaItems, timelineClips]);
  const selectedClipHasText = Boolean(selectedClip?.textConfig);
  const selectedClipMedia = selectedClip ? mediaItems.find((item) => item.id === selectedClip.mediaId) || null : null;
  const selectedClipAutoContrast = Boolean(selectedClip?.textConfig?.autoContrast);
  const activeSubtitleGroup = useMemo(() => {
    if (selectedClip?.subtitleSegment?.groupId) {
      return timelineClips
        .filter((clip) => clip.subtitleSegment?.groupId === selectedClip.subtitleSegment?.groupId)
        .sort((a, b) => a.start - b.start);
    }
    if (!selectedClip) return [];
    return timelineClips
      .filter((clip) => clip.subtitleSegment?.sourceClipId === selectedClip.id)
      .sort((a, b) => a.start - b.start);
  }, [selectedClip, timelineClips]);
  const [subtitleStatus, setSubtitleStatus] = useState<{ state: 'idle' | 'running' | 'done' | 'error'; message: string; transcript?: string }>({
    state: 'idle',
    message: '',
  });
  const [transcriptDrafts, setTranscriptDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    activeSubtitleGroup.forEach((clip) => {
      nextDrafts[clip.id] = clip.textConfig?.content || '';
    });
    setTranscriptDrafts(nextDrafts);
  }, [activeSubtitleGroup]);

  const handleGenerateSubtitles = async () => {
    setSubtitleStatus({ state: 'running', message: 'Transcribing selected clip...' });
    try {
      const result = await onGenerateSubtitlesFromSelected();
      setSubtitleStatus({
        state: 'done',
        message: `Created ${result.count} subtitle clip${result.count === 1 ? '' : 's'}.`,
        transcript: result.transcript,
      });
    } catch (error) {
      setSubtitleStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Subtitle generation failed.',
      });
    }
  };

  return (
    <div className="bg-gray-800/50 p-4 flex flex-col h-full">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Titles</h3>
          <p className="text-[11px] text-gray-400 mt-1">Lower thirds, kinetic cards, subtitle styles, and a built-in title review pass.</p>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-gray-500">
          {selectedClipHasText ? 'Selected clip can take a text preset' : 'Preset clips stay standalone by default'}
        </div>
      </div>

      {previewFrameUrl && (
        <div className="mb-4 rounded-lg border border-gray-700 bg-gray-900/60 p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-gray-500">
            <span>Safe Area Preview</span>
            <span className="normal-case tracking-normal text-gray-400">{previewSourceLabel || 'Current source frame'}</span>
          </div>
          <div className="relative h-28 overflow-hidden rounded-md border border-gray-700 bg-black">
            <img src={previewFrameUrl} alt="Safe area reference frame" className="h-full w-full object-cover opacity-90" />
            <div className="absolute inset-[8%] border border-emerald-300/70 rounded-sm pointer-events-none" />
            <div className="absolute inset-[14%] border border-indigo-300/40 rounded-sm pointer-events-none" />
            <div className="absolute bottom-[14%] left-[14%] text-[10px] text-emerald-200 bg-black/55 px-2 py-1 rounded">
              Safe title box
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3">
        <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Title Treatments</h4>
              <p className="mt-1 text-[11px] text-gray-400">Add readable plates for subtitles or turn lower thirds into anchored bars.</p>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              {selectedClipHasText ? 'Ready for selected title' : 'Select a text clip first'}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => onApplyTreatmentToSelected('subtitle-plate')}
              disabled={!selectedClipHasText}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-sky-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply Subtitle Plate
            </button>
            <button
              onClick={() => onApplyTreatmentToSelected('lower-third-bar')}
              disabled={!selectedClipHasText}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply Lower Third Bar
            </button>
            <button
              onClick={() => onApplyTreatmentToSelected('clear')}
              disabled={!selectedClipHasText}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-rose-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear Background
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Motion Presets</h4>
              <p className="mt-1 text-[11px] text-gray-400">Apply simple title animation curves for bars, plates, and overlay cards.</p>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              {selectedClipHasText ? 'Applied to selected title' : 'Select a text clip first'}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => onApplyMotionToSelected('slide-in')}
              disabled={!selectedClipHasText}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Slide In
            </button>
            <button
              onClick={() => onApplyMotionToSelected('soft-fade')}
              disabled={!selectedClipHasText}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-sky-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Soft Fade
            </button>
            <button
              onClick={() => onApplyMotionToSelected('blur-settle')}
              disabled={!selectedClipHasText}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-fuchsia-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Blur Settle
            </button>
            <button
              onClick={() => onApplyMotionToSelected('clear')}
              disabled={!selectedClipHasText}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-rose-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear Motion
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Legibility</h4>
              <p className="mt-1 text-[11px] text-gray-400">Sample the current frame behind text and flip colors when highlights or shadows would kill readability.</p>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              {selectedClipAutoContrast ? 'Auto contrast on' : 'Auto contrast off'}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => onToggleAutoContrastForSelected(!selectedClipAutoContrast)}
              disabled={!selectedClipHasText}
              className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {selectedClipAutoContrast ? 'Disable Auto Contrast' : 'Enable Auto Contrast'}
            </button>
            <span className="text-[11px] text-gray-500">The program monitor now shows title-safe guides whenever a text overlay is active.</span>
          </div>
        </div>

        <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Transcript-Driven Subtitles</h4>
              <p className="mt-1 text-[11px] text-gray-400">Transcribe the selected audio or video clip and distribute subtitle cards across its timeline range.</p>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              {selectedClipMedia ? selectedClipMedia.type : 'No clip selected'}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void handleGenerateSubtitles()}
              disabled={!apiKeyReady || !selectedClipMedia || (selectedClipMedia.type !== 'video' && selectedClipMedia.type !== 'audio') || subtitleStatus.state === 'running'}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {subtitleStatus.state === 'running' ? 'Generating Subtitles...' : 'Generate Subtitles from Selected Clip'}
            </button>
            {!apiKeyReady && <span className="text-[11px] text-amber-300">Add a Gemini API key in Settings first.</span>}
          </div>
          {subtitleStatus.message && (
            <div className={`mt-3 rounded-md px-3 py-2 text-xs ${
              subtitleStatus.state === 'done'
                ? 'border border-emerald-500/20 bg-emerald-900/10 text-emerald-200'
                : subtitleStatus.state === 'error'
                  ? 'border border-rose-500/20 bg-rose-900/10 text-rose-200'
                  : 'border border-indigo-500/20 bg-indigo-900/10 text-indigo-200'
            }`}>
              {subtitleStatus.message}
            </div>
          )}
          {subtitleStatus.transcript && (
            <div className="mt-3 rounded-md border border-gray-700 bg-gray-950/70 p-3">
              <div className="text-[10px] uppercase tracking-widest text-gray-500">Transcript Preview</div>
              <div className="mt-2 text-[11px] text-gray-300 line-clamp-5">{subtitleStatus.transcript}</div>
            </div>
          )}
        </div>
      </div>

      {activeSubtitleGroup.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-700 bg-gray-900/50 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Transcript Editor</h4>
              <p className="mt-1 text-[11px] text-gray-400">Fine-tune generated subtitle segments, then split or merge them without leaving the Titles tab.</p>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              {activeSubtitleGroup.length} segment{activeSubtitleGroup.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {activeSubtitleGroup.map((clip, index) => (
              <div key={clip.id} className="rounded-md border border-gray-700 bg-gray-950/60 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">
                    {clip.start.toFixed(2)}s to {clip.end.toFixed(2)}s
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSelectClip(clip.id)}
                      className="rounded border border-gray-600 px-2 py-1 text-[11px] text-gray-200 hover:border-indigo-500"
                    >
                      Focus
                    </button>
                    <button
                      onClick={() => onSplitSubtitleClip(clip.id)}
                      disabled={(clip.subtitleSegment?.words.length || 0) < 2}
                      className="rounded border border-gray-600 px-2 py-1 text-[11px] text-gray-200 hover:border-sky-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Split
                    </button>
                    <button
                      onClick={() => onMergeSubtitleClip(clip.id, 'previous')}
                      disabled={index === 0}
                      className="rounded border border-gray-600 px-2 py-1 text-[11px] text-gray-200 hover:border-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Merge Prev
                    </button>
                    <button
                      onClick={() => onMergeSubtitleClip(clip.id, 'next')}
                      disabled={index === activeSubtitleGroup.length - 1}
                      className="rounded border border-gray-600 px-2 py-1 text-[11px] text-gray-200 hover:border-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Merge Next
                    </button>
                  </div>
                </div>
                <textarea
                  rows={2}
                  value={transcriptDrafts[clip.id] ?? clip.textConfig?.content ?? ''}
                  onChange={(event) => setTranscriptDrafts((prev) => ({ ...prev, [clip.id]: event.target.value }))}
                  onBlur={() => onUpdateSubtitleClipContent(clip.id, transcriptDrafts[clip.id] ?? clip.textConfig?.content ?? '')}
                  className="mt-3 w-full rounded-md border border-gray-700 bg-black/40 p-2 text-sm text-gray-100"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-1">
        {TITLE_PRESETS.map((preset) => (
          <div key={preset.id} className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-white">{preset.label}</h4>
                  <span className="rounded border border-gray-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">{preset.family}</span>
                </div>
                <p className="mt-1 text-[11px] text-gray-400">{preset.description}</p>
              </div>
              <div className="text-[10px] text-gray-500">{preset.duration.toFixed(1)}s</div>
            </div>

            <div className="mt-3 rounded-md border border-gray-700 bg-black/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Preset Copy</div>
              <div
                className="text-white whitespace-pre-line"
                style={{
                  fontFamily: preset.textConfig.font,
                  fontSize: Math.max(18, preset.textConfig.size * 0.32),
                  textAlign: preset.textConfig.position.includes('left') ? 'left' : preset.textConfig.position.includes('right') ? 'right' : 'center',
                  color: preset.textConfig.color,
                }}
              >
                {preset.content}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[11px] text-gray-500">{preset.safeNote}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onCreateTitleClip(preset)}
                  className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  Add Title Clip
                </button>
                <button
                  onClick={() => onApplyPresetToSelected(preset)}
                  disabled={!selectedClip}
                  className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Apply to Selected
                </button>
              </div>
            </div>
          </div>
        ))}

        <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Overlay Review</h4>
              <p className="mt-1 text-[11px] text-gray-400">Heuristic pass for safe margins, line length, timing, and likely readability issues.</p>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">{reviewFindings.length} findings</div>
          </div>

          {reviewFindings.length === 0 ? (
            <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-900/10 px-3 py-2 text-xs text-emerald-200">
              No immediate title or subtitle issues detected in the current timeline.
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {reviewFindings.map((finding) => (
                <button
                  key={finding.id}
                  onClick={() => onSelectClip(finding.clipId)}
                  className="w-full rounded-md border border-gray-700 bg-gray-950/60 p-3 text-left hover:border-indigo-500/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">{finding.title}</div>
                      <div className="mt-1 text-[11px] text-gray-400">{finding.detail}</div>
                      <div className="mt-2 text-[11px] text-indigo-300">{finding.suggestion}</div>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                      finding.severity === 'high'
                        ? 'bg-rose-900/50 text-rose-200'
                        : finding.severity === 'medium'
                          ? 'bg-amber-900/50 text-amber-200'
                          : 'bg-sky-900/50 text-sky-200'
                    }`}>
                      {finding.severity}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TitlesPanel;
