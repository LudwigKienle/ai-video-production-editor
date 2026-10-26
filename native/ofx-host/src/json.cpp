// SPDX-License-Identifier: GPL-3.0-or-later
#include "json.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace avpe {

namespace {
const Json kNullJson;
const std::string kEmptyString;
const Json::Array kEmptyArray;
const Json::Object kEmptyObject;
} // namespace

bool Json::asBool(bool fallback) const
{
    if (type_ == Type::Bool) return bool_;
    if (type_ == Type::Number) return num_ != 0.0;
    return fallback;
}

double Json::asNumber(double fallback) const
{
    if (type_ == Type::Number) return num_;
    if (type_ == Type::Bool) return bool_ ? 1.0 : 0.0;
    if (type_ == Type::String) {
        char* end = nullptr;
        const double v = std::strtod(str_.c_str(), &end);
        if (end && end != str_.c_str() && *end == '\0') return v;
    }
    return fallback;
}

int Json::asInt(int fallback) const
{
    const double v = asNumber(static_cast<double>(fallback));
    if (!std::isfinite(v)) return fallback;
    if (v > 2147483647.0) return 2147483647;
    if (v < -2147483648.0) return -2147483647 - 1;
    return static_cast<int>(std::lround(v));
}

const std::string& Json::asString() const
{
    return type_ == Type::String ? str_ : kEmptyString;
}

std::string Json::asString(const std::string& fallback) const
{
    return type_ == Type::String ? str_ : fallback;
}

const Json::Array& Json::asArray() const
{
    return (type_ == Type::Array && arr_) ? *arr_ : kEmptyArray;
}

const Json::Object& Json::asObject() const
{
    return (type_ == Type::Object && obj_) ? *obj_ : kEmptyObject;
}

Json::Array& Json::arr()
{
    if (type_ != Type::Array) {
        *this = Json(Array{});
    }
    if (arr_.use_count() > 1) arr_ = std::make_shared<Array>(*arr_);
    return *arr_;
}

Json::Object& Json::obj()
{
    if (type_ != Type::Object) {
        *this = Json(Object{});
    }
    if (obj_.use_count() > 1) obj_ = std::make_shared<Object>(*obj_);
    return *obj_;
}

bool Json::has(const std::string& key) const
{
    if (type_ != Type::Object || !obj_) return false;
    return obj_->find(key) != obj_->end();
}

const Json& Json::operator[](const std::string& key) const
{
    if (type_ != Type::Object || !obj_) return kNullJson;
    auto it = obj_->find(key);
    return it == obj_->end() ? kNullJson : it->second;
}

Json& Json::operator[](const std::string& key)
{
    return obj()[key];
}

const Json& Json::operator[](size_t index) const
{
    if (type_ != Type::Array || !arr_ || index >= arr_->size()) return kNullJson;
    return (*arr_)[index];
}

size_t Json::size() const
{
    if (type_ == Type::Array && arr_) return arr_->size();
    if (type_ == Type::Object && obj_) return obj_->size();
    return 0;
}

void Json::push(Json value)
{
    arr().push_back(std::move(value));
}

void jsonEscapeTo(std::string& out, const std::string& s)
{
    out.push_back('"');
    for (unsigned char c : s) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20) {
                char buf[8];
                std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                out += buf;
            } else {
                out.push_back(static_cast<char>(c));
            }
        }
    }
    out.push_back('"');
}

void Json::dumpTo(std::string& out) const
{
    switch (type_) {
    case Type::Null: out += "null"; break;
    case Type::Bool: out += bool_ ? "true" : "false"; break;
    case Type::Number: {
        if (!std::isfinite(num_)) {
            out += "null";
            break;
        }
        char buf[32];
        if (num_ == std::floor(num_) && std::fabs(num_) < 9.0e15) {
            std::snprintf(buf, sizeof(buf), "%.0f", num_);
        } else {
            std::snprintf(buf, sizeof(buf), "%.17g", num_);
            // Prefer a shorter round-tripping representation when possible.
            char shortBuf[32];
            for (int prec = 6; prec < 17; ++prec) {
                std::snprintf(shortBuf, sizeof(shortBuf), "%.*g", prec, num_);
                if (std::strtod(shortBuf, nullptr) == num_) {
                    std::memcpy(buf, shortBuf, sizeof(buf));
                    break;
                }
            }
        }
        out += buf;
        break;
    }
    case Type::String: jsonEscapeTo(out, str_); break;
    case Type::Array: {
        out.push_back('[');
        bool first = true;
        for (const auto& v : asArray()) {
            if (!first) out.push_back(',');
            first = false;
            v.dumpTo(out);
        }
        out.push_back(']');
        break;
    }
    case Type::Object: {
        out.push_back('{');
        bool first = true;
        for (const auto& kv : asObject()) {
            if (!first) out.push_back(',');
            first = false;
            jsonEscapeTo(out, kv.first);
            out.push_back(':');
            kv.second.dumpTo(out);
        }
        out.push_back('}');
        break;
    }
    }
}

std::string Json::dump() const
{
    std::string out;
    dumpTo(out);
    return out;
}

namespace {

class Parser {
public:
    explicit Parser(const std::string& text) : s_(text) {}

    Json parseDocument()
    {
        skipWs();
        Json v = parseValue(0);
        skipWs();
        if (pos_ != s_.size()) fail("trailing characters");
        return v;
    }

private:
    [[noreturn]] void fail(const char* what) const
    {
        throw JsonError(std::string("JSON parse error: ") + what + " at offset " + std::to_string(pos_));
    }

    void skipWs()
    {
        while (pos_ < s_.size()) {
            const char c = s_[pos_];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') ++pos_;
            else break;
        }
    }

    Json parseValue(int depth)
    {
        if (depth > 256) fail("nesting too deep");
        if (pos_ >= s_.size()) fail("unexpected end");
        const char c = s_[pos_];
        if (c == '{') return parseObject(depth);
        if (c == '[') return parseArray(depth);
        if (c == '"') return Json(parseString());
        if (c == 't') { expectWord("true"); return Json(true); }
        if (c == 'f') { expectWord("false"); return Json(false); }
        if (c == 'n') { expectWord("null"); return Json(); }
        if (c == '-' || (c >= '0' && c <= '9')) return parseNumber();
        fail("unexpected character");
    }

    void expectWord(const char* w)
    {
        const size_t n = std::strlen(w);
        if (s_.compare(pos_, n, w) != 0) fail("invalid literal");
        pos_ += n;
    }

    Json parseNumber()
    {
        const size_t start = pos_;
        if (s_[pos_] == '-') ++pos_;
        while (pos_ < s_.size()) {
            const char c = s_[pos_];
            if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') ++pos_;
            else break;
        }
        const std::string tok = s_.substr(start, pos_ - start);
        char* end = nullptr;
        const double v = std::strtod(tok.c_str(), &end);
        if (!end || *end != '\0') fail("invalid number");
        return Json(v);
    }

    static void appendUtf8(std::string& out, uint32_t cp)
    {
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else if (cp < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }

    uint32_t parseHex4()
    {
        if (pos_ + 4 > s_.size()) fail("bad unicode escape");
        uint32_t v = 0;
        for (int i = 0; i < 4; ++i) {
            const char c = s_[pos_++];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= static_cast<uint32_t>(c - '0');
            else if (c >= 'a' && c <= 'f') v |= static_cast<uint32_t>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') v |= static_cast<uint32_t>(c - 'A' + 10);
            else fail("bad hex digit");
        }
        return v;
    }

    std::string parseString()
    {
        ++pos_; // opening quote
        std::string out;
        while (true) {
            if (pos_ >= s_.size()) fail("unterminated string");
            const char c = s_[pos_++];
            if (c == '"') break;
            if (c == '\\') {
                if (pos_ >= s_.size()) fail("bad escape");
                const char e = s_[pos_++];
                switch (e) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    uint32_t cp = parseHex4();
                    if (cp >= 0xD800 && cp <= 0xDBFF && pos_ + 6 <= s_.size() &&
                        s_[pos_] == '\\' && s_[pos_ + 1] == 'u') {
                        pos_ += 2;
                        const uint32_t lo = parseHex4();
                        if (lo >= 0xDC00 && lo <= 0xDFFF) {
                            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        } else {
                            appendUtf8(out, 0xFFFD);
                            cp = lo;
                        }
                    }
                    appendUtf8(out, cp);
                    break;
                }
                default: fail("bad escape");
                }
            } else {
                out.push_back(c);
            }
        }
        return out;
    }

    Json parseArray(int depth)
    {
        ++pos_;
        Json::Array a;
        skipWs();
        if (pos_ < s_.size() && s_[pos_] == ']') {
            ++pos_;
            return Json(std::move(a));
        }
        while (true) {
            skipWs();
            a.push_back(parseValue(depth + 1));
            skipWs();
            if (pos_ >= s_.size()) fail("unterminated array");
            const char c = s_[pos_++];
            if (c == ']') break;
            if (c != ',') fail("expected , or ]");
        }
        return Json(std::move(a));
    }

    Json parseObject(int depth)
    {
        ++pos_;
        Json::Object o;
        skipWs();
        if (pos_ < s_.size() && s_[pos_] == '}') {
            ++pos_;
            return Json(std::move(o));
        }
        while (true) {
            skipWs();
            if (pos_ >= s_.size() || s_[pos_] != '"') fail("expected key");
            std::string key = parseString();
            skipWs();
            if (pos_ >= s_.size() || s_[pos_] != ':') fail("expected :");
            ++pos_;
            skipWs();
            o[key] = parseValue(depth + 1);
            skipWs();
            if (pos_ >= s_.size()) fail("unterminated object");
            const char c = s_[pos_++];
            if (c == '}') break;
            if (c != ',') fail("expected , or }");
        }
        return Json(std::move(o));
    }

    const std::string& s_;
    size_t pos_ = 0;
};

} // namespace

Json Json::parse(const std::string& text)
{
    Parser p(text);
    return p.parseDocument();
}

} // namespace avpe
