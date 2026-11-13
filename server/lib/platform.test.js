const { createIcs, decodeUploadFilename, sanitizeAttachmentName } = require("./platform");

describe("calendar invitation", () => {
  it("creates an Outlook-compatible iCalendar request", () => {
    const calendar = createIcs(
      {
        id: "meeting-id",
        title: "План, согласование",
        description: "Обсудить\nследующий этап",
        starts_at: "2026-07-16T10:00:00.000Z",
        ends_at: "2026-07-16T11:00:00.000Z",
      },
      "https://vclk.example/invite/secret",
    );

    expect(calendar).toContain("BEGIN:VCALENDAR");
    expect(calendar).toContain("METHOD:REQUEST");
    expect(calendar).toContain("SUMMARY:План\\, согласование");
    expect(calendar).toContain("LOCATION:https://vclk.example/invite/secret");
    expect(calendar).toContain("END:VCALENDAR");
    expect(calendar).not.toContain("RRULE");
  });

  it("adds a recurrence rule for repeating meetings", () => {
    const meeting = {
      id: "meeting-id",
      title: "Планерка",
      starts_at: "2026-07-16T10:00:00.000Z",
      ends_at: "2026-07-16T11:00:00.000Z",
    };
    expect(createIcs({ ...meeting, recurrence: "daily" }, "https://x")).toContain("RRULE:FREQ=DAILY");
    expect(createIcs({ ...meeting, recurrence: "weekly" }, "https://x")).toContain("RRULE:FREQ=WEEKLY");
    expect(createIcs({ ...meeting, recurrence: "monthly" }, "https://x")).toContain("RRULE:FREQ=MONTHLY");
  });
});

describe("attachment filenames", () => {
  it("restores Cyrillic names mangled by Multer Latin-1 decoding", () => {
    const original = "Протокол встречи.pdf";
    const mangled = Buffer.from(original, "utf8").toString("latin1");
    expect(decodeUploadFilename(mangled)).toBe(original);
    expect(sanitizeAttachmentName(mangled)).toBe(original);
  });
});
