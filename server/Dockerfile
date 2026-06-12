FROM node:20-slim

# yt-dlp needs python3 + ffmpeg; ca-certificates/curl to fetch the static binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

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
# Use the image's Node as yt-dlp's JS runtime (YouTube extraction needs one).
ENV YTDLP_JS_RUNTIME=node
VOLUME ["/data/cache"]
EXPOSE 8080

CMD ["node", "index.js"]
