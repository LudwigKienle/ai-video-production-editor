/**
 * "Premiere" layout of the Export page (clean-room after an NLE export mode):
 * Ziele (left) | Einstellungen of the selected destination (centre) | Vorschau with range (right),
 * bottom bar with queue chips, "An Warteschlange senden" and "Exportieren".
 */
import React from 'react';
import { ListPlus, Square, Upload } from 'lucide-react';
import {
    DESTINATION_KINDS,
    estimateOutputBytes,
    findPreset,
    formatBytes,
    formatTimecode,
    mediaPresets,
    outputFileName,
    type DestinationKind,
} from './deliveryModel';
import { DESTINATION_LABELS, queueSummary } from './exportState';
import {
    AudioFields,
    AudioOnlyFields,
    EffectsFields,
    Field,
    FileFields,
    FormatFields,
    GeneralFields,
    InterchangeFields,
    MetadataFields,
    MultiplexerFields,
    Section,
    Select,
    SequenceFields,
    StillFields,
    Switch,
    VideoFields,
    type FieldEnv,
} from './ExportFields';
import { DESTINATION_ICONS, FrameFields, JobRow, PreflightList, TimecodeInput, sourceLabelOf, type ExportViewModel } from './ExportViewShared';

const describeDestination = (vm: ExportViewModel, kind: DestinationKind) => {
    const { settings } = vm.state;
    if (kind === 'interchange') return settings.interchange.formats.length > 0 ? settings.interchange.formats.map((f) => f.toUpperCase()).join(', ') : 'Kein Format gewählt';
    if (kind === 'media') {
        const preset = findPreset(settings.presetId);
        return preset?.kind === 'media' ? preset.label : 'Benutzerdefiniert';
    }
    return outputFileName(kind, settings);
};

const PremiereExportView: React.FC<{ vm: ExportViewModel }> = ({ vm }) => {
    const { state, dispatch } = vm;
    const { settings } = state;
    const kind = state.selectedDestination;
    const fps = settings.video.fps;
    const env: FieldEnv = { settings, dispatch, hasElectron: vm.hasElectron, pickFolder: vm.pickFolder, pickFile: vm.pickFile };
    const open = (id: string) => !state.collapsed[`${kind}.${id}`];
    const toggle = (id: string) => () => dispatch('export.section.toggle', { section: `${kind}.${id}` });
    const summary = queueSummary(state.queue);
    const running = summary.running > 0;
    const enabledKinds = DESTINATION_KINDS.filter((k) => state.enabledDestinations[k]);
    const bytes = estimateOutputBytes(kind, settings, vm.range.duration);
    const totalBytes = enabledKinds.reduce<number>((sum, k) => sum + (estimateOutputBytes(k, settings, vm.range.duration) || 0), 0);
    const preset = findPreset(settings.presetId);
    const v = settings.video;
    const outputLabel = kind === 'audio'
        ? `${settings.audioOnly.codec.toUpperCase()} · ${settings.audioOnly.sampleRate / 1000} kHz · ${settings.audioOnly.channels === 1 ? 'Mono' : 'Stereo'}`
        : settings.engine === 'browser' && kind === 'media'
            ? `${v.width} × ${v.height} · ${fps} fps · WebM`
            : `${v.width} × ${v.height} · ${fps} fps${kind === 'media' ? ` · ${v.codec === 'prores' ? `ProRes ${v.proresProfile.toUpperCase()}` : v.codec.toUpperCase()} ${v.bitDepth}-bit` : ''}`;

    const blocked = enabledKinds.length === 0 ? 'Kein Ziel aktiviert.' : enabledKinds.some((k) => k !== 'interchange') ? vm.exportBlockReason : null;

    return (
        <>
            <div className="xp-body xp-premiere">
                {/* ─── Ziele ─── */}
                <section className="xp-panel" aria-label="Ziele">
                    <div className="xp-panel__head">Ziele</div>
                    <div className="xp-panel__scroll" role="listbox" aria-label="Exportziele">
                        <div className="xp-dest-group">Datei</div>
                        {DESTINATION_KINDS.map((k) => (
                            <div
                                key={k}
                                role="option"
                                tabIndex={0}
                                aria-selected={kind === k}
                                className="xp-dest"
                                data-automation-id={`export.destination.select.${k}`}
                                onClick={() => dispatch('export.destination.select', { kind: k })}
                                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') dispatch('export.destination.select', { kind: k }); }}
                            >
                                <span className="xp-dest__icon">{DESTINATION_ICONS[k]}</span>
                                <span className="xp-dest__text">
                                    <span className="xp-dest__name">{DESTINATION_LABELS[k]}</span>
                                    <span className="xp-dest__sub">{describeDestination(vm, k)}</span>
                                </span>
                                <Switch aid={`export.destination.toggle.${k}`} label={`${DESTINATION_LABELS[k]} exportieren`} checked={state.enabledDestinations[k]} onChange={(enabled) => dispatch('export.destination.toggle', { kind: k, enabled })} />
                            </div>
                        ))}
                        <div className="xp-note">
                            Social- und Cloud-Uploads fehlen bewusst: Die App hat dafür keine Integration. Aktivierte Ziele werden mit „Exportieren“ nacheinander gerendert.
                        </div>
                    </div>
                </section>

                {/* ─── Einstellungen ─── */}
                <section className="xp-panel" aria-label="Einstellungen">
                    <div className="xp-panel__head">Einstellungen <small>{DESTINATION_LABELS[kind]}</small></div>
                    <div className="xp-panel__scroll">
                        <Section id={`${kind}.file`} title="Dateiname und Speicherort" summary={outputFileName(kind, settings, settings.interchange.formats[0])} open={open('file')} onToggle={toggle('file')}>
                            <FileFields {...env} fileName={outputFileName(kind, settings, settings.interchange.formats[0])} />
                        </Section>
                        {kind === 'media' ? (
                            <>
                                <Section id="media.preset" title="Vorgabe" summary={preset?.kind === 'media' ? preset.label : 'Benutzerdefiniert'} open={open('preset')} onToggle={toggle('preset')}>
                                    <Field label="Vorgabe" hint={preset?.kind === 'media' ? preset.description : 'Eigene Einstellungen – jede Änderung unten löst die Vorgabe.'}>
                                        <Select
                                            aid="export.preset.select"
                                            value={preset?.kind === 'media' ? preset.id : 'custom'}
                                            options={[...mediaPresets().map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Benutzerdefiniert' }]}
                                            onChange={(presetId) => { if (presetId !== 'custom') dispatch('export.preset.apply', { presetId }); }}
                                        />
                                    </Field>
                                </Section>
                                <Section id="media.format" title="Format" summary={settings.engine === 'browser' ? 'WebM' : v.codec === 'prores' ? 'QuickTime' : v.container.toUpperCase()} open={open('format')} onToggle={toggle('format')}>
                                    <FormatFields {...env} />
                                </Section>
                                <Section id="media.video" title="Video" summary={outputLabel} open={open('video')} onToggle={toggle('video')}>
                                    <VideoFields {...env} sourceLabel={sourceLabelOf(vm.sourceInfo)} />
                                </Section>
                                <Section id="media.audio" title="Audio" summary={settings.audio.enabled && settings.engine !== 'browser' ? `${settings.audio.codec.toUpperCase()} · ${settings.audio.sampleRate / 1000} kHz` : 'Aus'} open={open('audio')} onToggle={toggle('audio')}>
                                    <AudioFields {...env} />
                                </Section>
                                <Section id="media.mux" title="Multiplexer" open={open('mux')} onToggle={toggle('mux')}>
                                    <MultiplexerFields {...env} />
                                </Section>
                            </>
                        ) : null}
                        {kind === 'interchange' ? (
                            <Section id="interchange.formats" title="Formate" open={open('formats')} onToggle={toggle('formats')}>
                                <InterchangeFields {...env} />
                            </Section>
                        ) : null}
                        {kind === 'still' ? (
                            <Section id="still.image" title="Einzelbild" open={open('image')} onToggle={toggle('image')}>
                                <StillFields {...env} stillLabel={formatTimecode(vm.previewTime, fps)} />
                                <FrameFields vm={vm} />
                            </Section>
                        ) : null}
                        {kind === 'sequence' ? (
                            <Section id="sequence.image" title="Bildsequenz" open={open('image')} onToggle={toggle('image')}>
                                <SequenceFields {...env} frameCount={Math.max(1, Math.round(vm.range.duration * fps))} />
                                <FrameFields vm={vm} withFps />
                            </Section>
                        ) : null}
                        {kind === 'audio' ? (
                            <Section id="audio.audio" title="Audio" open={open('audio')} onToggle={toggle('audio')}>
                                <AudioOnlyFields {...env} />
                            </Section>
                        ) : null}
                        {kind === 'media' || kind === 'still' || kind === 'sequence' ? (
                            <Section id={`${kind}.effects`} title="Effekte" summary={[
                                settings.effects.imageOverlay.enabled ? 'Bild' : '',
                                settings.effects.timecode.enabled ? 'Timecode' : '',
                                settings.effects.name.enabled ? 'Name' : '',
                                settings.effects.outputLut.enabled ? 'LUT' : '',
                            ].filter(Boolean).join(', ') || 'Keine'} open={open('effects')} onToggle={toggle('effects')}>
                                <EffectsFields {...env} />
                            </Section>
                        ) : null}
                        {kind === 'media' || kind === 'audio' ? (
                            <Section id={`${kind}.metadata`} title="Metadaten" summary={settings.metadata.title || undefined} open={open('metadata')} onToggle={toggle('metadata')}>
                                <MetadataFields {...env} />
                            </Section>
                        ) : null}
                        {kind !== 'interchange' ? (
                            <Section id={`${kind}.general`} title="Allgemein" open={open('general')} onToggle={toggle('general')}>
                                <GeneralFields />
                            </Section>
                        ) : null}
                    </div>
                </section>

                {/* ─── Vorschau ─── */}
                <section className="xp-panel" aria-label="Vorschau">
                    <div className="xp-panel__head">Vorschau <small>{vm.timelineName}</small></div>
                    {vm.viewer}
                    <div className="xp-preview-meta">
                        <div className="xp-row2">
                            <Field label="Bereich" stack>
                                <Select
                                    aid="export.range.mode"
                                    value={settings.range.mode}
                                    options={[
                                        { value: 'full', label: 'Gesamte Sequenz' },
                                        { value: 'workarea', label: 'Arbeitsbereich (nicht vorhanden)', disabled: true },
                                        { value: 'inout', label: 'Sequenz In/Out' },
                                        { value: 'custom', label: 'Benutzerdefiniert' },
                                    ]}
                                    onChange={(mode) => dispatch('export.range.set', { mode: mode as 'full' | 'inout' | 'custom' })}
                                />
                            </Field>
                            <Field label="Skalieren" stack>
                                <Select
                                    aid="export.preview.scaleMode"
                                    value={v.scaleMode}
                                    disabled={settings.engine === 'browser'}
                                    options={[{ value: 'fit', label: 'Einpassen' }, { value: 'fill', label: 'Füllen' }, { value: 'stretch', label: 'Strecken' }]}
                                    onChange={(scaleMode) => dispatch('export.settings.patch', { section: 'video', patch: { scaleMode } })}
                                />
                            </Field>
                        </div>
                        <div className="xp-row2">
                            <Field label="In" stack>
                                <TimecodeInput aid="export.range.in" value={vm.range.start} fps={fps} disabled={settings.range.mode === 'full'} onChange={(inPoint) => dispatch('export.range.set', { mode: settings.range.mode === 'inout' ? 'inout' : 'custom', inPoint })} />
                            </Field>
                            <Field label="Out" stack>
                                <TimecodeInput aid="export.range.out" value={vm.range.end} fps={fps} disabled={settings.range.mode === 'full'} onChange={(outPoint) => dispatch('export.range.set', { mode: settings.range.mode === 'inout' ? 'inout' : 'custom', outPoint })} />
                            </Field>
                        </div>
                    </div>
                    <dl className="xp-summary" data-automation-id="export.summary">
                        <dt>Quelle</dt><dd>{vm.sourceInfo ? `${vm.sourceInfo.width} × ${vm.sourceInfo.height}` : 'unbekannt'}</dd>
                        <dt>Ausgabe</dt><dd title={outputLabel}>{outputLabel}</dd>
                        <dt>Dauer</dt><dd>{kind === 'still' ? '1 Bild' : formatTimecode(vm.range.duration, fps)}</dd>
                        <dt>Geschätzte Dateigröße</dt><dd className="xp-summary__big" data-automation-id="export.estimate">{formatBytes(bytes)}</dd>
                        {enabledKinds.length > 1 ? (<><dt>Alle Ziele ({enabledKinds.length})</dt><dd>{formatBytes(totalBytes || null)}</dd></>) : null}
                    </dl>
                    <PreflightList items={vm.preflight} />
                </section>
            </div>

            {/* ─── Bottom bar ─── */}
            <div className="xp-bottombar">
                <div className="xp-bottombar__queue" aria-label="Warteschlange">
                    {state.queue.length === 0 ? <span className="xp-message">Warteschlange leer.</span> : state.queue.slice(-8).map((job) => <JobRow key={job.id} vm={vm} job={job} compact />)}
                </div>
                {vm.message ? <span className="xp-message" data-tone={vm.message.tone} title={vm.message.text}>{vm.message.text}</span> : null}
                {running ? (
                    <button type="button" className="xp-btn xp-btn--danger" data-automation-id="export.queue.cancel" onClick={() => dispatch('export.queue.cancel', {})}>
                        <Square size={12} /> Abbrechen
                    </button>
                ) : null}
                <button type="button" className="xp-btn" data-automation-id="export.queue.add" disabled={enabledKinds.length === 0} onClick={() => dispatch('export.queue.add', {})} title="Aktivierte Ziele als Jobs in die Warteschlange legen">
                    <ListPlus size={13} /> An Warteschlange senden
                </button>
                {summary.pending > 0 && !running ? (
                    <button type="button" className="xp-btn" data-automation-id="export.queue.renderAll" onClick={() => dispatch('export.queue.renderAll', {})}>
                        Warteschlange rendern ({summary.pending})
                    </button>
                ) : null}
                <button type="button" className="xp-btn xp-btn--primary" data-automation-id="export.export" disabled={Boolean(blocked) || running} title={blocked || undefined} onClick={() => dispatch('export.export', {})}>
                    <Upload size={13} /> Exportieren
                </button>
            </div>
        </>
    );
};

export default PremiereExportView;
