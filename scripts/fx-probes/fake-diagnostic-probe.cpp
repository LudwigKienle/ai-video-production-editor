// Generates Fake Diagnostic v2.2 reference frames from the original C++ core.
// Sampler mirrors the OFX FloatSampler (nearest, transparent black outside the
// frame); the adjustment-layer guard is a verbatim copy of
// sourceLooksLikeBlankAdjustment() from BuckswoodFakeDiagnosticOFX.cpp.
// Single-frame path only: no temporal context is passed (temporal analysis is
// out of scope for the WebGL port).
#include <cstdint>
#include "FakeDiagnosticCore.h"
#include <algorithm>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
using namespace buckswood_fake;
static const int W = 48, H = 32;

// Smooth saturated midtones (left), a textured half (right), a saturated red
// block, a clipped highlight with an HDR core and half-transparent bottom rows.
// image=1 is a near-black adjustment-layer-like frame. Same as fakeDiagnosticTestImage().
struct Img {
  std::vector<float> d;
  explicit Img(int kind) : d(W * H * 4) {
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
      float* p = &d[(y * W + x) * 4];
      if (kind == 1) {
        const int c = (x + y) % 7 == 0 ? 3 : 2;
        p[0] = p[1] = p[2] = c / 255.0f; p[3] = 1.0f;
        continue;
      }
      int r, g, b;
      if (x < 24) { r = 140 + x; g = 97 + y; b = 77; }
      else { const int n = ((x * 37 + y * 61) % 17) - 8; r = g = b = 115 + 3 * n; }
      if (x >= 4 && x <= 12 && y >= 22 && y <= 29) { r = 250; g = 20; b = 10; }
      const int d2 = (x - 36) * (x - 36) + (y - 22) * (y - 22);
      if (d2 < 20) { r = 255; g = 253; b = 248; }
      p[0] = r / 255.0f; p[1] = g / 255.0f; p[2] = b / 255.0f;
      if (d2 < 4) { p[0] = p[1] = p[2] = 1.25f; }
      p[3] = y < 2 ? 128 / 255.0f : 1.0f;
    }
  }
  Pixel sample(float x, float y) const {
    if (x < 0.0f || x > float(W - 1) || y < 0.0f || y > float(H - 1)) return Pixel{0.0f, 0.0f, 0.0f, 0.0f};
    const int ix = static_cast<int>(x + 0.5f), iy = static_cast<int>(y + 0.5f);
    const float* p = &d[(iy * W + ix) * 4];
    return Pixel{p[0], p[1], p[2], p[3]};
  }
};

// Verbatim logic of sourceLooksLikeBlankAdjustment<OfxRGBAColourF>.
static bool looksLikeBlankAdjustment(const Img& img) {
  float maxRgb = 0.0f, alphaSum = 0.0f; int samples = 0; const int grid = 9;
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

static void writeF32(const std::string& path, const std::vector<float>& v) {
  FILE* fp = std::fopen(path.c_str(), "wb"); std::fwrite(v.data(), 4, v.size(), fp); std::fclose(fp);
}

int main(int argc, char** argv) {
  if (argc < 3) { std::fprintf(stderr, "usage: %s cases.txt outDir\n", argv[0]); return 1; }
  std::ifstream in(argv[1]); std::string outDir = argv[2]; std::string line;
  const Img images[2] = {Img(0), Img(1)};
  writeF32(outDir + "/input.f32", images[0].d);
  writeF32(outDir + "/input-blank.f32", images[1].d);
  while (std::getline(in, line)) {
    if (line.empty()) continue;
    std::istringstream ss(line); std::string name; ss >> name; std::map<std::string, float> kv; std::string tok;
    while (ss >> tok) { auto e = tok.find('='); kv[tok.substr(0, e)] = std::stof(tok.substr(e + 1)); }
    auto g = [&](const char* k, float def) { return kv.count(k) ? kv[k] : def; };
    Controls c = FakeDiagnosticCore::defaultControls();
    c.sensitivity = g("sensitivity", c.sensitivity); c.overlayStrength = g("overlayStrength", c.overlayStrength);
    c.correctionStrength = g("correctionStrength", c.correctionStrength);
    c.plasticWeight = g("plasticWeight", c.plasticWeight); c.highlightWeight = g("highlightWeight", c.highlightWeight);
    c.edgeWeight = g("edgeWeight", c.edgeWeight); c.gradeWeight = g("gradeWeight", c.gradeWeight);
    c.textureWeight = g("textureWeight", c.textureWeight); c.temporalWeight = g("temporalWeight", c.temporalWeight);
    c.microContrast = g("microContrast", c.microContrast); c.edgeSoften = g("edgeSoften", c.edgeSoften);
    c.highlightRolloff = g("highlightRolloff", c.highlightRolloff); c.gamutGuard = g("gamutGuard", c.gamutGuard);
    c.sensorTexture = g("sensorTexture", c.sensorTexture); c.temporalAssist = g("temporalAssist", c.temporalAssist);
    c.seed = g("seed", c.seed);
    const int viewMode = int(g("viewMode", ViewDiagnosticOverlay));
    const bool guard = g("adjustmentLayerGuard", 1) != 0;
    const Img& img = images[int(g("image", 0)) == 1 ? 1 : 0];
    FrameInfo f{W, H, int(g("frameIndex", 0))};
    const auto prepared = FakeDiagnosticCore::prepare(f, c);
    std::vector<float> out(W * H * 4, 0.0f);
    const bool blank = guard && looksLikeBlankAdjustment(img);
    if (!blank) {
      for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        Pixel p = FakeDiagnosticCore::processPixel<Img>(img, x, y, f, c, prepared, viewMode, nullptr);
        float* o = &out[(y * W + x) * 4]; o[0] = p.r; o[1] = p.g; o[2] = p.b; o[3] = p.a;
      }
    }
    writeF32(outDir + "/" + name + ".f32", out);
    std::printf("%s ok%s\n", name.c_str(), blank ? " (blank adjustment layer -> transparent)" : "");
  }
}
