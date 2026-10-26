// Minimal JSON value, parser and serializer for the AVPE OFX host protocol.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace avpe {

class Json {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };
    using Array = std::vector<Json>;
    using Object = std::map<std::string, Json>;

    Json() = default;
    Json(std::nullptr_t) {}
    Json(bool v) : type_(Type::Bool), bool_(v) {}
    Json(int v) : type_(Type::Number), num_(v) {}
    Json(unsigned v) : type_(Type::Number), num_(v) {}
    Json(long v) : type_(Type::Number), num_(static_cast<double>(v)) {}
    Json(long long v) : type_(Type::Number), num_(static_cast<double>(v)) {}
    Json(unsigned long v) : type_(Type::Number), num_(static_cast<double>(v)) {}
    Json(unsigned long long v) : type_(Type::Number), num_(static_cast<double>(v)) {}
    Json(double v) : type_(Type::Number), num_(v) {}
    Json(const char* v) : type_(Type::String), str_(v ? v : "") {}
    Json(const std::string& v) : type_(Type::String), str_(v) {}
    Json(std::string&& v) : type_(Type::String), str_(std::move(v)) {}
    Json(const Array& v) : type_(Type::Array), arr_(std::make_shared<Array>(v)) {}
    Json(Array&& v) : type_(Type::Array), arr_(std::make_shared<Array>(std::move(v))) {}
    Json(const Object& v) : type_(Type::Object), obj_(std::make_shared<Object>(v)) {}
    Json(Object&& v) : type_(Type::Object), obj_(std::make_shared<Object>(std::move(v))) {}

    static Json array() { return Json(Array{}); }
    static Json object() { return Json(Object{}); }

    Type type() const { return type_; }
    bool isNull() const { return type_ == Type::Null; }
    bool isBool() const { return type_ == Type::Bool; }
    bool isNumber() const { return type_ == Type::Number; }
    bool isString() const { return type_ == Type::String; }
    bool isArray() const { return type_ == Type::Array; }
    bool isObject() const { return type_ == Type::Object; }

    bool asBool(bool fallback = false) const;
    double asNumber(double fallback = 0.0) const;
    int asInt(int fallback = 0) const;
    const std::string& asString() const;
    std::string asString(const std::string& fallback) const;
    const Array& asArray() const;
    const Object& asObject() const;

    // Mutable access (copy-on-write is not needed: values are owned per message).
    Array& arr();
    Object& obj();

    // Object helpers.
    bool has(const std::string& key) const;
    const Json& operator[](const std::string& key) const;
    Json& operator[](const std::string& key);
    // Array helpers.
    const Json& operator[](size_t index) const;
    size_t size() const;
    void push(Json value);

    std::string dump() const;
    static Json parse(const std::string& text);

private:
    void dumpTo(std::string& out) const;

    Type type_ = Type::Null;
    bool bool_ = false;
    double num_ = 0.0;
    std::string str_;
    std::shared_ptr<Array> arr_;
    std::shared_ptr<Object> obj_;
};

struct JsonError : std::runtime_error {
    using std::runtime_error::runtime_error;
};

void jsonEscapeTo(std::string& out, const std::string& s);

} // namespace avpe
