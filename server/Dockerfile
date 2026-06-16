FROM node:20-slim

# yt-dlp needs python3 + ffmpeg; unzip is for the Deno installer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

# Deno = the JS runtime yt-dlp uses to solve YouTube's nsig challenge.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

# yt-dlp + the bgutil PoToken provider plugin. Installing via pip (rather than
# the static binary) lets yt-dlp auto-discover the plugin, which fetches a
# PoToken from the bgutil-provider sidecar so YouTube stops asking us to "sign
# in to confirm you're not a bot".
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp bgutil-ytdlp-pot-provider

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./

ENV CACHE_DIR=/data/cache
ENV PORT=8080
VOLUME ["/data/cache"]
EXPOSE 8080

CMD ["node", "index.js"]
