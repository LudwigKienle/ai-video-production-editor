const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const { runSurfaceMapProcess } = require('./surface-map-runtime');

const makeDepthPlate = () => {
  const canvas = createCanvas(3, 3);
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(3, 3);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 3; x += 1) {
      const index = (y * 3 + x) * 4;
      const value = Math.round(((x + y) / 4) * 255);
      imageData.data[index] = value;
      imageData.data[index + 1] = value;
      imageData.data[index + 2] = value;
      imageData.data[index + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toBuffer('image/png').toString('base64');
};

test('surface map runtime generates a local normal map from a depth plate', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'surface-map-runtime-'));
  const result = await runSurfaceMapProcess({
    projectPath,
    source: {
      base64: makeDepthPlate(),
      mimeType: 'image/png',
      name: 'Depth Guide.png',
    },
    options: {
      kind: 'normal',
      engine: 'depth-gradient',
      normalStrength: 2,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, 'normal');
  assert.equal(result.engine, 'depth-gradient');
  assert.equal(result.mediaType, 'image');
  assert.equal(result.outputName.endsWith('.png'), true);
  assert.equal(result.url.startsWith('file://'), true);

  const output = await fs.readFile(result.outputPath);
  assert.deepEqual([...output.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
