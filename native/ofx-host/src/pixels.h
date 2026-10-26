// Pixel format conversion between the wire format (top-down rows, RGBA) and
// OFX image buffers (bottom-up rows, RGBA at the clip bit depth).
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "ofx_host.h"

namespace avpe {

enum class WireFormat { RGBA8, RGBA16, RGBA32F };

inline bool parseWireFormat(const std::string& s, WireFormat& out)
{
    if (s == "rgba32f" || s == "float" || s == "rgbaf32" || s == "f32") { out = WireFormat::RGBA32F; return true; }
    if (s == "rgba16" || s == "rgba64le" || s == "u16") { out = WireFormat::RGBA16; return true; }
    if (s == "rgba8" || s == "rgba" || s == "u8") { out = WireFormat::RGBA8; return true; }
    return false;
}

inline const char* wireFormatName(WireFormat f)
{
    switch (f) {
    case WireFormat::RGBA8: return "rgba8";
    case WireFormat::RGBA16: return "rgba16";
    case WireFormat::RGBA32F: return "rgba32f";
    }
    return "rgba32f";
}

inline size_t wireBytesPerPixel(WireFormat f)
{
    switch (f) {
    case WireFormat::RGBA8: return 4;
    case WireFormat::RGBA16: return 8;
    case WireFormat::RGBA32F: return 16;
    }
    return 16;
}

template <typename Fn>
void parallelRows(int height, size_t pixelsPerRow, Fn&& fn)
{
    const size_t total = static_cast<size_t>(height) * pixelsPerRow;
    unsigned threads = Host::instance().numThreads();
    if (total < (1u << 18) || threads <= 1 || height < 8) {
        fn(0, height);
        return;
    }
    threads = std::min<unsigned>(threads, 16u);
    std::vector<std::thread> pool;
    pool.reserve(threads);
    for (unsigned t = 0; t < threads; ++t) {
        const int y0 = static_cast<int>((static_cast<long long>(height) * t) / threads);
        const int y1 = static_cast<int>((static_cast<long long>(height) * (t + 1)) / threads);
        if (y0 >= y1) continue;
        try {
            pool.emplace_back([&fn, y0, y1] { fn(y0, y1); });
        } catch (...) {
            fn(y0, y1);
        }
    }
    for (auto& th : pool) th.join();
}

inline float readWire(const uint8_t* p, WireFormat f, int c)
{
    switch (f) {
    case WireFormat::RGBA8: return p[c] * (1.0f / 255.0f);
    case WireFormat::RGBA16: {
        uint16_t v;
        std::memcpy(&v, p + c * 2, 2);
        return v * (1.0f / 65535.0f);
    }
    case WireFormat::RGBA32F: {
        float v;
        std::memcpy(&v, p + c * 4, 4);
        return std::isfinite(v) ? v : 0.0f;
    }
    }
    return 0.0f;
}

// Top-down wire rows -> bottom-up OFX rows.
inline void wireToOfx(const uint8_t* src, WireFormat fmt, int w, int h, PixelDepth depth, uint8_t* dst, size_t dstRowBytes)
{
    const size_t srcRowBytes = static_cast<size_t>(w) * wireBytesPerPixel(fmt);
    parallelRows(h, static_cast<size_t>(w), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            const uint8_t* s = src + static_cast<size_t>(h - 1 - y) * srcRowBytes;
            uint8_t* d = dst + static_cast<size_t>(y) * dstRowBytes;
            // Fast paths: identical layouts.
            if ((fmt == WireFormat::RGBA32F && depth == PixelDepth::Float) ||
                (fmt == WireFormat::RGBA8 && depth == PixelDepth::Byte) ||
                (fmt == WireFormat::RGBA16 && depth == PixelDepth::Short)) {
                std::memcpy(d, s, srcRowBytes);
                if (fmt == WireFormat::RGBA32F) {
                    auto* f = reinterpret_cast<float*>(d);
                    for (size_t i = 0; i < static_cast<size_t>(w) * 4; ++i)
                        if (!std::isfinite(f[i])) f[i] = 0.0f;
                }
                continue;
            }
            const size_t bpp = wireBytesPerPixel(fmt);
            for (int x = 0; x < w; ++x) {
                const uint8_t* sp = s + static_cast<size_t>(x) * bpp;
                for (int c = 0; c < 4; ++c) {
                    const float v = readWire(sp, fmt, c);
                    if (depth == PixelDepth::Float) {
                        reinterpret_cast<float*>(d)[x * 4 + c] = v;
                    } else if (depth == PixelDepth::Short) {
                        const float cl = std::min(1.0f, std::max(0.0f, v));
                        reinterpret_cast<uint16_t*>(d)[x * 4 + c] = static_cast<uint16_t>(cl * 65535.0f + 0.5f);
                    } else {
                        const float cl = std::min(1.0f, std::max(0.0f, v));
                        d[x * 4 + c] = static_cast<uint8_t>(cl * 255.0f + 0.5f);
                    }
                }
            }
        }
    });
}

// Bottom-up OFX rows -> top-down wire rows. Counts non-finite float components.
inline void ofxToWire(const uint8_t* src, size_t srcRowBytes, PixelDepth depth, int w, int h, WireFormat fmt,
                      uint8_t* dst, uint64_t* nonFinite)
{
    const size_t dstRowBytes = static_cast<size_t>(w) * wireBytesPerPixel(fmt);
    std::atomic<uint64_t> bad{0};
    parallelRows(h, static_cast<size_t>(w), [&](int y0, int y1) {
        uint64_t localBad = 0;
        for (int y = y0; y < y1; ++y) {
            const uint8_t* s = src + static_cast<size_t>(h - 1 - y) * srcRowBytes;
            uint8_t* d = dst + static_cast<size_t>(y) * dstRowBytes;
            for (int x = 0; x < w; ++x) {
                for (int c = 0; c < 4; ++c) {
                    float v;
                    if (depth == PixelDepth::Float) {
                        v = reinterpret_cast<const float*>(s)[x * 4 + c];
                        if (!std::isfinite(v)) {
                            ++localBad;
                            v = 0.0f;
                        }
                    } else if (depth == PixelDepth::Short) {
                        v = reinterpret_cast<const uint16_t*>(s)[x * 4 + c] * (1.0f / 65535.0f);
                    } else {
                        v = s[x * 4 + c] * (1.0f / 255.0f);
                    }
                    switch (fmt) {
                    case WireFormat::RGBA32F:
                        std::memcpy(d + (static_cast<size_t>(x) * 4 + c) * 4, &v, 4);
                        break;
                    case WireFormat::RGBA16: {
                        const float cl = std::min(1.0f, std::max(0.0f, v));
                        const uint16_t u = static_cast<uint16_t>(cl * 65535.0f + 0.5f);
                        std::memcpy(d + (static_cast<size_t>(x) * 4 + c) * 2, &u, 2);
                        break;
                    }
                    case WireFormat::RGBA8: {
                        const float cl = std::min(1.0f, std::max(0.0f, v));
                        d[static_cast<size_t>(x) * 4 + c] = static_cast<uint8_t>(cl * 255.0f + 0.5f);
                        break;
                    }
                    }
                }
            }
        }
        bad += localBad;
    });
    if (nonFinite) *nonFinite = bad.load();
}

// Converts between two OFX (bottom-up) buffers of possibly different depth.
inline void ofxConvert(const uint8_t* src, PixelDepth srcDepth, uint8_t* dst, PixelDepth dstDepth, int w, int h)
{
    const size_t srcRow = static_cast<size_t>(w) * 4 * bytesPerComponent(srcDepth);
    const size_t dstRow = static_cast<size_t>(w) * 4 * bytesPerComponent(dstDepth);
    if (srcDepth == dstDepth) {
        std::memcpy(dst, src, srcRow * static_cast<size_t>(h));
        return;
    }
    parallelRows(h, static_cast<size_t>(w), [&](int y0, int y1) {
        for (int y = y0; y < y1; ++y) {
            const uint8_t* s = src + static_cast<size_t>(y) * srcRow;
            uint8_t* d = dst + static_cast<size_t>(y) * dstRow;
            for (size_t i = 0; i < static_cast<size_t>(w) * 4; ++i) {
                float v;
                if (srcDepth == PixelDepth::Float) v = reinterpret_cast<const float*>(s)[i];
                else if (srcDepth == PixelDepth::Short) v = reinterpret_cast<const uint16_t*>(s)[i] * (1.0f / 65535.0f);
                else v = s[i] * (1.0f / 255.0f);
                if (!std::isfinite(v)) v = 0.0f;
                if (dstDepth == PixelDepth::Float) reinterpret_cast<float*>(d)[i] = v;
                else {
                    const float cl = std::min(1.0f, std::max(0.0f, v));
                    if (dstDepth == PixelDepth::Short) reinterpret_cast<uint16_t*>(d)[i] = static_cast<uint16_t>(cl * 65535.0f + 0.5f);
                    else d[i] = static_cast<uint8_t>(cl * 255.0f + 0.5f);
                }
            }
        }
    });
}

} // namespace avpe
