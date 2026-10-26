// Generates Deband v1.0 reference frames from the original C++ core.
// Sampler mirrors the OFX ImageSampler: integer coordinates, clamped to the frame.
#include "DebandCore.h"
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
using namespace buckswood_deband;
static const int W = 64, H = 32;

// Shallow 8-bit quantised diagonal gradient (bands ~5 px), an intentional flat
// strip, a hard-edged block and a textured strip. Same as debandTestImage().
static int clampCode(int v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
struct Img {
  std::vector<float> d;
  Img() : d(W * H * 4) {
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
      int t = 2 * x + y;
      int r = 76 + t / 10, g = 80 + t / 12, b = 90 + x / 16;
      if (x < 6) { r = g = b = 70; }
      if (x >= 46 && x <= 54 && y >= 10 && y <= 20) { r += 110; g += 100; b += 90; }
      if (y >= 26) { int n = ((x * 7 + y * 13) % 5) - 2; r += 3 * n; g += 3 * n; b += 3 * n; }
      float* p = &d[(y * W + x) * 4];
      p[0] = clampCode(r) / 255.0f; p[1] = clampCode(g) / 255.0f; p[2] = clampCode(b) / 255.0f; p[3] = 1.0f;
    }
  }
  Pixel sample(int x, int y) const {
    x = x < 0 ? 0 : (x > W - 1 ? W - 1 : x);
    y = y < 0 ? 0 : (y > H - 1 ? H - 1 : y);
    const float* p = &d[(y * W + x) * 4];
    return Pixel{p[0], p[1], p[2], p[3]};
  }
};

static void writeF32(const std::string& path, const std::vector<float>& v) {
  FILE* fp = std::fopen(path.c_str(), "wb"); std::fwrite(v.data(), 4, v.size(), fp); std::fclose(fp);
}

int main(int argc, char** argv) {
  if (argc < 3) { std::fprintf(stderr, "usage: %s cases.txt outDir\n", argv[0]); return 1; }
  std::ifstream in(argv[1]); std::string outDir = argv[2]; std::string line; Img img;
  writeF32(outDir + "/input.f32", img.d);
  while (std::getline(in, line)) {
    if (line.empty()) continue;
    std::istringstream ss(line); std::string name; ss >> name; std::map<std::string, float> kv; std::string tok;
    while (ss >> tok) { auto e = tok.find('='); kv[tok.substr(0, e)] = std::stof(tok.substr(e + 1)); }
    Controls c{};
    auto g = [&](const char* k, float def) { return kv.count(k) ? kv[k] : def; };
    c.preset = int(g("preset", c.preset)); c.workingSpace = int(g("workingSpace", c.workingSpace));
    c.sourcePrecision = int(g("sourcePrecision", c.sourcePrecision)); c.strength = g("strength", c.strength);
    c.detection = g("detection", c.detection); c.radius = g("radius", c.radius);
    c.edgeProtection = g("edgeProtection", c.edgeProtection); c.textureProtection = g("textureProtection", c.textureProtection);
    c.chromaRepair = g("chromaRepair", c.chromaRepair); c.dither = g("dither", c.dither);
    c.ditherMotion = int(g("ditherMotion", c.ditherMotion)); c.seed = g("seed", c.seed);
    c.viewMode = int(g("viewMode", c.viewMode)); c.outputMix = g("outputMix", c.outputMix);
    FrameInfo f{W, H, int(g("frameIndex", 0))};
    const auto st = DebandCore::prepare(f, c);
    std::vector<float> out(W * H * 4);
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
      Pixel p = DebandCore::processPixel(img, x, y, st);
      float* o = &out[(y * W + x) * 4]; o[0] = p.r; o[1] = p.g; o[2] = p.b; o[3] = p.a;
    }
    writeF32(outDir + "/" + name + ".f32", out);
    std::printf("%s ok (radii %d/%d/%d threshold %.6g)\n", name.c_str(), st.radiusSmall, st.radiusMedium, st.radiusLarge, st.threshold);
  }
}
