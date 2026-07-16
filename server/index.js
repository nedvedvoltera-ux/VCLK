require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const { AccessToken, EgressClient } = require("livekit-server-sdk");
const {
  sanitizeAvatarUrl,
  parseAvatarDataUrl,
  getAvatarExtension,
  toSafeSlug,
  parseBasicAuth,
  parseCookies,
  getEgressTroubleshootingHint,
  isEgressNotFoundError,
  createRecordingsSessionToken: createSessionToken,
  verifyRecordingsSessionToken: verifySessionToken,
  isSafeRecordingsNextPath,
} = require("./lib/helpers");
const {
  sanitizeRecordingFileName,
  transcriptArtifactName,
  buildTranscriptionJob,
  mapTranscriptStatusLabel,
  mapTranscriptProgress,
  createMissingTranscriptPayload,
} = require("./lib/transcription");
const { escapeHtml, renderRecordingsArchivePage } = require("./lib/recordingsPage");

const app = express();
app.set("trust proxy", 1);
const port = Number(process.env.PORT || 3101);

const livekitUrl = process.env.LIVEKIT_URL || "ws://localhost:7888";
const livekitHttpUrl =
  process.env.LIVEKIT_HTTP_URL ||
  livekitUrl.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://");
const apiKey = process.env.LIVEKIT_API_KEY || "devkey";
const apiSecret =
  process.env.LIVEKIT_API_SECRET || "supersecretdevkeyforlocaldemo123456";
const recordingOutputPrefix = process.env.RECORDING_OUTPUT_PREFIX || "/out";
const recordingsDir =
  process.env.RECORDINGS_DIR ||
  (path.isAbsolute(recordingOutputPrefix)
    ? recordingOutputPrefix
    : path.resolve(__dirname, "..", "recordings"));
const recordingsViewerUser = process.env.RECORDINGS_VIEW_USER || "viewer";
const recordingsViewerPassword = process.env.RECORDINGS_VIEW_PASSWORD || "";
const recordingsSessionCookie = "recordings_session";
const recordingsSessionTtlMs = 12 * 60 * 60 * 1000;
const recordingsSessionSecret =
  process.env.RECORDINGS_SESSION_SECRET || process.env.LIVEKIT_API_SECRET || apiSecret;
const egressClient = new EgressClient(livekitHttpUrl, apiKey, apiSecret);
const recordingByRoom = new Map();
const avatarById = new Map();
const transcriptionEnabled =
  String(process.env.TRANSCRIPTION_ENABLED || "true").toLowerCase() !== "false";
const redisUrl = process.env.REDIS_URL || "redis://redis:6379/0";
const asrQueueKey = process.env.ASR_QUEUE_KEY || "transcription:jobs";
let redisClient = null;

const getRedisClient = async () => {
  if (!transcriptionEnabled) {
    return null;
  }
  if (redisClient?.isOpen) {
    return redisClient;
  }
  const { createClient } = require("redis");
  redisClient = createClient({ url: redisUrl });
  redisClient.on("error", (error) => {
    console.error("Redis error:", error?.message || error);
  });
  await redisClient.connect();
  return redisClient;
};

const readTranscriptArtifact = async (fileName) => {
  const safe = sanitizeRecordingFileName(fileName);
  if (!safe) {
    return createMissingTranscriptPayload(fileName);
  }
  const artifactFile = transcriptArtifactName(safe);
  const fullPath = path.join(recordingsDir, artifactFile);
  try {
    const raw = await fs.readFile(fullPath, "utf8");
    const parsed = JSON.parse(raw);
    return { ...parsed, fileName: safe };
  } catch {
    return createMissingTranscriptPayload(safe);
  }
};

const enqueueTranscription = async (fileName, mode = "full") => {
  const job = buildTranscriptionJob({ fileName, mode });
  if (!job) {
    return { ok: false, error: "Invalid recording file name" };
  }
  if (!transcriptionEnabled) {
    return { ok: false, error: "Transcription is disabled" };
  }

  const artifactPath = path.join(recordingsDir, transcriptArtifactName(job.fileName));
  const queuedPayload = {
    version: 1,
    status: "queued",
    fileName: job.fileName,
    engine: "faster-whisper",
    error: null,
    progress: 12,
    progressIndeterminate: true,
    segments: [],
    text: "",
    summary: { status: "pending", text: "", error: null },
    diarization: { enabled: false },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (mode === "summarize_only") {
    const existing = await readTranscriptArtifact(job.fileName);
    queuedPayload.text = existing.text || "";
    queuedPayload.segments = existing.segments || [];
    queuedPayload.status = "summarizing";
    queuedPayload.progress = 85;
  }
  await fs.writeFile(artifactPath, JSON.stringify(queuedPayload, null, 2), "utf8");

  try {
    const client = await getRedisClient();
    if (!client) {
      return { ok: false, error: "Redis is not available" };
    }
    await client.rPush(asrQueueKey, JSON.stringify(job));
    return { ok: true, job };
  } catch (error) {
    queuedPayload.status = "error";
    queuedPayload.error = String(error?.message || error);
    await fs.writeFile(artifactPath, JSON.stringify(queuedPayload, null, 2), "utf8");
    return { ok: false, error: queuedPayload.error };
  }
};

const fileNameFromRecordingPath = (filePath) => {
  if (!filePath) {
    return "";
  }
  return sanitizeRecordingFileName(path.basename(String(filePath)));
};

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const buildToken = async ({ roomName, username, avatarUrl }) => {
  const metadata =
    typeof avatarUrl === "string" && avatarUrl.length > 0
      ? JSON.stringify({ avatarUrl })
      : undefined;
  const token = new AccessToken(apiKey, apiSecret, {
    identity: username,
    name: username,
    ttl: "2h",
    metadata,
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canUpdateOwnMetadata: true,
  });

  return token.toJwt();
};

app.post("/avatar", (req, res) => {
  const parsed = parseAvatarDataUrl(req.body?.imageDataUrl);
  if (!parsed) {
    return res.status(400).json({ error: "imageDataUrl must be a valid data:image URL" });
  }
  const id = `${crypto.randomUUID()}.${getAvatarExtension(parsed.mimeType)}`;
  avatarById.set(id, {
    mimeType: parsed.mimeType,
    buffer: parsed.buffer,
    createdAt: Date.now(),
  });
  return res.json({ ok: true, avatarUrl: `/avatar/${id}` });
});

app.get("/avatar/:id", (req, res) => {
  const id = String(req.params.id || "");
  const avatar = avatarById.get(id);
  if (!avatar) {
    return res.status(404).send("Avatar not found");
  }
  res.set("Content-Type", avatar.mimeType);
  res.set("Cache-Control", "public, max-age=86400");
  return res.send(avatar.buffer);
});

const handleTokenRequest = async ({ roomName, username, avatarUrl, res }) => {
  if (!roomName || !username) {
    return res.status(400).json({
      error: "Both query params are required: room and username",
    });
  }

  try {
    const jwt = await buildToken({
      roomName,
      username,
      avatarUrl: sanitizeAvatarUrl(avatarUrl),
    });

    return res.json({
      token: jwt,
      livekitUrl,
    });
  } catch (error) {
    console.error("Failed to create token:", error);
    return res.status(500).json({ error: "Failed to create access token" });
  }
};

app.get("/token", async (req, res) => {
  await handleTokenRequest({
    roomName: String(req.query.room || "").trim(),
    username: String(req.query.username || "").trim(),
    avatarUrl: req.query.avatarUrl,
    res,
  });
});

app.post("/token", async (req, res) => {
  await handleTokenRequest({
    roomName: String(req.body?.room || "").trim(),
    username: String(req.body?.username || "").trim(),
    avatarUrl: req.body?.avatarUrl,
    res,
  });
});

const createRecordingsSessionToken = () =>
  createSessionToken({
    user: recordingsViewerUser,
    secret: recordingsSessionSecret,
    ttlMs: recordingsSessionTtlMs,
  });

const verifyRecordingsSessionToken = (token) =>
  verifySessionToken(token, {
    user: recordingsViewerUser,
    secret: recordingsSessionSecret,
  });

const isRecordingsAuthorized = (req) => {
  if (!recordingsViewerPassword) {
    return false;
  }
  const credentials = parseBasicAuth(req.headers.authorization);
  if (
    credentials &&
    credentials.username === recordingsViewerUser &&
    credentials.password === recordingsViewerPassword
  ) {
    return true;
  }
  const cookies = parseCookies(req.headers.cookie);
  return verifyRecordingsSessionToken(cookies[recordingsSessionCookie]);
};

const setRecordingsSessionCookie = (res, req) => {
  const token = createRecordingsSessionToken();
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  const parts = [
    `${recordingsSessionCookie}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(recordingsSessionTtlMs / 1000)}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
};

const clearRecordingsSessionCookie = (res) => {
  res.setHeader("Set-Cookie", `${recordingsSessionCookie}=; Path=/; HttpOnly; Max-Age=0`);
};

const renderRecordingsLoginPage = ({ error = false, nextPath = "/recordings" } = {}) => {
  const safeNext = isSafeRecordingsNextPath(nextPath) ? nextPath : "/recordings";
  const errorHtml = error
    ? '<p class="error">Неверный логин или пароль. Попробуйте снова.</p>'
    : "";

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Вход — записи встреч</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Arial, sans-serif;
        background: #0b1220;
        color: #e2e8f0;
      }
      .card {
        width: min(420px, calc(100vw - 32px));
        border: 1px solid #334155;
        border-radius: 14px;
        background: #111827;
        padding: 24px;
        box-shadow: 0 16px 40px rgba(2, 6, 23, 0.45);
      }
      h1 { margin: 0 0 8px; font-size: 24px; }
      p { margin: 0 0 16px; color: #94a3b8; line-height: 1.5; }
      label { display: grid; gap: 6px; margin-bottom: 14px; font-size: 14px; }
      input {
        border: 1px solid #475569;
        border-radius: 8px;
        background: #0f172a;
        color: #f8fafc;
        padding: 10px 12px;
        font-size: 15px;
      }
      button {
        width: 100%;
        border: 0;
        border-radius: 8px;
        background: #2563eb;
        color: #fff;
        padding: 11px 14px;
        font-size: 15px;
        cursor: pointer;
      }
      button:hover { background: #1d4ed8; }
      .error {
        margin: 0 0 14px;
        padding: 10px 12px;
        border-radius: 8px;
        background: rgba(239, 68, 68, 0.12);
        border: 1px solid rgba(239, 68, 68, 0.35);
        color: #fecaca;
      }
    </style>
  </head>
  <body>
    <form class="card" method="post" action="/recordings/login">
      <h1>Записи встреч</h1>
      <p>Введите логин и пароль для просмотра архива записей.</p>
      ${errorHtml}
      <input type="hidden" name="next" value="${safeNext.replace(/"/g, "&quot;")}" />
      <label>
        Логин
        <input name="username" autocomplete="username" required />
      </label>
      <label>
        Пароль
        <input name="password" type="password" autocomplete="current-password" required />
      </label>
      <button type="submit">Войти</button>
    </form>
  </body>
</html>`;
};

const requireRecordingsAuth = (req, res, next) => {
  if (!recordingsViewerPassword) {
    return res.status(503).send("Recordings viewer password is not configured");
  }

  if (isRecordingsAuthorized(req)) {
    return next();
  }

  if (req.method === "GET" && req.accepts("html")) {
    const nextPath = req.originalUrl || "/recordings";
    return res.redirect(`/recordings/login?next=${encodeURIComponent(nextPath)}`);
  }

  return res.status(401).json({ error: "Authentication required" });
};

app.get("/recordings/login", (req, res) => {
  if (!recordingsViewerPassword) {
    return res.status(503).send("Recordings viewer password is not configured");
  }
  if (isRecordingsAuthorized(req)) {
    const nextPath = String(req.query.next || "/recordings");
    return res.redirect(isSafeRecordingsNextPath(nextPath) ? nextPath : "/recordings");
  }
  const nextPath = String(req.query.next || "/recordings");
  const hasError = String(req.query.error || "") === "1";
  return res.status(200).send(renderRecordingsLoginPage({ error: hasError, nextPath }));
});

app.post(
  "/recordings/login",
  express.urlencoded({ extended: false }),
  (req, res) => {
    if (!recordingsViewerPassword) {
      return res.status(503).send("Recordings viewer password is not configured");
    }

    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const nextPath = String(req.body?.next || "/recordings");
    const safeNext = isSafeRecordingsNextPath(nextPath) ? nextPath : "/recordings";

    if (username === recordingsViewerUser && password === recordingsViewerPassword) {
      setRecordingsSessionCookie(res, req);
      return res.redirect(safeNext);
    }

    return res.redirect(
      `/recordings/login?error=1&next=${encodeURIComponent(safeNext)}`,
    );
  },
);

app.get("/recordings/logout", (req, res) => {
  clearRecordingsSessionCookie(res);
  return res.redirect("/recordings/login");
});
app.use(
  "/recordings/files",
  requireRecordingsAuth,
  express.static(recordingsDir, {
    index: false,
  }),
);

app.get("/recordings/:file/transcript", requireRecordingsAuth, async (req, res) => {
  const safe = sanitizeRecordingFileName(req.params.file);
  if (!safe) {
    return res.status(400).json({ error: "Invalid file name" });
  }
  const artifact = await readTranscriptArtifact(safe);
  return res.json({
    ok: true,
    fileName: safe,
    label: mapTranscriptStatusLabel(artifact),
    progress: mapTranscriptProgress(artifact),
    transcript: artifact,
  });
});

app.post("/recordings/:file/transcribe", requireRecordingsAuth, async (req, res) => {
  const safe = sanitizeRecordingFileName(req.params.file);
  if (!safe) {
    return res.status(400).json({ error: "Invalid file name" });
  }
  const result = await enqueueTranscription(safe, "full");
  if (!result.ok) {
    return res.status(500).json({ error: result.error || "Failed to enqueue" });
  }
  return res.json({ ok: true, job: result.job });
});

app.post("/recordings/:file/summarize", requireRecordingsAuth, async (req, res) => {
  const safe = sanitizeRecordingFileName(req.params.file);
  if (!safe) {
    return res.status(400).json({ error: "Invalid file name" });
  }
  const existing = await readTranscriptArtifact(safe);
  if (!existing.text) {
    return res.status(400).json({ error: "Transcript text is not ready yet" });
  }
  const result = await enqueueTranscription(safe, "summarize_only");
  if (!result.ok) {
    return res.status(500).json({ error: result.error || "Failed to enqueue summary" });
  }
  return res.json({ ok: true, job: result.job });
});

app.get("/recordings", requireRecordingsAuth, async (req, res) => {
  try {
    const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
    const videos = (
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4"))
          .map(async (entry) => {
            const fullPath = path.join(recordingsDir, entry.name);
            const stats = await fs.stat(fullPath);
            const transcript = await readTranscriptArtifact(entry.name);
            const progress = mapTranscriptProgress(transcript);
            return {
              name: entry.name,
              mtimeMs: stats.mtimeMs,
              sizeMb: (stats.size / 1024 / 1024).toFixed(2),
              transcriptStatus: transcript.status || "missing",
              transcriptLabel: mapTranscriptStatusLabel(transcript),
              progress,
            };
          }),
      )
    ).sort((a, b) => b.mtimeMs - a.mtimeMs);

    const selected = videos[0]?.name || "";
    const listHtml = videos.length
      ? videos
          .map((video) => {
            const canOpen =
              video.transcriptStatus === "done" ||
              video.transcriptStatus === "transcribing" ||
              video.transcriptStatus === "summarizing" ||
              video.transcriptStatus === "queued" ||
              video.transcriptStatus === "error";
            const showStart =
              video.transcriptStatus === "missing" || video.transcriptStatus === "error";
            const busy =
              video.transcriptStatus === "queued" ||
              video.transcriptStatus === "transcribing" ||
              video.transcriptStatus === "summarizing";
            const chipClass =
              video.transcriptStatus === "done"
                ? "ok"
                : video.transcriptStatus === "error"
                  ? "err"
                  : busy
                    ? "busy"
                    : "";
            const progressVisible =
              busy || video.transcriptStatus === "error" ? "block" : "none";
            const progressWidth = Math.max(8, video.progress?.percent || 0);
            const indeterminateClass =
              video.progress?.indeterminate && busy ? "is-indeterminate" : "";
            return `<li class="rec-item${req.query.file === video.name ? " is-active" : ""}" data-file="${encodeURIComponent(video.name)}" data-busy="${busy ? "1" : "0"}">
              <div class="rec-main">
                <a href="/recordings?file=${encodeURIComponent(video.name)}">${escapeHtml(video.name)}</a>
                <div class="rec-meta">
                  <span class="chip">${video.sizeMb} MB</span>
                  <span class="chip ${chipClass}" data-status-for="${encodeURIComponent(video.name)}">${escapeHtml(video.transcriptLabel)}</span>
                </div>
                <div class="progress ${indeterminateClass}" data-progress-for="${encodeURIComponent(video.name)}" style="display:${progressVisible}">
                  <i style="width:${progressWidth}%"></i>
                </div>
              </div>
              <div class="rec-actions">
                <button type="button" class="btn-secondary" data-open-transcript="${encodeURIComponent(video.name)}" ${canOpen ? "" : "disabled"}>Транскрипт</button>
                ${
                  showStart
                    ? `<button type="button" class="btn" data-start-transcript="${encodeURIComponent(video.name)}">Запустить</button>`
                    : ""
                }
              </div>
            </li>`;
          })
          .join("")
      : '<li class="empty">Нет записей</li>';

    const selectedFile = String(req.query.file || selected);
    const safeSelectedFile = path.basename(selectedFile);
    const playerHtml =
      safeSelectedFile && videos.some((video) => video.name === safeSelectedFile)
        ? `<div class="player-shell"><video controls src="/recordings/files/${encodeURIComponent(safeSelectedFile)}"></video></div>`
        : '<p class="empty">Выберите запись из списка.</p>';

    return res.status(200).send(
      renderRecordingsArchivePage({
        listHtml,
        playerHtml,
        selectedFileName: safeSelectedFile,
      }),
    );
  } catch (error) {
    console.error("Failed to render recordings page:", error);
    return res.status(500).send("Не удалось открыть страницу записей");
  }
});

app.post("/recording/start", async (req, res) => {
  const roomName = String(req.body?.room || "").trim();
  if (!roomName) {
    return res.status(400).json({ error: "Field 'room' is required" });
  }

  const existing = recordingByRoom.get(roomName);
  if (existing) {
    return res.json({
      ok: true,
      room: roomName,
      egressId: existing.egressId,
      status: "EGRESS_ACTIVE",
      alreadyRunning: true,
    });
  }

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileSlug = `${toSafeSlug(roomName)}-${timestamp}.mp4`;
    const filePath = `${recordingOutputPrefix}/${fileSlug}`;

    const egressInfo = await egressClient.startRoomCompositeEgress(
      roomName,
      { filepath: filePath },
      {
        layout: "grid-light",
      },
    );

    recordingByRoom.set(roomName, { egressId: egressInfo.egressId, filePath });

    return res.json({
      ok: true,
      room: roomName,
      egressId: egressInfo.egressId,
      status: egressInfo.status,
      filePath,
    });
  } catch (error) {
    console.error("Failed to start recording:", error);
    const hint = getEgressTroubleshootingHint(error);
    return res.status(500).json({
      error: `Не удалось запустить запись. ${hint}`,
      details: String(error?.message || "unknown error"),
    });
  }
});

app.post("/recording/stop", async (req, res) => {
  const roomName = String(req.body?.room || "").trim();
  const egressIdFromBody = String(req.body?.egressId || "").trim();
  const active = roomName ? recordingByRoom.get(roomName) : null;
  const egressId = egressIdFromBody || active?.egressId;
  const knownFileName = fileNameFromRecordingPath(active?.filePath);

  if (!egressId) {
    return res.status(400).json({
      error: "Field 'egressId' or known active recording for this room is required",
    });
  }

  const clearLocalRecordingState = () => {
    if (roomName) {
      recordingByRoom.delete(roomName);
    } else {
      for (const [key, value] of recordingByRoom.entries()) {
        if (value.egressId === egressId) {
          recordingByRoom.delete(key);
          break;
        }
      }
    }
  };

  try {
    const result = await egressClient.stopEgress(egressId);
    clearLocalRecordingState();

    let transcription = null;
    if (knownFileName) {
      // Egress may still finalize the mp4; worker retries/errors if missing.
      setTimeout(() => {
        void enqueueTranscription(knownFileName, "full");
      }, 2500);
      transcription = { queued: true, fileName: knownFileName };
    }

    return res.json({
      ok: true,
      egressId,
      status: result.status,
      transcription,
    });
  } catch (error) {
    // Egress often dies on its own (Chrome timeout / OOM). Treat as already stopped.
    if (isEgressNotFoundError(error)) {
      clearLocalRecordingState();
      return res.json({
        ok: true,
        egressId,
        status: "EGRESS_COMPLETE",
        alreadyStopped: true,
        warning:
          "Запись уже была остановлена сервисом (часто из‑за нехватки RAM или сбоя Chrome).",
      });
    }
    console.error("Failed to stop recording:", error);
    const hint = getEgressTroubleshootingHint(error);
    return res.status(500).json({
      error: `Не удалось остановить запись. ${hint}`,
      details: String(error?.message || "unknown error"),
    });
  }
});

app.get("/recording/status", async (req, res) => {
  const roomName = String(req.query.room || "").trim();
  if (!roomName) {
    return res.status(400).json({ error: "Query param 'room' is required" });
  }

  try {
    const list = await egressClient.listEgress({ roomName, active: true });
    const active = list.find((item) => item.roomName === roomName);
    if (active) {
      recordingByRoom.set(roomName, {
        egressId: active.egressId,
        filePath: recordingByRoom.get(roomName)?.filePath || null,
      });
    } else {
      recordingByRoom.delete(roomName);
    }

    return res.json({
      ok: true,
      room: roomName,
      recording: active
        ? {
            active: true,
            egressId: active.egressId,
            status: active.status,
            startedAt: active.startedAt ? String(active.startedAt) : null,
            filePath: recordingByRoom.get(roomName)?.filePath || null,
          }
        : { active: false },
    });
  } catch (error) {
    console.error("Failed to get recording status:", error);
    const hint = getEgressTroubleshootingHint(error);
    return res.status(500).json({
      error: `Не удалось получить статус записи. ${hint}`,
      details: String(error?.message || "unknown error"),
    });
  }
});

app.listen(port, () => {
  console.log(`Token server listening on http://localhost:${port}`);
});
