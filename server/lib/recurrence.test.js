const {
  expandMeetingOccurrences,
  expandOccurrenceTimes,
  normalizeRecurrence,
  occurrenceStartMs,
  reminderOccurrence,
  safeTimeZone,
} = require("./recurrence");

const iso = (ms) => new Date(ms).toISOString();
const base = (overrides = {}) => ({
  id: "m1",
  starts_at: "2026-07-20T10:00:00.000Z",
  ends_at: "2026-07-20T11:00:00.000Z",
  timezone: "Europe/Moscow",
  recurrence: "daily",
  reminder_minutes: 15,
  reminder_sent_at: null,
  ...overrides,
});

describe("recurrence value", () => {
  it("accepts only known periods", () => {
    expect(normalizeRecurrence("weekly")).toBe("weekly");
    expect(normalizeRecurrence("yearly")).toBeNull();
    expect(normalizeRecurrence(undefined)).toBeNull();
  });

  it("falls back for unknown time zones", () => {
    expect(safeTimeZone("Asia/Almaty")).toBe("Asia/Almaty");
    expect(safeTimeZone("Nope/Zone")).toBe("Europe/Moscow");
    expect(safeTimeZone("")).toBe("Europe/Moscow");
  });
});

describe("occurrence times", () => {
  const baseMs = Date.parse("2026-07-20T10:00:00.000Z");

  it("repeats daily and weekly at the same time", () => {
    expect(iso(occurrenceStartMs(baseMs, "daily", 1, "Europe/Moscow"))).toBe("2026-07-21T10:00:00.000Z");
    expect(iso(occurrenceStartMs(baseMs, "weekly", 2, "Europe/Moscow"))).toBe("2026-08-03T10:00:00.000Z");
  });

  it("clamps monthly repeats to the last day of short months", () => {
    const jan31 = Date.parse("2026-01-31T10:00:00.000Z");
    expect(iso(occurrenceStartMs(jan31, "monthly", 1, "UTC"))).toBe("2026-02-28T10:00:00.000Z");
    expect(iso(occurrenceStartMs(jan31, "monthly", 2, "UTC"))).toBe("2026-03-31T10:00:00.000Z");
    expect(iso(occurrenceStartMs(jan31, "monthly", 12, "UTC"))).toBe("2027-01-31T10:00:00.000Z");
  });

  it("keeps wall-clock time across a DST change", () => {
    const beforeDst = Date.parse("2026-03-07T15:00:00.000Z"); // 10:00 EST
    expect(iso(occurrenceStartMs(beforeDst, "daily", 2, "America/New_York"))).toBe("2026-03-09T14:00:00.000Z");
  });
});

describe("expansion window", () => {
  it("returns only occurrences overlapping the window", () => {
    const times = expandOccurrenceTimes(base(), {
      fromMs: Date.parse("2026-07-22T00:00:00.000Z"),
      toMs: Date.parse("2026-07-24T00:00:00.000Z"),
    });
    expect(times.map((item) => iso(item.startMs))).toEqual([
      "2026-07-22T10:00:00.000Z",
      "2026-07-23T10:00:00.000Z",
    ]);
  });

  it("keeps the series id and original times on each copy", () => {
    const copies = expandMeetingOccurrences(base({ recurrence: "weekly" }), {
      fromMs: Date.parse("2026-07-01T00:00:00.000Z"),
      toMs: Date.parse("2026-08-10T00:00:00.000Z"),
    });
    expect(copies.map((item) => item.occurrence_key)).toEqual(["m1:0", "m1:1", "m1:2"]);
    expect(copies.every((item) => item.id === "m1")).toBe(true);
    expect(copies[2].series_starts_at).toBe("2026-07-20T10:00:00.000Z");
    expect(iso(copies[2].ends_at)).toBe("2026-08-03T11:00:00.000Z");
  });
});

describe("reminders for series", () => {
  it("reminds for the next occurrence once", () => {
    const meeting = base();
    const nowMs = Date.parse("2026-07-25T09:50:00.000Z");
    const due = reminderOccurrence(meeting, nowMs);
    expect(iso(due.startMs)).toBe("2026-07-25T10:00:00.000Z");

    const sent = base({ reminder_sent_at: new Date(nowMs).toISOString() });
    expect(reminderOccurrence(sent, nowMs + 60_000)).toBeNull();
    expect(iso(reminderOccurrence(sent, Date.parse("2026-07-26T09:50:00.000Z")).startMs)).toBe(
      "2026-07-26T10:00:00.000Z",
    );
  });

  it("does not remind outside the reminder window", () => {
    expect(reminderOccurrence(base(), Date.parse("2026-07-25T08:00:00.000Z"))).toBeNull();
  });
});
