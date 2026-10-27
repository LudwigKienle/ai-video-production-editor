/**
 * Fusion-page shell: owns the compositions of the project (localStorage per
 * project, mirrored for MCP), the active comp with undo history, time,
 * playback, selection and the view switch Fusion | After Effects | Nuke.
 * All three views edit the same Composition; switching keeps selection and
 * time.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clapperboard, FilePlus2, Redo2, Undo2, Wrench, Trash2, Copy, Film } from 'lucide-react';
import type { MediaItem } from '../../types';
import type { Composition } from '../fusion-shared/compModel';
import { getNode } from '../fusion-shared/compModel';
import { clampTime, createCompFromMedia, createEmptyComp, getRenderRange, setRenderRange, type CompositionExt, type CompRange } from '../fusion-shared/compModelExt';
import { loadStore, newerStore, saveStore, storageKeyFor, storeFromUnknown, upsertComp, type CompStore } from '../fusion-shared/compPersist';
import { createHistory, pushHistory, redoHistory, undoHistory, type History } from '../fusion-shared/compHistory';
import { ensureCompFx } from '../fusion-shared/compFx';
import { renderComposition } from '../fusion-shared/renderComp';
import type { FusionViewId, FusionViewProps } from '../fusion-shared/viewProps';
import { registerLiveCommands } from '../../mcp/liveCommands';
import { useMediaResolver, createExportMedia } from './mediaResolver';
import { renderCompToMedia } from './renderToMedia';
import FusionView from './FusionView';
import NukeView from '../fusion-nuke/NukeView';
import { isTypingTarget } from './keys';
import './fusionPro.css';

const AfterEffectsView = React.lazy(() => import('../fusion-ae/AfterEffectsView'));

class ViewBoundary extends React.Component<{ children: React.ReactNode; label: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  componentDidCatch(error: unknown) {
    console.warn('[fusion] view crashed', error);
  }
  render() {
    if (this.state.error)
      return (
        <div className="fsh-empty">
          <strong>{this.props.label} konnte nicht angezeigt werden.</strong>
          <small>{this.state.error}</small>
          <button type="button" className="fsh-btn" onClick={() => this.setState({ error: null })} data-automation-id="fusion-view-retry">
            Erneut versuchen
          </button>
        </div>
      );
    return this.props.children;
  }
}

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const VIEWS: { id: FusionViewId; label: string }[] = [
  { id: 'fusion', label: 'Fusion' },
  { id: 'ae', label: 'After Effects' },
  { id: 'nuke', label: 'Nuke' },
];

export type CompShellProps = {
  mediaItems: MediaItem[];
  currentProjectPath?: string | null;
  onAddGeneratedMedia(item: MediaItem): void;
  onAddToTimeline?(item: MediaItem): void;
  /** Media and length of the selected timeline clip ("Neue Komposition aus Clip"). */
  clipMedia: MediaItem | null;
  clipDuration: number | null;
  onOpenTools(): void;
  /** Project copy of the store (`extras.compositions`); the newer of it and localStorage wins on load. */
  extrasStore?: unknown;
  /** Mirrors every saved store into the project extras (MCP + project file). */
  onStoreChange?(store: CompStore): void;
};

const CompShell: React.FC<CompShellProps> = ({ mediaItems, currentProjectPath, onAddGeneratedMedia, onAddToTimeline, clipMedia, clipDuration, onOpenTools, extrasStore, onStoreChange }) => {
  useEffect(() => ensureCompFx(), []);
  const storageKey = storageKeyFor(currentProjectPath);
  const extrasRef = useRef(extrasStore);
  extrasRef.current = extrasStore;
  const onStoreChangeRef = useRef(onStoreChange);
  onStoreChangeRef.current = onStoreChange;
  const initialStore = (key: string): CompStore => {
    const local = loadStore(storage(), key);
    return newerStore(storeFromUnknown(extrasRef.current), local.comps.length || local.savedAt ? local : null);
  };
  const [store, setStore] = useState<CompStore>(() => initialStore(storageKey));
  const [hist, setHist] = useState<History<CompositionExt> | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [rendering, setRendering] = useState<{ frame: number; frameCount: number } | null>(null);
  const [lastRender, setLastRender] = useState<MediaItem | null>(null);
  const [mediaPick, setMediaPick] = useState('');
  const storeRef = useRef(store);
  storeRef.current = store;

  // Reload when the project changes.
  const loadedKey = useRef(storageKey);
  useEffect(() => {
    if (loadedKey.current === storageKey) return;
    loadedKey.current = storageKey;
    setStore(initialStore(storageKey));
    setSelection([]);
    setTime(0);
  }, [storageKey]);

  // Persist (debounced).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = { ...store, savedAt: store.savedAt ?? Date.now() };
      saveStore(storage(), storageKey, saved);
      if (saved.comps.length || store.savedAt) onStoreChangeRef.current?.(saved);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [store, storageKey]);

  const comp = store.comps.find((entry) => entry.id === store.activeId) ?? null;
  const fps = comp?.fps ?? 24;
  const { resolveMedia } = useMediaResolver(mediaItems, fps);

  // History follows the active comp.
  const activeId = comp?.id ?? null;
  useEffect(() => {
    setHist(comp ? createHistory(comp) : null);
    // Start with MediaIn selected so the first tool goes into the clip's pipe.
    const mediaIn = comp?.nodes.find((node) => node.type === 'media');
    setSelection(mediaIn ? [mediaIn.id] : []);
    setPlaying(false);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stamp = (next: CompStore): CompStore => ({ ...next, savedAt: Date.now() });

  const handleChange = useCallback(
    (next: Composition) => {
      const ext = next as CompositionExt;
      setHist((prev) => pushHistory(prev ?? createHistory(ext), ext, { key: 'edit', windowMs: 350 }));
      setStore((prev) => stamp({ ...prev, comps: upsertComp(prev.comps, ext) }));
    },
    [],
  );

  const undo = useCallback(() => {
    setHist((prev) => {
      if (!prev || !prev.past.length) return prev;
      const next = undoHistory(prev);
      setStore((s) => stamp({ ...s, comps: upsertComp(s.comps, next.present) }));
      return next;
    });
  }, []);
  const redo = useCallback(() => {
    setHist((prev) => {
      if (!prev || !prev.future.length) return prev;
      const next = redoHistory(prev);
      setStore((s) => stamp({ ...s, comps: upsertComp(s.comps, next.present) }));
      return next;
    });
  }, []);

  // ------------------------------------------------------------ comp management
  const addComp = useCallback((next: CompositionExt) => {
    setStore((prev) => stamp({ ...prev, comps: [...prev.comps, next], activeId: next.id }));
    setTime(0);
    setStatus(`Komposition „${next.name}“ angelegt.`);
  }, []);
  const newFromClip = useCallback(() => {
    if (!clipMedia) {
      setStatus('Kein Clip ausgewählt – wähle einen Clip in der Timeline oder ein Medium.');
      return;
    }
    addComp(createCompFromMedia(clipMedia, { durationSeconds: clipDuration ?? undefined }));
  }, [clipMedia, clipDuration, addComp]);
  const newFromMedia = useCallback(
    (id: string) => {
      const item = mediaItems.find((entry) => entry.id === id);
      if (item) addComp(createCompFromMedia(item));
    },
    [mediaItems, addComp],
  );
  const newEmpty = useCallback(() => addComp(createEmptyComp(`Komposition ${storeRef.current.comps.length + 1}`)), [addComp]);
  const duplicateComp = useCallback(() => {
    if (!comp) return;
    const copy: CompositionExt = { ...JSON.parse(JSON.stringify(comp)), id: `comp-${Date.now().toString(36)}`, name: `${comp.name} Kopie` };
    addComp(copy);
  }, [comp, addComp]);
  const deleteComp = useCallback(() => {
    if (!comp) return;
    if (typeof window !== 'undefined' && !window.confirm(`Komposition „${comp.name}“ löschen?`)) return;
    setStore((prev) => {
      const comps = prev.comps.filter((entry) => entry.id !== comp.id);
      return stamp({ ...prev, comps, activeId: comps[0]?.id ?? null });
    });
  }, [comp]);
  const setView = useCallback((view: FusionViewId) => setStore((prev) => stamp({ ...prev, view })), []);
  const selectComp = useCallback((id: string) => setStore((prev) => stamp({ ...prev, activeId: id })), []);

  // ------------------------------------------------------------ time & playback
  const onTimeChange = useCallback((t: number) => setTime(comp ? clampTime(comp, t) : 0), [comp]);
  useEffect(() => {
    if (!playing || !comp) return;
    let frame = 0;
    let last = performance.now();
    const range = getRenderRange(comp);
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      setTime((prev) => {
        const next = prev + dt;
        return next > range.end + 1e-6 || next < range.start - 1e-6 ? range.start : next;
      });
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, comp]);
  const snappedTime = comp ? Math.round(time * comp.fps) / comp.fps : 0;

  // ------------------------------------------------------------ rendering
  const renderToMedia = useCallback(
    async (target: CompositionExt | null = comp, range?: CompRange, addToTimeline = false) => {
      if (!target) throw new Error('Keine Komposition aktiv.');
      setRendering({ frame: 0, frameCount: 1 });
      setStatus('Rendere …');
      try {
        const item = await renderCompToMedia(target, {
          mediaItems,
          projectPath: currentProjectPath,
          range: range ?? getRenderRange(target),
          time: snappedTime,
          onProgress: (progress) => setRendering({ frame: progress.frame, frameCount: progress.frameCount }),
        });
        onAddGeneratedMedia(item);
        if (addToTimeline) onAddToTimeline?.(item);
        setLastRender(item);
        setStatus(item.type === 'video' ? `Video „${item.name}“ im Medienpool.` : `Standbild „${item.name}“ im Medienpool${window.electron?.fx ? '' : ' (Browser: nur PNG)'}.`);
        return item;
      } catch (error) {
        setStatus(`Render fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      } finally {
        setRendering(null);
      }
    },
    [comp, mediaItems, currentProjectPath, snappedTime, onAddGeneratedMedia, onAddToTimeline],
  );

  const renderFrame = useCallback(
    async (target: CompositionExt, t: number, nodeId?: string) => {
      const media = await createExportMedia(target, mediaItems);
      try {
        await media.prepare(t);
        const canvas = renderComposition(target, t, media.resolve, { nodeId: nodeId ?? undefined });
        const id = `fusion-frame-${target.id}-${Date.now().toString(36)}`;
        let url = canvas.toDataURL('image/png');
        const bridge = window.electron?.fx;
        if (bridge && currentProjectPath) {
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (blob) {
            const saved = await bridge.bakeImage({ folderPath: currentProjectPath, name: id, bytes: new Uint8Array(await blob.arrayBuffer()) });
            if (saved.ok && saved.url) url = saved.url;
          }
        }
        const item: MediaItem = { id, name: `${target.name} – Frame ${Math.round(t * target.fps)}`, type: 'image', url, source: 'generated', generatedBy: 'Fusion' };
        onAddGeneratedMedia(item);
        return item;
      } finally {
        media.dispose();
      }
    },
    [mediaItems, currentProjectPath, onAddGeneratedMedia],
  );

  // ------------------------------------------------------------ MCP live commands
  const live = useRef({ renderToMedia, renderFrame, onAddToTimeline, time: snappedTime });
  live.current = { renderToMedia, renderFrame, onAddToTimeline, time: snappedTime };
  useEffect(
    () =>
      registerLiveCommands({
        'fusion.store.get': () => storeRef.current,
        'fusion.store.set': (args) => {
          const next = storeFromUnknown(args.store);
          if (!next) throw new Error('Ungültige Kompositionsdaten.');
          setStore(next);
          setHist(null);
          const active = next.comps.find((entry) => entry.id === next.activeId);
          if (active) setHist(createHistory(active));
          return { ok: true };
        },
        'fusion.render.frame': async (args) => {
          const s = storeRef.current;
          const target = s.comps.find((entry) => entry.id === (args.compId ?? s.activeId) || entry.name === args.compId);
          if (!target) throw new Error('Komposition nicht gefunden.');
          const t = typeof args.time === 'number' && Number.isFinite(args.time) ? clampTime(target, args.time) : live.current.time;
          const nodeId = typeof args.nodeId === 'string' ? target.nodes.find((node) => node.id === args.nodeId || node.name === args.nodeId)?.id : undefined;
          if (typeof args.nodeId === 'string' && !nodeId) throw new Error(`Knoten ${args.nodeId} nicht gefunden.`);
          const item = await live.current.renderFrame(target, t, nodeId);
          if (args.addToTimeline) live.current.onAddToTimeline?.(item);
          return { mediaId: item.id, name: item.name, type: item.type, time: t };
        },
        'fusion.render.media': async (args) => {
          const s = storeRef.current;
          const target = s.comps.find((entry) => entry.id === (args.compId ?? s.activeId) || entry.name === args.compId);
          if (!target) throw new Error('Komposition nicht gefunden.');
          const base = getRenderRange(target);
          const range = getRenderRange(setRenderRange(target, { start: typeof args.renderStart === 'number' ? args.renderStart : base.start, end: typeof args.renderEnd === 'number' ? args.renderEnd : base.end }));
          const item = await live.current.renderToMedia(target, range, Boolean(args.addToTimeline));
          return { mediaId: item.id, name: item.name, type: item.type, duration: item.duration ?? null };
        },
      }),
    [],
  );

  // ------------------------------------------------------------ shell shortcuts (capture: before App's timeline keys)
  const keyState = useRef({ undo, redo, comp, setPlaying, view: store.view });
  keyState.current = { undo, redo, comp, setPlaying, view: store.view };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const k = keyState.current;
      if (!k.comp) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      let handled = true;
      if (mod && key === 'z' && event.shiftKey) k.redo();
      else if (mod && key === 'z') k.undo();
      else if (mod && key === 'y' && k.view !== 'ae') k.redo(); // AE: ⌘Y = New › Solid
      else if (!mod && !event.shiftKey && event.code === 'Space') k.setPlaying((value) => !value);
      else if (!mod && (key === '1' || key === '2')) handled = true; // views use 1/2 for viewers; keep App from switching pages
      else handled = false;
      if (handled) {
        event.stopPropagation();
        if (mod || event.code === 'Space') event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const viewProps: FusionViewProps | null = comp
    ? {
        comp,
        onChange: handleChange,
        time: snappedTime,
        onTimeChange,
        mediaItems,
        resolveMedia,
        selectedNodeIds: selection.filter((id) => getNode(comp, id)),
        onSelect: setSelection,
        onAddToTimeline,
        onRenderToMedia: () => void renderToMedia().catch(() => undefined),
        renderRange: getRenderRange(comp),
        onRenderRangeChange: (range) => handleChange(setRenderRange(comp, range)),
        playing,
        onPlayingChange: setPlaying,
      }
    : null;

  const visualMedia = useMemo(() => mediaItems.filter((item) => item.type !== 'audio'), [mediaItems]);

  return (
    <div className="fsh-root" data-automation-id="fusion-shell">
      <div className="fsh-bar">
        <div className="fsh-group">
          <Clapperboard size={15} />
          <select className="fsh-select" value={comp?.id ?? ''} onChange={(event) => selectComp(event.target.value)} disabled={!store.comps.length} data-automation-id="fusion-comp-select" title="Aktive Komposition">
            {!store.comps.length && <option value="">Keine Komposition</option>}
            {store.comps.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <button type="button" className="fsh-btn" onClick={newFromClip} disabled={!clipMedia} title={clipMedia ? `Neue Komposition aus „${clipMedia.name}“` : 'Erst einen Clip in der Timeline auswählen'} data-automation-id="fusion-comp-new-from-clip">
            <Film size={13} /> Neue Komposition aus Clip
          </button>
          <select
            className="fsh-select"
            value={mediaPick}
            onChange={(event) => {
              setMediaPick('');
              if (event.target.value) newFromMedia(event.target.value);
            }}
            data-automation-id="fusion-comp-new-from-media"
            title="Neue Komposition aus einem Medium"
          >
            <option value="">Aus Medium …</option>
            {visualMedia.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button type="button" className="fsh-btn" onClick={newEmpty} title="Leere Komposition" data-automation-id="fusion-comp-new-empty">
            <FilePlus2 size={13} />
          </button>
          <button type="button" className="fsh-btn" onClick={duplicateComp} disabled={!comp} title="Komposition duplizieren" data-automation-id="fusion-comp-duplicate">
            <Copy size={13} />
          </button>
          <button type="button" className="fsh-btn" onClick={deleteComp} disabled={!comp} title="Komposition löschen" data-automation-id="fusion-comp-delete">
            <Trash2 size={13} />
          </button>
        </div>
        <div className="fsh-views" role="tablist" aria-label="Ansicht">
          {VIEWS.map((view) => (
            <button key={view.id} type="button" role="tab" aria-selected={store.view === view.id} className={`fsh-view ${store.view === view.id ? 'fsh-view--on' : ''}`} onClick={() => setView(view.id)} data-automation-id={`fusion-view-${view.id}`}>
              {view.label}
            </button>
          ))}
        </div>
        <div className="fsh-group fsh-group--end">
          <button type="button" className="fsh-btn" onClick={undo} disabled={!hist?.past.length} title="Rückgängig (⌘/Ctrl+Z)" data-automation-id="fusion-undo">
            <Undo2 size={13} />
          </button>
          <button type="button" className="fsh-btn" onClick={redo} disabled={!hist?.future.length} title="Wiederholen (⌘/Ctrl+Shift+Z)" data-automation-id="fusion-redo">
            <Redo2 size={13} />
          </button>
          <button type="button" className="fsh-btn fsh-btn--primary" onClick={() => void renderToMedia().catch(() => undefined)} disabled={!comp || Boolean(rendering)} title="Render-Bereich als Video (Desktop) bzw. PNG in den Medienpool" data-automation-id="fusion-render-to-media">
            {rendering ? `Rendere ${rendering.frame}/${rendering.frameCount}` : 'Rendern → Medien'}
          </button>
          {lastRender && onAddToTimeline && (
            <button type="button" className="fsh-btn" onClick={() => onAddToTimeline(lastRender)} title="Letzten Render an der Abspielposition einfügen" data-automation-id="fusion-add-render-to-timeline">
              In Timeline
            </button>
          )}
          <button type="button" className="fsh-btn" onClick={onOpenTools} title="KI-Werkzeuge (Keyer, Relight, Pose, Reframe, Kling, Merge-Tool, Node Studio, Natron/Nuke-Export)" data-automation-id="fusion-open-tools">
            <Wrench size={13} /> Werkzeuge
          </button>
        </div>
      </div>
      {status && (
        <div className="fsh-status" role="status" data-automation-id="fusion-status">
          {status}
          <button type="button" onClick={() => setStatus(null)} aria-label="Meldung schließen">
            ×
          </button>
        </div>
      )}
      <div className="fsh-body">
        {!viewProps ? (
          <div className="fsh-empty" data-automation-id="fusion-empty">
            <strong>Noch keine Komposition</strong>
            <small>Eine Komposition ist ein Knotengraph – dieselbe Komposition lässt sich als Fusion-, After-Effects- oder Nuke-Ansicht bearbeiten.</small>
            <div className="fsh-empty__actions">
              <button type="button" className="fsh-btn fsh-btn--primary" onClick={newFromClip} disabled={!clipMedia} data-automation-id="fusion-empty-from-clip">
                Neue Komposition aus Clip{clipMedia ? ` („${clipMedia.name}“)` : ''}
              </button>
              <button type="button" className="fsh-btn" onClick={newEmpty} data-automation-id="fusion-empty-new">
                Leere Komposition
              </button>
            </div>
            {visualMedia.length > 0 && (
              <div className="fsh-empty__media">
                {visualMedia.slice(0, 12).map((item) => (
                  <button key={item.id} type="button" className="fsh-media" onClick={() => newFromMedia(item.id)} title={`Neue Komposition aus „${item.name}“`} data-automation-id={`fusion-empty-media-${item.id}`}>
                    {item.type === 'image' ? <img src={item.url} alt="" draggable={false} /> : <video src={item.url} muted preload="metadata" />}
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : store.view === 'ae' ? (
          <ViewBoundary key={`ae-${comp!.id}`} label="After-Effects-Ansicht">
            <Suspense fallback={<div className="fsh-empty">After-Effects-Ansicht wird geladen …</div>}>
              <AfterEffectsView {...viewProps} />
            </Suspense>
          </ViewBoundary>
        ) : store.view === 'nuke' ? (
          <ViewBoundary key={`nuke-${comp!.id}`} label="Nuke-Ansicht">
            <NukeView {...viewProps} />
          </ViewBoundary>
        ) : (
          <ViewBoundary key={`fusion-${comp!.id}`} label="Fusion-Ansicht">
            <FusionView {...viewProps} />
          </ViewBoundary>
        )}
      </div>
    </div>
  );
};

export default CompShell;
