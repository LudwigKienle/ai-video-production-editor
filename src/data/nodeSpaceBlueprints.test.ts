import test from 'node:test';
import assert from 'node:assert/strict';

import {
  paletteGroupLabels,
  paletteGroupOrder,
  paletteItems,
  quickTemplateOptions,
  getQuickTemplateById,
  getPaletteItemsByGroup,
  type NodeKind,
  type PaletteGroupId,
} from './nodeSpaceBlueprints.ts';

test('Node Space blueprints metadata: all templates have valid structure', () => {
  assert.ok(Array.isArray(quickTemplateOptions), 'quickTemplateOptions should be an array');
  assert.ok(quickTemplateOptions.length >= 7, 'should have at least 7 blueprints defined');

  const validBackends = new Set(['Local', 'Cloud', 'Hybrid']);
  const seenIds = new Set<string>();

  for (const bp of quickTemplateOptions) {
    // 1. ID validations
    assert.ok(typeof bp.id === 'string' && bp.id.trim().length > 0, `template id must be non-empty string: ${bp.id}`);
    assert.match(bp.id, /^[a-z0-9-]+$/, `template id must be kebab-case: ${bp.id}`);
    assert.ok(!seenIds.has(bp.id), `template id must be unique: duplicate ${bp.id}`);
    seenIds.add(bp.id);

    // 2. Label validations
    assert.ok(typeof bp.label === 'string' && bp.label.trim().length > 0, `template ${bp.id} must have a label`);

    // 3. Description validations
    assert.ok(
      typeof bp.description === 'string' && bp.description.trim().length >= 10,
      `template ${bp.id} must have a descriptive description`
    );

    // 4. Backend validations
    assert.ok(
      validBackends.has(bp.backend),
      `template ${bp.id} has invalid backend "${bp.backend}". Must be Local, Cloud, or Hybrid`
    );

    // 5. Node count validations
    assert.ok(
      Number.isInteger(bp.nodeCount) && bp.nodeCount > 0,
      `template ${bp.id} must have a positive integer node count, got ${bp.nodeCount}`
    );
  }
});

test('Node Space palette groups: order and labels are internally consistent', () => {
  assert.ok(Array.isArray(paletteGroupOrder), 'paletteGroupOrder should be an array');
  assert.ok(paletteGroupOrder.length > 0, 'paletteGroupOrder must not be empty');

  // Verify uniqueness of group order
  const uniqueGroups = new Set(paletteGroupOrder);
  assert.equal(uniqueGroups.size, paletteGroupOrder.length, 'paletteGroupOrder must not have duplicate entries');

  // Verify that every group in order has a user-facing label
  for (const group of paletteGroupOrder) {
    const label = paletteGroupLabels[group];
    assert.ok(
      typeof label === 'string' && label.trim().length > 0,
      `paletteGroupLabels must define a label for group "${group}"`
    );
  }

  // Verify that paletteGroupLabels has no extraneous keys not in paletteGroupOrder
  for (const key of Object.keys(paletteGroupLabels) as PaletteGroupId[]) {
    assert.ok(uniqueGroups.has(key), `paletteGroupLabels has key "${key}" not in paletteGroupOrder`);
  }
});

test('Node Space palette items: types, metadata, and group assignments are valid', () => {
  assert.ok(Array.isArray(paletteItems), 'paletteItems should be an array');
  assert.ok(paletteItems.length >= 15, 'paletteItems should have rich node palette items');

  const groupSet = new Set(paletteGroupOrder);
  const seenTypes = new Set<NodeKind>();

  for (const item of paletteItems) {
    // 1. Type validation
    assert.ok(typeof item.type === 'string' && item.type.length > 0, 'item type must be non-empty');
    assert.ok(!seenTypes.has(item.type), `palette item type must be unique: duplicate ${item.type}`);
    seenTypes.add(item.type);

    // 2. Label & Description
    assert.ok(typeof item.label === 'string' && item.label.trim().length > 0, `item ${item.type} must have label`);
    assert.ok(
      typeof item.description === 'string' && item.description.trim().length > 0,
      `item ${item.type} must have description`
    );

    // 3. Port label & tone styling
    assert.ok(typeof item.portLabel === 'string' && item.portLabel.length > 0, `item ${item.type} must have portLabel`);
    assert.ok(typeof item.tone === 'string' && item.tone.includes('border-'), `item ${item.type} must have valid tone`);

    // 4. Group consistency
    assert.ok(
      groupSet.has(item.group),
      `item ${item.type} belongs to unknown group "${item.group}". Must be in paletteGroupOrder`
    );
  }

  // Verify every palette group has at least one item
  for (const group of paletteGroupOrder) {
    const itemsInGroup = getPaletteItemsByGroup(group);
    assert.ok(itemsInGroup.length > 0, `palette group "${group}" must have at least one palette item`);
  }
});

test('Node Space helper functions: getQuickTemplateById and getPaletteItemsByGroup work as expected', () => {
  // getQuickTemplateById
  const textImage = getQuickTemplateById('text-image');
  assert.ok(textImage, 'should find text-image template');
  assert.equal(textImage?.label, 'Text -> Image');
  assert.equal(textImage?.backend, 'Hybrid');
  assert.equal(textImage?.nodeCount, 4);

  const nonExistent = getQuickTemplateById('non-existent-template');
  assert.equal(nonExistent, undefined, 'unknown template id should return undefined');

  // getPaletteItemsByGroup
  const ioItems = getPaletteItemsByGroup('io');
  assert.ok(ioItems.length >= 2, 'io group should have multiple items');
  assert.ok(ioItems.every((item) => item.group === 'io'), 'all items should belong to io group');
  assert.ok(ioItems.some((item) => item.type === 'prompt'), 'io group should include prompt');
});
