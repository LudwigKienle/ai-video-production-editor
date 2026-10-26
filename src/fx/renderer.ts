/**
 * WebGL2 renderer for FX stacks. One instance owns one GL context; use
 * `getSharedFxRenderer()` for the timeline preview and a private instance for
 * long-running jobs (photo export, bake) so they don't fight over state.
 */
import { FX_GLSL_HEADER, FX_VERTEX_SHADER } from './glsl.ts';
import { getFxDefinition, resolveParams } from './registry.ts';
import type { FxDefinition, FxFrameContext, FxPass, FxStack, FxUniformValue } from './types.ts';

type UniformInfo = { location: WebGLUniformLocation; type: number; size: number };
type ProgramEntry = { program: WebGLProgram; uniforms: Map<string, UniformInfo> };
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };

export type FxRenderSource = TexImageSource | { width: number; height: number; data: Float32Array };

export type FxRenderOptions = {
  frameIndex?: number;
  time?: number;
  quality?: 'preview' | 'full';
  /** Output size; defaults to the source size. */
  width?: number;
  height?: number;
};

const MIX_FRAGMENT = /* glsl */ `
uniform sampler2D u_effect;
void main() {
  vec2 p = bw_pixel();
  vec4 a = bw_fetch(u_orig, ivec2(p));
  vec4 b = bw_fetch(u_effect, ivec2(p));
  fragColor = vec4(mix(a.rgb, b.rgb, u_mix), b.a);
}
`;

const COPY_FRAGMENT = /* glsl */ `
void main() {
  vec4 c = bw_fetch(u_src, ivec2(bw_pixel()));
  fragColor = vec4(clamp(c.rgb, 0.0, 1.0), clamp(c.a, 0.0, 1.0));
}
`;

const MAX_DIMENSION = 4096;
/** Texture unit used only for allocations/uploads, never for sampling. */
const SCRATCH_UNIT = 15;

const sourceSize = (source: FxRenderSource): { width: number; height: number } => {
  const anySource = source as unknown as Record<string, number>;
  const width = anySource.videoWidth || anySource.naturalWidth || anySource.displayWidth || anySource.width || 0;
  const height = anySource.videoHeight || anySource.naturalHeight || anySource.displayHeight || anySource.height || 0;
  return { width, height };
};

export class FxRenderer {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private floatTargets: boolean;
  private programs = new Map<string, ProgramEntry>();
  private assetTextures = new Map<string, WebGLTexture>();
  private sourceTexture: WebGLTexture;
  private targets: Target[] = [];
  private quad: WebGLVertexArrayObject;
  private lost = false;
  private lastTarget: Target | null = null;

  constructor(canvas?: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas =
      canvas ??
      (typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(16, 16));
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
      depth: false,
      stencil: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.floatTargets = Boolean(gl.getExtension('EXT_color_buffer_float'));
    gl.getExtension('OES_texture_float_linear');
    if ('addEventListener' in this.canvas) {
      (this.canvas as HTMLCanvasElement).addEventListener?.('webglcontextlost', (event) => {
        event.preventDefault();
        this.lost = true;
      });
    }

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error('Failed to allocate WebGL buffers');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.quad = vao;

    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to allocate source texture');
    this.sourceTexture = texture;
    this.configureTexture(texture, gl.LINEAR);
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /**
   * Renders `stack` over `source`. Returns the GL canvas (y-up, ready for
   * `drawImage`). The canvas content stays valid until the next render call.
   */
  render(source: FxRenderSource, stack: FxStack, options: FxRenderOptions = {}): HTMLCanvasElement | OffscreenCanvas {
    const gl = this.gl;
    const natural = sourceSize(source);
    let width = Math.max(1, Math.round(options.width ?? natural.width));
    let height = Math.max(1, Math.round(options.height ?? natural.height));
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;

    this.uploadSource(source, width, height);
    const frame: FxFrameContext = {
      width,
      height,
      frameIndex: Math.floor(options.frameIndex ?? 0),
      time: options.time ?? 0,
      quality: options.quality ?? 'full',
    };

    let current: WebGLTexture = this.sourceTexture;
    // Picks a render target that is not currently being read from.
    const nextTarget = (...busy: WebGLTexture[]) => {
      for (let index = 0; ; index += 1) {
        const target = this.ensureTarget(index, width, height);
        if (!busy.includes(target.texture)) return target;
      }
    };

    for (const instance of stack) {
      if (!instance.enabled) continue;
      const mix = Math.min(1, Math.max(0, instance.mix ?? 1));
      if (mix <= 0.0001) continue;
      const definition = getFxDefinition(instance.effectId);
      if (!definition) continue;
      const params = resolveParams(instance);
      const instanceInput = current;
      const passOutputs = new Map<string, WebGLTexture>();
      for (const pass of definition.passes) {
        const target = nextTarget(current, instanceInput, ...passOutputs.values());
        this.runPass(definition, pass, params, frame, current, instanceInput, passOutputs, target, mix);
        passOutputs.set(pass.id, target.texture);
        current = target.texture;
      }
      if (mix < 0.9999) {
        const target = nextTarget(current, instanceInput);
        const entry = this.program('__mix', MIX_FRAGMENT);
        this.bindTarget(target);
        gl.useProgram(entry.program);
        this.bindTexture(entry, 'u_orig', instanceInput, 0);
        this.bindTexture(entry, 'u_effect', current, 1);
        this.setCommon(entry, frame, mix);
        this.draw();
        current = target.texture;
      }
    }

    this.lastTarget = this.targets.find((target) => target.texture === current) ?? null;

    // Final copy to the default framebuffer (the visible canvas).
    const copy = this.program('__copy', COPY_FRAGMENT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(copy.program);
    this.bindTexture(copy, 'u_src', current, 0);
    this.setCommon(copy, frame, 1);
    this.draw();
    return this.canvas;
  }

  /** Reads the last rendered frame as RGBA8, top row first. */
  readPixels(): Uint8ClampedArray {
    const gl = this.gl;
    const { width, height } = this.canvas;
    const raw = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    const out = new Uint8ClampedArray(raw.length);
    const row = width * 4;
    for (let y = 0; y < height; y += 1) {
      out.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    }
    return out;
  }

  /**
   * Reads the unclamped result of the last render (float, bottom row first —
   * OFX order). Returns null when nothing was rendered into a float target.
   */
  readFloatPixels(): Float32Array | null {
    const gl = this.gl;
    const target = this.lastTarget;
    if (!target || !this.floatTargets) return null;
    const out = new Float32Array(target.width * target.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  dispose(): void {
    const gl = this.gl;
    this.programs.forEach((entry) => gl.deleteProgram(entry.program));
    this.assetTextures.forEach((texture) => gl.deleteTexture(texture));
    this.targets.forEach((target) => {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    });
    gl.deleteTexture(this.sourceTexture);
    this.programs.clear();
    this.assetTextures.clear();
    this.targets = [];
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private runPass(
    definition: FxDefinition,
    pass: FxPass,
    params: Record<string, number | boolean | string>,
    frame: FxFrameContext,
    input: WebGLTexture,
    original: WebGLTexture,
    passOutputs: Map<string, WebGLTexture>,
    target: Target,
    mix: number,
  ) {
    const gl = this.gl;
    const entry = this.program(`${definition.id}#${pass.id}`, pass.fragment);
    // Create asset textures before binding anything: allocation binds the
    // new texture and would otherwise clobber an already bound input unit.
    const assets = (pass.textures?.(params, frame) ?? []).map((request) => {
      let texture = this.assetTextures.get(request.key);
      if (!texture) {
        texture = this.createLumaTexture(request.width, request.height, request.build());
        this.assetTextures.set(request.key, texture);
      }
      return { uniform: request.uniform, texture };
    });
    this.bindTarget(target);
    gl.useProgram(entry.program);
    let unit = 0;
    this.bindTexture(entry, 'u_src', input, unit++);
    this.bindTexture(entry, 'u_orig', original, unit++);
    for (const inputId of pass.inputs ?? []) {
      const texture = passOutputs.get(inputId);
      if (texture) this.bindTexture(entry, `u_pass_${inputId}`, texture, unit++);
    }
    for (const asset of assets) this.bindTexture(entry, asset.uniform, asset.texture, unit++);
    this.setCommon(entry, frame, mix);
    const uniforms = pass.uniforms?.(params, frame) ?? {};
    for (const [name, value] of Object.entries(uniforms)) this.setUniform(entry, name, value);
    this.draw();
  }

  private setCommon(entry: ProgramEntry, frame: FxFrameContext, mix: number) {
    this.setUniform(entry, 'u_size', [frame.width, frame.height]);
    this.setUniform(entry, 'u_frame', frame.frameIndex);
    this.setUniform(entry, 'u_time', frame.time);
    this.setUniform(entry, 'u_mix', mix);
  }

  private draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  private bindTarget(target: Target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
  }

  private bindTexture(entry: ProgramEntry, name: string, texture: WebGLTexture, unit: number) {
    const gl = this.gl;
    const info = entry.uniforms.get(name);
    if (!info) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(info.location, unit);
  }

  private setUniform(entry: ProgramEntry, name: string, value: FxUniformValue) {
    const gl = this.gl;
    const info = entry.uniforms.get(name);
    if (!info) return;
    const values = typeof value === 'boolean' ? [value ? 1 : 0] : typeof value === 'number' ? [value] : Array.from(value as ArrayLike<number>);
    const loc = info.location;
    switch (info.type) {
      case gl.FLOAT:
        if (info.size > 1) gl.uniform1fv(loc, values);
        else gl.uniform1f(loc, values[0] ?? 0);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(loc, values);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(loc, values);
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(loc, values);
        break;
      case gl.INT:
      case gl.BOOL:
        if (info.size > 1) gl.uniform1iv(loc, values.map((v) => Math.round(v)));
        else gl.uniform1i(loc, Math.round(values[0] ?? 0));
        break;
      case gl.INT_VEC2:
        gl.uniform2iv(loc, values.map((v) => Math.round(v)));
        break;
      default:
        break;
    }
  }

  private program(key: string, fragmentBody: string): ProgramEntry {
    const cached = this.programs.get(key);
    if (cached) return cached;
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('createShader failed');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`FX shader "${key}" failed to compile: ${log}`);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, FX_VERTEX_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, `${FX_GLSL_HEADER}\n${fragmentBody}`);
    const program = gl.createProgram();
    if (!program) throw new Error('createProgram failed');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`FX program "${key}" failed to link: ${gl.getProgramInfoLog(program)}`);
    }
    const uniforms = new Map<string, UniformInfo>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i += 1) {
      const active = gl.getActiveUniform(program, i);
      if (!active) continue;
      const name = active.name.replace(/\[0\]$/, '');
      const location = gl.getUniformLocation(program, active.name);
      if (location) uniforms.set(name, { location, type: active.type, size: active.size });
    }
    const entry = { program, uniforms };
    this.programs.set(key, entry);
    return entry;
  }

  private configureTexture(texture: WebGLTexture, filter: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private ensureTarget(index: number, width: number, height: number): Target {
    const gl = this.gl;
    const existing = this.targets[index];
    if (existing && existing.width === width && existing.height === height) return existing;
    if (existing) {
      gl.deleteTexture(existing.texture);
      gl.deleteFramebuffer(existing.framebuffer);
    }
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Failed to allocate FX render target');
    this.configureTexture(texture, gl.LINEAR);
    if (this.floatTargets) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const target = { texture, framebuffer, width, height };
    this.targets[index] = target;
    return target;
  }

  private uploadSource(source: FxRenderSource, width: number, height: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + SCRATCH_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if ('data' in source && source.data instanceof Float32Array) {
      // Float images are already bottom-up (OFX convention): no flip.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, source.width, source.height, 0, gl.RGBA, gl.FLOAT, source.data);
    } else {
      const natural = sourceSize(source);
      if (natural.width === width && natural.height === height) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
      } else {
        // Resample through a 2D canvas when the requested size differs.
        const scratch = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(width, height);
        scratch.width = width;
        scratch.height = height;
        const ctx = scratch.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        ctx?.drawImage(source as CanvasImageSource, 0, 0, width, height);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, scratch as TexImageSource);
      }
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  private createLumaTexture(width: number, height: number, data: Float32Array): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to allocate asset texture');
    this.configureTexture(texture, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    return texture;
  }
}

let shared: FxRenderer | null = null;
let sharedFailed = false;

/** Lazily created renderer for interactive previews. Returns null without WebGL2. */
export function getSharedFxRenderer(): FxRenderer | null {
  if (sharedFailed) return null;
  if (shared && !shared.isLost) return shared;
  try {
    shared = new FxRenderer();
    return shared;
  } catch (error) {
    console.warn('[fx] WebGL2 renderer unavailable', error);
    sharedFailed = true;
    return null;
  }
}
