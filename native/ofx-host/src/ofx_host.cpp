// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal OpenFX host implementation, written against the public OpenFX API
// headers (BSD-3-Clause). CPU rendering only.
#include "ofx_host.h"

#include <algorithm>
#include <cfloat>
#include <climits>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>
#include <pthread.h>
#include <sys/stat.h>
#include <thread>

#if defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
#endif

#include "ofxGPURender.h"
#include "ofxMemory.h"
#include "ofxMessage.h"
#include "ofxMultiThread.h"
#include "ofxPixels.h"
#include "ofxProgress.h"
#include "ofxTimeLine.h"

namespace avpe {

// ---------------------------------------------------------------------------
// Small helpers

const char* depthToOfx(PixelDepth d)
{
    switch (d) {
    case PixelDepth::Byte: return kOfxBitDepthByte;
    case PixelDepth::Short: return kOfxBitDepthShort;
    case PixelDepth::Float: return kOfxBitDepthFloat;
    case PixelDepth::None: return kOfxBitDepthNone;
    }
    return kOfxBitDepthNone;
}

PixelDepth depthFromOfx(const std::string& s)
{
    if (s == kOfxBitDepthByte) return PixelDepth::Byte;
    if (s == kOfxBitDepthShort) return PixelDepth::Short;
    if (s == kOfxBitDepthFloat) return PixelDepth::Float;
    return PixelDepth::None;
}

size_t bytesPerComponent(PixelDepth d)
{
    switch (d) {
    case PixelDepth::Byte: return 1;
    case PixelDepth::Short: return 2;
    case PixelDepth::Float: return 4;
    case PixelDepth::None: return 0;
    }
    return 0;
}

const char* statusName(OfxStatus st)
{
    switch (st) {
    case kOfxStatOK: return "kOfxStatOK";
    case kOfxStatFailed: return "kOfxStatFailed";
    case kOfxStatErrFatal: return "kOfxStatErrFatal";
    case kOfxStatErrUnknown: return "kOfxStatErrUnknown";
    case kOfxStatErrMissingHostFeature: return "kOfxStatErrMissingHostFeature";
    case kOfxStatErrUnsupported: return "kOfxStatErrUnsupported";
    case kOfxStatErrExists: return "kOfxStatErrExists";
    case kOfxStatErrFormat: return "kOfxStatErrFormat";
    case kOfxStatErrMemory: return "kOfxStatErrMemory";
    case kOfxStatErrBadHandle: return "kOfxStatErrBadHandle";
    case kOfxStatErrBadIndex: return "kOfxStatErrBadIndex";
    case kOfxStatErrValue: return "kOfxStatErrValue";
    case kOfxStatReplyYes: return "kOfxStatReplyYes";
    case kOfxStatReplyNo: return "kOfxStatReplyNo";
    case kOfxStatReplyDefault: return "kOfxStatReplyDefault";
    default: return "unknown status";
    }
}

static bool debugEnabled()
{
    static const bool enabled = [] {
        const char* v = std::getenv("AVPE_OFX_DEBUG");
        return v && *v && std::strcmp(v, "0") != 0;
    }();
    return enabled;
}

#define AVPE_DEBUG(...)                                   \
    do {                                                  \
        if (debugEnabled()) {                             \
            std::fprintf(stderr, "[avpe-ofx-host] " __VA_ARGS__); \
            std::fputc('\n', stderr);                     \
        }                                                 \
    } while (0)

ParamKind paramKindFromOfx(const std::string& t)
{
    if (t == kOfxParamTypeInteger) return ParamKind::Integer;
    if (t == kOfxParamTypeDouble) return ParamKind::Double;
    if (t == kOfxParamTypeBoolean) return ParamKind::Boolean;
    if (t == kOfxParamTypeChoice) return ParamKind::Choice;
    if (t == kOfxParamTypeStrChoice) return ParamKind::StrChoice;
    if (t == kOfxParamTypeRGBA) return ParamKind::RGBA;
    if (t == kOfxParamTypeRGB) return ParamKind::RGB;
    if (t == kOfxParamTypeDouble2D) return ParamKind::Double2D;
    if (t == kOfxParamTypeInteger2D) return ParamKind::Integer2D;
    if (t == kOfxParamTypeDouble3D) return ParamKind::Double3D;
    if (t == kOfxParamTypeInteger3D) return ParamKind::Integer3D;
    if (t == kOfxParamTypeString) return ParamKind::String;
    if (t == kOfxParamTypeCustom) return ParamKind::Custom;
    if (t == kOfxParamTypeBytes) return ParamKind::Bytes;
    if (t == kOfxParamTypeGroup) return ParamKind::Group;
    if (t == kOfxParamTypePage) return ParamKind::Page;
    if (t == kOfxParamTypePushButton) return ParamKind::PushButton;
    if (t == "OfxParamTypeParametric") return ParamKind::Parametric;
    return ParamKind::Unknown;
}

const char* paramKindName(ParamKind k)
{
    switch (k) {
    case ParamKind::Integer: return "int";
    case ParamKind::Double: return "double";
    case ParamKind::Boolean: return "bool";
    case ParamKind::Choice: return "choice";
    case ParamKind::StrChoice: return "strchoice";
    case ParamKind::RGBA: return "rgba";
    case ParamKind::RGB: return "rgb";
    case ParamKind::Double2D: return "double2d";
    case ParamKind::Integer2D: return "int2d";
    case ParamKind::Double3D: return "double3d";
    case ParamKind::Integer3D: return "int3d";
    case ParamKind::String: return "string";
    case ParamKind::Custom: return "custom";
    case ParamKind::Bytes: return "bytes";
    case ParamKind::Group: return "group";
    case ParamKind::Page: return "page";
    case ParamKind::PushButton: return "pushbutton";
    case ParamKind::Parametric: return "parametric";
    case ParamKind::Unknown: return "unknown";
    }
    return "unknown";
}

int paramDimension(ParamKind k)
{
    switch (k) {
    case ParamKind::Integer: case ParamKind::Double: case ParamKind::Boolean:
    case ParamKind::Choice: case ParamKind::StrChoice: case ParamKind::String:
    case ParamKind::Custom: case ParamKind::Bytes:
        return 1;
    case ParamKind::Double2D: case ParamKind::Integer2D: return 2;
    case ParamKind::RGB: case ParamKind::Double3D: case ParamKind::Integer3D: return 3;
    case ParamKind::RGBA: return 4;
    default: return 0;
    }
}

bool paramIsDoubleValued(ParamKind k)
{
    return k == ParamKind::Double || k == ParamKind::Double2D || k == ParamKind::Double3D ||
           k == ParamKind::RGB || k == ParamKind::RGBA;
}

bool paramIsIntValued(ParamKind k)
{
    return k == ParamKind::Integer || k == ParamKind::Integer2D || k == ParamKind::Integer3D ||
           k == ParamKind::Boolean || k == ParamKind::Choice;
}

bool paramIsStringValued(ParamKind k)
{
    return k == ParamKind::String || k == ParamKind::Custom || k == ParamKind::StrChoice;
}

static bool isSpatialDoubleType(const std::string& t, bool& isX, bool& isY)
{
    isX = isY = false;
    if (t == kOfxParamDoubleTypeX || t == kOfxParamDoubleTypeXAbsolute) { isX = true; return true; }
    if (t == kOfxParamDoubleTypeY || t == kOfxParamDoubleTypeYAbsolute) { isY = true; return true; }
    if (t == kOfxParamDoubleTypeXY || t == kOfxParamDoubleTypeXYAbsolute) { isX = isY = true; return true; }
    return false;
}

void Param::resetToDefault(double projectW, double projectH)
{
    const int dim = paramDimension(kind);
    if (paramIsDoubleValued(kind)) {
        dv = props.getDoubles(kOfxParamPropDefault);
        dv.resize(static_cast<size_t>(dim), 0.0);
        if (props.getString(kOfxParamPropDefaultCoordinateSystem) == kOfxParamCoordinatesNormalised) {
            bool isX = false, isY = false;
            if (isSpatialDoubleType(props.getString(kOfxParamPropDoubleType), isX, isY)) {
                if (dim == 1) {
                    dv[0] *= isX ? projectW : projectH;
                } else if (dim >= 2) {
                    dv[0] *= projectW;
                    dv[1] *= projectH;
                }
            }
        }
    } else if (paramIsIntValued(kind)) {
        iv = props.getInts(kOfxParamPropDefault);
        iv.resize(static_cast<size_t>(dim), 0);
    } else if (paramIsStringValued(kind)) {
        sv = props.getString(kOfxParamPropDefault);
    }
}

// ---------------------------------------------------------------------------
// Effect

Effect::~Effect()
{
    std::lock_guard<std::mutex> lock(imagesMutex);
    for (PropertySet* img : liveImages) delete img;
    liveImages.clear();
    magic = 0;
}

Clip* Effect::findClip(const std::string& name) const
{
    for (const auto& c : clips) {
        if (c->name == name) return c.get();
    }
    return nullptr;
}

Clip* Effect::sourceClip() const
{
    return findClip(kOfxImageEffectSimpleSourceClipName);
}

Clip* Effect::outputClip() const
{
    return findClip(kOfxImageEffectOutputClipName);
}

// ---------------------------------------------------------------------------
// Live image registry (for validating clipReleaseImage)

namespace {

std::mutex gImagesMutex;
std::map<PropertySet*, Effect*> gLiveImages;

thread_local bool tlsSpawnedThread = false;
thread_local unsigned tlsThreadIndex = 0;

// ---- Property defaults ---------------------------------------------------

void initParamProps(Param& p)
{
    PropertySet& ps = p.props;
    ps.setString(kOfxPropType, kOfxTypeParameter);
    ps.setString(kOfxParamPropType, p.ofxType);
    ps.setString(kOfxPropName, p.name);
    ps.setString(kOfxPropLabel, p.name);
    ps.setString(kOfxPropShortLabel, p.name);
    ps.setString(kOfxPropLongLabel, p.name);
    ps.setString(kOfxParamPropScriptName, p.name);
    ps.setString(kOfxParamPropHint, "");
    ps.setString(kOfxParamPropParent, "");
    ps.setInt(kOfxParamPropSecret, 0);
    ps.setInt(kOfxParamPropEnabled, 1);
    ps.setPointer(kOfxParamPropDataPtr, nullptr);
    ps.setInt(kOfxParamPropEvaluateOnChange, 1);
    ps.setInt(kOfxParamPropPersistant, 1);
    ps.setInt(kOfxParamPropCanUndo, 1);
    ps.setInt(kOfxParamPropPluginMayWrite, 0);
    ps.setString(kOfxParamPropCacheInvalidation, kOfxParamInvalidateValueChange);
    ps.setPointer(kOfxParamPropInteractV1, nullptr);
    ps.setDoubles(kOfxParamPropInteractSize, {0.0, 0.0});
    ps.setDouble(kOfxParamPropInteractSizeAspect, 1.0);
    ps.setInts(kOfxParamPropInteractMinimumSize, {10, 10});
    ps.setInts(kOfxParamPropInteractPreferedSize, {10, 10});
    ps.setInt(kOfxParamPropHasHostOverlayHandle, 0);
    ps.setInt(kOfxParamPropUseHostOverlayHandle, 0);

    const int dim = paramDimension(p.kind);
    const bool animatable = paramIsDoubleValued(p.kind) || p.kind == ParamKind::Integer ||
                            p.kind == ParamKind::Integer2D || p.kind == ParamKind::Integer3D;
    if (dim > 0) {
        ps.setInt(kOfxParamPropAnimates, animatable ? 1 : 0);
        ps.setInt(kOfxParamPropIsAnimating, 0);
        ps.setInt(kOfxParamPropIsAutoKeying, 0);
    }

    if (paramIsDoubleValued(p.kind)) {
        ps.setDoubles(kOfxParamPropDefault, std::vector<double>(static_cast<size_t>(dim), 0.0));
        ps.setDoubles(kOfxParamPropMin, std::vector<double>(static_cast<size_t>(dim), -DBL_MAX));
        ps.setDoubles(kOfxParamPropMax, std::vector<double>(static_cast<size_t>(dim), DBL_MAX));
        const bool colour = p.kind == ParamKind::RGB || p.kind == ParamKind::RGBA;
        ps.setDoubles(kOfxParamPropDisplayMin, std::vector<double>(static_cast<size_t>(dim), colour ? 0.0 : -DBL_MAX));
        ps.setDoubles(kOfxParamPropDisplayMax, std::vector<double>(static_cast<size_t>(dim), colour ? 1.0 : DBL_MAX));
        ps.setDouble(kOfxParamPropIncrement, 1.0);
        ps.setInt(kOfxParamPropDigits, 2);
        if (!colour) {
            ps.setString(kOfxParamPropDoubleType, kOfxParamDoubleTypePlain);
            ps.setString(kOfxParamPropDefaultCoordinateSystem, kOfxParamCoordinatesCanonical);
        }
    } else if (p.kind == ParamKind::Integer || p.kind == ParamKind::Integer2D || p.kind == ParamKind::Integer3D) {
        ps.setInts(kOfxParamPropDefault, std::vector<int>(static_cast<size_t>(dim), 0));
        ps.setInts(kOfxParamPropMin, std::vector<int>(static_cast<size_t>(dim), INT_MIN));
        ps.setInts(kOfxParamPropMax, std::vector<int>(static_cast<size_t>(dim), INT_MAX));
        ps.setInts(kOfxParamPropDisplayMin, std::vector<int>(static_cast<size_t>(dim), INT_MIN));
        ps.setInts(kOfxParamPropDisplayMax, std::vector<int>(static_cast<size_t>(dim), INT_MAX));
    } else if (p.kind == ParamKind::Boolean) {
        ps.setInt(kOfxParamPropDefault, 0);
    } else if (p.kind == ParamKind::Choice) {
        ps.setInt(kOfxParamPropDefault, 0);
        ps.setStrings(kOfxParamPropChoiceOption, {});
    } else if (p.kind == ParamKind::StrChoice) {
        ps.setString(kOfxParamPropDefault, "");
        ps.setStrings(kOfxParamPropChoiceOption, {});
        ps.setStrings(kOfxParamPropChoiceEnum, {});
    } else if (p.kind == ParamKind::String) {
        ps.setString(kOfxParamPropDefault, "");
        ps.setString(kOfxParamPropStringMode, kOfxParamStringIsSingleLine);
        ps.setInt(kOfxParamPropStringFilePathExists, 1);
    } else if (p.kind == ParamKind::Custom) {
        ps.setString(kOfxParamPropDefault, "");
    } else if (p.kind == ParamKind::Group) {
        ps.setInt(kOfxParamPropGroupOpen, 1);
    } else if (p.kind == ParamKind::Page) {
        ps.setStrings(kOfxParamPropPageChild, {});
    }
    if (p.kind == ParamKind::Double2D || p.kind == ParamKind::Integer2D) {
        ps.setStrings(kOfxParamPropDimensionLabel, {"x", "y"});
    } else if (p.kind == ParamKind::Double3D || p.kind == ParamKind::Integer3D) {
        ps.setStrings(kOfxParamPropDimensionLabel, {"x", "y", "z"});
    } else if (p.kind == ParamKind::RGB) {
        ps.setStrings(kOfxParamPropDimensionLabel, {"r", "g", "b"});
    } else if (p.kind == ParamKind::RGBA) {
        ps.setStrings(kOfxParamPropDimensionLabel, {"r", "g", "b", "a"});
    }
}

void initClipDescriptorProps(Clip& c)
{
    PropertySet& ps = c.props;
    ps.setString(kOfxPropType, kOfxTypeClip);
    ps.setString(kOfxPropName, c.name);
    ps.setString(kOfxPropLabel, c.name);
    ps.setString(kOfxPropShortLabel, c.name);
    ps.setString(kOfxPropLongLabel, c.name);
    ps.setStrings(kOfxImageEffectPropSupportedComponents, {});
    ps.setInt(kOfxImageEffectPropTemporalClipAccess, 0);
    ps.setInt(kOfxImageClipPropOptional, 0);
    ps.setInt(kOfxImageClipPropIsMask, 0);
    ps.setString(kOfxImageClipPropFieldExtraction, kOfxImageFieldDoubled);
    ps.setInt(kOfxImageEffectPropSupportsTiles, 1);
}

void initDescriptorProps(PropertySet& ps, const PluginEntry& plugin)
{
    ps.setString(kOfxPropType, kOfxTypeImageEffect);
    ps.setString(kOfxPropLabel, plugin.id);
    ps.setString(kOfxPropShortLabel, "");
    ps.setString(kOfxPropLongLabel, "");
    ps.setInts(kOfxPropVersion, {plugin.versionMajor, plugin.versionMinor});
    ps.setString(kOfxPropVersionLabel, "");
    ps.setString(kOfxPropPluginDescription, "");
    ps.setStrings(kOfxImageEffectPropSupportedContexts, {});
    ps.setString(kOfxImageEffectPluginPropGrouping, "");
    ps.setInt(kOfxImageEffectPluginPropSingleInstance, 0);
    ps.setString(kOfxImageEffectPluginRenderThreadSafety, kOfxImageEffectRenderInstanceSafe);
    ps.setInt(kOfxImageEffectPluginPropHostFrameThreading, 1);
    ps.setPointer(kOfxImageEffectPluginPropOverlayInteractV1, nullptr);
    ps.setInt(kOfxImageEffectPropSupportsMultiResolution, 1);
    ps.setInt(kOfxImageEffectPropSupportsTiles, 1);
    ps.setInt(kOfxImageEffectPropTemporalClipAccess, 0);
    ps.setStrings(kOfxImageEffectPropSupportedPixelDepths, {});
    ps.setInt(kOfxImageEffectPluginPropFieldRenderTwiceAlways, 1);
    ps.setInt(kOfxImageEffectPropSupportsMultipleClipDepths, 0);
    ps.setInt(kOfxImageEffectPropSupportsMultipleClipPARs, 0);
    ps.setStrings(kOfxImageEffectPropClipPreferencesSlaveParam, {});
    ps.setString(kOfxPluginPropFilePath, plugin.binary ? plugin.binary->bundlePath : "");
    ps.setString(kOfxImageEffectPropOpenGLRenderSupported, "false");
    ps.setString(kOfxImageEffectPropMetalRenderSupported, "false");
    ps.setString(kOfxImageEffectPropOpenCLRenderSupported, "false");
    ps.setString(kOfxImageEffectPropCudaRenderSupported, "false");
}

// ---- Property suite is in ofx_props.cpp ------------------------------------

// ---- Image effect suite ---------------------------------------------------

OfxStatus ieGetPropertySet(OfxImageEffectHandle h, OfxPropertySetHandle* props)
{
    Effect* e = Effect::from(h);
    if (!e || !props) return kOfxStatErrBadHandle;
    *props = e->props.handle();
    return kOfxStatOK;
}

OfxStatus ieGetParamSet(OfxImageEffectHandle h, OfxParamSetHandle* paramSet)
{
    Effect* e = Effect::from(h);
    if (!e || !paramSet) return kOfxStatErrBadHandle;
    *paramSet = e->params.handle();
    return kOfxStatOK;
}

OfxStatus ieClipDefine(OfxImageEffectHandle h, const char* name, OfxPropertySetHandle* props)
{
    Effect* e = Effect::from(h);
    if (!e || !name) return kOfxStatErrBadHandle;
    if (Clip* existing = e->findClip(name)) {
        if (props) *props = existing->props.handle();
        return kOfxStatOK;
    }
    auto clip = std::make_unique<Clip>();
    clip->name = name;
    clip->owner = e;
    clip->isOutput = std::strcmp(name, kOfxImageEffectOutputClipName) == 0;
    initClipDescriptorProps(*clip);
    if (props) *props = clip->props.handle();
    e->clips.push_back(std::move(clip));
    return kOfxStatOK;
}

OfxStatus ieClipGetHandle(OfxImageEffectHandle h, const char* name, OfxImageClipHandle* clip,
                          OfxPropertySetHandle* props)
{
    Effect* e = Effect::from(h);
    if (!e || !name || !clip) return kOfxStatErrBadHandle;
    Clip* c = e->findClip(name);
    if (!c) return kOfxStatErrUnknown;
    *clip = c->handle();
    if (props) *props = c->props.handle();
    return kOfxStatOK;
}

OfxStatus ieClipGetPropertySet(OfxImageClipHandle h, OfxPropertySetHandle* props)
{
    Clip* c = Clip::from(h);
    if (!c || !props) return kOfxStatErrBadHandle;
    *props = c->props.handle();
    return kOfxStatOK;
}

OfxStatus ieClipGetImage(OfxImageClipHandle h, OfxTime time, const OfxRectD* /*region*/,
                         OfxPropertySetHandle* imageHandle)
{
    Clip* c = Clip::from(h);
    if (!c || !imageHandle) return kOfxStatErrBadHandle;
    *imageHandle = nullptr;
    Effect* e = c->owner;
    if (!e || e->kind != EffectKind::Instance) return kOfxStatErrBadHandle;
    RenderContext* ctx = e->render;
    if (!ctx || !c->connected) return kOfxStatFailed;

    const ClipFrame* frame = nullptr;
    {
        std::lock_guard<std::mutex> lock(e->imagesMutex);
        if (c->isOutput) {
            frame = &ctx->output;
        } else if (c == e->sourceClip()) {
            ctx->requestedTimes.push_back(time);
            double best = 1e300;
            for (const auto& f : ctx->source) {
                const double d = std::fabs(f.time - time);
                if (d < best) {
                    best = d;
                    frame = &f;
                }
            }
            if (frame && best > 1e-4) {
                ++ctx->missingFrameRequests;
                if (!ctx->nearestFallback) frame = nullptr;
            }
        }
    }
    if (!frame || !frame->data) return kOfxStatFailed;

    auto* img = new (std::nothrow) PropertySet();
    if (!img) return kOfxStatErrMemory;
    img->setString(kOfxPropType, kOfxTypeImage);
    img->setString(kOfxImageEffectPropPixelDepth, depthToOfx(c->depth));
    img->setString(kOfxImageEffectPropComponents, kOfxImageComponentRGBA);
    img->setString(kOfxImageEffectPropPreMultiplication, kOfxImagePreMultiplied);
    img->setDoubles(kOfxImageEffectPropRenderScale, {ctx->renderScale, ctx->renderScale});
    img->setDouble(kOfxImagePropPixelAspectRatio, 1.0);
    img->setPointer(kOfxImagePropData, const_cast<void*>(frame->data));
    img->setInts(kOfxImagePropBounds, {0, 0, ctx->width, ctx->height});
    img->setInts(kOfxImagePropRegionOfDefinition, {0, 0, ctx->width, ctx->height});
    img->setInt(kOfxImagePropRowBytes, static_cast<int>(frame->rowBytes));
    img->setString(kOfxImagePropField, kOfxImageFieldNone);
    char uid[128];
    std::snprintf(uid, sizeof(uid), "%s@%.4f", c->name.c_str(), frame->time);
    img->setString(kOfxImagePropUniqueIdentifier, uid);
    img->permissive = true;
    {
        std::lock_guard<std::mutex> lock(e->imagesMutex);
        e->liveImages.insert(img);
    }
    {
        std::lock_guard<std::mutex> lock(gImagesMutex);
        gLiveImages[img] = e;
    }
    *imageHandle = img->handle();
    return kOfxStatOK;
}

OfxStatus ieClipReleaseImage(OfxPropertySetHandle h)
{
    auto* img = reinterpret_cast<PropertySet*>(h);
    Effect* owner = nullptr;
    {
        std::lock_guard<std::mutex> lock(gImagesMutex);
        auto it = gLiveImages.find(img);
        if (it == gLiveImages.end()) return kOfxStatErrBadHandle;
        owner = it->second;
        gLiveImages.erase(it);
    }
    if (owner && owner->magic == Effect::kMagic) {
        std::lock_guard<std::mutex> lock(owner->imagesMutex);
        owner->liveImages.erase(img);
    }
    delete img;
    return kOfxStatOK;
}

OfxStatus ieClipGetRegionOfDefinition(OfxImageClipHandle h, OfxTime /*time*/, OfxRectD* bounds)
{
    Clip* c = Clip::from(h);
    if (!c || !bounds) return kOfxStatErrBadHandle;
    Effect* e = c->owner;
    if (!e || e->kind != EffectKind::Instance) return kOfxStatErrBadHandle;
    const double s = e->renderScale > 0.0 ? e->renderScale : 1.0;
    bounds->x1 = 0.0;
    bounds->y1 = 0.0;
    bounds->x2 = e->width / s;
    bounds->y2 = e->height / s;
    return kOfxStatOK;
}

int ieAbort(OfxImageEffectHandle h)
{
    Effect* e = Effect::from(h);
    if (Host::instance().globalAbort.load(std::memory_order_relaxed)) return 1;
    return (e && e->abortFlag.load(std::memory_order_relaxed)) ? 1 : 0;
}

struct ImageMemory {
    static constexpr uint32_t kMagic = 0x4F46584D;
    uint32_t magic = kMagic;
    void* data = nullptr;
    size_t size = 0;
    int locks = 0;
};

OfxStatus ieImageMemoryAlloc(OfxImageEffectHandle, size_t nBytes, OfxImageMemoryHandle* memoryHandle)
{
    if (!memoryHandle) return kOfxStatErrBadHandle;
    *memoryHandle = nullptr;
    auto* m = new (std::nothrow) ImageMemory();
    if (!m) return kOfxStatErrMemory;
    if (posix_memalign(&m->data, 64, nBytes ? nBytes : 1) != 0) {
        delete m;
        return kOfxStatErrMemory;
    }
    m->size = nBytes;
    *memoryHandle = reinterpret_cast<OfxImageMemoryHandle>(m);
    return kOfxStatOK;
}

OfxStatus ieImageMemoryFree(OfxImageMemoryHandle h)
{
    auto* m = reinterpret_cast<ImageMemory*>(h);
    if (!m || m->magic != ImageMemory::kMagic) return kOfxStatErrBadHandle;
    std::free(m->data);
    m->magic = 0;
    delete m;
    return kOfxStatOK;
}

OfxStatus ieImageMemoryLock(OfxImageMemoryHandle h, void** ptr)
{
    auto* m = reinterpret_cast<ImageMemory*>(h);
    if (!m || m->magic != ImageMemory::kMagic) {
        if (ptr) *ptr = nullptr;
        return kOfxStatErrBadHandle;
    }
    ++m->locks;
    if (ptr) *ptr = m->data;
    return kOfxStatOK;
}

OfxStatus ieImageMemoryUnlock(OfxImageMemoryHandle h)
{
    auto* m = reinterpret_cast<ImageMemory*>(h);
    if (!m || m->magic != ImageMemory::kMagic) return kOfxStatErrBadHandle;
    if (m->locks > 0) --m->locks;
    return kOfxStatOK;
}

const OfxImageEffectSuiteV1 kImageEffectSuite = {
    ieGetPropertySet, ieGetParamSet, ieClipDefine, ieClipGetHandle, ieClipGetPropertySet,
    ieClipGetImage, ieClipReleaseImage, ieClipGetRegionOfDefinition, ieAbort,
    ieImageMemoryAlloc, ieImageMemoryFree, ieImageMemoryLock, ieImageMemoryUnlock,
};

// ---- Parameter suite -------------------------------------------------------

OfxStatus prParamDefine(OfxParamSetHandle hs, const char* type, const char* name, OfxPropertySetHandle* props)
{
    ParamSet* set = ParamSet::from(hs);
    if (!set || !type || !name) return kOfxStatErrBadHandle;
    if (Param* existing = set->find(name)) {
        if (existing->ofxType != type) return kOfxStatErrExists;
        if (props) *props = existing->props.handle();
        return kOfxStatErrExists;
    }
    const ParamKind kind = paramKindFromOfx(type);
    if (kind == ParamKind::Unknown) return kOfxStatErrUnknown;
    auto p = std::make_unique<Param>();
    p->name = name;
    p->ofxType = type;
    p->kind = kind;
    p->owner = set->owner;
    p->defineOrder = static_cast<int>(set->params.size());
    initParamProps(*p);
    if (props) *props = p->props.handle();
    set->byName[p->name] = p.get();
    set->params.push_back(std::move(p));
    return kOfxStatOK;
}

OfxStatus prParamGetHandle(OfxParamSetHandle hs, const char* name, OfxParamHandle* param, OfxPropertySetHandle* props)
{
    ParamSet* set = ParamSet::from(hs);
    if (!set || !name || !param) return kOfxStatErrBadHandle;
    Param* p = set->find(name);
    if (!p) return kOfxStatErrUnknown;
    *param = p->handle();
    if (props) *props = p->props.handle();
    return kOfxStatOK;
}

OfxStatus prParamSetGetPropertySet(OfxParamSetHandle hs, OfxPropertySetHandle* props)
{
    ParamSet* set = ParamSet::from(hs);
    if (!set || !props) return kOfxStatErrBadHandle;
    *props = set->props.handle();
    return kOfxStatOK;
}

OfxStatus prParamGetPropertySet(OfxParamHandle h, OfxPropertySetHandle* props)
{
    Param* p = Param::from(h);
    if (!p || !props) return kOfxStatErrBadHandle;
    *props = p->props.handle();
    return kOfxStatOK;
}

OfxStatus readValue(Param* p, va_list ap, double scale /* 1 = value, 0 = derivative */)
{
    switch (p->kind) {
    case ParamKind::Double:
    case ParamKind::Double2D:
    case ParamKind::Double3D:
    case ParamKind::RGB:
    case ParamKind::RGBA: {
        const int dim = paramDimension(p->kind);
        for (int i = 0; i < dim; ++i) {
            double* out = va_arg(ap, double*);
            if (!out) return kOfxStatErrBadHandle;
            *out = i < static_cast<int>(p->dv.size()) ? p->dv[static_cast<size_t>(i)] * scale : 0.0;
        }
        return kOfxStatOK;
    }
    case ParamKind::Integer:
    case ParamKind::Integer2D:
    case ParamKind::Integer3D:
    case ParamKind::Boolean:
    case ParamKind::Choice: {
        const int dim = paramDimension(p->kind);
        for (int i = 0; i < dim; ++i) {
            int* out = va_arg(ap, int*);
            if (!out) return kOfxStatErrBadHandle;
            *out = i < static_cast<int>(p->iv.size())
                ? static_cast<int>(p->iv[static_cast<size_t>(i)] * scale)
                : 0;
        }
        return kOfxStatOK;
    }
    case ParamKind::String:
    case ParamKind::Custom:
    case ParamKind::StrChoice: {
        char** out = va_arg(ap, char**);
        if (!out) return kOfxStatErrBadHandle;
        *out = const_cast<char*>(p->sv.c_str());
        return kOfxStatOK;
    }
    default:
        return kOfxStatErrUnsupported;
    }
}

OfxStatus writeValue(Param* p, va_list ap)
{
    switch (p->kind) {
    case ParamKind::Double:
    case ParamKind::Double2D:
    case ParamKind::Double3D:
    case ParamKind::RGB:
    case ParamKind::RGBA: {
        const int dim = paramDimension(p->kind);
        p->dv.resize(static_cast<size_t>(dim));
        for (int i = 0; i < dim; ++i) p->dv[static_cast<size_t>(i)] = va_arg(ap, double);
        return kOfxStatOK;
    }
    case ParamKind::Integer:
    case ParamKind::Integer2D:
    case ParamKind::Integer3D:
    case ParamKind::Boolean:
    case ParamKind::Choice: {
        const int dim = paramDimension(p->kind);
        p->iv.resize(static_cast<size_t>(dim));
        for (int i = 0; i < dim; ++i) p->iv[static_cast<size_t>(i)] = va_arg(ap, int);
        return kOfxStatOK;
    }
    case ParamKind::String:
    case ParamKind::Custom:
    case ParamKind::StrChoice: {
        const char* v = va_arg(ap, const char*);
        p->sv = v ? v : "";
        return kOfxStatOK;
    }
    default:
        return kOfxStatErrUnsupported;
    }
}

OfxStatus prParamGetValue(OfxParamHandle h, ...)
{
    Param* p = Param::from(h);
    if (!p) return kOfxStatErrBadHandle;
    va_list ap;
    va_start(ap, h);
    const OfxStatus st = readValue(p, ap, 1.0);
    va_end(ap);
    return st;
}

OfxStatus prParamGetDerivative(OfxParamHandle h, OfxTime time, ...)
{
    Param* p = Param::from(h);
    if (!p) return kOfxStatErrBadHandle;
    va_list ap;
    va_start(ap, time);
    const OfxStatus st = readValue(p, ap, 0.0);
    va_end(ap);
    return st;
}

OfxStatus prParamGetIntegral(OfxParamHandle h, OfxTime time1, OfxTime time2, ...)
{
    Param* p = Param::from(h);
    if (!p) return kOfxStatErrBadHandle;
    if (!paramIsDoubleValued(p->kind)) return kOfxStatErrBadHandle;
    va_list ap;
    va_start(ap, time2);
    const OfxStatus st = readValue(p, ap, time2 - time1);
    va_end(ap);
    return st;
}

OfxStatus prParamSetValue(OfxParamHandle h, ...)
{
    Param* p = Param::from(h);
    if (!p) return kOfxStatErrBadHandle;
    va_list ap;
    va_start(ap, h);
    const OfxStatus st = writeValue(p, ap);
    va_end(ap);
    return st;
}

OfxStatus prParamSetValueAtTime(OfxParamHandle h, OfxTime time, ...)
{
    Param* p = Param::from(h);
    if (!p) return kOfxStatErrBadHandle;
    va_list ap;
    va_start(ap, time);
    const OfxStatus st = writeValue(p, ap); // no keyframes: value becomes constant
    va_end(ap);
    return st;
}

OfxStatus prParamGetNumKeys(OfxParamHandle h, unsigned int* numberOfKeys)
{
    if (!Param::from(h) || !numberOfKeys) return kOfxStatErrBadHandle;
    *numberOfKeys = 0;
    return kOfxStatOK;
}

OfxStatus prParamGetKeyTime(OfxParamHandle h, unsigned int, OfxTime*)
{
    if (!Param::from(h)) return kOfxStatErrBadHandle;
    return kOfxStatErrBadIndex;
}

OfxStatus prParamGetKeyIndex(OfxParamHandle h, OfxTime, int, int*)
{
    if (!Param::from(h)) return kOfxStatErrBadHandle;
    return kOfxStatFailed;
}

OfxStatus prParamDeleteKey(OfxParamHandle h, OfxTime)
{
    if (!Param::from(h)) return kOfxStatErrBadHandle;
    return kOfxStatErrBadIndex;
}

OfxStatus prParamDeleteAllKeys(OfxParamHandle h)
{
    if (!Param::from(h)) return kOfxStatErrBadHandle;
    return kOfxStatOK;
}

OfxStatus prParamCopy(OfxParamHandle to, OfxParamHandle from, OfxTime, const OfxRangeD*)
{
    Param* dst = Param::from(to);
    Param* src = Param::from(from);
    if (!dst || !src) return kOfxStatErrBadHandle;
    if (dst->kind != src->kind) return kOfxStatErrValue;
    dst->dv = src->dv;
    dst->iv = src->iv;
    dst->sv = src->sv;
    return kOfxStatOK;
}

OfxStatus prParamEditBegin(OfxParamSetHandle hs, const char*)
{
    return ParamSet::from(hs) ? kOfxStatOK : kOfxStatErrBadHandle;
}

OfxStatus prParamEditEnd(OfxParamSetHandle hs)
{
    return ParamSet::from(hs) ? kOfxStatOK : kOfxStatErrBadHandle;
}

} // namespace

static OfxStatus paramGetValueAtTimeImpl(OfxParamHandle h, OfxTime time, ...)
{
    Param* p = Param::from(h);
    if (!p) return kOfxStatErrBadHandle;
    va_list ap;
    va_start(ap, time);
    const OfxStatus st = readValue(p, ap, 1.0);
    va_end(ap);
    return st;
}

namespace {

const OfxParameterSuiteV1 kParameterSuite = {
    prParamDefine, prParamGetHandle, prParamSetGetPropertySet, prParamGetPropertySet,
    prParamGetValue, paramGetValueAtTimeImpl, prParamGetDerivative, prParamGetIntegral,
    prParamSetValue, prParamSetValueAtTime, prParamGetNumKeys, prParamGetKeyTime,
    prParamGetKeyIndex, prParamDeleteKey, prParamDeleteAllKeys, prParamCopy,
    prParamEditBegin, prParamEditEnd,
};

// ---- Memory suite ------------------------------------------------------------

OfxStatus memAlloc(void*, size_t nBytes, void** data)
{
    if (!data) return kOfxStatErrBadHandle;
    *data = nullptr;
    void* p = nullptr;
    if (posix_memalign(&p, 64, nBytes ? nBytes : 1) != 0) return kOfxStatErrMemory;
    *data = p;
    return kOfxStatOK;
}

OfxStatus memFree(void* data)
{
    std::free(data);
    return kOfxStatOK;
}

const OfxMemorySuiteV1 kMemorySuite = {memAlloc, memFree};

// ---- Multi-thread suite ----------------------------------------------------

struct ThreadJob {
    OfxThreadFunctionV1* func = nullptr;
    unsigned int nThreads = 0;
    void* arg = nullptr;
    std::atomic<unsigned int> next{0};
};

void runThreadJob(ThreadJob* job)
{
    tlsSpawnedThread = true;
    while (true) {
        const unsigned int index = job->next.fetch_add(1);
        if (index >= job->nThreads) break;
        tlsThreadIndex = index;
        try {
            job->func(index, job->nThreads, job->arg);
        } catch (...) {
            // Plugins must not throw across the C ABI; swallow to keep the host alive.
        }
    }
    tlsSpawnedThread = false;
    tlsThreadIndex = 0;
}

void* threadEntry(void* arg)
{
    runThreadJob(static_cast<ThreadJob*>(arg));
    return nullptr;
}

OfxStatus mtMultiThread(OfxThreadFunctionV1 func, unsigned int nThreads, void* customArg)
{
    if (!func) return kOfxStatFailed;
    if (nThreads == 0) return kOfxStatOK;
    if (tlsSpawnedThread) return kOfxStatErrExists;
    ThreadJob job;
    job.func = func;
    job.nThreads = nThreads;
    job.arg = customArg;
    const unsigned int workers = std::max(1u, std::min(nThreads, Host::instance().numThreads()));
    std::vector<pthread_t> threads;
    threads.reserve(workers);
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    // Generous stacks: plugins written for Resolve may use large stack buffers.
    pthread_attr_setstacksize(&attr, 8u * 1024u * 1024u);
    for (unsigned int i = 1; i < workers; ++i) {
        pthread_t t;
        if (pthread_create(&t, &attr, threadEntry, &job) == 0) threads.push_back(t);
    }
    pthread_attr_destroy(&attr);
    runThreadJob(&job); // the calling thread participates
    for (pthread_t t : threads) pthread_join(t, nullptr);
    return kOfxStatOK;
}

OfxStatus mtNumCPUs(unsigned int* n)
{
    if (!n) return kOfxStatFailed;
    *n = Host::instance().numThreads();
    return kOfxStatOK;
}

OfxStatus mtIndex(unsigned int* index)
{
    if (!index) return kOfxStatFailed;
    *index = tlsSpawnedThread ? tlsThreadIndex : 0;
    return kOfxStatOK;
}

int mtIsSpawned()
{
    return tlsSpawnedThread ? 1 : 0;
}

OfxStatus mtMutexCreate(OfxMutexHandle* mutex, int lockCount)
{
    if (!mutex) return kOfxStatFailed;
    auto* m = new (std::nothrow) std::recursive_mutex();
    if (!m) return kOfxStatErrMemory;
    for (int i = 0; i < lockCount; ++i) m->lock();
    *mutex = reinterpret_cast<OfxMutexHandle>(m);
    return kOfxStatOK;
}

OfxStatus mtMutexDestroy(const OfxMutexHandle mutex)
{
    if (!mutex) return kOfxStatErrBadHandle;
    delete reinterpret_cast<std::recursive_mutex*>(mutex);
    return kOfxStatOK;
}

OfxStatus mtMutexLock(const OfxMutexHandle mutex)
{
    if (!mutex) return kOfxStatErrBadHandle;
    reinterpret_cast<std::recursive_mutex*>(mutex)->lock();
    return kOfxStatOK;
}

OfxStatus mtMutexUnLock(const OfxMutexHandle mutex)
{
    if (!mutex) return kOfxStatErrBadHandle;
    reinterpret_cast<std::recursive_mutex*>(mutex)->unlock();
    return kOfxStatOK;
}

OfxStatus mtMutexTryLock(const OfxMutexHandle mutex)
{
    if (!mutex) return kOfxStatErrBadHandle;
    return reinterpret_cast<std::recursive_mutex*>(mutex)->try_lock() ? kOfxStatOK : kOfxStatFailed;
}

const OfxMultiThreadSuiteV1 kMultiThreadSuite = {
    mtMultiThread, mtNumCPUs, mtIndex, mtIsSpawned,
    mtMutexCreate, mtMutexDestroy, mtMutexLock, mtMutexUnLock, mtMutexTryLock,
};

// ---- Message suite ----------------------------------------------------------

std::string pluginTag(void* handle)
{
    Effect* e = Effect::from(handle);
    if (e && e->plugin) return e->plugin->id;
    return "?";
}

OfxStatus postMessage(void* handle, const char* type, const char* id, const char* format, va_list ap, bool persistent)
{
    char buffer[4096];
    buffer[0] = '\0';
    if (format) std::vsnprintf(buffer, sizeof(buffer), format, ap);
    std::fprintf(stderr, "[ofx:%s] %s%s%s%s: %s\n", pluginTag(handle).c_str(),
                 persistent ? "persistent " : "", type ? type : "message",
                 (id && *id) ? " " : "", (id && *id) ? id : "", buffer);
    Effect* e = Effect::from(handle);
    if (e && type && (std::strcmp(type, kOfxMessageError) == 0 || std::strcmp(type, kOfxMessageFatal) == 0)) {
        e->lastError = buffer;
    }
    if (e && persistent) e->persistentMessage = buffer;
    if (type && std::strcmp(type, kOfxMessageQuestion) == 0) return kOfxStatReplyNo;
    return kOfxStatOK;
}

OfxStatus msgMessage(void* handle, const char* type, const char* id, const char* format, ...)
{
    va_list ap;
    va_start(ap, format);
    const OfxStatus st = postMessage(handle, type, id, format, ap, false);
    va_end(ap);
    return st;
}

OfxStatus msgSetPersistent(void* handle, const char* type, const char* id, const char* format, ...)
{
    va_list ap;
    va_start(ap, format);
    const OfxStatus st = postMessage(handle, type, id, format, ap, true);
    va_end(ap);
    return st;
}

OfxStatus msgClearPersistent(void* handle)
{
    if (Effect* e = Effect::from(handle)) e->persistentMessage.clear();
    return kOfxStatOK;
}

const OfxMessageSuiteV2 kMessageSuite = {msgMessage, msgSetPersistent, msgClearPersistent};

// ---- Progress suite ----------------------------------------------------------

OfxStatus progStartV1(void*, const char*) { return kOfxStatOK; }
OfxStatus progStartV2(void*, const char*, const char*) { return kOfxStatOK; }
OfxStatus progUpdate(void* instance, double)
{
    return ieAbort(reinterpret_cast<OfxImageEffectHandle>(instance)) ? kOfxStatReplyNo : kOfxStatOK;
}
OfxStatus progEnd(void*) { return kOfxStatOK; }

const OfxProgressSuiteV1 kProgressSuiteV1 = {progStartV1, progUpdate, progEnd};
const OfxProgressSuiteV2 kProgressSuiteV2 = {progStartV2, progUpdate, progEnd};

// ---- Timeline suite -----------------------------------------------------------

OfxStatus tlGetTime(void* instance, double* time)
{
    if (!time) return kOfxStatErrBadHandle;
    Effect* e = Effect::from(instance);
    *time = (e && e->render) ? e->render->time : 0.0;
    return kOfxStatOK;
}

OfxStatus tlGotoTime(void*, double) { return kOfxStatOK; }

OfxStatus tlGetTimeBounds(void* instance, double* first, double* last)
{
    if (!first || !last) return kOfxStatErrBadHandle;
    Effect* e = Effect::from(instance);
    std::vector<double> range;
    if (e) range = e->props.getDoubles(kOfxImageEffectPropFrameRange);
    *first = range.size() >= 1 ? range[0] : 0.0;
    *last = range.size() >= 2 ? range[1] : 0.0;
    return kOfxStatOK;
}

const OfxTimeLineSuiteV1 kTimeLineSuite = {tlGetTime, tlGotoTime, tlGetTimeBounds};

// ---- fetchSuite trampoline ---------------------------------------------------

const void* fetchSuiteCb(OfxPropertySetHandle /*host*/, const char* name, int version)
{
    return Host::instance().fetchSuite(name, version);
}

} // namespace

// ---------------------------------------------------------------------------
// Host

Host& Host::instance()
{
    static Host* host = new Host(); // intentionally leaked: plugins may outlive static destruction
    return *host;
}

Host::Host()
{
    unsigned n = std::thread::hardware_concurrency();
    if (const char* env = std::getenv("AVPE_OFX_THREADS")) {
        const int v = std::atoi(env);
        if (v > 0) n = static_cast<unsigned>(v);
    }
    numThreads_ = n ? n : 1;
    ofxHost_.host = hostProps_.handle();
    ofxHost_.fetchSuite = fetchSuiteCb;
    initHostProps();
}

void Host::setIdentity(const std::string& name, const std::string& label)
{
    if (!name.empty()) hostName_ = name;
    if (!label.empty()) hostLabel_ = label;
    initHostProps();
}

void Host::initHostProps()
{
    PropertySet& p = hostProps_;
    p.setString(kOfxPropType, kOfxTypeImageEffectHost);
    p.setString(kOfxPropName, hostName_);
    p.setString(kOfxPropLabel, hostLabel_);
    p.setInts(kOfxPropAPIVersion, {1, 5});
    p.setInts(kOfxPropVersion, {0, 1, 0});
    p.setString(kOfxPropVersionLabel, kHostVersionString);
    p.setInt(kOfxImageEffectHostPropIsBackground, 1);
    p.setInt(kOfxImageEffectPropSupportsOverlays, 0);
    p.setInt(kOfxImageEffectPropSupportsMultiResolution, 1);
    p.setInt(kOfxImageEffectPropSupportsTiles, 0);
    p.setInt(kOfxImageEffectPropTemporalClipAccess, 1);
    p.setStrings(kOfxImageEffectPropSupportedComponents, {kOfxImageComponentRGBA});
    p.setStrings(kOfxImageEffectPropSupportedContexts, {kOfxImageEffectContextFilter, kOfxImageEffectContextGeneral});
    p.setStrings(kOfxImageEffectPropSupportedPixelDepths, {kOfxBitDepthFloat, kOfxBitDepthShort, kOfxBitDepthByte});
    p.setInt(kOfxImageEffectPropSupportsMultipleClipDepths, 0);
    p.setInt(kOfxImageEffectPropSupportsMultipleClipPARs, 0);
    p.setInt(kOfxImageEffectPropSetableFrameRate, 0);
    p.setInt(kOfxImageEffectPropSetableFielding, 0);
    p.setInt(kOfxImageEffectInstancePropSequentialRender, 1);
    p.setInt(kOfxParamHostPropSupportsCustomInteract, 0);
    p.setInt(kOfxParamHostPropSupportsStringAnimation, 0);
    p.setInt(kOfxParamHostPropSupportsChoiceAnimation, 0);
    p.setInt(kOfxParamHostPropSupportsBooleanAnimation, 0);
    p.setInt(kOfxParamHostPropSupportsCustomAnimation, 0);
    p.setInt(kOfxParamHostPropSupportsStrChoice, 1);
    p.setInt(kOfxParamHostPropSupportsStrChoiceAnimation, 0);
    p.setInt(kOfxParamHostPropMaxParameters, -1);
    p.setInt(kOfxParamHostPropMaxPages, 0);
    p.setInts(kOfxParamHostPropPageRowColumnCount, {0, 0});
    p.setInt("OfxParamHostPropSupportsParametricAnimation", 0);
    p.setPointer(kOfxPropHostOSHandle, nullptr);
    p.setInt(kOfxImageEffectPropRenderQualityDraft, 0);
    p.setString(kOfxImageEffectHostPropNativeOrigin, kOfxHostNativeOriginBottomLeft);
    // CPU only: never advertise GPU render paths.
    p.setString(kOfxImageEffectPropOpenGLRenderSupported, "false");
    p.setString(kOfxImageEffectPropMetalRenderSupported, "false");
    p.setString(kOfxImageEffectPropOpenCLRenderSupported, "false");
    p.setString(kOfxImageEffectPropCudaRenderSupported, "false");
    p.setString(kOfxImageEffectPropCudaStreamSupported, "false");
}

const void* Host::fetchSuite(const char* name, int version)
{
    if (!name) return nullptr;
    const std::string n(name);
    if (n == kOfxPropertySuite && version == 1) return propertySuite();
    if (n == kOfxImageEffectSuite && version == 1) return &kImageEffectSuite;
    if (n == kOfxParameterSuite && version == 1) return &kParameterSuite;
    if (n == kOfxMemorySuite && version == 1) return &kMemorySuite;
    if (n == kOfxMultiThreadSuite && version == 1) return &kMultiThreadSuite;
    if (n == kOfxMessageSuite && (version == 1 || version == 2)) return &kMessageSuite;
    if (n == kOfxProgressSuite && version == 1) return &kProgressSuiteV1;
    if (n == kOfxProgressSuite && version == 2) return &kProgressSuiteV2;
    if (n == kOfxTimeLineSuite && version == 1) return &kTimeLineSuite;
    AVPE_DEBUG("unsupported suite requested: %s v%d", name, version);
    return nullptr;
}

OfxStatus Host::callAction(PluginEntry& plugin, const char* action, const void* handle,
                           PropertySet* inArgs, PropertySet* outArgs)
{
    if (!plugin.ofx || !plugin.ofx->mainEntry) return kOfxStatErrFatal;
    setCrashWhat(plugin.id + " " + action);
    OfxStatus st = kOfxStatErrUnknown;
    try {
        st = plugin.ofx->mainEntry(action, handle, inArgs ? inArgs->handle() : nullptr,
                                   outArgs ? outArgs->handle() : nullptr);
    } catch (const std::exception& ex) {
        std::fprintf(stderr, "[avpe-ofx-host] %s threw in %s: %s\n", plugin.id.c_str(), action, ex.what());
        st = kOfxStatErrUnknown;
    } catch (...) {
        std::fprintf(stderr, "[avpe-ofx-host] %s threw in %s\n", plugin.id.c_str(), action);
        st = kOfxStatErrUnknown;
    }
    setCrashWhat("");
    AVPE_DEBUG("%s %s -> %s", plugin.id.c_str(), action, statusName(st));
    return st;
}

static std::string findBundleExecutable(const std::string& bundlePath)
{
    std::string base = bundlePath;
    while (!base.empty() && base.back() == '/') base.pop_back();
    const size_t slash = base.find_last_of('/');
    std::string name = slash == std::string::npos ? base : base.substr(slash + 1);
    const std::string suffix = ".bundle";
    if (name.size() > suffix.size() && name.compare(name.size() - suffix.size(), suffix.size(), suffix) == 0) {
        name = name.substr(0, name.size() - suffix.size());
    }
    const char* archDirs[] = {"Contents/MacOS", "Contents/MacOS-arm-64", "Contents/MacOS-x86-64"};
    for (const char* dir : archDirs) {
        const std::string candidate = base + "/" + dir + "/" + name;
        struct stat st {};
        if (stat(candidate.c_str(), &st) == 0 && S_ISREG(st.st_mode)) return candidate;
    }
    return "";
}

PluginBinary* Host::loadBundle(const std::string& bundlePath, std::string& error)
{
    for (auto& b : binaries_) {
        if (b->bundlePath == bundlePath) {
            if (!b->dl) error = b->error;
            return b->dl ? b.get() : nullptr;
        }
    }
    auto bin = std::make_unique<PluginBinary>();
    bin->bundlePath = bundlePath;

    std::string exe;
#if defined(__APPLE__)
    // Register the bundle with CoreFoundation first so plugins that look up
    // their resources via CFBundleGetBundleWithIdentifier() find themselves.
    CFURLRef url = CFURLCreateFromFileSystemRepresentation(
        kCFAllocatorDefault, reinterpret_cast<const UInt8*>(bundlePath.c_str()),
        static_cast<CFIndex>(bundlePath.size()), true);
    if (url) {
        CFBundleRef cfb = CFBundleCreate(kCFAllocatorDefault, url);
        CFRelease(url);
        if (cfb) {
            bin->cfBundle = cfb; // retained for the process lifetime
            if (CFURLRef exeUrl = CFBundleCopyExecutableURL(cfb)) {
                char buf[4096];
                if (CFURLGetFileSystemRepresentation(exeUrl, true, reinterpret_cast<UInt8*>(buf), sizeof(buf))) {
                    exe = buf;
                }
                CFRelease(exeUrl);
            }
        }
    }
#endif
    if (exe.empty()) exe = findBundleExecutable(bundlePath);
    if (exe.empty()) {
        bin->error = "no executable found in bundle";
        error = bin->error;
        binaries_.push_back(std::move(bin));
        return nullptr;
    }
    bin->executablePath = exe;

    setCrashWhat("dlopen " + exe);
    void* dl = dlopen(exe.c_str(), RTLD_LAZY | RTLD_LOCAL);
    setCrashWhat("");
    if (!dl) {
        const char* err = dlerror();
        bin->error = std::string("dlopen failed: ") + (err ? err : "unknown error");
        error = bin->error;
        binaries_.push_back(std::move(bin));
        return nullptr;
    }
    bin->dl = dl;
    bin->getNumberOfPlugins = reinterpret_cast<int (*)()>(dlsym(dl, "OfxGetNumberOfPlugins"));
    bin->getPlugin = reinterpret_cast<OfxPlugin* (*)(int)>(dlsym(dl, "OfxGetPlugin"));
    if (!bin->getNumberOfPlugins || !bin->getPlugin) {
        bin->error = "binary does not export OfxGetNumberOfPlugins/OfxGetPlugin";
        error = bin->error;
        binaries_.push_back(std::move(bin));
        return nullptr;
    }
    // OFX 1.4+: optional OfxSetHost entry point, called before OfxGetPlugin.
    using SetHostFn = OfxStatus (*)(const OfxHost*);
    if (auto setHost = reinterpret_cast<SetHostFn>(dlsym(dl, "OfxSetHost"))) {
        setCrashWhat("OfxSetHost " + exe);
        try {
            setHost(&ofxHost_);
        } catch (...) {
        }
        setCrashWhat("");
    }

    int count = 0;
    setCrashWhat("OfxGetNumberOfPlugins " + exe);
    try {
        count = bin->getNumberOfPlugins();
    } catch (...) {
        count = 0;
    }
    setCrashWhat("");
    if (count < 0 || count > 4096) count = 0;
    PluginBinary* raw = bin.get();
    binaries_.push_back(std::move(bin));
    for (int i = 0; i < count; ++i) {
        OfxPlugin* ofx = nullptr;
        try {
            ofx = raw->getPlugin(i);
        } catch (...) {
            ofx = nullptr;
        }
        if (!ofx || !ofx->pluginIdentifier) continue;
        auto entry = std::make_unique<PluginEntry>();
        entry->binary = raw;
        entry->ofx = ofx;
        entry->index = i;
        entry->id = ofx->pluginIdentifier;
        entry->versionMajor = static_cast<int>(ofx->pluginVersionMajor);
        entry->versionMinor = static_cast<int>(ofx->pluginVersionMinor);
        if (!ofx->pluginApi || std::strcmp(ofx->pluginApi, kOfxImageEffectPluginApi) != 0) {
            entry->error = std::string("unsupported plugin API: ") + (ofx->pluginApi ? ofx->pluginApi : "null");
        } else if (ofx->apiVersion < 1) {
            entry->error = "unsupported API version";
        }
        plugins_.push_back(std::move(entry));
    }
    return raw;
}

std::vector<PluginEntry*> Host::pluginsOfBinary(const PluginBinary* bin)
{
    std::vector<PluginEntry*> out;
    for (auto& p : plugins_) {
        if (p->binary == bin) out.push_back(p.get());
    }
    return out;
}

PluginEntry* Host::findPlugin(const std::string& id)
{
    PluginEntry* best = nullptr;
    for (auto& p : plugins_) {
        if (p->id != id) continue;
        // Prefer the highest version when several bundles provide the same id.
        if (!best || p->versionMajor > best->versionMajor ||
            (p->versionMajor == best->versionMajor && p->versionMinor > best->versionMinor)) {
            best = p.get();
        }
    }
    return best;
}

bool Host::describeInContext(PluginEntry& plugin, const std::string& context)
{
    auto ctx = std::make_unique<Effect>();
    ctx->kind = EffectKind::ContextDescriptor;
    ctx->plugin = &plugin;
    ctx->context = context;
    ctx->props = plugin.descriptor->props;
    ctx->props.setString(kOfxImageEffectPropContext, context);
    PropertySet inArgs;
    inArgs.setString(kOfxImageEffectPropContext, context);
    const OfxStatus st = callAction(plugin, kOfxImageEffectActionDescribeInContext, ctx->handle(), &inArgs, nullptr);
    if (st != kOfxStatOK && st != kOfxStatReplyDefault) {
        AVPE_DEBUG("%s describeInContext(%s) failed: %s", plugin.id.c_str(), context.c_str(), statusName(st));
        return false;
    }
    plugin.contextDescriptors[context] = std::move(ctx);
    return true;
}

bool Host::describePlugin(PluginEntry& plugin)
{
    if (plugin.described) return plugin.error.empty();
    if (!plugin.error.empty()) return false;
    plugin.described = true;

    try {
        plugin.ofx->setHost(&ofxHost_);
    } catch (...) {
        plugin.error = "setHost threw";
        return false;
    }
    OfxStatus st = callAction(plugin, kOfxActionLoad, nullptr, nullptr, nullptr);
    if (st != kOfxStatOK && st != kOfxStatReplyDefault) {
        plugin.error = std::string("load action failed: ") + statusName(st);
        return false;
    }
    plugin.loaded = true;

    plugin.descriptor = std::make_unique<Effect>();
    plugin.descriptor->kind = EffectKind::Descriptor;
    plugin.descriptor->plugin = &plugin;
    initDescriptorProps(plugin.descriptor->props, plugin);
    st = callAction(plugin, kOfxActionDescribe, plugin.descriptor->handle(), nullptr, nullptr);
    if (st != kOfxStatOK && st != kOfxStatReplyDefault) {
        plugin.error = std::string("describe action failed: ") + statusName(st);
        return false;
    }

    const auto contexts = plugin.descriptor->props.getStrings(kOfxImageEffectPropSupportedContexts);
    const bool hasFilter = std::find(contexts.begin(), contexts.end(), kOfxImageEffectContextFilter) != contexts.end();
    const bool hasGeneral = std::find(contexts.begin(), contexts.end(), kOfxImageEffectContextGeneral) != contexts.end();
    if (hasFilter && describeInContext(plugin, kOfxImageEffectContextFilter)) {
        plugin.preferredContext = kOfxImageEffectContextFilter;
    }
    if (hasGeneral && describeInContext(plugin, kOfxImageEffectContextGeneral) && plugin.preferredContext.empty()) {
        // General context is usable when every mandatory input is the single Source clip.
        const Effect& g = *plugin.contextDescriptors[kOfxImageEffectContextGeneral];
        bool usable = g.sourceClip() != nullptr && g.outputClip() != nullptr;
        for (const auto& c : g.clips) {
            if (c->isOutput || c->name == kOfxImageEffectSimpleSourceClipName) continue;
            if (!c->props.getInt(kOfxImageClipPropOptional)) usable = false;
        }
        if (usable) {
            plugin.preferredContext = kOfxImageEffectContextGeneral;
        } else {
            plugin.unsupportedReason = "general context requires additional mandatory input clips";
        }
    }
    if (plugin.preferredContext.empty() && plugin.unsupportedReason.empty()) {
        plugin.unsupportedReason = (hasFilter || hasGeneral)
            ? "describeInContext failed"
            : "no filter or general context (generators/transitions are not supported)";
    }
    const auto depths = plugin.descriptor->props.getStrings(kOfxImageEffectPropSupportedPixelDepths);
    bool depthOk = depths.empty(); // empty list: assume float works
    for (const auto& d : depths) {
        if (depthFromOfx(d) != PixelDepth::None) depthOk = true;
    }
    if (!depthOk && plugin.unsupportedReason.empty()) {
        plugin.unsupportedReason = "no supported pixel depth (host supports float, short, byte)";
        plugin.preferredContext.clear();
    }
    return true;
}

// ---- JSON description ---------------------------------------------------------

static Json numberOrNull(double v)
{
    if (!std::isfinite(v) || std::fabs(v) >= 1e300) return Json();
    return Json(v);
}

static Json intOrNull(int v)
{
    if (v == INT_MIN || v == INT_MAX) return Json();
    return Json(v);
}

static Json valueListToJson(const Param& p, const std::string& propName, bool asBoolean)
{
    const int dim = paramDimension(p.kind);
    Json::Array arr;
    if (paramIsDoubleValued(p.kind)) {
        auto v = p.props.getDoubles(propName);
        if (v.empty()) return Json();
        for (double d : v) arr.push_back(numberOrNull(d));
    } else if (paramIsIntValued(p.kind)) {
        auto v = p.props.getInts(propName);
        if (v.empty()) return Json();
        for (int i : v) arr.push_back(asBoolean ? Json(i != 0) : intOrNull(i));
    } else if (paramIsStringValued(p.kind)) {
        if (!p.props.has(propName)) return Json();
        return Json(p.props.getString(propName));
    } else {
        return Json();
    }
    if (dim == 1) return arr.empty() ? Json() : arr[0];
    return Json(std::move(arr));
}

static Json stringsToJson(const std::vector<std::string>& v)
{
    Json::Array a;
    for (const auto& s : v) a.push_back(Json(s));
    return Json(std::move(a));
}

static Json paramToJson(const Param& p)
{
    Json j = Json::object();
    const PropertySet& ps = p.props;
    j["name"] = p.name;
    j["type"] = paramKindName(p.kind);
    j["ofxType"] = p.ofxType;
    j["label"] = ps.getString(kOfxPropLabel, 0, p.name);
    const std::string shortLabel = ps.getString(kOfxPropShortLabel);
    if (!shortLabel.empty() && shortLabel != p.name) j["shortLabel"] = shortLabel;
    j["hint"] = ps.getString(kOfxParamPropHint);
    j["scriptName"] = ps.getString(kOfxParamPropScriptName, 0, p.name);
    j["parent"] = ps.getString(kOfxParamPropParent);
    j["secret"] = ps.getInt(kOfxParamPropSecret) != 0;
    j["enabled"] = ps.getInt(kOfxParamPropEnabled, 0, 1) != 0;
    j["order"] = p.defineOrder;
    const int dim = paramDimension(p.kind);
    j["dimension"] = dim;
    if (dim > 0) {
        j["animates"] = ps.getInt(kOfxParamPropAnimates) != 0;
        j["evaluateOnChange"] = ps.getInt(kOfxParamPropEvaluateOnChange, 0, 1) != 0;
        const bool asBool = p.kind == ParamKind::Boolean;
        j["default"] = valueListToJson(p, kOfxParamPropDefault, asBool);
    }
    if (paramIsDoubleValued(p.kind) || p.kind == ParamKind::Integer || p.kind == ParamKind::Integer2D ||
        p.kind == ParamKind::Integer3D) {
        j["min"] = valueListToJson(p, kOfxParamPropMin, false);
        j["max"] = valueListToJson(p, kOfxParamPropMax, false);
        j["displayMin"] = valueListToJson(p, kOfxParamPropDisplayMin, false);
        j["displayMax"] = valueListToJson(p, kOfxParamPropDisplayMax, false);
    }
    if (paramIsDoubleValued(p.kind)) {
        if (ps.has(kOfxParamPropDoubleType)) j["doubleType"] = ps.getString(kOfxParamPropDoubleType);
        if (ps.has(kOfxParamPropDefaultCoordinateSystem))
            j["coordinateSystem"] = ps.getString(kOfxParamPropDefaultCoordinateSystem);
        j["digits"] = ps.getInt(kOfxParamPropDigits, 0, 2);
        j["increment"] = numberOrNull(ps.getDouble(kOfxParamPropIncrement, 0, 1.0));
    }
    if (dim > 1 && ps.has(kOfxParamPropDimensionLabel)) {
        j["dimensionLabels"] = stringsToJson(ps.getStrings(kOfxParamPropDimensionLabel));
    }
    if (p.kind == ParamKind::Choice || p.kind == ParamKind::StrChoice) {
        j["options"] = stringsToJson(ps.getStrings(kOfxParamPropChoiceOption));
        if (ps.has(kOfxParamPropChoiceEnum) && !ps.getStrings(kOfxParamPropChoiceEnum).empty())
            j["optionEnums"] = stringsToJson(ps.getStrings(kOfxParamPropChoiceEnum));
        if (ps.has(kOfxParamPropChoiceOrder)) {
            Json::Array order;
            for (int v : ps.getInts(kOfxParamPropChoiceOrder)) order.push_back(Json(v));
            if (!order.empty()) j["optionOrder"] = Json(std::move(order));
        }
    }
    if (p.kind == ParamKind::String) {
        j["stringMode"] = ps.getString(kOfxParamPropStringMode, 0, kOfxParamStringIsSingleLine);
        j["filePathExists"] = ps.getInt(kOfxParamPropStringFilePathExists, 0, 1) != 0;
    }
    if (p.kind == ParamKind::Group) {
        j["groupOpen"] = ps.getInt(kOfxParamPropGroupOpen, 0, 1) != 0;
        if (ps.has("OfxParamPropGroupIsTab")) j["groupIsTab"] = ps.getInt("OfxParamPropGroupIsTab") != 0;
    }
    if (p.kind == ParamKind::Page) {
        j["children"] = stringsToJson(ps.getStrings(kOfxParamPropPageChild));
    }
    return j;
}

Json Host::describeToJson(PluginEntry& plugin)
{
    Json j = Json::object();
    j["id"] = plugin.id;
    j["version"] = Json(Json::Array{Json(plugin.versionMajor), Json(plugin.versionMinor)});
    j["versionString"] = std::to_string(plugin.versionMajor) + "." + std::to_string(plugin.versionMinor);
    j["bundlePath"] = plugin.binary ? plugin.binary->bundlePath : "";
    j["binaryPath"] = plugin.binary ? plugin.binary->executablePath : "";
    j["pluginIndex"] = plugin.index;
    j["apiVersion"] = plugin.ofx ? plugin.ofx->apiVersion : 0;
    if (!plugin.error.empty() || !plugin.descriptor) {
        j["loaded"] = false;
        j["supported"] = false;
        j["error"] = plugin.error.empty() ? "not described" : plugin.error;
        return j;
    }
    const PropertySet& d = plugin.descriptor->props;
    j["loaded"] = true;
    j["label"] = d.getString(kOfxPropLabel, 0, plugin.id);
    j["shortLabel"] = d.getString(kOfxPropShortLabel);
    j["longLabel"] = d.getString(kOfxPropLongLabel);
    j["grouping"] = d.getString(kOfxImageEffectPluginPropGrouping);
    j["description"] = d.getString(kOfxPropPluginDescription);
    j["versionLabel"] = d.getString(kOfxPropVersionLabel);
    j["contexts"] = stringsToJson(d.getStrings(kOfxImageEffectPropSupportedContexts));
    j["pixelDepths"] = stringsToJson(d.getStrings(kOfxImageEffectPropSupportedPixelDepths));
    j["temporalClipAccess"] = d.getInt(kOfxImageEffectPropTemporalClipAccess) != 0;
    j["supportsTiles"] = d.getInt(kOfxImageEffectPropSupportsTiles, 0, 1) != 0;
    j["supportsMultiResolution"] = d.getInt(kOfxImageEffectPropSupportsMultiResolution, 0, 1) != 0;
    j["renderThreadSafety"] = d.getString(kOfxImageEffectPluginRenderThreadSafety);
    j["hostFrameThreading"] = d.getInt(kOfxImageEffectPluginPropHostFrameThreading, 0, 1) != 0;
    j["singleInstance"] = d.getInt(kOfxImageEffectPluginPropSingleInstance) != 0;
    Json gpu = Json::object();
    gpu["metal"] = d.getString(kOfxImageEffectPropMetalRenderSupported, 0, "false");
    gpu["opencl"] = d.getString(kOfxImageEffectPropOpenCLRenderSupported, 0, "false");
    gpu["cuda"] = d.getString(kOfxImageEffectPropCudaRenderSupported, 0, "false");
    gpu["opengl"] = d.getString(kOfxImageEffectPropOpenGLRenderSupported, 0, "false");
    j["gpuDeclared"] = gpu;
    j["hasOverlay"] = d.getPointer(kOfxImageEffectPluginPropOverlayInteractV1) != nullptr ||
                      d.getPointer("OfxImageEffectPluginPropOverlayInteractV2") != nullptr;

    j["supported"] = !plugin.preferredContext.empty();
    j["context"] = plugin.preferredContext.empty() ? Json() : Json(plugin.preferredContext);
    if (!plugin.unsupportedReason.empty()) j["unsupportedReason"] = plugin.unsupportedReason;

    const Effect* ctx = nullptr;
    if (!plugin.preferredContext.empty()) {
        ctx = plugin.contextDescriptors[plugin.preferredContext].get();
    } else if (!plugin.contextDescriptors.empty()) {
        ctx = plugin.contextDescriptors.begin()->second.get();
    }
    Json clips = Json::array();
    Json params = Json::array();
    Json pages = Json::array();
    if (ctx) {
        for (const auto& c : ctx->clips) {
            Json cj = Json::object();
            cj["name"] = c->name;
            cj["label"] = c->props.getString(kOfxPropLabel, 0, c->name);
            cj["optional"] = c->props.getInt(kOfxImageClipPropOptional) != 0;
            cj["isMask"] = c->props.getInt(kOfxImageClipPropIsMask) != 0;
            cj["temporalClipAccess"] = c->props.getInt(kOfxImageEffectPropTemporalClipAccess) != 0;
            cj["components"] = stringsToJson(c->props.getStrings(kOfxImageEffectPropSupportedComponents));
            clips.push(cj);
        }
        // Page membership and group children.
        std::map<std::string, std::pair<std::string, int>> pageOf;
        std::map<std::string, std::vector<std::string>> groupChildren;
        for (const auto& p : ctx->params.params) {
            if (p->kind == ParamKind::Page) {
                Json pj = Json::object();
                pj["name"] = p->name;
                pj["label"] = p->props.getString(kOfxPropLabel, 0, p->name);
                const auto children = p->props.getStrings(kOfxParamPropPageChild);
                pj["children"] = stringsToJson(children);
                pages.push(pj);
                for (size_t i = 0; i < children.size(); ++i) {
                    if (!children[i].empty() && !pageOf.count(children[i]))
                        pageOf[children[i]] = {p->name, static_cast<int>(i)};
                }
            }
            const std::string parent = p->props.getString(kOfxParamPropParent);
            if (!parent.empty()) groupChildren[parent].push_back(p->name);
        }
        for (const auto& p : ctx->params.params) {
            Json pj = paramToJson(*p);
            auto it = pageOf.find(p->name);
            if (it != pageOf.end()) {
                pj["page"] = it->second.first;
                pj["pageIndex"] = it->second.second;
            } else {
                pj["page"] = Json();
                pj["pageIndex"] = Json();
            }
            if (p->kind == ParamKind::Group) pj["children"] = stringsToJson(groupChildren[p->name]);
            params.push(pj);
        }
    }
    j["clips"] = clips;
    j["params"] = params;
    j["pages"] = pages;
    return j;
}

// ---- Instances ---------------------------------------------------------------

Effect* Host::getInstance(const std::string& instanceId)
{
    auto it = instances_.find(instanceId);
    return it == instances_.end() ? nullptr : it->second.get();
}

static PixelDepth chooseDepth(const PluginEntry& plugin)
{
    const auto depths = plugin.descriptor->props.getStrings(kOfxImageEffectPropSupportedPixelDepths);
    if (depths.empty()) return PixelDepth::Float;
    const PixelDepth order[] = {PixelDepth::Float, PixelDepth::Short, PixelDepth::Byte};
    for (PixelDepth d : order) {
        if (std::find(depths.begin(), depths.end(), depthToOfx(d)) != depths.end()) return d;
    }
    return PixelDepth::None;
}

static void setClipInstanceProps(Clip& c, double fps, double duration)
{
    PropertySet& ps = c.props;
    ps.setString(kOfxImageEffectPropPixelDepth, depthToOfx(c.depth));
    ps.setString(kOfxImageEffectPropComponents, kOfxImageComponentRGBA);
    ps.setString(kOfxImageClipPropUnmappedPixelDepth, depthToOfx(c.depth));
    ps.setString(kOfxImageClipPropUnmappedComponents, kOfxImageComponentRGBA);
    ps.setString(kOfxImageEffectPropPreMultiplication, kOfxImagePreMultiplied);
    ps.setDouble(kOfxImagePropPixelAspectRatio, 1.0);
    ps.setDouble(kOfxImageEffectPropFrameRate, fps);
    ps.setDoubles(kOfxImageEffectPropFrameRange, {0.0, duration - 1.0});
    ps.setString(kOfxImageClipPropFieldOrder, kOfxImageFieldNone);
    ps.setInt(kOfxImageClipPropConnected, c.connected ? 1 : 0);
    ps.setDoubles(kOfxImageEffectPropUnmappedFrameRange, {0.0, duration - 1.0});
    ps.setDouble(kOfxImageEffectPropUnmappedFrameRate, fps);
    ps.setInt(kOfxImageClipPropContinuousSamples, 0);
}

void Host::updateInstanceGeometry(Effect& inst, int width, int height, double fps, double renderScale)
{
    if (renderScale <= 0.0 || !std::isfinite(renderScale)) renderScale = 1.0;
    if (fps <= 0.0 || !std::isfinite(fps)) fps = 25.0;
    inst.width = width;
    inst.height = height;
    inst.fps = fps;
    inst.renderScale = renderScale;
    const double pw = width / renderScale;
    const double ph = height / renderScale;
    const double duration = 1000000.0;
    inst.props.setDoubles(kOfxImageEffectPropProjectSize, {pw, ph});
    inst.props.setDoubles(kOfxImageEffectPropProjectOffset, {0.0, 0.0});
    inst.props.setDoubles(kOfxImageEffectPropProjectExtent, {pw, ph});
    inst.props.setDouble(kOfxImageEffectPropProjectPixelAspectRatio, 1.0);
    inst.props.setDouble(kOfxImageEffectInstancePropEffectDuration, duration);
    inst.props.setDouble(kOfxImageEffectPropFrameRate, fps);
    inst.props.setDoubles(kOfxImageEffectPropFrameRange, {0.0, duration - 1.0});
    for (auto& c : inst.clips) setClipInstanceProps(*c, fps, duration);
}

Effect* Host::createInstance(PluginEntry& plugin, const std::string& instanceId, int width, int height,
                             double fps, double renderScale, std::string& error)
{
    if (!describePlugin(plugin)) {
        error = plugin.error.empty() ? "plugin failed to describe" : plugin.error;
        return nullptr;
    }
    if (plugin.preferredContext.empty()) {
        error = "plugin not supported by this host: " + plugin.unsupportedReason;
        return nullptr;
    }
    const PixelDepth depth = chooseDepth(plugin);
    if (depth == PixelDepth::None) {
        error = "no supported pixel depth";
        return nullptr;
    }
    const Effect& ctx = *plugin.contextDescriptors[plugin.preferredContext];

    auto inst = std::make_unique<Effect>();
    inst->kind = EffectKind::Instance;
    inst->plugin = &plugin;
    inst->context = plugin.preferredContext;
    inst->instanceId = instanceId;
    inst->props = ctx.props;
    inst->props.setString(kOfxPropType, kOfxTypeImageEffectInstance);
    inst->props.setString(kOfxImageEffectPropContext, plugin.preferredContext);
    inst->props.setPointer(kOfxPropInstanceData, nullptr);
    inst->props.setInt(kOfxPropIsInteractive, 0);
    inst->props.setInt(kOfxImageEffectInstancePropSequentialRender, 0);
    inst->props.setInt(kOfxImageEffectPropSupportsTiles, 0);

    for (const auto& c : ctx.clips) {
        auto clip = std::make_unique<Clip>();
        clip->name = c->name;
        clip->props = c->props;
        clip->owner = inst.get();
        clip->isOutput = c->isOutput;
        clip->depth = depth;
        clip->connected = c->isOutput || c->name == kOfxImageEffectSimpleSourceClipName;
        inst->clips.push_back(std::move(clip));
    }
    updateInstanceGeometry(*inst, width, height, fps, renderScale);

    const double pw = width / (renderScale > 0 ? renderScale : 1.0);
    const double ph = height / (renderScale > 0 ? renderScale : 1.0);
    for (const auto& p : ctx.params.params) {
        auto param = std::make_unique<Param>();
        param->name = p->name;
        param->ofxType = p->ofxType;
        param->kind = p->kind;
        param->props = p->props;
        param->defineOrder = p->defineOrder;
        param->owner = inst.get();
        param->resetToDefault(pw, ph);
        inst->params.byName[param->name] = param.get();
        inst->params.params.push_back(std::move(param));
    }
    inst->params.props = ctx.params.props;

    Effect* raw = inst.get();
    instances_[instanceId] = std::move(inst);
    const OfxStatus st = callAction(plugin, kOfxActionCreateInstance, raw->handle(), nullptr, nullptr);
    if (st != kOfxStatOK && st != kOfxStatReplyDefault) {
        error = std::string("createInstance failed: ") + statusName(st);
        if (!raw->lastError.empty()) error += " (" + raw->lastError + ")";
        instances_.erase(instanceId);
        return nullptr;
    }

    // Clip preferences: honour a requested bit depth when the host supports it.
    PropertySet outArgs;
    for (const auto& c : raw->clips) {
        outArgs.setString("OfxImageClipPropComponents_" + c->name, kOfxImageComponentRGBA);
        outArgs.setString("OfxImageClipPropDepth_" + c->name, depthToOfx(c->depth));
        outArgs.setDouble("OfxImageClipPropPAR_" + c->name, 1.0);
    }
    outArgs.setDouble(kOfxImageEffectPropFrameRate, raw->fps);
    outArgs.setString(kOfxImageClipPropFieldOrder, kOfxImageFieldNone);
    outArgs.setString(kOfxImageEffectPropPreMultiplication, kOfxImagePreMultiplied);
    outArgs.setInt(kOfxImageClipPropContinuousSamples, 0);
    outArgs.setInt(kOfxImageEffectFrameVarying, 0);
    if (callAction(plugin, kOfxImageEffectActionGetClipPreferences, raw->handle(), nullptr, &outArgs) == kOfxStatOK) {
        // Multiple clip depths are not supported: take the output preference for all clips.
        const PixelDepth wanted = depthFromOfx(outArgs.getString(std::string("OfxImageClipPropDepth_") +
                                                                 kOfxImageEffectOutputClipName));
        if (wanted != PixelDepth::None) {
            for (auto& c : raw->clips) c->depth = wanted;
            updateInstanceGeometry(*raw, width, height, fps, renderScale);
        }
    }
    raw->lastUsed = ++useCounter;
    return raw;
}

void Host::destroyInstance(const std::string& instanceId)
{
    auto it = instances_.find(instanceId);
    if (it == instances_.end()) return;
    Effect* inst = it->second.get();
    if (inst->inSequence) endSequence(*inst);
    callAction(*inst->plugin, kOfxActionDestroyInstance, inst->handle(), nullptr, nullptr);
    {
        std::lock_guard<std::mutex> lock(gImagesMutex);
        for (auto git = gLiveImages.begin(); git != gLiveImages.end();) {
            if (git->second == inst) git = gLiveImages.erase(git);
            else ++git;
        }
    }
    instances_.erase(it);
}

void Host::destroyAllInstances()
{
    std::vector<std::string> ids = instanceIds();
    for (const auto& id : ids) destroyInstance(id);
}

std::vector<std::string> Host::instanceIds() const
{
    std::vector<std::string> ids;
    for (const auto& kv : instances_) ids.push_back(kv.first);
    return ids;
}

void Host::trimInstances(size_t maxInstances, const std::string& keepId)
{
    while (instances_.size() > maxInstances) {
        std::string oldest;
        uint64_t oldestUse = UINT64_MAX;
        for (const auto& kv : instances_) {
            if (kv.first == keepId) continue;
            if (kv.second->lastUsed < oldestUse) {
                oldestUse = kv.second->lastUsed;
                oldest = kv.first;
            }
        }
        if (oldest.empty()) break;
        destroyInstance(oldest);
    }
}

// ---- Parameter values -----------------------------------------------------------

static bool parseHexColour(const std::string& s, std::vector<double>& out)
{
    if (s.size() != 7 && s.size() != 9) return false;
    if (s[0] != '#') return false;
    out.clear();
    for (size_t i = 1; i + 1 < s.size() + 1 && i + 2 <= s.size(); i += 2) {
        const std::string hex = s.substr(i, 2);
        char* end = nullptr;
        const long v = std::strtol(hex.c_str(), &end, 16);
        if (!end || *end != '\0') return false;
        out.push_back(static_cast<double>(v) / 255.0);
    }
    return true;
}

static bool jsonToDoubles(const Json& v, int dim, const std::vector<std::string>& labels, std::vector<double>& out)
{
    out.assign(static_cast<size_t>(dim), 0.0);
    if (v.isNumber() || v.isBool()) {
        for (int i = 0; i < dim; ++i) out[static_cast<size_t>(i)] = v.asNumber();
        return dim == 1 || true;
    }
    if (v.isString()) {
        std::vector<double> hex;
        if (parseHexColour(v.asString(), hex)) {
            for (int i = 0; i < dim; ++i)
                out[static_cast<size_t>(i)] = i < static_cast<int>(hex.size()) ? hex[static_cast<size_t>(i)] : 1.0;
            return true;
        }
        const double d = v.asNumber(NAN);
        if (std::isnan(d)) return false;
        for (int i = 0; i < dim; ++i) out[static_cast<size_t>(i)] = d;
        return true;
    }
    if (v.isArray()) {
        if (v.size() < static_cast<size_t>(dim) && !(dim == 4 && v.size() == 3)) return false;
        for (int i = 0; i < dim; ++i) {
            const Json& e = v[static_cast<size_t>(i)];
            out[static_cast<size_t>(i)] = e.isNull() ? (i == 3 ? 1.0 : 0.0) : e.asNumber();
        }
        return true;
    }
    if (v.isObject()) {
        bool any = false;
        for (int i = 0; i < dim; ++i) {
            const std::string key = i < static_cast<int>(labels.size()) ? labels[static_cast<size_t>(i)] : "";
            if (!key.empty() && v.has(key)) {
                out[static_cast<size_t>(i)] = v[key].asNumber();
                any = true;
            } else if (i == 3) {
                out[static_cast<size_t>(i)] = 1.0;
            }
        }
        return any;
    }
    return false;
}

static std::string lower(std::string s)
{
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

static bool setParamFromJson(Param& p, const Json& v, std::string& warning)
{
    const int dim = paramDimension(p.kind);
    const PropertySet& ps = p.props;
    switch (p.kind) {
    case ParamKind::Double:
    case ParamKind::Double2D:
    case ParamKind::Double3D:
    case ParamKind::RGB:
    case ParamKind::RGBA: {
        std::vector<double> vals;
        if (!jsonToDoubles(v, dim, ps.getStrings(kOfxParamPropDimensionLabel), vals)) {
            warning = "invalid value for " + p.name;
            return false;
        }
        const auto mins = ps.getDoubles(kOfxParamPropMin);
        const auto maxs = ps.getDoubles(kOfxParamPropMax);
        for (int i = 0; i < dim; ++i) {
            double& d = vals[static_cast<size_t>(i)];
            if (!std::isfinite(d)) {
                warning = "non-finite value for " + p.name;
                return false;
            }
            if (i < static_cast<int>(mins.size())) d = std::max(d, mins[static_cast<size_t>(i)]);
            if (i < static_cast<int>(maxs.size())) d = std::min(d, maxs[static_cast<size_t>(i)]);
        }
        p.dv = vals;
        return true;
    }
    case ParamKind::Integer:
    case ParamKind::Integer2D:
    case ParamKind::Integer3D: {
        std::vector<double> vals;
        if (!jsonToDoubles(v, dim, ps.getStrings(kOfxParamPropDimensionLabel), vals)) {
            warning = "invalid value for " + p.name;
            return false;
        }
        const auto mins = ps.getInts(kOfxParamPropMin);
        const auto maxs = ps.getInts(kOfxParamPropMax);
        p.iv.assign(static_cast<size_t>(dim), 0);
        for (int i = 0; i < dim; ++i) {
            double d = vals[static_cast<size_t>(i)];
            if (!std::isfinite(d)) d = 0.0;
            long long iv = std::llround(std::max(-2147483648.0, std::min(2147483647.0, d)));
            if (i < static_cast<int>(mins.size())) iv = std::max<long long>(iv, mins[static_cast<size_t>(i)]);
            if (i < static_cast<int>(maxs.size())) iv = std::min<long long>(iv, maxs[static_cast<size_t>(i)]);
            p.iv[static_cast<size_t>(i)] = static_cast<int>(iv);
        }
        return true;
    }
    case ParamKind::Boolean: {
        bool b = false;
        if (v.isBool() || v.isNumber()) b = v.asBool();
        else if (v.isString()) {
            const std::string s = lower(v.asString());
            b = s == "true" || s == "1" || s == "yes" || s == "on";
        } else {
            warning = "invalid value for " + p.name;
            return false;
        }
        p.iv = {b ? 1 : 0};
        return true;
    }
    case ParamKind::Choice: {
        const auto options = ps.getStrings(kOfxParamPropChoiceOption);
        const auto enums = ps.getStrings(kOfxParamPropChoiceEnum);
        int index = -1;
        if (v.isNumber() || v.isBool()) {
            index = v.asInt();
        } else if (v.isString()) {
            const std::string s = lower(v.asString());
            for (size_t i = 0; i < options.size() && index < 0; ++i)
                if (lower(options[i]) == s) index = static_cast<int>(i);
            for (size_t i = 0; i < enums.size() && index < 0; ++i)
                if (lower(enums[i]) == s) index = static_cast<int>(i);
            if (index < 0) {
                const double d = v.asNumber(NAN);
                if (!std::isnan(d)) index = static_cast<int>(d);
            }
        }
        if (index < 0 || (!options.empty() && index >= static_cast<int>(options.size()))) {
            warning = "invalid choice for " + p.name;
            return false;
        }
        p.iv = {index};
        return true;
    }
    case ParamKind::StrChoice: {
        const auto options = ps.getStrings(kOfxParamPropChoiceOption);
        const auto enums = ps.getStrings(kOfxParamPropChoiceEnum);
        if (v.isNumber()) {
            const int idx = v.asInt();
            if (idx >= 0 && idx < static_cast<int>(enums.size())) {
                p.sv = enums[static_cast<size_t>(idx)];
                return true;
            }
            warning = "invalid choice index for " + p.name;
            return false;
        }
        if (!v.isString()) {
            warning = "invalid value for " + p.name;
            return false;
        }
        p.sv = v.asString();
        for (size_t i = 0; i < options.size() && i < enums.size(); ++i) {
            if (lower(options[i]) == lower(p.sv)) {
                p.sv = enums[i];
                break;
            }
        }
        return true;
    }
    case ParamKind::String:
    case ParamKind::Custom: {
        if (v.isString()) p.sv = v.asString();
        else if (v.isNull()) p.sv.clear();
        else p.sv = v.dump();
        return true;
    }
    default:
        warning = std::string("parameter ") + p.name + " (" + paramKindName(p.kind) + ") has no value";
        return false;
    }
}

std::vector<std::string> Host::applyParams(Effect& inst, const Json& values, bool resetOthers,
                                           std::vector<std::string>& warnings)
{
    std::vector<std::string> changed;
    const double s = inst.renderScale > 0 ? inst.renderScale : 1.0;
    if (resetOthers) {
        for (auto& p : inst.params.params) {
            if (values.has(p->name)) continue;
            const auto dv = p->dv;
            const auto iv = p->iv;
            const auto sv = p->sv;
            p->resetToDefault(inst.width / s, inst.height / s);
            if (dv != p->dv || iv != p->iv || sv != p->sv) changed.push_back(p->name);
        }
    }
    if (!values.isObject()) return changed;
    for (const auto& kv : values.asObject()) {
        Param* p = inst.params.find(kv.first);
        if (!p) {
            warnings.push_back("unknown parameter: " + kv.first);
            continue;
        }
        const auto dv = p->dv;
        const auto iv = p->iv;
        const auto sv = p->sv;
        std::string warning;
        if (!setParamFromJson(*p, kv.second, warning)) {
            if (!warning.empty()) warnings.push_back(warning);
            continue;
        }
        if (dv != p->dv || iv != p->iv || sv != p->sv) changed.push_back(p->name);
    }
    return changed;
}

void Host::notifyInstanceChanged(Effect& inst, const std::vector<std::string>& changed, double time)
{
    if (changed.empty()) return;
    PropertySet beginArgs;
    beginArgs.setString(kOfxPropChangeReason, kOfxChangeUserEdited);
    callAction(*inst.plugin, kOfxActionBeginInstanceChanged, inst.handle(), &beginArgs, nullptr);
    for (const auto& name : changed) {
        Param* p = inst.params.find(name);
        if (!p || p->kind == ParamKind::PushButton) continue; // buttons may open dialogs
        PropertySet args;
        args.setString(kOfxPropType, kOfxTypeParameter);
        args.setString(kOfxPropName, name);
        args.setString(kOfxPropChangeReason, kOfxChangeUserEdited);
        args.setDouble(kOfxPropTime, time);
        args.setDoubles(kOfxImageEffectPropRenderScale, {inst.renderScale, inst.renderScale});
        callAction(*inst.plugin, kOfxActionInstanceChanged, inst.handle(), &args, nullptr);
    }
    callAction(*inst.plugin, kOfxActionEndInstanceChanged, inst.handle(), &beginArgs, nullptr);
}

void Host::pressButtons(Effect& inst, const std::vector<std::string>& names, double time,
                        std::vector<std::string>& warnings)
{
    if (names.empty()) return;
    PropertySet beginArgs;
    beginArgs.setString(kOfxPropChangeReason, kOfxChangeUserEdited);
    callAction(*inst.plugin, kOfxActionBeginInstanceChanged, inst.handle(), &beginArgs, nullptr);
    for (const auto& name : names) {
        Param* p = inst.params.find(name);
        if (!p || p->kind != ParamKind::PushButton) {
            warnings.push_back("not a push button: " + name);
            continue;
        }
        PropertySet args;
        args.setString(kOfxPropType, kOfxTypeParameter);
        args.setString(kOfxPropName, name);
        args.setString(kOfxPropChangeReason, kOfxChangeUserEdited);
        args.setDouble(kOfxPropTime, time);
        args.setDoubles(kOfxImageEffectPropRenderScale, {inst.renderScale, inst.renderScale});
        callAction(*inst.plugin, kOfxActionInstanceChanged, inst.handle(), &args, nullptr);
    }
    callAction(*inst.plugin, kOfxActionEndInstanceChanged, inst.handle(), &beginArgs, nullptr);
}

Json Host::paramValuesToJson(const Effect& inst)
{
    Json out = Json::object();
    for (const auto& p : inst.params.params) {
        const int dim = paramDimension(p->kind);
        if (dim == 0) continue;
        if (paramIsDoubleValued(p->kind)) {
            if (dim == 1) out[p->name] = numberOrNull(p->dv.empty() ? 0.0 : p->dv[0]);
            else {
                Json::Array a;
                for (double d : p->dv) a.push_back(numberOrNull(d));
                out[p->name] = Json(std::move(a));
            }
        } else if (p->kind == ParamKind::Boolean) {
            out[p->name] = Json(!p->iv.empty() && p->iv[0] != 0);
        } else if (paramIsIntValued(p->kind)) {
            if (dim == 1) out[p->name] = Json(p->iv.empty() ? 0 : p->iv[0]);
            else {
                Json::Array a;
                for (int i : p->iv) a.push_back(Json(i));
                out[p->name] = Json(std::move(a));
            }
        } else if (paramIsStringValued(p->kind)) {
            out[p->name] = p->sv;
        }
    }
    return out;
}

// ---- Render ---------------------------------------------------------------------

std::vector<double> Host::framesNeeded(Effect& inst, double time)
{
    std::vector<double> out;
    const bool temporal = inst.props.getInt(kOfxImageEffectPropTemporalClipAccess) != 0;
    if (!temporal) return {time};
    PropertySet inArgs;
    inArgs.setDouble(kOfxPropTime, time);
    PropertySet outArgs;
    const std::string propName = std::string("OfxImageClipPropFrameRange_") + kOfxImageEffectSimpleSourceClipName;
    outArgs.setDoubles(propName, {time, time});
    const OfxStatus st = callAction(*inst.plugin, kOfxImageEffectActionGetFramesNeeded, inst.handle(), &inArgs, &outArgs);
    std::vector<double> ranges = outArgs.getDoubles(propName);
    if (st != kOfxStatOK || ranges.size() < 2) ranges = {time, time};
    for (size_t i = 0; i + 1 < ranges.size(); i += 2) {
        double a = ranges[i];
        double b = ranges[i + 1];
        if (!std::isfinite(a) || !std::isfinite(b)) continue;
        if (b < a) std::swap(a, b);
        for (double t = std::ceil(a - 1e-6); t <= b + 1e-6 && out.size() < 64; t += 1.0) out.push_back(t);
    }
    std::sort(out.begin(), out.end());
    out.erase(std::unique(out.begin(), out.end()), out.end());
    if (std::find(out.begin(), out.end(), time) == out.end()) out.push_back(time);
    std::sort(out.begin(), out.end());
    return out;
}

OfxStatus Host::beginSequence(Effect& inst, double first, double last, bool interactive)
{
    if (inst.inSequence) endSequence(inst);
    PropertySet args;
    args.setDoubles(kOfxImageEffectPropFrameRange, {first, last});
    args.setDouble(kOfxImageEffectPropFrameStep, 1.0);
    args.setInt(kOfxPropIsInteractive, interactive ? 1 : 0);
    args.setDoubles(kOfxImageEffectPropRenderScale, {inst.renderScale, inst.renderScale});
    args.setInt(kOfxImageEffectPropSequentialRenderStatus, interactive ? 0 : 1);
    args.setInt(kOfxImageEffectPropInteractiveRenderStatus, interactive ? 1 : 0);
    args.setInt(kOfxImageEffectPropRenderQualityDraft, 0);
    const OfxStatus st = callAction(*inst.plugin, kOfxImageEffectActionBeginSequenceRender, inst.handle(), &args, nullptr);
    inst.inSequence = true;
    return st;
}

OfxStatus Host::endSequence(Effect& inst)
{
    if (!inst.inSequence) return kOfxStatOK;
    PropertySet args;
    args.setDoubles(kOfxImageEffectPropFrameRange, {0.0, 0.0});
    args.setDouble(kOfxImageEffectPropFrameStep, 1.0);
    args.setInt(kOfxPropIsInteractive, 0);
    args.setDoubles(kOfxImageEffectPropRenderScale, {inst.renderScale, inst.renderScale});
    args.setInt(kOfxImageEffectPropSequentialRenderStatus, 1);
    args.setInt(kOfxImageEffectPropInteractiveRenderStatus, 0);
    inst.inSequence = false;
    return callAction(*inst.plugin, kOfxImageEffectActionEndSequenceRender, inst.handle(), &args, nullptr);
}

OfxStatus Host::renderFrame(Effect& inst, RenderContext& ctx, std::string& error)
{
    inst.lastUsed = ++useCounter;
    inst.lastError.clear();
    inst.abortFlag = false;
    PropertySet args;
    args.setDouble(kOfxPropTime, ctx.time);
    args.setString(kOfxImageEffectPropFieldToRender, kOfxImageFieldNone);
    args.setInts(kOfxImageEffectPropRenderWindow, {0, 0, ctx.width, ctx.height});
    args.setDoubles(kOfxImageEffectPropRenderScale, {ctx.renderScale, ctx.renderScale});
    args.setInt(kOfxImageEffectPropSequentialRenderStatus, inst.inSequence ? 1 : 0);
    args.setInt(kOfxImageEffectPropInteractiveRenderStatus, 0);
    args.setInt(kOfxImageEffectPropRenderQualityDraft, 0);
    args.setInt(kOfxImageEffectPropOpenGLEnabled, 0);
    args.setInt(kOfxImageEffectPropMetalEnabled, 0);
    args.setInt(kOfxImageEffectPropOpenCLEnabled, 0);
    args.setInt(kOfxImageEffectPropCudaEnabled, 0);

    inst.render = &ctx;
    const OfxStatus st = callAction(*inst.plugin, kOfxImageEffectActionRender, inst.handle(), &args, nullptr);
    inst.render = nullptr;

    // Release images the plugin forgot to release.
    {
        std::vector<PropertySet*> leaked;
        {
            std::lock_guard<std::mutex> lock(inst.imagesMutex);
            leaked.assign(inst.liveImages.begin(), inst.liveImages.end());
        }
        for (PropertySet* img : leaked) ieClipReleaseImage(img->handle());
    }

    if (st != kOfxStatOK) {
        error = std::string("render action returned ") + statusName(st);
        if (st == kOfxStatReplyDefault) error += " (plugin did not handle render)";
        if (!inst.lastError.empty()) error += ": " + inst.lastError;
    }
    return st;
}

} // namespace avpe
