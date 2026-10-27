import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveKey } from './keymap.ts';
import { describeModal, editNumeric, nextConstraint, parseNumeric, snapValue, threeMask, FREE } from './modalTransform.ts';

const ctx = { hasSelection: true, lookThroughCamera: false, emulateNumpad: true };
const key = (k: string, code = '', mods: Record<string, boolean> = {}) => ({ key: k, code: code || (k.length === 1 ? `Key${k.toUpperCase()}` : k), ...mods });

test('numpad views, with the digit row emulating the numpad', () => {
  assert.deepEqual(resolveKey(key('1', 'Numpad1'), ctx), { type: 'command', command: 'view.preset', args: { view: 'front' } });
  assert.deepEqual(resolveKey(key('1', 'Digit1', { ctrlKey: true }), ctx), { type: 'command', command: 'view.preset', args: { view: 'back' } });
  assert.deepEqual(resolveKey(key('7', 'Digit7'), ctx), { type: 'command', command: 'view.preset', args: { view: 'top' } });
  assert.deepEqual(resolveKey(key('0', 'Digit0'), ctx), { type: 'command', command: 'view.camera' });
  assert.deepEqual(resolveKey(key('0', 'Numpad0', { ctrlKey: true, altKey: true }), ctx), { type: 'command', command: 'camera.from_view' });
  assert.deepEqual(resolveKey(key('0', 'Numpad0', { ctrlKey: true }), ctx), { type: 'ui', action: 'cameraFromSelection' });
  assert.equal(resolveKey(key('1', 'Digit1'), { ...ctx, emulateNumpad: false }), null);
});

test('transform, add, duplicate, delete, hide and select keys', () => {
  assert.deepEqual(resolveKey(key('g'), ctx), { type: 'modal', kind: 'grab' });
  assert.deepEqual(resolveKey(key('r'), ctx), { type: 'modal', kind: 'rotate' });
  assert.deepEqual(resolveKey(key('s'), ctx), { type: 'modal', kind: 'scale' });
  assert.equal(resolveKey(key('g'), { ...ctx, hasSelection: false }), null);
  assert.deepEqual(resolveKey(key('A', 'KeyA', { shiftKey: true }), ctx), { type: 'menu', menu: 'add' });
  assert.deepEqual(resolveKey(key('D', 'KeyD', { shiftKey: true }), ctx), { type: 'modal', kind: 'grab', duplicate: true });
  assert.deepEqual(resolveKey(key('x'), ctx), { type: 'menu', menu: 'delete' });
  assert.deepEqual(resolveKey(key('Delete'), ctx), { type: 'command', command: 'object.delete' });
  assert.deepEqual(resolveKey(key('h'), ctx), { type: 'command', command: 'object.hide' });
  // Alt+H on a Mac types "˙": the key code still identifies it.
  assert.deepEqual(resolveKey(key('˙', 'KeyH', { altKey: true }), ctx), { type: 'command', command: 'object.hide', args: { unhideAll: true } });
  assert.deepEqual(resolveKey(key('©', 'KeyG', { altKey: true }), ctx), { type: 'clear', what: 'location' });
  assert.deepEqual(resolveKey(key('a'), ctx), { type: 'command', command: 'select.all' });
  assert.deepEqual(resolveKey(key('z', 'KeyZ', { metaKey: true }), ctx), { type: 'command', command: 'edit.undo' });
  assert.deepEqual(resolveKey(key('z', 'KeyZ', { metaKey: true, shiftKey: true }), ctx), { type: 'command', command: 'edit.redo' });
  assert.deepEqual(resolveKey(key('z'), ctx), { type: 'menu', menu: 'shading' });
  assert.deepEqual(resolveKey(key('Home'), ctx), { type: 'command', command: 'view.frame', args: { what: 'all' } });
});

test('modal constraints toggle like Blender and map to three.js components', () => {
  const x = nextConstraint(FREE, 'x', false);
  assert.deepEqual(x, { axis: 'x', plane: false });
  assert.deepEqual(nextConstraint(x, 'x', false), FREE);
  assert.deepEqual(threeMask({ axis: 'z', plane: false }), { x: 0, y: 1, z: 0 });
  assert.deepEqual(threeMask({ axis: 'y', plane: false }), { x: 0, y: 0, z: 1 });
  assert.deepEqual(threeMask({ axis: 'z', plane: true }), { x: 1, y: 0, z: 1 });
});

test('numeric input, snapping and header text', () => {
  let text = '';
  for (const k of ['1', ',', '2', '5']) text = editNumeric(text, k)!;
  assert.equal(text, '1.25');
  assert.equal(editNumeric(text, '-'), '-1.25');
  assert.equal(editNumeric('1.25', 'Backspace'), '1.2');
  assert.equal(editNumeric('1', 'q'), null);
  assert.equal(parseNumeric('-'), null);
  assert.equal(parseNumeric('-1.5'), -1.5);
  assert.equal(snapValue('rotate', 43), 45);
  assert.equal(Number(snapValue('grab', 1.26).toFixed(3)), 1.3);
  assert.equal(describeModal('grab', 1.25, { axis: 'x', plane: false }, ''), 'Verschieben: 1,250 m entlang X');
  assert.equal(describeModal('rotate', 90, { axis: 'z', plane: false }, '90'), 'Drehen: 90,0° um Z [90]');
});
