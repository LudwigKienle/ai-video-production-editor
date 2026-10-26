// Bake: decode a video with an external ffmpeg process, run every frame through
// a chain of OFX plugins, and encode the result with a second ffmpeg process.
// ffmpeg is only ever used as an external executable (never linked).
// SPDX-License-Identifier: GPL-3.0-or-later
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <deque>
#include <functional>
#include <memory>
#include <regex>
#include <sys/stat.h>
#include <unistd.h>

#include "io.h"
#include "pixels.h"
#include "session.h"

namespace avpe {

namespace {

using Clock = std::chrono::steady_clock;

struct ProbeInfo {
    int width = 0;
    int height = 0;
    double fps = 0.0;
    double durationSec = 0.0;
    std::string colorMatrix; // ffmpeg colorspace name if tagged
    bool hasAudio = false;
};

bool fileExists(const std::string& p)
{
    struct stat st {};
    return stat(p.c_str(), &st) == 0 && S_ISREG(st.st_mode);
}

std::string parentDir(const std::string& p)
{
    const size_t slash = p.find_last_of('/');
    if (slash == std::string::npos) return ".";
    if (slash == 0) return "/";
    return p.substr(0, slash);
}

bool dirExists(const std::string& p)
{
    struct stat st {};
    return stat(p.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
}

bool probeInput(const std::string& ffmpeg, const std::string& input, ProbeInfo& info, std::string& error)
{
    ChildProcess child;
    if (!spawnProcess({ffmpeg, "-hide_banner", "-nostdin", "-i", input}, false, false, true, child, error)) return false;
    StderrTail tail(1 << 20);
    tail.start(child.stderrFd);
    child.stderrFd = -1;
    waitProcess(child.pid);
    tail.join();
    const std::string text = tail.text();

    std::smatch m;
    static const std::regex durRe(R"(Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?))");
    if (std::regex_search(text, m, durRe)) {
        info.durationSec = std::stod(m[1]) * 3600.0 + std::stod(m[2]) * 60.0 + std::stod(m[3]);
    }
    std::string videoLine;
    size_t pos = 0;
    while (pos < text.size()) {
        size_t nl = text.find('\n', pos);
        if (nl == std::string::npos) nl = text.size();
        const std::string line = text.substr(pos, nl - pos);
        if (line.find("Stream #") != std::string::npos) {
            if (line.find("Video:") != std::string::npos && videoLine.empty()) videoLine = line;
            if (line.find("Audio:") != std::string::npos) info.hasAudio = true;
        }
        pos = nl + 1;
    }
    if (videoLine.empty()) {
        error = "no video stream found in input";
        const size_t tailStart = text.size() > 600 ? text.size() - 600 : 0;
        if (!text.empty()) error += ": " + text.substr(tailStart);
        return false;
    }
    static const std::regex sizeRe(R"((?:^|[\s,])(\d{2,5})x(\d{2,5})(?:[\s,\[]|$))");
    if (std::regex_search(videoLine, m, sizeRe)) {
        info.width = std::stoi(m[1]);
        info.height = std::stoi(m[2]);
    }
    static const std::regex fpsRe(R"(([\d.]+)\s*fps)");
    static const std::regex tbrRe(R"(([\d.]+)\s*tbr)");
    if (std::regex_search(videoLine, m, fpsRe)) info.fps = std::stod(m[1]);
    else if (std::regex_search(videoLine, m, tbrRe)) info.fps = std::stod(m[1]);
    for (const char* cs : {"bt709", "bt2020nc", "bt2020c", "smpte170m", "bt470bg", "smpte240m"}) {
        if (videoLine.find(cs) != std::string::npos) {
            info.colorMatrix = cs;
            break;
        }
    }
    if (info.width <= 0 || info.height <= 0) {
        error = "could not determine input size from ffmpeg output";
        return false;
    }
    return true;
}

std::string fmtNum(double v)
{
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.6g", v);
    return buf;
}

struct FloatFrame {
    int64_t index = 0;
    std::vector<uint8_t> data; // bottom-up RGBA float32
};

struct Stage {
    std::string pluginId;
    std::string instanceId;
    Effect* inst = nullptr;
    int radius = 0;
    PixelDepth depth = PixelDepth::Float;
    std::deque<std::shared_ptr<FloatFrame>> inputs;
    int64_t next = 0;
    bool inputDone = false;
    int64_t lastInput = -1;
    std::vector<std::vector<uint8_t>> convIn; // scratch when the plugin depth is not float
};

} // namespace

Json runBake(Session& session, const Json& req, const Json& requestId)
{
    Host& host = Host::instance();
    Channel& ch = *session.channel;
    Json fail = Json::object();
    fail["ok"] = false;
    auto error = [&](const std::string& msg) {
        Json r = fail;
        r["error"] = msg;
        return r;
    };

    const std::string input = req["input"].asString("");
    const std::string output = req["output"].asString("");
    const std::string ffmpeg = req["ffmpegPath"].asString("ffmpeg");
    if (input.empty() || !fileExists(input)) return error("bake: input file not found: " + input);
    if (output.empty()) return error("bake: output path is required");
    if (output == input) return error("bake: output must differ from input");
    if (!dirExists(parentDir(output))) return error("bake: output folder does not exist: " + parentDir(output));
    const bool overwrite = req["overwrite"].asBool(true);
    if (!overwrite && fileExists(output)) return error("bake: output exists and overwrite is false");
    if (ffmpeg.find('/') != std::string::npos && access(ffmpeg.c_str(), X_OK) != 0)
        return error("bake: ffmpeg not executable: " + ffmpeg);

    ProbeInfo probe;
    std::string err;
    if (!probeInput(ffmpeg, input, probe, err)) return error("bake: probe failed: " + err);

    int width = req["width"].asInt(0);
    int height = req["height"].asInt(0);
    if (width <= 0 || height <= 0) {
        width = probe.width;
        height = probe.height;
    }
    if (width <= 0 || height <= 0 || width > 16384 || height > 16384) return error("bake: invalid frame size");
    const bool fpsGiven = req["fps"].asNumber(0.0) > 0.0;
    double fps = fpsGiven ? req["fps"].asNumber(0.0) : probe.fps;
    if (!(fps > 0.0 && fps < 1000.0)) fps = 25.0;
    const double startTime = std::max(0.0, req["startTime"].asNumber(0.0));
    double duration = req["duration"].asNumber(0.0);
    if (!(duration > 0.0)) duration = 0.0;
    const double effectiveDuration = duration > 0.0 ? duration : std::max(0.0, probe.durationSec - startTime);
    const int64_t estimatedFrames = effectiveDuration > 0.0 ? static_cast<int64_t>(std::llround(effectiveDuration * fps)) : -1;
    const double frameOffset = req["frameOffset"].asNumber(0.0);
    const int temporalRadius = std::min(8, std::max(0, req["temporalRadius"].asInt(2)));
    const bool use16 = req["bitDepth"].asInt(16) != 8;
    const WireFormat wire = use16 ? WireFormat::RGBA16 : WireFormat::RGBA8;
    const std::string wirePixFmt = use16 ? "rgba64le" : "rgba";
    const std::string codec = req["codec"].asString("prores_hq");
    const bool wantAudio = req["audio"].asBool(true) && probe.hasAudio;
    const int progressIntervalMs = std::max(50, req["progressIntervalMs"].asInt(250));

    std::string matrix = req["colorMatrix"].asString("");
    if (matrix.empty()) matrix = !probe.colorMatrix.empty() ? probe.colorMatrix : (height >= 720 ? "bt709" : "smpte170m");
    std::string primaries = matrix == "bt709" ? "bt709" : (matrix.rfind("bt2020", 0) == 0 ? "bt2020" : "smpte170m");
    std::string trc = matrix == "bt709" ? "bt709" : (matrix.rfind("bt2020", 0) == 0 ? "bt709" : "smpte170m");
    const std::string swsMatrix = matrix == "bt2020nc" || matrix == "bt2020c" ? "bt2020" : (matrix == "smpte170m" || matrix == "bt470bg" ? "bt601" : matrix);

    // ---- plugin chain ----
    std::vector<Stage> stages;
    static int bakeCounter = 0;
    ++bakeCounter;
    for (const auto& item : req["chain"].asArray()) {
        Stage st;
        st.pluginId = item["pluginId"].asString(item["id"].asString(""));
        if (st.pluginId.empty()) return error("bake: chain entry without pluginId");
        st.instanceId = "bake" + std::to_string(bakeCounter) + ":" + std::to_string(stages.size()) + ":" + st.pluginId;
        bool created = false;
        st.inst = session.ensureInstance(st.pluginId, st.instanceId, item["bundlePath"].asString(""), width, height, fps,
                                         1.0, created, err);
        if (!st.inst) {
            for (auto& s : stages) host.destroyInstance(s.instanceId);
            return error("bake: " + st.pluginId + ": " + err);
        }
        std::vector<std::string> warnings;
        const auto changed = host.applyParams(*st.inst, item["params"], true, warnings);
        host.notifyInstanceChanged(*st.inst, changed, frameOffset);
        for (const auto& w : warnings) std::fprintf(stderr, "[avpe-ofx-host] bake %s: %s\n", st.pluginId.c_str(), w.c_str());
        st.radius = st.inst->props.getInt(kOfxImageEffectPropTemporalClipAccess) ? temporalRadius : 0;
        st.depth = st.inst->outputClip() ? st.inst->outputClip()->depth : PixelDepth::Float;
        stages.push_back(std::move(st));
    }
    auto destroyStages = [&] {
        for (auto& s : stages) {
            if (host.getInstance(s.instanceId)) {
                host.endSequence(*s.inst);
                host.destroyInstance(s.instanceId);
            }
        }
    };

    // ---- ffmpeg processes ----
    std::vector<std::string> dec = {ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error"};
    if (startTime > 0.0) {
        dec.push_back("-ss");
        dec.push_back(fmtNum(startTime));
    }
    dec.insert(dec.end(), {"-i", input});
    if (duration > 0.0) {
        dec.push_back("-t");
        dec.push_back(fmtNum(duration));
    }
    dec.insert(dec.end(), {"-map", "0:v:0", "-an", "-sn", "-dn"});
    dec.insert(dec.end(), {"-vf", "scale=" + std::to_string(width) + ":" + std::to_string(height) +
                                      ":flags=bicubic:in_color_matrix=" + swsMatrix + ",format=" + wirePixFmt});
    if (fpsGiven) dec.insert(dec.end(), {"-fps_mode", "cfr", "-r", fmtNum(fps)});
    dec.insert(dec.end(), {"-f", "rawvideo", "-pix_fmt", wirePixFmt, "pipe:1"});

    std::vector<std::string> enc = {ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", overwrite ? "-y" : "-n",
                                    "-f", "rawvideo", "-pix_fmt", wirePixFmt, "-s",
                                    std::to_string(width) + "x" + std::to_string(height), "-r", fmtNum(fps), "-i", "pipe:0"};
    if (wantAudio) {
        if (startTime > 0.0) enc.insert(enc.end(), {"-ss", fmtNum(startTime)});
        enc.insert(enc.end(), {"-i", input});
        if (duration > 0.0) enc.insert(enc.end(), {"-t", fmtNum(duration)});
        enc.insert(enc.end(), {"-map", "0:v:0", "-map", "1:a?"});
    } else {
        enc.insert(enc.end(), {"-map", "0:v:0"});
    }
    std::string encPixFmt = "yuv422p10le";
    bool prores = true;
    std::vector<std::string> codecArgs;
    if (codec == "prores_hq" || codec == "prores") codecArgs = {"-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0"};
    else if (codec == "prores_422") codecArgs = {"-c:v", "prores_ks", "-profile:v", "2", "-vendor", "apl0"};
    else if (codec == "prores_lt") codecArgs = {"-c:v", "prores_ks", "-profile:v", "1", "-vendor", "apl0"};
    else if (codec == "prores_proxy") codecArgs = {"-c:v", "prores_ks", "-profile:v", "0", "-vendor", "apl0"};
    else if (codec == "prores_4444") {
        codecArgs = {"-c:v", "prores_ks", "-profile:v", "4", "-vendor", "apl0"};
        encPixFmt = "yuva444p10le";
    } else if (codec == "h264") {
        prores = false;
        encPixFmt = "yuv420p";
        codecArgs = {"-c:v", "libx264", "-preset", req["preset"].asString("medium"), "-crf",
                     std::to_string(req["crf"].asInt(18)), "-movflags", "+faststart"};
    } else if (codec == "hevc" || codec == "h265") {
        prores = false;
        encPixFmt = "yuv420p10le";
        codecArgs = {"-c:v", "libx265", "-preset", req["preset"].asString("medium"), "-crf",
                     std::to_string(req["crf"].asInt(20)), "-tag:v", "hvc1", "-movflags", "+faststart"};
    } else {
        destroyStages();
        return error("bake: unknown codec " + codec + " (prores_hq, prores_422, prores_lt, prores_proxy, prores_4444, h264, hevc)");
    }
    enc.insert(enc.end(), codecArgs.begin(), codecArgs.end());
    // setparams tags the frames themselves; newer ffmpeg builds ignore -colorspace alone for filtered rawvideo.
    enc.insert(enc.end(), {"-vf", "scale=out_color_matrix=" + swsMatrix + ":out_range=tv,format=" + encPixFmt +
                                      ",setparams=colorspace=" + matrix + ":color_primaries=" + primaries +
                                      ":color_trc=" + trc + ":range=tv",
                           "-pix_fmt", encPixFmt, "-colorspace", matrix, "-color_primaries", primaries, "-color_trc", trc});
    if (wantAudio) {
        if (prores) enc.insert(enc.end(), {"-c:a", "pcm_s16le"});
        else enc.insert(enc.end(), {"-c:a", "aac", "-b:a", "192k"});
        enc.push_back("-shortest");
    }
    for (const auto& a : req["encoderArgs"].asArray()) {
        if (a.isString()) enc.push_back(a.asString());
    }
    enc.push_back(output);

    ChildProcess decoder;
    ChildProcess encoder;
    if (!spawnProcess(dec, false, true, true, decoder, err)) {
        destroyStages();
        return error("bake: " + err);
    }
    StderrTail decErr;
    decErr.start(decoder.stderrFd);
    decoder.stderrFd = -1;
    if (!spawnProcess(enc, true, false, true, encoder, err)) {
        killProcess(decoder.pid);
        waitProcess(decoder.pid);
        destroyStages();
        return error("bake: " + err);
    }
    StderrTail encErr;
    encErr.start(encoder.stderrFd);
    encoder.stderrFd = -1;

    const size_t wireFrameBytes = static_cast<size_t>(width) * static_cast<size_t>(height) * wireBytesPerPixel(wire);
    const size_t floatRow = static_cast<size_t>(width) * 16;
    const size_t floatFrameBytes = floatRow * static_cast<size_t>(height);
    std::vector<uint8_t> wireBuf(wireFrameBytes);

    const auto t0 = Clock::now();
    auto lastProgress = t0 - std::chrono::hours(1);
    int64_t decoded = 0;
    int64_t encoded = 0;
    bool decoderEof = false;
    bool cancelled = false;
    std::string failure;

    for (auto& s : stages) {
        host.beginSequence(*s.inst, frameOffset,
                           frameOffset + static_cast<double>(estimatedFrames > 0 ? estimatedFrames - 1 : 0), false);
    }

    auto emitProgress = [&](bool force) {
        const auto now = Clock::now();
        if (!force && std::chrono::duration_cast<std::chrono::milliseconds>(now - lastProgress).count() < progressIntervalMs)
            return;
        lastProgress = now;
        const double elapsed = std::chrono::duration<double>(now - t0).count();
        Json ev = Json::object();
        ev["id"] = requestId;
        ev["event"] = "progress";
        ev["frame"] = static_cast<double>(encoded);
        ev["decoded"] = static_cast<double>(decoded);
        ev["totalFrames"] = estimatedFrames > 0 ? Json(static_cast<double>(estimatedFrames)) : Json();
        ev["elapsedSec"] = elapsed;
        const double rate = elapsed > 0 ? encoded / elapsed : 0.0;
        ev["fps"] = rate;
        if (estimatedFrames > 0) {
            ev["percent"] = std::min(100.0, 100.0 * static_cast<double>(encoded) / static_cast<double>(estimatedFrames));
            ev["etaSec"] = rate > 0 ? std::max(0.0, (estimatedFrames - encoded) / rate) : Json();
        }
        ch.send(ev);
    };

    // Renders frame `s.next` of stage `si` and forwards the result.
    std::function<bool(size_t, std::shared_ptr<FloatFrame>)> forward;
    auto writeToEncoder = [&](const FloatFrame& f) -> bool {
        ofxToWire(f.data.data(), floatRow, PixelDepth::Float, width, height, wire, wireBuf.data(), nullptr);
        if (!writeAll(encoder.stdinFd, wireBuf.data(), wireBuf.size())) {
            failure = "encoder stopped accepting frames";
            return false;
        }
        ++encoded;
        return true;
    };

    auto renderStage = [&](Stage& s, std::shared_ptr<FloatFrame>& out) -> bool {
        RenderContext ctx;
        ctx.time = frameOffset + static_cast<double>(s.next);
        ctx.width = width;
        ctx.height = height;
        ctx.renderScale = 1.0;
        ctx.nearestFallback = true;
        const size_t depthRow = static_cast<size_t>(width) * 4 * bytesPerComponent(s.depth);
        if (s.depth != PixelDepth::Float) s.convIn.resize(s.inputs.size());
        for (size_t i = 0; i < s.inputs.size(); ++i) {
            const auto& f = s.inputs[i];
            if (s.depth == PixelDepth::Float) {
                ctx.source.push_back(ClipFrame{frameOffset + static_cast<double>(f->index), f->data.data(), static_cast<long>(floatRow)});
            } else {
                s.convIn[i].resize(depthRow * static_cast<size_t>(height));
                ofxConvert(f->data.data(), PixelDepth::Float, s.convIn[i].data(), s.depth, width, height);
                ctx.source.push_back(ClipFrame{frameOffset + static_cast<double>(f->index), s.convIn[i].data(), static_cast<long>(depthRow)});
            }
        }
        out = std::make_shared<FloatFrame>();
        out->index = s.next;
        std::vector<uint8_t> native;
        if (s.depth == PixelDepth::Float) {
            out->data.assign(floatFrameBytes, 0);
            ctx.output = ClipFrame{ctx.time, out->data.data(), static_cast<long>(floatRow)};
        } else {
            native.assign(depthRow * static_cast<size_t>(height), 0);
            ctx.output = ClipFrame{ctx.time, native.data(), static_cast<long>(depthRow)};
        }
        std::string renderErr;
        if (host.renderFrame(*s.inst, ctx, renderErr) != kOfxStatOK) {
            failure = s.pluginId + " frame " + std::to_string(s.next) + ": " + renderErr;
            return false;
        }
        if (s.depth != PixelDepth::Float) {
            out->data.resize(floatFrameBytes);
            ofxConvert(native.data(), s.depth, out->data.data(), PixelDepth::Float, width, height);
        }
        return true;
    };

    // Pushes frame into stage `si` (or the encoder) and renders whatever became ready.
    forward = [&](size_t si, std::shared_ptr<FloatFrame> frame) -> bool {
        if (si >= stages.size()) return frame ? writeToEncoder(*frame) : true;
        Stage& s = stages[si];
        if (frame) {
            s.lastInput = frame->index;
            s.inputs.push_back(std::move(frame));
        } else {
            s.inputDone = true;
        }
        while (true) {
            if (s.next > s.lastInput) break;
            const bool lookaheadReady = s.inputDone || s.lastInput >= s.next + s.radius;
            if (!lookaheadReady) break;
            std::shared_ptr<FloatFrame> out;
            if (!renderStage(s, out)) return false;
            ++s.next;
            while (!s.inputs.empty() && s.inputs.front()->index < s.next - s.radius) s.inputs.pop_front();
            if (!forward(si + 1, out)) return false;
        }
        if (s.inputDone && s.next > s.lastInput) return forward(si + 1, nullptr);
        return true;
    };

    while (!decoderEof && failure.empty() && !cancelled) {
        size_t got = 0;
        if (!readAll(decoder.stdoutFd, wireBuf.data(), wireBuf.size(), &got)) {
            decoderEof = true;
            if (got != 0) std::fprintf(stderr, "[avpe-ofx-host] bake: dropping partial frame (%zu bytes)\n", got);
            break;
        }
        auto frame = std::make_shared<FloatFrame>();
        frame->index = decoded++;
        frame->data.resize(floatFrameBytes);
        // The wire buffer is top-down; wireToOfx flips it into OFX bottom-up order.
        wireToOfx(wireBuf.data(), wire, width, height, PixelDepth::Float, frame->data.data(), floatRow);
        if (!forward(0, frame)) break;
        emitProgress(false);

        Json msg;
        std::string perr;
        while (ch.poll(msg, perr)) {
            if (msg["cmd"].asString("") == "cancel") {
                cancelled = true;
                Json ack = Json::object();
                ack["id"] = msg["id"];
                ack["ok"] = true;
                ack["cancelled"] = true;
                ch.send(ack);
            } else {
                Json busy = Json::object();
                busy["id"] = msg["id"];
                busy["ok"] = false;
                busy["error"] = "busy: a bake is running in this host process (only 'cancel' is accepted)";
                ch.send(busy);
            }
        }
    }
    if (failure.empty() && !cancelled) forward(0, nullptr); // flush temporal look-ahead
    closeFd(decoder.stdoutFd);
    closeFd(encoder.stdinFd);

    if (!failure.empty() || cancelled) {
        killProcess(decoder.pid);
        killProcess(encoder.pid);
    }
    const int decCode = waitProcess(decoder.pid);
    const int encCode = waitProcess(encoder.pid);
    decErr.join();
    encErr.join();
    destroyStages();

    const bool keepPartial = req["keepPartial"].asBool(false);
    if ((cancelled || !failure.empty() || encCode != 0) && !keepPartial) ::unlink(output.c_str());

    const double elapsed = std::chrono::duration<double>(Clock::now() - t0).count();
    if (cancelled) {
        Json r = error("cancelled");
        r["cancelled"] = true;
        r["frames"] = static_cast<double>(encoded);
        return r;
    }
    if (failure.empty() && decoded == 0) {
        failure = "decoder produced no frames";
        if (decCode != 0) failure += " (ffmpeg exit " + std::to_string(decCode) + ")";
    }
    if (failure.empty() && encCode != 0) failure = "encoder failed (ffmpeg exit " + std::to_string(encCode) + ")";
    if (!failure.empty()) {
        Json r = error("bake: " + failure);
        r["decoderLog"] = decErr.text();
        r["encoderLog"] = encErr.text();
        r["frames"] = static_cast<double>(encoded);
        return r;
    }
    emitProgress(true);
    Json r = Json::object();
    r["ok"] = true;
    r["output"] = output;
    r["frames"] = static_cast<double>(encoded);
    r["width"] = width;
    r["height"] = height;
    r["fps"] = fps;
    r["codec"] = codec;
    r["audio"] = wantAudio;
    r["colorMatrix"] = matrix;
    r["elapsedSec"] = elapsed;
    r["avgFps"] = elapsed > 0 ? encoded / elapsed : 0.0;
    if (decCode != 0) r["decoderWarning"] = "decoder exit code " + std::to_string(decCode) + ": " + decErr.text();
    return r;
}

} // namespace avpe
