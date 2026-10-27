import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal Path2D stand-in (the renderer only constructs and passes them on).
(globalThis as unknown as { Path2D: unknown }).Path2D = class { d: string; constructor(d?: string) { this.d = d ?? ''; } };

const { renderSplashFrame, splashDuration, SPLASH_TIMELINE, SPLASH_LAYERS } = await import('./renderSplashFrame.ts');
const { encodeWav, measureLoudness, synthStartSound, START_SOUND } = await import('./startSound.ts');
const { logoLockupSvg, logoMarkSvg } = await import('../brand/logoGeometry.ts');

/** Records every call and property write, so two renders can be compared exactly. */
const recorder = () => {
  const log: string[] = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_t, key: string) {
      if (key === 'createLinearGradient') return (...a: number[]) => { log.push(`grad(${a.map((n) => n.toFixed(3))})`); return { addColorStop: (o: number, c: string) => log.push(`stop(${o},${c})`) }; };
      return (...args: unknown[]) => { log.push(`${key}(${args.map((a) => (typeof a === 'number' ? a.toFixed(4) : a && typeof a === 'object' ? (a as { d?: string }).d ?? 'obj' : String(a))).join(',')})`); };
    },
    set(_t, key: string, value) { log.push(`${key}=${typeof value === 'number' ? value.toFixed(4) : typeof value === 'object' ? 'obj' : value}`); return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
};

test('renderSplashFrame is deterministic for every variant', () => {
  for (const variant of ['A', 'B', 'C'] as const) {
    for (const t of [0, 0.3, 0.8, 1.15, 1.6, 2.2, 2.9, 3.3]) {
      const a = recorder(), b = recorder();
      renderSplashFrame(a.ctx, t, { width: 1920, height: 1080, variant });
      renderSplashFrame(b.ctx, t, { width: 1920, height: 1080, variant });
      assert.deepEqual(a.log, b.log, `variant ${variant} t=${t}`);
      assert.ok(a.log.length > 0);
    }
  }
});

test('layers can be switched off one by one; the end frame reports done', () => {
  assert.ok(SPLASH_LAYERS.includes('diana') && SPLASH_LAYERS.includes('hermes'));
  const all = recorder(), noDiana = recorder();
  renderSplashFrame(all.ctx, 0.3, { width: 800, height: 600 });
  renderSplashFrame(noDiana.ctx, 0.3, { width: 800, height: 600, layers: { diana: false } });
  assert.ok(noDiana.log.length < all.log.length);
  const end = renderSplashFrame(recorder().ctx, SPLASH_TIMELINE.end + 0.01, { width: 800, height: 600 });
  assert.equal(end.done, true);
  assert.equal(end.contentAlpha, 0);
  assert.ok(splashDuration() >= 2 && splashDuration() <= 4);
  assert.ok(splashDuration({ reducedMotion: true }) <= 0.6);
});

test('start sound: length, loudness, peak, silent edges, deterministic', () => {
  const sr = 48000;
  const a = synthStartSound(sr);
  const b = synthStartSound(sr);
  assert.deepEqual(a.subarray(0, 2000), b.subarray(0, 2000));
  assert.ok(a.length / 2 / sr <= 3);
  const { lufs, peakDb } = measureLoudness(a, sr);
  assert.ok(Math.abs(lufs - START_SOUND.targetLufs) < 0.5, `lufs ${lufs}`);
  assert.ok(peakDb <= -3, `peak ${peakDb}`);
  assert.ok(a.every((v) => Number.isFinite(v)));
  assert.equal(a[0], 0);
  assert.ok(Math.abs(a[a.length - 1]) < 1e-4 && Math.abs(a[a.length - 2]) < 1e-4);
  const wav = encodeWav(a, sr, 16);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(wav.length, 44 + a.length * 2);
});

test('logo SVGs are pure vector (no embedded bitmap, no text elements)', () => {
  for (const svg of [logoMarkSvg(), logoLockupSvg()]) {
    assert.match(svg, /^<svg /);
    assert.doesNotMatch(svg, /<image|<text|base64/);
    for (const id of ['antler', 'ring', 'eyes', 'smile', 'arrow', 'leaves', 'loop', 'fletching']) assert.match(svg, new RegExp(`id="${id}"`));
  }
  for (const id of ['wordmark', 'product', 'rule', 'claim']) assert.match(logoLockupSvg(), new RegExp(`id="${id}"`));
});

test('dark background draws the mark on near-black, light on cream', async () => {
  const { renderSplashFrame } = await import('./renderSplashFrame.ts');
  const { BRAND_PALETTES } = await import('../brand/brandTokens.ts');
  const fills: string[] = [];
  const noop = () => undefined;
  const ctx = new Proxy({}, {
    get: (_t, key) => (key === 'measureText' ? () => ({ width: 10 }) : key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop),
    set: (_t, key, value) => { if (key === 'fillStyle') fills.push(String(value)); return true; },
  }) as unknown as CanvasRenderingContext2D;
  renderSplashFrame(ctx, 3.0, { width: 800, height: 600, background: 'dark' });
  assert.equal(fills[0], BRAND_PALETTES.dark.cream, 'first fill is the dark background');
  assert.ok(!fills.includes(BRAND_PALETTES.light.green), 'no green ink on black');
  fills.length = 0;
  renderSplashFrame(ctx, 3.0, { width: 800, height: 600 });
  assert.equal(fills[0], BRAND_PALETTES.light.cream, 'default stays cream');
});
