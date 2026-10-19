// Frame-by-frame recorder on a virtual 30 fps clock.
//
// The studio is captured one screenshot per video frame and piped into ffmpeg, so the
// result is sharp, repeatable and free of loading spinners: real time spent waiting for
// the app does not advance the video clock. While nothing moves, the last frame is reused.
//
// Scene scripts place actions on the narration with r.at('word'): the video time at which
// that word is spoken (scene time = word start + LEAD).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TUTORIAL_ROOT } from './browser.mjs';

export const FPS = 30;
export const LEAD = 0.5; // seconds of picture before the first word
export const TAIL = 0.9; // seconds after the last word

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

export function loadTimings(sceneId) {
  return JSON.parse(readFileSync(resolve(TUTORIAL_ROOT, `build/timings/${sceneId}.json`), 'utf8'));
}

export class Recorder {
  constructor(page, sceneId, { outDir = resolve(TUTORIAL_ROOT, 'build/screen'), quality = 92 } = {}) {
    this.page = page;
    this.scene = sceneId;
    this.timings = loadTimings(sceneId);
    this.duration = LEAD + this.timings.duration + TAIL;
    this.frames = Math.ceil(this.duration * FPS);
    this.frame = 0;
    this.quality = quality;
    this.marks = [];
    this.events = [];
    this.cursor = null;
    this.last = null;
    mkdirSync(outDir, { recursive: true });
    this.outFile = resolve(outDir, `${sceneId}.mp4`);
    this.marksFile = resolve(outDir, `${sceneId}.marks.json`);
  }

  get t() { return this.frame / FPS; }

  /** Video time of the n-th occurrence of a word (or "two words") in the narration. */
  at(phrase, n = 1, offset = 0) {
    const parts = phrase.split(/\s+/).map(norm);
    const words = this.timings.words;
    let seen = 0;
    for (let i = 0; i <= words.length - parts.length; i++) {
      if (parts.every((p, k) => norm(words[i + k].word) === p) && ++seen === n) return LEAD + words[i].start + offset;
    }
    throw new Error(`${this.scene}: "${phrase}" #${n} not in narration`);
  }

  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.ffmpeg = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', String(FPS), this.outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
    this.done = new Promise((ok, fail) => this.ffmpeg.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg ${code}`)))));
    await this.installCursor();
  }

  async installCursor() {
    await this.installCursorElement();
    // Continue from where the previous scene left the cursor (or rest it lower centre).
    const at = await this.page.evaluate(() => window.__recCursor || { x: 900, y: 620 });
    await this.setCursor(at.x, at.y);
  }

  async installCursorElement() {
    await this.page.evaluate(() => {
      if (document.getElementById('rec-cursor')) return;
      const root = document.createElement('div');
      root.id = 'rec-cursor';
      root.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
      root.innerHTML = `
        <div id="rec-ripple" style="position:absolute;left:-22px;top:-22px;width:44px;height:44px;border-radius:50%;
          border:2.5px solid rgba(129,140,248,.95);background:rgba(129,140,248,.18);opacity:0;transform:scale(.3)"></div>
        <svg width="26" height="30" viewBox="0 0 26 30" style="position:absolute;left:-3px;top:-2px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))">
          <path d="M3 2 L3 24 L9 18.5 L13 27.5 L17 25.8 L13.1 17 L21.5 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>`;
      document.body.appendChild(root);
    });
  }

  async setCursor(x, y, ripple = null) {
    this.cursor = { x, y };
    await this.page.evaluate(({ x, y, ripple }) => {
      const root = document.getElementById('rec-cursor');
      if (!root) return;
      root.style.transform = `translate(${x}px, ${y}px)`;
      window.__recCursor = { x, y };
      const r = document.getElementById('rec-ripple');
      if (ripple === null) { r.style.opacity = '0'; return; }
      r.style.opacity = String(1 - ripple);
      r.style.transform = `scale(${0.3 + ripple * 1.1})`;
    }, { x, y, ripple });
    await this.page.mouse.move(x, y);
  }

  async capture() {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: this.quality, optimizeForSpeed: true });
    this.last = Buffer.from(data, 'base64');
    await this.write(this.last);
  }

  async write(buf) {
    if (this.frame >= this.frames) return;
    if (!this.ffmpeg.stdin.write(buf)) await new Promise((ok) => this.ffmpeg.stdin.once('drain', ok));
    this.frame += 1;
  }

  /** Keep the picture still until video time `until` (one fresh capture, then reuse). */
  async hold(until) {
    if (this.frame >= this.frames || this.t >= until) return;
    await this.capture();
    while (this.t < until && this.frame < this.frames) await this.write(this.last);
  }

  /** Capture every frame until `until`, calling step(progress 0..1) before each one. */
  async live(until, step) {
    const from = this.t;
    const span = Math.max(until - from, 1 / FPS);
    while (this.t < until && this.frame < this.frames) {
      if (step) await step(Math.min(1, (this.t - from + 1 / FPS) / span));
      await this.capture();
    }
  }

  async box(target) {
    const loc = typeof target === 'string' ? this.page.locator(target).first() : target;
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    const b = await loc.boundingBox();
    if (!b) throw new Error(`${this.scene}: no box for ${target}`);
    return b;
  }

  /** Move the cursor to a target (locator, selector or {x,y}), starting at `at`. */
  async move(target, { at = this.t, dur = 0.7, dx = 0.5, dy = 0.5 } = {}) {
    const b = target && 'x' in target && !('width' in target) ? { x: target.x, y: target.y, width: 0, height: 0 } : await this.box(target);
    const to = { x: b.x + b.width * dx, y: b.y + b.height * dy };
    const from = this.cursor || { x: 768, y: 600 };
    await this.hold(at);
    await this.live(at + dur, (p) => this.setCursor(from.x + (to.x - from.x) * ease(p), from.y + (to.y - from.y) * ease(p)));
    return b;
  }

  /** Move to a target and click it at `at` (the cursor arrives just before). */
  async click(target, { at = this.t + 0.7, dur = 0.6, settle = 0.5, mark, ...opts } = {}) {
    const b = await this.move(target, { at: Math.max(this.t, at - dur), dur, ...opts });
    if (mark) this.mark(mark, b);
    const { x, y } = this.cursor;
    await this.live(this.t + 0.12, (p) => this.setCursor(x, y, p * 0.4));
    await this.page.mouse.down(); await this.page.mouse.up();
    this.events.push({ type: 'click', t: this.t, x, y });
    await this.page.waitForTimeout(350);
    await this.unshift();
    await this.live(this.t + settle, (p) => this.setCursor(x, y, Math.min(1, 0.4 + p)));
    await this.setCursor(x, y, null);
    return b;
  }

  /**
   * Some workspaces (Timeline) scroll the overflow:hidden app frame on open, which pushes
   * the toolbar off screen. Users cannot scroll such containers, so put them back at 0.
   */
  async unshift() {
    await this.page.evaluate(() => {
      for (const el of document.querySelectorAll('.app-frame, .app-frame *')) {
        if (el.scrollTop && getComputedStyle(el).overflowY === 'hidden') el.scrollTop = 0;
      }
    });
  }

  /** Type text into the focused element, a few characters per frame. */
  async type(text, { at = this.t, cps = 14 } = {}) {
    await this.hold(at);
    let i = 0;
    const end = at + text.length / cps;
    await this.live(end, async (p) => {
      const n = Math.round(p * text.length);
      if (n > i) { await this.page.keyboard.type(text.slice(i, n)); i = n; }
    });
    if (i < text.length) await this.page.keyboard.type(text.slice(i));
  }

  /** Paste a block of text into a textarea at once, as a real paste would. */
  async paste(target, text, { at = this.t } = {}) {
    await this.hold(at);
    const loc = typeof target === 'string' ? this.page.locator(target).first() : target;
    await loc.fill(text);
    await this.page.waitForTimeout(300);
  }

  /** Smoothly scroll the nearest scrollable ancestor of `target` so it is in view. */
  async scrollTo(target, { at = this.t, dur = 0.8, block = 'center' } = {}) {
    const loc = typeof target === 'string' ? this.page.locator(target).first() : target;
    const plan = await loc.evaluate((el, block) => {
      let s = el.parentElement;
      while (s && !(s.scrollHeight > s.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
      if (!s) return null;
      const er = el.getBoundingClientRect(), sr = s.getBoundingClientRect();
      const offset = block === 'start' ? er.top - sr.top - 24 : er.top + er.height / 2 - (sr.top + sr.height / 2);
      const target = Math.max(0, Math.min(s.scrollHeight - s.clientHeight, s.scrollTop + offset));
      window.__recScroll = s;
      return { from: s.scrollTop, to: target };
    }, block);
    if (!plan || Math.abs(plan.to - plan.from) < 2) return;
    await this.hold(at);
    await this.live(at + dur, (p) => this.page.evaluate((y) => { window.__recScroll.scrollTop = y; }, plan.from + (plan.to - plan.from) * ease(p)));
  }

  /** Remember where something is on screen at this moment (CSS px), for zooms and highlights in the edit. */
  mark(name, box) {
    this.marks.push({ name, t: +this.t.toFixed(3), x: box.x, y: box.y, w: box.width, h: box.height });
  }

  async markOf(name, target) {
    this.mark(name, await this.box(target));
  }

  async finish() {
    await this.hold(this.duration);
    while (this.frame < this.frames) await this.write(this.last);
    this.ffmpeg.stdin.end();
    await this.done;
    await this.cdp.detach().catch(() => {});
    writeFileSync(this.marksFile, JSON.stringify({ scene: this.scene, fps: FPS, lead: LEAD, duration: this.duration,
      viewport: await this.page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })), estimatedTimings: Boolean(this.timings.estimated), marks: this.marks, events: this.events }, null, 1));
    return { file: this.outFile, frames: this.frame, duration: this.duration };
  }
}
