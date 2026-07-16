const {
  sanitizeRecordingFileName,
  transcriptArtifactName,
  buildTranscriptionJob,
  mapTranscriptStatusLabel,
  mapTranscriptProgress,
  createMissingTranscriptPayload,
} = require("./transcription");

describe("sanitizeRecordingFileName", () => {
  it("allows plain mp4 names", () => {
    expect(sanitizeRecordingFileName("room-1.mp4")).toBe("room-1.mp4");
  });

  it("blocks traversal and non-mp4", () => {
    expect(sanitizeRecordingFileName("../x.mp4")).toBe("");
    expect(sanitizeRecordingFileName("a/b.mp4")).toBe("");
    expect(sanitizeRecordingFileName("notes.txt")).toBe("");
  });
});

describe("transcriptArtifactName", () => {
  it("maps mp4 to transcript json name", () => {
    expect(transcriptArtifactName("demo-room-1.mp4")).toBe("demo-room-1.transcript.json");
  });
});

describe("buildTranscriptionJob", () => {
  it("builds full and summarize jobs", () => {
    expect(buildTranscriptionJob({ fileName: "a.mp4" })).toMatchObject({
      fileName: "a.mp4",
      mode: "full",
    });
    expect(buildTranscriptionJob({ fileName: "a.mp4", mode: "summarize_only" })).toMatchObject({
      mode: "summarize_only",
    });
    expect(buildTranscriptionJob({ fileName: "../x.mp4" })).toBeNull();
  });
});

describe("mapTranscriptStatusLabel", () => {
  it("maps statuses for UI", () => {
    expect(mapTranscriptStatusLabel(null)).toBe("Нет");
    expect(mapTranscriptStatusLabel({ status: "queued" })).toBe("В очереди");
    expect(mapTranscriptStatusLabel({ status: "done", summary: { status: "done" } })).toBe(
      "Готово",
    );
    expect(mapTranscriptStatusLabel({ status: "done", summary: { status: "error" } })).toBe(
      "Готово (саммари с ошибкой)",
    );
  });
});

describe("mapTranscriptProgress", () => {
  it("maps pipeline stages to approximate percent", () => {
    expect(mapTranscriptProgress({ status: "queued" }).percent).toBe(12);
    expect(mapTranscriptProgress({ status: "transcribing" }).indeterminate).toBe(true);
    expect(mapTranscriptProgress({ status: "done" }).percent).toBe(100);
    expect(mapTranscriptProgress({ status: "transcribing", progress: 55 }).percent).toBe(55);
  });
});

describe("createMissingTranscriptPayload", () => {
  it("returns missing payload", () => {
    expect(createMissingTranscriptPayload("a.mp4").status).toBe("missing");
  });
});
