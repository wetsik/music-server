"use strict";

const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// --- config (all overridable via env) --------------------------------------
const PORT = process.env.PORT || 8080;
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, "cache");
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const FORMAT = process.env.YTDLP_FORMAT || "bestaudio[ext=m4a]/bestaudio";
// yt-dlp needs a JS runtime for YouTube. The Docker image ships Node, so we
// point yt-dlp at it (`node`); leave empty to use yt-dlp's default (deno).
const JS_RUNTIME = process.env.YTDLP_JS_RUNTIME || "";
// Base URL of the bgutil PoToken provider sidecar. When set, yt-dlp fetches a
// PoToken from it to pass YouTube's bot check (no manual cookie refresh).
const POT_BASEURL = process.env.YTDLP_POT_BASEURL || "";
// YouTube's nsig challenge now needs yt-dlp's EJS solver script, which it
// downloads on demand from GitHub (cached). Without this, extraction fails with
// "n challenge solving failed". Set empty to disable.
const REMOTE_COMPONENTS = process.env.YTDLP_REMOTE_COMPONENTS || "ejs:github";
const MAX_CACHE_MB = Number(process.env.MAX_CACHE_MB || 2048);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || ""; // if set, requests must carry it
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
// IP-block mitigation: paste a Netscape cookies.txt into COOKIES_CONTENT, or
// point COOKIES_FILE at an existing file. Optional.
const COOKIES_FILE = (() => {
  if (process.env.COOKIES_FILE) return process.env.COOKIES_FILE;
  if (process.env.COOKIES_CONTENT) {
    const p = path.join(CACHE_DIR, "cookies.txt");
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(p, process.env.COOKIES_CONTENT);
    return p;
  }
  return "";
})();

fs.mkdirSync(CACHE_DIR, { recursive: true });

const app = express();
const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MIME = {
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".webm": "audio/webm",
  ".opus": "audio/ogg",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
};

const inflight = new Map(); // videoId -> Promise<filePath>

function cachedFile(id) {
  const hit = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.startsWith(id + ".") && !f.endsWith(".part"));
  return hit.length ? path.join(CACHE_DIR, hit[0]) : null;
}

function pruneCache() {
  try {
    const files = fs
      .readdirSync(CACHE_DIR)
      .filter((f) => f !== "cookies.txt")
      .map((f) => {
        const fp = path.join(CACHE_DIR, f);
        const st = fs.statSync(fp);
        return { fp, size: st.size, atime: st.atimeMs };
      });
    let total = files.reduce((s, f) => s + f.size, 0);
    const limit = MAX_CACHE_MB * 1024 * 1024;
    if (total <= limit) return;
    files.sort((a, b) => a.atime - b.atime); // oldest accessed first
    for (const f of files) {
      if (total <= limit) break;
      try {
        fs.unlinkSync(f.fp);
        total -= f.size;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function download(id) {
  if (inflight.has(id)) return inflight.get(id);
  const job = new Promise((resolve, reject) => {
    const existing = cachedFile(id);
    if (existing) return resolve(existing);

    const out = path.join(CACHE_DIR, `${id}.%(ext)s`);
    const args = [
      "-f", FORMAT,
      "--no-playlist",
      "--no-part",
      "--no-progress",
      "--quiet",
      "-o", out,
    ];
    if (REMOTE_COMPONENTS) args.push("--remote-components", REMOTE_COMPONENTS);
    if (JS_RUNTIME) args.push("--js-runtimes", JS_RUNTIME);
    if (POT_BASEURL) {
      args.push("--extractor-args", `youtubepot-bgutilhttp:base_url=${POT_BASEURL}`);
    }
    if (COOKIES_FILE) args.push("--cookies", COOKIES_FILE);
    args.push(`https://www.youtube.com/watch?v=${id}`);

    const proc = spawn(YTDLP, args);
    let err = "";
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) =>
      reject(new Error(`spawn yt-dlp failed: ${e.message}`))
    );
    proc.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp exited ${code}: ${err.slice(-500)}`));
      }
      const f = cachedFile(id);
      if (f) {
        pruneCache();
        resolve(f);
      } else {
        reject(new Error("yt-dlp produced no output file"));
      }
    });
  }).finally(() => inflight.delete(id));

  inflight.set(id, job);
  return job;
}

function serve(req, res, filePath) {
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "public, max-age=86400");

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= total) end = total - 1;
    if (start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.status(200);
    res.setHeader("Content-Length", total);
    fs.createReadStream(filePath).pipe(res);
  }
}

// --- middleware ------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Range, X-Access-Token");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function checkToken(req, res, next) {
  if (!ACCESS_TOKEN) return next();
  const t = req.query.token || req.headers["x-access-token"];
  if (t === ACCESS_TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
}

// --- routes ----------------------------------------------------------------
// Keep-alive target for an external uptime pinger (Render Free anti-sleep).
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Stream a track's audio. The phone plays this URL directly (live or cached).
app.get("/stream/:id", checkToken, async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return res.status(400).json({ error: "bad video id" });
  try {
    let file = cachedFile(id);
    if (!file) file = await download(id);
    fs.utimesSync(file, new Date(), fs.statSync(file).mtime); // touch atime for LRU
    serve(req, res, file);
  } catch (e) {
    console.error("stream error", id, e.message);
    res.status(502).json({ error: "extract failed", detail: String(e.message || e) });
  }
});

// Warm the cache for upcoming tracks without streaming (optional prefetch).
app.get("/prefetch/:id", checkToken, async (req, res) => {
  const id = req.params.id;
  if (!ID_RE.test(id)) return res.status(400).json({ error: "bad video id" });
  try {
    await download(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

// Report which of the given ids are actually YouTube Shorts. A real Short stays
// on /shorts/<id>; a normal video redirects to /watch. Used by the native app
// to filter Shorts out of search results (the YouTube API has no Shorts flag).
app.get("/shorts", checkToken, async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ID_RE.test(s));
  if (!ids.length) return res.json({ shorts: [] });

  const shorts = [];
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const r = await fetch(`https://www.youtube.com/shorts/${id}`, {
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          signal: AbortSignal.timeout(6000),
        });
        try { await r.body?.cancel(); } catch { /* ignore */ }
        // After following redirects: still /shorts/ → Short; else → normal video.
        if (r.url.includes("/shorts/")) shorts.push(id);
      } catch {
        /* network error — don't classify as a Short */
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  res.json({ shorts });
});

// "Radio" / wave: given a seed video id, return similar songs from YouTube's
// own Mix playlist (RD<id>) via yt-dlp. This is the recommendation graph that
// powers "play similar next" without us running any ML.
app.get("/radio", checkToken, (req, res) => {
  const id = String(req.query.id || "");
  if (!ID_RE.test(id)) return res.status(400).json({ error: "bad video id" });
  const limit = Math.max(5, Math.min(Number(req.query.limit) || 25, 50));

  const args = [
    "--flat-playlist",
    "--playlist-end", String(limit),
    "--no-warnings",
    "--print", "%(id)s\t%(duration)s\t%(channel)s\t%(title)s",
  ];
  if (REMOTE_COMPONENTS) args.push("--remote-components", REMOTE_COMPONENTS);
  if (JS_RUNTIME) args.push("--js-runtimes", JS_RUNTIME);
  if (COOKIES_FILE) args.push("--cookies", COOKIES_FILE);
  args.push(`https://www.youtube.com/watch?v=${id}&list=RD${id}`);

  const proc = spawn(YTDLP, args);
  let out = "";
  let err = "";
  proc.stdout.on("data", (d) => (out += d.toString()));
  proc.stderr.on("data", (d) => (err += d.toString()));
  proc.on("error", (e) => res.status(502).json({ error: String(e.message || e) }));
  proc.on("close", (code) => {
    const tracks = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [vid, dur, channel, ...rest] = line.split("\t");
        return {
          id: vid,
          duration: Number(dur) || 0,
          artist: (channel || "").replace(/\s*-\s*Topic$/i, "").trim(),
          title: rest.join("\t") || vid,
        };
      })
      .filter((t) => ID_RE.test(t.id) && t.id !== id);
    if (!tracks.length && code !== 0) {
      return res.status(502).json({ error: err.slice(-300) });
    }
    res.json({ tracks });
  });
});

app.listen(PORT, () => {
  console.log(`westforge-audio-server :${PORT}`);
  console.log(`  cache=${CACHE_DIR} (max ${MAX_CACHE_MB} MB)`);
  console.log(`  cookies=${COOKIES_FILE || "(none)"}  token=${ACCESS_TOKEN ? "on" : "off"}`);
});
