// SPDX-License-Identifier: GPL-3.0-or-later
#include "io.h"

#include <cerrno>
#include <climits>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <poll.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <mach-o/dyld.h>
#endif

extern char** environ;

namespace avpe {

namespace {
constexpr size_t kMaxHeaderBytes = 64u * 1024u * 1024u;
constexpr uint64_t kMaxPayloadBytes = 16ull * 1024ull * 1024ull * 1024ull;
} // namespace

bool writeAll(int fd, const void* data, size_t size)
{
    const auto* p = static_cast<const uint8_t*>(data);
    while (size > 0) {
        const size_t chunk = std::min<size_t>(size, 1u << 30);
        const ssize_t n = ::write(fd, p, chunk);
        if (n < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        p += n;
        size -= static_cast<size_t>(n);
    }
    return true;
}

bool readAll(int fd, void* data, size_t size, size_t* got)
{
    auto* p = static_cast<uint8_t*>(data);
    size_t total = 0;
    while (total < size) {
        const size_t chunk = std::min<size_t>(size - total, 1u << 30);
        const ssize_t n = ::read(fd, p + total, chunk);
        if (n < 0) {
            if (errno == EINTR) continue;
            if (got) *got = total;
            return false;
        }
        if (n == 0) {
            if (got) *got = total;
            return false;
        }
        total += static_cast<size_t>(n);
    }
    if (got) *got = total;
    return true;
}

bool Channel::fill(bool block)
{
    if (eof_) return false;
    if (!block) {
        struct pollfd pfd {in_, POLLIN, 0};
        const int r = ::poll(&pfd, 1, 0);
        if (r <= 0) return false;
    }
    char tmp[65536];
    while (true) {
        const ssize_t n = ::read(in_, tmp, sizeof(tmp));
        if (n < 0) {
            if (errno == EINTR) continue;
            eof_ = true;
            return false;
        }
        if (n == 0) {
            eof_ = true;
            return false;
        }
        buf_.append(tmp, static_cast<size_t>(n));
        return true;
    }
}

bool Channel::readExact(uint8_t* dst, size_t n)
{
    const size_t fromBuf = std::min(n, buf_.size());
    if (fromBuf) {
        std::memcpy(dst, buf_.data(), fromBuf);
        buf_.erase(0, fromBuf);
    }
    if (fromBuf == n) return true;
    return readAll(in_, dst + fromBuf, n - fromBuf);
}

bool Channel::read(Json& header, std::vector<uint8_t>& payload, std::string& error)
{
    payload.clear();
    size_t nl;
    while ((nl = buf_.find('\n')) == std::string::npos) {
        if (buf_.size() > kMaxHeaderBytes) {
            error = "header line too long";
            return false;
        }
        if (!fill(true)) {
            if (!buf_.empty()) error = "unexpected EOF in header";
            return false;
        }
    }
    std::string line = buf_.substr(0, nl);
    buf_.erase(0, nl + 1);
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.find_first_not_of(" \t") == std::string::npos) {
        header = Json::object();
        return true; // empty keep-alive line
    }
    try {
        header = Json::parse(line);
    } catch (const std::exception& ex) {
        error = ex.what();
        header = Json::object();
        header["__parseError"] = error;
        error.clear();
        return true; // reply with an error but keep the stream alive
    }
    const double size = header["binarySize"].asNumber(0.0);
    if (size < 0 || size > static_cast<double>(kMaxPayloadBytes) || size != static_cast<double>(static_cast<uint64_t>(size))) {
        error = "invalid binarySize";
        return false;
    }
    if (size > 0) {
        try {
            payload.resize(static_cast<size_t>(size));
        } catch (...) {
            error = "out of memory for payload";
            return false;
        }
        if (!readExact(payload.data(), payload.size())) {
            error = "unexpected EOF in payload";
            return false;
        }
    }
    return true;
}

bool Channel::poll(Json& header, std::string& error)
{
    while (fill(false)) {
    }
    const size_t nl = buf_.find('\n');
    if (nl == std::string::npos) return false;
    std::string line = buf_.substr(0, nl);
    buf_.erase(0, nl + 1);
    try {
        header = Json::parse(line);
    } catch (const std::exception& ex) {
        error = ex.what();
        return false;
    }
    return true;
}

bool Channel::send(Json header, const void* data, size_t size)
{
    if (data && size) header["binarySize"] = static_cast<double>(size);
    std::string line = header.dump();
    line.push_back('\n');
    std::lock_guard<std::mutex> lock(writeMutex_);
    if (!writeAll(out_, line.data(), line.size())) return false;
    if (data && size && !writeAll(out_, data, size)) return false;
    return true;
}

// ---------------------------------------------------------------------------

void closeFd(int& fd)
{
    if (fd >= 0) {
        ::close(fd);
        fd = -1;
    }
}

static bool makePipe(int fds[2])
{
    if (::pipe(fds) != 0) return false;
    ::fcntl(fds[0], F_SETFD, FD_CLOEXEC);
    ::fcntl(fds[1], F_SETFD, FD_CLOEXEC);
    return true;
}

bool spawnProcess(const std::vector<std::string>& argv, bool pipeStdin, bool pipeStdout, bool pipeStderr,
                  ChildProcess& out, std::string& error)
{
    if (argv.empty()) {
        error = "empty argv";
        return false;
    }
    int inPipe[2] = {-1, -1};
    int outPipe[2] = {-1, -1};
    int errPipe[2] = {-1, -1};
    auto cleanup = [&] {
        for (int* p : {inPipe, outPipe, errPipe}) {
            closeFd(p[0]);
            closeFd(p[1]);
        }
    };
    if ((pipeStdin && !makePipe(inPipe)) || (pipeStdout && !makePipe(outPipe)) || (pipeStderr && !makePipe(errPipe))) {
        error = std::string("pipe failed: ") + std::strerror(errno);
        cleanup();
        return false;
    }

    posix_spawn_file_actions_t fa;
    posix_spawn_file_actions_init(&fa);
    if (pipeStdin) posix_spawn_file_actions_adddup2(&fa, inPipe[0], 0);
    else posix_spawn_file_actions_addopen(&fa, 0, "/dev/null", O_RDONLY, 0);
    if (pipeStdout) posix_spawn_file_actions_adddup2(&fa, outPipe[1], 1);
    else posix_spawn_file_actions_adddup2(&fa, 2, 1);
    if (pipeStderr) posix_spawn_file_actions_adddup2(&fa, errPipe[1], 2);
    else posix_spawn_file_actions_adddup2(&fa, 2, 2);

    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    short flags = POSIX_SPAWN_SETSIGDEF | POSIX_SPAWN_SETSIGMASK;
#if defined(__APPLE__)
    flags |= POSIX_SPAWN_CLOEXEC_DEFAULT;
#endif
    posix_spawnattr_setflags(&attr, flags);
    sigset_t defSigs;
    sigemptyset(&defSigs);
    sigaddset(&defSigs, SIGPIPE);
    sigaddset(&defSigs, SIGTERM);
    sigaddset(&defSigs, SIGINT);
    posix_spawnattr_setsigdefault(&attr, &defSigs);
    sigset_t noMask;
    sigemptyset(&noMask);
    posix_spawnattr_setsigmask(&attr, &noMask);

    std::vector<char*> cargv;
    for (const auto& a : argv) cargv.push_back(const_cast<char*>(a.c_str()));
    cargv.push_back(nullptr);

    pid_t pid = -1;
    const bool hasSlash = argv[0].find('/') != std::string::npos;
    const int rc = hasSlash ? posix_spawn(&pid, argv[0].c_str(), &fa, &attr, cargv.data(), environ)
                            : posix_spawnp(&pid, argv[0].c_str(), &fa, &attr, cargv.data(), environ);
    posix_spawn_file_actions_destroy(&fa);
    posix_spawnattr_destroy(&attr);
    if (rc != 0) {
        error = "failed to start " + argv[0] + ": " + std::strerror(rc);
        cleanup();
        return false;
    }
    closeFd(inPipe[0]);
    closeFd(outPipe[1]);
    closeFd(errPipe[1]);
    out.pid = pid;
    out.stdinFd = inPipe[1];
    out.stdoutFd = outPipe[0];
    out.stderrFd = errPipe[0];
    return true;
}

static int decodeStatus(int status)
{
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return -1;
}

int waitProcess(int pid)
{
    if (pid <= 0) return -1;
    int status = 0;
    while (::waitpid(pid, &status, 0) < 0) {
        if (errno != EINTR) return -1;
    }
    return decodeStatus(status);
}

bool tryWaitProcess(int pid, int& code)
{
    if (pid <= 0) return true;
    int status = 0;
    const pid_t r = ::waitpid(pid, &status, WNOHANG);
    if (r == pid) {
        code = decodeStatus(status);
        return true;
    }
    return false;
}

void killProcess(int pid)
{
    if (pid > 0) ::kill(pid, SIGKILL);
}

StderrTail::~StderrTail()
{
    join();
}

void StderrTail::start(int fd)
{
    fd_ = fd;
    thread_ = std::thread([this] {
        char buf[4096];
        while (true) {
            const ssize_t n = ::read(fd_, buf, sizeof(buf));
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) break;
            std::lock_guard<std::mutex> lock(mutex_);
            data_.append(buf, static_cast<size_t>(n));
            if (data_.size() > max_) data_.erase(0, data_.size() - max_);
        }
    });
}

void StderrTail::join()
{
    if (thread_.joinable()) thread_.join();
    closeFd(fd_);
}

std::string StderrTail::text()
{
    std::lock_guard<std::mutex> lock(mutex_);
    return data_;
}

std::string executablePath()
{
#if defined(__APPLE__)
    uint32_t size = 0;
    _NSGetExecutablePath(nullptr, &size);
    std::string buf(size, '\0');
    if (_NSGetExecutablePath(buf.data(), &size) == 0) {
        buf.resize(std::strlen(buf.c_str()));
        char resolved[PATH_MAX];
        if (realpath(buf.c_str(), resolved)) return resolved;
        return buf;
    }
#endif
    return "";
}

} // namespace avpe
