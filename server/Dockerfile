FROM node:20-slim

# yt-dlp needs python3 + ffmpeg; unzip is for the Deno installer.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

# Deno = the JS runtime yt-dlp uses to solve YouTube's JS challenge (nsig/
# PoToken). Without it, recent YouTube returns "Video unavailable" on
# datacenter IPs. yt-dlp auto-detects deno on PATH.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

# Static yt-dlp binary (updates more reliably than the distro package).
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./

ENV CACHE_DIR=/data/cache
ENV PORT=8080
VOLUME ["/data/cache"]
EXPOSE 8080

CMD ["node", "index.js"]
