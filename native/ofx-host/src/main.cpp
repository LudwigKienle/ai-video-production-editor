// avpe-ofx-host: OpenFX host sidecar for the AI Video Production Editor.
// Protocol: see PROTOCOL.md.
// SPDX-License-Identifier: GPL-3.0-or-later
#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/stat.h>
#include <unistd.h>

#include "io.h"
#include "json.h"
#include "ofx_host.h"
#include "pixels.h"
#include "session.h"

namespace avpe {

// ---------------------------------------------------------------------------
// Crash attribution

namespace {
int gProtoFd = 1;
char gCrashId[512] = "null";
char gCrashWhat[1024] = "";

std::string jsonText(const std::string& s)
{
    std::string out;
    jsonEscapeTo(out, s);
    return out;
}

void appendRaw(char* dst, size_t cap, size_t& len, const char* s)
{
    while (*s && len + 1 < cap) dst[len++] = *s++;
    dst[len] = '\0';
}

void crashHandler(int sig)
{
    static char msg[2048];
    size_t len = 0;
    msg[0] = '\0';
    char sigbuf[8];
    int n = sig;
    int pos = 0;
    char tmp[8];
    do {
        tmp[pos++] = static_cast<char>('0' + n % 10);
        n /= 10;
    } while (n && pos < 7);
    for (int i = 0; i < pos; ++i) sigbuf[i] = tmp[pos - 1 - i];
    sigbuf[pos] = '\0';
    appendRaw(msg, sizeof(msg), len, "{\"id\":");
    appendRaw(msg, sizeof(msg), len, gCrashId);
    appendRaw(msg, sizeof(msg), len, ",\"ok\":false,\"fatal\":true,\"crashed\":true,\"signal\":");
    appendRaw(msg, sizeof(msg), len, sigbuf);
    appendRaw(msg, sizeof(msg), len, ",\"error\":\"OFX host crashed (signal ");
    appendRaw(msg, sizeof(msg), len, sigbuf);
    appendRaw(msg, sizeof(msg), len, ")");
    if (gCrashWhat[0]) {
        appendRaw(msg, sizeof(msg), len, " in ");
        appendRaw(msg, sizeof(msg), len, gCrashWhat);
    }
    appendRaw(msg, sizeof(msg), len, "\"}\n");
    (void)!::write(gProtoFd, msg, len);
    (void)!::write(2, msg, len);
    _exit(70);
}

void installCrashHandlers()
{
    struct sigaction sa {};
    sa.sa_handler = crashHandler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_RESETHAND;
    for (int sig : {SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGABRT}) sigaction(sig, &sa, nullptr);
    signal(SIGPIPE, SIG_IGN);
}
} // namespace

void setCrashRequest(const std::string& requestIdJson)
{
    std::snprintf(gCrashId, sizeof(gCrashId), "%s", requestIdJson.size() < sizeof(gCrashId) - 1 ? requestIdJson.c_str() : "null");
}

void setCrashWhat(const std::string& what)
{
    // Stored pre-escaped (without quotes) so the signal handler can splice it in.
    std::string esc = jsonText(what);
    if (esc.size() >= 2) esc = esc.substr(1, esc.size() - 2);
    std::snprintf(gCrashWhat, sizeof(gCrashWhat), "%s", esc.c_str());
}

// ---------------------------------------------------------------------------
// Plugin discovery

static std::string expandHome(const std::string& p)
{
    if (p.size() >= 1 && p[0] == '~') {
        const char* home = std::getenv("HOME");
        if (home) return std::string(home) + p.substr(1);
    }
    return p;
}

static bool isDir(const std::string& p)
{
    struct stat st {};
    return stat(p.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

static bool endsWith(const std::string& s, const std::string& suffix)
{
    return s.size() >= suffix.size() && s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::vector<std::string> defaultPluginDirs()
{
    std::vector<std::string> dirs;
    if (const char* env = std::getenv("OFX_PLUGIN_PATH")) {
        std::string s(env);
        size_t start = 0;
        while (start <= s.size()) {
            const size_t colon = s.find(':', start);
            const std::string part = s.substr(start, colon == std::string::npos ? std::string::npos : colon - start);
            if (!part.empty()) dirs.push_back(expandHome(part));
            if (colon == std::string::npos) break;
            start = colon + 1;
        }
    }
    dirs.push_back("/Library/OFX/Plugins");
    dirs.push_back(expandHome("~/Library/OFX/Plugins"));
    return dirs;
}

static void collectBundles(const std::string& dir, int depth, std::vector<std::string>& out)
{
    DIR* d = opendir(dir.c_str());
    if (!d) return;
    std::vector<std::string> names;
    while (dirent* e = readdir(d)) {
        const std::string name = e->d_name;
        if (name.empty() || name[0] == '.') continue;
        names.push_back(name);
    }
    closedir(d);
    std::sort(names.begin(), names.end());
    for (const auto& name : names) {
        const std::string full = dir + "/" + name;
        if (!isDir(full)) continue;
        if (endsWith(name, ".ofx.bundle")) out.push_back(full);
        else if (depth > 0 && !endsWith(name, ".bundle")) collectBundles(full, depth - 1, out);
    }
}

std::vector<std::string> expandBundlePaths(const std::vector<std::string>& paths)
{
    std::vector<std::string> out;
    for (const auto& raw : paths) {
        std::string p = expandHome(raw);
        while (p.size() > 1 && p.back() == '/') p.pop_back();
        if (!isDir(p)) continue;
        if (endsWith(p, ".bundle")) out.push_back(p);
        else collectBundles(p, 3, out);
    }
    std::vector<std::string> unique;
    for (const auto& p : out) {
        if (std::find(unique.begin(), unique.end(), p) == unique.end()) unique.push_back(p);
    }
    return unique;
}

Json describeBundleInProcess(const std::string& bundlePath)
{
    Host& host = Host::instance();
    Json res = Json::object();
    res["bundlePath"] = bundlePath;
    Json plugins = Json::array();
    std::string error;
    PluginBinary* bin = host.loadBundle(bundlePath, error);
    if (!bin) {
        res["error"] = error;
        res["plugins"] = plugins;
        return res;
    }
    for (PluginEntry* p : host.pluginsOfBinary(bin)) {
        host.describePlugin(*p);
        plugins.push(host.describeToJson(*p));
    }
    res["plugins"] = plugins;
    return res;
}

static std::string lowerCopy(std::string s)
{
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

struct ScanJob {
    std::string bundle;
    ChildProcess child;
    std::string out;
    std::chrono::steady_clock::time_point start;
    bool started = false;
    bool done = false;
    Json result;
    double ms = 0;
};

static Json scanIsolated(const std::vector<std::string>& bundles, int timeoutMs, int parallel)
{
    const std::string exe = executablePath();
    Host& host = Host::instance();
    std::vector<ScanJob> jobs(bundles.size());
    for (size_t i = 0; i < bundles.size(); ++i) jobs[i].bundle = bundles[i];
    size_t nextJob = 0;
    size_t running = 0;
    auto finish = [&](ScanJob& job, const std::string& forcedError) {
        closeFd(job.child.stdoutFd);
        int code = 0;
        if (job.child.pid > 0) code = waitProcess(job.child.pid);
        job.ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - job.start).count();
        job.done = true;
        --running;
        Json res;
        if (forcedError.empty()) {
            const size_t nl = job.out.find('\n');
            const std::string line = job.out.substr(0, nl);
            try {
                if (!line.empty()) res = Json::parse(line);
            } catch (...) {
                res = Json();
            }
        }
        if (!res.isObject()) {
            res = Json::object();
            res["bundlePath"] = job.bundle;
            res["plugins"] = Json::array();
            if (!forcedError.empty()) res["error"] = forcedError;
            else if (code >= 128) res["error"] = "describe process crashed (signal " + std::to_string(code - 128) + ")";
            else res["error"] = "describe process failed (exit code " + std::to_string(code) + ")";
        }
        job.result = res;
    };
    while (true) {
        while (running < static_cast<size_t>(std::max(1, parallel)) && nextJob < jobs.size()) {
            ScanJob& job = jobs[nextJob++];
            job.start = std::chrono::steady_clock::now();
            job.started = true;
            std::string err;
            std::vector<std::string> argv = {exe, "--describe-bundle", job.bundle, "--host-name", host.hostName(),
                                             "--host-label", host.hostLabel()};
            ++running;
            if (!spawnProcess(argv, false, true, false, job.child, err)) {
                finish(job, err);
                continue;
            }
        }
        if (running == 0) break;
        std::vector<struct pollfd> pfds;
        std::vector<ScanJob*> polled;
        for (auto& job : jobs) {
            if (job.started && !job.done && job.child.stdoutFd >= 0) {
                pfds.push_back({job.child.stdoutFd, POLLIN, 0});
                polled.push_back(&job);
            }
        }
        if (!pfds.empty()) ::poll(pfds.data(), static_cast<nfds_t>(pfds.size()), 100);
        for (size_t i = 0; i < pfds.size(); ++i) {
            ScanJob& job = *polled[i];
            if (pfds[i].revents & (POLLIN | POLLHUP | POLLERR)) {
                char buf[65536];
                const ssize_t n = ::read(job.child.stdoutFd, buf, sizeof(buf));
                if (n > 0) {
                    job.out.append(buf, static_cast<size_t>(n));
                    if (job.out.size() > (64u << 20)) {
                        killProcess(job.child.pid);
                        finish(job, "describe output too large");
                    }
                } else if (n == 0 || (n < 0 && errno != EINTR && errno != EAGAIN)) {
                    finish(job, "");
                }
            }
        }
        const auto now = std::chrono::steady_clock::now();
        for (auto& job : jobs) {
            if (job.started && !job.done &&
                std::chrono::duration_cast<std::chrono::milliseconds>(now - job.start).count() > timeoutMs) {
                killProcess(job.child.pid);
                finish(job, "describe timed out after " + std::to_string(timeoutMs) + " ms");
            }
        }
    }
    Json results = Json::array();
    for (auto& job : jobs) {
        job.result["ms"] = job.ms;
        results.push(job.result);
    }
    return results;
}

static std::string bundleCacheKey(const std::string& bundle)
{
    // Executable + Info.plist size/mtime, plus the host version (descriptions depend on host behaviour).
    std::string base = bundle;
    const size_t slash = base.find_last_of('/');
    std::string name = slash == std::string::npos ? base : base.substr(slash + 1);
    if (endsWith(name, ".bundle")) name = name.substr(0, name.size() - 7);
    std::string key = std::string("v") + kHostVersionString;
    for (const std::string& f : {bundle + "/Contents/MacOS/" + name, bundle + "/Contents/Info.plist"}) {
        struct stat st {};
        if (stat(f.c_str(), &st) == 0) {
            key += "|" + std::to_string(static_cast<long long>(st.st_size)) + ":" +
                   std::to_string(static_cast<long long>(st.st_mtimespec.tv_sec)) + "." +
                   std::to_string(static_cast<long long>(st.st_mtimespec.tv_nsec));
        } else {
            key += "|-";
        }
    }
    return key;
}

static Json readJsonFile(const std::string& path)
{
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return Json();
    std::string data;
    char buf[65536];
    size_t n;
    while ((n = std::fread(buf, 1, sizeof(buf), f)) > 0) data.append(buf, n);
    std::fclose(f);
    try {
        return Json::parse(data);
    } catch (...) {
        return Json();
    }
}

static bool writeJsonFileAtomic(const std::string& path, const Json& value)
{
    const std::string tmp = path + ".tmp" + std::to_string(static_cast<int>(getpid()));
    FILE* f = std::fopen(tmp.c_str(), "wb");
    if (!f) return false;
    const std::string data = value.dump();
    const bool ok = std::fwrite(data.data(), 1, data.size(), f) == data.size();
    std::fclose(f);
    if (!ok || std::rename(tmp.c_str(), path.c_str()) != 0) {
        std::remove(tmp.c_str());
        return false;
    }
    return true;
}

Json Session::scan(const Json& request)
{
    std::vector<std::string> paths;
    for (const auto& p : request["paths"].asArray()) {
        if (p.isString() && !p.asString().empty()) paths.push_back(p.asString());
    }
    const bool defaultPaths = paths.empty();
    if (defaultPaths) paths = defaultPluginDirs();
    const bool isolate = request["isolate"].asBool(true);
    const int timeoutMs = std::max(1000, request["timeoutMs"].asInt(scanTimeoutMs));
    const int parallel = std::min(8, std::max(1, request["parallel"].asInt(4)));
    const std::string filter = lowerCopy(request["filter"].asString(""));

    if (defaultPaths && filter.empty()) scannedDefaults = true;
    std::vector<std::string> bundles = expandBundlePaths(paths);
    if (!filter.empty()) {
        std::vector<std::string> filtered;
        for (const auto& b : bundles) {
            if (lowerCopy(b).find(filter) != std::string::npos) filtered.push_back(b);
        }
        bundles.swap(filtered);
    }

    // Optional per-bundle cache: unchanged bundles are not loaded again.
    const std::string cacheFile = expandHome(request["cacheFile"].asString(defaultCacheFile));
    const bool refresh = request["refresh"].asBool(false);
    Json cache = cacheFile.empty() ? Json() : readJsonFile(cacheFile);
    if (!cache.isObject() || !cache["bundles"].isObject()) {
        cache = Json::object();
        cache["bundles"] = Json::object();
    }
    std::map<std::string, Json> resultByBundle;
    std::vector<std::string> toScan;
    for (const auto& b : bundles) {
        const Json& entry = cache["bundles"][b];
        if (!refresh && !cacheFile.empty() && entry.isObject() && entry["key"].asString() == bundleCacheKey(b) &&
            entry["result"].isObject()) {
            Json r = entry["result"];
            r["cached"] = true;
            r["ms"] = 0;
            resultByBundle[b] = r;
        } else {
            toScan.push_back(b);
        }
    }
    Json scanned;
    if (isolate) {
        scanned = scanIsolated(toScan, timeoutMs, parallel);
    } else {
        scanned = Json::array();
        for (const auto& b : toScan) {
            const auto t0 = std::chrono::steady_clock::now();
            Json r = describeBundleInProcess(b);
            r["ms"] = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
            scanned.push(r);
        }
    }
    for (size_t i = 0; i < toScan.size(); ++i) {
        Json r = scanned[i];
        if (!r.isObject()) continue;
        resultByBundle[toScan[i]] = r;
        // Only cache clean results; failures/timeouts are retried next time.
        if (!cacheFile.empty() && !r.has("error")) {
            Json entry = Json::object();
            entry["key"] = bundleCacheKey(toScan[i]);
            Json stored = r;
            stored.obj().erase("ms");
            entry["result"] = stored;
            cache["bundles"][toScan[i]] = entry;
        }
    }
    if (!cacheFile.empty() && !toScan.empty()) {
        cache["hostVersion"] = kHostVersionString;
        if (!writeJsonFileAtomic(cacheFile, cache))
            std::fprintf(stderr, "[avpe-ofx-host] could not write scan cache %s\n", cacheFile.c_str());
    }
    Json results = Json::array();
    for (const auto& b : bundles) {
        auto it = resultByBundle.find(b);
        if (it != resultByBundle.end()) results.push(it->second);
    }

    Json plugins = Json::array();
    Json bundleSummary = Json::array();
    std::map<std::string, std::pair<int, int>> versions;
    for (const auto& r : results.asArray()) {
        const std::string bundlePath = r["bundlePath"].asString();
        Json summary = Json::object();
        summary["path"] = bundlePath;
        summary["ok"] = !r.has("error");
        if (r.has("error")) summary["error"] = r["error"];
        summary["pluginCount"] = static_cast<int>(r["plugins"].size());
        summary["ms"] = r["ms"];
        summary["cached"] = r["cached"].asBool(false);
        bundleSummary.push(summary);
        for (const auto& p : r["plugins"].asArray()) {
            plugins.push(p);
            const std::string id = p["id"].asString();
            const int maj = p["version"][0].asInt();
            const int min = p["version"][1].asInt();
            auto it = versions.find(id);
            if (it == versions.end() || maj > it->second.first || (maj == it->second.first && min > it->second.second)) {
                versions[id] = {maj, min};
                if (p["loaded"].asBool()) knownBundles[id] = bundlePath;
            }
        }
    }
    Json out = Json::object();
    out["plugins"] = plugins;
    out["bundles"] = bundleSummary;
    out["searchPaths"] = Json(Json::Array{});
    for (const auto& p : paths) out["searchPaths"].push(Json(expandHome(p)));
    out["isolated"] = isolate;
    return out;
}

PluginEntry* Session::resolvePlugin(const std::string& id, const std::string& bundleHint, std::string& error)
{
    Host& host = Host::instance();
    if (PluginEntry* p = host.findPlugin(id)) return p;
    std::vector<std::string> candidates;
    if (!bundleHint.empty()) candidates.push_back(expandHome(bundleHint));
    auto it = knownBundles.find(id);
    if (it != knownBundles.end()) candidates.push_back(it->second);
    for (const auto& c : candidates) {
        std::string err;
        if (host.loadBundle(c, err)) {
            if (PluginEntry* p = host.findPlugin(id)) return p;
        } else if (!err.empty()) {
            error = c + ": " + err;
        }
    }
    // Last resort (once per process): isolated scan of the default folders to locate the id.
    if (!scannedDefaults) {
        scannedDefaults = true;
        Json req = Json::object();
        scan(req);
    }
    it = knownBundles.find(id);
    if (it != knownBundles.end()) {
        std::string err;
        if (host.loadBundle(it->second, err)) {
            if (PluginEntry* p = host.findPlugin(id)) return p;
        }
        if (!err.empty()) error = it->second + ": " + err;
    }
    if (error.empty()) error = "plugin not found: " + id;
    return nullptr;
}

Effect* Session::ensureInstance(const std::string& pluginId, const std::string& instanceId, const std::string& bundleHint,
                                int width, int height, double fps, double renderScale, bool& created, std::string& error)
{
    Host& host = Host::instance();
    created = false;
    Effect* inst = host.getInstance(instanceId);
    if (inst && inst->plugin->id != pluginId) {
        host.destroyInstance(instanceId);
        inst = nullptr;
    }
    if (!inst) {
        PluginEntry* plugin = resolvePlugin(pluginId, bundleHint, error);
        if (!plugin) return nullptr;
        inst = host.createInstance(*plugin, instanceId, width, height, fps, renderScale, error);
        if (!inst) return nullptr;
        created = true;
        host.trimInstances(16, instanceId);
    } else if (inst->width != width || inst->height != height || inst->fps != fps || inst->renderScale != renderScale) {
        host.updateInstanceGeometry(*inst, width, height, fps, renderScale);
    }
    return inst;
}

// ---------------------------------------------------------------------------
// Commands

static Json makeReply(const Json& id, bool ok)
{
    Json r = Json::object();
    r["id"] = id;
    r["ok"] = ok;
    return r;
}

static Json makeError(const Json& id, const std::string& message)
{
    Json r = makeReply(id, false);
    r["error"] = message;
    return r;
}

static Json stringsJson(const std::vector<std::string>& v)
{
    Json a = Json::array();
    for (const auto& s : v) a.push(Json(s));
    return a;
}

static void handleRender(Session& session, const Json& req, std::vector<uint8_t>& payload, const Json& id)
{
    Host& host = Host::instance();
    Channel& ch = *session.channel;
    const std::string pluginId = req["pluginId"].asString("");
    if (pluginId.empty()) {
        ch.send(makeError(id, "render: pluginId is required"));
        return;
    }
    const std::string instanceId = req["instanceId"].asString(pluginId);
    const int width = req["width"].asInt(0);
    const int height = req["height"].asInt(0);
    if (width <= 0 || height <= 0 || width > 32768 || height > 32768) {
        ch.send(makeError(id, "render: invalid width/height"));
        return;
    }
    WireFormat inFmt;
    if (!parseWireFormat(req["format"].asString("rgba32f"), inFmt)) {
        ch.send(makeError(id, "render: unknown format (use rgba32f, rgba16 or rgba8)"));
        return;
    }
    WireFormat outFmt = inFmt;
    if (req.has("outputFormat") && !parseWireFormat(req["outputFormat"].asString(""), outFmt)) {
        ch.send(makeError(id, "render: unknown outputFormat"));
        return;
    }
    const double time = req["time"].asNumber(0.0);
    double renderScale = req["renderScale"].asNumber(1.0);
    if (!(renderScale > 0.0 && renderScale <= 16.0)) renderScale = 1.0;
    double fps = req["fps"].asNumber(25.0);
    if (!(fps > 0.0 && fps < 1000.0)) fps = 25.0;

    std::vector<double> frameTimes = {time};
    for (const auto& f : req["frames"].asArray()) {
        frameTimes.push_back(f.isNumber() ? f.asNumber() : f["time"].asNumber(time));
    }
    const size_t frameBytes = static_cast<size_t>(width) * static_cast<size_t>(height) * wireBytesPerPixel(inFmt);
    if (payload.size() != frameBytes * frameTimes.size()) {
        ch.send(makeError(id, "render: binary payload has " + std::to_string(payload.size()) + " bytes, expected " +
                                  std::to_string(frameBytes * frameTimes.size()) + " (" +
                                  std::to_string(frameTimes.size()) + " frame(s) of " + std::to_string(width) + "x" +
                                  std::to_string(height) + " " + wireFormatName(inFmt) + ")"));
        return;
    }

    const auto t0 = std::chrono::steady_clock::now();
    bool created = false;
    std::string error;
    Effect* inst = session.ensureInstance(pluginId, instanceId, req["bundlePath"].asString(""), width, height, fps,
                                          renderScale, created, error);
    if (!inst) {
        ch.send(makeError(id, error));
        return;
    }
    std::vector<std::string> warnings;
    const std::vector<std::string> changed =
        host.applyParams(*inst, req["params"], req["resetParams"].asBool(false), warnings);
    if (req["notifyChanges"].asBool(true)) host.notifyInstanceChanged(*inst, changed, time);
    {
        std::vector<std::string> buttons;
        for (const auto& b : req["pressButtons"].asArray())
            if (b.isString()) buttons.push_back(b.asString());
        host.pressButtons(*inst, buttons, time, warnings);
    }

    Clip* src = inst->sourceClip();
    Clip* dst = inst->outputClip();
    if (!src || !dst) {
        ch.send(makeError(id, "plugin has no Source/Output clip"));
        return;
    }
    const PixelDepth depth = dst->depth;
    const size_t ofxRow = static_cast<size_t>(width) * 4 * bytesPerComponent(depth);
    const size_t ofxFrame = ofxRow * static_cast<size_t>(height);
    std::vector<uint8_t> sourceBuf;
    std::vector<uint8_t> outBuf;
    try {
        sourceBuf.resize(ofxFrame * frameTimes.size());
        outBuf.assign(ofxFrame, 0);
    } catch (...) {
        ch.send(makeError(id, "out of memory"));
        return;
    }
    RenderContext ctx;
    ctx.time = time;
    ctx.width = width;
    ctx.height = height;
    ctx.renderScale = renderScale;
    ctx.nearestFallback = req["temporalFallback"].asString("nearest") != "none";
    for (size_t i = 0; i < frameTimes.size(); ++i) {
        wireToOfx(payload.data() + i * frameBytes, inFmt, width, height, src->depth, sourceBuf.data() + i * ofxFrame, ofxRow);
        ctx.source.push_back(ClipFrame{frameTimes[i], sourceBuf.data() + i * ofxFrame, static_cast<long>(ofxRow)});
    }
    payload.clear();
    payload.shrink_to_fit();
    ctx.output = ClipFrame{time, outBuf.data(), static_cast<long>(ofxRow)};

    const std::vector<double> needed = host.framesNeeded(*inst, time);
    const bool ownSequence = !inst->inSequence;
    if (ownSequence) host.beginSequence(*inst, time, time, true);
    const auto tr = std::chrono::steady_clock::now();
    const OfxStatus st = host.renderFrame(*inst, ctx, error);
    const double renderMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - tr).count();
    if (ownSequence) host.endSequence(*inst);
    if (st != kOfxStatOK) {
        Json r = makeError(id, error);
        r["warnings"] = stringsJson(warnings);
        r["instanceId"] = instanceId;
        ch.send(r);
        return;
    }

    std::vector<uint8_t> wire;
    try {
        wire.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * wireBytesPerPixel(outFmt));
    } catch (...) {
        ch.send(makeError(id, "out of memory"));
        return;
    }
    uint64_t nonFinite = 0;
    ofxToWire(outBuf.data(), ofxRow, depth, width, height, outFmt, wire.data(), &nonFinite);

    Json r = makeReply(id, true);
    r["width"] = width;
    r["height"] = height;
    r["format"] = wireFormatName(outFmt);
    r["instanceId"] = instanceId;
    r["created"] = created;
    r["pixelDepth"] = depthToOfx(depth);
    r["renderMs"] = renderMs;
    r["totalMs"] = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    r["nonFinite"] = static_cast<double>(nonFinite);
    r["changedParams"] = stringsJson(changed);
    r["warnings"] = stringsJson(warnings);
    Json neededJson = Json::array();
    for (double t : needed) neededJson.push(Json(t));
    r["framesNeeded"] = neededJson;
    Json requested = Json::array();
    for (double t : ctx.requestedTimes) requested.push(Json(t));
    r["framesRequested"] = requested;
    r["missingFrameRequests"] = ctx.missingFrameRequests;
    if (!inst->persistentMessage.empty()) r["pluginMessage"] = inst->persistentMessage;
    ch.send(r, wire.data(), wire.size());
}

static void handleCommand(Session& session, const Json& req, std::vector<uint8_t>& payload, bool& quit)
{
    Host& host = Host::instance();
    Channel& ch = *session.channel;
    const Json id = req["id"];
    setCrashRequest(id.dump());
    if (req.has("__parseError")) {
        ch.send(makeError(id, req["__parseError"].asString()));
        return;
    }
    const std::string cmd = req["cmd"].asString("");
    try {
        if (cmd == "hello" || cmd == "status" || cmd == "ping") {
            Json r = makeReply(id, true);
            r["version"] = kHostVersionString;
            r["protocol"] = kProtocolVersion;
            r["hostName"] = host.hostName();
            r["hostLabel"] = host.hostLabel();
            r["pid"] = static_cast<int>(getpid());
            r["threads"] = host.numThreads();
            r["instances"] = stringsJson(host.instanceIds());
            Json known = Json::object();
            for (const auto& kv : session.knownBundles) known[kv.first] = kv.second;
            r["knownPlugins"] = known;
            ch.send(r);
        } else if (cmd == "scan") {
            Json r = session.scan(req);
            r["id"] = id;
            r["ok"] = true;
            ch.send(r);
        } else if (cmd == "describe") {
            std::string error;
            PluginEntry* p = session.resolvePlugin(req["pluginId"].asString(""), req["bundlePath"].asString(""), error);
            if (!p) {
                ch.send(makeError(id, error));
                return;
            }
            host.describePlugin(*p);
            Json r = makeReply(id, true);
            r["plugin"] = host.describeToJson(*p);
            ch.send(r);
        } else if (cmd == "render") {
            handleRender(session, req, payload, id);
        } else if (cmd == "framesNeeded") {
            const std::string pluginId = req["pluginId"].asString("");
            const std::string instanceId = req["instanceId"].asString(pluginId);
            bool created = false;
            std::string error;
            Effect* inst = session.ensureInstance(pluginId, instanceId, req["bundlePath"].asString(""),
                                                  std::max(1, req["width"].asInt(1920)), std::max(1, req["height"].asInt(1080)),
                                                  req["fps"].asNumber(25.0), req["renderScale"].asNumber(1.0), created, error);
            if (!inst) {
                ch.send(makeError(id, error));
                return;
            }
            std::vector<std::string> warnings;
            const auto changed = host.applyParams(*inst, req["params"], req["resetParams"].asBool(false), warnings);
            if (req["notifyChanges"].asBool(true)) host.notifyInstanceChanged(*inst, changed, req["time"].asNumber(0.0));
            Json r = makeReply(id, true);
            Json times = Json::array();
            for (double t : host.framesNeeded(*inst, req["time"].asNumber(0.0))) times.push(Json(t));
            r["frames"] = times;
            r["temporalClipAccess"] = inst->props.getInt(kOfxImageEffectPropTemporalClipAccess) != 0;
            r["warnings"] = stringsJson(warnings);
            ch.send(r);
        } else if (cmd == "getParams") {
            Effect* inst = host.getInstance(req["instanceId"].asString(""));
            if (!inst) {
                ch.send(makeError(id, "unknown instance"));
                return;
            }
            Json r = makeReply(id, true);
            r["pluginId"] = inst->plugin->id;
            r["params"] = host.paramValuesToJson(*inst);
            ch.send(r);
        } else if (cmd == "destroyInstance") {
            host.destroyInstance(req["instanceId"].asString(""));
            ch.send(makeReply(id, true));
        } else if (cmd == "destroyAll") {
            host.destroyAllInstances();
            ch.send(makeReply(id, true));
        } else if (cmd == "bake") {
            Json r = runBake(session, req, id);
            r["id"] = id;
            ch.send(r);
        } else if (cmd == "cancel") {
            ch.send(makeError(id, "nothing to cancel"));
        } else if (cmd == "shutdown" || cmd == "quit") {
            host.destroyAllInstances();
            ch.send(makeReply(id, true));
            quit = true;
        } else {
            ch.send(makeError(id, "unknown command: " + cmd));
        }
    } catch (const std::bad_alloc&) {
        ch.send(makeError(id, "out of memory"));
    } catch (const std::exception& ex) {
        ch.send(makeError(id, std::string("internal error: ") + ex.what()));
    }
    setCrashRequest("null");
}

} // namespace avpe

using namespace avpe;

static void usage()
{
    std::fprintf(stderr,
                 "avpe-ofx-host %s - OpenFX host sidecar\n"
                 "usage:\n"
                 "  avpe-ofx-host [--host-name N] [--host-label L] [--threads N] [--scan-cache FILE]\n"
                 "                                                                  serve protocol on stdin/stdout\n"
                 "  avpe-ofx-host --scan [dir|bundle ...]                           print scan JSON and exit\n"
                 "  avpe-ofx-host --describe-bundle <bundle>                        describe one bundle (internal)\n"
                 "  avpe-ofx-host --version\n",
                 kHostVersionString);
}

int main(int argc, char** argv)
{
    // Reserve the real stdout for the protocol; anything plugins print goes to stderr.
    const int protoFd = dup(1);
    if (protoFd < 0) return 2;
    fcntl(protoFd, F_SETFD, FD_CLOEXEC);
    dup2(2, 1);
    avpe::gProtoFd = protoFd;
    avpe::Channel channel(0, protoFd);

    std::string describeBundle;
    bool scanMode = false;
    std::vector<std::string> scanPaths;
    std::string hostName;
    std::string hostLabel;
    std::string scanCache;
    if (const char* env = std::getenv("AVPE_OFX_SCAN_CACHE")) scanCache = env;
    if (const char* env = std::getenv("AVPE_OFX_HOST_NAME")) hostName = env;
    if (const char* env = std::getenv("AVPE_OFX_HOST_LABEL")) hostLabel = env;
    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        if (a == "--describe-bundle" && i + 1 < argc) describeBundle = argv[++i];
        else if (a == "--host-name" && i + 1 < argc) hostName = argv[++i];
        else if (a == "--host-label" && i + 1 < argc) hostLabel = argv[++i];
        else if (a == "--threads" && i + 1 < argc) Host::instance().setNumThreads(static_cast<unsigned>(std::max(1, std::atoi(argv[++i]))));
        else if (a == "--scan") scanMode = true;
        else if (a == "--scan-cache" && i + 1 < argc) scanCache = argv[++i];
        else if (a == "--version") {
            std::string v = std::string(kHostVersionString) + "\n";
            writeAll(protoFd, v.data(), v.size());
            return 0;
        } else if (a == "--help" || a == "-h") {
            usage();
            return 0;
        } else if (scanMode) {
            scanPaths.push_back(a);
        } else {
            std::fprintf(stderr, "unknown argument: %s\n", a.c_str());
            usage();
            return 2;
        }
    }
    Host::instance().setIdentity(hostName, hostLabel);
    installCrashHandlers();

    Session session;
    session.channel = &channel;
    session.defaultCacheFile = scanCache;

    if (!describeBundle.empty()) {
        Json res = describeBundleInProcess(describeBundle);
        std::string line = res.dump() + "\n";
        writeAll(protoFd, line.data(), line.size());
        _exit(0); // skip plugin unload/static destructors
    }
    if (scanMode) {
        Json req = Json::object();
        Json paths = Json::array();
        for (const auto& p : scanPaths) paths.push(Json(p));
        req["paths"] = paths;
        Json res = session.scan(req);
        std::string line = res.dump() + "\n";
        writeAll(protoFd, line.data(), line.size());
        _exit(0);
    }

    Json ready = Json::object();
    ready["event"] = "ready";
    ready["id"] = Json();
    ready["version"] = kHostVersionString;
    ready["protocol"] = kProtocolVersion;
    ready["pid"] = static_cast<int>(getpid());
    ready["hostName"] = Host::instance().hostName();
    channel.send(ready);

    bool quit = false;
    while (!quit) {
        Json header;
        std::vector<uint8_t> payload;
        std::string error;
        if (!channel.read(header, payload, error)) {
            if (!error.empty()) {
                Json r = Json::object();
                r["id"] = Json();
                r["ok"] = false;
                r["fatal"] = true;
                r["error"] = "protocol error: " + error;
                channel.send(r);
            }
            break;
        }
        if (header.isObject() && header.size() == 0) continue;
        handleCommand(session, header, payload, quit);
    }
    Host::instance().destroyAllInstances();
    _exit(0);
}
