const crypto = require("node:crypto");

const sanitizeAvatarUrl = (value) => {
  const avatarUrl = String(value || "").trim();
  if (!avatarUrl.startsWith("/avatar/")) {
    return "";
  }
  return avatarUrl;
};

const parseAvatarDataUrl = (imageDataUrl, { maxBytes = 256 * 1024 } = {}) => {
  const value = String(imageDataUrl || "").trim();
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) {
    return null;
  }
  const mimeType = match[1];
  const base64Payload = match[2];
  const buffer = Buffer.from(base64Payload, "base64");
  if (buffer.length === 0 || buffer.length > maxBytes) {
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

const toSafeSlug = (value) =>
  String(value || "")
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

const getEgressTroubleshootingHint = (error) => {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();

  if (message.includes("egress not connected") || message.includes("redis required")) {
    return "Egress не подключен к LiveKit. Запустите Redis и Egress, затем перезапустите LiveKit.";
  }
  if (message.includes("no response from servers") || code === "unavailable") {
    return "Сервис Egress недоступен. Проверьте, что контейнер egress запущен и подключен к Redis.";
  }
  if (
    message.includes("websocket url timeout") ||
    message.includes("failed to launch chrome") ||
    message.includes("page load error")
  ) {
    return "Chrome для записи не успел стартовать. Обычно не хватает RAM на сервере (нужно ~8–12 ГБ при записи + ASR).";
  }
  if (message.includes("egress not found") || code === "not_found") {
    return "Сессия записи уже завершена или не найдена.";
  }
  return "Проверьте LiveKit API URL, ключи и состояние сервисов LiveKit/Redis/Egress.";
};

const isEgressNotFoundError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || error?.status || "").toLowerCase();
  return (
    message.includes("egress not found") ||
    message.includes("not found") ||
    code === "not_found" ||
    code === "404"
  );
};

const signRecordingsSession = (expiresAt, { user, secret }) => {
  const payload = `${user}:${expiresAt}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
};

const createRecordingsSessionToken = ({
  user,
  secret,
  ttlMs,
  now = Date.now(),
}) => {
  const expiresAt = now + ttlMs;
  return `${expiresAt}.${signRecordingsSession(expiresAt, { user, secret })}`;
};

const verifyRecordingsSessionToken = (
  token,
  { user, secret, now = Date.now() },
) => {
  if (!token) {
    return false;
  }
  const separatorIndex = token.indexOf(".");
  if (separatorIndex < 0) {
    return false;
  }
  const expiresAt = Number(token.slice(0, separatorIndex));
  const signature = token.slice(separatorIndex + 1);
  if (!Number.isFinite(expiresAt) || expiresAt < now || !signature) {
    return false;
  }
  const expected = signRecordingsSession(expiresAt, { user, secret });
  if (signature.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

const isSafeRecordingsNextPath = (nextPath) =>
  String(nextPath || "").startsWith("/recordings");

const sanitizeRecordingsFileName = (fileName) => {
  const raw = String(fileName || "");
  const base = require("node:path").basename(raw);
  if (!base || base !== raw || base.includes("..")) {
    return "";
  }
  if (!base.toLowerCase().endsWith(".mp4")) {
    return "";
  }
  return base;
};

const canJoinRoom = (room, username) =>
  String(room || "").trim().length > 0 && String(username || "").trim().length > 0;

module.exports = {
  sanitizeAvatarUrl,
  parseAvatarDataUrl,
  getAvatarExtension,
  toSafeSlug,
  parseBasicAuth,
  parseCookies,
  getEgressTroubleshootingHint,
  isEgressNotFoundError,
  signRecordingsSession,
  createRecordingsSessionToken,
  verifyRecordingsSessionToken,
  isSafeRecordingsNextPath,
  sanitizeRecordingsFileName,
  canJoinRoom,
};
