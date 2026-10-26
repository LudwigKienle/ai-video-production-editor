// Command handling shared by the protocol loop and the bake pipeline.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <map>
#include <string>
#include <vector>

#include "io.h"
#include "json.h"
#include "ofx_host.h"

namespace avpe {

struct Session {
    Channel* channel = nullptr;
    std::map<std::string, std::string> knownBundles; // plugin id -> bundle path (from scans)
    int scanTimeoutMs = 60000;
    bool scannedDefaults = false;
    std::string defaultCacheFile; // --scan-cache / AVPE_OFX_SCAN_CACHE

    // Locates (and loads in-process) a plugin by id. Uses `bundleHint`, then scan
    // results, then an isolated scan of the default plugin folders.
    PluginEntry* resolvePlugin(const std::string& id, const std::string& bundleHint, std::string& error);

    // Gets or creates the instance for a render/bake stage.
    Effect* ensureInstance(const std::string& pluginId, const std::string& instanceId, const std::string& bundleHint,
                           int width, int height, double fps, double renderScale, bool& created, std::string& error);

    Json scan(const Json& request);
};

std::vector<std::string> defaultPluginDirs();
std::vector<std::string> expandBundlePaths(const std::vector<std::string>& paths);
Json describeBundleInProcess(const std::string& bundlePath);

// Implemented in bake.cpp
Json runBake(Session& session, const Json& request, const Json& requestId);

} // namespace avpe
