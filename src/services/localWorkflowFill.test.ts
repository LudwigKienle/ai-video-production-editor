import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillWorkflow, sizeForAspect } from './localWorkflowFill.ts';

const catalog = JSON.parse(readFileSync(new URL('../data/localModelCatalog.generated.json', import.meta.url), 'utf8'));
const model = (id: string) => catalog.find((entry: any) => entry.id === id);

const references = (graph: Record<string, any>, nodeId: string) =>
  Object.values(graph).some((node: any) => Object.values(node.inputs || {}).some((value) => Array.isArray(value) && String(value[0]) === nodeId));

test('every catalog file is referenced by a workflow, and every workflow file is in the catalog', () => {
  for (const entry of catalog) {
    const files = new Set(entry.files.map((file: any) => file.name));
    const used = new Set<string>();
    for (const template of Object.values(entry.workflows) as any[]) {
      for (const node of Object.values(template.graph) as any[]) {
        for (const value of Object.values(node.inputs || {})) {
          if (typeof value === 'string' && value.endsWith('.safetensors')) {
            assert.ok(files.has(value), `${entry.id}: ${value} missing from the file list`);
            used.add(value);
          }
        }
      }
    }
    for (const name of files) assert.ok(used.has(name), `${entry.id}: ${name} is never used`);
  }
});

test('text-to-image: prompt, size and seed land in their bindings', () => {
  const template = model('qwen-image-21-local').workflows.t2i;
  const graph = fillWorkflow(template, { prompt: 'a lighthouse', negativePrompt: 'blurry', width: 1344, height: 768, seed: 7 });
  const { bindings } = template;
  assert.equal(graph[bindings.positive.node].inputs[bindings.positive.input], 'a lighthouse');
  assert.equal(graph[bindings.negative.node].inputs[bindings.negative.input], 'blurry');
  assert.equal(graph[bindings.width.node].inputs[bindings.width.input], 1344);
  assert.equal(graph[bindings.height.node].inputs[bindings.height.input], 768);
  assert.equal(graph[bindings.seed.node].inputs[bindings.seed.input], 7);
  // The template itself is not modified.
  assert.notEqual(template.graph[bindings.positive.node].inputs[bindings.positive.input], 'a lighthouse');
});

test('without the enhancer its nodes are gone and nothing points at them', () => {
  for (const id of ['flux-3-klein-local', 'qwen-image-21-local']) {
    for (const template of Object.values(model(id).workflows) as any[]) {
      const enhancer = template.bindings.enhancer;
      const graph = fillWorkflow(template, { prompt: 'x', enhance: false }, ['a.png', 'b.png']);
      for (const nodeId of enhancer.removeNodes) {
        assert.equal(graph[nodeId], undefined);
        assert.equal(references(graph, nodeId), false, `${id}: something still links to ${nodeId}`);
      }
      const enhanced = fillWorkflow(template, { prompt: 'x', enhance: true }, ['a.png', 'b.png']);
      assert.equal(enhanced[enhancer.node].inputs[enhancer.input], enhancer.enabledValue);
    }
  }
});

test('edit: unused reference slots are removed with their wiring', () => {
  const template = model('qwen-image-21-local').workflows.edit;
  const [first, second] = template.bindings.images;
  const one = fillWorkflow(template, { prompt: 'make it night' }, ['ref.png']);
  assert.equal(one[first.node].inputs[first.input], 'ref.png');
  assert.equal(one[second.node], undefined);
  assert.equal(references(one, second.node), false);
  const two = fillWorkflow(template, { prompt: 'make it night' }, ['a.png', 'b.png']);
  assert.equal(two[second.node].inputs[second.input], 'b.png');
});

test('aspect sizes are multiples of 16 and scale with the size setting', () => {
  assert.deepEqual(sizeForAspect('16:9'), [1344, 768]);
  const [w, h] = sizeForAspect('9:16', '2K');
  assert.equal(w % 16, 0);
  assert.equal(h % 16, 0);
  assert.ok(Math.max(...sizeForAspect('1:1', '4K')) <= 2048);
});
