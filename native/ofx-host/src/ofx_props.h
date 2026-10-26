// OFX property sets and the OfxPropertySuiteV1 implementation.
// Written from the public OpenFX API headers (BSD-3-Clause); no third-party host code.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include "ofxCore.h"
#include "ofxProperty.h"

namespace avpe {

enum class PropType : uint8_t { Int, Double, String, Pointer };

struct Property {
    PropType type = PropType::Int;
    std::vector<int> i;
    std::vector<double> d;
    std::vector<std::string> s;
    std::vector<void*> p;

    int dimension() const
    {
        switch (type) {
        case PropType::Int: return static_cast<int>(i.size());
        case PropType::Double: return static_cast<int>(d.size());
        case PropType::String: return static_cast<int>(s.size());
        case PropType::Pointer: return static_cast<int>(p.size());
        }
        return 0;
    }
};

class PropertySet {
public:
    static constexpr uint32_t kMagic = 0x4F465850; // 'OFXP'

    PropertySet() = default;
    PropertySet(const PropertySet& other) = default;
    PropertySet& operator=(const PropertySet& other) = default;
    ~PropertySet() { magic_ = 0; }

    bool valid() const { return magic_ == kMagic; }

    OfxPropertySetHandle handle() { return reinterpret_cast<OfxPropertySetHandle>(this); }
    static PropertySet* from(OfxPropertySetHandle h)
    {
        auto* p = reinterpret_cast<PropertySet*>(h);
        return (p && p->valid()) ? p : nullptr;
    }

    // Host-side convenience setters (replace the whole value list).
    void setInt(const std::string& name, int v) { setInts(name, {v}); }
    void setInts(const std::string& name, std::vector<int> v);
    void setDouble(const std::string& name, double v) { setDoubles(name, {v}); }
    void setDoubles(const std::string& name, std::vector<double> v);
    void setString(const std::string& name, const std::string& v) { setStrings(name, {v}); }
    void setStrings(const std::string& name, std::vector<std::string> v);
    void setPointer(const std::string& name, void* v);

    // Host-side getters with fallbacks.
    int getInt(const std::string& name, int index = 0, int fallback = 0) const;
    double getDouble(const std::string& name, int index = 0, double fallback = 0.0) const;
    std::string getString(const std::string& name, int index = 0, const std::string& fallback = "") const;
    void* getPointer(const std::string& name, int index = 0) const;
    std::vector<std::string> getStrings(const std::string& name) const;
    std::vector<double> getDoubles(const std::string& name) const;
    std::vector<int> getInts(const std::string& name) const;

    bool has(const std::string& name) const { return props_.count(name) != 0; }
    const Property* find(const std::string& name) const;
    Property* find(const std::string& name);
    Property& ensure(const std::string& name, PropType type);
    void erase(const std::string& name) { props_.erase(name); }

    const std::map<std::string, Property>& all() const { return props_; }

    // When true, properties unknown to the set may be created by plugin setters.
    // Host-owned read-only sets (host descriptor, render args) keep this false
    // only where it matters; most sets are permissive for compatibility.
    bool permissive = true;

private:
    uint32_t magic_ = kMagic;
    std::map<std::string, Property> props_;
};

const OfxPropertySuiteV1* propertySuite();

} // namespace avpe
