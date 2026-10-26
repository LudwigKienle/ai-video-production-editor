// Framed protocol channel (JSON header line + optional binary payload) and
// child-process helpers.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "json.h"

namespace avpe {

class Channel {
public:
    Channel(int inFd, int outFd) : in_(inFd), out_(outFd) {}

    // Blocking read of one message. Returns false on EOF; `error` is set on protocol errors
    // (in which case the stream is unusable).
    bool read(Json& header, std::vector<uint8_t>& payload, std::string& error);
    // Non-blocking: returns true and fills a message if one complete header line (without
    // payload) is available. Used to receive `cancel` while a bake is running.
    bool poll(Json& header, std::string& error);

    // Thread-safe write of a header (+ payload). Sets "binarySize" when data is given.
    bool send(Json header, const void* data = nullptr, size_t size = 0);

    int outFd() const { return out_; }

private:
    bool fill(bool block);
    bool readExact(uint8_t* dst, size_t n);

    int in_;
    int out_;
    std::string buf_;
    std::mutex writeMutex_;
    bool eof_ = false;
};

bool writeAll(int fd, const void* data, size_t size);
bool readAll(int fd, void* data, size_t size, size_t* got = nullptr);

// Child process with optional pipes.
struct ChildProcess {
    int pid = -1;
    int stdinFd = -1;  // write end (parent)
    int stdoutFd = -1; // read end (parent)
    int stderrFd = -1; // read end (parent)
};

// Spawns argv[0] (absolute path or PATH lookup). Unpiped stdin is /dev/null,
// unpiped stdout/stderr go to the host's stderr. All other fds are closed in the child.
bool spawnProcess(const std::vector<std::string>& argv, bool pipeStdin, bool pipeStdout, bool pipeStderr,
                  ChildProcess& out, std::string& error);
// Waits for exit; returns exit code (>=0), 128+signal for signals, -1 on error.
int waitProcess(int pid);
// Non-blocking wait: returns true if exited (code stored).
bool tryWaitProcess(int pid, int& code);
void killProcess(int pid);
void closeFd(int& fd);

// Collects the tail of a child's stderr on a background thread.
class StderrTail {
public:
    explicit StderrTail(size_t maxBytes = 16384) : max_(maxBytes) {}
    ~StderrTail();
    void start(int fd);
    void join();
    std::string text();

private:
    size_t max_;
    int fd_ = -1;
    std::thread thread_;
    std::mutex mutex_;
    std::string data_;
};

std::string executablePath();

} // namespace avpe
