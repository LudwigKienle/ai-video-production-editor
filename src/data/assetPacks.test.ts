import test from 'node:test';
import assert from 'node:assert/strict';

test('built-in packs expose downloadable Poly Haven HDRIs and generic preset items', async () => {
  const assetPacks = await import('./assetPacks.ts').catch(() => null);

  assert.ok(assetPacks, 'asset pack module should exist');
  assert.ok(Array.isArray(assetPacks.BUILTIN_ASSET_PACKS), 'built-in packs should be exported');

  const hdriItems = assetPacks.getAssetPackItemsByType(assetPacks.BUILTIN_ASSET_PACKS, 'hdri');
  assert.equal(hdriItems.length >= 4, true);
  assert.equal(hdriItems.every((item) => item.license === 'CC0'), true);
  assert.equal(hdriItems.every((item) => item.provider === 'polyhaven'), true);
  assert.equal(hdriItems.every((item) => /\.hdr$/i.test(item.url || '')), true);

  const defaultHdris = assetPacks.getDefaultHdriAssets();
  assert.deepEqual(defaultHdris.map((item) => item.id), hdriItems.map((item) => item.id));

  const presetItems = assetPacks.getAssetPackItemsByType(assetPacks.BUILTIN_ASSET_PACKS, 'render-preset');
  assert.equal(presetItems.length > 0, true);

  const manifest = assetPacks.buildAssetPackManifest(assetPacks.BUILTIN_ASSET_PACKS[0]);
  assert.equal(manifest.sourceUrl.includes('polyhaven.com'), true);
  assert.equal(manifest.items.length, hdriItems.length);
});

test('built-in packs expose typed stock presets and pack counts', async () => {
  const assetPacks = await import('./assetPacks.ts').catch(() => null);

  assert.ok(assetPacks, 'asset pack module should exist');

  const stockPresetItems = assetPacks.getAssetPackItemsByType(assetPacks.BUILTIN_ASSET_PACKS, 'stock-preset');
  assert.equal(stockPresetItems.length >= 3, true);
  assert.equal(stockPresetItems.every((item) => item.provider === 'unsplash'), true);
  assert.equal(stockPresetItems.every((item) => Boolean(item.stockPreset?.query)), true);

  const counts = assetPacks.getAssetPackTypeCounts(assetPacks.BUILTIN_ASSET_PACKS[0]);
  assert.equal(counts.hdri >= 4, true);
  assert.equal(counts.model ?? 0, 0);

  const presetManifest = assetPacks.buildAssetPackManifest(
    assetPacks.BUILTIN_ASSET_PACKS.find((pack) => pack.id === 'unsplash-stock-presets')
  );
  assert.equal(presetManifest.assetTypes.includes('stock-preset'), true);
  assert.equal(presetManifest.items.every((item) => item.stockPreset?.provider === 'unsplash'), true);
});

test('normalizes imported manifests and replaces existing imported packs by id', async () => {
  const assetPacks = await import('./assetPacks.ts').catch(() => null);

  assert.ok(assetPacks, 'asset pack module should exist');

  const imported = assetPacks.normalizeAssetPackManifest({
    id: ' custom-look-pack ',
    label: ' Custom Look Pack ',
    description: 'Imported render and stock presets.',
    provider: 'local',
    license: 'Studio internal',
    sourceUrl: 'https://example.com/packs/custom-look-pack',
    assetTypes: ['render-preset', 'stock-preset', 'unknown-type'],
    items: [
      {
        id: ' soft-light ',
        type: 'render-preset',
        label: ' Soft Light ',
        provider: 'local',
        license: 'Studio internal',
        tags: ['imported', 12, 'lighting'],
        renderPreset: { exposure: 1.2, sunEnabled: true },
      },
      {
        id: 'stock-interiors',
        type: 'stock-preset',
        label: 'Interior Search',
        provider: 'unsplash',
        license: 'Unsplash API Terms',
        tags: ['interior'],
        stockPreset: { provider: 'unsplash', query: 'cinematic interior lobby', orientation: 'landscape' },
      },
    ],
  });

  assert.equal(imported.id, 'custom-look-pack');
  assert.deepEqual(imported.assetTypes, ['render-preset', 'stock-preset']);
  assert.equal(imported.items[0].id, 'soft-light');
  assert.deepEqual(imported.items[0].tags, ['imported', 'lighting']);

  const replaced = assetPacks.upsertImportedAssetPack(
    [imported],
    { ...imported, label: 'Custom Look Pack v2' }
  );
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].label, 'Custom Look Pack v2');
});

test('persists imported asset packs through a storage adapter', async () => {
  const assetPacks = await import('./assetPacks.ts').catch(() => null);

  assert.ok(assetPacks, 'asset pack module should exist');

  const backing = new Map();
  const storage = {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => backing.set(key, value),
    removeItem: (key) => backing.delete(key),
  };
  const pack = assetPacks.normalizeAssetPackManifest({
    id: 'stored-pack',
    label: 'Stored Pack',
    description: 'Stored imported pack',
    provider: 'local',
    license: 'Internal',
    sourceUrl: 'local://stored-pack',
    assetTypes: ['material'],
    items: [
      {
        id: 'matte-green',
        type: 'material',
        label: 'Matte Green',
        provider: 'local',
        license: 'Internal',
        tags: ['matte'],
        metadata: { color: '#4f7d62', roughness: 0.9 },
      },
    ],
  });

  assetPacks.saveImportedAssetPacks([pack], storage);

  const loaded = assetPacks.loadImportedAssetPacks(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'stored-pack');
  assert.equal(loaded[0].items[0].metadata.color, '#4f7d62');
});
