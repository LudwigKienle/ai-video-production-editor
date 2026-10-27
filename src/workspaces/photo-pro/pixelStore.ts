/**
 * Content store for layer and selection pixels. Canvases are treated as
 * immutable once committed to a document state; edits copy into a new key.
 * Unreferenced canvases are released by `gc()` after every history change.
 */

export class PixelStore {
  private canvases = new Map<string, HTMLCanvasElement>();
  private counter = 0;

  newKey(prefix = 'px') {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  create(width: number, height: number, prefix = 'px') {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const key = this.newKey(prefix);
    this.canvases.set(key, canvas);
    return { key, canvas };
  }

  /** Adopts an existing canvas (ownership moves to the store). */
  put(canvas: HTMLCanvasElement, prefix = 'px') {
    const key = this.newKey(prefix);
    this.canvases.set(key, canvas);
    return key;
  }

  /** Copy-on-write: a new key with a copy of `key`'s pixels. */
  copy(key: string, prefix = 'px') {
    const source = this.canvases.get(key);
    const { key: nextKey, canvas } = this.create(source?.width ?? 1, source?.height ?? 1, prefix);
    if (source) canvas.getContext('2d')!.drawImage(source, 0, 0);
    return { key: nextKey, canvas };
  }

  get(key: string | null | undefined) {
    return key ? this.canvases.get(key) : undefined;
  }

  has(key: string) {
    return this.canvases.has(key);
  }

  /** Bytes held by the given keys (or by everything). */
  bytes(keys?: Iterable<string>) {
    let total = 0;
    const list = keys ? [...keys] : [...this.canvases.keys()];
    for (const key of list) {
      const c = this.canvases.get(key);
      if (c) total += c.width * c.height * 4;
    }
    return total;
  }

  /** Releases every canvas not in `live`. Returns the number released. */
  gc(live: Set<string>) {
    let released = 0;
    for (const [key, canvas] of this.canvases) {
      if (live.has(key)) continue;
      canvas.width = 0;
      canvas.height = 0;
      this.canvases.delete(key);
      released += 1;
    }
    return released;
  }
}
