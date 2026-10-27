/**
 * MCP tools for the Scene Map (Shot Designer–style blocking and camera plan).
 *
 * Every blocking command becomes its own tool (`scene_map_<group>_<action>`), so an agent can do what
 * a user does in the floor plan; on top come read, time, undo, view, storyboard and export tools and
 * the classic Scene Map overview. State is the shared set design (also used by the 3D set design),
 * reached through the Scene Map bridge that App.tsx binds.
 */
import { registerStudioToolModule, type JsonSchema, type StudioTool, type StudioToolModule } from '../toolModules.ts';
import { BLOCKING_COMMANDS, TEMPLATES, commandJsonSchema, describeCommands } from '../../shotdesigner/commands.ts';
import { planElements, PLAN_LIBRARY } from '../../shotdesigner/planModel.ts';
import { cameraFovDeg, camerasAt, charactersAt, finite } from '../../scene/stageModel.ts';
import { axisWarnings } from '../../shotdesigner/shotGeometry.ts';
import { orderedShots, shotRows } from '../../shotdesigner/shotList.ts';
import { planToSvg } from '../../shotdesigner/planScene.ts';
import { cameraViewToSvg, renderCameraView } from '../../shotdesigner/cameraView.ts';
import { exportSceneMap, renderFrameUrl, type SceneMapExportFormat } from '../../shotdesigner/exportService.ts';
import { syncStoryboard } from '../../shotdesigner/storyboardLink.ts';
import { bytesToBase64 } from '../../shotdesigner/raster.ts';
import { importOverviewScene } from '../../shotdesigner/overviewImport.ts';
import {
  dispatch,
  dispatchBatch,
  getBridge,
  getHost,
  getSession,
  historyState,
  redo,
  setTime,
  undo,
  updateSession,
  type SceneMapView,
} from '../../shotdesigner/session.ts';
import { createDefaultScene, createDefaultSceneMapState, createSceneMapElement } from '../../data/sceneMapTypes.ts';
import type { SceneMapElementType, SceneMapState } from '../../types';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** 'plan.addElement' → 'scene_map_plan_add_element' */
export const toolNameForCommand = (id: string) => `scene_map_${id.replace(/\./g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}`;

const requireOk = (out: { ok: boolean; error?: string }) => {
  if (!out.ok) throw new Error(out.error || 'Befehl fehlgeschlagen.');
};

/** Compact, agent-friendly reading of the plan at a time. */
export const describePlan = (timeS?: number) => {
  const host = getHost();
  const t = timeS === undefined ? getSession().timeS : timeS;
  const stage = host.stage;
  const chars = charactersAt(stage, t);
  const cams = camerasAt(stage, t, chars);
  const aspect = stage.aspectRatio || 16 / 9;
  return {
    units: 'Meter; Draufsicht x nach rechts, z nach unten (Süden); yawDeg 0 = Blick nach oben/Norden (-z), positiv = gegen den Uhrzeigersinn',
    timeS: r2(t),
    durationS: stage.animation.durationS,
    fps: stage.animation.fps,
    aspectRatio: r2(aspect),
    activeCameraId: stage.activeCameraId ?? null,
    selection: getSession().selection,
    elements: planElements(host).map((e) => ({ id: e.id, category: e.category, label: e.label, x: r2(e.x), z: r2(e.z), w: r2(e.w), d: r2(e.d), h: r2(e.h), yawDeg: r2(e.yawDeg), from3d: e.source === 'model' })),
    characters: chars.map((c) => ({ id: c.id, name: c.name, x: r2(c.position.x), z: r2(c.position.z), yawDeg: r2(c.yawDeg), heightM: c.heightM, posture: c.posture, referenceId: c.referenceId ?? null, keyCount: stage.animation.tracks[c.id]?.length ?? 0 })),
    cameras: cams.map((c) => ({ id: c.id, name: c.name, x: r2(c.position.x), z: r2(c.position.z), heightM: r2(c.position.y), yawDeg: r2(c.yawDeg), pitchDeg: r2(c.pitchDeg), focalLengthMm: r2(c.focalLengthMm), horizontalFovDeg: r2(cameraFovDeg(c, aspect).horizontal), followId: c.followId ?? null, keyCount: stage.animation.tracks[c.id]?.length ?? 0 })),
    tracks: Object.fromEntries(Object.entries(stage.animation.tracks).map(([id, keys]) => [id, keys.map((k) => ({ keyId: k.id, timeS: r2(k.timeS), x: r2(k.position.x), z: r2(k.position.z), yawDeg: r2(k.yawDeg), ...(k.focalLengthMm !== undefined ? { focalLengthMm: r2(k.focalLengthMm) } : {}), easing: k.easing }))])),
    lineOfAction: stage.lineOfAction ?? null,
    shots: shotRows(stage).map((row) => ({ id: row.id, code: row.code, camera: row.cameraName, size: row.sizeLabel, lensMm: Math.round(row.lensMm), move: row.moveLabel, subjects: row.subjectNames, startS: row.startS, endS: row.endS, description: row.description, shootOrder: row.shootOrder, storyboardShot: row.storyboardShot })),
    axisWarnings: axisWarnings(stage, orderedShots(stage)).map((w) => w.message),
    snapshots: (stage.snapshots || []).map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt })),
    history: historyState(),
  };
};

const withTime = (schema: ReturnType<typeof commandJsonSchema>): JsonSchema => ({
  type: 'object',
  properties: { ...(schema.properties as Record<string, JsonSchema>), atTimeS: { type: 'number', description: 'Optional: Playhead vorher auf diese Zeit (s) setzen.' } },
  required: schema.required,
});

const COMMAND_TOOLS: StudioTool[] = BLOCKING_COMMANDS.map((command) => ({
  name: toolNameForCommand(command.id),
  description: `Scene Map · ${command.group}: ${command.description}${command.shortcut ? ` (Taste ${command.shortcut})` : ''}`,
  writes: true,
  destructive: command.id === 'object.delete' || command.id === 'shot.delete' || command.id === 'key.delete' || command.id === 'track.clear' || undefined,
  parameters: withTime(commandJsonSchema(command)),
  handler: (args) => {
    if (args.atTimeS !== undefined) setTime(finite(args.atTimeS, 0));
    const out = dispatch(command.id, args);
    requireOk(out);
    return { command: command.id, ...(out.result || {}), timeS: getSession().timeS };
  },
}));

const overviewState = (): SceneMapState => {
  const b = getBridge();
  const s = b?.getSceneMap?.();
  return s && Array.isArray(s.scenes) && s.scenes.length ? s : createDefaultSceneMapState();
};
const setOverview = (next: SceneMapState) => {
  const b = getBridge();
  if (!b?.setSceneMap) throw new Error('Scene-Map-Übersicht ist nicht verbunden.');
  b.setSceneMap(next);
};
const OVERVIEW_TYPES: SceneMapElementType[] = ['character', 'prop', 'environment', 'camera', 'light', 'area'];

const EXTRA_TOOLS: StudioTool[] = [
  {
    name: 'scene_map_get_plan',
    description: 'Scene Map (Kameraplan) lesen: Set-Elemente, Figuren, Kameras mit Brennweite und Bildwinkel, Bewegungsmarken, 180°-Linie, Shot-Liste, Achssprung-Warnungen, Playhead, Auswahl. Zuerst aufrufen. timeS liest den Stand zu einer anderen Zeit.',
    parameters: { type: 'object', properties: { timeS: { type: 'number', description: 'Zeitpunkt in s (Standard: Playhead).' } } },
    handler: (args) => describePlan(args.timeS === undefined ? undefined : finite(args.timeS, 0)),
  },
  {
    name: 'scene_map_list_commands',
    description: 'Alle Scene-Map-Befehle mit Gruppe, Tastenkürzel und Parametern; jeder Befehl hat auch ein eigenes Tool scene_map_<gruppe>_<aktion>.',
    parameters: { type: 'object', properties: {} },
    handler: () => ({ commands: describeCommands().map((c) => ({ ...c, tool: toolNameForCommand(c.id) })), elementCategories: PLAN_LIBRARY.map((e) => ({ category: e.category, label: e.label, w: e.w, d: e.d, h: e.h })), templates: TEMPLATES }),
  },
  {
    name: 'scene_map_run_commands',
    description: 'Mehrere Scene-Map-Befehle als ein Schritt (ein Rückgängig-Eintrag), z. B. Raum + Figuren + Kameras auf einmal. Bricht beim ersten Fehler ab, ohne etwas zu ändern.',
    writes: true,
    parameters: { type: 'object', properties: { commands: { type: 'array', description: 'Liste von { command: "character.add", params: {…} }.', items: { type: 'object' } } }, required: ['commands'] },
    handler: (args) => {
      const list = Array.isArray(args.commands) ? (args.commands as Array<{ command: string; params?: Record<string, unknown> }>) : [];
      const out = dispatchBatch(list);
      requireOk(out);
      return { steps: out.results?.length ?? 0, results: out.results ?? [] };
    },
  },
  {
    name: 'scene_map_set_time',
    description: 'Playhead der Szene setzen (s). Verschieben/Drehen setzt bei animierten Objekten die Marke zu dieser Zeit.',
    parameters: { type: 'object', properties: { timeS: { type: 'number', description: 'Zeit in Sekunden.' } }, required: ['timeS'] },
    handler: (args) => { setTime(finite(args.timeS, 0)); return { timeS: getSession().timeS }; },
  },
  {
    name: 'scene_map_play',
    description: 'Blocking abspielen oder anhalten (Vorschau in der Scene Map). speed ändert das Abspieltempo.',
    parameters: { type: 'object', properties: { playing: { type: 'boolean', description: 'true = abspielen, false = anhalten.' }, speed: { type: 'number', description: 'Abspieltempo, 1 = Echtzeit.' } }, required: ['playing'] },
    handler: (args) => { updateSession({ playing: args.playing === true, ...(args.speed !== undefined ? { speed: finite(args.speed, 1, 0.1, 8) } : {}) }); return { playing: getSession().playing, speed: getSession().speed }; },
  },
  {
    name: 'scene_map_select',
    description: 'Objekte in der Scene Map auswählen (IDs von Figuren, Kameras, Elementen). Leere Liste hebt die Auswahl auf.',
    parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Objekt-IDs.' } }, required: ['ids'] },
    handler: (args) => { updateSession({ selection: Array.isArray(args.ids) ? (args.ids as unknown[]).filter((v): v is string => typeof v === 'string') : [], selectedKeyId: null }); return { selection: getSession().selection }; },
  },
  {
    name: 'scene_map_undo',
    description: 'Letzte Änderung am Kameraplan rückgängig machen (gilt für Benutzer und Agent gleich).',
    writes: true,
    parameters: { type: 'object', properties: {} },
    handler: () => ({ undone: undo(), ...historyState() }),
  },
  {
    name: 'scene_map_redo',
    description: 'Rückgängig gemachte Änderung am Kameraplan wiederholen.',
    writes: true,
    parameters: { type: 'object', properties: {} },
    handler: () => ({ redone: redo(), ...historyState() }),
  },
  {
    name: 'scene_map_open',
    description: 'Scene Map öffnen und Ansicht wählen: plan (Kameraplan/Shot Designer), overview (klassische Übersicht), 3d (3D-Blockout).',
    parameters: { type: 'object', properties: { view: { type: 'string', enum: ['plan', 'overview', '3d'], description: 'Ansicht.' } } },
    handler: (args) => {
      const view = (['plan', 'overview', '3d'].includes(String(args.view)) ? args.view : 'plan') as SceneMapView;
      updateSession({ view });
      getBridge()?.openSceneMap?.();
      return { view };
    },
  },
  {
    name: 'scene_map_set_view_options',
    description: 'Anzeige im Kameraplan: Sichtkegel, Bewegungspfade, Raster, Beschriftungen, Storyboard-Frames ein/aus.',
    parameters: { type: 'object', properties: { showCones: { type: 'boolean' }, showPaths: { type: 'boolean' }, showGrid: { type: 'boolean' }, showLabels: { type: 'boolean' }, showFrames: { type: 'boolean' } } },
    handler: (args) => {
      const patch: Record<string, boolean> = {};
      for (const key of ['showCones', 'showPaths', 'showGrid', 'showLabels', 'showFrames']) if (typeof args[key] === 'boolean') patch[key] = args[key] as boolean;
      updateSession(patch);
      const s = getSession();
      return { showCones: s.showCones, showPaths: s.showPaths, showGrid: s.showGrid, showLabels: s.showLabels, showFrames: s.showFrames };
    },
  },
  {
    name: 'scene_map_list_shots',
    description: 'Shot-Liste aus dem Kameraplan: Code (1A, 1B …), Kamera, Einstellungsgröße, Objektiv, Bewegung, Perspektive, Figuren im Bild, Zeitbereich, Beschreibung, Storyboard-Verknüpfung; order=shoot (Drehfolge) oder setup.',
    parameters: { type: 'object', properties: { order: { type: 'string', enum: ['shoot', 'setup'] } } },
    handler: (args) => {
      const stage = getHost().stage;
      return {
        shots: shotRows(stage, args.order === 'setup' ? 'setup' : 'shoot').map(({ subjects, frameUrl, ...row }) => ({ ...row, subjects: subjects.map((s) => ({ id: s.id, name: s.name, size: s.size, depthM: r2(s.depthM) })), hasFrame: !!frameUrl })),
        axisWarnings: axisWarnings(stage, orderedShots(stage)).map((w) => w.message),
      };
    },
  },
  {
    name: 'scene_map_render_view',
    description: 'Sucherbild einer Kamera (schematische Perspektive mit echter Brennweite) als SVG plus PNG-data-URL in der App. Zum Prüfen der Kadrierung.',
    parameters: { type: 'object', properties: { cameraId: { type: 'string', description: 'Kamera-ID (Standard: aktive Kamera).' }, timeS: { type: 'number' }, widthPx: { type: 'number', description: 'Breite in px (Standard 960).' }, includePng: { type: 'boolean' } } },
    handler: async (args) => {
      const host = getHost();
      const t = args.timeS === undefined ? getSession().timeS : finite(args.timeS, 0);
      const frame = renderCameraView(host, typeof args.cameraId === 'string' ? args.cameraId : null, t, finite(args.widthPx, 960, 64, 4096));
      if (!frame) throw new Error('Keine Kamera im Plan.');
      const svg = cameraViewToSvg(frame, { info: `${frame.camera.name} · ${Math.round(frame.camera.focalLengthMm)} mm` });
      const png = args.includePng === false ? null : await renderFrameUrl(host, frame.camera.id, t, frame.width);
      return { cameraId: frame.camera.id, widthPx: frame.width, heightPx: frame.height, horizontalFovDeg: r2(frame.hFov), visible: frame.labels.map((l) => l.text), svg, pngDataUrl: png && png.startsWith('data:image/png') ? png : null };
    },
  },
  {
    name: 'scene_map_render_plan',
    description: 'Grundriss als SVG (Draufsicht mit Maßstab, Sichtkegeln, Pfaden) zu einem Zeitpunkt.',
    parameters: { type: 'object', properties: { timeS: { type: 'number' }, widthPx: { type: 'number' }, theme: { type: 'string', enum: ['light', 'dark'] } } },
    handler: (args) => {
      const out = planToSvg(getHost(), { timeS: args.timeS === undefined ? getSession().timeS : finite(args.timeS, 0), widthPx: finite(args.widthPx, 1600, 200, 8000), theme: args.theme === 'dark' ? 'dark' : 'light', title: getBridge()?.getProjectName?.() || 'Kameraplan' });
      return { svg: out.svg, widthPx: out.widthPx, heightPx: out.heightPx, boundsM: out.bounds };
    },
  },
  {
    name: 'scene_map_capture_frame',
    description: 'Sucherbild einer Kamera als Storyboard-Frame am Shot speichern (wird im Plan neben der Kamera und in der Shot-Liste gezeigt).',
    writes: true,
    parameters: { type: 'object', properties: { shotId: { type: 'string', description: 'Shot-ID oder Code wie 1A.' } }, required: ['shotId'] },
    handler: async (args) => {
      const host = getHost();
      const key = String(args.shotId || '');
      const shot = host.stage.shots.find((s) => s.id === key || `${s.number}${s.version}`.toUpperCase() === key.toUpperCase());
      if (!shot) throw new Error(`Kein Shot „${key}“.`);
      const url = await renderFrameUrl(host, shot.cameraId, shot.startS, 960, `${shot.number}${shot.version}`);
      if (!url) throw new Error('Sucherbild konnte nicht erzeugt werden.');
      requireOk(dispatch('shot.link', { id: shot.id, frameUrl: url }));
      return { shotId: shot.id, frame: url.slice(0, 40) };
    },
  },
  {
    name: 'scene_map_send_to_storyboard',
    description: 'Shots ins Storyboard übernehmen: legt Storyboard-Shots an oder aktualisiert verknüpfte (Beschreibung, Kamerawinkel, Objektiv, Figuren) und setzt das Sucherbild als Kompositionsreferenz. Ohne shotIds alle Shots.',
    writes: true,
    parameters: { type: 'object', properties: { shotIds: { type: 'array', items: { type: 'string' }, description: 'Shot-IDs oder Codes.' }, withFrames: { type: 'boolean', description: 'Sucherbild als Referenz mitgeben (Standard true).' } } },
    handler: async (args) => {
      const b = getBridge();
      if (!b?.getShotPrompts || !b.setShotPrompts) throw new Error('Storyboard ist nicht verbunden.');
      const host = getHost();
      const keys = Array.isArray(args.shotIds) ? (args.shotIds as unknown[]).map(String) : [];
      const ids = keys.length ? host.stage.shots.filter((s) => keys.includes(s.id) || keys.map((k) => k.toUpperCase()).includes(`${s.number}${s.version}`)).map((s) => s.id) : [];
      if (keys.length && !ids.length) throw new Error('Keiner der Shots gefunden.');
      const frames: Record<string, string> = {};
      if (args.withFrames !== false) {
        for (const s of host.stage.shots.filter((x) => !ids.length || ids.includes(x.id))) {
          if (s.frameUrl) continue;
          const url = await renderFrameUrl(host, s.cameraId, s.startS, 960, `${s.number}${s.version}`);
          if (url) frames[s.id] = url;
        }
      }
      const out = syncStoryboard(host.stage, b.getShotPrompts(), { shotIds: ids, frames, references: b.getReferences?.() });
      b.setShotPrompts(out.shotPrompts);
      const linkCommands = out.links.map((l) => ({ command: 'shot.link', params: { id: l.shotId, storyboardShot: l.storyboardShot, ...(frames[l.shotId] ? { frameUrl: frames[l.shotId] } : {}) } }));
      if (linkCommands.length) requireOk(dispatchBatch(linkCommands));
      return { links: out.links, storyboardShots: out.shotPrompts.length };
    },
  },
  {
    name: 'scene_map_export',
    description: 'Kameraplan exportieren: pdf (Grundriss + Shot-Liste + Storyboard), png/svg (Grundriss), csv/xlsx (Shot-Liste), json (ganze Szene). saveToProject legt die Datei im Projektordner unter exports/scene-map ab, sonst kommt der Inhalt zurück (Text oder base64).',
    parameters: { type: 'object', properties: { format: { type: 'string', enum: ['pdf', 'png', 'svg', 'csv', 'xlsx', 'json'] }, title: { type: 'string' }, saveToProject: { type: 'boolean' }, timeS: { type: 'number', description: 'Zeitpunkt für den Grundriss.' } }, required: ['format'] },
    handler: async (args) => {
      const format = String(args.format) as SceneMapExportFormat;
      if (!['pdf', 'png', 'svg', 'csv', 'xlsx', 'json'].includes(format)) throw new Error('Format: pdf, png, svg, csv, xlsx oder json.');
      const b = getBridge();
      const out = await exportSceneMap(getHost(), format, { title: typeof args.title === 'string' ? args.title : b?.getProjectName?.(), timeS: args.timeS === undefined ? 0 : finite(args.timeS, 0) });
      const isText = typeof out.data === 'string';
      const size = isText ? (out.data as string).length : (out.data as Uint8Array).length;
      if (args.saveToProject) {
        const folderPath = b?.getProjectPath?.();
        const api = (globalThis as { window?: { electron?: { writeProjectFile?: (p: unknown) => Promise<unknown> } } }).window?.electron;
        if (!folderPath || !api?.writeProjectFile) throw new Error('Speichern braucht ein gespeichertes Projekt in der Desktop-App.');
        const relativePath = `exports/scene-map/${out.fileName}`;
        await api.writeProjectFile({ folderPath, relativePath, data: isText ? out.data : bytesToBase64(out.data as Uint8Array), encoding: isText ? 'utf8' : 'base64' });
        return { saved: true, path: `${folderPath}/${relativePath}`, fileName: out.fileName, bytes: size, note: out.note };
      }
      const limit = 4_000_000;
      if (size > limit) throw new Error(`Export ist ${size} Byte groß – bitte saveToProject nutzen.`);
      return isText
        ? { fileName: out.fileName, mime: out.mime, text: out.data, note: out.note }
        : { fileName: out.fileName, mime: out.mime, base64: bytesToBase64(out.data as Uint8Array), bytes: size, note: out.note };
    },
  },
  {
    name: 'scene_map_import_overview',
    description: 'Elemente der klassischen Scene-Map-Übersicht (Figuren, Kameras, Requisiten, Licht, Bereiche) in den Kameraplan übernehmen (50 px = 1 m). Die Übersicht bleibt unverändert.',
    writes: true,
    parameters: { type: 'object', properties: { sceneId: { type: 'string', description: 'Szene der Übersicht (Standard: aktive).' } } },
    handler: (args) => {
      const state = overviewState();
      const scene = state.scenes.find((s) => s.id === args.sceneId) ?? state.scenes.find((s) => s.id === state.activeSceneId) ?? state.scenes[0];
      if (!scene) throw new Error('Keine Szene in der Übersicht.');
      const commands = importOverviewScene(scene);
      if (!commands.length) return { imported: 0 };
      const out = dispatchBatch(commands);
      requireOk(out);
      return { imported: commands.length, sceneId: scene.id };
    },
  },
  // Classic overview (beats and locations map)
  {
    name: 'scene_map_overview_get',
    description: 'Klassische Scene-Map-Übersicht lesen: Szenen-Tabs und ihre Elemente (Figur, Requisite, Umgebung, Kamera, Licht, Bereich) mit Pixel-Lage, Größe, Drehung, Cast-Referenz und verknüpften Storyboard-Shots.',
    parameters: { type: 'object', properties: {} },
    handler: () => {
      const state = overviewState();
      return { activeSceneId: state.activeSceneId ?? null, scenes: state.scenes.map((s) => ({ id: s.id, name: s.name, description: s.description || '', elements: s.elements })) };
    },
  },
  {
    name: 'scene_map_overview_add_scene',
    description: 'Neuen Szenen-Tab in der Scene-Map-Übersicht anlegen und aktivieren.',
    writes: true,
    parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } },
    handler: (args) => {
      const state = overviewState();
      const scene = { ...createDefaultScene(typeof args.name === 'string' && args.name ? args.name : `Scene ${state.scenes.length + 1}`), description: typeof args.description === 'string' ? args.description : '' };
      setOverview({ ...state, scenes: [...state.scenes, scene], activeSceneId: scene.id });
      return { sceneId: scene.id };
    },
  },
  {
    name: 'scene_map_overview_select_scene',
    description: 'Szenen-Tab der Übersicht aktivieren.',
    parameters: { type: 'object', properties: { sceneId: { type: 'string' } }, required: ['sceneId'] },
    handler: (args) => {
      const state = overviewState();
      if (!state.scenes.some((s) => s.id === args.sceneId)) throw new Error('Szene nicht gefunden.');
      setOverview({ ...state, activeSceneId: String(args.sceneId) });
      return { activeSceneId: args.sceneId };
    },
  },
  {
    name: 'scene_map_overview_add_element',
    description: 'Element in die Übersicht setzen (type character|prop|environment|camera|light|area, Lage in Pixel, optional Cast-/Location-Referenz).',
    writes: true,
    parameters: { type: 'object', properties: { type: { type: 'string', enum: OVERVIEW_TYPES }, x: { type: 'number' }, y: { type: 'number' }, label: { type: 'string' }, referenceId: { type: 'string' }, sceneId: { type: 'string' } }, required: ['type'] },
    handler: (args) => {
      const state = overviewState();
      const sceneId = typeof args.sceneId === 'string' ? args.sceneId : state.activeSceneId ?? state.scenes[0]?.id;
      const type = (OVERVIEW_TYPES.includes(args.type as SceneMapElementType) ? args.type : 'prop') as SceneMapElementType;
      const ref = typeof args.referenceId === 'string' ? getBridge()?.getReferences?.().find((r) => r.id === args.referenceId) : undefined;
      const el = createSceneMapElement(type, { x: finite(args.x, 200), y: finite(args.y, 200) }, { ...(args.label || ref?.name ? { label: String(args.label || ref?.name) } : {}), ...(ref ? { referenceId: ref.id, imageUrl: ref.imageUrl || undefined } : {}) });
      if (!state.scenes.some((s) => s.id === sceneId)) throw new Error('Szene nicht gefunden.');
      setOverview({ ...state, activeSceneId: state.activeSceneId ?? sceneId, scenes: state.scenes.map((s) => (s.id === sceneId ? { ...s, elements: [...s.elements, el] } : s)) });
      return { elementId: el.id, sceneId };
    },
  },
  {
    name: 'scene_map_overview_update_element',
    description: 'Übersichts-Element ändern: Lage, Größe, Drehung, Beschriftung, Farbe, verknüpfte Storyboard-Shots.',
    writes: true,
    parameters: { type: 'object', properties: { elementId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, rotation: { type: 'number' }, label: { type: 'string' }, color: { type: 'string' }, linkedShotNumbers: { type: 'array', items: { type: 'number' } } }, required: ['elementId'] },
    handler: (args) => {
      const state = overviewState();
      let found = false;
      const scenes = state.scenes.map((s) => ({
        ...s,
        elements: s.elements.map((e) => {
          if (e.id !== args.elementId) return e;
          found = true;
          return {
            ...e,
            position: { x: finite(args.x, e.position.x), y: finite(args.y, e.position.y) },
            size: { width: finite(args.width, e.size.width, 1, 5000), height: finite(args.height, e.size.height, 1, 5000) },
            rotation: finite(args.rotation, e.rotation),
            ...(typeof args.label === 'string' ? { label: args.label } : {}),
            ...(typeof args.color === 'string' ? { color: args.color } : {}),
            ...(Array.isArray(args.linkedShotNumbers) ? { linkedShotNumbers: (args.linkedShotNumbers as unknown[]).map(Number).filter(Number.isFinite) } : {}),
          };
        }),
      }));
      if (!found) throw new Error('Element nicht gefunden.');
      setOverview({ ...state, scenes });
      return { elementId: args.elementId };
    },
  },
  {
    name: 'scene_map_overview_delete_element',
    description: 'Element aus der Scene-Map-Übersicht entfernen.',
    writes: true,
    destructive: true,
    parameters: { type: 'object', properties: { elementId: { type: 'string' } }, required: ['elementId'] },
    handler: (args) => {
      const state = overviewState();
      const before = state.scenes.reduce((n, s) => n + s.elements.length, 0);
      const scenes = state.scenes.map((s) => ({ ...s, elements: s.elements.filter((e) => e.id !== args.elementId) }));
      if (scenes.reduce((n, s) => n + s.elements.length, 0) === before) throw new Error('Element nicht gefunden.');
      setOverview({ ...state, scenes });
      return { deleted: args.elementId };
    },
  },
];

export const SCENE_MAP_TOOL_MODULE: StudioToolModule = {
  id: 'scene-map',
  label: 'Scene Map (Kameraplan / Shot Designer)',
  tools: [...EXTRA_TOOLS, ...COMMAND_TOOLS],
};

registerStudioToolModule(SCENE_MAP_TOOL_MODULE);
