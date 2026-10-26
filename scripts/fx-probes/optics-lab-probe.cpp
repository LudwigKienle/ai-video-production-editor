// Generates Optics Lab reference frames from the original C++ core.
#include "OpticsLabCore.h"
#include "OpticsAssetLibrary.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
using namespace buckswood_optics;
static const int W = 40, H = 24;
struct Img : Sampler {
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
  Pixel sample(float x, float y) const override {
    float sx = std::min(float(W - 1), std::max(0.f, x)), sy = std::min(float(H - 1), std::max(0.f, y));
    int x0 = int(std::floor(sx)), y0 = int(std::floor(sy));
    int x1 = std::min(W - 1, x0 + 1), y1 = std::min(H - 1, y0 + 1);
    float tx = sx - x0, ty = sy - y0, u = 1 - tx, v = 1 - ty;
    const float *a = &d[(y0 * W + x0) * 4], *b = &d[(y0 * W + x1) * 4], *c = &d[(y1 * W + x0) * 4], *e = &d[(y1 * W + x1) * 4];
    Pixel o; float* po = &o.r;
    for (int k = 0; k < 4; ++k) po[k] = (a[k] * u + b[k] * tx) * v + (c[k] * u + e[k] * tx) * ty;
    return o;
  }
};
int main(int argc, char** argv) {
  std::ifstream in(argv[1]); std::string outDir = argv[2]; std::string line; Img img;
  while (std::getline(in, line)) {
    if (line.empty()) continue;
    std::istringstream ss(line); std::string name; ss >> name; std::map<std::string, float> kv; std::string tok;
    while (ss >> tok) { auto e = tok.find('='); kv[tok.substr(0, e)] = std::stof(tok.substr(e + 1)); }
    auto g = [&](const char* k, float def) { return kv.count(k) ? kv[k] : def; };
    Controls c{};
    c.preset = int(g("preset", 6)); c.effectStrength = g("effectStrength", 0.65f);
    c.focalLength = g("focalLength", 50); c.fStop = g("fStop", 2.8f); c.focusDistance = g("focusDistance", 3); c.sensorWidth = g("sensorWidth", 36);
    c.anamorphicSqueeze = g("anamorphicSqueeze", 1); c.anamorphicAngle = g("anamorphicAngle", 0);
    c.distortion = g("distortion", 0); c.breathing = g("breathing", 0); c.lateralCA = g("lateralCA", 0); c.axialCA = g("axialCA", 0);
    c.coma = g("coma", 0); c.astigmatism = g("astigmatism", 0); c.fieldCurvature = g("fieldCurvature", 0); c.spherical = g("spherical", 0); c.swirl = g("swirl", 0);
    c.depthSource = int(g("depthSource", 0)); c.depthInvert = g("depthInvert", 0) != 0; c.depthNear = g("depthNear", 0); c.depthFar = g("depthFar", 1);
    c.depthGamma = g("depthGamma", 1); c.focusPlane = g("focusPlane", 0.5f); c.focusOffset = g("focusOffset", 0); c.defocus = g("defocus", 0); c.catEye = g("catEye", 0);
    c.bloom = g("bloom", 0); c.bloomThreshold = g("bloomThreshold", 0.82f); c.diffusion = g("diffusion", 0); c.halation = g("halation", 0);
    c.flareGhosts = g("flareGhosts", 0); c.flareStreak = g("flareStreak", 0); c.starburst = g("starburst", 0);
    c.vignette = g("vignette", 0); c.debayer = g("debayer", 0); c.chromaSmear = g("chromaSmear", 0); c.grain = g("grain", 0);
    c.grainSize = g("grainSize", 1); c.grainSeed = g("grainSeed", 1); c.sensorISO = g("sensorISO", 400); c.apertureInfluence = g("apertureInfluence", 0.85f);
    c.dirtAmount = g("dirtAmount", 0); c.dirtScale = g("dirtScale", 1); c.smudgeAmount = g("smudgeAmount", 0); c.smudgeScale = g("smudgeScale", 1);
    c.edgeGuard = g("edgeGuard", 0.8f); c.outputMix = g("outputMix", 0.65f);
    c.geometryEnabled = g("geometryEnabled", 1) != 0; c.aberrationsEnabled = g("aberrationsEnabled", 1) != 0; c.defocusEnabled = g("defocusEnabled", 1) != 0;
    c.lightEnabled = g("lightEnabled", 1) != 0; c.vignetteEnabled = g("vignetteEnabled", 1) != 0; c.surfaceEnabled = g("surfaceEnabled", 1) != 0; c.sensorEnabled = g("sensorEnabled", 1) != 0;
    c.quality = int(g("quality", 1)); c.sceneUnits = int(g("sceneUnits", 0)); c.sceneScale = g("sceneScale", 1); c.irisBlades = int(g("irisBlades", 0));
    c.irisRoundnessTrim = g("irisRoundnessTrim", 0); c.irisRotation = g("irisRotation", 0); c.starUnevennessTrim = g("starUnevennessTrim", 0); c.starFStopResponse = g("starFStopResponse", 1);
    auto assets = OpticsAssetLibrary::load("", 0, 0, int(g("glassAsset", 0)), int(g("dirtAsset", 0)), int(g("smudgeAsset", 0)));
    auto views = assets.views();
    FrameInfo f{W, H, int(g("frameIndex", 0))};
    auto st = OpticsLabCore::prepare(f, c);
    std::vector<float> out(W * H * 4);
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
      Pixel p = OpticsLabCore::processPixel(img, x, y, st, &views);
      float* o = &out[(y * W + x) * 4]; o[0] = p.r; o[1] = p.g; o[2] = p.b; o[3] = p.a;
    }
    FILE* fp = std::fopen((outDir + "/" + name + ".f32").c_str(), "wb"); std::fwrite(out.data(), 4, out.size(), fp); std::fclose(fp);
    std::printf("%s ok\n", name.c_str());
  }
}
