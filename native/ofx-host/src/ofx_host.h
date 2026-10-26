// Minimal OpenFX image-effect host (CPU only) for AVPE.
// Implemented from the public OpenFX API headers (BSD-3-Clause). No code from
// other OFX hosts was used.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <atomic>
#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

#include "json.h"
#include "ofx_props.h"

#include "ofxCore.h"
#include "ofxImageEffect.h"
#include "ofxParam.h"

namespace avpe {

constexpr const char* kHostVersionString = "0.1.0";
constexpr int kProtocolVersion = 1;

enum class PixelDepth { Byte, Short, Float, None };
const char* depthToOfx(PixelDepth d);
PixelDepth depthFromOfx(const std::string& s);
size_t bytesPerComponent(PixelDepth d);

struct Effect;
struct PluginEntry;

// ---------------------------------------------------------------------------
// Parameters

enum class ParamKind {
    Integer, Double, Boolean, Choice, StrChoice, RGBA, RGB, Double2D, Integer2D,
    Double3D, Integer3D, String, Custom, Bytes, Group, Page, PushButton, Parametric, Unknown
};

ParamKind paramKindFromOfx(const std::string& type);
const char* paramKindName(ParamKind k);
int paramDimension(ParamKind k);
bool paramIsDoubleValued(ParamKind k);
bool paramIsIntValued(ParamKind k);
bool paramIsStringValued(ParamKind k);

struct Param {
    static constexpr uint32_t kMagic = 0x4F465841; // 'OFXA'
    uint32_t magic = kMagic;
    std::string name;
    std::string ofxType;
    ParamKind kind = ParamKind::Unknown;
    PropertySet props;
    int defineOrder = 0;
    // Constant (non-animated) value storage.
    std::vector<double> dv;
    std::vector<int> iv;
    std::string sv;
    Effect* owner = nullptr;

    ~Param() { magic = 0; }
    OfxParamHandle handle() { return reinterpret_cast<OfxParamHandle>(this); }
    static Param* from(OfxParamHandle h)
    {
        auto* p = reinterpret_cast<Param*>(h);
        return (p && p->magic == kMagic) ? p : nullptr;
    }
    void resetToDefault(double projectW, double projectH);
};

struct ParamSet {
    static constexpr uint32_t kMagic = 0x4F465853; // 'OFXS'
    uint32_t magic = kMagic;
    std::vector<std::unique_ptr<Param>> params;
    std::map<std::string, Param*> byName;
    PropertySet props;
    Effect* owner = nullptr;

    ~ParamSet() { magic = 0; }
    OfxParamSetHandle handle() { return reinterpret_cast<OfxParamSetHandle>(this); }
    static ParamSet* from(OfxParamSetHandle h)
    {
        auto* p = reinterpret_cast<ParamSet*>(h);
        return (p && p->magic == kMagic) ? p : nullptr;
    }
    Param* find(const std::string& name) const
    {
        auto it = byName.find(name);
        return it == byName.end() ? nullptr : it->second;
    }
};

// ---------------------------------------------------------------------------
// Clips and images

struct ClipFrame {
    double time = 0.0;
    const void* data = nullptr; // pointer to row y = 0 (bottom row, OFX order)
    long rowBytes = 0;
};

struct Clip {
    static constexpr uint32_t kMagic = 0x4F465843; // 'OFXC'
    uint32_t magic = kMagic;
    std::string name;
    PropertySet props;
    Effect* owner = nullptr;
    PixelDepth depth = PixelDepth::Float;
    bool isOutput = false;
    bool connected = true;

    ~Clip() { magic = 0; }
    OfxImageClipHandle handle() { return reinterpret_cast<OfxImageClipHandle>(this); }
    static Clip* from(OfxImageClipHandle h)
    {
        auto* p = reinterpret_cast<Clip*>(h);
        return (p && p->magic == kMagic) ? p : nullptr;
    }
};

// Frames made available to the plugin during one render action.
struct RenderContext {
    double time = 0.0;
    int width = 0;
    int height = 0;
    double renderScale = 1.0;
    std::vector<ClipFrame> source; // source clip frames (any times)
    ClipFrame output;
    bool nearestFallback = true;
    std::vector<double> requestedTimes; // times the plugin asked for (diagnostics)
    int missingFrameRequests = 0;
};

// ---------------------------------------------------------------------------
// Effects (descriptor, per-context descriptor, instance)

enum class EffectKind { Descriptor, ContextDescriptor, Instance };

struct Effect {
    static constexpr uint32_t kMagic = 0x4F465845; // 'OFXE'
    uint32_t magic = kMagic;
    EffectKind kind = EffectKind::Descriptor;
    PluginEntry* plugin = nullptr;
    std::string context;
    PropertySet props;
    ParamSet params;
    std::vector<std::unique_ptr<Clip>> clips;

    // Instance state.
    std::string instanceId;
    std::atomic<bool> abortFlag{false};
    RenderContext* render = nullptr;
    int width = 0;
    int height = 0;
    double fps = 25.0;
    double renderScale = 1.0;
    bool inSequence = false;
    std::mutex imagesMutex;
    std::set<PropertySet*> liveImages;
    std::string lastError;
    std::string persistentMessage;
    uint64_t lastUsed = 0;

    Effect() { params.owner = this; }
    ~Effect();
    OfxImageEffectHandle handle() { return reinterpret_cast<OfxImageEffectHandle>(this); }
    static Effect* from(const void* h)
    {
        auto* p = reinterpret_cast<Effect*>(const_cast<void*>(h));
        return (p && p->magic == kMagic) ? p : nullptr;
    }
    Clip* findClip(const std::string& name) const;
    Clip* sourceClip() const;
    Clip* outputClip() const;
};

// ---------------------------------------------------------------------------
// Plugin binaries and plugins

struct PluginBinary {
    std::string bundlePath;
    std::string executablePath;
    void* dl = nullptr;
    const void* cfBundle = nullptr; // CFBundleRef (kept alive)
    int (*getNumberOfPlugins)() = nullptr;
    OfxPlugin* (*getPlugin)(int) = nullptr;
    std::string error;
};

struct PluginEntry {
    PluginBinary* binary = nullptr;
    OfxPlugin* ofx = nullptr;
    int index = 0;
    std::string id;
    int versionMajor = 0;
    int versionMinor = 0;
    bool loaded = false;      // kOfxActionLoad succeeded
    bool described = false;   // describe + describeInContext done
    std::string error;
    std::unique_ptr<Effect> descriptor;
    std::map<std::string, std::unique_ptr<Effect>> contextDescriptors;
    std::string preferredContext; // filter or general, empty if unsupported
    std::string unsupportedReason;
};

// ---------------------------------------------------------------------------
// Host

class Host {
public:
    static Host& instance();

    void setIdentity(const std::string& name, const std::string& label);
    const std::string& hostName() const { return hostName_; }
    const std::string& hostLabel() const { return hostLabel_; }

    // Loads a *.ofx.bundle and registers its plugins. Returns the binary (owned
    // by the host) or nullptr with `error` filled.
    PluginBinary* loadBundle(const std::string& bundlePath, std::string& error);
    // Runs load/describe/describeInContext for one plugin (idempotent).
    bool describePlugin(PluginEntry& plugin);
    PluginEntry* findPlugin(const std::string& id);
    std::vector<PluginEntry*> pluginsOfBinary(const PluginBinary* bin);

    Json describeToJson(PluginEntry& plugin);

    // Instances
    Effect* getInstance(const std::string& instanceId);
    Effect* createInstance(PluginEntry& plugin, const std::string& instanceId, int width, int height,
                           double fps, double renderScale, std::string& error);
    void destroyInstance(const std::string& instanceId);
    void destroyAllInstances();
    std::vector<std::string> instanceIds() const;
    void trimInstances(size_t maxInstances, const std::string& keepId);

    // Applies a JSON object of parameter values. Unknown names are reported as warnings.
    // Returns names of changed params.
    std::vector<std::string> applyParams(Effect& inst, const Json& values, bool resetOthers,
                                         std::vector<std::string>& warnings);
    void notifyInstanceChanged(Effect& inst, const std::vector<std::string>& changed, double time);
    // Sends instanceChanged for explicitly requested push buttons (never automatic:
    // some plugins open file dialogs from button presses).
    void pressButtons(Effect& inst, const std::vector<std::string>& names, double time,
                      std::vector<std::string>& warnings);
    Json paramValuesToJson(const Effect& inst);

    void updateInstanceGeometry(Effect& inst, int width, int height, double fps, double renderScale);
    std::vector<double> framesNeeded(Effect& inst, double time);
    OfxStatus beginSequence(Effect& inst, double first, double last, bool interactive);
    OfxStatus endSequence(Effect& inst);
    // Calls the render action. `ctx` must stay valid for the duration of the call.
    OfxStatus renderFrame(Effect& inst, RenderContext& ctx, std::string& error);

    OfxStatus callAction(PluginEntry& plugin, const char* action, const void* handle,
                         PropertySet* inArgs, PropertySet* outArgs);

    // Suites
    const void* fetchSuite(const char* name, int version);
    OfxHost* ofxHost() { return &ofxHost_; }
    PropertySet& hostProps() { return hostProps_; }

    unsigned numThreads() const { return numThreads_; }
    void setNumThreads(unsigned n) { numThreads_ = n ? n : 1; }

    std::atomic<bool> globalAbort{false};
    uint64_t useCounter = 0;

private:
    Host();
    void initHostProps();
    bool describeInContext(PluginEntry& plugin, const std::string& context);

    std::string hostName_ = "org.avpe.ofxhost";
    std::string hostLabel_ = "AVPE OFX Host";
    OfxHost ofxHost_{};
    PropertySet hostProps_;
    std::vector<std::unique_ptr<PluginBinary>> binaries_;
    std::vector<std::unique_ptr<PluginEntry>> plugins_;
    std::map<std::string, std::unique_ptr<Effect>> instances_;
    unsigned numThreads_ = 1;
};

// Crash attribution (implemented in main.cpp): the request id (as JSON text)
// and a short description of the plugin call currently executing.
void setCrashRequest(const std::string& requestIdJson);
void setCrashWhat(const std::string& what);

const char* statusName(OfxStatus st);

} // namespace avpe
