#!/usr/bin/env node
// Smoke test for avpe-ofx-host: scan, render a gradient through Buckswood Post Plugins plugins,
// write PNG/PPM previews, optionally bake a short clip.
// Usage: node native/ofx-host/scripts/smoke.mjs [--out DIR] [--no-bake] [--all]
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const { OfxHostClient } = require(path.join(repoRoot, 'electron', 'ofx', 'ofxHostClient.js'));

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const outDir = argValue('--out', process.env.SMOKE_OUT || path.join(os.tmpdir(), 'avpe-ofx-smoke'));
const doBake = !args.includes('--no-bake');
const renderAll = args.includes('--all');
fs.mkdirSync(outDir, { recursive: true });

const W = 480;
const H = 270;

// ---- image helpers -----------------------------------------------------------
function gradient(width, height, phase = 0) {
  const px = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const u = x / (width - 1);
      const v = y / (height - 1);
      px[i] = u;
      px[i + 1] = v;
      px[i + 2] = 0.5 + 0.5 * Math.sin((u + v + phase) * Math.PI * 3);
      px[i + 3] = 1;
      // A small hot spot so bloom/halation/flare have something to work with.
      const dx = x - width * (0.7 + phase * 0.05);
      const dy = y - height * 0.3;
      if (dx * dx + dy * dy < 64) {
        px[i] = 4;
        px[i + 1] = 3.5;
        px[i + 2] = 3;
      }
    }
  }
  return px;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function toBytes(floats) {
  const out = Buffer.alloc(floats.length);
  for (let i = 0; i < floats.length; i += 1) {
    const v = Math.min(1, Math.max(0, floats[i]));
    out[i] = Math.round(Math.pow(v, 1 / 2.2) * 255);
  }
  return out;
}
function writePng(file, floats, width, height) {
  const rgba = toBytes(floats);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
function writePpm(file, floats, width, height) {
  const rgba = toBytes(floats);
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), rgb]));
}
function stats(input, output) {
  let diff = 0;
  let nonFinite = 0;
  for (let i = 0; i < output.length; i += 1) {
    const v = output[i];
    if (!Number.isFinite(v)) {
      nonFinite += 1;
      continue;
    }
    if (i % 4 !== 3) diff += Math.abs(v - Math.min(input[i], 1.0e9));
  }
  return { meanAbsDiff: diff / ((output.length / 4) * 3), nonFinite };
}
const asFloats = (buf) => new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

// ---- main ----------------------------------------------------------------------
const client = new OfxHostClient({ appPath: repoRoot, scanCacheFile: path.join(outDir, 'scan-cache.json') });
if (!client.isAvailable()) {
  console.error('avpe-ofx-host binary not found; run `make -C native/ofx-host` first');
  process.exit(2);
}
let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL: ${msg}`);
};

try {
  const t0 = Date.now();
  const scan = await client.scanPlugins();
  console.log(`scan: ${scan.plugins.length} plugin(s) in ${scan.bundles.length} bundle(s) (${scan.bundles.filter((b) => b.cached).length} from cache), ${Date.now() - t0} ms`);
  for (const b of scan.bundles) {
    if (!b.ok) console.log(`  bundle FAILED ${b.path}: ${b.error}`);
  }
  const ownPlugins = scan.plugins.filter((p) => p.id && p.id.startsWith('com.buckswood.'));
  for (const p of ownPlugins) {
    const visible = (p.params || []).filter((q) => q.dimension > 0 && !q.secret).length;
    console.log(
      `  ${p.supported ? 'ok ' : 'NO '} ${p.id.padEnd(34)} ${String(p.label).padEnd(40)} params=${String(p.params.length).padStart(3)} (${visible} visible) temporal=${p.temporalClipAccess} ${p.unsupportedReason || ''}`,
    );
  }
  fs.writeFileSync(path.join(outDir, 'scan.json'), JSON.stringify(scan, null, 2));
  if (!ownPlugins.find((p) => p.id === 'com.buckswood.optics.lab')) fail('Optics Lab not found by scan');

  const src = gradient(W, H, 0);
  writePng(path.join(outDir, 'input.png'), src, W, H);
  writePpm(path.join(outDir, 'input.ppm'), src, W, H);

  const renderOne = async (plugin, params, label) => {
    const id = plugin.id;
    // Temporal plugins: provide the neighbouring frames they ask for.
    let frames = [];
    if (plugin.temporalClipAccess) {
      try {
        const need = await client.framesNeeded({ pluginId: id, instanceId: `smoke:${id}`, time: 10, params, width: W, height: H });
        frames = (need.frames || [])
          .filter((t) => t !== 10)
          .slice(0, 8)
          .map((t) => ({ time: t, pixels: Buffer.from(gradient(W, H, (t - 10) * 0.01).buffer) }));
      } catch (err) {
        console.log(`    framesNeeded failed: ${err.message}`);
      }
    }
    const t = Date.now();
    const res = await client.renderFrame({
      pluginId: id,
      instanceId: `smoke:${id}`,
      params,
      time: 10,
      width: W,
      height: H,
      format: 'rgba32f',
      pixels: Buffer.from(src.buffer),
      frames,
    });
    const roundTripMs = Date.now() - t;
    const out = asFloats(res.pixels);
    const s = stats(src, out);
    const name = `${label || id}`.replace(/[^a-z0-9.]+/gi, '_');
    writePng(path.join(outDir, `${name}.png`), out, W, H);
    writePpm(path.join(outDir, `${name}.ppm`), out, W, H);
    console.log(
      `  render ${id.padEnd(34)} ${String(roundTripMs).padStart(5)} ms (plugin ${res.renderMs.toFixed(1)} ms) diff=${s.meanAbsDiff.toFixed(4)} nonFinite=${s.nonFinite}+${res.nonFinite} frames=${frames.length} requested=[${(res.framesRequested || []).join(',')}]${res.warnings && res.warnings.length ? ` warnings=${res.warnings.join('; ')}` : ''}`,
    );
    return { res, s };
  };

  const optics = ownPlugins.find((p) => p.id === 'com.buckswood.optics.lab');
  if (optics) {
    const { s } = await renderOne(optics, { preset: 6 }, 'optics_lab_preset6');
    if (!(s.meanAbsDiff > 1e-4)) fail('Optics Lab output does not differ from input');
    if (s.nonFinite) fail('Optics Lab output contains NaN/Inf');
    // Instance reuse: second render with a changed param on the same instance.
    const { s: s2, res: r2 } = await renderOne(optics, { preset: 3, effectStrength: 1 }, 'optics_lab_preset3');
    if (r2.created) fail('instance was not reused');
    if (s2.nonFinite) fail('Optics Lab (preset 3) contains NaN/Inf');
  }

  const others = renderAll
    ? ownPlugins.filter((p) => p.supported && p.id !== 'com.buckswood.optics.lab')
    : ownPlugins.filter((p) =>
        ['com.buckswood.film.emulation', 'com.buckswood.lens.physics', 'com.buckswood.deband'].includes(p.id),
      );
  let otherOk = 0;
  for (const p of others) {
    try {
      const { s } = await renderOne(p, {}, p.id);
      if (s.nonFinite) fail(`${p.id} output contains NaN/Inf`);
      else otherOk += 1;
    } catch (err) {
      console.log(`  render ${p.id.padEnd(34)} ERROR ${err.message}`);
      if (!renderAll) fail(`${p.id}: ${err.message}`);
    }
  }
  if (!renderAll && others.length && otherOk === 0) fail('no other Buckswood Post Plugins plugin rendered');

  if (doBake && optics) {
    const ffmpeg = process.env.FFMPEG || 'ffmpeg';
    const probe = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' });
    if (probe.status !== 0) {
      console.log('  bake: skipped (ffmpeg not found; set FFMPEG=/path/to/ffmpeg)');
    } else {
      const input = path.join(outDir, 'bake_input.mp4');
      const output = path.join(outDir, 'bake_output.mov');
      const gen = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', input]);
      if (gen.status !== 0) {
        console.log(`  bake: skipped (could not create test clip: ${gen.stderr})`);
      } else {
        const t = Date.now();
        let lastProgress = null;
        const res = await client.bakeVideo(
          {
            input,
            output,
            ffmpegPath: ffmpeg,
            chain: [
              { pluginId: 'com.buckswood.optics.lab', params: { preset: 6 } },
              ...(ownPlugins.find((p) => p.id === 'com.buckswood.film.emulation') ? [{ pluginId: 'com.buckswood.film.emulation', params: {} }] : []),
            ],
            codec: 'prores_hq',
          },
          (p) => {
            lastProgress = p;
          },
        );
        const size = fs.existsSync(output) ? fs.statSync(output).size : 0;
        console.log(`  bake: ${res.frames} frames -> ${output} (${(size / 1024).toFixed(0)} KiB) in ${Date.now() - t} ms, avg ${res.avgFps.toFixed(1)} fps, audio=${res.audio}, last progress=${lastProgress ? `${lastProgress.frame}/${lastProgress.totalFrames}` : 'none'}`);
        if (!(res.frames >= 20) || size === 0) fail('bake produced no output');
      }
    }
  }
} catch (err) {
  fail(err.stack || err.message);
} finally {
  client.dispose();
}

console.log(`\noutput written to ${outDir}`);
if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('smoke OK');
