# avpe-ofx-host - OpenFX host sidecar for the AI Video Production Editor (macOS).
#
#   make                 build build/avpe-ofx-host for $(ARCH) (default arm64)
#   make universal       build an arm64 + x86_64 universal binary
#   make smoke           build, then run scripts/smoke.sh
#   make clean
#
# OpenFX API headers (BSD-3-Clause, OpenFX 1.5.1) are vendored in
# third_party/openfx/include. Override with OFX_INCLUDE=/path/to/openfx/include.

ARCH        ?= arm64
MACOS_MIN   ?= 11.0
BUILD       ?= build
OFX_INCLUDE ?= third_party/openfx/include
TARGET      := $(BUILD)/avpe-ofx-host

ifeq ($(origin CXX),default)
CXX := xcrun clang++
endif

SRCS := src/json.cpp src/ofx_props.cpp src/ofx_host.cpp src/io.cpp src/bake.cpp src/main.cpp
HDRS := $(wildcard src/*.h)

CXXFLAGS ?= -O2 -g
CXXFLAGS += -std=c++17 -Wall -Wextra -Wno-unused-parameter -Wno-missing-field-initializers \
            -fvisibility=hidden -mmacosx-version-min=$(MACOS_MIN) -I$(OFX_INCLUDE)
LDFLAGS  += -mmacosx-version-min=$(MACOS_MIN) -framework CoreFoundation -lpthread

OBJS = $(patsubst src/%.cpp,$(BUILD)/obj-$(1)/%.o,$(SRCS))

.PHONY: all universal clean smoke

all: $(TARGET)

$(BUILD)/obj-$(ARCH)/%.o: src/%.cpp $(HDRS) Makefile
	@mkdir -p $(dir $@)
	$(CXX) -arch $(ARCH) $(CXXFLAGS) -c $< -o $@

$(TARGET): $(call OBJS,$(ARCH))
	@mkdir -p $(BUILD)
	$(CXX) -arch $(ARCH) $^ $(LDFLAGS) -o $@
	@echo "built $@"

universal:
	$(MAKE) ARCH=arm64 BUILD=$(BUILD)/arm64
	$(MAKE) ARCH=x86_64 BUILD=$(BUILD)/x86_64
	@mkdir -p $(BUILD)
	lipo -create $(BUILD)/arm64/avpe-ofx-host $(BUILD)/x86_64/avpe-ofx-host -output $(TARGET)
	@echo "built universal $(TARGET)"

smoke: $(TARGET)
	./scripts/smoke.sh

clean:
	rm -rf $(BUILD)
