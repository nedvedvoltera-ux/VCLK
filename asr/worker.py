#!/usr/bin/env python3
"""ASR worker: Redis queue -> faster-whisper -> network Qwen summary."""

from __future__ import annotations

import gc
import json
import logging
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import redis
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("asr-worker")

RECORDINGS_DIR = Path(os.environ.get("RECORDINGS_DIR", "/out"))
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
QUEUE_KEY = os.environ.get("ASR_QUEUE_KEY", "transcription:jobs")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "ru")
SUMMARY_ENABLED = os.environ.get("SUMMARY_ENABLED", "true").lower() in {
    "1",
    "true",
    "yes",
}
SUMMARY_API_BASE_URL = os.environ.get(
    "SUMMARY_API_BASE_URL", "http://192.168.215.74:9080/v1"
).rstrip("/")
SUMMARY_API_KEY = os.environ.get("SUMMARY_API_KEY", "")
SUMMARY_MODEL = os.environ.get("SUMMARY_MODEL", "Qwen/Qwen3.5-35B-A3B-FP8")
SUMMARY_TIMEOUT_SEC = int(os.environ.get("SUMMARY_TIMEOUT_SEC", "180"))
SUMMARY_MAX_TOKENS = int(os.environ.get("SUMMARY_MAX_TOKENS", "512"))
SUMMARY_TEMPERATURE = float(os.environ.get("SUMMARY_TEMPERATURE", "0.0"))
POLL_TIMEOUT_SEC = int(os.environ.get("ASR_POLL_TIMEOUT_SEC", "5"))


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def transcript_path_for(mp4_name: str) -> Path:
    stem = Path(mp4_name).stem
    return RECORDINGS_DIR / f"{stem}.transcript.json"


def txt_path_for(mp4_name: str) -> Path:
    stem = Path(mp4_name).stem
    return RECORDINGS_DIR / f"{stem}.transcript.txt"


def load_artifact(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_artifact(path: Path, data: dict[str, Any]) -> None:
    data["updatedAt"] = utc_now()
    if "createdAt" not in data:
        data["createdAt"] = data["updatedAt"]
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def extract_audio(mp4_path: Path, wav_path: Path) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(mp4_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(wav_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr[-2000:]}")


def transcribe(model: Any, wav_path: Path) -> tuple[list[dict[str, Any]], str]:
    segments_iter, _info = model.transcribe(
        str(wav_path),
        language=WHISPER_LANGUAGE or None,
        vad_filter=True,
        beam_size=1,
    )
    segments: list[dict[str, Any]] = []
    texts: list[str] = []
    for seg in segments_iter:
        text = (seg.text or "").strip()
        if not text:
            continue
        segments.append(
            {
                "start": round(float(seg.start), 2),
                "end": round(float(seg.end), 2),
                "text": text,
                "speaker": None,
            }
        )
        texts.append(text)
    return segments, "\n".join(texts).strip()


SUMMARY_SYSTEM_PROMPT = """Ты секретарь видеовстреч.
Верни ТОЛЬКО готовый итог на русском языке.
Запрещено: Thinking Process, reasoning, анализ запроса, черновики, метакомментарии, английские пояснения.

Строгий формат ответа:
Кратко: 2–4 предложения, о чём говорили.
Решения: маркированный список или «нет».
Задачи: маркированный список (с ответственными, если есть) или «нет».
Открытые вопросы: маркированный список или «нет».

Пиши коротко и только по фактам из транскрипта."""


def clean_summary_text(content: str) -> str:
    text = (content or "").strip()
    if not text:
        return ""
    lower = text.lower()
    for marker in ("кратко:", "кратко :"):
        idx = lower.find(marker)
        if idx >= 0:
            return text[idx:].strip()
    # Drop common thinking preambles if model ignored the switch.
    for junk in (
        "Thinking Process:",
        "thinking process:",
        "**Analyze the Request:**",
        "1.  **Analyze",
    ):
        if junk in text:
            parts = text.split("\n\n")
            for part in reversed(parts):
                if part.strip().lower().startswith("кратко"):
                    return part.strip()
    return text


def summarize(text: str) -> dict[str, Any]:
    if not SUMMARY_ENABLED:
        return {
            "status": "skipped",
            "model": SUMMARY_MODEL,
            "text": "",
            "error": "SUMMARY_ENABLED=false",
        }
    if not text.strip():
        return {
            "status": "skipped",
            "model": SUMMARY_MODEL,
            "text": "",
            "error": "empty transcript",
        }

    url = f"{SUMMARY_API_BASE_URL}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if SUMMARY_API_KEY:
        headers["Authorization"] = f"Bearer {SUMMARY_API_KEY}"
    payload = {
        "model": SUMMARY_MODEL,
        "messages": [
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Сделай саммари по транскрипту:\n\n{text[:24000]}",
            },
        ],
        "temperature": SUMMARY_TEMPERATURE,
        "max_tokens": SUMMARY_MAX_TOKENS,
        # Qwen3.5 thinking off (vLLM / OpenAI-compatible)
        "chat_template_kwargs": {"enable_thinking": False},
        "enable_thinking": False,
    }
    try:
        response = requests.post(
            url, headers=headers, json=payload, timeout=SUMMARY_TIMEOUT_SEC
        )
        response.raise_for_status()
        body = response.json()
        message = body.get("choices", [{}])[0].get("message", {})
        content = clean_summary_text(str(message.get("content") or ""))
        if not content:
            return {
                "status": "error",
                "model": SUMMARY_MODEL,
                "text": "",
                "error": "empty summary response",
            }
        return {"status": "done", "model": SUMMARY_MODEL, "text": content, "error": None}
    except Exception as exc:  # noqa: BLE001
        log.exception("Summary request failed")
        return {
            "status": "error",
            "model": SUMMARY_MODEL,
            "text": "",
            "error": str(exc),
        }


def load_whisper_model():
    from faster_whisper import WhisperModel

    log.info(
        "Loading Whisper model %s (%s/%s)",
        WHISPER_MODEL,
        WHISPER_DEVICE,
        WHISPER_COMPUTE_TYPE,
    )
    return WhisperModel(
        WHISPER_MODEL,
        device=WHISPER_DEVICE,
        compute_type=WHISPER_COMPUTE_TYPE,
    )


def unload_whisper_model(model) -> None:
    try:
        del model
    except Exception:  # noqa: BLE001
        pass
    gc.collect()
    log.info("Whisper model unloaded to free RAM for LiveKit/Egress")


def process_job(job: dict[str, Any]) -> None:
    file_name = Path(str(job.get("fileName") or "")).name
    mode = str(job.get("mode") or "full")
    if not file_name.lower().endswith(".mp4"):
        log.warning("Skip invalid job: %s", job)
        return

    mp4_path = RECORDINGS_DIR / file_name
    artifact_path = transcript_path_for(file_name)
    if not mp4_path.exists():
        save_artifact(
            artifact_path,
            {
                "version": 1,
                "status": "error",
                "fileName": file_name,
                "error": f"mp4 not found: {file_name}",
                "segments": [],
                "text": "",
                "summary": {"status": "error", "model": SUMMARY_MODEL, "text": "", "error": "mp4 missing"},
                "diarization": {"enabled": False},
            },
        )
        return

    artifact = load_artifact(artifact_path)
    artifact.update(
        {
            "version": 1,
            "fileName": file_name,
            "engine": "faster-whisper",
            "model": WHISPER_MODEL,
            "language": WHISPER_LANGUAGE,
            "diarization": {"enabled": False},
            "error": None,
        }
    )

    model = None
    try:
        if mode != "summarize_only":
            artifact["status"] = "transcribing"
            artifact["progress"] = 35
            artifact["progressIndeterminate"] = True
            artifact["summary"] = {
                "status": "pending",
                "model": SUMMARY_MODEL,
                "text": "",
                "error": None,
            }
            save_artifact(artifact_path, artifact)

            model = load_whisper_model()
            artifact["progress"] = 45
            save_artifact(artifact_path, artifact)
            with tempfile.TemporaryDirectory(prefix="asr-") as tmp:
                wav_path = Path(tmp) / "audio.wav"
                log.info("Extract audio %s", file_name)
                extract_audio(mp4_path, wav_path)
                artifact["progress"] = 55
                save_artifact(artifact_path, artifact)
                log.info(
                    "Transcribe %s with %s/%s/%s",
                    file_name,
                    WHISPER_MODEL,
                    WHISPER_DEVICE,
                    WHISPER_COMPUTE_TYPE,
                )
                segments, text = transcribe(model, wav_path)

            unload_whisper_model(model)
            model = None

            artifact["segments"] = segments
            artifact["text"] = text
            artifact["progress"] = 75
            txt_path_for(file_name).write_text(text + ("\n" if text else ""), encoding="utf-8")
        else:
            text = str(artifact.get("text") or "")
            if not text:
                artifact["status"] = "error"
                artifact["error"] = "no transcript text for summarize_only"
                artifact["progress"] = 100
                artifact["progressIndeterminate"] = False
                save_artifact(artifact_path, artifact)
                return

        artifact["status"] = "summarizing"
        artifact["progress"] = 85
        artifact["progressIndeterminate"] = True
        artifact["summary"] = {
            "status": "pending",
            "model": SUMMARY_MODEL,
            "text": "",
            "error": None,
        }
        save_artifact(artifact_path, artifact)

        summary = summarize(str(artifact.get("text") or text))
        artifact["summary"] = summary
        artifact["status"] = "done"
        artifact["progress"] = 100
        artifact["progressIndeterminate"] = False
        if summary.get("status") == "error":
            artifact["error"] = f"summary failed: {summary.get('error')}"
        save_artifact(artifact_path, artifact)
        log.info("Done %s (summary=%s)", file_name, summary.get("status"))
    finally:
        if model is not None:
            unload_whisper_model(model)


def parse_job(raw: str | bytes) -> dict[str, Any] | None:
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        data = json.loads(raw)
        if isinstance(data, str):
            return {"fileName": data, "mode": "full"}
        if isinstance(data, dict):
            return data
    except Exception:  # noqa: BLE001
        log.warning("Bad job payload: %r", raw)
    return None


def main() -> None:
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    log.info(
        "Starting ASR worker (lazy model load) model=%s device=%s compute=%s queue=%s summary=%s",
        WHISPER_MODEL,
        WHISPER_DEVICE,
        WHISPER_COMPUTE_TYPE,
        QUEUE_KEY,
        SUMMARY_API_BASE_URL if SUMMARY_ENABLED else "disabled",
    )
    client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    client.ping()
    log.info("Redis connected, waiting for jobs (Whisper loads only while processing)")

    while True:
        try:
            item = client.blpop(QUEUE_KEY, timeout=POLL_TIMEOUT_SEC)
            if not item:
                continue
            _key, raw = item
            job = parse_job(raw)
            if not job:
                continue
            log.info("Job received: %s", job)
            process_job(job)
        except Exception:  # noqa: BLE001
            log.exception("Worker loop error, sleep 3s")
            time.sleep(3)


if __name__ == "__main__":
    main()
