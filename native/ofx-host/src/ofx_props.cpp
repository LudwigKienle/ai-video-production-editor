// SPDX-License-Identifier: GPL-3.0-or-later
#include "ofx_props.h"

#include <cmath>
#include <cstring>

namespace avpe {

void PropertySet::setInts(const std::string& name, std::vector<int> v)
{
    Property& p = props_[name];
    p = Property{};
    p.type = PropType::Int;
    p.i = std::move(v);
}

void PropertySet::setDoubles(const std::string& name, std::vector<double> v)
{
    Property& p = props_[name];
    p = Property{};
    p.type = PropType::Double;
    p.d = std::move(v);
}

void PropertySet::setStrings(const std::string& name, std::vector<std::string> v)
{
    Property& p = props_[name];
    p = Property{};
    p.type = PropType::String;
    p.s = std::move(v);
}

void PropertySet::setPointer(const std::string& name, void* v)
{
    Property& p = props_[name];
    p = Property{};
    p.type = PropType::Pointer;
    p.p = {v};
}

const Property* PropertySet::find(const std::string& name) const
{
    auto it = props_.find(name);
    return it == props_.end() ? nullptr : &it->second;
}

Property* PropertySet::find(const std::string& name)
{
    auto it = props_.find(name);
    return it == props_.end() ? nullptr : &it->second;
}

Property& PropertySet::ensure(const std::string& name, PropType type)
{
    auto it = props_.find(name);
    if (it != props_.end()) return it->second;
    Property& p = props_[name];
    p.type = type;
    return p;
}

int PropertySet::getInt(const std::string& name, int index, int fallback) const
{
    const Property* p = find(name);
    if (!p || index < 0) return fallback;
    if (p->type == PropType::Int && index < static_cast<int>(p->i.size())) return p->i[index];
    if (p->type == PropType::Double && index < static_cast<int>(p->d.size()))
        return static_cast<int>(std::lround(p->d[index]));
    return fallback;
}

double PropertySet::getDouble(const std::string& name, int index, double fallback) const
{
    const Property* p = find(name);
    if (!p || index < 0) return fallback;
    if (p->type == PropType::Double && index < static_cast<int>(p->d.size())) return p->d[index];
    if (p->type == PropType::Int && index < static_cast<int>(p->i.size())) return p->i[index];
    return fallback;
}

std::string PropertySet::getString(const std::string& name, int index, const std::string& fallback) const
{
    const Property* p = find(name);
    if (!p || index < 0 || p->type != PropType::String || index >= static_cast<int>(p->s.size()))
        return fallback;
    return p->s[index];
}

void* PropertySet::getPointer(const std::string& name, int index) const
{
    const Property* p = find(name);
    if (!p || index < 0 || p->type != PropType::Pointer || index >= static_cast<int>(p->p.size()))
        return nullptr;
    return p->p[index];
}

std::vector<std::string> PropertySet::getStrings(const std::string& name) const
{
    const Property* p = find(name);
    if (!p || p->type != PropType::String) return {};
    return p->s;
}

std::vector<double> PropertySet::getDoubles(const std::string& name) const
{
    const Property* p = find(name);
    if (!p) return {};
    if (p->type == PropType::Double) return p->d;
    if (p->type == PropType::Int) return std::vector<double>(p->i.begin(), p->i.end());
    return {};
}

std::vector<int> PropertySet::getInts(const std::string& name) const
{
    const Property* p = find(name);
    if (!p) return {};
    if (p->type == PropType::Int) return p->i;
    if (p->type == PropType::Double) {
        std::vector<int> out;
        for (double v : p->d) out.push_back(static_cast<int>(std::lround(v)));
        return out;
    }
    return {};
}

namespace {

constexpr int kMaxPropIndex = 1 << 20;

// ---- setters --------------------------------------------------------------

template <typename T>
void assignAt(std::vector<T>& vec, int index, const T& value)
{
    if (index >= static_cast<int>(vec.size())) vec.resize(static_cast<size_t>(index) + 1);
    vec[static_cast<size_t>(index)] = value;
}

OfxStatus setPrologue(OfxPropertySetHandle h, const char* name, int index, PropertySet*& set)
{
    set = PropertySet::from(h);
    if (!set) return kOfxStatErrBadHandle;
    if (!name) return kOfxStatErrUnknown;
    if (index < 0 || index > kMaxPropIndex) return kOfxStatErrBadIndex;
    return kOfxStatOK;
}

OfxStatus propSetPointer(OfxPropertySetHandle h, const char* name, int index, void* value)
{
    PropertySet* set = nullptr;
    if (OfxStatus st = setPrologue(h, name, index, set); st != kOfxStatOK) return st;
    if (!set->permissive && !set->has(name)) return kOfxStatErrUnknown;
    Property& p = set->ensure(name, PropType::Pointer);
    if (p.type != PropType::Pointer) return kOfxStatErrValue;
    assignAt(p.p, index, value);
    return kOfxStatOK;
}

OfxStatus propSetString(OfxPropertySetHandle h, const char* name, int index, const char* value)
{
    PropertySet* set = nullptr;
    if (OfxStatus st = setPrologue(h, name, index, set); st != kOfxStatOK) return st;
    if (!set->permissive && !set->has(name)) return kOfxStatErrUnknown;
    Property& p = set->ensure(name, PropType::String);
    if (p.type != PropType::String) return kOfxStatErrValue;
    assignAt(p.s, index, std::string(value ? value : ""));
    return kOfxStatOK;
}

OfxStatus propSetDouble(OfxPropertySetHandle h, const char* name, int index, double value)
{
    PropertySet* set = nullptr;
    if (OfxStatus st = setPrologue(h, name, index, set); st != kOfxStatOK) return st;
    if (!set->permissive && !set->has(name)) return kOfxStatErrUnknown;
    Property& p = set->ensure(name, PropType::Double);
    if (p.type == PropType::Int) {
        assignAt(p.i, index, static_cast<int>(std::lround(value)));
        return kOfxStatOK;
    }
    if (p.type != PropType::Double) return kOfxStatErrValue;
    assignAt(p.d, index, value);
    return kOfxStatOK;
}

OfxStatus propSetInt(OfxPropertySetHandle h, const char* name, int index, int value)
{
    PropertySet* set = nullptr;
    if (OfxStatus st = setPrologue(h, name, index, set); st != kOfxStatOK) return st;
    if (!set->permissive && !set->has(name)) return kOfxStatErrUnknown;
    Property& p = set->ensure(name, PropType::Int);
    if (p.type == PropType::Double) {
        assignAt(p.d, index, static_cast<double>(value));
        return kOfxStatOK;
    }
    if (p.type != PropType::Int) return kOfxStatErrValue;
    assignAt(p.i, index, value);
    return kOfxStatOK;
}

void truncateTo(OfxPropertySetHandle h, const char* name, int count)
{
    PropertySet* set = PropertySet::from(h);
    if (!set || !name) return;
    Property* p = set->find(name);
    if (!p || count <= 0) return;
    const size_t n = static_cast<size_t>(count);
    if (p->i.size() > n) p->i.resize(n);
    if (p->d.size() > n) p->d.resize(n);
    if (p->s.size() > n) p->s.resize(n);
    if (p->p.size() > n) p->p.resize(n);
}

OfxStatus propSetPointerN(OfxPropertySetHandle h, const char* name, int count, void* const* value)
{
    if (count < 0 || (count > 0 && !value)) return kOfxStatErrValue;
    for (int i = count - 1; i >= 0; --i) {
        if (OfxStatus st = propSetPointer(h, name, i, value[i]); st != kOfxStatOK) return st;
    }
    truncateTo(h, name, count);
    return kOfxStatOK;
}

OfxStatus propSetStringN(OfxPropertySetHandle h, const char* name, int count, const char* const* value)
{
    if (count < 0 || (count > 0 && !value)) return kOfxStatErrValue;
    for (int i = count - 1; i >= 0; --i) {
        if (OfxStatus st = propSetString(h, name, i, value[i]); st != kOfxStatOK) return st;
    }
    truncateTo(h, name, count);
    return kOfxStatOK;
}

OfxStatus propSetDoubleN(OfxPropertySetHandle h, const char* name, int count, const double* value)
{
    if (count < 0 || (count > 0 && !value)) return kOfxStatErrValue;
    for (int i = count - 1; i >= 0; --i) {
        if (OfxStatus st = propSetDouble(h, name, i, value[i]); st != kOfxStatOK) return st;
    }
    truncateTo(h, name, count);
    return kOfxStatOK;
}

OfxStatus propSetIntN(OfxPropertySetHandle h, const char* name, int count, const int* value)
{
    if (count < 0 || (count > 0 && !value)) return kOfxStatErrValue;
    for (int i = count - 1; i >= 0; --i) {
        if (OfxStatus st = propSetInt(h, name, i, value[i]); st != kOfxStatOK) return st;
    }
    truncateTo(h, name, count);
    return kOfxStatOK;
}

// ---- getters --------------------------------------------------------------

OfxStatus getPrologue(OfxPropertySetHandle h, const char* name, int index, const Property*& prop)
{
    PropertySet* set = PropertySet::from(h);
    if (!set) return kOfxStatErrBadHandle;
    if (!name) return kOfxStatErrUnknown;
    prop = set->find(name);
    if (!prop) return kOfxStatErrUnknown;
    if (index < 0 || index >= prop->dimension()) return kOfxStatErrBadIndex;
    return kOfxStatOK;
}

OfxStatus propGetPointer(OfxPropertySetHandle h, const char* name, int index, void** value)
{
    if (!value) return kOfxStatErrValue;
    const Property* p = nullptr;
    if (OfxStatus st = getPrologue(h, name, index, p); st != kOfxStatOK) return st;
    if (p->type != PropType::Pointer) return kOfxStatErrValue;
    *value = p->p[static_cast<size_t>(index)];
    return kOfxStatOK;
}

OfxStatus propGetString(OfxPropertySetHandle h, const char* name, int index, char** value)
{
    if (!value) return kOfxStatErrValue;
    const Property* p = nullptr;
    if (OfxStatus st = getPrologue(h, name, index, p); st != kOfxStatOK) return st;
    if (p->type != PropType::String) return kOfxStatErrValue;
    *value = const_cast<char*>(p->s[static_cast<size_t>(index)].c_str());
    return kOfxStatOK;
}

OfxStatus propGetDouble(OfxPropertySetHandle h, const char* name, int index, double* value)
{
    if (!value) return kOfxStatErrValue;
    const Property* p = nullptr;
    if (OfxStatus st = getPrologue(h, name, index, p); st != kOfxStatOK) return st;
    if (p->type == PropType::Double) {
        *value = p->d[static_cast<size_t>(index)];
        return kOfxStatOK;
    }
    if (p->type == PropType::Int) {
        *value = p->i[static_cast<size_t>(index)];
        return kOfxStatOK;
    }
    return kOfxStatErrValue;
}

OfxStatus propGetInt(OfxPropertySetHandle h, const char* name, int index, int* value)
{
    if (!value) return kOfxStatErrValue;
    const Property* p = nullptr;
    if (OfxStatus st = getPrologue(h, name, index, p); st != kOfxStatOK) return st;
    if (p->type == PropType::Int) {
        *value = p->i[static_cast<size_t>(index)];
        return kOfxStatOK;
    }
    if (p->type == PropType::Double) {
        *value = static_cast<int>(std::lround(p->d[static_cast<size_t>(index)]));
        return kOfxStatOK;
    }
    return kOfxStatErrValue;
}

OfxStatus propGetPointerN(OfxPropertySetHandle h, const char* name, int count, void** value)
{
    if (count < 0 || (count > 0 && !value)) return kOfxStatErrValue;
    for (int i = 0; i < count; ++i) {
        if (OfxStatus st = propGetPointer(h, name, i, &value[i]); st != kOfxStatOK) return st;
    }
    return kOfxStatOK;
}

OfxStatus propGetStringN(OfxPropertySetHandle h, const char* name, int count, char** value)
{
    if (count < 0 || (count > 0 && !value)) return kOfxStatErrValue;
    for (int i = 0; i < count; ++i) {
        if (OfxStatus st = propGetString(h, name, i, &value[i]); st != kOfxStatOK) return st;
    }
    return kOfxStatOK;
}

OfxStatus propGetDoubleN(OfxPropertySetHandle h, const char* name, int count, double* value)
{
    if (count < 0 || (count > 0 && !value)) return kOfxStatErrValue;
    for (int i = 0; i < count; ++i) {
        if (OfxStatus st = propGetDouble(h, name, i, &value[i]); st != kOfxStatOK) return st;
    }
    return kOfxStatOK;
}

OfxStatus propGetIntN(OfxPropertySetHandle h, const char* name, int count, int* value)
{
    if (count < 0 || (count > 0 && !value)) return kOfxStatErrValue;
    for (int i = 0; i < count; ++i) {
        if (OfxStatus st = propGetInt(h, name, i, &value[i]); st != kOfxStatOK) return st;
    }
    return kOfxStatOK;
}

OfxStatus propReset(OfxPropertySetHandle h, const char* name)
{
    PropertySet* set = PropertySet::from(h);
    if (!set) return kOfxStatErrBadHandle;
    if (!name) return kOfxStatErrUnknown;
    Property* p = set->find(name);
    if (!p) return kOfxStatErrUnknown;
    // No per-property defaults are tracked; reset to zero/empty values of the same dimension.
    for (auto& v : p->i) v = 0;
    for (auto& v : p->d) v = 0.0;
    for (auto& v : p->s) v.clear();
    for (auto& v : p->p) v = nullptr;
    return kOfxStatOK;
}

OfxStatus propGetDimension(OfxPropertySetHandle h, const char* name, int* count)
{
    if (!count) return kOfxStatErrValue;
    PropertySet* set = PropertySet::from(h);
    if (!set) return kOfxStatErrBadHandle;
    if (!name) return kOfxStatErrUnknown;
    const Property* p = set->find(name);
    if (!p) return kOfxStatErrUnknown;
    *count = p->dimension();
    return kOfxStatOK;
}

const OfxPropertySuiteV1 kPropertySuite = {
    propSetPointer, propSetString, propSetDouble, propSetInt,
    propSetPointerN, propSetStringN, propSetDoubleN, propSetIntN,
    propGetPointer, propGetString, propGetDouble, propGetInt,
    propGetPointerN, propGetStringN, propGetDoubleN, propGetIntN,
    propReset, propGetDimension,
};

} // namespace

const OfxPropertySuiteV1* propertySuite()
{
    return &kPropertySuite;
}

} // namespace avpe
