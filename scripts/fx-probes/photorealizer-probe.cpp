// Generates AI Photorealizer v0.3 reference frames from the original C++ core.
//
// Same synthetic frame as the other probes plus a skin-tone patch (exercises
// skinWeight) and a neon patch (exercises the gamut guard). The core is a pure
// per-pixel function; masks are the OFX defaults (no ML provider).
#include "PhotorealizerCore.h"
#include <cmath>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
using namespace buckswood;
static const int W = 40, H = 24;
int main(int argc, char** argv) {
  if (argc < 3) { std::fprintf(stderr, "usage: %s cases.txt outDir\n", argv[0]); return 2; }
  std::vector<float> img(W * H * 4);
  for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
    float* p = &img[(y * W + x) * 4];
    p[0] = x / float(W - 1); p[1] = y / float(H - 1); p[2] = 0.5f + 0.5f * std::sin(x * 0.7f + y * 0.3f);
    p[3] = x / float(W - 1);
    float d1 = (x - 10) * (x - 10) + (y - 8) * (y - 8);
    float d2 = (x - 30) * (x - 30) + (y - 16) * (y - 16);
    if (d1 < 6) { p[0] = p[1] = p[2] = 3.0f; }
    if (d2 < 4) { p[0] = 1.6f; p[1] = 1.4f; p[2] = 1.2f; }
    if (x >= 14 && x <= 19 && y >= 2 && y <= 7) { p[0] = 0.82f; p[1] = 0.60f; p[2] = 0.46f; }
    if (x >= 22 && x <= 26 && y >= 18 && y <= 22) { p[0] = 0.05f; p[1] = 1.0f; p[2] = 0.15f; }
  }
  std::ifstream in(argv[1]); std::string outDir = argv[2]; std::string line;
  while (std::getline(in, line)) {
    if (line.empty()) continue;
    std::istringstream ss(line); std::string name; ss >> name; std::map<std::string, float> kv; std::string tok;
    while (ss >> tok) { auto e = tok.find('='); kv[tok.substr(0, e)] = std::stof(tok.substr(e + 1)); }
    auto g = [&](const char* k, float def) { return kv.count(k) ? kv[k] : def; };
    // Defaults = OFX descriptor (BuckswoodAIPhotorealizerOFX.cpp, controlsAtTime).
    Controls c{};
    c.plasticReduction = g("plasticReduction", 0.65f); c.skinRealism = g("skinRealism", 0.55f);
    c.highlightRealism = g("highlightRealism", 0.70f); c.colorNaturalize = g("colorNaturalize", 0.55f);
    c.textureAmount = g("textureAmount", 0.30f); c.microContrast = g("microContrast", 0.35f);
    c.gamutGuard = g("gamutGuard", 0.75f); c.shadowDepth = g("shadowDepth", 0.35f);
    c.smoothnessBreakup = g("smoothnessBreakup", 0.45f); c.outputMix = g("outputMix", 1.0f);
    c.seed = g("seed", 1.0f);
    FrameInfo f{W, H, int(g("frameIndex", 0))};
    std::vector<float> out(W * H * 4);
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
      const float* s = &img[(y * W + x) * 4];
      Pixel p = PhotorealizerCore::processPixel(Pixel{s[0], s[1], s[2], s[3]}, x, y, f, c);
      float* o = &out[(y * W + x) * 4]; o[0] = p.r; o[1] = p.g; o[2] = p.b; o[3] = p.a;
    }
    FILE* fp = std::fopen((outDir + "/" + name + ".f32").c_str(), "wb"); std::fwrite(out.data(), 4, out.size(), fp); std::fclose(fp);
    std::printf("%s ok\n", name.c_str());
  }
}
