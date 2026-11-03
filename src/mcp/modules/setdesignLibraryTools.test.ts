/**
 * MCP test for the 3D library tools over the real renderer → MCP bridge. Every network call
 * is answered by a fake router (no real requests); the set design bus is a fake that records
 * commands, so material.set can be tested before the builder core ships it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'three/examples/jsm/libs/fflate.module.js';

import './setdesignLibraryTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { overrideLibraryToolDeps } from './setdesignLibraryTools.ts';
import { overrideLibraryHttp } from '../../setdesign/libraries/http.ts';
import type { LibraryHttp } from '../../setdesign/libraries/types.ts';

const enc = (text: string) => new TextEncoder().encode(text);

const makeGlb = (json: unknown) => {
  let body = enc(JSON.stringify(json));
  const pad = (4 - (body.length % 4)) % 4;
  if (pad) { const padded = new Uint8Array(body.length + pad).fill(0x20); padded.set(body); body = padded; }
  const out = new Uint8Array(20 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, body.length, true); view.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
};

const meshJson = (min: number[], max: number[], extra: Record<string, unknown> = {}) => ({
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ min, max }],
  ...extra,
});

const PH = 'https://api.polyhaven.com';
const DL = 'https://dl.polyhaven.org/file/ph-assets';
const ACG = 'https://ambientcg.com/api/v2/full_json';

const phGltf = meshJson([-0.42, 0, -0.38], [0.42, 1.06, 0.38], { buffers: [{ uri: 'ArmChair_01.bin', byteLength: 4 }], images: [{ uri: 'textures/Armchair_01_diff_1k.jpg' }] });

const ambientZip = zipSync({
  'WoodFloor051_1K-JPG_Color.jpg': enc('color'),
  'WoodFloor051_1K-JPG_NormalGL.jpg': enc('ngl'),
  'WoodFloor051_1K-JPG_NormalDX.jpg': enc('ndx'),
  'WoodFloor051_1K-JPG_Roughness.jpg': enc('rough'),
  'WoodFloor051_1K-JPG_AmbientOcclusion.jpg': enc('ao'),
  'WoodFloor051_1K-JPG_Displacement.jpg': enc('disp'),
  'WoodFloor051_1K-JPG.blend': enc('blend'),
  'WoodFloor051.png': enc('preview'),
});
const ambientHdriZip = zipSync({ 'DayEnvironmentHDRI114_1K_HDR.exr': enc('exr'), 'DayEnvironmentHDRI114_1K_TONEMAPPED.jpg': enc('jpg'), 'DayEnvironmentHDRI114_1K.blend': enc('b') });

const acgAsset = (id: string, dataType: string, downloads: Array<{ attribute: string; fileName: string }>) => ({
  assetId: id, dataType, displayName: id, tags: ['wood'], shortLink: `https://ambientcg.com/a/${id}`, dimensionX: 180, dimensionY: 180,
  previewImage: { '256-PNG': `https://acg-media.example/${id}.png` },
  downloadFolders: { default: { downloadFiletypeCategories: { zip: { downloads: downloads.map((d) => ({ ...d, filetype: 'zip', size: 1000, downloadLink: `https://ambientcg.com/get?file=${d.fileName}`, fullDownloadPath: `https://ambientcg.com/get?file=${d.fileName}` })) } } } },
});

const siRow = {
  id: 'ld1-chair',
  title: 'Side Chair',
  unitCode: 'CHNDM',
  content: {
    descriptiveNonRepeating: {
      title: { content: 'Side Chair' }, data_source: 'Cooper Hewitt, Smithsonian Design Museum', record_link: 'https://collection.example/chair',
      online_media: { media: [
        { type: 'Images', thumbnail: 'https://ids.si.edu/ids/deliveryService?id=X', usage: { access: 'CC0' } },
        { type: '3d_voyager', usage: { access: 'CC0' }, resources: [
          { url: 'https://3d-api.si.edu/chair-draco.glb', category: 'Low resolution', filename: 'chair_std_draco.glb', attributes: [{ UNITS: 'm', MODEL_FILE_TYPE: 'glb', DRACO_COMPRESSED: true }, { FILE_SIZE: 100 }] },
          { url: 'https://3d-api.si.edu/chair-150k.glb', category: 'Low resolution', filename: 'chair-(england)-150k.glb', attributes: [{ UNITS: 'mm', MODEL_FILE_TYPE: 'glb', DRACO_COMPRESSED: false }, { FILE_SIZE: 2000 }] },
        ] },
      ] },
    },
    freetext: { name: [{ content: 'Unknown maker' }] },
  },
};

const JSON_ROUTES: Array<[RegExp, (url: string) => unknown]> = [
  [/^https:\/\/api\.polyhaven\.com\/assets\?type=models$/, () => ({ ArmChair_01: { name: 'Arm Chair 01', type: 2, authors: { 'Kirill Sannikov': 'All' }, polycount: 5626, dimensions: [848, 765, 1065], max_resolution: [4096, 4096], tags: ['chair'], download_count: 5 }, Giant_01: { name: 'Giant', type: 2, authors: { A: 'All' }, download_count: 1 } })],
  [/^https:\/\/api\.polyhaven\.com\/assets\?type=hdris$/, () => ({ brown_photostudio_02: { name: 'Brown Photostudio 02', type: 0, authors: { 'Sergej Majboroda': 'All' }, max_resolution: [16384, 8192] } })],
  [/^https:\/\/api\.polyhaven\.com\/assets\?type=textures$/, () => ({ wood_floor_deck: { name: 'Wood Floor Deck', type: 1, authors: { 'Dimitrios Savva': 'All' }, dimensions: [1800, 1800], max_resolution: [8192, 8192] } })],
  [/^https:\/\/api\.polyhaven\.com\/search\?/, (url) => ({ total: 2, results: new URL(url).searchParams.get('t') === 'models' ? [{ slug: 'ArmChair_01' }, { slug: 'Giant_01' }] : [{ slug: 'brown_photostudio_02' }, { slug: 'wood_floor_deck' }] })],
  [/\/info\/ArmChair_01$/, () => ({ name: 'Arm Chair 01', type: 2, authors: { 'Kirill Sannikov': 'All' }, dimensions: [848, 765, 1065], polycount: 5626 })],
  [/\/files\/ArmChair_01$/, () => ({ gltf: { '1k': { gltf: { url: `${DL}/Models/gltf/1k/ArmChair_01/ArmChair_01_1k.gltf`, size: 2643, include: {
    'ArmChair_01.bin': { url: `${DL}/Models/gltf/4k/ArmChair_01/ArmChair_01.bin`, size: 4 },
    'textures/Armchair_01_diff_1k.jpg': { url: `${DL}/Models/jpg/1k/ArmChair_01/Armchair_01_diff_1k.jpg`, size: 5 },
  } } }, '2k': { gltf: { url: `${DL}/x_2k.gltf` } } } })],
  [/\/info\/Evil_01$/, () => ({ name: 'Evil', type: 2, authors: {} })],
  [/\/files\/Evil_01$/, () => ({ gltf: { '1k': { gltf: { url: `${DL}/evil.gltf`, include: { '../../../escape.bin': { url: `${DL}/escape.bin` } } } } } })],
  [/\/info\/brown_photostudio_02$/, () => ({ name: 'Brown Photostudio 02', type: 0, authors: { 'Sergej Majboroda': 'All' } })],
  [/\/files\/brown_photostudio_02$/, () => ({ hdri: { '1k': { hdr: { url: `${DL}/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr`, size: 10 } }, '2k': { hdr: { url: `${DL}/HDRIs/hdr/2k/brown_photostudio_02_2k.hdr`, size: 20 }, exr: { url: `${DL}/HDRIs/exr/2k/brown_photostudio_02_2k.exr`, size: 30 } } } })],
  [/\/info\/wood_floor_deck$/, () => ({ name: 'Wood Floor Deck', type: 1, authors: { 'Dimitrios Savva': 'All' }, dimensions: [1800, 1800] })],
  [/\/files\/wood_floor_deck$/, () => ({
    Diffuse: { '2k': { jpg: { url: `${DL}/Textures/jpg/2k/wood_floor_deck/wood_floor_deck_diff_2k.jpg`, size: 1 } } },
    nor_gl: { '2k': { jpg: { url: `${DL}/Textures/jpg/2k/wood_floor_deck/wood_floor_deck_nor_gl_2k.jpg`, size: 1 } } },
    nor_dx: { '2k': { jpg: { url: `${DL}/Textures/jpg/2k/wood_floor_deck/wood_floor_deck_nor_dx_2k.jpg`, size: 1 } } },
    arm: { '2k': { jpg: { url: `${DL}/Textures/jpg/2k/wood_floor_deck/wood_floor_deck_arm_2k.jpg`, size: 1 } } },
    Displacement: { '2k': { jpg: { url: `${DL}/Textures/jpg/2k/wood_floor_deck/wood_floor_deck_disp_2k.jpg`, size: 1 } } },
    blend: { '2k': { blend: { url: `${DL}/x.blend` } } },
  })],
  [/^https:\/\/ambientcg\.com\/api\/v2\/full_json\?.*id=WoodFloor051/, () => ({ foundAssets: [acgAsset('WoodFloor051', 'Material', [{ attribute: '1K-JPG', fileName: 'WoodFloor051_1K-JPG.zip' }, { attribute: '2K-JPG', fileName: 'WoodFloor051_2K-JPG.zip' }, { attribute: '1K-PNG', fileName: 'WoodFloor051_1K-PNG.zip' }])] })],
  [/^https:\/\/ambientcg\.com\/api\/v2\/full_json\?.*id=DayEnvironmentHDRI114/, () => ({ foundAssets: [acgAsset('DayEnvironmentHDRI114', 'HDRI', [{ attribute: '1K', fileName: 'DayEnvironmentHDRI114_1K.zip' }])] })],
  [/^https:\/\/ambientcg\.com\/api\/v2\/full_json\?/, (url) => ({ numberOfResults: 1, foundAssets: [new URL(url).searchParams.get('type') === 'HDRI' ? acgAsset('DayEnvironmentHDRI114', 'HDRI', [{ attribute: '1K', fileName: 'DayEnvironmentHDRI114_1K.zip' }]) : acgAsset('WoodFloor051', 'Material', [{ attribute: '1K-JPG', fileName: 'WoodFloor051_1K-JPG.zip' }])] })],
  [/^https:\/\/api\.sketchfab\.com\/v3\/search\?/, () => ({ next: null, results: [{ uid: 'sf1', name: 'Bar Stool', isDownloadable: true, faceCount: 900, license: { label: 'CC Attribution-NonCommercial' }, user: { displayName: 'Jane' }, thumbnails: { images: [{ url: 'https://media.sketchfab.example/t.jpg', width: 256, height: 144 }] }, archives: { glb: { size: 100 } } }] })],
  [/^https:\/\/api\.sketchfab\.com\/v3\/models\/sf1\/download$/, () => ({ glb: { url: 'https://sketchfab-prod.example/sf1.glb?signed=1', size: 100 } })],
  [/^https:\/\/api\.sketchfab\.com\/v3\/models\/sf1$/, () => ({ uid: 'sf1', name: 'Bar Stool', isDownloadable: true, license: { slug: 'by-nc', label: 'CC Attribution-NonCommercial' }, user: { displayName: 'Jane' }, viewerUrl: 'https://sketchfab.com/3d-models/bar-stool-sf1' })],
  [/^https:\/\/api\.si\.edu\/openaccess\/api\/v1\.0\/search\?/, () => ({ response: { rowCount: 1, rows: [siRow] } })],
  [/^https:\/\/api\.si\.edu\/openaccess\/api\/v1\.0\/content\/ld1-chair\?/, () => ({ response: siRow })],
];

const BYTE_ROUTES: Array<[RegExp, () => Uint8Array]> = [
  [/ArmChair_01_1k\.gltf$/, () => enc(JSON.stringify(phGltf))],
  [/evil\.gltf$/, () => enc(JSON.stringify(meshJson([0, 0, 0], [1, 1, 1])))],
  [/\.bin$/, () => new Uint8Array([1, 2, 3, 4])],
  [/\.(jpg|hdr|exr)$/, () => enc('img')],
  [/WoodFloor051_\dK-JPG\.zip$/, () => ambientZip],
  [/DayEnvironmentHDRI114_1K\.zip$/, () => ambientHdriZip],
  [/sf1\.glb\?signed=1$/, () => makeGlb(meshJson([-250, 0, -250], [250, 500, 250]))],
  [/chair-150k\.glb$/, () => makeGlb(meshJson([-230, 0, -260], [230, 980, 260]))],
];

const requested: string[] = [];
let failSketchfab = false;
const fakeHttp: LibraryHttp = {
  async json<T>(url: string, init?: { headers?: Record<string, string> }) {
    requested.push(url);
    if (failSketchfab && url.includes('sketchfab')) throw new Error('api.sketchfab.com answered 503');
    if (url.includes('/download') && !init?.headers?.Authorization) throw new Error('api.sketchfab.com answered 401');
    const route = JSON_ROUTES.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`unexpected json ${url}`);
    return route[1](url) as T;
  },
  async bytes(url: string) {
    requested.push(url);
    const route = BYTE_ROUTES.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`unexpected bytes ${url}`);
    return route[1]();
  },
};

type Call = { id: string; args: Record<string, unknown> };

const setup = async (options: { projectPath?: string | null; hasMaterialSet?: boolean; keys?: Record<string, string> } = {}) => {
  const g = globalThis as unknown as { fetch: unknown; localStorage?: unknown };
  const realFetch = g.fetch;
  g.fetch = () => { throw new Error('real network access in a test'); };
  const store = new Map(Object.entries(options.keys || {}));
  const realStorage = g.localStorage;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  overrideLibraryHttp(fakeHttp);
  const calls: Call[] = [];
  const written = new Map<string, Uint8Array>();
  overrideLibraryToolDeps({
    run: (id, args) => { calls.push({ id, args }); return id === 'object.add_model' ? { id: 'obj_1', name: String(args.name) } : { ok: true }; },
    hasCommand: (id) => id !== 'material.set' || options.hasMaterialSet !== false,
    projectPath: options.projectPath === undefined ? '/projects/demo' : options.projectPath,
    writeFile: async (folder, rel, data) => { written.set(`${folder}/${rel}`, data); return true; },
    statFile: async () => null,
    cacheDir: async () => null,
  });
  const { ctx } = createTestContext({ projectPath: options.projectPath === undefined ? '/projects/demo' : options.projectPath });
  const mcp = await createMcpHarness(ctx);
  requested.length = 0;
  return {
    mcp, calls, written,
    done() {
      mcp.dispose();
      overrideLibraryToolDeps(null);
      overrideLibraryHttp(null);
      g.fetch = realFetch;
      g.localStorage = realStorage;
      failSketchfab = false;
    },
  };
};

test('library tools are published with schemas and list the providers', async () => {
  const t = await setup();
  try {
    const names = t.mcp.list().map((tool) => tool.name).filter((name) => name.startsWith('library_'));
    assert.deepEqual(names.sort(), ['library_apply_texture', 'library_asset_details', 'library_import_model', 'library_providers', 'library_search', 'library_set_hdri']);
    const search = t.mcp.list().find((tool) => tool.name === 'library_search')!;
    assert.match(search.description, /CC0/);
    assert.match(t.mcp.list().find((tool) => tool.name === 'library_import_model')!.description, /changes the project/);
    const { providers } = await t.mcp.call('library_providers') as { providers: Array<{ id: string; configured: boolean; searchable: boolean; cost: string }> };
    const byId = Object.fromEntries(providers.map((p) => [p.id, p]));
    assert.equal(byId.polyhaven.configured, true);
    assert.equal(byId.ambientcg.configured, true);
    assert.equal(byId.sketchfab.configured, false);
    assert.equal(byId.sketchfab.searchable, true, 'Sketchfab search works without a token');
    assert.equal(byId.smithsonian.searchable, false);
    assert.ok(providers.every((p) => p.cost === 'free'));
  } finally { t.done(); }
});

test('library_search runs providers in parallel and reports errors per provider', async () => {
  const t = await setup();
  try {
    const reply = await t.mcp.call('library_search', { query: 'chair', type: 'model', limit: 5 }) as any;
    assert.equal(reply.ok, true);
    const providers = Object.fromEntries(reply.providers.map((p: any) => [p.provider, p]));
    assert.equal(providers.polyhaven.ok, true);
    assert.equal(providers.sketchfab.ok, true);
    assert.match(providers.smithsonian.skipped, /api\.data\.gov/);
    assert.equal(providers.ambientcg, undefined, 'ambientCG offers no models');
    const chair = reply.results.find((r: any) => r.id === 'ArmChair_01');
    assert.equal(chair.license, 'CC0');
    assert.deepEqual(chair.dimensionsM, [0.848, 0.765, 1.065]);
    const stool = reply.results.find((r: any) => r.id === 'sf1');
    assert.equal(stool.license, 'CC BY-NC 4.0');
    assert.equal(stool.creditRequired, true);
    assert.equal(stool.commercialUse, false);
    assert.equal(stool.downloadable, false, 'no token = not downloadable');

    failSketchfab = true;
    const partial = await t.mcp.call('library_search', { query: 'chair', type: 'model', providers: ['polyhaven', 'sketchfab'] }) as any;
    const p2 = Object.fromEntries(partial.providers.map((p: any) => [p.provider, p]));
    assert.equal(p2.polyhaven.ok, true);
    assert.equal(p2.sketchfab.ok, false);
    assert.match(p2.sketchfab.error, /503/);
    assert.ok(partial.results.length >= 1);

    const textures = await t.mcp.call('library_search', { query: 'wood', type: 'texture' }) as any;
    assert.deepEqual(textures.results.map((r: any) => r.provider).sort(), ['ambientcg', 'polyhaven']);
    assert.deepEqual(textures.results.find((r: any) => r.provider === 'ambientcg').dimensionsM, [1.8, 1.8]);
  } finally { t.done(); }
});

test('library_import_model downloads a multi-part glTF into the project and places it with attribution', async () => {
  const t = await setup();
  try {
    const reply = await t.mcp.call('library_import_model', { provider: 'polyhaven', id: 'ArmChair_01', position: [1, 2, 0], rotationZ: 90 }) as any;
    assert.equal(reply.ok, true, reply.message);
    const base = '/projects/demo/assets/3d/polyhaven/ArmChair_01/1k';
    assert.ok(t.written.has(`${base}/ArmChair_01_1k.gltf`));
    assert.ok(t.written.has(`${base}/ArmChair_01.bin`));
    assert.ok(t.written.has(`${base}/textures/Armchair_01_diff_1k.jpg`));
    const add = t.calls.find((c) => c.id === 'object.add_model')!;
    assert.equal(add.args.url, `file://${base}/ArmChair_01_1k.gltf`);
    assert.equal(add.args.format, 'gltf');
    assert.deepEqual(add.args.rotation, [0, 0, 90]);
    assert.deepEqual(add.args.scale, [1, 1, 1]);
    assert.deepEqual(add.args.attribution, { author: 'Kirill Sannikov', license: 'CC0', url: 'https://polyhaven.com/a/ArmChair_01' });
    assert.deepEqual(reply.sizeM, [0.84, 0.76, 1.06]);
    assert.equal(reply.storage, 'project');
    assert.deepEqual(reply.warnings, []);

    const scaled = await t.mcp.call('library_import_model', { provider: 'polyhaven', id: 'ArmChair_01', targetSize: 2.12 }) as any;
    assert.equal(scaled.scale, 2);
    assert.deepEqual(scaled.sizeM, [1.68, 1.52, 2.12]);
  } finally { t.done(); }
});

test('library_import_model refuses paths that leave the asset folder', async () => {
  const t = await setup();
  try {
    const reply = await t.mcp.call('library_import_model', { provider: 'polyhaven', id: 'Evil_01' }) as any;
    assert.equal(reply.ok, false);
    assert.match(reply.message, /outside the asset folder/);
    assert.equal([...t.written.keys()].some((key) => key.includes('escape')), false);
    assert.equal(t.calls.length, 0);
  } finally { t.done(); }
});

test('without a project folder Poly Haven glTF loads inline with absolute file URLs', async () => {
  const t = await setup({ projectPath: null });
  try {
    const reply = await t.mcp.call('library_import_model', { provider: 'polyhaven', id: 'ArmChair_01' }) as any;
    assert.equal(reply.ok, true, reply.message);
    assert.equal(reply.storage, 'remote');
    assert.equal(t.written.size, 0);
    const url = String(t.calls[0].args.url);
    assert.match(url, /^data:model\/gltf\+json;base64,/);
    const json = JSON.parse(Buffer.from(url.split(',')[1], 'base64').toString('utf8'));
    assert.equal(json.buffers[0].uri, `${DL}/Models/gltf/4k/ArmChair_01/ArmChair_01.bin`);
    assert.equal(json.images[0].uri, `${DL}/Models/jpg/1k/ArmChair_01/Armchair_01_diff_1k.jpg`);
  } finally { t.done(); }
});

test('Sketchfab and Smithsonian imports: token, licence, units and size warnings', async () => {
  const t = await setup({ keys: { sketchfab_token: 'tok', smithsonian_api_key: 'si-key' } });
  try {
    const stool = await t.mcp.call('library_import_model', { provider: 'sketchfab', id: 'sf1' }) as any;
    assert.equal(stool.ok, true, stool.message);
    assert.ok(t.written.has('/projects/demo/assets/3d/sketchfab/sf1/sf1.glb'), 'expiring link is downloaded, not stored');
    assert.equal(stool.license.label, 'CC BY-NC 4.0');
    assert.equal(stool.license.commercial, false);
    assert.ok(stool.warnings.some((w: string) => /Unrealistic size/.test(w)));
    assert.ok(stool.warnings.some((w: string) => /commercial/.test(w)));
    assert.deepEqual(t.calls.at(-1)!.args.attribution, { author: 'Jane', license: 'CC BY-NC 4.0', url: 'https://sketchfab.com/3d-models/bar-stool-sf1' });

    const chair = await t.mcp.call('library_import_model', { provider: 'smithsonian', id: 'ld1-chair' }) as any;
    assert.equal(chair.ok, true, chair.message);
    assert.ok(requested.includes('https://3d-api.si.edu/chair-150k.glb'), 'non-Draco GLB chosen');
    assert.equal(chair.scale, 0.001, 'mm → m');
    assert.deepEqual(chair.sizeM, [0.46, 0.52, 0.98]);
    assert.deepEqual(chair.warnings.filter((w: string) => /Unrealistic/.test(w)), []);
    assert.ok(t.written.has('/projects/demo/assets/3d/smithsonian/ld1-chair/Low resolution/chair-(england)-150k.glb'));
  } finally { t.done(); }
});

test('Sketchfab import without a token explains where to get one', async () => {
  const t = await setup();
  try {
    const reply = await t.mcp.call('library_import_model', { provider: 'sketchfab', id: 'sf1' }) as any;
    assert.equal(reply.ok, false);
    assert.match(reply.message, /sketchfab\.com\/settings\/password/);
  } finally { t.done(); }
});

test('library_set_hdri: Poly Haven file and ambientCG ZIP', async () => {
  const t = await setup();
  try {
    const ph = await t.mcp.call('library_set_hdri', { provider: 'polyhaven', id: 'brown_photostudio_02', strength: 1.5, background: true }) as any;
    assert.equal(ph.ok, true, ph.message);
    const hdri = t.calls.find((c) => c.id === 'scene.hdri')!;
    assert.equal(hdri.args.url, 'file:///projects/demo/assets/3d/polyhaven/brown_photostudio_02/2k/brown_photostudio_02_2k.hdr');
    assert.equal(hdri.args.strength, 1.5);
    assert.equal(hdri.args.background, true);
    assert.equal(ph.license.label, 'CC0');

    const acg = await t.mcp.call('library_set_hdri', { provider: 'ambientcg', id: 'DayEnvironmentHDRI114', resolution: '1k' }) as any;
    assert.equal(acg.ok, true, acg.message);
    assert.equal(t.calls.at(-1)!.args.url, 'file:///projects/demo/assets/3d/ambientcg/DayEnvironmentHDRI114/1k/DayEnvironmentHDRI114_1K_HDR.exr');
    assert.equal([...t.written.keys()].some((k) => k.endsWith('.blend') || k.endsWith('TONEMAPPED.jpg')), false);

    const noProject = await setup({ projectPath: null });
    try {
      const remote = await noProject.mcp.call('library_set_hdri', { provider: 'polyhaven', id: 'brown_photostudio_02', resolution: '1k' }) as any;
      assert.equal(remote.storage, 'remote');
      assert.equal(noProject.calls[0].args.url, `${DL}/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr`);
      const zip = await noProject.mcp.call('library_set_hdri', { provider: 'ambientcg', id: 'DayEnvironmentHDRI114' }) as any;
      assert.equal(zip.ok, false);
      assert.match(zip.message, /project/);
    } finally { noProject.done(); }
  } finally { t.done(); }
});

test('library_apply_texture maps ambientCG and Poly Haven maps onto material.set', async () => {
  const t = await setup();
  try {
    const acg = await t.mcp.call('library_apply_texture', { provider: 'ambientcg', id: 'WoodFloor051', objects: ['Boden'], repeat: [4, 4], resolution: '1k' }) as any;
    assert.equal(acg.ok, true, acg.message);
    const set = t.calls.find((c) => c.id === 'material.set')!;
    const base = 'file:///projects/demo/assets/3d/ambientcg/WoodFloor051/1k';
    assert.deepEqual(set.args.maps, {
      baseColor: `${base}/WoodFloor051_1K-JPG_Color.jpg`,
      normal: `${base}/WoodFloor051_1K-JPG_NormalGL.jpg`,
      roughness: `${base}/WoodFloor051_1K-JPG_Roughness.jpg`,
      ao: `${base}/WoodFloor051_1K-JPG_AmbientOcclusion.jpg`,
    });
    assert.deepEqual(set.args.objects, ['Boden']);
    assert.equal(set.args.color, '#ffffff', 'white base colour so the map is not tinted');
    assert.equal(set.args.clearMaps, true);
    assert.equal(set.args.metalness, 0);
    assert.deepEqual(set.args.repeat, [4, 4]);
    assert.deepEqual(set.args.attribution, { author: 'ambientCG', license: 'CC0', url: 'https://ambientcg.com/a/WoodFloor051' });
    assert.deepEqual(acg.tileSizeM, [1.8, 1.8]);

    const ph = await t.mcp.call('library_apply_texture', { provider: 'polyhaven', id: 'wood_floor_deck', objects: ['obj_1'], displacementScale: 0.01 }) as any;
    assert.equal(ph.ok, true, ph.message);
    const maps = t.calls.at(-1)!.args.maps as Record<string, string>;
    assert.match(maps.normal, /nor_gl_2k\.jpg$/);
    assert.match(maps.roughness, /arm_2k\.jpg$/, 'packed ARM used for roughness');
    assert.match(maps.ao, /arm_2k\.jpg$/);
    assert.match(maps.displacement, /disp_2k\.jpg$/);
    assert.equal(t.calls.at(-1)!.args.displacementScale, 0.01);
  } finally { t.done(); }
});

test('library_apply_texture reports a missing material.set command', async () => {
  const t = await setup({ hasMaterialSet: false });
  try {
    const reply = await t.mcp.call('library_apply_texture', { provider: 'polyhaven', id: 'wood_floor_deck', objects: ['x'] }) as any;
    assert.equal(reply.ok, false);
    assert.match(reply.message, /material\.set/);
  } finally { t.done(); }
});

test('real set design bus: model, HDRI and material.set land in the scene with attribution', async () => {
  const { setDesignBus } = await import('../../setdesign/bus.ts');
  const { getCommand } = await import('../../setdesign/commands.ts');
  const t = await setup();
  let stored: any = null;
  const detach = setDesignBus.attachHost({ getScene: () => stored, setScene: (next) => { stored = next; } });
  // Real bus instead of the recording fake (file access stays faked).
  overrideLibraryToolDeps({
    projectPath: '/projects/demo',
    writeFile: async (folder, rel, data) => { t.written.set(`${folder}/${rel}`, data); return true; },
    statFile: async () => null,
    cacheDir: async () => null,
  });
  try {
    const chair = await t.mcp.call('library_import_model', { provider: 'polyhaven', id: 'ArmChair_01', position: [1, 0, 0] }) as any;
    assert.equal(chair.ok, true, chair.message);
    const model = stored.assets.find((a: any) => a.id === chair.object.id);
    assert.equal(model.kind, 'model');
    assert.equal(model.format, 'gltf');
    assert.match(model.url, /^file:\/\/\/projects\/demo\/assets\/3d\/polyhaven\/ArmChair_01\/1k\/ArmChair_01_1k\.gltf$/);
    assert.deepEqual(model.attribution, { author: 'Kirill Sannikov', license: 'CC0', url: 'https://polyhaven.com/a/ArmChair_01' });

    const hdri = await t.mcp.call('library_set_hdri', { provider: 'polyhaven', id: 'brown_photostudio_02', background: true }) as any;
    assert.equal(hdri.ok, true, hdri.message);
    assert.match(stored.world.hdriUrl, /brown_photostudio_02_2k\.hdr$/);
    assert.equal(stored.world.hdriBackground, true);

    assert.ok(getCommand('material.set'), 'material.set is part of the builder core');
    {
      const floor = setDesignBus.run('object.add_primitive', { primitive: 'plane', name: 'Boden' }) as { id: string };
      const tex = await t.mcp.call('library_apply_texture', { provider: 'ambientcg', id: 'WoodFloor051', objects: [floor.id], repeat: [3, 3], resolution: '1k' }) as any;
      assert.equal(tex.ok, true, tex.message);
      const material = stored.assets.find((a: any) => a.id === floor.id).material;
      assert.match(JSON.stringify(material), /WoodFloor051_1K-JPG_Color\.jpg/);
      assert.match(JSON.stringify(material), /CC0/);
    }
  } finally {
    detach();
    setDesignBus.reset();
    t.done();
  }
});
