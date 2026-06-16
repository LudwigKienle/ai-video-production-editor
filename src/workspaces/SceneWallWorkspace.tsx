import React, { useMemo, useRef, useState } from 'react';
import {
  ReferenceItem,
  SceneWallSceneCard,
  SceneWallShotCard,
  SceneWallState,
  ShotPrompt,
  StoryBible,
} from '../types';
import {
  createDefaultSceneWallState,
  createSceneWallSceneCard,
  createSceneWallShotCard,
  generateSceneWallVfxCodes,
  normalizeSceneWallState,
  sanitizeVfxPrefix,
  syncSceneWallWithProjectContext,
} from '../data/sceneWallTypes';

interface SceneWallWorkspaceProps {
  sceneWall: SceneWallState | null;
  onChange: (next: SceneWallState) => void;
  storyBible: StoryBible;
  shotPrompts?: ShotPrompt[];
  references?: ReferenceItem[];
  onOpenSceneInStoryboard?: (sceneId: string) => void;
}

const PARKED_KEY = '__parked__';

const SceneWallWorkspace: React.FC<SceneWallWorkspaceProps> = ({
  sceneWall,
  onChange,
  storyBible,
  shotPrompts = [],
  references = [],
  onOpenSceneInStoryboard,
}) => {
  const state = useMemo(() => normalizeSceneWallState(sceneWall), [sceneWall]);
  const referenceById = useMemo(
    () => new Map(references.map((reference) => [reference.id, reference])),
    [references],
  );
  const selectedScene =
    state.scenes.find((scene) => scene.id === state.selectedSceneId) ||
    state.scenes.find((scene) => !scene.parked) ||
    state.scenes[0] ||
    null;

  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scriptStatus, setScriptStatus] = useState<string>('');
  const sceneImageInputRef = useRef<HTMLInputElement>(null);
  const shotImageInputRef = useRef<HTMLInputElement>(null);
  const [pendingShotImageTargetId, setPendingShotImageTargetId] = useState<string | null>(null);

  const normalizeAndUpdate = (patch: Partial<SceneWallState>) => {
    onChange({
      ...state,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  };

  const reelOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    [...state.reels]
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .forEach((reel, index) => {
        map.set(reel.id, Number.isFinite(reel.index) ? reel.index : index + 1);
      });
    return map;
  }, [state.reels]);

  const sortedScenes = useMemo(() => {
    return [...state.scenes].sort((a, b) => {
      if (a.parked !== b.parked) return a.parked ? 1 : -1;
      if ((a.reelId || '') !== (b.reelId || '')) {
        const aReelOrder = reelOrderMap.get(a.reelId || '') ?? Number.MAX_SAFE_INTEGER;
        const bReelOrder = reelOrderMap.get(b.reelId || '') ?? Number.MAX_SAFE_INTEGER;
        if (aReelOrder !== bReelOrder) return aReelOrder - bReelOrder;
        return (a.reelId || '').localeCompare(b.reelId || '');
      }
      if (a.order !== b.order) return a.order - b.order;
      return a.sceneNumber - b.sceneNumber;
    });
  }, [reelOrderMap, state.scenes]);

  const filteredSceneIds = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return new Set(state.scenes.map((scene) => scene.id));
    return new Set(
      state.scenes
        .filter((scene) => {
          return (
            scene.slugline.toLowerCase().includes(query) ||
            scene.sceneCode.toLowerCase().includes(query) ||
            String(scene.sceneNumber).includes(query) ||
            (scene.vfxLabel || '').toLowerCase().includes(query)
          );
        })
        .map((scene) => scene.id),
    );
  }, [search, state.scenes]);

  const activeScenesByReel = useMemo(() => {
    const map = new Map<string, SceneWallSceneCard[]>();
    state.reels.forEach((reel) => map.set(reel.id, []));
    sortedScenes.forEach((scene) => {
      if (scene.parked || !scene.reelId || !map.has(scene.reelId)) return;
      if (!filteredSceneIds.has(scene.id)) return;
      map.get(scene.reelId)?.push(scene);
    });
    return map;
  }, [filteredSceneIds, sortedScenes, state.reels]);

  const orderedReels = useMemo(
    () => [...state.reels].sort((a, b) => (a.index || 0) - (b.index || 0)),
    [state.reels],
  );

  const parkedScenes = useMemo(() => {
    return sortedScenes.filter((scene) => scene.parked && filteredSceneIds.has(scene.id));
  }, [filteredSceneIds, sortedScenes]);

  const rebalanceOrders = (scenes: SceneWallSceneCard[]) => {
    const groups = new Map<string, SceneWallSceneCard[]>();

    scenes.forEach((scene) => {
      const key = scene.parked ? PARKED_KEY : scene.reelId || '__unassigned__';
      const list = groups.get(key) || [];
      list.push({ ...scene });
      groups.set(key, list);
    });

    const next: SceneWallSceneCard[] = [];
    groups.forEach((groupScenes) => {
      groupScenes
        .sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.sceneNumber - b.sceneNumber;
        })
        .forEach((scene, index) => {
          next.push({ ...scene, order: index + 1 });
        });
    });

    return next;
  };

  const updateScene = (sceneId: string, patch: Partial<SceneWallSceneCard>) => {
    const nextScenes = state.scenes.map((scene) =>
      scene.id === sceneId
        ? {
            ...scene,
            ...patch,
          }
        : scene,
    );
    normalizeAndUpdate({ scenes: rebalanceOrders(nextScenes) });
  };

  const removeScene = (sceneId: string) => {
    const nextScenes = state.scenes.filter((scene) => scene.id !== sceneId);
    const nextSelected = selectedScene?.id === sceneId ? nextScenes[0]?.id : state.selectedSceneId;
    normalizeAndUpdate({
      scenes: rebalanceOrders(nextScenes),
      selectedSceneId: nextSelected,
    });
  };

  const duplicateScene = (sceneId: string) => {
    const source = state.scenes.find((scene) => scene.id === sceneId);
    if (!source) return;
    const nextSceneNumber = state.scenes.reduce((max, scene) => Math.max(max, scene.sceneNumber), 0) + 1;
    const siblings = state.scenes
      .filter((scene) => scene.reelId === source.reelId && scene.parked === source.parked)
      .sort((a, b) => a.order - b.order);
    const sourceIndex = siblings.findIndex((scene) => scene.id === source.id);
    const order = sourceIndex >= 0 ? siblings[sourceIndex].order + 0.5 : siblings.length + 1;

    const clone = createSceneWallSceneCard(nextSceneNumber, source.reelId, {
      order,
      slugline: source.slugline,
      imageUrl: source.imageUrl,
      notes: source.notes,
      vfxLabel: source.vfxLabel,
      linkedShotNumbers: [...(source.linkedShotNumbers || [])],
      shotCards: source.shotCards.map((shot) => ({ ...shot, id: `${shot.id}-copy-${Date.now()}` })),
      parked: source.parked,
      originalReelId: source.originalReelId,
    });

    const nextScenes = rebalanceOrders([...state.scenes, clone]);
    normalizeAndUpdate({ scenes: nextScenes, selectedSceneId: clone.id });
  };

  const addScene = (reelId?: string) => {
    const nextSceneNumber = state.scenes.reduce((max, scene) => Math.max(max, scene.sceneNumber), 0) + 1;
    const targetReelId = reelId || orderedReels[0]?.id;
    const order =
      state.scenes
        .filter((scene) => !scene.parked && scene.reelId === targetReelId)
        .reduce((max, scene) => Math.max(max, scene.order), 0) + 1;

    const nextScene = createSceneWallSceneCard(nextSceneNumber, targetReelId, {
      order,
      slugline: `INT. NEW SCENE ${nextSceneNumber} - DAY`,
    });

    const nextScenes = rebalanceOrders([...state.scenes, nextScene]);
    normalizeAndUpdate({ scenes: nextScenes, selectedSceneId: nextScene.id });
  };

  const addReel = () => {
    const orderedReels = [...state.reels].sort((a, b) => (a.index || 0) - (b.index || 0));
    const nextIndex = orderedReels.length + 1;
    const lastRangeEnd = orderedReels.reduce((max, reel) => Math.max(max, reel.sceneRange?.end || 0), 0);
    const start = lastRangeEnd + 1;
    const end = start + 19;
    const nextReel = {
      id: `reel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `Reel ${nextIndex}`,
      index: nextIndex,
      sceneRange: { start, end },
      color: ['#1d4ed8', '#0f766e', '#6d28d9', '#9f1239', '#854d0e', '#155e75'][(nextIndex - 1) % 6],
    };
    normalizeAndUpdate({ reels: [...orderedReels, nextReel] });
    setScriptStatus(`${nextReel.name} hinzugefügt.`);
  };

  const updateReel = (reelId: string, patch: Partial<SceneWallState['reels'][number]>) => {
    const nextReels = state.reels.map((reel) => (reel.id === reelId ? { ...reel, ...patch } : reel));
    normalizeAndUpdate({ reels: nextReels });
  };

  const renumberByBoardOrder = () => {
    const active = sortedScenes.filter((scene) => !scene.parked);
    const parked = sortedScenes.filter((scene) => scene.parked);
    let counter = 1;

    const reassigned = [...active, ...parked].map((scene) => {
      const nextNumber = counter;
      counter += 1;
      return {
        ...scene,
        sceneNumber: nextNumber,
        sceneCode: `SC${String(nextNumber).padStart(3, '0')}`,
      };
    });

    normalizeAndUpdate({ scenes: rebalanceOrders(reassigned) });
  };

  const getDraggedId = (event: React.DragEvent) => {
    return event.dataTransfer.getData('application/x-scene-wall-id') || draggedSceneId;
  };

  const moveSceneToBucket = (
    sceneId: string,
    destination: { reelId?: string; parked: boolean; targetSceneId?: string | null },
  ) => {
    const moving = state.scenes.find((scene) => scene.id === sceneId);
    if (!moving) return;

    const cleaned = state.scenes.filter((scene) => scene.id !== sceneId);
    const destinationKey = destination.parked ? PARKED_KEY : destination.reelId || '__unassigned__';
    const destinationList = cleaned
      .filter((scene) => {
        const key = scene.parked ? PARKED_KEY : scene.reelId || '__unassigned__';
        return key === destinationKey;
      })
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.sceneNumber - b.sceneNumber;
      });

    let targetIndex = destinationList.length;
    if (destination.targetSceneId) {
      const idx = destinationList.findIndex((scene) => scene.id === destination.targetSceneId);
      if (idx >= 0) targetIndex = idx;
    }

    const nextMoving: SceneWallSceneCard = {
      ...moving,
      reelId: destination.parked ? undefined : destination.reelId,
      parked: destination.parked,
      originalReelId: destination.parked ? moving.reelId || moving.originalReelId : moving.originalReelId,
      order: targetIndex + 1,
    };

    destinationList.splice(targetIndex, 0, nextMoving);
    const orderedDestinationList = destinationList.map((scene, index) => ({
      ...scene,
      order: index + 1,
    }));
    const destinationIds = new Set(orderedDestinationList.map((scene) => scene.id));
    const nextScenes = [
      ...cleaned.filter((scene) => !destinationIds.has(scene.id)),
      ...orderedDestinationList,
    ];

    normalizeAndUpdate({ scenes: rebalanceOrders(nextScenes), selectedSceneId: nextMoving.id });
  };

  const handleDropOnReel = (event: React.DragEvent, reelId: string, targetSceneId?: string) => {
    event.preventDefault();
    const sceneId = getDraggedId(event);
    if (!sceneId) return;
    moveSceneToBucket(sceneId, { reelId, parked: false, targetSceneId: targetSceneId || null });
    setDraggedSceneId(null);
  };

  const handleDropOnParked = (event: React.DragEvent, targetSceneId?: string) => {
    event.preventDefault();
    const sceneId = getDraggedId(event);
    if (!sceneId) return;
    moveSceneToBucket(sceneId, { parked: true, targetSceneId: targetSceneId || null });
    setDraggedSceneId(null);
  };

  const setSceneImageFromFile = (sceneId: string, file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = String(reader.result || '');
      if (!imageUrl) return;
      updateScene(sceneId, { imageUrl });
    };
    reader.readAsDataURL(file);
  };

  const setShotImageFromFile = (sceneId: string, shotId: string, file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = String(reader.result || '');
      if (!imageUrl) return;
      const scene = state.scenes.find((entry) => entry.id === sceneId);
      if (!scene) return;
      const shotCards = scene.shotCards.map((shot) => (shot.id === shotId ? { ...shot, imageUrl } : shot));
      updateScene(sceneId, { shotCards });
    };
    reader.readAsDataURL(file);
  };

  const handleApplyFromStoryBible = () => {
    const next = syncSceneWallWithProjectContext(state, {
      scriptText: storyBible.script || '',
      shotPrompts,
      references,
      vfxPrefix: state.vfxPrefix,
      linkStoryboard: state.autoLinkStoryboard !== false,
      linkConcept: state.autoLinkConcept !== false,
      autoSyncFromScriptContext: state.autoSyncFromScriptContext !== false,
      scriptSourceName: state.scriptSourceName || 'Story Bible',
    });
    onChange(next);
    setScriptStatus('Scene Wall aus Story Bible + Storyboard + Concept synchronisiert.');
  };

  const handleSyncFromProjectContext = () => {
    const next = syncSceneWallWithProjectContext(state, {
      scriptText: storyBible.script || '',
      shotPrompts,
      references,
      vfxPrefix: state.vfxPrefix,
      linkStoryboard: state.autoLinkStoryboard !== false,
      linkConcept: state.autoLinkConcept !== false,
      autoSyncFromScriptContext: state.autoSyncFromScriptContext !== false,
      scriptSourceName: state.scriptSourceName || 'Project Context',
    });
    onChange(next);
    setScriptStatus('Scene Wall mit Projektkontext synchronisiert.');
  };

  const linkShotNumber = (sceneId: string, shotNumber: number) => {
    const scene = state.scenes.find((entry) => entry.id === sceneId);
    if (!scene) return;
    const current = new Set(scene.linkedShotNumbers || []);
    if (current.has(shotNumber)) current.delete(shotNumber);
    else current.add(shotNumber);
    updateScene(sceneId, { linkedShotNumbers: Array.from(current).sort((a, b) => a - b) });
  };

  const addShotCard = (sceneId: string) => {
    const scene = state.scenes.find((entry) => entry.id === sceneId);
    if (!scene) return;
    const nextShotNumber = scene.shotCards.length > 0 ? scene.shotCards.length + 1 : 1;
    const shotCard = createSceneWallShotCard(scene.sceneNumber, nextShotNumber, {
      title: `Shot ${String(nextShotNumber).padStart(2, '0')}`,
    }, { vfxPrefix: state.vfxPrefix });
    updateScene(sceneId, { shotCards: [...scene.shotCards, shotCard] });
  };

  const updateShotCard = (sceneId: string, shotId: string, patch: Partial<SceneWallShotCard>) => {
    const scene = state.scenes.find((entry) => entry.id === sceneId);
    if (!scene) return;
    updateScene(sceneId, {
      shotCards: scene.shotCards.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)),
    });
  };

  const removeShotCard = (sceneId: string, shotId: string) => {
    const scene = state.scenes.find((entry) => entry.id === sceneId);
    if (!scene) return;
    updateScene(sceneId, {
      shotCards: scene.shotCards.filter((shot) => shot.id !== shotId),
    });
  };

  const toggleReferenceLink = (sceneId: string, referenceId: string) => {
    const scene = state.scenes.find((entry) => entry.id === sceneId);
    if (!scene) return;
    const nextIds = new Set(scene.linkedReferenceIds || []);
    if (nextIds.has(referenceId)) nextIds.delete(referenceId);
    else nextIds.add(referenceId);
    updateScene(sceneId, { linkedReferenceIds: Array.from(nextIds) });
  };

  const handleGenerateVfxCodes = () => {
    const next = generateSceneWallVfxCodes(state, state.vfxPrefix);
    onChange(next);
    setScriptStatus('VFX Shot Codes neu generiert.');
  };

  const resetBoard = () => {
    if (!window.confirm('Scene Wall auf Standard (6 Reels / 120 Szenen) zurücksetzen?')) return;
    onChange(createDefaultSceneWallState());
    setScriptStatus('Scene Wall zurückgesetzt.');
  };

  return (
    <div className="h-full bg-gray-950 text-gray-100 flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold tracking-wide">Scene Wall Pro</h2>
          <p className="text-xs text-gray-400">Digitale Szenenwand für Reels, Story Flow und Editorial-Diskussion.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleApplyFromStoryBible}
            className="rounded border border-indigo-500/40 bg-indigo-600/20 px-3 py-1.5 text-xs text-indigo-200 hover:bg-indigo-600/30"
          >
            Sluglines aus Story Bible
          </button>
          <button
            onClick={handleSyncFromProjectContext}
            className="rounded border border-emerald-600/40 bg-emerald-900/20 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900/35"
          >
            Sync Storyboard + Concept
          </button>
          <button
            onClick={renumberByBoardOrder}
            className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-200 hover:border-gray-500"
          >
            Neu nummerieren
          </button>
          <button
            onClick={addReel}
            className="rounded border border-cyan-500/40 bg-cyan-900/20 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-900/35"
          >
            + Reel
          </button>
          <button
            onClick={resetBoard}
            className="rounded border border-red-600/40 bg-red-900/20 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/35"
          >
            Reset 6x20
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-gray-900 px-4 py-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Szenen suchen (Slugline, Code, Nummer, VFX Label)"
          className="w-[420px] max-w-full rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-100 outline-none focus:border-indigo-500"
        />
        <span className="text-xs text-gray-500">
          {state.scenes.filter((scene) => !scene.parked).length} aktive Szenen · {state.scenes.filter((scene) => scene.parked).length} geparkt
        </span>
        <label className="text-xs text-gray-500 flex items-center gap-2">
          VFX Prefix
          <input
            value={state.vfxPrefix || ''}
            onChange={(event) =>
              normalizeAndUpdate({ vfxPrefix: sanitizeVfxPrefix(event.target.value) })
            }
            className="w-20 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-indigo-200"
          />
        </label>
        <button
          onClick={handleGenerateVfxCodes}
          className="rounded border border-indigo-500/40 bg-indigo-900/20 px-2 py-1 text-[11px] text-indigo-200 hover:bg-indigo-900/35"
        >
          Generate VFX IDs
        </button>
        <label className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={state.autoLinkStoryboard !== false}
            onChange={(event) => normalizeAndUpdate({ autoLinkStoryboard: event.target.checked })}
          />
          Auto Storyboard Link
        </label>
        <label className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={state.autoLinkConcept !== false}
            onChange={(event) => normalizeAndUpdate({ autoLinkConcept: event.target.checked })}
          />
          Auto Concept Link
        </label>
        <label className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={state.autoSyncFromScriptContext !== false}
            onChange={(event) => normalizeAndUpdate({ autoSyncFromScriptContext: event.target.checked })}
          />
          Auto Sync
        </label>
        {scriptStatus && <span className="text-xs text-emerald-300">{scriptStatus}</span>}
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 overflow-x-auto overflow-y-auto p-3">
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${orderedReels.length + 1}, minmax(260px, 1fr))` }}>
            {orderedReels.map((reel) => {
              const reelScenes = activeScenesByReel.get(reel.id) || [];
              return (
                <div
                  key={reel.id}
                  className="rounded-lg border border-gray-800 bg-gray-900/60 flex flex-col min-h-[260px]"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDropOnReel(event, reel.id)}
                >
                  <div className="border-b border-gray-800 px-3 py-2" style={{ borderTop: `2px solid ${reel.color || '#334155'}` }}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <input
                          value={reel.name}
                          onChange={(event) => updateReel(reel.id, { name: event.target.value })}
                          className="w-full bg-transparent text-xs uppercase tracking-widest text-gray-300 outline-none focus:text-white"
                        />
                        <p className="text-[11px] text-gray-500">Sc {String(reel.sceneRange.start).padStart(3, '0')} - {String(reel.sceneRange.end).padStart(3, '0')}</p>
                      </div>
                      <button
                        onClick={() => addScene(reel.id)}
                        className="rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-[11px] text-gray-300 hover:border-indigo-500"
                      >
                        + Szene
                      </button>
                    </div>
                  </div>

                  <div className="p-2 space-y-2">
                    {reelScenes.length === 0 && (
                      <div className="rounded border border-dashed border-gray-700 bg-gray-900/30 p-3 text-center text-xs text-gray-600">
                        Drop Szene hier
                      </div>
                    )}
                    {reelScenes.map((scene) => (
                      <div
                        key={scene.id}
                        draggable
                        onDragStart={(event) => {
                          setDraggedSceneId(scene.id);
                          event.dataTransfer.setData('application/x-scene-wall-id', scene.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => setDraggedSceneId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleDropOnReel(event, reel.id, scene.id)}
                        onClick={() => normalizeAndUpdate({ selectedSceneId: scene.id })}
                        onDoubleClick={() => onOpenSceneInStoryboard?.(scene.id)}
                        className={`rounded border bg-gray-950/90 p-2 cursor-grab active:cursor-grabbing ${selectedScene?.id === scene.id ? 'border-indigo-500' : 'border-gray-800 hover:border-gray-600'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold text-indigo-300">{scene.sceneCode} · {String(scene.sceneNumber).padStart(3, '0')}</p>
                            <p className="text-[11px] text-gray-400 truncate max-w-[190px]">{scene.slugline}</p>
                          </div>
                          {scene.vfxLabel && <span className="rounded bg-amber-600/20 px-1.5 py-0.5 text-[10px] text-amber-200">{scene.vfxLabel}</span>}
                        </div>
                        <div className="mt-2 h-16 rounded border border-gray-800 bg-gray-900 overflow-hidden">
                          {scene.imageUrl ? (
                            <img src={scene.imageUrl} className="h-full w-full object-cover" alt={scene.slugline} />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-[11px] text-gray-600">Still Placeholder</div>
                          )}
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[10px] text-gray-500">
                          <span>{scene.shotCards.length} Shots</span>
                          <span>{(scene.linkedShotNumbers || []).length} Links</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            <div
              className="rounded-lg border border-gray-800 bg-gray-900/40 flex flex-col min-h-[260px]"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDropOnParked(event)}
            >
              <div className="border-b border-gray-800 px-3 py-2">
                <p className="text-xs uppercase tracking-widest text-gray-400">Parked / Omitted</p>
                <p className="text-[11px] text-gray-500">Szenen aus der Struktur gezogen</p>
              </div>
              <div className="p-2 space-y-2">
                {parkedScenes.length === 0 && (
                  <div className="rounded border border-dashed border-gray-700 bg-gray-900/30 p-3 text-center text-xs text-gray-600">
                    Entfernte Szenen hier parken
                  </div>
                )}
                {parkedScenes.map((scene) => (
                  <div
                    key={scene.id}
                    draggable
                    onDragStart={(event) => {
                      setDraggedSceneId(scene.id);
                      event.dataTransfer.setData('application/x-scene-wall-id', scene.id);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDraggedSceneId(null)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDropOnParked(event, scene.id)}
                    onClick={() => normalizeAndUpdate({ selectedSceneId: scene.id })}
                    onDoubleClick={() => onOpenSceneInStoryboard?.(scene.id)}
                    className={`rounded border bg-gray-950/90 p-2 cursor-grab ${selectedScene?.id === scene.id ? 'border-fuchsia-500' : 'border-gray-800 hover:border-gray-600'}`}
                  >
                    <p className="text-[11px] font-semibold text-fuchsia-300">{scene.sceneCode} · {String(scene.sceneNumber).padStart(3, '0')}</p>
                    <p className="text-[11px] text-gray-400 truncate">{scene.slugline}</p>
                    {scene.parkedReason && <p className="text-[10px] text-gray-500 mt-1">Reason: {scene.parkedReason}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="w-[380px] max-w-[42vw] border-l border-gray-800 bg-gray-900/70 p-3 overflow-y-auto">
          {!selectedScene ? (
            <div className="text-xs text-gray-500">Keine Szene ausgewählt.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">Scene Inspector</h3>
                  {onOpenSceneInStoryboard && (
                    <button
                      onClick={() => onOpenSceneInStoryboard(selectedScene.id)}
                      className="rounded border border-indigo-500/40 bg-indigo-900/30 px-2 py-1 text-[10px] font-semibold text-indigo-200 hover:border-indigo-400"
                    >
                      Open in Storyboard
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500">Storyboards, Shots und Metadaten pro Szene.</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-gray-400">Scene #
                  <input
                    type="number"
                    min={1}
                    value={selectedScene.sceneNumber}
                    onChange={(event) => {
                      const sceneNumber = Math.max(1, Number(event.target.value) || 1);
                      updateScene(selectedScene.id, {
                        sceneNumber,
                        sceneCode: `SC${String(sceneNumber).padStart(3, '0')}`,
                      });
                    }}
                    className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white"
                  />
                </label>
                <label className="text-xs text-gray-400">Scene Code
                  <input
                    value={selectedScene.sceneCode}
                    onChange={(event) => updateScene(selectedScene.id, { sceneCode: event.target.value })}
                    className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white"
                  />
                </label>
              </div>

              <label className="block text-xs text-gray-400">Slugline
                <textarea
                  rows={3}
                  value={selectedScene.slugline}
                  onChange={(event) => updateScene(selectedScene.id, { slugline: event.target.value })}
                  className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white"
                />
              </label>

              <label className="block text-xs text-gray-400">VFX Label (z.B. CAF)
                <input
                  value={selectedScene.vfxLabel || ''}
                  onChange={(event) => updateScene(selectedScene.id, { vfxLabel: event.target.value })}
                  className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-white"
                />
              </label>

              <label className="block text-xs text-gray-400">Scene Notes
                <textarea
                  rows={2}
                  value={selectedScene.notes || ''}
                  onChange={(event) => updateScene(selectedScene.id, { notes: event.target.value })}
                  className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-white"
                />
              </label>

              <div className="space-y-2">
                <p className="text-xs text-gray-400">Scene Still</p>
                <div className="h-28 rounded border border-gray-800 bg-gray-950 overflow-hidden">
                  {selectedScene.imageUrl ? (
                    <img src={selectedScene.imageUrl} className="h-full w-full object-cover" alt={selectedScene.slugline} />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-xs text-gray-600">Placeholder</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => sceneImageInputRef.current?.click()}
                    className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-[11px] text-gray-200 hover:border-indigo-500"
                  >
                    Upload Still
                  </button>
                  <button
                    onClick={() => updateScene(selectedScene.id, { imageUrl: undefined })}
                    className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-[11px] text-gray-400 hover:text-white"
                  >
                    Clear
                  </button>
                  <input
                    ref={sceneImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      setSceneImageFromFile(selectedScene.id, event.target.files?.[0] || null);
                      event.currentTarget.value = '';
                    }}
                  />
                </div>
              </div>

              <div className="rounded border border-gray-800 bg-gray-950/60 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-300">Linked Project Shots</p>
                  <span className="text-[10px] text-gray-500">{(selectedScene.linkedShotNumbers || []).length}</span>
                </div>
                <div className="mt-2 max-h-24 overflow-auto flex flex-wrap gap-1">
                  {shotPrompts.length === 0 && <span className="text-[10px] text-gray-600">Keine ShotPrompts im Projekt.</span>}
                  {shotPrompts.map((shot) => {
                    const linked = (selectedScene.linkedShotNumbers || []).includes(shot.shot);
                    return (
                      <button
                        key={shot.shot}
                        onClick={() => linkShotNumber(selectedScene.id, shot.shot)}
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${linked ? 'border-emerald-500/50 bg-emerald-700/20 text-emerald-200' : 'border-gray-700 text-gray-400 hover:text-white'}`}
                        title={shot.description}
                      >
                        {shot.shot}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded border border-gray-800 bg-gray-950/60 p-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-300">Linked Concept References</p>
                  <span className="text-[10px] text-gray-500">{(selectedScene.linkedReferenceIds || []).length}</span>
                </div>
                <div className="mt-2 max-h-28 overflow-auto flex flex-wrap gap-1">
                  {references.length === 0 && <span className="text-[10px] text-gray-600">Keine Concept-References im Projekt.</span>}
                  {references.map((reference) => {
                    const linked = (selectedScene.linkedReferenceIds || []).includes(reference.id);
                    return (
                      <button
                        key={reference.id}
                        onClick={() => toggleReferenceLink(selectedScene.id, reference.id)}
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${linked ? 'border-cyan-500/50 bg-cyan-700/20 text-cyan-200' : 'border-gray-700 text-gray-400 hover:text-white'}`}
                        title={reference.description || reference.name}
                      >
                        {reference.type.slice(0, 3).toUpperCase()} · {reference.name}
                      </button>
                    );
                  })}
                </div>
                {(selectedScene.linkedReferenceIds || []).length > 0 && (
                  <div className="mt-2 text-[10px] text-gray-500">
                    {selectedScene.linkedReferenceIds
                      ?.map((id) => referenceById.get(id)?.name)
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </div>

              <div className="rounded border border-gray-800 bg-gray-950/60 p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-300">Storyboard / Shot Cards</p>
                  <button
                    onClick={() => addShotCard(selectedScene.id)}
                    className="rounded border border-gray-700 bg-gray-950 px-2 py-0.5 text-[10px] text-gray-300 hover:border-indigo-500"
                  >
                    + Shot
                  </button>
                </div>

                {selectedScene.shotCards.length === 0 && (
                  <p className="text-[10px] text-gray-600">Noch keine Shot Cards.</p>
                )}

                {selectedScene.shotCards.map((shot) => (
                  <div key={shot.id} className="rounded border border-gray-800 bg-gray-950 p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={shot.code}
                        onChange={(event) => updateShotCard(selectedScene.id, shot.id, { code: event.target.value })}
                        className="w-[150px] rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-indigo-200"
                      />
                      <button
                        onClick={() => removeShotCard(selectedScene.id, shot.id)}
                        className="rounded border border-red-600/40 bg-red-900/20 px-1.5 py-0.5 text-[10px] text-red-200"
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      value={shot.title}
                      onChange={(event) => updateShotCard(selectedScene.id, shot.id, { title: event.target.value })}
                      placeholder="Shot title"
                      className="w-full rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[11px] text-white"
                    />
                    <textarea
                      rows={2}
                      value={shot.notes || ''}
                      onChange={(event) => updateShotCard(selectedScene.id, shot.id, { notes: event.target.value })}
                      placeholder="Shot notes"
                      className="w-full rounded border border-gray-700 bg-gray-900 px-1.5 py-1 text-[11px] text-gray-300"
                    />
                    <div className="h-20 rounded border border-gray-800 bg-gray-900 overflow-hidden">
                      {shot.imageUrl ? (
                        <img src={shot.imageUrl} className="h-full w-full object-cover" alt={shot.title} />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-[10px] text-gray-600">Shot Placeholder</div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setPendingShotImageTargetId(shot.id);
                          shotImageInputRef.current?.click();
                        }}
                        className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-300"
                      >
                        Upload
                      </button>
                      <button
                        onClick={() => updateShotCard(selectedScene.id, shot.id, { imageUrl: undefined })}
                        className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-500"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ))}

                <input
                  ref={shotImageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const targetShotId = pendingShotImageTargetId;
                    if (targetShotId) {
                      setShotImageFromFile(selectedScene.id, targetShotId, event.target.files?.[0] || null);
                    }
                    setPendingShotImageTargetId(null);
                    event.currentTarget.value = '';
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-800">
                {!selectedScene.parked ? (
                  <button
                    onClick={() => moveSceneToBucket(selectedScene.id, { parked: true })}
                    className="rounded border border-amber-500/40 bg-amber-900/20 px-3 py-1 text-xs text-amber-200"
                  >
                    Park Scene
                  </button>
                ) : (
                  <button
                    onClick={() => moveSceneToBucket(selectedScene.id, { parked: false, reelId: selectedScene.originalReelId || orderedReels[0]?.id })}
                    className="rounded border border-emerald-500/40 bg-emerald-900/20 px-3 py-1 text-xs text-emerald-200"
                  >
                    Restore to Reel
                  </button>
                )}
                <button
                  onClick={() => duplicateScene(selectedScene.id)}
                  className="rounded border border-gray-700 bg-gray-950 px-3 py-1 text-xs text-gray-200"
                >
                  Duplicate
                </button>
                <button
                  onClick={() => removeScene(selectedScene.id)}
                  className="rounded border border-red-600/40 bg-red-900/20 px-3 py-1 text-xs text-red-200"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SceneWallWorkspace;
