import React, { useEffect, useMemo, useState } from 'react';
import { MediaItem, TimelineClip, TitleMotionPreset } from '../types';
import { TextIcon, CheckCircleIcon, ScissorsIcon } from './icons';

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

  const [view, setView] = useState<'presets' | 'style' | 'subtitles' | 'review'>('presets');
  const [presetFilter, setPresetFilter] = useState<'all' | TitlePreset['family']>('all');

  const FAMILY_LABEL: Record<TitlePreset['family'], string> = { 'lower-third': 'Lower thirds', kinetic: 'Kinetic', subtitle: 'Subtitles' };
  const FAMILY_ORDER: TitlePreset['family'][] = ['lower-third', 'kinetic', 'subtitle'];
  const visiblePresets = TITLE_PRESETS.filter((preset) => presetFilter === 'all' || preset.family === presetFilter);
  const groupedPresets = FAMILY_ORDER.map((family) => ({ family, items: visiblePresets.filter((preset) => preset.family === family) })).filter((group) => group.items.length > 0);
  const currentTreatment: 'clear' | 'subtitle-plate' | 'lower-third-bar' = selectedClip?.textConfig?.background?.enabled ? (selectedClip.textConfig.background.style === 'lower-third-bar' ? 'lower-third-bar' : 'subtitle-plate') : 'clear';
  const currentMotion = selectedClip?.textConfig?.motionPreset || 'clear';
  const canTranscribe = Boolean(apiKeyReady && selectedClipMedia && (selectedClipMedia.type === 'video' || selectedClipMedia.type === 'audio'));

  const renderPresetTile = (preset: TitlePreset) => {
    const position = preset.textConfig.position;
    const align = position.includes('left') ? 'flex-start' : position.includes('right') ? 'flex-end' : 'center';
    const valign = position.startsWith('top') ? 'flex-start' : position.startsWith('bottom') ? 'flex-end' : 'center';
    const bg = preset.textConfig.background;
    const fontSize = Math.max(7, Math.min(13, preset.textConfig.size * 0.11));
    return (
      <div key={preset.id} className="fx-tile fx-tile--div" role="group" aria-label={preset.label} title={`${preset.label}\n${preset.description}\n${preset.safeNote}`} onClick={() => onCreateTitleClip(preset)}>
        <div className="fx-tile__thumb">
          {previewFrameUrl ? <img src={previewFrameUrl} alt="" draggable={false} /> : <div className="fx-tile__placeholder" />}
          <div className="title-tile__text" style={{ justifyContent: align, alignItems: valign }}>
            <span
              className="title-tile__copy"
              style={{
                fontFamily: preset.textConfig.font,
                fontSize,
                color: preset.textConfig.color,
                textAlign: align === 'flex-start' ? 'left' : align === 'flex-end' ? 'right' : 'center',
                background: bg?.enabled ? `rgb(${parseInt(bg.color.slice(1, 3), 16) || 0} ${parseInt(bg.color.slice(3, 5), 16) || 0} ${parseInt(bg.color.slice(5, 7), 16) || 0} / ${bg.opacity ?? 0.8})` : undefined,
                padding: bg?.enabled ? '0.15em 0.4em' : undefined,
                borderRadius: bg?.enabled ? Math.max(2, (bg.radius || 0) * 0.12) : undefined,
              }}
            >
              {preset.content}
            </span>
          </div>
          <span className="fx-tile__badge">{preset.duration.toFixed(1)}s</span>
          <div className="fx-tile__actions">
            <button type="button" className="fx-tile__action fx-tile__action--primary" onClick={(event) => { event.stopPropagation(); onCreateTitleClip(preset); }}>Add</button>
            <button type="button" className="fx-tile__action" disabled={!selectedClip} onClick={(event) => { event.stopPropagation(); onApplyPresetToSelected(preset); }} title={selectedClip ? 'Apply this style to the selected clip' : 'Select a clip first'}>To selected</button>
          </div>
        </div>
        <span className="fx-tile__name">{preset.label}</span>
      </div>
    );
  };

  return (
    <div className="fx-browser">
      <div className="fx-browser__header">
        <h3 className="fx-browser__title">Titles</h3>
        <div className="edit-seg" role="tablist" aria-label="Titles view">
          {([
            { id: 'presets', label: 'Presets' },
            { id: 'style', label: 'Style' },
            { id: 'subtitles', label: 'Subtitles' },
            { id: 'review', label: reviewFindings.length > 0 ? `Review · ${reviewFindings.length}` : 'Review' },
          ] as const).map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} className={`edit-seg__item ${view === tab.id ? 'edit-seg__item--active' : ''}`} onClick={() => setView(tab.id)}>{tab.label}</button>
          ))}
        </div>
      </div>

      {view === 'presets' && (
        <div className="fx-filters" role="tablist" aria-label="Preset family">
          {([{ id: 'all', label: 'All' }, { id: 'lower-third', label: 'Lower thirds' }, { id: 'kinetic', label: 'Kinetic' }, { id: 'subtitle', label: 'Subtitles' }] as const).map((entry) => (
            <button key={entry.id} type="button" role="tab" aria-selected={presetFilter === entry.id} className={`fx-filters__item ${presetFilter === entry.id ? 'fx-filters__item--active' : ''}`} onClick={() => setPresetFilter(entry.id)}>{entry.label}</button>
          ))}
        </div>
      )}

      <div className="fx-browser__scroll">
        {view === 'presets' && (
          presetFilter === 'all' ? (
            groupedPresets.map((group) => (
              <section key={group.family} className="fx-section">
                <header className="fx-section__title">{FAMILY_LABEL[group.family]}</header>
                <div className="fx-grid">{group.items.map(renderPresetTile)}</div>
              </section>
            ))
          ) : (
            <div className="fx-grid">{visiblePresets.map(renderPresetTile)}</div>
          )
        )}

        {view === 'style' && (
          <div className="pk-stack">
            {previewFrameUrl && (
              <div className="fx-tile__thumb" style={{ aspectRatio: '16 / 9' }} title="Title-safe area on the current frame">
                <img src={previewFrameUrl} alt="" draggable={false} style={{ opacity: 0.9 }} />
                <div style={{ position: 'absolute', inset: '8%', border: '1px solid rgb(87 184 148 / 0.8)', borderRadius: 2, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', inset: '14%', border: '1px dashed rgb(255 255 255 / 0.4)', borderRadius: 2, pointerEvents: 'none' }} />
                <span className="fx-tile__badge fx-tile__badge--left">Safe area · {previewSourceLabel || 'source'}</span>
              </div>
            )}

            {!selectedClipHasText ? (
              <div className="pk-empty">
                <TextIcon />
                <strong>Select a title clip</strong>
                <span>Treatments, motion and legibility apply to the text clip selected on the timeline.</span>
              </div>
            ) : (
              <>
                <div className="pk-card">
                  <div className="pk-card__head"><span className="pk-card__title">Background</span><span className="pk-hint">Readable plate behind the text</span></div>
                  <div className="pk-seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <button type="button" aria-pressed={currentTreatment === 'clear'} onClick={() => onApplyTreatmentToSelected('clear')}>None</button>
                    <button type="button" aria-pressed={currentTreatment === 'subtitle-plate'} onClick={() => onApplyTreatmentToSelected('subtitle-plate')}>Subtitle plate</button>
                    <button type="button" aria-pressed={currentTreatment === 'lower-third-bar'} onClick={() => onApplyTreatmentToSelected('lower-third-bar')}>Lower-third bar</button>
                  </div>
                </div>
                <div className="pk-card">
                  <div className="pk-card__head"><span className="pk-card__title">Motion</span><span className="pk-hint">How the title enters</span></div>
                  <div className="pk-seg" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    <button type="button" aria-pressed={currentMotion === 'clear'} onClick={() => onApplyMotionToSelected('clear')}>None</button>
                    <button type="button" aria-pressed={currentMotion === 'slide-in'} onClick={() => onApplyMotionToSelected('slide-in')}>Slide in</button>
                    <button type="button" aria-pressed={currentMotion === 'soft-fade'} onClick={() => onApplyMotionToSelected('soft-fade')}>Soft fade</button>
                    <button type="button" aria-pressed={currentMotion === 'blur-settle'} onClick={() => onApplyMotionToSelected('blur-settle')}>Blur settle</button>
                  </div>
                </div>
                <div className="pk-card">
                  <label className="pk-switch">
                    <span>
                      <span className="pk-card__title" style={{ display: 'block' }}>Auto contrast</span>
                      <span className="pk-hint">Flips the text colour when the frame behind it is too bright or too dark.</span>
                    </span>
                    <input type="checkbox" checked={selectedClipAutoContrast} onChange={(event) => onToggleAutoContrastForSelected(event.target.checked)} />
                  </label>
                </div>
              </>
            )}
          </div>
        )}

        {view === 'subtitles' && (
          <div className="pk-stack">
            <div className="pk-card">
              <div className="pk-card__head">
                <span className="pk-card__title">From the selected clip</span>
                <span className="pk-chip">{selectedClipMedia ? selectedClipMedia.type : 'nothing selected'}</span>
              </div>
              <p className="pk-hint">Transcribes the clip and lays subtitle cards across its range on the timeline.</p>
              <button type="button" className="edit-text-btn edit-text-btn--primary w-full justify-center" onClick={() => void handleGenerateSubtitles()} disabled={!canTranscribe || subtitleStatus.state === 'running'}>
                {subtitleStatus.state === 'running' ? 'Transcribing…' : 'Generate subtitles'}
              </button>
              {!apiKeyReady && <p className="pk-hint" style={{ color: 'var(--app-warm)' }}>Add a Gemini API key in Settings first.</p>}
              {apiKeyReady && !canTranscribe && <p className="pk-hint">Select a video or audio clip on the timeline.</p>}
              {subtitleStatus.message && (
                <div className={`pk-alert ${subtitleStatus.state === 'done' ? 'pk-alert--ok' : subtitleStatus.state === 'error' ? 'pk-alert--danger' : 'pk-alert--info'}`}>{subtitleStatus.message}</div>
              )}
              {subtitleStatus.transcript && (
                <details className="pk-details">
                  <summary>Transcript</summary>
                  <div className="pk-details__body"><p className="pk-body">{subtitleStatus.transcript}</p></div>
                </details>
              )}
            </div>

            {activeSubtitleGroup.length > 0 ? (
              <section className="fx-section">
                <header className="fx-section__title">Segments · {activeSubtitleGroup.length}</header>
                <div className="pk-list">
                  {activeSubtitleGroup.map((clip, index) => (
                    <div key={clip.id} className={`pk-row ${clip.id === selectedClip?.id ? 'pk-row--selected' : ''}`}>
                      <div className="pk-row__body">
                        <div className="pk-actions pk-actions--split">
                          <button type="button" className="pk-chip pk-mono" onClick={() => onSelectClip(clip.id)} title="Select this segment">{clip.start.toFixed(2)}s – {clip.end.toFixed(2)}s</button>
                          <span className="pk-actions">
                            <button type="button" className="edit-text-btn" onClick={() => onSplitSubtitleClip(clip.id)} disabled={(clip.subtitleSegment?.words.length || 0) < 2} title="Split at the midpoint"><ScissorsIcon className="w-3 h-3" />Split</button>
                            <button type="button" className="edit-text-btn" onClick={() => onMergeSubtitleClip(clip.id, 'previous')} disabled={index === 0} title="Merge with the previous segment">‹ Merge</button>
                            <button type="button" className="edit-text-btn" onClick={() => onMergeSubtitleClip(clip.id, 'next')} disabled={index === activeSubtitleGroup.length - 1} title="Merge with the next segment">Merge ›</button>
                          </span>
                        </div>
                        <textarea
                          rows={2}
                          value={transcriptDrafts[clip.id] ?? clip.textConfig?.content ?? ''}
                          onChange={(event) => setTranscriptDrafts((prev) => ({ ...prev, [clip.id]: event.target.value }))}
                          onBlur={() => onUpdateSubtitleClipContent(clip.id, transcriptDrafts[clip.id] ?? clip.textConfig?.content ?? '')}
                          aria-label={`Subtitle text ${index + 1}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <p className="pk-hint">Generated segments show up here for editing, splitting and merging.</p>
            )}
          </div>
        )}

        {view === 'review' && (
          <div className="pk-stack">
            <p className="pk-hint">A quick pass over every title on the timeline: safe margins, line length, timing and readability.</p>
            {reviewFindings.length === 0 ? (
              <div className="pk-empty">
                <CheckCircleIcon />
                <strong>All titles look good</strong>
                <span>No margin, length, timing or readability issues found.</span>
              </div>
            ) : (
              <div className="pk-list">
                {reviewFindings.map((finding) => (
                  <button key={finding.id} type="button" className="pk-row pk-row--clickable" onClick={() => onSelectClip(finding.clipId)} title="Select the affected clip">
                    <div className="pk-row__body">
                      <div className="pk-row__title">{finding.title}</div>
                      <div className="pk-row__meta">{finding.detail}</div>
                      <div className="pk-row__meta" style={{ color: 'var(--app-accent-strong)' }}>{finding.suggestion}</div>
                    </div>
                    <span className={`pk-chip ${finding.severity === 'high' ? 'pk-chip--danger' : finding.severity === 'medium' ? 'pk-chip--warn' : ''}`}>{finding.severity}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="fx-browser__footer">
        {view === 'presets' && <span>Click a preset to add it as a new clip at the playhead · hover for “To selected”</span>}
        {view === 'style' && <span>{selectedClipHasText ? 'Changes apply instantly to the selected title' : 'Select a title clip on the timeline'}</span>}
        {view === 'subtitles' && <span>Subtitle cards are regular text clips — edit them here or in the Inspector</span>}
        {view === 'review' && <span>Click a finding to jump to the clip</span>}
      </footer>
    </div>
  );
};

export default TitlesPanel;
