# ============================================
# Stage 1: Build the Rust server binary
# ============================================
FROM rust:1.93-bookworm AS builder

ARG BUILD_MODE=release
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG APT_MIRROR=mirrors.aliyun.com
ENV http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY \
    HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY

WORKDIR /build

# Install build dependencies for bundled sqlcipher + openssl
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|deb.debian.org|${APT_MIRROR}|g; s|security.debian.org|${APT_MIRROR}|g" \
        /etc/apt/sources.list /etc/apt/sources.list.d/*.sources 2>/dev/null || true; \
    fi \
    && apt-get update && apt-get install -y \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for dependency caching
COPY agent-server-rust/Cargo.toml agent-server-rust/Cargo.lock* ./
# Create dummy src for dependency build
RUN mkdir -p src && echo 'fn main() {}' > src/main.rs
RUN if [ "$BUILD_MODE" = "debug" ]; then cargo build 2>/dev/null || true; else cargo build --release 2>/dev/null || true; fi
# Remove dummy build artifacts
RUN rm -rf src target/release/deps/agent_server* target/debug/deps/agent_server*

# Copy actual source and migrations, then build
COPY agent-server-rust/src ./src
COPY agent-server-rust/migrations ./migrations
RUN if [ "$BUILD_MODE" = "debug" ]; then cargo build; else cargo build --release; fi

# Copy binary to a known location regardless of build mode
RUN mkdir -p /output && cp target/${BUILD_MODE}/agent-server /output/agent-server

# ============================================
# Stage 2: Final runtime image
# ============================================
FROM ubuntu:22.04

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG APT_MIRROR=mirrors.aliyun.com
ENV http_proxy=$HTTP_PROXY https_proxy=$HTTPS_PROXY \
    HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY
ENV DEBIAN_FRONTEND=noninteractive

# ============================================
# System packages
# ============================================
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i "s|archive.ubuntu.com|${APT_MIRROR}|g; s|security.ubuntu.com|${APT_MIRROR}|g" /etc/apt/sources.list; \
    fi \
    && apt-get update && apt-get install -y \
    # Display
    xvfb fluxbox x11vnc \
    # Input automation
    xdotool scrot \
    # Accessibility
    at-spi2-core gir1.2-atspi-2.0 python3 python3-gi \
    # Notifications
    dunst libnotify-bin \
    # Fonts
    fonts-noto-cjk \
    # System
    dbus dbus-x11 ca-certificates curl tzdata \
    # WeChat dependencies (basic)
    libatomic1 libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libgbm1 libglib2.0-0 libgtk-3-0 libnss3 libx11-6 \
    libxkbcommon0 libxkbcommon-x11-0 libxcb-icccm4 \
    libxcb-image0 libxcb-keysyms1 libxcb-render-util0 libxss1 \
    # Audio - needed for message notifications
    pulseaudio alsa-base alsa-utils \
    gstreamer1.0-pulseaudio gstreamer1.0-alsa \
    # Media conversion (WXGF¡úJPEG/GIF, SILK¡úMP3)
    ffmpeg \
    # Clipboard (for paste-image tool)
    xclip \
    # Transparent proxy
    redsocks iptables \
    # SQLCipher build deps (temp, for compiling sqlcipher CLI)
    libssl-dev build-essential tcl \
    # Python packages for tools
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# ============================================
# Python packages
# ============================================
RUN pip3 install frida-tools silk-python

# ============================================
# noVNC (browser-based VNC viewer) + websockify
# ============================================
ARG NOVNC_VERSION=1.5.0
RUN pip3 install websockify \
    && curl -L https://github.com/novnc/noVNC/archive/refs/tags/v${NOVNC_VERSION}.tar.gz | tar xz -C /opt \
    && mv /opt/noVNC-${NOVNC_VERSION} /opt/novnc

# ============================================
# SQLCipher 4 CLI (needed for wechat-db reads)
# ============================================
RUN cd /tmp \
    && curl -L https://github.com/sqlcipher/sqlcipher/archive/refs/tags/v4.6.1.tar.gz | tar xz \
    && cd sqlcipher-4.6.1 \
    && ./configure --enable-tempstore=yes CFLAGS="-DSQLITE_HAS_CODEC -DSQLCIPHER_CRYPTO_OPENSSL" LDFLAGS="-lcrypto" \
    && make -j$(nproc) \
    && cp sqlcipher /usr/local/bin/sqlcipher \
    && cd / && rm -rf /tmp/sqlcipher-4.6.1

# ============================================
# X11 socket directory
# ============================================
RUN mkdir -p /tmp/.X11-unix && chown root:root /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# ============================================
# WeChat
# If docker/wechat.deb exists in the build context, it is used directly.
# Otherwise the .deb is downloaded at build time (CI path).
# Run `pnpm download:wechat` to cache locally for faster builds.
# ============================================
ARG TARGETARCH
COPY wechat.de[b] /tmp/
RUN if [ -f /tmp/wechat.deb ]; then \
      echo "Installing WeChat from local .deb"; \
    else \
      ARCH_SUFFIX=$([ "$TARGETARCH" = "arm64" ] && echo "arm64" || echo "x86_64") \
      && echo "Downloading WeChat for ${ARCH_SUFFIX}..." \
      && curl -L -o /tmp/wechat.deb "https://dldir1v6.qq.com/weixin/Universal/Linux/WeChatLinux_${ARCH_SUFFIX}.deb"; \
    fi \
    && (dpkg -i /tmp/wechat.deb || (apt-get update && apt-get install -y -f)) \
    && rm -rf /var/lib/apt/lists/* /tmp/wechat.deb

RUN useradd -m -s /bin/bash wechat

# ============================================
# Tool scripts (screenshot, click, type, key, scroll, a11y-dump, etc.)
# ============================================
RUN mkdir -p /opt/tools /opt/cococat/bin
COPY tools/ /opt/tools/
COPY cococat-bin/ /opt/cococat/bin/
RUN chmod +x /opt/tools/* /opt/cococat/bin/*

# ============================================
# Copy Rust binary from builder
# ============================================
COPY --from=builder /output/agent-server /opt/agent-server/agent-server
COPY agent-server-rust/data /opt/agent-server/data

# ============================================
# Debug support (gdbserver for remote debugging)
# ============================================
ARG BUILD_MODE=release
RUN if [ "$BUILD_MODE" = "debug" ]; then \
      apt-get update && apt-get install -y gdbserver && rm -rf /var/lib/apt/lists/*; \
    fi

# ============================================
# Data directory for SQLite
# ============================================
RUN mkdir -p /data && chown wechat:wechat /data
VOLUME /data

# ============================================
# Environment
# ============================================
ENV TZ=Asia/Shanghai
ENV DISPLAY=:99
ENV PATH="/opt/cococat/bin:/opt/tools:$PATH"
ENV COCOCAT_PULSE_SINK=silent
ENV LIBCANBERRA_CACHE_ONLY=1
ENV CANBERRA_CACHE_ONLY=1
ENV AGENT_DB_PATH=/data/agent.db
ENV AGENT_PORT=6174

# ============================================
# Entrypoint
# ============================================
COPY entrypoint.sh /entrypoint.sh
COPY dunst/dunstrc /opt/cococat/dunstrc
RUN chmod +x /entrypoint.sh

EXPOSE 6174 1234

ENTRYPOINT ["/entrypoint.sh"]
