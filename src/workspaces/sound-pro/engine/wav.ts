/**
 * WAV (RIFF, little endian) encoding and decoding for mixdowns and stems.
 * Written from the public RIFF/WAVE format description.
 */

export type WavFormat = 'pcm16' | 'pcm24' | 'float32';

export const encodeWav = (channels: Float32Array[], sampleRate: number, format: WavFormat = 'pcm24'): Uint8Array => {
  const numCh = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format === 'float32' ? 3 : 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const data = channels[ch] ?? channels[0];
      let x = data ? data[i] : 0;
      if (!Number.isFinite(x)) x = 0;
      if (format === 'float32') {
        view.setFloat32(offset, x, true);
      } else {
        x = Math.max(-1, Math.min(1, x));
        if (format === 'pcm16') {
          view.setInt16(offset, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true);
        } else {
          const v = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
          bytes[offset] = v & 0xff;
          bytes[offset + 1] = (v >> 8) & 0xff;
          bytes[offset + 2] = (v >> 16) & 0xff;
        }
      }
      offset += bytesPerSample;
    }
  }
  return bytes;
};

export type DecodedWav = { sampleRate: number; channels: Float32Array[] };

/** Minimal reader for PCM 16/24/32 and float32 WAV (used by tests and stem re-import). */
export const decodeWav = (input: Uint8Array): DecodedWav => {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const tag = (o: number) => String.fromCharCode(input[o], input[o + 1], input[o + 2], input[o + 3]);
  if (input.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Keine WAV-Datei');
  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (offset + 8 <= input.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      const tagFormat = view.getUint16(body, true);
      fmt = {
        // WAVE_FORMAT_EXTENSIBLE: the real format is the first word of the sub-format GUID
        audioFormat: tagFormat === 0xfffe && size >= 26 ? view.getUint16(body + 24, true) : tagFormat,
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV ohne fmt-Block');
      const bytesPer = fmt.bits / 8;
      const numCh = Math.max(1, fmt.channels);
      // streamed WAV (pipe) has no final size: 0 or 0xFFFFFFFF means "until the end"
      const end = size === 0 || size === 0xffffffff ? input.byteLength : Math.min(input.byteLength, body + size);
      const frames = Math.floor((end - body) / (bytesPer * numCh));
      const channels = Array.from({ length: numCh }, () => new Float32Array(frames));
      let p = body;
      for (let i = 0; i < frames; i++) {
        for (let ch = 0; ch < numCh; ch++) {
          let x = 0;
          if (fmt.audioFormat === 3 && fmt.bits === 32) x = view.getFloat32(p, true);
          else if (fmt.bits === 16) x = view.getInt16(p, true) / 0x8000;
          else if (fmt.bits === 24) {
            let v = input[p] | (input[p + 1] << 8) | (input[p + 2] << 16);
            if (v & 0x800000) v |= ~0xffffff;
            x = v / 0x800000;
          } else if (fmt.bits === 32) x = view.getInt32(p, true) / 0x80000000;
          channels[ch][i] = x;
          p += bytesPer;
        }
      }
      return { sampleRate: fmt.sampleRate, channels };
    }
    if (size === 0xffffffff) break;
    offset = body + size + (size % 2);
  }
  throw new Error('WAV ohne data-Block');
};
