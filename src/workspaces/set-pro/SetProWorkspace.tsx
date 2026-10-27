/**
 * Set design workspace laid out like Blender: workspace tabs on top, 3D viewport with header
 * menus, toolbar and navigation gizmo, outliner and properties editor on the right, status bar
 * at the bottom. Tabs: Layout, Kamera, Licht, Assets, Klassisch (the previous page).
 *
 * Every action goes through the set design command bus, the same one the MCP tools use.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, ChevronDown, Copy, Footprints, Globe, Image as ImageIcon, Lightbulb, Link, Magnet, MousePointer2, Move, Move3d,
  Palette, Plus, Redo2, Rotate3d, Scale3d, Sparkles, SunMedium, Circle, Undo2, Upload, Video,
} from 'lucide-react';
import type { MediaItem, RecentProject, ReferenceItem, SetDesignState, ShotPrompt } from '../../types';
import { useLibraryAssets } from '../../hooks/useLibraryAssets';
import { MODEL_IMPORT_ACCEPT } from '../../utils/setDesignImport';
import { registerLiveCommand } from '../../mcp/liveCommands';
import { buildBlenderScript } from '../../setdesign/blenderExport.ts';
import type { SetDesignUiState, WorkspaceTab } from '../../setdesign/commands.ts';
import { getCommand } from '../../setdesign/commands.ts';
import { describeCamera, LENS_PRESETS_MM, lensForVerticalFov, SENSOR_PRESETS, verticalFovDeg } from '../../setdesign/cameraMath.ts';
import { toBlenderLocation } from '../../setdesign/coords.ts';
import { resolveKey, STATUS_HINTS } from '../../setdesign/keymap.ts';
import { findSceneObject, getActiveCamera, LIGHT_TYPES, PRIMITIVES } from '../../setdesign/sceneModel.ts';
import Viewport3D, { type ViewportHandle } from './Viewport3D.tsx';
import Outliner from './Outliner.tsx';
import PropertiesEditor, { OUTPUT_PRESETS } from './PropertiesEditor.tsx';
import { NumberField, ObjectIcon, Panel, Popup, Prop, runCommand, useSetDesign, type PopupItem } from './ui.tsx';
import './setPro.css';

type Props = {
  mediaItems?: MediaItem[];
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  onAddGeneratedMedia?: (item: MediaItem) => void;
  /** The previous set design page, shown in the "Klassisch" tab. */
  classic: React.ReactNode;
};

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'layout', label: 'Layout' },
  { id: 'camera', label: 'Kamera' },
  { id: 'lighting', label: 'Licht' },
  { id: 'assets', label: 'Assets' },
  { id: 'classic', label: 'Klassisch' },
];

const isModelUrl = (url?: string | null) => !!url && /\.(glb|gltf|obj|fbx)(\?|#|$)/i.test(url);
const shortcut = (id: string) => getCommand(id)?.shortcut;

type MenuState = { kind: 'add' | 'delete' | 'shading' | 'context' | 'header'; x: number; y: number; header?: string } | null;

const LIGHT_PRESETS: Array<{ label: string; hint: string; args: Record<string, unknown> }> = [
  { label: 'Tageslicht (Sonne)', hint: '5600 K, 4 W/m²', args: { lightType: 'sun', name: 'Sonne', temperature: 5600, power: 4, location: [4, -6, 8], lookAtPoint: [0, 0, 0] } },
  { label: 'Fensterlicht', hint: 'Fläche 2 × 1,5 m, 6500 K', args: { lightType: 'area', name: 'Fenster', temperature: 6500, power: 150, size: 2, sizeY: 1.5, location: [0, -3, 1.6], lookAtPoint: [0, 0, 1.2] } },
  { label: 'Stufenlinse 1 kW', hint: 'Spot 30°, 3200 K', args: { lightType: 'spot', name: 'Stufenlinse', temperature: 3200, power: 600, spotSize: 30, spotBlend: 0.25, location: [3, -3, 3], lookAtPoint: [0, 0, 1] } },
  { label: 'Praktikable', hint: 'Punkt, 2700 K, 60 W', args: { lightType: 'point', name: 'Praktikable', temperature: 2700, power: 60, location: [0, 0, 1.8] } },
  { label: 'Aufheller', hint: 'Fläche 1 × 1 m, 5600 K', args: { lightType: 'area', name: 'Aufheller', temperature: 5600, power: 40, size: 1, location: [-2.5, -2, 1.5], lookAtPoint: [0, 0, 1.2] } },
];

const SetProWorkspace: React.FC<Props> = ({ mediaItems, references = [], shotPrompts = [], recentProjects, currentProjectName, currentProjectPath, onAddGeneratedMedia, classic }) => {
  const { bus, scene, ui } = useSetDesign();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<ViewportHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pointerRef = useRef({ x: 200, y: 200, inside: false });
  const [menu, setMenu] = useState<MenuState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statusMode, setStatusMode] = useState<'idle' | 'modal' | 'walk'>('idle');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [capturePass, setCapturePass] = useState<'beauty' | 'clay' | 'depth'>('beauty');
  const [captureShot, setCaptureShot] = useState<string>('');
  const [captureReference, setCaptureReference] = useState<string>('');
  const [lastCapture, setLastCapture] = useState<{ url: string; text: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4200);
  }, []);
  const run = useCallback((id: string, args: Record<string, unknown> = {}) => runCommand(id, args, showToast), [showToast]);

  const { assets: libraryAssets } = useLibraryAssets({ currentProjectName: currentProjectName || null, currentProjectPath: currentProjectPath || null, mediaItems, references, shotPrompts, recentProjects });
  const libraryModels = useMemo(() => libraryAssets.filter((asset) => isModelUrl(asset.url)).slice(0, 30), [libraryAssets]);
  const libraryRef = useRef(libraryModels);
  libraryRef.current = libraryModels;
  // Agents: setdesign_list_library_assets.
  useEffect(() => registerLiveCommand('setdesign.libraryModels', () => libraryRef.current.map((asset) => ({ name: asset.name, url: asset.url, project: asset.projectName, origin: asset.origin }))), []);

  const exportBlender = () => {
    const script = buildBlenderScript(bus.getScene());
    try {
      const blob = new Blob([script], { type: 'text/x-python' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'avpe_set.py';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast('Blender-Skript gespeichert (avpe_set.py). In Blender: Scripting › Öffnen › Ausführen.');
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    }
  };

  const tab = ui.workspaceTab;
  const active = getActiveCamera(scene);
  const output = scene.output || { width: 1920, height: 1080 };
  const activeObject = ui.activeId ? findSceneObject(scene, ui.activeId) : null;

  // Tabs set up the viewport the way the task needs it.
  const lastTab = useRef<WorkspaceTab>(tab);
  useEffect(() => {
    if (lastTab.current === tab) return;
    lastTab.current = tab;
    if (tab === 'camera') run('view.camera', { on: true });
    if (tab === 'lighting' && scene.shading !== 'rendered') run('view.shading', { mode: 'rendered' });
  }, [tab, run, scene.shading]);

  // ------------------------------------------------------------------ actions

  const importFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const mediaId = `setdesign-model-${Date.now()}`;
    // The media item keeps the file with the project (saved into the project folder).
    onAddGeneratedMedia?.({ id: mediaId, name: file.name, type: 'image', url, source: 'upload', generatedBy: 'Set Design Import' });
    const format = file.name.split('.').pop()?.toLowerCase();
    const result = run('object.add_model', { url, mediaId, format, name: file.name.replace(/\.[^.]+$/, '') });
    if (result) showToast(`${file.name} importiert.`);
  };

  const capture = async () => {
    if (!bus.hasAction('captureFrame')) { showToast('Referenzframes gehen nur im Editor-Fenster (WebGL).'); return; }
    setCapturing(true);
    try {
      const shotNumber = captureShot ? Number(captureShot) : undefined;
      const result = await bus.callAction('captureFrame', { pass: capturePass, ...(shotNumber ? { shotNumber } : {}), ...(captureReference ? { reference: captureReference } : {}), returnImage: false }) as { mediaId?: string; setup?: { de: string; en: string }; done?: string[] };
      const media = (mediaItems || []).find((item) => item.id === result.mediaId);
      setLastCapture({ url: media?.url || '', text: result.setup?.en || '' });
      const notes = (result.done || []).map((note) => note
        .replace('added to media', 'in den Medien')
        .replace(/^set on shot (\d+)$/, 'auf Shot $1')
        .replace(/^added to reference (.+)$/, 'bei Referenz „$1“'));
      showToast(`Referenzframe gespeichert${notes.length ? `: ${notes.join(', ')}` : ''}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setCapturing(false);
    }
  };

  // Show the newest capture once the media list has it.
  useEffect(() => {
    if (!lastCapture || lastCapture.url) return;
    const newest = [...(mediaItems || [])].reverse().find((item) => item.generatedBy === 'Set Design');
    if (newest) setLastCapture((current) => (current ? { ...current, url: newest.url } : current));
  }, [mediaItems, lastCapture]);

  const addCameraFromView = () => run('object.add_camera', { location: Object.values(toBlenderLocation(scene.camera.position)), lookAtPoint: Object.values(toBlenderLocation(scene.camera.target)) });

  const openMenu = (kind: NonNullable<MenuState>['kind'], header?: string, at?: { x: number; y: number }) => {
    const p = at || pointerRef.current;
    setMenu({ kind, x: p.x, y: p.y, header });
  };

  // ------------------------------------------------------------------ keyboard

  useEffect(() => {
    if (tab === 'classic') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root || menu) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      // Keys act on the workspace when focus is inside it, nowhere in particular, or the mouse is over it.
      const focus = document.activeElement;
      const focusedInside = root.contains(focus) || !focus || focus === document.body;
      if (!focusedInside && !pointerRef.current.inside) return;
      if (viewportRef.current?.isBusy()) return;
      const intent = resolveKey(event, { hasSelection: bus.getUi().selectedIds.length > 0, lookThroughCamera: bus.getUi().lookThroughCamera, emulateNumpad: bus.getUi().emulateNumpad });
      if (!intent) return;
      event.preventDefault();
      event.stopPropagation();
      switch (intent.type) {
        case 'command': run(intent.command, intent.args); break;
        case 'modal': viewportRef.current?.startModal(intent.kind, intent.duplicate); break;
        case 'clear': {
          for (const id of bus.getUi().selectedIds) {
            const ref = findSceneObject(bus.getScene(), id);
            if (!ref) continue;
            if (intent.what === 'scale' && ref.kind !== 'asset') continue;
            run('object.transform', { object: id, [intent.what]: intent.what === 'scale' ? [1, 1, 1] : [0, 0, 0] });
          }
          break;
        }
        case 'orbit': viewportRef.current?.orbitStep(intent.yaw, intent.pitch); break;
        case 'zoom': viewportRef.current?.zoomStep(intent.factor); break;
        case 'menu': openMenu(intent.menu); break;
        case 'ui':
          if (intent.action === 'toggleSidebar') bus.setUi({ sidebar: !bus.getUi().sidebar });
          if (intent.action === 'toggleToolbar') bus.setUi({ toolbar: !bus.getUi().toolbar });
          if (intent.action === 'maximize') setMaximized((value) => !value);
          if (intent.action === 'walk') viewportRef.current?.startWalk();
          if (intent.action === 'rename' && bus.getUi().activeId) setRenamingId(bus.getUi().activeId);
          if (intent.action === 'capture') void capture();
          if (intent.action === 'cameraFromSelection') {
            const id = bus.getUi().activeId;
            const ref = id ? findSceneObject(bus.getScene(), id) : null;
            if (ref?.kind === 'camera') { run('camera.set_active', { object: ref.object.id }); run('view.camera', { on: true }); }
            else showToast('Erst eine Kamera auswählen (Strg+Num0 macht sie zur aktiven Kamera).');
          }
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, menu, run, bus, capturePass, captureShot, captureReference]);

  // ------------------------------------------------------------------ menus

  const addItems: PopupItem[] = [
    { kind: 'section', label: 'Mesh' },
    ...PRIMITIVES.map((p) => ({ label: p.label, icon: <ObjectIcon type={p.id} />, shortcut: p.hint, onSelect: () => run('object.add_primitive', { primitive: p.id }), automationId: `setdesign-add-${p.id}` })),
    { kind: 'separator' },
    { kind: 'section', label: 'Kamera' },
    { label: 'Kamera aus Ansicht', icon: <ObjectIcon type="camera" />, onSelect: addCameraFromView, automationId: 'setdesign-add-camera' },
    { kind: 'section', label: 'Licht' },
    ...LIGHT_TYPES.map((l) => ({ label: l.label, icon: <ObjectIcon type={l.id} />, onSelect: () => run('object.add_light', { lightType: l.id }), automationId: `setdesign-add-light-${l.id}` })),
    { kind: 'separator' },
    { label: '3D-Modell importieren …', icon: <Upload size={14} />, shortcut: 'GLB, OBJ, FBX', onSelect: () => fileInputRef.current?.click(), automationId: 'setdesign-add-import' },
  ];

  const objectItems = (): PopupItem[] => {
    const isCamera = activeObject?.kind === 'camera';
    return [
      { label: 'Verschieben', shortcut: 'G', onSelect: () => viewportRef.current?.startModal('grab'), disabled: !ui.selectedIds.length },
      { label: 'Drehen', shortcut: 'R', onSelect: () => viewportRef.current?.startModal('rotate'), disabled: !ui.selectedIds.length },
      { label: 'Skalieren', shortcut: 'S', onSelect: () => viewportRef.current?.startModal('scale'), disabled: !ui.selectedIds.length },
      { kind: 'separator' },
      { label: 'Duplizieren', shortcut: 'Shift+D', icon: <Copy size={14} />, onSelect: () => viewportRef.current?.startModal('grab', true), disabled: !ui.selectedIds.length },
      { label: 'Umbenennen', shortcut: 'F2', onSelect: () => ui.activeId && setRenamingId(ui.activeId), disabled: !ui.activeId },
      { label: 'Ausblenden', shortcut: 'H', onSelect: () => run('object.hide'), disabled: !ui.selectedIds.length },
      { label: 'Alles einblenden', shortcut: 'Alt+H', onSelect: () => run('object.hide', { unhideAll: true }) },
      { label: 'Position zurücksetzen', shortcut: 'Alt+G', onSelect: () => ui.selectedIds.forEach((id) => run('object.transform', { object: id, location: [0, 0, 0] })), disabled: !ui.selectedIds.length },
      { label: 'Drehung zurücksetzen', shortcut: 'Alt+R', onSelect: () => ui.selectedIds.forEach((id) => run('object.transform', { object: id, rotation: [0, 0, 0] })), disabled: !ui.selectedIds.length },
      { kind: 'separator' },
      ...(isCamera ? [
        { label: 'Als aktive Kamera setzen', shortcut: 'Strg+Num0', icon: <Video size={14} />, onSelect: () => { run('camera.set_active', { object: activeObject!.object.id }); run('view.camera', { on: true }); } },
      ] as PopupItem[] : []),
      ...(activeObject && activeObject.kind !== 'asset' ? [
        { label: 'Auf Auswahlmitte ausrichten', onSelect: () => {
          const others = ui.selectedIds.filter((id) => id !== activeObject.object.id);
          if (others.length) run('object.aim', { object: activeObject.object.id, lookAt: others[0] });
          else showToast('Zweites Objekt auswählen (Shift+Klick), dann ausrichten.');
        } },
      ] as PopupItem[] : []),
      { label: 'Löschen', shortcut: 'X', onSelect: () => run('object.delete'), disabled: !ui.selectedIds.length, automationId: 'setdesign-menu-delete' },
    ];
  };

  const viewItems: PopupItem[] = [
    { label: 'Durch Kamera schauen', shortcut: 'Num0', icon: <Video size={14} />, onSelect: () => run('view.camera') },
    { label: 'Aktive Kamera an Ansicht', shortcut: 'Strg+Alt+Num0', onSelect: () => run('camera.from_view') },
    { label: 'Kamera aus Ansicht hinzufügen', onSelect: addCameraFromView },
    { kind: 'separator' },
    { label: 'Vorne', shortcut: 'Num1', onSelect: () => run('view.preset', { view: 'front' }) },
    { label: 'Hinten', shortcut: 'Strg+Num1', onSelect: () => run('view.preset', { view: 'back' }) },
    { label: 'Rechts', shortcut: 'Num3', onSelect: () => run('view.preset', { view: 'right' }) },
    { label: 'Links', shortcut: 'Strg+Num3', onSelect: () => run('view.preset', { view: 'left' }) },
    { label: 'Oben', shortcut: 'Num7', onSelect: () => run('view.preset', { view: 'top' }) },
    { label: 'Unten', shortcut: 'Strg+Num7', onSelect: () => run('view.preset', { view: 'bottom' }) },
    { label: 'Perspektive/Orthografisch', shortcut: 'Num5', onSelect: () => run('view.toggle_ortho') },
    { kind: 'separator' },
    { label: 'Alles zeigen', shortcut: 'Pos1', onSelect: () => run('view.frame', { what: 'all' }) },
    { label: 'Auswahl zeigen', shortcut: 'Num ,', onSelect: () => run('view.frame', { what: 'selected' }), disabled: !ui.selectedIds.length },
    { label: 'Gehen (Walk)', shortcut: 'Shift+`', icon: <Footprints size={14} />, onSelect: () => viewportRef.current?.startWalk() },
    { label: 'Als Blender-Skript exportieren …', onSelect: exportBlender, automationId: 'setdesign-export-blender' },
    { kind: 'separator' },
    { label: ui.sidebar ? 'Seitenleiste ausblenden' : 'Seitenleiste', shortcut: 'N', onSelect: () => bus.setUi({ sidebar: !ui.sidebar }) },
    { label: ui.toolbar ? 'Werkzeugleiste ausblenden' : 'Werkzeugleiste', shortcut: 'T', onSelect: () => bus.setUi({ toolbar: !ui.toolbar }) },
    { label: maximized ? 'Bereich wiederherstellen' : 'Viewport maximieren', shortcut: 'Strg+Leertaste', onSelect: () => setMaximized(!maximized) },
  ];

  const selectItems: PopupItem[] = [
    { label: 'Alles', shortcut: 'A', onSelect: () => run('select.all') },
    { label: 'Nichts', shortcut: 'Alt+A', onSelect: () => run('select.all', { deselect: true }) },
    { kind: 'section', label: 'Nach Typ' },
    { label: 'Kameras', onSelect: () => run('select.set', { objects: (scene.cameras || []).filter((c) => !c.hidden).map((c) => c.id) }) },
    { label: 'Lichter', onSelect: () => run('select.set', { objects: scene.lights.filter((l) => !l.hidden && l.type !== 'ambient').map((l) => l.id) }) },
    { label: 'Objekte', onSelect: () => run('select.set', { objects: scene.assets.filter((a) => !a.hidden && !a.locked).map((a) => a.id) }) },
  ];

  const shadingItems: PopupItem[] = [
    { label: 'Drahtgitter', icon: <Globe size={14} />, onSelect: () => run('view.shading', { mode: 'wireframe' }) },
    { label: 'Solid', icon: <Circle size={14} />, onSelect: () => run('view.shading', { mode: 'solid' }) },
    { label: 'Materialvorschau', icon: <Palette size={14} />, onSelect: () => run('view.shading', { mode: 'material' }) },
    { label: 'Gerendert', icon: <SunMedium size={14} />, onSelect: () => run('view.shading', { mode: 'rendered' }) },
  ];

  const headerMenus: Record<string, PopupItem[]> = { Ansicht: viewItems, Auswahl: selectItems, Hinzufügen: addItems, Objekt: objectItems() };

  const menuItems = (): { title?: string; items: PopupItem[] } => {
    if (!menu) return { items: [] };
    if (menu.kind === 'add') return { title: 'Hinzufügen', items: addItems };
    if (menu.kind === 'delete') return { title: 'Löschen?', items: [{ label: `${ui.selectedIds.length} Objekt${ui.selectedIds.length === 1 ? '' : 'e'} löschen`, onSelect: () => run('object.delete'), automationId: 'setdesign-confirm-delete' }] };
    if (menu.kind === 'shading') return { title: 'Shading', items: shadingItems };
    if (menu.kind === 'header' && menu.header) return { items: headerMenus[menu.header] || [] };
    return { title: activeObject?.object.name || 'Objekt', items: objectItems() };
  };

  // ------------------------------------------------------------------ panels per tab

  const cameraPanel = (
    <>
      <div className="sdx-left__section">
        <div className="sdx-left__title"><Video size={14} /> Kameras</div>
        {(scene.cameras || []).map((camera) => (
          <div key={camera.id} className={`sdx-list-item${camera.id === active?.id ? ' is-on' : ''}`} onClick={() => { run('camera.set_active', { object: camera.id }); run('select.set', { objects: [camera.id] }); run('view.camera', { on: true }); }} data-automation-id={`setdesign-camera-item-${camera.id}`}>
            <ObjectIcon type="camera" />
            <span style={{ flex: 1 }}>{camera.name}</span>
            <span className="sdx-note">{Math.round(camera.lensMm)} mm</span>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="sdx-btn" style={{ flex: 1 }} onClick={addCameraFromView} data-automation-id="setdesign-camera-add"><Plus size={13} /> Aus Ansicht</button>
          <button type="button" className="sdx-btn" style={{ flex: 1 }} onClick={() => run('camera.from_view')} title="Strg+Alt+Num0">An Ansicht</button>
        </div>
      </div>
      {active && (
        <div className="sdx-left__section">
          <div className="sdx-left__title">{active.name}</div>
          <Prop label="Brennweite"><NumberField value={active.lensMm} unit="mm" digits={1} step={1} min={1} max={2000} onBegin={() => bus.beginInteraction('Brennweite')} onEnd={(c) => bus.endInteraction(c)} onChange={(v) => run('object.update', { object: active.id, lensMm: v })} automationId="setdesign-camtab-lens" /></Prop>
          <div className="sdx-chips">
            {LENS_PRESETS_MM.map((mm) => <button key={mm} type="button" className={`sdx-chip${Math.abs(active.lensMm - mm) < 0.05 ? ' is-on' : ''}`} onClick={() => run('object.update', { object: active.id, lensMm: mm })}>{mm}</button>)}
          </div>
          <Prop label="Sensor">
            <select className="sdx-select" style={{ width: '100%' }} value={SENSOR_PRESETS.find((p) => Math.abs(p.widthMm - active.sensorWidthMm) < 0.05)?.id || ''} onChange={(event) => event.target.value && run('object.update', { object: active.id, sensorPreset: event.target.value })}>
              <option value="">Eigene Größe</option>
              {SENSOR_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Prop>
          <Prop label="Format">
            <select className="sdx-select" style={{ width: '100%' }} value={OUTPUT_PRESETS.find((p) => p.width === output.width && p.height === output.height)?.label || ''} onChange={(event) => { const p = OUTPUT_PRESETS.find((entry) => entry.label === event.target.value); if (p) run('scene.output', { width: p.width, height: p.height }); }}>
              <option value="">{output.width} × {output.height}</option>
              {OUTPUT_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
            </select>
          </Prop>
          <label className="sdx-check"><input type="checkbox" checked={ui.lockCameraToView} onChange={(event) => run('view.options', { lockCameraToView: event.target.checked })} data-automation-id="setdesign-lock-camera" /> Kamera an Ansicht sperren</label>
          <div className="sdx-note">Gesperrt bewegen Orbit, Verschieben, Zoom und Gehen (Shift+`) die Kamera selbst.</div>
        </div>
      )}
      <div className="sdx-left__section">
        <div className="sdx-left__title">Rahmen</div>
        <label className="sdx-check"><input type="checkbox" checked={ui.overlays.thirds} onChange={(event) => run('view.overlays', { thirds: event.target.checked })} /> Drittel</label>
        <label className="sdx-check"><input type="checkbox" checked={ui.overlays.safeAreas} onChange={(event) => run('view.overlays', { safeAreas: event.target.checked })} /> Sicherheitsbereiche</label>
        <Prop label="Passepartout"><NumberField value={ui.overlays.passepartout} digits={2} step={0.05} min={0} max={1} slider onChange={(v) => run('view.overlays', { passepartout: v })} /></Prop>
      </div>
      <div className="sdx-left__section" data-automation-id="setdesign-capture-panel">
        <div className="sdx-left__title"><Camera size={14} /> Referenzframe</div>
        <div className="sdx-seg" style={{ width: '100%' }}>
          {([['beauty', 'Ansicht'], ['clay', 'Clay'], ['depth', 'Tiefe']] as const).map(([id, label]) => (
            <button key={id} type="button" style={{ flex: 1 }} className={capturePass === id ? 'is-on' : ''} onClick={() => setCapturePass(id)} data-automation-id={`setdesign-capture-pass-${id}`}>{label}</button>
          ))}
        </div>
        <Prop label="Storyboard">
          <select className="sdx-select" style={{ width: '100%' }} value={captureShot} onChange={(event) => setCaptureShot(event.target.value)} data-automation-id="setdesign-capture-shot">
            <option value="">kein Shot</option>
            {shotPrompts.map((shot) => <option key={shot.shot} value={shot.shot}>Shot {shot.shot}{shot.description ? ` – ${shot.description.slice(0, 32)}` : ''}</option>)}
          </select>
        </Prop>
        <Prop label="Referenz">
          <select className="sdx-select" style={{ width: '100%' }} value={captureReference} onChange={(event) => setCaptureReference(event.target.value)} data-automation-id="setdesign-capture-reference">
            <option value="">keine</option>
            {[...references].sort((a, b) => (a.type === 'environment' ? -1 : 0) - (b.type === 'environment' ? -1 : 0)).map((ref) => <option key={ref.id} value={ref.id}>{ref.type === 'environment' ? 'Location' : ref.type === 'character' ? 'Figur' : ref.type === 'product' ? 'Produkt' : 'Requisit'}: {ref.name}</option>)}
          </select>
        </Prop>
        <button type="button" className="sdx-btn sdx-btn--primary" disabled={capturing || !active} onClick={() => void capture()} data-automation-id="setdesign-capture"><Camera size={13} /> {capturing ? 'Rendert …' : `Aufnehmen (${output.width} × ${output.height})`}</button>
        <div className="sdx-note">Rendert die aktive Kamera ohne Raster und Symbole in die Medien. Clay = neutrales Grau, Tiefe = hell ist nah – gut als Struktur-Vorlage für Bild- und Edit-Modelle.</div>
        {lastCapture?.url && <img className="sdx-thumb" src={lastCapture.url} alt="Letzter Referenzframe" />}
        {active && (
          <div className="sdx-prompt" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <span style={{ flex: 1 }}>{describeCamera(active, output.width / output.height).en}</span>
            <button type="button" className="sdx-btn sdx-btn--icon" title="Kamerazeile für den Prompt kopieren" onClick={() => void navigator.clipboard?.writeText(describeCamera(active, output.width / output.height).en).catch(() => undefined)}><Copy size={12} /></button>
          </div>
        )}
      </div>
    </>
  );

  const lightPanel = (
    <>
      <div className="sdx-left__section">
        <div className="sdx-left__title"><Lightbulb size={14} /> Licht setzen</div>
        {LIGHT_PRESETS.map((preset) => (
          <button key={preset.label} type="button" className="sdx-tile" onClick={() => run('object.add_light', preset.args)} data-automation-id={`setdesign-light-preset-${preset.label}`}>
            <ObjectIcon type={String(preset.args.lightType)} />
            <span>{preset.label}<small>{preset.hint}</small></span>
          </button>
        ))}
      </div>
      <div className="sdx-left__section">
        <div className="sdx-left__title">Lichter im Set</div>
        {scene.lights.filter((l) => l.type !== 'ambient').length === 0 && <div className="sdx-note">Noch keine Lichter.</div>}
        {scene.lights.filter((l) => l.type !== 'ambient').map((light) => (
          <div key={light.id} className={`sdx-list-item${ui.selectedIds.includes(light.id) ? ' is-on' : ''}`} onClick={() => run('select.set', { objects: [light.id] })}>
            <ObjectIcon type={light.type === 'directional' ? 'sun' : light.type} />
            <span style={{ flex: 1 }}>{light.name}</span>
            <span className="sdx-note">{light.useTemperature ? `${light.temperature} K` : ''}</span>
          </div>
        ))}
      </div>
      <div className="sdx-left__section">
        <div className="sdx-left__title">Welt</div>
        <Prop label="Umgebung"><NumberField value={scene.world?.strength ?? 0.6} digits={2} step={0.05} min={0} max={5} onBegin={() => bus.beginInteraction('Welt')} onEnd={(c) => bus.endInteraction(c)} onChange={(v) => run('scene.world', { strength: v })} /></Prop>
        <div className="sdx-note">Der Licht-Tab schaltet auf „Gerendert“: Schatten und Lichtfarben wie im Referenzframe.</div>
      </div>
    </>
  );

  const assetsPanel = (
    <>
      <div className="sdx-left__section">
        <div className="sdx-left__title"><Upload size={14} /> Importieren</div>
        <button type="button" className="sdx-btn sdx-btn--primary" onClick={() => fileInputRef.current?.click()} data-automation-id="setdesign-import-file"><Upload size={13} /> Datei (GLB, glTF, OBJ, FBX)</button>
        <div style={{ display: 'flex', gap: 4 }}>
          <input className="sdx-input" style={{ flex: 1 }} placeholder="https://…/modell.glb" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter' && urlInput.trim()) { run('object.add_model', { url: urlInput.trim() }); setUrlInput(''); } }} data-automation-id="setdesign-import-url" />
          <button type="button" className="sdx-btn" onClick={() => { if (urlInput.trim()) { run('object.add_model', { url: urlInput.trim() }); setUrlInput(''); } }}><Link size={13} /></button>
        </div>
      </div>
      <div className="sdx-left__section">
        <div className="sdx-left__title">Grundkörper</div>
        <div className="sdx-grid2">
          {PRIMITIVES.map((p) => (
            <button key={p.id} type="button" className="sdx-tile" onClick={() => run('object.add_primitive', { primitive: p.id })} title={p.hint} data-automation-id={`setdesign-asset-${p.id}`}>
              <ObjectIcon type={p.id} /> <span>{p.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="sdx-left__section">
        <div className="sdx-left__title"><ImageIcon size={14} /> Bibliothek</div>
        {libraryModels.length === 0 && <div className="sdx-note">Keine 3D-Modelle in der Bibliothek.</div>}
        {libraryModels.map((asset) => (
          <div key={asset.id} className="sdx-list-item" onClick={() => run('object.add_model', { url: asset.url, name: asset.name.replace(/\.[^.]+$/, '') })}>
            <ObjectIcon type="model" /> <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</span> <span className="sdx-note">{asset.projectName}</span>
          </div>
        ))}
      </div>
      <div className="sdx-left__section">
        <div className="sdx-left__title"><Sparkles size={14} /> KI-Werkzeuge</div>
        <div className="sdx-note">KI-Blockout aus einem Referenzbild (Hunyuan3D, Trellis, Rodin), World-Labs-Welten, Sketchfab-Suche, HDRI und Render-Presets sind im Tab „Klassisch“. Was dort entsteht, erscheint hier im selben Set.</div>
        <button type="button" className="sdx-btn" onClick={() => run('workspace.tab', { tab: 'classic' })}>Zu „Klassisch“</button>
      </div>
    </>
  );

  // ------------------------------------------------------------------ render

  const tools: Array<{ id: SetDesignUiState['tool']; label: string; icon: React.ReactNode; key: string }> = [
    { id: 'select', label: 'Auswählen', icon: <MousePointer2 size={16} />, key: 'W' },
    { id: 'move', label: 'Verschieben', icon: <Move size={16} />, key: 'G' },
    { id: 'rotate', label: 'Drehen', icon: <Rotate3d size={16} />, key: 'R' },
    { id: 'scale', label: 'Skalieren', icon: <Scale3d size={16} />, key: 'S' },
    { id: 'transform', label: 'Transformieren', icon: <Move3d size={16} />, key: '' },
  ];
  const leftPanel = tab === 'camera' ? cameraPanel : tab === 'lighting' ? lightPanel : tab === 'assets' ? assetsPanel : null;
  const history = bus.history();
  const menuData = menuItems();

  return (
    <div
      ref={rootRef}
      className="sdx-root"
      data-automation-id="setdesign-root"
      onPointerMove={(event) => { pointerRef.current = { x: event.clientX, y: event.clientY, inside: true }; }}
      onPointerLeave={() => { pointerRef.current.inside = false; }}
    >
      <div className="sdx-topbar">
        <span className="sdx-topbar__title">Set Design</span>
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`sdx-tab${tab === t.id ? ' sdx-tab--active' : ''}`} onClick={() => run('workspace.tab', { tab: t.id })} data-automation-id={`setdesign-tab-${t.id}`}>{t.label}</button>
        ))}
        <span className="sdx-topbar__spacer" />
        {tab !== 'classic' && (
          <>
            <button type="button" className="sdx-btn sdx-btn--icon" title={history.undo.length ? `Rückgängig: ${history.undo[history.undo.length - 1]} (Strg+Z)` : 'Rückgängig'} disabled={!history.undo.length} onClick={() => run('edit.undo')} data-automation-id="setdesign-undo"><Undo2 size={14} /></button>
            <button type="button" className="sdx-btn sdx-btn--icon" title={history.redo.length ? `Wiederholen: ${history.redo[history.redo.length - 1]}` : 'Wiederholen'} disabled={!history.redo.length} onClick={() => run('edit.redo')} data-automation-id="setdesign-redo"><Redo2 size={14} /></button>
            <span className="sdx-topbar__meta">{output.width} × {output.height}</span>
            <button type="button" className="sdx-btn sdx-btn--primary" disabled={capturing || !active} onClick={() => void capture()} title="Aktive Kamera als Referenzframe in die Medien (F12)" data-automation-id="setdesign-topbar-capture"><Camera size={13} /> Referenzframe</button>
          </>
        )}
      </div>

      {tab === 'classic' ? (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--app-bg, #fff)', colorScheme: 'normal' }}>{classic}</div>
      ) : (
        <div className="sdx-body">
          {leftPanel && !maximized && <aside className="sdx-left">{leftPanel}</aside>}
          <div className="sdx-main">
            <div className="sdx-areahead" data-automation-id="setdesign-viewport-header">
              <span className="sdx-mode">Objektmodus</span>
              {Object.keys(headerMenus).map((name) => (
                <button key={name} type="button" className={`sdx-menu-btn${menu?.kind === 'header' && menu.header === name ? ' is-open' : ''}`} onClick={(event) => { const r = event.currentTarget.getBoundingClientRect(); openMenu('header', name, { x: r.left, y: r.bottom + 2 }); }} data-automation-id={`setdesign-menu-${name}`}>{name}</button>
              ))}
              <span style={{ flex: 1 }} />
              <div className="sdx-seg" title="Ausrichtung des Gizmos">
                <button type="button" className={ui.orientation === 'global' ? 'is-on' : ''} onClick={() => run('view.options', { orientation: 'global' })}>Global</button>
                <button type="button" className={ui.orientation === 'local' ? 'is-on' : ''} onClick={() => run('view.options', { orientation: 'local' })}>Lokal</button>
              </div>
              <button type="button" className={`sdx-btn sdx-btn--icon${ui.snap ? ' sdx-btn--on' : ''}`} title="Einrasten (Strg hält es beim Ziehen umgekehrt)" onClick={() => run('view.options', { snap: !ui.snap })} data-automation-id="setdesign-snap"><Magnet size={14} /></button>
              <button type="button" className="sdx-menu-btn" onClick={(event) => {
                const r = event.currentTarget.getBoundingClientRect();
                setMenu({ kind: 'header', header: 'Überlagerungen', x: r.left, y: r.bottom + 2 });
              }}>Überlagerungen <ChevronDown size={11} /></button>
              <div className="sdx-seg" title="Shading (Z)" data-automation-id="setdesign-shading">
                {([['wireframe', <Globe key="w" size={14} />, 'Drahtgitter'], ['solid', <Circle key="s" size={14} fill="currentColor" />, 'Solid'], ['material', <Palette key="m" size={14} />, 'Materialvorschau'], ['rendered', <SunMedium key="r" size={14} />, 'Gerendert']] as const).map(([mode, icon, label]) => (
                  <button key={mode} type="button" title={label} className={(scene.shading || 'solid') === mode ? 'is-on' : ''} onClick={() => run('view.shading', { mode })} data-automation-id={`setdesign-shading-${mode}`}>{icon}</button>
                ))}
              </div>
            </div>
            <Viewport3D
              ref={viewportRef}
              scene={scene}
              ui={ui}
              onToast={showToast}
              onContextMenu={(x, y) => openMenu('context', undefined, { x, y })}
              onStatusMode={setStatusMode}
            >
              {ui.toolbar && (
                <div className="sdx-toolbar" data-automation-id="setdesign-toolbar">
                  {tools.map((t) => (
                    <button key={t.id} type="button" title={`${t.label}${t.key ? ` (${t.key})` : ''}`} className={ui.tool === t.id ? 'is-on' : ''} onClick={() => run('tool.set', { tool: t.id })} data-automation-id={`setdesign-tool-${t.id}`}>{t.icon}</button>
                  ))}
                  <hr />
                  <button type="button" title="Kamera aus Ansicht hinzufügen" onClick={addCameraFromView}><Video size={16} /></button>
                  <button type="button" title="Gehen (Shift+`)" onClick={() => viewportRef.current?.startWalk()}><Footprints size={16} /></button>
                </div>
              )}
              {ui.sidebar && (
                <div className="sdx-vp-sidebar" data-automation-id="setdesign-sidebar">
                  <Panel title="Ansicht">
                    <Prop label="Brennweite"><NumberField value={lensForVerticalFov(scene.camera.fov || 45, { sensorWidthMm: 36 }, 16 / 9)} unit="mm" digits={0} step={1} min={5} max={250} onChange={(mm) => run('view.set', { fov: verticalFovDeg({ lensMm: mm, sensorWidthMm: 36 }, 16 / 9) })} title="Brennweite der freien Ansicht (Vollformat, 16:9)" /></Prop>
                    <label className="sdx-check"><input type="checkbox" checked={ui.lockCameraToView} onChange={(event) => run('view.options', { lockCameraToView: event.target.checked })} /> Kamera an Ansicht sperren</label>
                    <label className="sdx-check"><input type="checkbox" checked={ui.emulateNumpad} onChange={(event) => run('view.options', { emulateNumpad: event.target.checked })} /> Ziffern als Numpad</label>
                  </Panel>
                </div>
              )}
              {toast && <div className="sdx-vp-toast" data-automation-id="setdesign-toast">{toast}</div>}
            </Viewport3D>
          </div>
          {!maximized && (
            <div className="sdx-side">
              <Outliner scene={scene} ui={ui} onError={showToast} renamingId={renamingId} setRenamingId={setRenamingId} />
              <PropertiesEditor scene={scene} ui={ui} onError={showToast} preferredTab={tab === 'camera' && activeObject?.kind === 'camera' ? 'data' : tab === 'lighting' && activeObject?.kind === 'light' ? 'data' : null} />
            </div>
          )}
        </div>
      )}

      {tab !== 'classic' && (
        <div className="sdx-status" data-automation-id="setdesign-status">
          {STATUS_HINTS[statusMode].map((hint) => {
            const [keys, label] = hint.split(': ');
            return <span key={hint}><b>{keys}</b> {label}</span>;
          })}
          <span className="sdx-status__right">
            {scene.assets.length} Objekte · {active ? `${active.name} ${Math.round(active.lensMm)} mm` : 'keine Kamera'}{history.undo.length ? ` · Zuletzt: ${history.undo[history.undo.length - 1]}` : ''}
          </span>
        </div>
      )}

      {menu && (
        menu.kind === 'header' && menu.header === 'Überlagerungen' ? (
          <Popup x={menu.x} y={menu.y} title="Überlagerungen" onClose={() => setMenu(null)} items={[
            { label: `${ui.overlays.grid ? '✓ ' : ''}Bodenraster`, onSelect: () => run('view.overlays', { grid: !ui.overlays.grid }) },
            { label: `${ui.overlays.cameraFrames ? '✓ ' : ''}Kamerasymbole`, onSelect: () => run('view.overlays', { cameraFrames: !ui.overlays.cameraFrames }) },
            { label: `${ui.overlays.thirds ? '✓ ' : ''}Drittel (Kamera)`, onSelect: () => run('view.overlays', { thirds: !ui.overlays.thirds }) },
            { label: `${ui.overlays.safeAreas ? '✓ ' : ''}Sicherheitsbereiche (Kamera)`, onSelect: () => run('view.overlays', { safeAreas: !ui.overlays.safeAreas }) },
          ]} />
        ) : (
          <Popup x={menu.x} y={menu.y} title={menuData.title} items={menuData.items} onClose={() => setMenu(null)} automationId={`setdesign-popup-${menu.kind}`} />
        )
      )}
      <input ref={fileInputRef} type="file" accept={MODEL_IMPORT_ACCEPT} hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.currentTarget.value = ''; }} />
    </div>
  );
};

export default SetProWorkspace;
