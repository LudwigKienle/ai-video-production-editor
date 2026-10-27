/**
 * Color page in the layout of a grading suite (own design):
 *
 *   ┌ Galerie ┬──────── Viewer ────────┬ Nodes ┐
 *   ├─────────┴── Clips + Mini-Timeline ┴───────┤
 *   ├ Primaries │ Kurven / Qualifier / … │ Scopes┤
 *
 * Nodes are the clip's fxStack (avpe.primary-grade instances + other GPU
 * effects), so every grade renders in the timeline preview and is baked in
 * export. Edits go through onUpdateClip / onBatchUpdateClips (undoable).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Aperture, Blend, Circle, Columns2, Crop, Droplet, Eye, EyeOff, Film, KeyRound, Palette, Pipette, Sparkles, Spline, SunMedium } from 'lucide-react';
import './registerPrimaryGrade';
import './colorPro.css';
import type { ClipFilters, MediaItem, TimelineClip } from '../../types';
import type { FxParamValues, FxStack } from '../../fx/types';
import type { SharedSequenceProps } from '../../components/EditorPageShell';
import EditTransportBar from '../../components/EditTransportBar';
import Timeline from '../../components/Timeline';
import FxStackPanel from '../../fx/ui/FxStackPanel';
import { createFxInstance, listFxDefinitions, resolveParams, subscribeFxRegistry } from '../../fx/registry';
import { normalizeFilters } from '../../utils/colorGrading';
import { extractFrameFromVideo } from '../../utils/helpers';
import { DEFAULT_TIMELINE_FPS } from '../../utils/timecode';
import { registerLiveCommands } from '../../mcp/liveCommands';
import { PRIMARY_GRADE_ID } from '../../fx/effects/primaryGrade/index';
import ColorViewer, { type ViewerHandle, type WindowOverlay } from './ColorViewer';
import NodeEditor from './NodeEditor';
import GalleryPanel from './GalleryPanel';
import ClipStripPro, { orderVisualClips } from './ClipStripPro';
import { BlurPalette, CurvesPalette, KeyPalette, PrimariesPalette, QualifierPalette, SizingPalette, WindowPalette, qualifierFromPick, type PrimariesMode } from './palettes';
import { AiColoristPalette, LooksPalette } from './LooksPalette';
import { ScopeCanvas, SCOPE_LABELS, type ScopeMode } from './ScopesPanel';
import { scopeStats, type ScopeData } from './scopes';
import {
  addSerialNode,
  applyGradeToClips,
  createGradeNode,
  extractGrade,
  isGradeNode,
  moveNode,
  removeNode,
  resetNode,
  setNodeLabel,
  setNodeMix,
  toggleNode,
  updateNodeParams,
  type ClipGrade,
} from './nodeStack';
import { createStill, loadGallery, removeStill, renameStill, saveGallery, subscribeGallery, type GalleryStill } from './gallery';

export type ColorPageProps = SharedSequenceProps & {
  selectedClip: TimelineClip | null;
  selectedMedia: MediaItem | null;
  onUpdateFilters: (clipId: string, filters: TimelineClip['filters']) => void;
  onSwitchToEdit?: () => void;
  /** Page switch (Farbe / Audio) rendered at the left of the top bar. */
  pageTabs?: React.ReactNode;
  /** When set, replaces the grading layout (e.g. the audio analyzer). */
  altContent?: React.ReactNode;
};

type CenterTab = 'curves' | 'qualifier' | 'window' | 'blur' | 'key' | 'sizing' | 'looks' | 'ai';

const CENTER_TABS: Array<{ id: CenterTab; label: string; icon: React.ReactNode }> = [
  { id: 'curves', label: 'Kurven', icon: <Spline /> },
  { id: 'qualifier', label: 'Qualifier', icon: <Pipette /> },
  { id: 'window', label: 'Fenster', icon: <Circle /> },
  { id: 'blur', label: 'Weichzeichnen', icon: <Droplet /> },
  { id: 'key', label: 'Key', icon: <KeyRound /> },
  { id: 'sizing', label: 'Sizing', icon: <Crop /> },
  { id: 'looks', label: 'LUT & Looks', icon: <Film /> },
  { id: 'ai', label: 'KI-Colorist', icon: <Sparkles /> },
];

const PRIMARY_TABS: Array<{ id: PrimariesMode; label: string; icon: React.ReactNode }> = [
  { id: 'wheels', label: 'Farbräder', icon: <Aperture /> },
  { id: 'bars', label: 'Balken', icon: <Columns2 /> },
  { id: 'log', label: 'Log', icon: <SunMedium /> },
];

const loadPref = <T extends string>(key: string, fallback: T, allowed: readonly T[]): T => {
  try {
    const value = window.localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
};
const savePref = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
};

const ColorPage: React.FC<ColorPageProps> = (props) => {
  const {
    selectedClip, selectedMedia, timelineClips, timelineTracks, mediaItems, playheadPosition, isPlaying,
    onSelectClip, onUpdateClip, onBatchUpdateClips, onPlayheadUpdate, onTogglePlayback, onUpdateFilters, onSwitchToEdit, pageTabs, altContent,
  } = props;

  const [selectedNode, setSelectedNode] = useState(0);
  const [bypass, setBypass] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [wipePos, setWipePos] = useState(0.5);
  const [highlight, setHighlight] = useState(false);
  const [picking, setPicking] = useState(false);
  const [primaryMode, setPrimaryMode] = useState<PrimariesMode>(() => loadPref('avpe.color.primaryMode', 'wheels', ['wheels', 'bars', 'log'] as const));
  const [centerTab, setCenterTab] = useState<CenterTab>(() => loadPref('avpe.color.centerTab', 'curves', CENTER_TABS.map((t) => t.id)));
  const [scopeMode, setScopeMode] = useState<ScopeMode>(() => loadPref('avpe.color.scopeMode', 'parade', ['waveform', 'parade', 'vectorscope', 'histogram'] as const));
  const [showGallery, setShowGallery] = useState(true);
  const [showNodes, setShowNodes] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);
  const [scopes, setScopes] = useState<ScopeData | null>(null);
  const [stills, setStills] = useState<GalleryStill[]>(() => loadGallery());
  const [clipboard, setClipboard] = useState<ClipGrade | null>(null);
  const [marked, setMarked] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<{ clip: TimelineClip; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, setRegistryTick] = useState(0);
  const viewerRef = useRef<ViewerHandle | null>(null);

  useEffect(() => savePref('avpe.color.primaryMode', primaryMode), [primaryMode]);
  useEffect(() => savePref('avpe.color.centerTab', centerTab), [centerTab]);
  useEffect(() => savePref('avpe.color.scopeMode', scopeMode), [scopeMode]);
  useEffect(() => subscribeGallery(() => setStills(loadGallery())), []);
  useEffect(() => subscribeFxRegistry(() => setRegistryTick((n) => n + 1)), []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const stack: FxStack = useMemo(() => selectedClip?.fxStack ?? [], [selectedClip?.fxStack]);
  const nodeIndex = stack.length ? Math.min(selectedNode, stack.length - 1) : 0;
  const currentNode = stack[nodeIndex] ?? null;
  const currentIsGrade = !currentNode || isGradeNode(currentNode);
  const nodeValues: FxParamValues = useMemo(() => (currentNode && isGradeNode(currentNode) ? resolveParams(currentNode) : resolveParams(createGradeNode({}, 'preview'))), [currentNode]);
  const filters = useMemo(() => normalizeFilters(selectedClip?.filters), [selectedClip?.filters]);
  const sequenceDuration = useMemo(() => timelineClips.reduce((max, clip) => Math.max(max, clip.end), 0), [timelineClips]);
  const visualClips = useMemo(() => orderVisualClips(timelineClips, timelineTracks, mediaItems), [timelineClips, timelineTracks, mediaItems]);

  // Follow the playhead: select the top-most visual clip under it (like the old shell).
  const latest = useRef({ timelineClips, timelineTracks, mediaItems, selectedClipId: props.selectedClipId, onSelectClip });
  latest.current = { timelineClips, timelineTracks, mediaItems, selectedClipId: props.selectedClipId, onSelectClip };
  useEffect(() => {
    const { timelineClips: clips, timelineTracks: tracks, mediaItems: media, selectedClipId: selected, onSelectClip: select } = latest.current;
    const order = new Map(tracks.map((track, index) => [track.id, index]));
    const under = clips
      .filter((clip) => playheadPosition >= clip.start && playheadPosition < clip.end)
      .filter((clip) => { const item = media.find((entry) => entry.id === clip.mediaId); return item && item.type !== 'audio'; })
      .sort((a, b) => (order.get(b.trackId) ?? 0) - (order.get(a.trackId) ?? 0))[0];
    if (under && under.id !== selected) select(under.id);
  }, [playheadPosition]);

  useEffect(() => { setPicking(false); }, [selectedClip?.id]);

  // ------------------------------------------------------------------ edits
  const commitStack = useCallback((next: FxStack, select?: number) => {
    if (!selectedClip) return;
    onUpdateClip({ ...selectedClip, fxStack: next });
    if (select !== undefined) setSelectedNode(select);
  }, [onUpdateClip, selectedClip]);

  /** Patch the selected colour node; creates node 01 on an empty clip. */
  const patchNode = useCallback((patch: FxParamValues) => {
    if (!selectedClip) return;
    if (!stack.length) {
      commitStack([createGradeNode(patch)], 0);
      return;
    }
    if (!currentNode || !isGradeNode(currentNode)) return;
    commitStack(updateNodeParams(stack, nodeIndex, patch));
  }, [commitStack, currentNode, nodeIndex, selectedClip, stack]);

  const addSerial = useCallback(() => {
    if (!selectedClip) return;
    // An empty clip shows the implicit node 01, so ⌥S adds node 02 after it.
    const base = stack.length ? stack : [createGradeNode()];
    const { stack: next, index } = addSerialNode(base, stack.length ? nodeIndex : 0);
    commitStack(next, index);
    setToast(`Node ${String(index + 1).padStart(2, '0')} hinzugefügt`);
  }, [commitStack, nodeIndex, selectedClip, stack]);

  const addEffectNode = (effectId: string) => {
    const { stack: next, index } = addSerialNode(stack, stack.length ? nodeIndex : -1, createFxInstance(effectId));
    commitStack(next, index);
  };

  const toggleCurrent = useCallback(() => {
    if (!currentNode) return;
    commitStack(toggleNode(stack, nodeIndex));
    setToast(currentNode.enabled ? `Node ${String(nodeIndex + 1).padStart(2, '0')} deaktiviert` : `Node ${String(nodeIndex + 1).padStart(2, '0')} aktiviert`);
  }, [commitStack, currentNode, nodeIndex, stack]);

  const removeCurrent = useCallback(() => {
    if (!currentNode) return;
    commitStack(removeNode(stack, nodeIndex), Math.max(0, nodeIndex - 1));
  }, [commitStack, currentNode, nodeIndex, stack]);

  const commitFilters = useCallback((next: ClipFilters) => {
    if (selectedClip) onUpdateFilters(selectedClip.id, next);
  }, [onUpdateFilters, selectedClip]);

  // ------------------------------------------------------------------ grades between clips
  const applyGrade = useCallback((grade: ClipGrade, targetIds: string[], label: string) => {
    if (!targetIds.length) return;
    onBatchUpdateClips(applyGradeToClips(timelineClips, grade, targetIds));
    setToast(`${label} → ${targetIds.length} Clip(s)`);
  }, [onBatchUpdateClips, timelineClips]);

  const targetIds = useCallback(() => {
    const ids = new Set(marked);
    if (selectedClip) ids.add(selectedClip.id);
    return [...ids];
  }, [marked, selectedClip]);

  const copyGrade = useCallback(() => {
    if (!selectedClip) return;
    setClipboard(extractGrade(selectedClip));
    setToast('Grade kopiert');
  }, [selectedClip]);

  const pasteGrade = useCallback(() => {
    if (!clipboard) return;
    applyGrade(clipboard, targetIds(), 'Grade eingefügt');
  }, [applyGrade, clipboard, targetIds]);

  const applyToAll = () => {
    if (!selectedClip) return;
    applyGrade(extractGrade(selectedClip), visualClips.filter((clip) => clip.id !== selectedClip.id).map((clip) => clip.id), 'Grade auf alle');
  };

  const grabStill = useCallback(() => {
    if (!selectedClip) return;
    const next = createStill(loadGallery(), extractGrade(selectedClip), viewerRef.current?.thumbnail() ?? '', { sourceClipName: selectedMedia?.name });
    saveGallery(next);
    setStills(next);
    setToast(`${next[0].name} aufgenommen`);
  }, [selectedClip, selectedMedia?.name]);

  // ------------------------------------------------------------------ keyboard (capture: before App shortcuts)
  const keys = useRef({ addSerial, toggleCurrent, removeCurrent, copyGrade, pasteGrade, grabStill });
  keys.current = { addSerial, toggleCurrent, removeCurrent, copyGrade, pasteGrade, grabStill };
  useEffect(() => {
    if (altContent) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const k = keys.current;
      const stop = () => { event.preventDefault(); event.stopPropagation(); };
      if (event.altKey && !mod && event.code === 'KeyS') { stop(); k.addSerial(); return; }
      if (event.shiftKey && !mod && !event.altKey && event.code === 'KeyD') { stop(); setBypass((v) => !v); return; }
      if (mod && !event.shiftKey && !event.altKey && event.code === 'KeyD') { stop(); k.toggleCurrent(); return; }
      if (mod && !event.shiftKey && !event.altKey && event.code === 'KeyC' && !window.getSelection()?.toString()) { stop(); k.copyGrade(); return; }
      if (mod && !event.shiftKey && !event.altKey && event.code === 'KeyV') { stop(); k.pasteGrade(); return; }
      if (mod && event.altKey && event.code === 'KeyG') { stop(); k.grabStill(); return; }
      const inNodes = (event.target as HTMLElement | null)?.closest?.('[data-automation-id="color.nodes"]');
      if (inNodes && (event.key === 'Delete' || event.key === 'Backspace')) { stop(); k.removeCurrent(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [altContent]);

  // ------------------------------------------------------------------ MCP live commands (UI-local state)
  const live = useRef({ scopes, selectedClip, bypass, wipe, wipePos, highlight, nodeIndex });
  live.current = { scopes, selectedClip, bypass, wipe, wipePos, highlight, nodeIndex };
  useEffect(() => registerLiveCommands({
    'color.scopes.read': async () => {
      // Give the viewer a moment to render a freshly selected clip.
      for (let i = 0; i < 20 && !live.current.scopes; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
      const data = live.current.scopes;
      if (!data) throw new Error('No graded frame available (no visual clip selected or media blocks pixel access).');
      return { clipId: live.current.selectedClip?.id ?? null, bypass: live.current.bypass, size: { width: data.width, height: data.height }, stats: scopeStats(data) };
    },
    'color.viewer.set': (args) => {
      if (typeof args.bypass === 'boolean') setBypass(args.bypass);
      if (typeof args.wipe === 'boolean') setWipe(args.wipe);
      if (typeof args.wipePos === 'number') setWipePos(Math.min(1, Math.max(0, args.wipePos)));
      if (typeof args.highlight === 'boolean') setHighlight(args.highlight);
      if (typeof args.selectNode === 'number') setSelectedNode(Math.max(0, Math.round(args.selectNode)));
      const s = live.current;
      return {
        bypass: typeof args.bypass === 'boolean' ? args.bypass : s.bypass,
        wipe: typeof args.wipe === 'boolean' ? args.wipe : s.wipe,
        wipePos: typeof args.wipePos === 'number' ? args.wipePos : s.wipePos,
        highlight: typeof args.highlight === 'boolean' ? args.highlight : s.highlight,
        selectedNode: typeof args.selectNode === 'number' ? args.selectNode : s.nodeIndex,
      };
    },
    'color.viewer.thumbnail': () => viewerRef.current?.thumbnail() ?? '',
  }), []);

  // ------------------------------------------------------------------ viewer inputs
  const speed = Math.max(0.05, selectedClip?.speed || 1);
  const sourceIn = selectedClip?.sourceIn ?? 0;
  const inClip = Boolean(selectedClip && playheadPosition >= selectedClip.start && playheadPosition <= selectedClip.end);
  const sourceTime = selectedClip && inClip ? sourceIn + (playheadPosition - selectedClip.start) * speed : sourceIn;
  const viewStack = useMemo(() => {
    if (bypass) return [];
    if (!highlight || !currentNode || !isGradeNode(currentNode)) return stack;
    return stack.slice(0, nodeIndex + 1).map((node, i) => (i === nodeIndex ? { ...node, enabled: true, params: { ...node.params, showMask: true } } : node));
  }, [bypass, currentNode, highlight, nodeIndex, stack]);
  const viewFilters = bypass || highlight ? null : filters;
  const windowOverlay: WindowOverlay = currentIsGrade && centerTab === 'window' && Number(nodeValues.winType) > 0
    ? { type: Number(nodeValues.winType), x: Number(nodeValues.winX), y: Number(nodeValues.winY), sx: Number(nodeValues.winSizeX), sy: Number(nodeValues.winSizeY), rotation: (Number(nodeValues.winRotation) * Math.PI) / 180, softness: Number(nodeValues.winSoftness) }
    : null;
  const viewerMode = picking ? 'pick' : windowOverlay ? 'window' : 'none';

  const getFrame = async (): Promise<string | null> => {
    if (!selectedMedia) return null;
    if (selectedMedia.type === 'image') return selectedMedia.url;
    try { return await extractFrameFromVideo(selectedMedia.url, sourceTime); } catch { return null; }
  };

  const effectDefs = listFxDefinitions().filter((definition) => definition.id !== PRIMARY_GRADE_ID && !definition.native && !definition.temporal);
  const clipNumber = selectedClip ? visualClips.findIndex((clip) => clip.id === selectedClip.id) + 1 : 0;
  const thumb = selectedMedia?.type === 'image' ? selectedMedia.url : null;

  // ------------------------------------------------------------------ render
  const nonGradePanel = currentNode && !isGradeNode(currentNode) ? (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <p className="cp-note">Node {String(nodeIndex + 1).padStart(2, '0')} ist ein Effekt-Node. Seine Parameter:</p>
      <FxStackPanel
        stack={[currentNode]}
        compact
        onChange={(next) => {
          const copy = [...stack];
          copy.splice(nodeIndex, 1, ...next);
          commitStack(copy, Math.min(nodeIndex, Math.max(0, copy.length - 1)));
        }}
      />
    </div>
  ) : null;

  const disabledNote = !selectedClip ? <div className="cp-empty">Wähle unten einen Clip aus.</div> : null;

  const centerPalette = () => {
    if (disabledNote) return disabledNote;
    if (centerTab === 'looks') return <LooksPalette filters={filters} onCommit={commitFilters} onNodePreset={patchNode} canNode={currentIsGrade} />;
    if (centerTab === 'ai') return <AiColoristPalette filters={filters} onCommit={commitFilters} getFrame={getFrame} />;
    if (nonGradePanel) return nonGradePanel;
    switch (centerTab) {
      case 'curves': return <CurvesPalette values={nodeValues} onPatch={patchNode} scopes={scopes} />;
      case 'qualifier': return <QualifierPalette values={nodeValues} onPatch={patchNode} picking={picking} onTogglePick={() => setPicking((v) => !v)} highlight={highlight} onToggleHighlight={() => setHighlight((v) => !v)} />;
      case 'window': return <WindowPalette values={nodeValues} onPatch={patchNode} />;
      case 'blur': return <BlurPalette values={nodeValues} onPatch={patchNode} />;
      case 'key': return <KeyPalette values={nodeValues} onPatch={patchNode} mix={currentNode?.mix ?? 1} onMix={(mix) => { if (currentNode) commitStack(setNodeMix(stack, nodeIndex, mix)); }} />;
      case 'sizing': return <SizingPalette values={nodeValues} onPatch={patchNode} />;
      default: return null;
    }
  };

  const topClass = `cp-top ${showGallery ? '' : 'cp-top--no-gallery'} ${showNodes ? '' : 'cp-top--no-nodes'}`;

  return (
    <div className="studio-workspace cp-root" data-automation-id="color.page">
      <div className="cp-bar">
        {pageTabs}
        {!altContent && (
          <>
            <span className="cp-bar__title" style={{ marginLeft: 8 }}>{selectedMedia?.name ?? 'Kein Clip'}</span>
            <span className="cp-bar__meta">{clipNumber ? `Clip ${String(clipNumber).padStart(2, '0')} · ${stack.length} Node(s)` : ''}{inClip || !selectedClip ? '' : ' · erster Frame'}</span>
          </>
        )}
        <span className="cp-bar__spacer" />
        {!altContent && (
          <>
            <button type="button" className={`cp-btn ${showGallery ? 'cp-btn--on' : ''}`} onClick={() => setShowGallery((v) => !v)} data-automation-id="color.toggle.gallery">Galerie</button>
            <button type="button" className={`cp-btn ${showNodes ? 'cp-btn--on' : ''}`} onClick={() => setShowNodes((v) => !v)} data-automation-id="color.toggle.nodes">Nodes</button>
            <button type="button" className={`cp-btn ${showTimeline ? 'cp-btn--on' : ''}`} onClick={() => setShowTimeline((v) => !v)} data-automation-id="color.toggle.timeline">Timeline</button>
          </>
        )}
        {onSwitchToEdit && <button type="button" className="cp-btn cp-btn--outline" onClick={onSwitchToEdit} data-automation-id="color.openEdit" title="Edit-Seite öffnen">Edit-Seite</button>}
      </div>

      {altContent ? <div className="cp-audio">{altContent}</div> : (
        <>
          <div className={topClass}>
            {showGallery ? (
              <GalleryPanel
                stills={stills}
                canGrab={Boolean(selectedClip)}
                canApply={Boolean(selectedClip)}
                onGrab={grabStill}
                onApply={(still) => applyGrade(still.grade, targetIds(), still.name)}
                onRename={(id, name) => { const next = renameStill(stills, id, name); saveGallery(next); setStills(next); }}
                onRemove={(id) => { const next = removeStill(stills, id); saveGallery(next); setStills(next); }}
              />
            ) : <span />}
            <div className="cp-panel" data-automation-id="color.viewerPanel">
              <div className="cp-panel__head">
                <span className="cp-panel__title">Viewer</span>
                <button type="button" className={`cp-btn ${bypass ? 'cp-btn--on' : ''}`} onClick={() => setBypass((v) => !v)} title="Alle Grades umgehen (⇧D)" data-automation-id="color.viewer.bypass">{bypass ? <EyeOff /> : <Eye />} Bypass</button>
                <button type="button" className={`cp-btn ${wipe ? 'cp-btn--on' : ''}`} onClick={() => setWipe((v) => !v)} title="Split-Screen: Original | Graded" data-automation-id="color.viewer.wipe"><Blend /> Wipe</button>
                <button type="button" className={`cp-btn ${highlight ? 'cp-btn--on' : ''}`} onClick={() => setHighlight((v) => !v)} disabled={!currentIsGrade} title="Key des Nodes als Maske zeigen" data-automation-id="color.viewer.highlight"><KeyRound /> Maske</button>
                <span className="cp-bar__spacer" />
                <button type="button" className="cp-btn" onClick={grabStill} disabled={!selectedClip} title="Still aufnehmen (⌥⌘G)" data-automation-id="color.viewer.grab">Still aufnehmen</button>
              </div>
              <ColorViewer
                ref={viewerRef}
                media={selectedMedia}
                sourceTime={sourceTime}
                isPlaying={isPlaying}
                stack={viewStack}
                legacyFilters={viewFilters}
                wipe={wipe && !bypass}
                wipePos={wipePos}
                onWipePos={setWipePos}
                mode={viewerMode}
                onPick={(rgb) => { patchNode(qualifierFromPick(rgb)); setPicking(false); setToast('Qualifier auf Farbe gesetzt'); }}
                windowOverlay={windowOverlay}
                onWindowMove={(x, y) => patchNode({ winX: Math.round(x * 1000) / 1000, winY: Math.round(y * 1000) / 1000 })}
                onScopes={setScopes}
                label={bypass ? 'Bypass' : highlight ? 'Maske' : `Node ${stack.length ? String(nodeIndex + 1).padStart(2, '0') : '–'}`}
              />
              <div className="cp-viewer__foot">
                <EditTransportBar
                  isPlaying={isPlaying}
                  position={playheadPosition}
                  duration={sequenceDuration}
                  disabled={timelineClips.length === 0}
                  onTogglePlayback={onTogglePlayback}
                  onSeek={(time) => onPlayheadUpdate(Math.max(0, Math.min(sequenceDuration, time)))}
                  onStepFrame={(direction) => onPlayheadUpdate(Math.max(0, Math.min(sequenceDuration, playheadPosition + direction / DEFAULT_TIMELINE_FPS)))}
                  showScrubber={false}
                  automationId="color.transport"
                />
                {toast && <span className="cp-bar__meta" data-automation-id="color.toast">{toast}</span>}
              </div>
            </div>
            {showNodes ? (
              <NodeEditor
                stack={stack}
                selected={nodeIndex}
                thumbnail={thumb}
                effects={effectDefs}
                disabled={!selectedClip}
                onSelect={setSelectedNode}
                onAddSerial={addSerial}
                onAddEffect={addEffectNode}
                onRemove={(index) => commitStack(removeNode(stack, index), Math.max(0, index - 1))}
                onMove={(from, to) => commitStack(moveNode(stack, from, to), to)}
                onToggle={(index) => commitStack(toggleNode(stack, index))}
                onReset={(index) => commitStack(resetNode(stack, index))}
                onLabel={(index, label) => commitStack(setNodeLabel(stack, index, label))}
              />
            ) : <span />}
          </div>

          <ClipStripPro
            clips={timelineClips}
            tracks={timelineTracks}
            mediaItems={mediaItems}
            selectedClipId={props.selectedClipId}
            marked={marked}
            playheadPosition={playheadPosition}
            duration={sequenceDuration}
            onSelect={(clip, additive) => {
              if (additive) {
                setMarked((prev) => { const next = new Set(prev); if (next.has(clip.id)) next.delete(clip.id); else next.add(clip.id); return next; });
                return;
              }
              setMarked(new Set());
              onSelectClip(clip.id);
              if (playheadPosition < clip.start || playheadPosition >= clip.end) onPlayheadUpdate(clip.start + 1 / DEFAULT_TIMELINE_FPS);
            }}
            onApplyCurrentGrade={(clip) => { if (selectedClip && clip.id !== selectedClip.id) applyGrade(extractGrade(selectedClip), [clip.id], 'Grade angewendet'); }}
            onContextMenu={(clip, x, y) => setMenu({ clip, x, y })}
            onSeek={(time) => onPlayheadUpdate(Math.max(0, Math.min(sequenceDuration, time)))}
          />
          {menu && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onPointerDown={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null); }}>
              <div className="cp-panel" style={{ position: 'fixed', left: menu.x, top: Math.max(8, menu.y - 150), minWidth: 190, padding: 4, boxShadow: '0 8px 24px rgb(0 0 0 / 0.5)', border: '1px solid var(--cp-line-strong)' }} onPointerDown={(event) => event.stopPropagation()}>
                {[
                  { id: 'copy', label: 'Grade kopieren (⌘C)', run: () => { setClipboard(extractGrade(menu.clip)); setToast('Grade kopiert'); } },
                  { id: 'paste', label: 'Grade einfügen (⌘V)', disabled: !clipboard, run: () => clipboard && applyGrade(clipboard, [menu.clip.id], 'Grade eingefügt') },
                  { id: 'applyCurrent', label: 'Aktuellen Grade anwenden', disabled: !selectedClip || selectedClip.id === menu.clip.id, run: () => selectedClip && applyGrade(extractGrade(selectedClip), [menu.clip.id], 'Grade angewendet') },
                  { id: 'still', label: 'Still aufnehmen', run: () => { const next = createStill(loadGallery(), extractGrade(menu.clip), '', { sourceClipName: mediaItems.find((m) => m.id === menu.clip.mediaId)?.name }); saveGallery(next); setStills(next); setToast(`${next[0].name} aufgenommen`); } },
                  { id: 'reset', label: 'Grade zurücksetzen', run: () => onBatchUpdateClips(timelineClips.map((clip) => (clip.id === menu.clip.id ? { ...clip, fxStack: (clip.fxStack ?? []).filter((node) => !isGradeNode(node)) } : clip))) },
                ].map((item) => (
                  <button key={item.id} type="button" className="cp-btn" style={{ width: '100%', justifyContent: 'flex-start' }} disabled={item.disabled} data-automation-id={`color.clips.menu.${item.id}`} onClick={() => { item.run(); setMenu(null); }}>{item.label}</button>
                ))}
              </div>
            </div>
          )}

          {showTimeline && (
            <div className="cp-timeline edit-timeline-surface">
              <Timeline
                tracks={timelineTracks} clips={timelineClips} mediaItems={mediaItems} selectedClipId={props.selectedClipId}
                activeTrackId={props.activeTrackId} playheadPosition={playheadPosition}
                isSnappingEnabled={props.isSnappingEnabled} trimMode={props.trimMode} onTrimModeChange={props.onTrimModeChange}
                waveformCache={props.waveformCache}
                onSelectClip={onSelectClip} onSetActiveTrack={props.onSetActiveTrack}
                onUpdateClip={onUpdateClip} onBatchUpdateClips={onBatchUpdateClips}
                onPlayheadUpdate={onPlayheadUpdate} onSnappingToggle={props.onSnappingToggle} onSplitClip={props.onSplitClip}
                onAddTrack={props.onAddTrack} onUpdateTrack={props.onUpdateTrack}
                onDropMedia={props.onDropMedia} onDropLibraryAsset={props.onDropLibraryAsset}
                onDeleteClip={props.onDeleteClip} onRippleDeleteClip={props.onRippleDeleteClip}
              />
            </div>
          )}

          <div className="cp-bottom">
            <div className="cp-tabs" role="tablist" aria-label="Paletten">
              <div className="cp-tabs__group">
                {PRIMARY_TABS.map((tab) => (
                  <button key={tab.id} type="button" role="tab" aria-selected={primaryMode === tab.id} className={`cp-tab ${primaryMode === tab.id ? 'cp-tab--active' : ''}`} onClick={() => setPrimaryMode(tab.id)} data-automation-id={`color.palette.primaries.${tab.id}`} title={`Primaries – ${tab.label}`}>{tab.icon}{tab.label}</button>
                ))}
              </div>
              <span className="cp-tabs__spacer" />
              <div className="cp-tabs__group">
                {CENTER_TABS.map((tab) => (
                  <button key={tab.id} type="button" role="tab" aria-selected={centerTab === tab.id} className={`cp-tab ${centerTab === tab.id ? 'cp-tab--active' : ''}`} onClick={() => setCenterTab(tab.id)} data-automation-id={`color.palette.${tab.id}`} title={tab.label}>{tab.icon}{tab.label}</button>
                ))}
              </div>
              <span className="cp-tabs__spacer" />
              <div className="cp-tabs__group">
                {(Object.keys(SCOPE_LABELS) as ScopeMode[]).map((mode) => (
                  <button key={mode} type="button" role="tab" aria-selected={scopeMode === mode} className={`cp-tab ${scopeMode === mode ? 'cp-tab--active' : ''}`} onClick={() => setScopeMode(mode)} data-automation-id={`color.scopes.${mode}`} title={SCOPE_LABELS[mode]}>{mode === 'vectorscope' ? <Palette /> : <Activity />}{SCOPE_LABELS[mode]}</button>
                ))}
              </div>
            </div>
            <div className="cp-palettes">
              <div className="cp-panel" data-automation-id="color.palette.primaries">
                <div className="cp-panel__head">
                  <span className="cp-panel__title">Primaries – {PRIMARY_TABS.find((t) => t.id === primaryMode)?.label}</span>
                  <span className="cp-bar__spacer" />
                  <button type="button" className="cp-btn" disabled={!selectedClip || !currentIsGrade} onClick={() => currentNode ? commitStack(resetNode(stack, nodeIndex)) : undefined} data-automation-id="color.primaries.resetNode" title="Node zurücksetzen">Node zurücksetzen</button>
                </div>
                <div className="cp-panel__body">{disabledNote ?? (nonGradePanel ? <p className="cp-note">Effekt-Node – die Parameter stehen in der mittleren Palette. Primaries gelten nur für Farb-Nodes.</p> : null) ?? <PrimariesPalette values={nodeValues} onPatch={patchNode} mode={primaryMode} />}</div>
              </div>
              <div className="cp-panel" data-automation-id="color.palette.center">
                <div className="cp-panel__head">
                  <span className="cp-panel__title">{CENTER_TABS.find((t) => t.id === centerTab)?.label}</span>
                  <span className="cp-bar__spacer" />
                  <button type="button" className="cp-btn" onClick={copyGrade} disabled={!selectedClip} data-automation-id="color.grade.copy" title="Grade kopieren (⌘C)">Kopieren</button>
                  <button type="button" className="cp-btn" onClick={pasteGrade} disabled={!clipboard || !selectedClip} data-automation-id="color.grade.paste" title="Grade einfügen (⌘V)">Einfügen</button>
                  <button type="button" className="cp-btn" onClick={applyToAll} disabled={!selectedClip} data-automation-id="color.grade.applyAll" title="Grade auf alle Clips anwenden">Auf alle</button>
                </div>
                <div className="cp-panel__body">{centerPalette()}</div>
              </div>
              <div className="cp-panel" data-automation-id="color.palette.scopes">
                <div className="cp-panel__head">
                  <span className="cp-panel__title">Scopes – {SCOPE_LABELS[scopeMode]}</span>
                </div>
                <ScopeCanvas mode={scopeMode} data={scopes} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ColorPage;
