FROM public.ecr.aws/lambda/python:3.12

# ffmpeg is required by yt-dlp to merge separate video/audio streams and is
# not available in the base Lambda image, so we pull a static build.
RUN dnf install -y tar xz && dnf clean all && \
    curl -fL --retry 5 --retry-delay 5 --retry-all-errors \
      -o /tmp/ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    mkdir -p /tmp/ffmpeg-extract && \
    tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-extract --strip-components=1 && \
    cp /tmp/ffmpeg-extract/ffmpeg /tmp/ffmpeg-extract/ffprobe /usr/local/bin/ && \
    chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe && \
    rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-extract

ENV PATH="/usr/local/bin:${PATH}"

# Node.js + the bgutil-ytdlp-pot-provider "script" mode generate a YouTube PO
# (Proof-of-Origin) token per request. Without one, YouTube increasingly
# blocks yt-dlp as bot traffic even with valid cookies. Script mode shells
# out to a plain Node process per download instead of running an always-on
# server, so bundling Node + the provider into this image avoids running any
# extra always-on AWS infrastructure.
#
# Installed from the official upstream tarball rather than a distro package
# repo (e.g. NodeSource's dnf repo): the provider requires Node >= 20 and
# Amazon Linux 2023's own package repos / NodeSource's AL2023 support are not
# reliable enough to trust silently - if this ever pulls a too-old Node, the
# smoke test a few lines down will fail the build loudly instead of the
# provider silently being unavailable at runtime.
ARG NODE_VERSION=20.18.1
RUN dnf install -y git tar xz && \
    curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" && \
    mkdir -p /opt/nodejs && \
    tar -xJf /tmp/node.tar.xz -C /opt/nodejs --strip-components=1 && \
    rm -f /tmp/node.tar.xz && \
    dnf clean all

ENV PATH="/opt/nodejs/bin:${PATH}"

RUN node --version && \
    node -e "if (Number(process.versions.node.split('.')[0]) < 20) { console.error('Node >= 20 required, got ' + process.versions.node); process.exit(1); }"

# The final `test` here is a build-time smoke test: it fails the image build
# loudly (with logs) rather than silently deploying a Lambda where the PO
# token provider can't actually run (missing native deps, bad build output,
# wrong Node version, etc).
RUN git clone --branch 1.3.1 --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-ytdlp-pot-provider && \
    cd /opt/bgutil-ytdlp-pot-provider/server && \
    npm ci && \
    npx tsc && \
    npm prune --omit=dev && \
    rm -rf /opt/bgutil-ytdlp-pot-provider/.git && \
    test "$(node build/generate_once.js --version)" = "1.3.1"

COPY requirements.txt ${LAMBDA_TASK_ROOT}
RUN pip install --no-cache-dir -r requirements.txt

COPY handler.py ${LAMBDA_TASK_ROOT}

CMD ["handler.handler"]
