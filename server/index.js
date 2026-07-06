require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const { AccessToken, EgressClient } = require("livekit-server-sdk");

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
const getEgressTroubleshootingHint = (error) => {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();

  if (message.includes("egress not connected") || message.includes("redis required")) {
    return "Egress не подключен к LiveKit. Запустите Redis и Egress, затем перезапустите LiveKit.";
  }
  if (message.includes("no response from servers") || code === "unavailable") {
    return "Сервис Egress недоступен. Проверьте, что контейнер egress запущен и подключен к Redis.";
  }
  return "Проверьте LiveKit API URL, ключи и состояние сервисов LiveKit/Redis/Egress.";
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

const sanitizeAvatarUrl = (value) => {
  const avatarUrl = String(value || "").trim();
  if (!avatarUrl.startsWith("/avatar/")) {
    return "";
  }
  return avatarUrl;
};

const parseAvatarDataUrl = (imageDataUrl) => {
  const value = String(imageDataUrl || "").trim();
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) {
    return null;
  }
  const mimeType = match[1];
  const base64Payload = match[2];
  const buffer = Buffer.from(base64Payload, "base64");
  if (buffer.length === 0 || buffer.length > 256 * 1024) {
    return null;
  }
  return { mimeType, buffer };
};

const getAvatarExtension = (mimeType) => {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "jpg";
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

const toSafeSlug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "room";

const parseBasicAuth = (headerValue) => {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
    return null;
  }
  const base64Part = headerValue.slice("Basic ".length).trim();
  try {
    const decoded = Buffer.from(base64Part, "base64").toString("utf8");
    const splitIndex = decoded.indexOf(":");
    if (splitIndex < 0) {
      return null;
    }
    return {
      username: decoded.slice(0, splitIndex),
      password: decoded.slice(splitIndex + 1),
    };
  } catch {
    return null;
  }
};

const parseCookies = (headerValue) => {
  const cookies = {};
  if (!headerValue) {
    return cookies;
  }
  for (const part of headerValue.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) {
      continue;
    }
    cookies[rawKey] = decodeURIComponent(rawValue.join("=") || "");
  }
  return cookies;
};

const signRecordingsSession = (expiresAt) => {
  const payload = `${recordingsViewerUser}:${expiresAt}`;
  return crypto.createHmac("sha256", recordingsSessionSecret).update(payload).digest("hex");
};

const createRecordingsSessionToken = () => {
  const expiresAt = Date.now() + recordingsSessionTtlMs;
  return `${expiresAt}.${signRecordingsSession(expiresAt)}`;
};

const verifyRecordingsSessionToken = (token) => {
  if (!token) {
    return false;
  }
  const separatorIndex = token.indexOf(".");
  if (separatorIndex < 0) {
    return false;
  }
  const expiresAt = Number(token.slice(0, separatorIndex));
  const signature = token.slice(separatorIndex + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !signature) {
    return false;
  }
  const expected = signRecordingsSession(expiresAt);
  if (signature.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

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
  const safeNext = nextPath.startsWith("/recordings") ? nextPath : "/recordings";
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
    return res.redirect(nextPath.startsWith("/recordings") ? nextPath : "/recordings");
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
    const safeNext = nextPath.startsWith("/recordings") ? nextPath : "/recordings";

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
            return {
              name: entry.name,
              mtimeMs: stats.mtimeMs,
              sizeMb: (stats.size / 1024 / 1024).toFixed(2),
            };
          }),
      )
    ).sort((a, b) => b.mtimeMs - a.mtimeMs);

    const selected = videos[0]?.name || "";
    const listHtml = videos.length
      ? videos
          .map(
            (video) =>
              `<li><a href="/recordings?file=${encodeURIComponent(video.name)}">${video.name}</a> (${video.sizeMb} MB)</li>`,
          )
          .join("")
      : "<li>Нет записей</li>";

    const selectedFile = String(req.query.file || selected);
    const safeSelectedFile = path.basename(selectedFile);
    const playerHtml =
      safeSelectedFile && videos.some((video) => video.name === safeSelectedFile)
        ? `<video controls style="width:100%;max-height:70vh;background:#000" src="/recordings/files/${encodeURIComponent(safeSelectedFile)}"></video>`
        : "<p>Выберите запись из списка.</p>";

    return res
      .status(200)
      .send(`<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LiveKit recordings</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
      h1 { margin-top: 0; }
      .grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; }
      .panel { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; }
      ul { padding-left: 18px; margin: 0; }
      li { margin: 6px 0; word-break: break-all; }
      a { color: #2563eb; text-decoration: none; }
      a:hover { text-decoration: underline; }
      @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <h1>Записи комнаты</h1>
    <p style="margin:0 0 16px"><a href="/recordings/logout">Выйти</a></p>
    <div class="grid">
      <section class="panel">
        <h2>Файлы</h2>
        <ul>${listHtml}</ul>
      </section>
      <section class="panel">
        <h2>Просмотр</h2>
        ${playerHtml}
      </section>
    </div>
  </body>
</html>`);
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

  if (!egressId) {
    return res.status(400).json({
      error: "Field 'egressId' or known active recording for this room is required",
    });
  }

  try {
    const result = await egressClient.stopEgress(egressId);
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

    return res.json({
      ok: true,
      egressId,
      status: result.status,
    });
  } catch (error) {
    console.error("Failed to stop recording:", error);
    return res.status(500).json({ error: "Не удалось остановить запись" });
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
