/**
 * Classic Scene Map overview (pixel elements) → blocking commands for the camera plan.
 * 50 px = 1 m (the overview's grid cell); overview rotation is clockwise on screen.
 */
import type { SceneMapScene } from '../types';

export const OVERVIEW_PX_PER_M = 50;

export const importOverviewScene = (scene: SceneMapScene): Array<{ command: string; params: Record<string, unknown> }> => {
  const out: Array<{ command: string; params: Record<string, unknown> }> = [];
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  if (!elements.length) return out;
  // Centre the imported layout on the origin.
  const xs = elements.map((e) => (e.position?.x ?? 0) + (e.size?.width ?? 0) / 2);
  const ys = elements.map((e) => (e.position?.y ?? 0) + (e.size?.height ?? 0) / 2);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const e of elements.slice(0, 300)) {
    const x = ((e.position?.x ?? 0) + (e.size?.width ?? 0) / 2 - cx) / OVERVIEW_PX_PER_M;
    const z = ((e.position?.y ?? 0) + (e.size?.height ?? 0) / 2 - cy) / OVERVIEW_PX_PER_M;
    const yawDeg = -(Number.isFinite(e.rotation) ? e.rotation : 0);
    const label = e.label || '';
    const w = Math.max(0.2, (e.size?.width ?? 50) / OVERVIEW_PX_PER_M);
    const d = Math.max(0.2, (e.size?.height ?? 50) / OVERVIEW_PX_PER_M);
    switch (e.type) {
      case 'character':
        out.push({ command: 'character.add', params: { name: label || 'Figur', x, z, yawDeg, ...(e.referenceId ? { referenceId: e.referenceId } : {}) } });
        break;
      case 'camera':
        out.push({ command: 'camera.add', params: { x, z, yawDeg, ...(label && label.length <= 3 ? { name: label } : {}) } });
        break;
      case 'light':
        out.push({ command: 'plan.addElement', params: { category: 'light', x, z, yawDeg, label: label || 'Licht' } });
        break;
      case 'area':
      case 'environment':
        out.push({ command: 'plan.addElement', params: { category: 'rug', x, z, w, d, yawDeg, label: label || 'Bereich' } });
        break;
      default:
        out.push({ command: 'plan.addElement', params: { category: 'box', x, z, w: Math.min(w, 3), d: Math.min(d, 3), yawDeg, label: label || 'Requisite' } });
    }
  }
  return out;
};
