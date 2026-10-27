/**
 * Web Worker: synthesises the start sound off the main thread, so the first
 * splash frames are not delayed. Replies with the interleaved stereo samples.
 */
import { synthStartSound } from './startSound.ts';

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ sampleRate: number }>) => void) | null; postMessage: (message: unknown, transfer: Transferable[]) => void };

scope.onmessage = (event) => {
  const samples = synthStartSound(event.data.sampleRate);
  scope.postMessage({ sampleRate: event.data.sampleRate, samples }, [samples.buffer]);
};
