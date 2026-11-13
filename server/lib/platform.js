const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const ldap = require("ldapjs");
const multer = require("multer");
const { Pool } = require("pg");
const {
  HORIZON_DAYS,
  MS_DAY,
  expandMeetingOccurrences,
  normalizeRecurrence,
  reminderOccurrence,
  safeTimeZone,
} = require("./recurrence");

const SESSION_COOKIE = "vclk_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MEETING = 10;
const UPLOAD_COOLDOWN_MS = 3_000;
const allowedAttachmentTypes = new Map([
  [".pdf", ["application/pdf"]],
  [".docx", ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
  [".pptx", ["application/vnd.openxmlformats-officedocument.presentationml.presentation"]],
  [".txt", ["text/plain"]],
  [".csv", ["text/csv", "application/csv", "application/vnd.ms-excel"]],
  [".png", ["image/png"]],
  [".jpg", ["image/jpeg"]],
  [".jpeg", ["image/jpeg"]],
]);

/** Multer reads multipart filenames as Latin-1; browsers send UTF-8 (Cyrillic etc.). */
const decodeUploadFilename = (name = "") => {
  const raw = String(name || "");
  try {
    return Buffer.from(raw, "latin1").toString("utf8");
  } catch {
    return raw;
  }
};

const sanitizeAttachmentName = (name = "") =>
  path
    .basename(decodeUploadFilename(name))
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim()
    .slice(0, 180) || "attachment";

const createPool = () =>
  new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://vclk:vclk@postgres:5432/vclk",
  });

const parseCookies = (header = "") =>
  Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );

const setCookie = (res, req, value = "") => {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${value ? Math.floor(SESSION_TTL_MS / 1000) : 0}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
};

const safeUser = (user) => ({
  id: user.id,
  email: user.email,
  displayName: user.display_name,
  role: user.role,
  authSource: user.auth_source,
  active: user.active,
  createdAt: user.created_at,
});

const secretKey = () => {
  const source = process.env.SETTINGS_ENCRYPTION_KEY || "";
  return source ? crypto.createHash("sha256").update(source).digest() : null;
};

const encrypt = (value) => {
  if (!value) return null;
  const key = secretKey();
  if (!key) throw new Error("SETTINGS_ENCRYPTION_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ciphertext.toString("base64")}`;
};

const decrypt = (value) => {
  if (!value) return "";
  const [ivText, tagText, ciphertextText] = value.split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    secretKey(),
    Buffer.from(ivText, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64")), decipher.final()]).toString("utf8");
};

const icsEscape = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const icsDate = (value) => new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const ICS_FREQUENCY = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" };

const createIcs = (meeting, url) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//VCLK//Meeting//RU",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${meeting.id}@vclk`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(meeting.starts_at)}`,
    `DTEND:${icsDate(meeting.ends_at)}`,
    ...(ICS_FREQUENCY[meeting.recurrence] ? [`RRULE:FREQ=${ICS_FREQUENCY[meeting.recurrence]}`] : []),
    `SUMMARY:${icsEscape(meeting.title)}`,
    `DESCRIPTION:${icsEscape(`${meeting.description || ""}\nПодключиться: ${url}`)}`,
    `LOCATION:${icsEscape(url)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

async function initDatabase(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id uuid PRIMARY KEY, email text UNIQUE NOT NULL, display_name text NOT NULL,
      password_hash text, role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
      auth_source text NOT NULL DEFAULT 'local', active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_sessions (
      token_hash text PRIMARY KEY, user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key text PRIMARY KEY, value text, encrypted boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS meetings (
      id uuid PRIMARY KEY, room_id text UNIQUE NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '',
      starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, timezone text NOT NULL DEFAULT 'Europe/Moscow',
      status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
      recording_enabled boolean NOT NULL DEFAULT false, reminder_minutes integer,
      organizer_id uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), CHECK (ends_at > starts_at)
    );
    ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
    ALTER TABLE meetings ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none'
      CHECK (recurrence IN ('none','daily','weekly','monthly'));
    CREATE TABLE IF NOT EXISTS meeting_participants (
      meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE, user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
      email text NOT NULL, display_name text, invite_status text NOT NULL DEFAULT 'pending',
      PRIMARY KEY (meeting_id, email)
    );
    CREATE TABLE IF NOT EXISTS meeting_invites (
      id uuid PRIMARY KEY, meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      email text NOT NULL, token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL,
      used_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS meeting_attachments (
      id uuid PRIMARY KEY, meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      original_name text NOT NULL, storage_name text UNIQUE NOT NULL, content_type text NOT NULL,
      size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
      uploaded_by uuid NOT NULL REFERENCES app_users(id), created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS meetings_schedule_idx ON meetings(starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS meeting_attachments_meeting_idx ON meeting_attachments(meeting_id);
  `);
}

async function ldapAuthenticate(config, email, password) {
  if (!config.url || !config.baseDn) throw new Error("LDAP is not configured");
  const client = ldap.createClient({ url: config.url, timeout: 7000, connectTimeout: 7000 });
  const bind = (dn, secret) =>
    new Promise((resolve, reject) => client.bind(dn, secret, (error) => (error ? reject(error) : resolve())));
  const find = () =>
    new Promise((resolve, reject) =>
      client.search(
        config.baseDn,
        { scope: "sub", filter: `(${config.loginAttribute || "userPrincipalName"}=${email})`, attributes: ["dn", "mail", "cn", "displayName", "memberOf"] },
        (error, result) => {
          if (error) return reject(error);
          let item = null;
          result.on("searchEntry", (entry) => {
            item = entry.object;
          });
          result.on("error", reject);
          result.on("end", () => (item ? resolve(item) : reject(new Error("User was not found in LDAP"))));
        },
      ),
    );
  try {
    if (config.bindDn) await bind(config.bindDn, config.bindPassword);
    const entry = await find();
    await bind(entry.dn, password);
    return entry;
  } finally {
    client.unbind();
  }
}

function mountPlatform(app, { buildToken, livekitUrl }) {
  const pool = createPool();
  const attachmentsDir = process.env.ATTACHMENTS_DIR || path.resolve(__dirname, "..", "..", "attachments");
  fs.mkdirSync(attachmentsDir, { recursive: true });
  const uploadAttemptsByUser = new Map();
  const attachmentUpload = multer({
    storage: multer.diskStorage({
      destination: attachmentsDir,
      filename: (_req, file, callback) => {
        const safeName = sanitizeAttachmentName(file.originalname);
        callback(null, `${crypto.randomUUID()}${path.extname(safeName).toLowerCase()}`);
      },
    }),
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(sanitizeAttachmentName(file.originalname)).toLowerCase();
      const allowedMimeTypes = allowedAttachmentTypes.get(extension);
      if (!allowedMimeTypes || !allowedMimeTypes.includes(file.mimetype)) {
        return callback(new Error("Допустимы только PDF, Office-документы, TXT, CSV, PNG и JPEG"));
      }
      return callback(null, true);
    },
  });
  const getSetting = async (key) => (await pool.query("SELECT value, encrypted FROM app_settings WHERE key=$1", [key])).rows[0];
  const getSettings = async (prefix) =>
    Object.fromEntries(
      (await pool.query("SELECT key, value, encrypted FROM app_settings WHERE key LIKE $1", [`${prefix}%`])).rows.map((row) => [
        row.key.slice(prefix.length),
        row.encrypted ? decrypt(row.value) : row.value,
      ]),
    );
  const putSetting = async (key, value, isEncrypted = false) =>
    pool.query(
      `INSERT INTO app_settings(key,value,encrypted) VALUES($1,$2,$3)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, encrypted=excluded.encrypted, updated_at=now()`,
      [key, isEncrypted && value ? encrypt(value) : value || "", isEncrypted],
    );
  const requiresSetup = async () => Number((await pool.query("SELECT count(*)::int AS count FROM app_users")).rows[0].count) === 0;
  const issueSession = async (user, req, res) => {
    const token = crypto.randomBytes(32).toString("base64url");
    await pool.query("INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", [
      crypto.createHash("sha256").update(token).digest("hex"),
      user.id,
      new Date(Date.now() + SESSION_TTL_MS),
    ]);
    setCookie(res, req, token);
  };
  const readSession = async (req) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await pool.query(
      `SELECT u.* FROM app_sessions s JOIN app_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at > now() AND u.active=true`,
      [tokenHash],
    );
    return result.rows[0] || null;
  };
  const auth = async (req, res, next) => {
    try {
      const user = await readSession(req);
      if (!user) return res.status(401).json({ error: "Требуется вход в систему" });
      req.user = user;
      return next();
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  };
  const admin = (req, res, next) =>
    req.user?.role === "admin" ? next() : res.status(403).json({ error: "Требуются права администратора" });
  const canEdit = (meeting, user) => user.role === "admin" || meeting.organizer_id === user.id;
  const publicUrl = () => process.env.PUBLIC_BASE_URL || `https://${process.env.PUBLIC_HOSTNAME || "localhost"}`;
  const getSystemModes = async () => {
    const raw = await getSettings("system_");
    return {
      freeMode: raw.freeMode === "true",
      calendarMode: raw.calendarMode !== "false",
    };
  };
  const sendDueReminders = async () => {
    const smtp = await getSettings("smtp_");
    if (!smtp.host || !smtp.from) return;
    const candidates = await pool.query(
      `SELECT * FROM meetings WHERE status='scheduled' AND reminder_minutes > 0 AND (
         (recurrence='none' AND reminder_sent_at IS NULL
          AND now() >= starts_at - (reminder_minutes * interval '1 minute') AND now() < starts_at)
         OR recurrence <> 'none')`,
    );
    const nowMs = Date.now();
    const due = { rows: [] };
    for (const meeting of candidates.rows) {
      if (meeting.recurrence === "none") {
        due.rows.push(meeting);
        continue;
      }
      const occurrence = reminderOccurrence(meeting, nowMs);
      if (occurrence) due.rows.push({ ...meeting, starts_at: new Date(occurrence.startMs) });
    }
    if (!due.rows.length) return;
    const transport = nodemailer.createTransport({
      host: smtp.host, port: Number(smtp.port || 587), secure: smtp.secure === "true",
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    });
    for (const meeting of due.rows) {
      const recipients = (await pool.query("SELECT email FROM meeting_participants WHERE meeting_id=$1", [meeting.id])).rows.map((row) => row.email);
      if (recipients.length) {
        await transport.sendMail({
          from: smtp.from, to: recipients.join(", "), subject: `Напоминание: ${meeting.title}`,
          text: `Встреча начинается ${new Date(meeting.starts_at).toLocaleString("ru-RU")}.\nПодключиться: ${publicUrl()}/room?meeting=${meeting.id}`,
        });
      }
      await pool.query("UPDATE meetings SET reminder_sent_at=now() WHERE id=$1", [meeting.id]);
    }
  };

  app.get("/api/bootstrap", async (_req, res) => {
    const modes = await getSystemModes();
    res.json({ setupRequired: await requiresSetup(), ...modes });
  });
  app.post("/api/setup", async (req, res) => {
    if (!(await requiresSetup())) return res.status(409).json({ error: "Первый администратор уже создан" });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const displayName = String(req.body?.displayName || "").trim();
    const password = String(req.body?.password || "");
    if (!email || !displayName || password.length < 10) return res.status(400).json({ error: "Укажите имя, e-mail и пароль от 10 символов" });
    const user = { id: crypto.randomUUID(), email, display_name: displayName, role: "admin", auth_source: "local", active: true };
    await pool.query("INSERT INTO app_users(id,email,display_name,password_hash,role,auth_source) VALUES($1,$2,$3,$4,'admin','local')", [
      user.id, email, displayName, await bcrypt.hash(password, 12),
    ]);
    await issueSession(user, req, res);
    return res.status(201).json({ user: safeUser(user) });
  });
  app.post("/api/auth/login", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const source = String(req.body?.source || "local");
    let user = (await pool.query("SELECT * FROM app_users WHERE email=$1 AND active=true", [email])).rows[0];
    try {
      if (source === "ldap") {
        const config = await getSettings("ldap_");
        const entry = await ldapAuthenticate(config, email, password);
        const displayName = entry.displayName || entry.cn || email;
        const groups = Array.isArray(entry.memberOf) ? entry.memberOf : entry.memberOf ? [entry.memberOf] : [];
        const ldapRole = config.adminGroup && groups.some((group) => String(group).toLowerCase() === String(config.adminGroup).toLowerCase()) ? "admin" : "user";
        if (!user) {
          user = { id: crypto.randomUUID(), email, display_name: displayName, role: ldapRole, auth_source: "ldap", active: true };
          await pool.query("INSERT INTO app_users(id,email,display_name,role,auth_source) VALUES($1,$2,$3,$4,'ldap')", [user.id, email, displayName, ldapRole]);
        } else if (user.auth_source === "ldap") {
          const updated = await pool.query("UPDATE app_users SET display_name=$1,role=$2,updated_at=now() WHERE id=$3 RETURNING *", [displayName, ldapRole, user.id]);
          user = updated.rows[0];
        }
      } else if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: "Неверный e-mail или пароль" });
      }
    } catch (error) {
      return res.status(401).json({ error: `Не удалось выполнить вход LDAP: ${error.message}` });
    }
    await issueSession(user, req, res);
    return res.json({ user: safeUser(user) });
  });
  app.post("/api/auth/logout", auth, async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await pool.query("DELETE FROM app_sessions WHERE token_hash=$1", [crypto.createHash("sha256").update(token).digest("hex")]);
    setCookie(res, req);
    return res.status(204).end();
  });
  app.get("/api/auth/me", auth, (req, res) => res.json({ user: safeUser(req.user) }));

  app.get("/api/users", auth, admin, async (_req, res) => {
    const users = await pool.query("SELECT * FROM app_users ORDER BY created_at DESC");
    res.json({ users: users.rows.map(safeUser) });
  });
  app.get("/api/users/recipients", auth, async (req, res) => {
    const users = await pool.query(
      "SELECT id,email,display_name FROM app_users WHERE active=true AND id <> $1 ORDER BY display_name, email",
      [req.user.id],
    );
    res.json({ users: users.rows.map((user) => ({ id: user.id, email: user.email, displayName: user.display_name })) });
  });
  app.post("/api/users", auth, admin, async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const displayName = String(req.body?.displayName || "").trim() || email;
    const password = String(req.body?.password || "");
    const role = req.body?.role === "admin" ? "admin" : "user";
    if (!email) return res.status(400).json({ error: "Укажите e-mail" });
    if (password.length < 10) return res.status(400).json({ error: "Укажите пароль от 10 символов для входа по login/password" });
    const user = { id: crypto.randomUUID(), email, display_name: displayName, role, auth_source: "local", active: true };
    try {
      await pool.query(
        "INSERT INTO app_users(id,email,display_name,password_hash,role,auth_source) VALUES($1,$2,$3,$4,$5,'local')",
        [user.id, email, displayName, await bcrypt.hash(password, 12), role],
      );
      return res.status(201).json({ user: safeUser(user) });
    } catch {
      return res.status(409).json({ error: "Пользователь с таким e-mail уже существует" });
    }
  });
  app.patch("/api/users/:id", auth, admin, async (req, res) => {
    const result = await pool.query(
      "UPDATE app_users SET display_name=COALESCE($1,display_name), role=COALESCE($2,role), active=COALESCE($3,active), updated_at=now() WHERE id=$4 RETURNING *",
      [req.body?.displayName || null, ["admin", "user"].includes(req.body?.role) ? req.body.role : null, typeof req.body?.active === "boolean" ? req.body.active : null, req.params.id],
    );
    return result.rows[0] ? res.json({ user: safeUser(result.rows[0]) }) : res.status(404).json({ error: "Пользователь не найден" });
  });
  app.delete("/api/users/:id", auth, admin, async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "Нельзя удалить собственную учётную запись" });
    await pool.query("UPDATE app_users SET active=false, updated_at=now() WHERE id=$1", [req.params.id]);
    res.status(204).end();
  });

  const settingsPrefix = (kind) => {
    if (kind === "smtp") return "smtp_";
    if (kind === "ldap") return "ldap_";
    if (kind === "system") return "system_";
    return null;
  };
  app.get("/api/settings/:kind", auth, admin, async (req, res) => {
    const kind = settingsPrefix(req.params.kind);
    if (!kind) return res.status(404).json({ error: "Раздел настроек не найден" });
    if (kind === "system_") {
      const modes = await getSystemModes();
      return res.json({ settings: { freeMode: modes.freeMode, calendarMode: modes.calendarMode } });
    }
    const raw = await getSettings(kind);
    const settings = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, /password|secret/i.test(key) ? Boolean(value) : value]));
    res.json({ settings });
  });
  app.put("/api/settings/:kind", auth, admin, async (req, res) => {
    const kind = settingsPrefix(req.params.kind);
    if (!kind) return res.status(404).json({ error: "Раздел настроек не найден" });
    const incoming = req.body?.settings || {};
    if (kind === "system_") {
      const freeMode = incoming.freeMode === true || incoming.freeMode === "true";
      const calendarMode = incoming.calendarMode === true || incoming.calendarMode === "true";
      if (!freeMode && !calendarMode) {
        return res.status(400).json({ error: "Включите хотя бы один режим: свободный или календарь" });
      }
      await putSetting("system_freeMode", freeMode ? "true" : "false");
      await putSetting("system_calendarMode", calendarMode ? "true" : "false");
      return res.json({ ok: true, settings: { freeMode, calendarMode } });
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) continue;
      if (value === "" && /password|secret/i.test(key)) continue;
      await putSetting(`${kind}${key}`, String(value ?? ""), /password|secret/i.test(key));
    }
    res.json({ ok: true });
  });

  const loadMeeting = async (id) =>
    (await pool.query("SELECT m.*, u.display_name organizer_name FROM meetings m JOIN app_users u ON u.id=m.organizer_id WHERE m.id=$1", [id])).rows[0];
  const attachParticipants = async (meeting) => {
    const participants = await pool.query("SELECT email, display_name, invite_status, user_id FROM meeting_participants WHERE meeting_id=$1 ORDER BY email", [meeting.id]);
    const attachments = await pool.query(
      "SELECT id,original_name,content_type,size_bytes,uploaded_by,created_at FROM meeting_attachments WHERE meeting_id=$1 ORDER BY created_at DESC",
      [meeting.id],
    );
    return { ...meeting, participants: participants.rows, attachments: attachments.rows };
  };
  const visibleMeetings = async (user, from, to) => {
    const params = [from || "1970-01-01", to || "2999-12-31"];
    const access = user.role === "admin" ? "" : "AND (m.organizer_id=$3 OR EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id=m.id AND (p.user_id=$3 OR p.email=$4)))";
    if (user.role !== "admin") params.push(user.id, user.email);
    const result = await pool.query(
      `SELECT m.*, u.display_name organizer_name FROM meetings m JOIN app_users u ON u.id=m.organizer_id
       WHERE m.starts_at < $2 AND (m.ends_at > $1 OR (m.recurrence <> 'none' AND m.status='scheduled'))
       ${access} ORDER BY m.starts_at`,
      params,
    );
    const rows = await Promise.all(result.rows.map(attachParticipants));
    const fromMs = new Date(params[0]).getTime();
    const toMs = Math.min(new Date(params[1]).getTime(), Date.now() + HORIZON_DAYS * MS_DAY);
    return rows
      .flatMap((row) =>
        row.recurrence !== "none" && row.status === "scheduled"
          ? expandMeetingOccurrences(row, { fromMs, toMs })
          : [row],
      )
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  };
  app.get("/api/meetings", auth, async (req, res) => res.json({ meetings: await visibleMeetings(req.user, req.query.from, req.query.to) }));
  app.post("/api/meetings", auth, async (req, res) => {
    if (!(await getSystemModes()).calendarMode) {
      return res.status(403).json({ error: "Создание встреч через календарь отключено администратором" });
    }
    const title = String(req.body?.title || "").trim();
    const startsAt = new Date(req.body?.startsAt);
    const endsAt = new Date(req.body?.endsAt);
    if (!title || Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf()) || endsAt <= startsAt) return res.status(400).json({ error: "Проверьте тему и время встречи" });
    const recurrence = req.body?.recurrence === undefined ? "none" : normalizeRecurrence(req.body.recurrence);
    if (!recurrence) return res.status(400).json({ error: "Неизвестный период повторения" });
    const id = crypto.randomUUID();
    const meeting = {
      id, roomId: `vclk-${id.slice(0, 8)}`, title, description: String(req.body?.description || ""),
      startsAt, endsAt, timezone: safeTimeZone(req.body?.timezone), recurrence, recordingEnabled: Boolean(req.body?.recordingEnabled),
      reminderMinutes: Number.isInteger(req.body?.reminderMinutes) ? req.body.reminderMinutes : 15,
    };
    await pool.query(
      `INSERT INTO meetings(id,room_id,title,description,starts_at,ends_at,timezone,recording_enabled,reminder_minutes,organizer_id,recurrence)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, meeting.roomId, title, meeting.description, startsAt, endsAt, meeting.timezone, meeting.recordingEnabled, meeting.reminderMinutes, req.user.id, recurrence],
    );
    for (const participant of req.body?.participants || []) {
      const email = String(participant.email || "").trim().toLowerCase();
      if (!email) continue;
      const known = (await pool.query("SELECT id, display_name FROM app_users WHERE email=$1", [email])).rows[0];
      await pool.query("INSERT INTO meeting_participants(meeting_id,user_id,email,display_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [id, known?.id || null, email, known?.display_name || participant.displayName || null]);
    }
    return res.status(201).json({ meeting: await attachParticipants(await loadMeeting(id)) });
  });
  app.patch("/api/meetings/:id", auth, async (req, res) => {
    const current = await loadMeeting(req.params.id);
    if (!current) return res.status(404).json({ error: "Встреча не найдена" });
    if (!canEdit(current, req.user)) return res.status(403).json({ error: "Недостаточно прав" });
    const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : current.starts_at;
    const endsAt = req.body?.endsAt ? new Date(req.body.endsAt) : current.ends_at;
    if (endsAt <= startsAt) return res.status(400).json({ error: "Время окончания должно быть позже начала" });
    const recurrence = req.body?.recurrence === undefined ? null : normalizeRecurrence(req.body.recurrence);
    if (req.body?.recurrence !== undefined && !recurrence) return res.status(400).json({ error: "Неизвестный период повторения" });
    await pool.query(
      `UPDATE meetings SET title=COALESCE($1,title),description=COALESCE($2,description),starts_at=$3,ends_at=$4,
       timezone=COALESCE($5,timezone),recording_enabled=COALESCE($6,recording_enabled),reminder_minutes=COALESCE($7,reminder_minutes),
       recurrence=COALESCE($8,recurrence),updated_at=now() WHERE id=$9`,
      [req.body?.title || null, req.body?.description || null, startsAt, endsAt, req.body?.timezone ? safeTimeZone(req.body.timezone) : null, typeof req.body?.recordingEnabled === "boolean" ? req.body.recordingEnabled : null, Number.isInteger(req.body?.reminderMinutes) ? req.body.reminderMinutes : null, recurrence, current.id],
    );
    res.json({ meeting: await attachParticipants(await loadMeeting(current.id)) });
  });
  app.delete("/api/meetings/:id", auth, async (req, res) => {
    const meeting = await loadMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: "Встреча не найдена" });
    if (!canEdit(meeting, req.user)) return res.status(403).json({ error: "Недостаточно прав" });
    await pool.query("UPDATE meetings SET status='cancelled',updated_at=now() WHERE id=$1", [meeting.id]);
    res.status(204).end();
  });
  app.post("/api/meetings/:id/attachments", auth, (req, res) => {
    attachmentUpload.single("file")(req, res, async (uploadError) => {
      if (uploadError) {
        const message = uploadError.code === "LIMIT_FILE_SIZE"
          ? "Размер вложения не должен превышать 20 МБ"
          : uploadError.message || "Не удалось обработать вложение";
        return res.status(400).json({ error: message });
      }
      const uploadedFile = req.file;
      const discard = () => {
        if (uploadedFile?.path) fs.unlink(uploadedFile.path, () => undefined);
      };
      try {
        const meeting = await loadMeeting(req.params.id);
        if (!meeting) {
          discard();
          return res.status(404).json({ error: "Встреча не найдена" });
        }
        if (!canEdit(meeting, req.user)) {
          discard();
          return res.status(403).json({ error: "Вложения может добавлять только организатор или администратор" });
        }
        if (String(req.body?.humanConfirmed || "") !== "true") {
          discard();
          return res.status(400).json({ error: "Подтвердите, что вы вручную выбрали файл для загрузки" });
        }
        const previousAttempt = uploadAttemptsByUser.get(req.user.id) || 0;
        const waitFor = UPLOAD_COOLDOWN_MS - (Date.now() - previousAttempt);
        if (waitFor > 0) {
          discard();
          return res.status(429).json({ error: `Следующая загрузка будет доступна через ${Math.ceil(waitFor / 1000)} с` });
        }
        if (!uploadedFile) return res.status(400).json({ error: "Выберите один файл" });
        const count = await pool.query("SELECT count(*)::int AS count FROM meeting_attachments WHERE meeting_id=$1", [meeting.id]);
        if (count.rows[0].count >= MAX_ATTACHMENTS_PER_MEETING) {
          discard();
          return res.status(400).json({ error: `К встрече можно прикрепить не более ${MAX_ATTACHMENTS_PER_MEETING} файлов` });
        }
        const originalName = sanitizeAttachmentName(uploadedFile.originalname);
        const attachment = {
          id: crypto.randomUUID(),
          originalName,
          storageName: path.basename(uploadedFile.filename),
          contentType: uploadedFile.mimetype,
          sizeBytes: uploadedFile.size,
        };
        await pool.query(
          `INSERT INTO meeting_attachments(id,meeting_id,original_name,storage_name,content_type,size_bytes,uploaded_by)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [attachment.id, meeting.id, attachment.originalName, attachment.storageName, attachment.contentType, attachment.sizeBytes, req.user.id],
        );
        uploadAttemptsByUser.set(req.user.id, Date.now());
        return res.status(201).json({ attachment });
      } catch (error) {
        discard();
        return res.status(500).json({ error: "Не удалось сохранить вложение" });
      }
    });
  });
  app.get("/api/attachments/:id", auth, async (req, res) => {
    const result = await pool.query(
      `SELECT a.*,m.organizer_id FROM meeting_attachments a JOIN meetings m ON m.id=a.meeting_id WHERE a.id=$1`,
      [req.params.id],
    );
    const attachment = result.rows[0];
    if (!attachment) return res.status(404).json({ error: "Вложение не найдено" });
    const participant = await pool.query(
      "SELECT 1 FROM meeting_participants WHERE meeting_id=$1 AND (user_id=$2 OR email=$3)",
      [attachment.meeting_id, req.user.id, req.user.email],
    );
    if (req.user.role !== "admin" && attachment.organizer_id !== req.user.id && !participant.rows[0]) {
      return res.status(403).json({ error: "Нет доступа к вложению" });
    }
    const asciiFallback = attachment.original_name.replace(/[^\x20-\x7E]/g, "_") || "attachment";
    const utf8Name = encodeURIComponent(attachment.original_name).replace(/['()]/g, escape);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`,
    );
    res.setHeader("Content-Type", attachment.content_type || "application/octet-stream");
    return res.sendFile(path.join(attachmentsDir, attachment.storage_name));
  });
  app.get("/api/meetings/:id", auth, async (req, res) => {
    const meeting = await loadMeeting(req.params.id);
    if (!meeting || meeting.status !== "scheduled") return res.status(404).json({ error: "Встреча недоступна" });
    const participant = await pool.query(
      "SELECT 1 FROM meeting_participants WHERE meeting_id=$1 AND (user_id=$2 OR email=$3)",
      [meeting.id, req.user.id, req.user.email],
    );
    if (req.user.role !== "admin" && meeting.organizer_id !== req.user.id && !participant.rows[0]) {
      return res.status(403).json({ error: "Вы не приглашены на эту встречу" });
    }
    return res.json({ meeting: await attachParticipants(meeting) });
  });
  app.post("/api/meetings/:id/invites", auth, async (req, res) => {
    const meeting = await loadMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ error: "Встреча не найдена" });
    if (!canEdit(meeting, req.user)) return res.status(403).json({ error: "Недостаточно прав" });
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Укажите e-mail" });
    const token = crypto.randomBytes(32).toString("base64url");
    await pool.query("INSERT INTO meeting_invites(id,meeting_id,email,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)", [crypto.randomUUID(), meeting.id, email, crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + INVITE_TTL_MS)]);
    await pool.query("INSERT INTO meeting_participants(meeting_id,email) VALUES($1,$2) ON CONFLICT DO NOTHING", [meeting.id, email]);
    const inviteUrl = `${publicUrl()}/invite/${token}`;
    const smtp = await getSettings("smtp_");
    if (smtp.host && smtp.from) {
      try {
        const transport = nodemailer.createTransport({ host: smtp.host, port: Number(smtp.port || 587), secure: smtp.secure === "true", auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined });
        await transport.sendMail({ from: smtp.from, to: email, subject: `Приглашение: ${meeting.title}`, text: `Вы приглашены на встречу ${meeting.title}.\n${inviteUrl}`, icalEvent: { filename: "vclk-invite.ics", method: "REQUEST", content: createIcs(meeting, inviteUrl) } });
      } catch (error) {
        return res.status(201).json({
          inviteUrl,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          warning: `Приглашение создано, но письмо не отправлено: ${error.message}`,
        });
      }
    }
    res.status(201).json({ inviteUrl, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
  });
  app.get("/api/invites/:token", async (req, res) => {
    const invite = (await pool.query("SELECT i.*,m.title,m.starts_at,m.ends_at FROM meeting_invites i JOIN meetings m ON m.id=i.meeting_id WHERE i.token_hash=$1 AND i.expires_at > now() AND i.revoked_at IS NULL", [crypto.createHash("sha256").update(req.params.token).digest("hex")])).rows[0];
    return invite ? res.json({ invite: { email: invite.email, meetingId: invite.meeting_id, title: invite.title, startsAt: invite.starts_at, endsAt: invite.ends_at } }) : res.status(404).json({ error: "Приглашение недействительно или истекло" });
  });
  app.post("/api/invites/:token/activate", async (req, res) => {
    const tokenHash = crypto.createHash("sha256").update(req.params.token).digest("hex");
    const invite = (await pool.query("SELECT * FROM meeting_invites WHERE token_hash=$1 AND expires_at > now() AND used_at IS NULL AND revoked_at IS NULL", [tokenHash])).rows[0];
    if (!invite) return res.status(404).json({ error: "Приглашение недействительно или истекло" });
    const displayName = String(req.body?.displayName || "").trim() || invite.email;
    const password = String(req.body?.password || "");
    if (password.length < 10) return res.status(400).json({ error: "Пароль должен содержать минимум 10 символов" });
    let user = (await pool.query("SELECT * FROM app_users WHERE email=$1", [invite.email])).rows[0];
    if (!user) {
      user = { id: crypto.randomUUID(), email: invite.email, display_name: displayName, role: "user", auth_source: "local", active: true };
      await pool.query("INSERT INTO app_users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)", [user.id, user.email, user.display_name, await bcrypt.hash(password, 12)]);
    }
    await pool.query("UPDATE meeting_participants SET user_id=$1, display_name=$2, invite_status='accepted' WHERE meeting_id=$3 AND email=$4", [user.id, user.display_name, invite.meeting_id, invite.email]);
    await pool.query("UPDATE meeting_invites SET used_at=now() WHERE id=$1", [invite.id]);
    await issueSession(user, req, res);
    res.json({ user: safeUser(user), meetingId: invite.meeting_id });
  });
  app.post("/api/meetings/:id/join", auth, async (req, res) => {
    const meeting = await loadMeeting(req.params.id);
    if (!meeting || meeting.status !== "scheduled") return res.status(404).json({ error: "Встреча недоступна" });
    const participant = await pool.query("SELECT 1 FROM meeting_participants WHERE meeting_id=$1 AND (user_id=$2 OR email=$3)", [meeting.id, req.user.id, req.user.email]);
    if (req.user.role !== "admin" && meeting.organizer_id !== req.user.id && !participant.rows[0]) return res.status(403).json({ error: "Вы не приглашены на эту встречу" });
    const username = String(req.body?.username || req.user.display_name || "").trim() || req.user.display_name;
    const avatarUrl = typeof req.body?.avatarUrl === "string" ? req.body.avatarUrl : undefined;
    return res.json({
      token: await buildToken({ roomName: meeting.room_id, username, avatarUrl }),
      livekitUrl,
      roomName: meeting.room_id,
      meeting: await attachParticipants(meeting),
    });
  });
  app.post("/api/settings/smtp/test", auth, admin, async (req, res) => {
    const smtp = await getSettings("smtp_");
    if (!smtp.host || !smtp.from) return res.status(400).json({ error: "Сначала сохраните SMTP-настройки" });
    try {
      const transport = nodemailer.createTransport({ host: smtp.host, port: Number(smtp.port || 587), secure: smtp.secure === "true", auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined });
      await transport.sendMail({ from: smtp.from, to: req.body?.email || req.user.email, subject: "Проверка VCLK", text: "SMTP-интеграция VCLK настроена." });
      res.json({ ok: true });
    } catch (error) {
      res.status(502).json({ error: error.message });
    }
  });
  return {
    init: async () => {
      await initDatabase(pool);
      setInterval(() => void sendDueReminders().catch((error) => console.error("Failed to send meeting reminders:", error.message)), 60_000).unref();
    },
    close: () => pool.end(),
    auth,
    admin,
    getSystemModes,
  };
}

module.exports = {
  mountPlatform,
  createIcs,
  encrypt,
  decrypt,
  decodeUploadFilename,
  sanitizeAttachmentName,
};
