import test from 'node:test';
import assert from 'node:assert/strict';

import { assetFolder, joinPath, safeRelativePath, toFileUrl } from './paths.ts';
import { mapTextureFiles } from './zip.ts';
import { gltfBounds, gltfUsesDraco } from './gltfBounds.ts';
import { pickResolution, resolutionsUpTo, sortResolutions } from './resolution.ts';
import { sketchfabLicense } from './licenses.ts';
import { getLibraryProvider, listLibraryProviders } from './registry.ts';

test('paths stay inside the asset folder', () => {
  assert.equal(safeRelativePath('textures/Arm_diff_1k.jpg'), 'textures/Arm_diff_1k.jpg');
  assert.equal(safeRelativePath('a\\b.png'), 'a/b.png');
  assert.equal(safeRelativePath('./x/./y.bin'), 'x/y.bin');
  assert.equal(safeRelativePath('we ird$name?.jpg'), 'we ird_name_.jpg');
  assert.throws(() => safeRelativePath('../x.bin'), /outside/);
  assert.throws(() => safeRelativePath('a/../../x.bin'), /outside/);
  assert.throws(() => safeRelativePath('/etc/passwd'), /absolute/);
  assert.throws(() => safeRelativePath('C:\\Windows\\x.dll'), /absolute/);
  assert.equal(assetFolder('polyhaven', '../Evil', '1k'), 'assets/3d/polyhaven/_Evil/1k');
  assert.equal(joinPath('/projects/demo/', 'assets/a.glb'), '/projects/demo/assets/a.glb');
  assert.equal(joinPath('C:\\proj', 'assets/a.glb'), 'C:\\proj\\assets\\a.glb');
  assert.equal(toFileUrl('/projects/my set/a#1.glb'), 'file:///projects/my%20set/a%231.glb');
  assert.equal(toFileUrl('C:\\proj\\a.glb'), 'file:///C:/proj/a.glb');
});

test('texture maps are assigned by file name', () => {
  assert.deepEqual(mapTextureFiles([
    'Bricks_2K-JPG_Color.jpg', 'Bricks_2K-JPG_NormalDX.jpg', 'Bricks_2K-JPG_NormalGL.jpg', 'Bricks_2K-JPG_Roughness.jpg',
    'Bricks_2K-JPG_Metalness.jpg', 'Bricks_2K-JPG_AmbientOcclusion.jpg', 'Bricks_2K-JPG_Displacement.jpg', 'Bricks.png', 'Bricks_2K-JPG.blend',
  ]), {
    baseColor: 'Bricks_2K-JPG_Color.jpg',
    normal: 'Bricks_2K-JPG_NormalGL.jpg',
    roughness: 'Bricks_2K-JPG_Roughness.jpg',
    metalness: 'Bricks_2K-JPG_Metalness.jpg',
    ao: 'Bricks_2K-JPG_AmbientOcclusion.jpg',
    displacement: 'Bricks_2K-JPG_Displacement.jpg',
  });
  assert.deepEqual(mapTextureFiles(['wood_diff_2k.jpg', 'wood_nor_gl_2k.jpg', 'wood_rough_2k.jpg']), { baseColor: 'wood_diff_2k.jpg', normal: 'wood_nor_gl_2k.jpg', roughness: 'wood_rough_2k.jpg' });
  assert.equal(mapTextureFiles(['x_Color.jpg', 'x_NormalDX.jpg']).normal, 'x_NormalDX.jpg');
});

test('glTF bounds follow the node hierarchy', () => {
  const json = {
    scenes: [{ nodes: [0] }],
    nodes: [{ children: [1], scale: [2, 2, 2] }, { mesh: 0, translation: [1, 0, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ min: [-1, 0, -0.5], max: [1, 1, 0.5] }],
  };
  const bounds = gltfBounds(json)!;
  // rotated 90° about Y: x-extent becomes z-extent; then scaled by 2 and moved by 2 in x.
  assert.deepEqual(bounds.size.map((v) => Number(v.toFixed(6))), [2, 2, 4]);
  assert.deepEqual(bounds.min.map((v) => Number(v.toFixed(6))), [1, 0, -2]);
  assert.equal(gltfUsesDraco({ extensionsRequired: ['KHR_draco_mesh_compression'] }), true);
  assert.equal(gltfBounds({}), null);
});

test('resolutions pick the closest lower offered one', () => {
  assert.deepEqual(sortResolutions(['4k', '1K-JPG', '2k', '1K-PNG', '16k']), ['1k', '2k', '4k', '16k']);
  assert.equal(pickResolution(['1k', '2k', '4k'], '3k', '2k'), '2k');
  assert.equal(pickResolution(['4k', '8k'], '1k', '2k'), '4k');
  assert.equal(pickResolution(['1k', '2k', '4k'], undefined, '2k'), '2k');
  assert.deepEqual(resolutionsUpTo(16384), ['1k', '2k', '4k', '8k', '16k']);
});

test('Sketchfab licences carry credit and commercial flags', () => {
  assert.equal(sketchfabLicense('by').attributionRequired, true);
  assert.equal(sketchfabLicense('CC Attribution-NonCommercial-ShareAlike').label, 'CC BY-NC-SA 4.0');
  assert.equal(sketchfabLicense('CC Attribution-NonCommercial').commercial, false);
  assert.equal(sketchfabLicense('cc0').attributionRequired, false);
  assert.equal(sketchfabLicense('Weird').commercial, false);
});

test('registry: provider lookup and key metadata', () => {
  assert.equal(getLibraryProvider('Poly Haven').id, 'polyhaven');
  assert.equal(getLibraryProvider('ambientCG').id, 'ambientcg');
  assert.throws(() => getLibraryProvider('nope'), /Unknown 3D library/);
  for (const provider of listLibraryProviders()) {
    if (provider.requiresKey) {
      assert.ok(provider.keyStorage && provider.keyUrl, `${provider.id} needs keyStorage and keyUrl for the settings`);
    }
    assert.notEqual(provider.cost, 'paid');
  }
});
