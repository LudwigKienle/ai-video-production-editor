/**
 * Tools panel definition: tool ids, German labels, groups (flyouts) and the
 * single-key shortcuts. Shift+key cycles through a group like Photoshop.
 */

export type ToolId =
  | 'move'
  | 'marquee-rect' | 'marquee-ellipse'
  | 'lasso' | 'lasso-poly'
  | 'object-select'
  | 'crop'
  | 'eyedropper'
  | 'spot-heal'
  | 'brush'
  | 'clone-stamp'
  | 'eraser'
  | 'gradient'
  | 'dodge' | 'burn'
  | 'text'
  | 'hand'
  | 'zoom';

export type ToolInfo = { id: ToolId; label: string; hint: string; cursor: string };

export const TOOL_INFO: Record<ToolId, ToolInfo> = {
  move: { id: 'move', label: 'Verschieben-Werkzeug', hint: 'Aktive Ebene ziehen; Pfeiltasten verschieben um 1 px (Umschalt: 10 px).', cursor: 'move' },
  'marquee-rect': { id: 'marquee-rect', label: 'Auswahlrechteck-Werkzeug', hint: 'Ziehen für eine Auswahl. Umschalt: Quadrat bzw. hinzufügen, Alt: aus der Mitte bzw. subtrahieren.', cursor: 'crosshair' },
  'marquee-ellipse': { id: 'marquee-ellipse', label: 'Auswahlellipse-Werkzeug', hint: 'Ziehen für eine elliptische Auswahl. Umschalt: Kreis, Alt: aus der Mitte.', cursor: 'crosshair' },
  lasso: { id: 'lasso', label: 'Lasso-Werkzeug', hint: 'Freihand um einen Bereich ziehen.', cursor: 'crosshair' },
  'lasso-poly': { id: 'lasso-poly', label: 'Polygon-Lasso-Werkzeug', hint: 'Punkte setzen, Doppelklick oder Eingabe schließt die Auswahl.', cursor: 'crosshair' },
  'object-select': { id: 'object-select', label: 'Objektauswahl-Werkzeug (KI)', hint: 'Motiv auswählen per KI-Freistellung (Replicate).', cursor: 'crosshair' },
  crop: { id: 'crop', label: 'Freistellungswerkzeug', hint: 'Griffe ziehen, Eingabe bestätigt, Esc bricht ab.', cursor: 'crosshair' },
  eyedropper: { id: 'eyedropper', label: 'Pipette-Werkzeug', hint: 'Klick nimmt die Vordergrundfarbe auf, Alt+Klick die Hintergrundfarbe.', cursor: 'crosshair' },
  'spot-heal': { id: 'spot-heal', label: 'Bereichsreparatur-Pinsel (KI)', hint: 'Über Störendes malen, dann „Reparieren“ – die KI rekonstruiert den Bereich.', cursor: 'none' },
  brush: { id: 'brush', label: 'Pinsel-Werkzeug', hint: 'Malt mit der Vordergrundfarbe auf die aktive Ebene. [ und ] ändern die Größe.', cursor: 'none' },
  'clone-stamp': { id: 'clone-stamp', label: 'Kopierstempel-Werkzeug', hint: 'Alt+Klick setzt die Quelle, dann malen.', cursor: 'none' },
  eraser: { id: 'eraser', label: 'Radiergummi-Werkzeug', hint: 'Löscht Pixel der aktiven Ebene (Transparenz).', cursor: 'none' },
  gradient: { id: 'gradient', label: 'Verlaufswerkzeug', hint: 'Ziehen: Verlauf von Vorder- zu Hintergrundfarbe (in der Auswahl).', cursor: 'crosshair' },
  dodge: { id: 'dodge', label: 'Abwedler-Werkzeug', hint: 'Hellt Bereiche auf.', cursor: 'none' },
  burn: { id: 'burn', label: 'Nachbelichter-Werkzeug', hint: 'Dunkelt Bereiche ab.', cursor: 'none' },
  text: { id: 'text', label: 'Horizontales Textwerkzeug', hint: 'Klicken erstellt eine Textebene; Klick auf Text bearbeitet ihn. Esc beendet.', cursor: 'text' },
  hand: { id: 'hand', label: 'Hand-Werkzeug', hint: 'Ansicht verschieben (auch mit gedrückter Leertaste).', cursor: 'grab' },
  zoom: { id: 'zoom', label: 'Zoom-Werkzeug', hint: 'Klick zoomt ein, Alt+Klick zoomt aus.', cursor: 'zoom-in' },
};

export type ToolGroup = { id: string; key: string; tools: ToolId[] };

/** Order of the single-column tools panel; `gap` draws a divider before the group. */
export const TOOL_GROUPS: Array<ToolGroup & { gap?: boolean }> = [
  { id: 'move', key: 'V', tools: ['move'] },
  { id: 'marquee', key: 'M', tools: ['marquee-rect', 'marquee-ellipse'] },
  { id: 'lasso', key: 'L', tools: ['lasso', 'lasso-poly'] },
  { id: 'select', key: 'W', tools: ['object-select'] },
  { id: 'crop', key: 'C', tools: ['crop'] },
  { id: 'eyedropper', key: 'I', tools: ['eyedropper'], gap: true },
  { id: 'heal', key: 'J', tools: ['spot-heal'] },
  { id: 'brush', key: 'B', tools: ['brush'] },
  { id: 'stamp', key: 'S', tools: ['clone-stamp'] },
  { id: 'eraser', key: 'E', tools: ['eraser'] },
  { id: 'gradient', key: 'G', tools: ['gradient'] },
  { id: 'dodge', key: 'O', tools: ['dodge', 'burn'] },
  { id: 'type', key: 'T', tools: ['text'], gap: true },
  { id: 'hand', key: 'H', tools: ['hand'], gap: true },
  { id: 'zoom', key: 'Z', tools: ['zoom'] },
];

export const groupOfTool = (tool: ToolId) => TOOL_GROUPS.find((group) => group.tools.includes(tool))!;

/**
 * Resolve a key press to a tool. Same group + Shift cycles; otherwise the
 * last-used tool of that group is selected (like Photoshop's flyouts).
 */
export function toolForShortcut(
  key: string,
  shift: boolean,
  current: ToolId,
  lastUsed: Partial<Record<string, ToolId>> = {},
): ToolId | null {
  const group = TOOL_GROUPS.find((g) => g.key === key.toUpperCase());
  if (!group) return null;
  const inGroup = group.tools.includes(current);
  if (inGroup && shift && group.tools.length > 1) {
    const next = (group.tools.indexOf(current) + 1) % group.tools.length;
    return group.tools[next];
  }
  if (inGroup) return current;
  const remembered = lastUsed[group.id];
  return remembered && group.tools.includes(remembered) ? remembered : group.tools[0];
}

export const PAINT_TOOLS: ToolId[] = ['brush', 'eraser', 'clone-stamp', 'dodge', 'burn', 'spot-heal'];
export const SELECTION_TOOLS: ToolId[] = ['marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-poly', 'object-select'];
export const isPaintTool = (tool: ToolId) => PAINT_TOOLS.includes(tool);
export const isSelectionTool = (tool: ToolId) => SELECTION_TOOLS.includes(tool);
/** Tools that write pixels into the active raster layer. */
export const writesPixels = (tool: ToolId) => ['brush', 'eraser', 'clone-stamp', 'dodge', 'burn', 'gradient'].includes(tool);
