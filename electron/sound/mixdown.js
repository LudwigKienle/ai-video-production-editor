/**
 * Export hook: renders the project's sound mix to a WAV file.
 *
 *   mixdownAudio({ folderPath, project, range: { start, end }, sampleRate, channels, onProgress?, signal?, normalize?, bitDepth? })
 *     → Promise<{ path, loudness: { integratedLufs, truePeakDb, rangeLu }, warnings }>
 *
 * ffmpeg only decodes the source files (to float PCM, only the source range
 * the timeline uses). Mixing — clip gain, fades, fader, pan, inserts, sends,
 * busses, automation, master — is done by the same TypeScript engine that the
 * Sound workspace plays live, so the export sounds exactly like the preview.
 * Works without `soundMix` too (clip volume, volume keyframes, mute/solo).
 *
 * No Electron dependency; the caller deletes the returned file.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

const { bounceMix } = require('../../src/workspaces/sound-pro/engine/bounce.ts');
const { decodeWav, encodeWav } = require('../../src/workspaces/sound-pro/engine/wav.ts');

const resolveFfmpegPath = () => {
    try {
        const ffmpegStatic = require('ffmpeg-static');
        return ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : 'ffmpeg';
    } catch {
        return 'ffmpeg';
    }
};

/** Media URL as stored in project.json → absolute file path, or null when it is not a local file. */
const resolveMediaPath = (folderPath, url) => {
    if (typeof url !== 'string' || !url) return null;
    if (/^(blob|data|https?):/i.test(url)) return null;
    if (/^file:/i.test(url)) {
        try {
            return fileURLToPath(url);
        } catch {
            return null;
        }
    }
    if (path.isAbsolute(url)) return url;
    return folderPath ? path.join(folderPath, url) : null;
};

const decodeRange = (ffmpegPath, filePath, { sampleRate, offsetSec, durationSec, signal }) =>
    new Promise((resolve, reject) => {
        const args = ['-v', 'error', '-nostdin'];
        if (offsetSec > 0) args.push('-ss', offsetSec.toFixed(6));
        args.push('-i', filePath);
        if (Number.isFinite(durationSec) && durationSec > 0) args.push('-t', durationSec.toFixed(6));
        // mono stays mono (the engine plays it on both sides at unity, like the preview);
        // more than two channels are folded down to stereo; WAV over the pipe carries the channel count
        args.push('-vn', '-sn', '-dn', '-af', 'aformat=channel_layouts=mono|stereo', '-ar', String(sampleRate), '-c:a', 'pcm_f32le', '-f', 'wav', 'pipe:1');
        const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        let size = 0;
        let stderr = '';
        const onAbort = () => proc.kill('SIGKILL');
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        proc.stdout.on('data', (chunk) => {
            chunks.push(chunk);
            size += chunk.length;
        });
        proc.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk.toString()).slice(-4000);
        });
        proc.on('error', (error) => {
            if (signal) signal.removeEventListener('abort', onAbort);
            reject(error);
        });
        proc.on('close', (code) => {
            if (signal) signal.removeEventListener('abort', onAbort);
            if (signal && signal.aborted) return reject(new Error('Mixdown abgebrochen'));
            if (code !== 0 && size === 0) return reject(new Error(`ffmpeg (${code}): ${stderr.trim() || 'Dekodierung fehlgeschlagen'}`));
            try {
                const buffer = Buffer.concat(chunks, size);
                const wav = decodeWav(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
                resolve({ channels: wav.channels.slice(0, 2), sampleRate, offsetSec });
            } catch (error) {
                reject(error);
            }
        });
    });

/** Source time span (seconds) each media file needs for the clips that touch the range. */
const neededSourceSpans = (clips, media, range) => {
    const typeById = new Map(media.map((m) => [m.id, m.type]));
    const spans = new Map();
    for (const clip of clips) {
        if (!clip || typeof clip !== 'object') continue;
        const type = typeById.get(clip.mediaId);
        if (type !== 'audio' && type !== 'video') continue;
        if (!(clip.end > range.start) || !(clip.start < range.end)) continue;
        const speed = Math.max(0.05, Number(clip.speed) > 0 ? Number(clip.speed) : 1);
        const sourceIn = Math.max(0, Number(clip.sourceIn) || 0);
        const from = sourceIn + Math.max(0, range.start - clip.start) * speed;
        const to = sourceIn + (Math.min(range.end, clip.end) - clip.start) * speed;
        const span = spans.get(clip.mediaId) || { from: Infinity, to: -Infinity };
        span.from = Math.min(span.from, from);
        span.to = Math.max(span.to, to);
        spans.set(clip.mediaId, span);
    }
    return spans;
};

const mixdownAudio = async (options = {}) => {
    const { folderPath = '', project = {}, onProgress, signal } = options;
    const range = options.range || {};
    const sampleRate = Math.round(Number(options.sampleRate) > 0 ? Number(options.sampleRate) : 48000);
    const outChannels = Number(options.channels) === 1 ? 1 : 2;
    const bitDepth = options.bitDepth === 16 ? 16 : options.bitDepth === 32 ? 32 : 24;
    const start = Math.max(0, Number(range.start) || 0);
    const end = Number(range.end);
    if (!Number.isFinite(end) || end <= start) throw new Error('mixdownAudio: range.end muss nach range.start liegen.');

    const clips = Array.isArray(project.timelineClips) ? project.timelineClips : [];
    const tracks = Array.isArray(project.timelineTracks) ? project.timelineTracks : [];
    const media = Array.isArray(project.mediaItems) ? project.mediaItems : [];
    const ffmpegPath = options.ffmpegPath || resolveFfmpegPath();
    const warnings = [];

    // decode only what the range needs, ±0.5 s for interpolation and fades
    const sources = new Map();
    const spans = neededSourceSpans(clips, media, { start, end });
    let decoded = 0;
    for (const [mediaId, span] of spans) {
        if (signal && signal.aborted) throw new Error('Mixdown abgebrochen');
        const item = media.find((m) => m.id === mediaId);
        const filePath = resolveMediaPath(folderPath, item && item.url);
        if (!filePath || !fs.existsSync(filePath)) {
            warnings.push(`Audio von „${(item && item.name) || mediaId}“ nicht als lokale Datei gefunden, Clip bleibt stumm.`);
            continue;
        }
        const offsetSec = Math.max(0, span.from - 0.5);
        try {
            sources.set(mediaId, await decodeRange(ffmpegPath, filePath, { sampleRate, offsetSec, durationSec: span.to - offsetSec + 0.5, signal }));
        } catch (error) {
            if (signal && signal.aborted) throw error;
            // video without an audio stream is normal; anything else is reported
            const message = String(error && error.message || error);
            if (!/does not contain any stream|Output file #0 does not contain|matches no streams/i.test(message)) {
                warnings.push(`„${(item && item.name) || mediaId}“: ${message.slice(0, 200)}`);
            }
        }
        decoded += 1;
        if (onProgress) onProgress(0.4 * (decoded / Math.max(1, spans.size)));
    }

    const result = bounceMix(
        { tracks, clips, media, mix: project.soundMix },
        (mediaId) => sources.get(mediaId) || null,
        {
            sampleRate,
            start,
            end,
            normalize: options.normalize === true,
            onProgress: (fraction) => {
                if (onProgress) onProgress(0.4 + 0.55 * fraction);
                return !(signal && signal.aborted);
            },
        },
    );
    if (result.aborted) throw new Error('Mixdown abgebrochen');

    let channels = result.channels;
    if (outChannels === 1) {
        const mono = new Float32Array(channels[0].length);
        for (let i = 0; i < mono.length; i++) mono[i] = 0.5 * (channels[0][i] + channels[1][i]);
        channels = [mono];
    }
    const bytes = encodeWav(channels, sampleRate, bitDepth === 16 ? 'pcm16' : bitDepth === 32 ? 'float32' : 'pcm24');
    const outPath = path.join(options.outputDir || os.tmpdir(), `avpe-mixdown-${crypto.randomBytes(6).toString('hex')}.wav`);
    await fs.promises.writeFile(outPath, bytes);
    if (onProgress) onProgress(1);
    const { integratedLufs, truePeakDb, rangeLu } = result.loudness;
    return {
        path: outPath,
        loudness: {
            integratedLufs: Number.isFinite(integratedLufs) ? integratedLufs : null,
            truePeakDb: Number.isFinite(truePeakDb) ? truePeakDb : null,
            rangeLu,
        },
        appliedGainDb: result.appliedGainDb,
        warnings,
    };
};

module.exports = { mixdownAudio, resolveMediaPath };
