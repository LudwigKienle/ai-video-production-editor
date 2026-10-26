// The Sound workspace's electron/sound/mixdown.js comes from another branch. This test plants a
// stub under that module id so the static require in ffmpeg-handler.js picks it up.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

test('ffmpeg-handler statically loads electron/sound/mixdown when present', () => {
    const fakeId = path.join(__dirname, 'sound', 'mixdown.js');
    const stub = { mixdownAudio: async () => ({ path: '/dev/null' }) };
    const originalResolve = Module._resolveFilename;
    Module._resolveFilename = function resolve(request, parent, ...rest) {
        if (request === './sound/mixdown' && parent && /ffmpeg-handler\.js$/.test(parent.filename)) return fakeId;
        return originalResolve.call(this, request, parent, ...rest);
    };
    const cached = new Module(fakeId);
    cached.filename = fakeId;
    cached.loaded = true;
    cached.exports = stub;
    require.cache[fakeId] = cached;
    const handlerPath = require.resolve('./ffmpeg-handler');
    delete require.cache[handlerPath];
    try {
        const handler = require('./ffmpeg-handler');
        assert.equal(typeof handler.getSoundMixdownForTests, 'function');
        assert.equal(handler.getSoundMixdownForTests(), stub);
    } finally {
        Module._resolveFilename = originalResolve;
        delete require.cache[fakeId];
        delete require.cache[handlerPath];
    }
    const plain = require('./ffmpeg-handler');
    assert.equal(plain.getSoundMixdownForTests(), null, 'without the module the hook is off');
    delete require.cache[handlerPath];
});
