/**
 * "DaVinci" layout of the Export page (clean-room after a colour suite's deliver page):
 * Render settings with preset tiles + Video/Audio/Datei tabs (left) | viewer (centre) |
 * render queue (right) | timeline bar with "Ganze Timeline" / "In/Out-Bereich" (bottom).
 */
import React from 'react';
import { FileCode, Film, Image, Images, ListPlus, Music, Play, Square } from 'lucide-react';
import {
    DELIVERY_PRESETS,
    estimateOutputBytes,
    formatBytes,
    formatTimecode,
    outputFileName,
    type RenderKind,
} from './deliveryModel';
import { queueSummary } from './exportState';
import {
    AudioFields,
    AudioOnlyFields,
    EffectsFields,
    FileFields,
    FormatFields,
    GeneralFields,
    MetadataFields,
    Section,
    SequenceFields,
    StillFields,
    VideoFields,
    type FieldEnv,
} from './ExportFields';
import { FrameFields, JobRow, PreflightList, TimecodeInput, sourceLabelOf, type ExportViewModel } from './ExportViewShared';

type Tile = { id: string; label: string; kind: RenderKind; presetId: string | null; icon: React.ReactNode };

const TILE_ICON: Record<RenderKind, React.ReactNode> = {
    media: <Film size={16} />,
    still: <Image size={16} />,
    sequence: <Images size={16} />,
    audio: <Music size={16} />,
};

const TILES: Tile[] = [
    { id: 'custom', label: 'Benutzerdefiniert', kind: 'media', presetId: null, icon: <FileCode size={16} /> },
    ...['youtube-1080', 'youtube-4k', 'prores-422-hq', 'prores-4444', 'hq-1080-h264', 'h265-10bit', 'instagram-916', 'draft-720', 'quick-browser', 'audio-only', 'image-sequence']
        .map((id) => DELIVERY_PRESETS.find((preset) => preset.id === id)!)
        .map((preset) => ({ id: preset.id, label: preset.tile, kind: preset.kind, presetId: preset.id, icon: TILE_ICON[preset.kind] })),
    { id: 'still', label: 'Einzelbild', kind: 'still', presetId: null, icon: TILE_ICON.still },
];

const tileActive = (vm: ExportViewModel, tile: Tile) => {
    const { davinciKind, settings } = vm.state;
    if (tile.kind !== davinciKind) return false;
    if (tile.kind === 'media') return tile.presetId ? settings.presetId === tile.presetId : !DELIVERY_PRESETS.some((p) => p.kind === 'media' && p.id === settings.presetId);
    return true;
};

const DavinciDeliverView: React.FC<{ vm: ExportViewModel }> = ({ vm }) => {
    const { state, dispatch } = vm;
    const { settings } = state;
    const kind = state.davinciKind;
    const tab = state.davinciTab;
    const fps = settings.video.fps;
    const env: FieldEnv = { settings, dispatch, hasElectron: vm.hasElectron, pickFolder: vm.pickFolder, pickFile: vm.pickFile };
    const summary = queueSummary(state.queue);
    const running = summary.running > 0;
    const duration = Math.max(0.001, vm.duration);
    const pct = (seconds: number) => `${Math.max(0, Math.min(100, (seconds / duration) * 100))}%`;
    const rangeMode = settings.range.mode === 'full' ? 'full' : 'inout';
    const rulerRef = React.useRef<HTMLDivElement>(null);
    const trackIndex = new Map(vm.timelineTracks.map((track, index) => [track.id, index]));
    const mediaType = new Map(vm.mediaItems.map((item) => [item.id, item.type]));

    const onTile = (tile: Tile) => {
        dispatch('export.davinci.kind', { kind: tile.kind });
        if (tile.presetId) dispatch('export.preset.apply', { presetId: tile.presetId });
        else if (tile.id === 'custom') dispatch('export.settings.patch', { section: 'root', patch: { engine: 'ffmpeg' } });
    };

    return (
        <div className="xp-body xp-davinci">
            {/* ─── Render-Einstellungen ─── */}
            <section className="xp-panel" aria-label="Render-Einstellungen">
                <div className="xp-panel__head">Render-Einstellungen <small>{tileActive(vm, TILES[0]) ? 'Benutzerdefiniert' : TILES.find((t) => tileActive(vm, t))?.label}</small></div>
                <div className="xp-tiles" role="group" aria-label="Render-Vorgaben">
                    {TILES.map((tile) => (
                        <button key={tile.id} type="button" className="xp-tile" aria-pressed={tileActive(vm, tile)} data-automation-id={`export.davinci.preset.${tile.id}`} onClick={() => onTile(tile)} title={tile.presetId ? DELIVERY_PRESETS.find((p) => p.id === tile.presetId)?.description : tile.label}>
                            {tile.icon}
                            <span>{tile.label}</span>
                        </button>
                    ))}
                </div>
                <div className="xp-tabs" role="tablist">
                    {(['video', 'audio', 'file'] as const).map((id) => (
                        <button key={id} type="button" role="tab" className="xp-tab" aria-selected={tab === id} data-automation-id={`export.davinci.tab.${id}`} onClick={() => dispatch('export.davinci.tab', { tab: id })}>
                            {id === 'video' ? 'Video' : id === 'audio' ? 'Audio' : 'Datei'}
                        </button>
                    ))}
                </div>
                <div className="xp-panel__scroll">
                    {tab === 'video' && kind === 'media' ? (
                        <>
                            <Section id="davinci.video" title="Video exportieren" open><FormatFields {...env} /><VideoFields {...env} sourceLabel={sourceLabelOf(vm.sourceInfo)} /></Section>
                            <Section id="davinci.effects" title="Einblendungen & Ausgabe-LUT" open><EffectsFields {...env} /></Section>
                        </>
                    ) : null}
                    {tab === 'video' && kind === 'still' ? <Section id="davinci.still" title="Einzelbild" open><StillFields {...env} stillLabel={formatTimecode(vm.previewTime, fps)} /><FrameFields vm={vm} /><EffectsFields {...env} /></Section> : null}
                    {tab === 'video' && kind === 'sequence' ? <Section id="davinci.sequence" title="Einzelbilder" open><SequenceFields {...env} frameCount={Math.max(1, Math.round(vm.range.duration * fps))} /><FrameFields vm={vm} withFps /><EffectsFields {...env} /></Section> : null}
                    {tab === 'video' && kind === 'audio' ? <div className="xp-note">Nur Audio: kein Videostream. Einstellungen unter „Audio“.</div> : null}
                    {tab === 'audio' && kind === 'media' ? <Section id="davinci.audio" title="Audio exportieren" open><AudioFields {...env} /></Section> : null}
                    {tab === 'audio' && kind === 'audio' ? <Section id="davinci.audioOnly" title="Nur Audio" open><AudioOnlyFields {...env} /></Section> : null}
                    {tab === 'audio' && (kind === 'still' || kind === 'sequence') ? <div className="xp-note">Bildausgaben enthalten keinen Ton.</div> : null}
                    {tab === 'file' ? (
                        <>
                            <Section id="davinci.file" title="Datei" open><FileFields {...env} fileName={outputFileName(kind, settings)} /></Section>
                            {kind === 'media' || kind === 'audio' ? <Section id="davinci.metadata" title="Metadaten" open><MetadataFields {...env} /></Section> : null}
                            <Section id="davinci.general" title="Erweitert" open><GeneralFields /></Section>
                        </>
                    ) : null}
                </div>
                <PreflightList items={vm.preflight} />
                <div className="xp-panel__foot" style={{ display: 'grid', gap: 6 }}>
                    <div className="xp-unit">
                        {outputFileName(kind, settings)} · geschätzt {formatBytes(estimateOutputBytes(kind, settings, vm.range.duration))}
                    </div>
                    <button type="button" className="xp-btn xp-btn--primary" data-automation-id="export.queue.add" onClick={() => dispatch('export.queue.add', { kinds: [kind] })}>
                        <ListPlus size={13} /> Zur Render-Warteschlange hinzufügen
                    </button>
                </div>
            </section>

            {/* ─── Viewer ─── */}
            <section className="xp-panel" aria-label="Viewer">
                <div className="xp-panel__head">{vm.timelineName} <small>{formatTimecode(vm.previewTime, fps)}</small></div>
                {vm.viewer}
            </section>

            {/* ─── Render-Warteschlange ─── */}
            <section className="xp-panel" aria-label="Render-Warteschlange">
                <div className="xp-panel__head">Render-Warteschlange <small>{summary.total} Jobs</small></div>
                <div className="xp-panel__scroll">
                    {state.queue.length === 0 ? <div className="xp-empty">Keine Jobs. Links eine Vorgabe wählen und „Zur Render-Warteschlange hinzufügen“.</div> : null}
                    {state.queue.map((job) => <JobRow key={job.id} vm={vm} job={job} />)}
                </div>
                <div className="xp-panel__foot" style={{ display: 'grid', gap: 6 }}>
                    {vm.message ? <span className="xp-message" data-tone={vm.message.tone} title={vm.message.text}>{vm.message.text}</span> : null}
                    {running ? (
                        <div className="xp-progress"><i style={{ width: `${summary.overallProgress}%` }} /></div>
                    ) : null}
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="xp-btn" data-automation-id="export.queue.clearFinished" disabled={summary.done + summary.error + summary.cancelled === 0} onClick={() => dispatch('export.queue.clearFinished', {})}>Erledigte entfernen</button>
                        <span style={{ flex: 1 }} />
                        {running ? (
                            <button type="button" className="xp-btn xp-btn--danger" data-automation-id="export.queue.cancel" onClick={() => dispatch('export.queue.cancel', {})}><Square size={12} /> Stopp</button>
                        ) : (
                            <button type="button" className="xp-btn xp-btn--primary" data-automation-id="export.queue.renderAll" disabled={summary.pending === 0} title={vm.exportBlockReason || undefined} onClick={() => dispatch('export.queue.renderAll', {})}>
                                <Play size={12} /> Alle rendern
                            </button>
                        )}
                    </div>
                </div>
            </section>

            {/* ─── Timeline-Leiste ─── */}
            <section className="xp-panel xp-davinci__timeline" aria-label="Timeline">
                <div className="xp-tlbar">
                    <div className="xp-seg" role="group" aria-label="Render-Bereich">
                        <button type="button" className="xp-seg__btn" aria-pressed={rangeMode === 'full'} data-automation-id="export.range.full" onClick={() => dispatch('export.range.set', { mode: 'full' })}>Ganze Timeline</button>
                        <button type="button" className="xp-seg__btn" aria-pressed={rangeMode === 'inout'} data-automation-id="export.range.inout" onClick={() => dispatch('export.range.set', { mode: 'inout' })}>In/Out-Bereich</button>
                    </div>
                    <div
                        className="xp-tlbar__ruler"
                        ref={rulerRef}
                        data-automation-id="export.timeline.ruler"
                        onPointerDown={(event) => {
                            const rect = rulerRef.current?.getBoundingClientRect();
                            if (rect) vm.onSeek(Math.max(0, Math.min(vm.duration, ((event.clientX - rect.left) / rect.width) * vm.duration)));
                        }}
                    >
                        {vm.timelineClips.map((clip) => {
                            const lane = Math.min(2, trackIndex.get(clip.trackId) ?? 0);
                            const audio = mediaType.get(clip.mediaId) === 'audio';
                            return (
                                <div key={clip.id} className={`xp-tlbar__clip${audio ? ' xp-tlbar__clip--audio' : ''}`} style={{ left: pct(clip.start), width: `calc(${pct(clip.end)} - ${pct(clip.start)})`, top: 3 + lane * 10 }} />
                            );
                        })}
                        {rangeMode === 'inout' ? <div className="xp-scrub__range" style={{ top: 0, height: '100%', left: pct(vm.range.start), width: `calc(${pct(vm.range.end)} - ${pct(vm.range.start)})`, opacity: 0.35 }} /> : null}
                        <div className="xp-scrub__head" style={{ top: 0, height: '100%', left: pct(vm.previewTime) }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="xp-unit">In</span>
                        <TimecodeInput aid="export.range.in" value={vm.range.start} fps={fps} disabled={rangeMode === 'full'} onChange={(inPoint) => dispatch('export.range.set', { mode: 'inout', inPoint })} />
                        <span className="xp-unit">Out</span>
                        <TimecodeInput aid="export.range.out" value={vm.range.end} fps={fps} disabled={rangeMode === 'full'} onChange={(outPoint) => dispatch('export.range.set', { mode: 'inout', outPoint })} />
                        <span className="xp-unit">Dauer {formatTimecode(vm.range.duration, fps)}</span>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default DavinciDeliverView;
