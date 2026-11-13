const RECURRENCES = ["none", "daily", "weekly", "monthly"];
const MS_DAY = 86_400_000;
const HORIZON_DAYS = 400;
const MAX_OCCURRENCES = 1000;
const DEFAULT_TIME_ZONE = "Europe/Moscow";

/** Returns a valid recurrence value, or null when the value is not supported. */
const normalizeRecurrence = (value) => (RECURRENCES.includes(value) ? value : null);

const formatters = new Map();
const getFormatter = (timeZone) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/** Falls back to a known zone when the client sends an unknown IANA name. */
const safeTimeZone = (value, fallback = DEFAULT_TIME_ZONE) => {
  const candidate = String(value || "").trim();
  if (!candidate) return fallback;
  try {
    getFormatter(candidate);
    return candidate;
  } catch {
    return fallback;
  }
};

const wallParts = (ms, timeZone) => {
  const parts = getFormatter(timeZone).formatToParts(new Date(ms));
  const read = (type) => Number(parts.find((part) => part.type === type).value);
  return { y: read("year"), m: read("month"), d: read("day"), h: read("hour"), mi: read("minute"), s: read("second") };
};

const zoneOffsetMs = (ms, timeZone) => {
  const p = wallParts(ms, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
};

const wallToUtc = (p, timeZone) => {
  const guess = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
};

/**
 * Start of the n-th occurrence. The wall-clock time in the meeting time zone is
 * preserved, so a 10:00 meeting stays at 10:00 across DST changes.
 */
const occurrenceStartMs = (baseMs, recurrence, index, timeZone) => {
  if (index === 0) return baseMs;
  const zone = safeTimeZone(timeZone, "UTC");
  const base = wallParts(baseMs, zone);
  let { y, m, d } = base;
  if (recurrence === "monthly") {
    const total = base.m - 1 + index;
    y = base.y + Math.floor(total / 12);
    m = (total % 12) + 1;
    d = Math.min(base.d, new Date(Date.UTC(y, m, 0)).getUTCDate());
  } else {
    const step = recurrence === "weekly" ? 7 : 1;
    const shifted = new Date(Date.UTC(base.y, base.m - 1, base.d + index * step));
    y = shifted.getUTCFullYear();
    m = shifted.getUTCMonth() + 1;
    d = shifted.getUTCDate();
  }
  return wallToUtc({ y, m, d, h: base.h, mi: base.mi, s: base.s }, zone);
};

/** Occurrences (start/end in ms) of a recurring meeting that overlap [fromMs, toMs). */
const expandOccurrenceTimes = (meeting, { fromMs, toMs }) => {
  const recurrence = meeting.recurrence;
  const baseStart = new Date(meeting.starts_at).getTime();
  const durationMs = new Date(meeting.ends_at).getTime() - baseStart;
  if (!normalizeRecurrence(recurrence) || recurrence === "none") {
    return baseStart < toMs && baseStart + durationMs > fromMs
      ? [{ index: 0, startMs: baseStart, endMs: baseStart + durationMs }]
      : [];
  }
  const periodMs = recurrence === "daily" ? MS_DAY : recurrence === "weekly" ? 7 * MS_DAY : 31 * MS_DAY;
  let index = Math.max(0, Math.floor((fromMs - durationMs - baseStart) / periodMs) - 1);
  const limit = index + MAX_OCCURRENCES + 5;
  const result = [];
  for (; index < limit && result.length < MAX_OCCURRENCES; index += 1) {
    const startMs = occurrenceStartMs(baseStart, recurrence, index, meeting.timezone);
    if (startMs >= toMs) break;
    const endMs = startMs + durationMs;
    if (endMs > fromMs) result.push({ index, startMs, endMs });
  }
  return result;
};

/**
 * Meeting copies for each occurrence in the window. Every copy keeps the series id
 * (shared room and link) and exposes the original series times for editing.
 */
const expandMeetingOccurrences = (meeting, window) =>
  expandOccurrenceTimes(meeting, window).map((occurrence) => ({
    ...meeting,
    starts_at: new Date(occurrence.startMs),
    ends_at: new Date(occurrence.endMs),
    series_starts_at: meeting.starts_at,
    series_ends_at: meeting.ends_at,
    occurrence_index: occurrence.index,
    occurrence_key: `${meeting.id}:${occurrence.index}`,
  }));

/** Occurrence that should get a reminder right now, or null. */
const reminderOccurrence = (meeting, nowMs) => {
  const leadMs = Number(meeting.reminder_minutes) * 60_000;
  if (!(leadMs > 0)) return null;
  const occurrence = expandOccurrenceTimes(meeting, { fromMs: nowMs, toMs: nowMs + leadMs + 1 }).find(
    (item) => item.startMs > nowMs && item.startMs - leadMs <= nowMs,
  );
  if (!occurrence) return null;
  const sentMs = meeting.reminder_sent_at ? new Date(meeting.reminder_sent_at).getTime() : null;
  if (sentMs !== null && sentMs >= occurrence.startMs - leadMs) return null;
  return occurrence;
};

module.exports = {
  RECURRENCES,
  HORIZON_DAYS,
  MS_DAY,
  normalizeRecurrence,
  safeTimeZone,
  occurrenceStartMs,
  expandOccurrenceTimes,
  expandMeetingOccurrences,
  reminderOccurrence,
};
