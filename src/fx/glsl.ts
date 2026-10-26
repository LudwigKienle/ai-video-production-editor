/**
 * Common GLSL ES 3.00 header for all FX passes.
 *
 * Coordinate convention (matches OFX): pixel centres sit on integer
 * coordinates, origin bottom-left, y up. Textures are uploaded with
 * UNPACK_FLIP_Y so row 0 is the bottom of the image.
 */
export const FX_GLSL_HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_src;
uniform sampler2D u_orig;
uniform vec2 u_size;
uniform int u_frame;
uniform float u_time;
uniform float u_mix;

out vec4 fragColor;

/**
 * Bilinear sample at pixel coordinate p, clamped to the frame — identical to
 * the Buckswood Post Plugins CPU sampler. Done manually with texelFetch: hardware linear
 * filtering only has ~8 bits of sub-texel weight precision, which visibly
 * deviates next to HDR highlights.
 */
vec4 bw_sample(sampler2D tex, vec2 p) {
  vec2 c = clamp(p, vec2(0.0), u_size - 1.0);
  vec2 f = floor(c);
  ivec2 i0 = ivec2(f);
  ivec2 lim = ivec2(u_size) - 1;
  ivec2 i1 = min(i0 + 1, lim);
  vec2 t = c - f;
  vec4 p00 = texelFetch(tex, i0, 0);
  vec4 p10 = texelFetch(tex, ivec2(i1.x, i0.y), 0);
  vec4 p01 = texelFetch(tex, ivec2(i0.x, i1.y), 0);
  vec4 p11 = texelFetch(tex, i1, 0);
  return mix(mix(p00, p10, t.x), mix(p01, p11, t.x), t.y);
}

/** Fast hardware-filtered variant for passes that don't need parity. */
vec4 bw_sample_fast(sampler2D tex, vec2 p) {
  vec2 c = clamp(p, vec2(0.0), u_size - 1.0);
  return texture(tex, (c + 0.5) / u_size);
}

vec4 bw_fetch(sampler2D tex, ivec2 p) {
  ivec2 s = ivec2(u_size);
  return texelFetch(tex, clamp(p, ivec2(0), s - 1), 0);
}

vec2 bw_pixel() {
  return gl_FragCoord.xy - 0.5;
}

float bw_clamp01(float v) { return clamp(v, 0.0, 1.0); }

float bw_smoothstep(float e0, float e1, float v) {
  float t = clamp((v - e0) / max(0.00001, e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float bw_luma2020(vec3 c) { return dot(c, vec3(0.2627, 0.6780, 0.0593)); }
float bw_luma709(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 bw_sanitize(vec3 v, vec3 fallback) {
  return vec3(
    (isnan(v.r) || isinf(v.r)) ? fallback.r : v.r,
    (isnan(v.g) || isinf(v.g)) ? fallback.g : v.g,
    (isnan(v.b) || isinf(v.b)) ? fallback.b : v.b
  );
}

/** Luminance asset texture sampled like Buckswood Post Plugins's TextureView (nearest, clamped UV). */
float bw_asset(sampler2D tex, vec2 uv) {
  ivec2 s = textureSize(tex, 0);
  vec2 c = clamp(uv, 0.0, 1.0);
  ivec2 p = min(s - 1, ivec2(c * vec2(s - 1) + 0.5));
  return texelFetch(tex, p, 0).r;
}
`;

/** Shared integer hash used by Buckswood Post Plugins grain (murmur-style finaliser). */
export const FX_GLSL_HASH = /* glsl */ `
float bw_hashNoise(int x, int y, int frame, float seed) {
  uint h = uint(x) * 0x8da6b343u;
  h ^= uint(y) * 0xd8163841u;
  h ^= uint(frame) * 0xcb1ab31fu;
  h ^= uint(seed * 4096.0 + 0.5) * 0x165667b1u;
  h ^= h >> 13u;
  h *= 0x85ebca6bu;
  h ^= h >> 16u;
  return float(h & 0x00ffffffu) / 8388607.5 - 1.0;
}
`;

export const FX_VERTEX_SHADER = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
