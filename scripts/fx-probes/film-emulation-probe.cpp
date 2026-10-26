// Generates Film Emulation (v2.1) reference frames from the original C++ core.
//
// Build flags matter (see README): -ffp-contract=off keeps every float op a
// plain IEEE op (no FMA fusion), and the sinf() below replaces the libm one so
// the sin-based grain/dust hash is platform independent.
#include "FilmEmulationCore.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
using namespace buckswood_film;

// Correctly rounded sinf. Apple's libm sinf is only faithfully rounded (~17 % of
// results differ by 1 ulp from glibc / the JS reference), which flips the
// fract(sin(x) * 43758.5453) hash of the core. Interposing this keeps the core
// math untouched but makes the goldens host independent. Build with
// -DFX_PROBE_NATIVE_SINF to see the host libm variant.
#ifndef FX_PROBE_NATIVE_SINF
extern "C" float sinf(float x) { return static_cast<float>(std::sin(static_cast<double>(x))); }
#endif

static const int W = 40, H = 24;
struct Img : Sampler {
  std::vector<float> d;
  Img() : d(W * H * 4) {
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
      float* p = &d[(y * W + x) * 4];
      p[0] = x / float(W - 1); p[1] = y / float(H - 1); p[2] = 0.5f + 0.5f * float(std::sin(double(x * 0.7f + y * 0.3f)));
      p[3] = x / float(W - 1);
      float d1 = (x - 10) * (x - 10) + (y - 8) * (y - 8);
      float d2 = (x - 30) * (x - 30) + (y - 16) * (y - 16);
      if (d1 < 6) { p[0] = p[1] = p[2] = 3.0f; }
      if (d2 < 4) { p[0] = 1.6f; p[1] = 1.4f; p[2] = 1.2f; }
    }
  }
  // Same as the OFX FloatSampler (BuckswoodFilmEmulationOFX.cpp): bilinear,
  // transparent black outside the frame.
  Pixel sample(float x, float y) const override {
    if (x < 0.f || x > float(W - 1) || y < 0.f || y > float(H - 1)) return Pixel{0.f, 0.f, 0.f, 0.f};
    int x0 = int(x), y0 = int(y);
    int x1 = std::min(W - 1, x0 + 1), y1 = std::min(H - 1, y0 + 1);
    float tx = x - x0, ty = y - y0, u = 1 - tx, v = 1 - ty;
    const float *a = &d[(y0 * W + x0) * 4], *b = &d[(y0 * W + x1) * 4], *c = &d[(y1 * W + x0) * 4], *e = &d[(y1 * W + x1) * 4];
    Pixel o; float* po = &o.r;
    for (int k = 0; k < 4; ++k) po[k] = (a[k] * u + b[k] * tx) * v + (c[k] * u + e[k] * tx) * ty;
    return o;
  }
};

// Copy of sourceLooksLikeBlankAdjustment() from BuckswoodFilmEmulationOFX.cpp (float path).
static bool looksBlank(const Img& img) {
  float maxRgb = 0.0f, alphaSum = 0.0f; int samples = 0; const int grid = 7;
  for (int gy = 0; gy < grid; ++gy) {
    const int y = (H - 1) * gy / (grid - 1);
    for (int gx = 0; gx < grid; ++gx) {
      const int x = (W - 1) * gx / (grid - 1);
      const float* p = &img.d[(y * W + x) * 4];
      maxRgb = std::max(maxRgb, std::max(p[0], std::max(p[1], p[2])));
      alphaSum += p[3]; ++samples;
      if (maxRgb > 0.015f) return false;
    }
  }
  return samples > 0 && (alphaSum / samples) > 0.75f && maxRgb < 0.015f;
}

int main(int argc, char** argv) {
  if (argc < 3) { std::fprintf(stderr, "usage: probe cases.txt outDir\n"); return 1; }
  std::ifstream in(argv[1]); std::string outDir = argv[2]; std::string line; Img img;
  while (std::getline(in, line)) {
    if (line.empty() || line[0] == '#') continue;
    std::istringstream ss(line); std::string name; ss >> name; std::map<std::string, double> kv; std::string tok;
    while (ss >> tok) { auto e = tok.find('='); kv[tok.substr(0, e)] = std::stod(tok.substr(e + 1)); }
    // Same conversion as the OFX host glue: double param -> static_cast<float>.
    auto g = [&](const char* k, double def) { return static_cast<float>(kv.count(k) ? kv[k] : def); };
    auto gi = [&](const char* k, int def) { return kv.count(k) ? int(kv[k]) : def; };
    Controls c{};
    c.inputSpace = gi("inputSpace", 1); c.stockPreset = gi("stockPreset", 8); c.printPreset = gi("printPreset", 6);
    c.processMode = gi("processMode", 0); c.grainProfile = gi("grainProfile", 3); c.halationProfile = gi("halationProfile", 2);
    c.bloomProfile = gi("bloomProfile", 2); c.grainMode = gi("grainMode", 1); c.viewMode = gi("viewMode", 0);
    c.exposure = g("exposure", 0.0); c.pushPull = g("pushPull", 0.0); c.density = g("density", 0.18); c.contrast = g("contrast", 1.0);
    c.developerContrast = g("developerContrast", 0.10); c.developerGamma = g("developerGamma", 0.0);
    c.colorSeparation = g("colorSeparation", 0.30); c.colorBoost = g("colorBoost", 0.04); c.saturation = g("saturation", 0.94);
    c.temperature = g("temperature", 0.0); c.tint = g("tint", 0.0); c.subtractiveColor = g("subtractiveColor", 0.34);
    c.interlayer = g("interlayer", 0.34); c.neutralizeCurves = g("neutralizeCurves", 0.0); c.bleachBypass = g("bleachBypass", 0.0);
    c.filmCompression = g("filmCompression", 0.38); c.compressionWhitePoint = g("compressionWhitePoint", 1.08);
    c.compressionRange = g("compressionRange", 0.55); c.compressionColorDensity = g("compressionColorDensity", 0.48);
    c.expandBlackPoint = g("expandBlackPoint", 0.0); c.expandWhitePoint = g("expandWhitePoint", 0.0);
    c.printerCyan = g("printerCyan", 0.0); c.printerMagenta = g("printerMagenta", 0.0); c.printerYellow = g("printerYellow", 0.0);
    c.highlightRolloff = g("highlightRolloff", 0.62); c.blackLift = g("blackLift", 0.0);
    c.halation = g("halation", 0.12); c.halationLocal = g("halationLocal", 0.70); c.halationGlobal = g("halationGlobal", 0.18);
    c.halationRedShift = g("halationRedShift", 0.72); c.bloom = g("bloom", 0.05); c.bloomThreshold = g("bloomThreshold", 0.78);
    c.bloomSpread = g("bloomSpread", 0.42); c.grain = g("grain", 0.18); c.grainSize = g("grainSize", 0.85);
    c.grainShadows = g("grainShadows", 0.70); c.grainMidtones = g("grainMidtones", 0.55); c.grainHighlights = g("grainHighlights", 0.42);
    c.grainChroma = g("grainChroma", 0.26); c.filmResolution = g("filmResolution", 0.82); c.gateWeave = g("gateWeave", 0.04);
    c.dust = g("dust", 0.0); c.scratches = g("scratches", 0.0); c.flicker = g("flicker", 0.0); c.filmBreath = g("filmBreath", 0.08);
    c.temporalReconstruction = g("temporalReconstruction", 0.0); c.temporalStability = g("temporalStability", 0.62);
    c.temporalMotionGuard = g("temporalMotionGuard", 0.82); c.skinProtect = g("skinProtect", 0.72); c.outputMix = g("outputMix", 0.75);
    const bool guard = gi("adjustmentLayerGuard", 1) != 0;

    FrameInfo f{W, H, gi("frameIndex", 0)};
    auto st = FilmEmulationCore::prepare(f, c);
    std::vector<float> out(W * H * 4, 0.0f);
    if (!(guard && looksBlank(img))) {
      for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        // No temporal context: single-frame path (temporal reconstruction is a no-op).
        Pixel p = FilmEmulationCore::processPixel(img, x, y, f, c, st, nullptr);
        float* o = &out[(y * W + x) * 4]; o[0] = p.r; o[1] = p.g; o[2] = p.b; o[3] = p.a;
      }
    }
    FILE* fp = std::fopen((outDir + "/" + name + ".f32").c_str(), "wb"); std::fwrite(out.data(), 4, out.size(), fp); std::fclose(fp);
    std::printf("%s ok\n", name.c_str());
  }
}
