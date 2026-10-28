import test from 'node:test';
import assert from 'node:assert/strict';

import { sceneConceptReferences, sceneShots } from './burstReferences.ts';
import { buildBurstFramePrompt, burstPromptFromArgs, checkBurstFramePrompt } from './burstFrame.ts';
import type { ReferenceItem, ShotPrompt } from '../types.ts';

const ref = (id: string, type: ReferenceItem['type'], name: string, imageUrl: string | null = `https://x/${id}.png`): ReferenceItem => ({ id, type, name, description: '', prompt: '', imageUrl });
const shot = (n: number, scene: number | undefined, extra: Partial<ShotPrompt> = {}): ShotPrompt => ({ shot: n, sceneNumber: scene, prompt: '', description: '', characters: [], environment: null, ...extra });

const refs = [
    ref('r-tom', 'character', 'Tom'),
    ref('r-ellen', 'character', 'Ellen'),
    ref('r-kitchen', 'environment', 'Kitchen'),
    ref('r-lamp', 'prop', 'Brass Lamp'),
    ref('r-boat', 'prop', 'Boat'),
    ref('r-noimg', 'character', 'Ghost', null),
];
const shots = [
    shot(1, 3, { characters: ['Tom'], environment: 'Kitchen' }),
    shot(2, 3, { characters: ['Ellen'], description: 'Ellen lights the brass lamp.' }),
    shot(3, 4, { characters: ['Ghost'], environment: 'Boat' }),
    shot(4, undefined, { characters: ['Tom'] }),
];

test('scene references: everything that occurs in the scene, characters first, only with images', () => {
    assert.deepEqual(sceneShots(shots[0], shots).map((s) => s.shot), [1, 2]);
    const names = sceneConceptReferences(shots[0], shots, refs).map((r) => r.name);
    assert.deepEqual(names, ['Tom', 'Ellen', 'Kitchen', 'Brass Lamp'], 'listed names plus a name in the description, kitchen as location');
    assert.deepEqual(sceneConceptReferences(shots[2], shots, refs).map((r) => r.name), ['Boat'], 'no image, no reference');
    assert.deepEqual(sceneConceptReferences(shots[3], shots, refs).map((r) => r.name), ['Tom'], 'no scene number: the shot alone');
    assert.equal(sceneConceptReferences(shots[0], shots, refs)[2].kind, 'location');
});

test('reference lock and references-only prompts pass the burst check', () => {
    const withStart = buildBurstFramePrompt({ continuity: 'Tom at the kitchen table', style: 'Warm lamp light.', references: [{ name: 'Tom', kind: 'character' }, { name: 'Kitchen', kind: 'location' }] });
    assert.match(withStart, /REFERENCE LOCK/);
    assert.match(withStart, /Tom \(character\); Kitchen \(location\)/);
    assert.match(withStart, /The start frame alone defines pose/);
    assert.equal(checkBurstFramePrompt(withStart).ok, true);

    const fromRefs = buildBurstFramePrompt({ continuity: 'Tom seated at the kitchen table, Ellen standing at the stove', style: 'Warm lamp light.', references: [{ name: 'Tom' }, { name: 'Ellen' }, { name: 'Kitchen' }], source: 'references' });
    assert.match(fromRefs, /built from the supplied reference images/);
    assert.doesNotMatch(fromRefs, /supplied start frame/);
    assert.equal(checkBurstFramePrompt(fromRefs).ok, true);

    const compact = buildBurstFramePrompt({ continuity: 'x', style: 'y', compact: true, source: 'references', references: [{ name: 'Tom' }] });
    assert.match(compact, /built from the reference images/);
    assert.equal(checkBurstFramePrompt(compact).ok, true);

    const viaArgs = burstPromptFromArgs({ continuity: 'Tom in the kitchen', style: 's', source: 'references', referenceRefs: [{ name: 'Tom', kind: 'character' }] });
    assert.match(viaArgs.prompt, /Tom \(character\)/);
});
