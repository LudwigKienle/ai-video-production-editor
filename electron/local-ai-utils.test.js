const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  isAllowedLocalUrl,
  isAllowedDownloadUrl,
  shouldSendHfToken,
  resolveInsideRoot,
  parseNdjsonChunk,
  totalFromHeaders,
} = require('./local-ai-utils');

test('only local and LAN servers are reachable through the bridge', () => {
  assert.equal(isAllowedLocalUrl('http://localhost:11434/api/tags'), true);
  assert.equal(isAllowedLocalUrl('http://127.0.0.1:1234/v1/models'), true);
  assert.equal(isAllowedLocalUrl('http://[::1]:8188/prompt'), true);
  assert.equal(isAllowedLocalUrl('http://192.168.1.20:11434/api/chat'), true);
  assert.equal(isAllowedLocalUrl('http://studio.local:7860/sdapi/v1/txt2img'), true);
  assert.equal(isAllowedLocalUrl('http://172.32.0.1/'), false);
  assert.equal(isAllowedLocalUrl('https://api.openai.com/v1/chat/completions'), false);
  assert.equal(isAllowedLocalUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedLocalUrl('not a url'), false);
});

test('downloads start at a model hub over https', () => {
  assert.equal(isAllowedDownloadUrl('https://huggingface.co/Comfy-Org/Qwen-Image-2.1/resolve/main/vae/qwen_image_2.1_vae_bf16.safetensors'), true);
  assert.equal(isAllowedDownloadUrl('https://cdn-lfs.hf.co/x'), true);
  assert.equal(isAllowedDownloadUrl('http://huggingface.co/x'), false);
  assert.equal(isAllowedDownloadUrl('https://evil-huggingface.co/x'), false);
  assert.equal(isAllowedDownloadUrl('https://example.com/model.safetensors'), false);
});

test('the Hugging Face token is not sent to CDNs', () => {
  assert.equal(shouldSendHfToken('https://huggingface.co/a/b/resolve/main/c'), true);
  assert.equal(shouldSendHfToken('https://cas-bridge.xethub.hf.co/x'), false);
  assert.equal(shouldSendHfToken('https://cdn-lfs.huggingface.co/x'), false);
});

test('model files stay inside the models folder', () => {
  const root = path.resolve('/tmp/models');
  assert.equal(resolveInsideRoot(root, 'vae/flux2-vae.safetensors'), path.join(root, 'vae', 'flux2-vae.safetensors'));
  assert.throws(() => resolveInsideRoot(root, '../outside.safetensors'));
  assert.throws(() => resolveInsideRoot(root, '/etc/passwd'));
  assert.throws(() => resolveInsideRoot('', 'a'));
});

test('NDJSON chunks keep a partial last line for the next chunk', () => {
  const first = parseNdjsonChunk('{"status":"pulling"}\n{"status":"downl');
  assert.deepEqual(first.items, [{ status: 'pulling' }]);
  assert.equal(first.rest, '{"status":"downl');
  const second = parseNdjsonChunk(`${first.rest}oading","completed":5}\nnot json\n`);
  assert.deepEqual(second.items, [{ status: 'downloading', completed: 5 }]);
  assert.equal(second.rest, '');
});

test('total size comes from Content-Range when resuming', () => {
  assert.equal(totalFromHeaders({ 'content-range': 'bytes 100-999/1000', 'content-length': '900' }, 100), 1000);
  assert.equal(totalFromHeaders({ 'content-length': '500' }, 0), 500);
  assert.equal(totalFromHeaders({}, 0), 0);
});
