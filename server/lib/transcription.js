const path = require("node:path");

const TRANSCRIPT_SUFFIX = ".transcript.json";

const sanitizeRecordingFileName = (fileName) => {
  const raw = String(fileName || "");
  const base = path.basename(raw);
  if (!base || base !== raw || base.includes("..")) {
    return "";
  }
  if (!base.toLowerCase().endsWith(".mp4")) {
    return "";
  }
  return base;
};

const transcriptArtifactName = (mp4Name) => {
  const safe = sanitizeRecordingFileName(mp4Name);
  if (!safe) {
    return "";
  }
  return `${path.parse(safe).name}${TRANSCRIPT_SUFFIX}`;
};

const buildTranscriptionJob = ({ fileName, mode = "full" }) => {
  const safe = sanitizeRecordingFileName(fileName);
  if (!safe) {
    return null;
  }
  const normalizedMode = mode === "summarize_only" ? "summarize_only" : "full";
  return {
    fileName: safe,
    mode: normalizedMode,
    enqueuedAt: new Date().toISOString(),
  };
};

const mapTranscriptStatusLabel = (artifact) => {
  if (!artifact || artifact.status === "missing") {
    return "Нет";
  }
  switch (artifact.status) {
    case "queued":
      return "В очереди";
    case "transcribing":
      return "Транскрибация…";
    case "summarizing":
      return "Саммари…";
    case "done":
      return artifact.summary?.status === "error" ? "Готово (саммари с ошибкой)" : "Готово";
    case "error":
      return "Ошибка";
    default:
      return String(artifact.status || "Нет");
  }
};

/** Approximate progress from discrete pipeline stages (Whisper has no token stream). */
const mapTranscriptProgress = (artifact) => {
  if (!artifact || artifact.status === "missing") {
    return { percent: 0, indeterminate: false, stage: "missing" };
  }
  if (typeof artifact.progress === "number" && Number.isFinite(artifact.progress)) {
    return {
      percent: Math.max(0, Math.min(100, Math.round(artifact.progress))),
      indeterminate: Boolean(artifact.progressIndeterminate),
      stage: artifact.status,
    };
  }
  switch (artifact.status) {
    case "queued":
      return { percent: 12, indeterminate: true, stage: "queued" };
    case "transcribing":
      return { percent: 45, indeterminate: true, stage: "transcribing" };
    case "summarizing":
      return { percent: 82, indeterminate: true, stage: "summarizing" };
    case "done":
      return { percent: 100, indeterminate: false, stage: "done" };
    case "error":
      return { percent: 100, indeterminate: false, stage: "error" };
    default:
      return { percent: 0, indeterminate: false, stage: String(artifact.status || "missing") };
  }
};

const createMissingTranscriptPayload = (fileName) => ({
  status: "missing",
  fileName: sanitizeRecordingFileName(fileName) || String(fileName || ""),
  progress: 0,
  segments: [],
  text: "",
  summary: { status: "missing", text: "", error: null },
  diarization: { enabled: false },
});

module.exports = {
  TRANSCRIPT_SUFFIX,
  sanitizeRecordingFileName,
  transcriptArtifactName,
  buildTranscriptionJob,
  mapTranscriptStatusLabel,
  mapTranscriptProgress,
  createMissingTranscriptPayload,
};
