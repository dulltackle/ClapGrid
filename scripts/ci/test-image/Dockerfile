# Ubuntu 24.04 / amd64，含与锁文件一致的 Playwright 浏览器及系统库。
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:ee15712262f017b8157421b212b12099146645f44b1bc5c0514cbbe6a229b1d0

ARG NODE_VERSION=22.23.4
ARG NODE_SHA256=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce
ARG CHROME_VERSION=131.0.6778.204
ARG CHROME_SHA256=fba7d5e87cdcf0dc974c9ac8a0a9dbcf5686c935455d5e6beed337c6ada88bc2
ENV PATH="/opt/clapgrid-node/bin:${PATH}" \
    CHROME_BIN=/opt/clapgrid-chrome/chrome-linux64/chrome \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

LABEL org.opencontainers.image.source="https://github.com/dulltackle/ClapGrid" \
      org.opencontainers.image.description="ClapGrid CI test environment"

RUN set -eux; \
    sed -i -e 's|http://archive.ubuntu.com/|https://archive.ubuntu.com/|g' -e 's|http://security.ubuntu.com/|https://security.ubuntu.com/|g' /etc/apt/sources.list.d/ubuntu.sources; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl ffmpeg fontconfig fonts-noto-cjk git strace time unzip xz-utils; \
    rm -rf /var/lib/apt/lists/*; \
    curl -fsSL --retry 3 -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"; \
    echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c -; \
    mkdir -p /opt/clapgrid-node; \
    tar -xJf /tmp/node.tar.xz -C /opt/clapgrid-node --strip-components=1; \
    curl -fsSL --retry 3 -o /tmp/chrome.zip "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip"; \
    echo "${CHROME_SHA256}  /tmp/chrome.zip" | sha256sum -c -; \
    unzip -q /tmp/chrome.zip -d /opt/clapgrid-chrome; \
    rm /tmp/node.tar.xz /tmp/chrome.zip; \
    test "$(node -p 'process.versions.node')" = "$NODE_VERSION"; \
    "$CHROME_BIN" --version | grep -F "$CHROME_VERSION"
