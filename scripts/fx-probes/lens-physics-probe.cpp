// Generates Lens Physics v0.5 reference frames from the original C++ core.
//
// The sampler is a copy of the OFX plugin's FloatSampler
// (BuckswoodLensPhysicsOFX.cpp): bilinear, but transparent black outside the
// frame (no clamping) — that is what Resolve renders, so the goldens use it.
#include "LensPhysicsCore.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
using namespace buckswood_lens;
static const int W = 40, H = 24;
struct Img {
  std::vector<float> d;
  Img() : d(W * H * 4) {
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
      float* p = &d[(y * W + x) * 4];
      p[0] = x / float(W - 1); p[1] = y / float(H - 1); p[2] = 0.5f + 0.5f * std::sin(x * 0.7f + y * 0.3f);
      p[3] = x / float(W - 1);
      float d1 = (x - 10) * (x - 10) + (y - 8) * (y - 8);
      float d2 = (x - 30) * (x - 30) + (y - 16) * (y - 16);
      if (d1 < 6) { p[0] = p[1] = p[2] = 3.0f; }
      if (d2 < 4) { p[0] = 1.6f; p[1] = 1.4f; p[2] = 1.2f; }
    }
  }
  Pixel read(int x, int y) const {
    if (x < 0 || x >= W || y < 0 || y >= H) return Pixel{0.0f, 0.0f, 0.0f, 0.0f};
    const float* p = &d[(y * W + x) * 4];
    return Pixel{p[0], p[1], p[2], p[3]};
  }
  // Verbatim logic of the OFX FloatSampler (bounds x1=y1=0, x2=W, y2=H).
  Pixel sample(float x, float y) const {
    const float maxX = float(W - 1), maxY = float(H - 1);
    if (x < 0.0f || x > maxX || y < 0.0f || y > maxY) return Pixel{0.0f, 0.0f, 0.0f, 0.0f};
    const int x0 = int(x), y0 = int(y);
    const int x1 = std::min(W - 1, x0 + 1), y1 = std::min(H - 1, y0 + 1);
    const float tx = x - float(x0), ty = y - float(y0);
    const Pixel p00 = read(x0, y0), p10 = read(x1, y0), p01 = read(x0, y1), p11 = read(x1, y1);
    const float u = 1.0f - tx, v = 1.0f - ty;
    return Pixel{
      (p00.r * u + p10.r * tx) * v + (p01.r * u + p11.r * tx) * ty,
      (p00.g * u + p10.g * tx) * v + (p01.g * u + p11.g * tx) * ty,
      (p00.b * u + p10.b * tx) * v + (p01.b * u + p11.b * tx) * ty,
      (p00.a * u + p10.a * tx) * v + (p01.a * u + p11.a * tx) * ty,
    };
  }
};
int main(int argc, char** argv) {
  if (argc < 3) { std::fprintf(stderr, "usage: %s cases.txt outDir\n", argv[0]); return 2; }
  std::ifstream in(argv[1]); std::string outDir = argv[2]; std::string line; Img img;
  while (std::getline(in, line)) {
    if (line.empty()) continue;
    std::istringstream ss(line); std::string name; ss >> name; std::map<std::string, float> kv; std::string tok;
    while (ss >> tok) { auto e = tok.find('='); kv[tok.substr(0, e)] = std::stof(tok.substr(e + 1)); }
    auto g = [&](const char* k, float def) { return kv.count(k) ? kv[k] : def; };
    // Defaults = OFX descriptor (BuckswoodLensPhysicsOFX.cpp, controlsAtTime).
    Controls c{};
    c.lensPreset = int(g("lensPreset", 19)); c.effectStrength = g("effectStrength", 0.45f);
    c.distortion = g("distortion", 0.0f); c.chromaticAberration = g("chromaticAberration", 0.015f);
    c.fringing = g("fringing", 0.015f); c.coma = g("coma", 0.035f); c.bloom = g("bloom", 0.075f);
    c.bloomThreshold = g("bloomThreshold", 0.82f); c.vignette = g("vignette", 0.045f);
    c.cornerColor = g("cornerColor", 0.020f); c.swirl = g("swirl", 0.0f);
    c.fStopSharpener = g("fStopSharpener", 0.060f); c.overdrive = g("overdrive", 0.85f);
    c.outputMix = g("outputMix", 0.55f); c.edgeHaloGuard = g("edgeHaloGuard", 0.82f);
    FrameInfo f{W, H, int(g("frameIndex", 0))};
    const auto st = LensPhysicsCore::prepare(f, c);
    std::vector<float> out(W * H * 4);
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
      Pixel p = LensPhysicsCore::processPixel(img, x, y, st);
      float* o = &out[(y * W + x) * 4]; o[0] = p.r; o[1] = p.g; o[2] = p.b; o[3] = p.a;
    }
    FILE* fp = std::fopen((outDir + "/" + name + ".f32").c_str(), "wb"); std::fwrite(out.data(), 4, out.size(), fp); std::fclose(fp);
    std::printf("%s ok\n", name.c_str());
  }
}
