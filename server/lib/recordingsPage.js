const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderRecordingsArchivePage = ({
  listHtml,
  playerHtml,
  selectedFileName = "",
}) => `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Архив записей · VCLK</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg0: #0b1220;
        --bg1: #121a2b;
        --panel: rgba(255,255,255,0.04);
        --panel-border: rgba(148,163,184,0.18);
        --text: #e8eefc;
        --muted: #94a3b8;
        --accent: #3b82f6;
        --accent-2: #22d3ee;
        --ok: #34d399;
        --warn: #fbbf24;
        --err: #f87171;
        --radius: 18px;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "IBM Plex Sans", Manrope, system-ui, sans-serif;
        color: var(--text);
        background:
          radial-gradient(1200px 600px at 10% -10%, rgba(59,130,246,0.22), transparent 55%),
          radial-gradient(900px 500px at 90% 0%, rgba(34,211,238,0.14), transparent 50%),
          linear-gradient(180deg, var(--bg0), #070b14 70%);
      }
      .wrap { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
      .topbar {
        display: flex; justify-content: space-between; align-items: end; gap: 16px;
        margin-bottom: 22px;
      }
      .brand {
        font-family: Manrope, sans-serif;
        font-size: clamp(28px, 4vw, 40px);
        font-weight: 700;
        letter-spacing: -0.03em;
        margin: 0;
      }
      .brand span {
        background: linear-gradient(90deg, #fff, #93c5fd 55%, #67e8f9);
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .subtitle { margin: 6px 0 0; color: var(--muted); font-size: 14px; }
      .logout {
        color: #bfdbfe; text-decoration: none; font-size: 14px; font-weight: 500;
        border: 1px solid rgba(147,197,253,0.35); border-radius: 999px; padding: 8px 14px;
      }
      .logout:hover { background: rgba(59,130,246,0.15); }
      .grid {
        display: grid; grid-template-columns: minmax(320px, 400px) 1fr; gap: 16px;
      }
      .panel {
        border: 1px solid var(--panel-border);
        background: var(--panel);
        backdrop-filter: blur(10px);
        border-radius: var(--radius);
        padding: 16px;
        box-shadow: 0 18px 50px rgba(0,0,0,0.25);
      }
      .panel h2 {
        margin: 0 0 14px; font-family: Manrope, sans-serif; font-size: 16px; font-weight: 650;
      }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
      .rec-item {
        border: 1px solid rgba(148,163,184,0.16);
        background: rgba(15,23,42,0.55);
        border-radius: 14px;
        padding: 12px;
        transition: border-color .2s, transform .2s;
      }
      .rec-item:hover { border-color: rgba(96,165,250,0.45); transform: translateY(-1px); }
      .rec-item.is-active { border-color: rgba(59,130,246,0.7); box-shadow: inset 0 0 0 1px rgba(59,130,246,0.25); }
      .rec-main a {
        color: #dbeafe; text-decoration: none; font-weight: 600; word-break: break-all; font-size: 13px;
      }
      .rec-main a:hover { color: #fff; }
      .rec-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; align-items: center; }
      .chip {
        display: inline-flex; align-items: center; gap: 6px;
        border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 500;
        background: rgba(148,163,184,0.12); color: var(--muted);
      }
      .chip.ok { color: #bbf7d0; background: rgba(16,185,129,0.15); }
      .chip.busy { color: #fde68a; background: rgba(245,158,11,0.16); }
      .chip.err { color: #fecaca; background: rgba(239,68,68,0.16); }
      .progress {
        width: 100%; height: 7px; border-radius: 999px; overflow: hidden;
        background: rgba(148,163,184,0.18); margin-top: 10px;
      }
      .progress > i {
        display: block; height: 100%; width: 0%;
        background: linear-gradient(90deg, var(--accent), var(--accent-2));
        transition: width .4s ease;
      }
      .progress.is-indeterminate > i {
        width: 35% !important;
        animation: slide 1.2s ease-in-out infinite;
      }
      @keyframes slide {
        0% { transform: translateX(-120%); }
        100% { transform: translateX(320%); }
      }
      .rec-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
      .btn, .btn-secondary {
        border: 0; border-radius: 999px; padding: 7px 12px; cursor: pointer; font-size: 13px; font-weight: 600;
      }
      .btn { background: linear-gradient(90deg, #2563eb, #0891b2); color: #fff; }
      .btn:hover { filter: brightness(1.08); }
      .btn:disabled, .btn-secondary:disabled { opacity: .45; cursor: not-allowed; }
      .btn-secondary {
        background: rgba(148,163,184,0.14); color: #e2e8f0; border: 1px solid rgba(148,163,184,0.2);
      }
      .player-shell {
        border-radius: 14px; overflow: hidden; background: #000; border: 1px solid rgba(148,163,184,0.2);
      }
      .player-shell video { width: 100%; max-height: 68vh; display: block; background: #000; }
      .empty { color: var(--muted); margin: 0; }
      .modal-backdrop {
        position: fixed; inset: 0; background: rgba(2,6,23,0.72);
        display: none; align-items: center; justify-content: center; padding: 16px; z-index: 50;
        backdrop-filter: blur(5px);
      }
      .modal-backdrop.is-open { display: flex; }
      .modal {
        width: min(920px, 100%); max-height: 88vh; overflow: auto;
        background: linear-gradient(180deg, #152238, #0f172a);
        border: 1px solid rgba(148,163,184,0.22);
        border-radius: 20px; padding: 18px 18px 16px;
        box-shadow: 0 30px 80px rgba(0,0,0,.45); color: var(--text);
      }
      .modal-header { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
      .modal-header h2 { margin: 0 0 4px; font-family: Manrope, sans-serif; }
      .tabs { display: flex; gap: 8px; margin: 14px 0; }
      .tab {
        border: 1px solid rgba(148,163,184,0.25); background: rgba(148,163,184,0.08);
        border-radius: 999px; padding: 7px 13px; cursor: pointer; color: #cbd5e1; font-weight: 600;
      }
      .tab.is-active { background: #2563eb; border-color: #2563eb; color: #fff; }
      .tab-panel { display: none; white-space: pre-wrap; line-height: 1.5; }
      .tab-panel.is-active { display: block; }
      .segment { margin: 0 0 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(148,163,184,0.12); }
      .segment time { color: var(--muted); font-size: 12px; }
      .muted { color: var(--muted); }
      .modal-progress { margin: 10px 0 4px; }
      @media (max-width: 900px) {
        .grid { grid-template-columns: 1fr; }
        .topbar { flex-direction: column; align-items: start; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header class="topbar">
        <div>
          <h1 class="brand"><span>VCLK</span> · Архив записей</h1>
          <p class="subtitle">Просмотр, транскрибация и саммари встреч</p>
        </div>
        <a class="logout" href="/recordings/logout">Выйти</a>
      </header>
      <div class="grid">
        <section class="panel">
          <h2>Файлы</h2>
          <ul>${listHtml}</ul>
        </section>
        <section class="panel">
          <h2>Просмотр${selectedFileName ? `: ${escapeHtml(selectedFileName)}` : ""}</h2>
          ${playerHtml}
        </section>
      </div>
    </div>

    <div class="modal-backdrop" id="transcriptModal" aria-hidden="true">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="transcriptTitle">
        <div class="modal-header">
          <div>
            <h2 id="transcriptTitle">Транскрипт</h2>
            <div class="muted" id="transcriptFileName"></div>
            <div class="muted" id="transcriptStatusLine"></div>
            <div class="progress modal-progress" id="modalProgress"><i id="modalProgressBar"></i></div>
          </div>
          <button type="button" class="btn-secondary" id="closeTranscriptModal">Закрыть</button>
        </div>
        <div class="tabs">
          <button type="button" class="tab is-active" data-tab="transcript">Транскрипт</button>
          <button type="button" class="tab" data-tab="summary">Саммари</button>
        </div>
        <div class="tab-panel is-active" id="panel-transcript"></div>
        <div class="tab-panel" id="panel-summary"></div>
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn" id="retryTranscriptBtn">Перезапустить транскрибацию</button>
          <button type="button" class="btn-secondary" id="retrySummaryBtn">Пересчитать саммари</button>
        </div>
      </div>
    </div>

    <script>
      (function () {
        const modal = document.getElementById("transcriptModal");
        const fileNameEl = document.getElementById("transcriptFileName");
        const statusEl = document.getElementById("transcriptStatusLine");
        const panelTranscript = document.getElementById("panel-transcript");
        const panelSummary = document.getElementById("panel-summary");
        const retryTranscriptBtn = document.getElementById("retryTranscriptBtn");
        const retrySummaryBtn = document.getElementById("retrySummaryBtn");
        const modalProgress = document.getElementById("modalProgress");
        const modalProgressBar = document.getElementById("modalProgressBar");
        let currentFile = "";
        let pollTimer = null;

        const decodeFile = (value) => decodeURIComponent(value || "");
        const esc = (value) => String(value || "")
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const chipClass = (status) => {
          if (status === "done") return "ok";
          if (status === "error") return "err";
          if (status === "queued" || status === "transcribing" || status === "summarizing") return "busy";
          return "";
        };

        const setTab = (name) => {
          document.querySelectorAll(".tab").forEach((el) => {
            el.classList.toggle("is-active", el.dataset.tab === name);
          });
          panelTranscript.classList.toggle("is-active", name === "transcript");
          panelSummary.classList.toggle("is-active", name === "summary");
        };

        const formatTime = (sec) => {
          const total = Math.max(0, Math.floor(Number(sec) || 0));
          const m = String(Math.floor(total / 60)).padStart(2, "0");
          const s = String(total % 60).padStart(2, "0");
          return m + ":" + s;
        };

        const updateProgressUi = (fileName, progress, status, label) => {
          const percent = Number(progress?.percent || 0);
          const indeterminate = Boolean(progress?.indeterminate);
          const bar = document.querySelector('[data-progress-for="' + encodeURIComponent(fileName) + '"] i');
          const wrap = document.querySelector('[data-progress-for="' + encodeURIComponent(fileName) + '"]');
          const statusNode = document.querySelector('[data-status-for="' + encodeURIComponent(fileName) + '"]');
          if (statusNode) {
            statusNode.textContent = label || status || "—";
            statusNode.className = "chip " + chipClass(status);
          }
          if (wrap && bar) {
            wrap.style.display = status === "missing" || status === "done" ? "none" : "block";
            wrap.classList.toggle("is-indeterminate", indeterminate && status !== "done" && status !== "error");
            bar.style.width = Math.max(8, percent) + "%";
          }
          if (fileName === currentFile) {
            modalProgress.style.display = status === "missing" || status === "done" ? "none" : "block";
            modalProgress.classList.toggle("is-indeterminate", indeterminate && status !== "done" && status !== "error");
            modalProgressBar.style.width = Math.max(8, percent) + "%";
          }
        };

        const renderTranscript = (payload) => {
          const t = payload.transcript || {};
          statusEl.textContent = "Статус: " + (payload.label || t.status || "—");
          updateProgressUi(currentFile, payload.progress, t.status, payload.label);

          if (!t.status || t.status === "missing") {
            panelTranscript.innerHTML = '<p class="muted">Транскрипт ещё не создан.</p>';
          } else if (t.status === "queued" || t.status === "transcribing") {
            panelTranscript.innerHTML = '<p class="muted">Идёт транскрибация… Прогресс обновляется автоматически.</p>';
          } else if (t.status === "error" && !t.text) {
            panelTranscript.innerHTML = '<p class="muted">Ошибка: ' + esc(t.error || "unknown") + '</p>';
          } else if (Array.isArray(t.segments) && t.segments.length) {
            panelTranscript.innerHTML = t.segments.map(function (seg) {
              return '<div class="segment"><time>' + formatTime(seg.start) + ' – ' + formatTime(seg.end) +
                '</time><div>' + esc(seg.text || "") + '</div></div>';
            }).join("");
          } else {
            panelTranscript.innerHTML = '<div>' + esc(t.text || "") + '</div>';
          }

          const summary = t.summary || {};
          if (t.status === "summarizing" || summary.status === "pending") {
            panelSummary.innerHTML = '<p class="muted">Формируется саммари…</p>';
          } else if (summary.status === "error") {
            panelSummary.innerHTML = '<p class="muted">Ошибка саммари: ' + esc(summary.error || "unknown") + '</p>';
          } else if (summary.status === "done" && summary.text) {
            panelSummary.innerHTML = '<div>' + esc(summary.text) + '</div>';
          } else if (summary.status === "skipped") {
            panelSummary.innerHTML = '<p class="muted">Саммари пропущено.</p>';
          } else {
            panelSummary.innerHTML = '<p class="muted">Саммари пока нет.</p>';
          }

          const busy = t.status === "queued" || t.status === "transcribing" || t.status === "summarizing";
          if (busy) {
            if (!pollTimer) {
              pollTimer = setInterval(function () { void loadTranscript(currentFile); }, 2500);
            }
          } else if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        };

        const loadTranscript = async (fileName) => {
          const response = await fetch("/recordings/" + encodeURIComponent(fileName) + "/transcript");
          const payload = await response.json();
          renderTranscript(payload);
        };

        const openModal = async (fileName) => {
          currentFile = fileName;
          fileNameEl.textContent = fileName;
          modal.classList.add("is-open");
          modal.setAttribute("aria-hidden", "false");
          setTab("transcript");
          await loadTranscript(fileName);
        };

        const closeModal = () => {
          modal.classList.remove("is-open");
          modal.setAttribute("aria-hidden", "true");
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        };

        document.getElementById("closeTranscriptModal").addEventListener("click", closeModal);
        modal.addEventListener("click", function (event) {
          if (event.target === modal) closeModal();
        });
        document.querySelectorAll(".tab").forEach(function (tab) {
          tab.addEventListener("click", function () { setTab(tab.dataset.tab); });
        });

        document.querySelectorAll("[data-open-transcript]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            void openModal(decodeFile(btn.getAttribute("data-open-transcript")));
          });
        });

        document.querySelectorAll("[data-start-transcript]").forEach(function (btn) {
          btn.addEventListener("click", async function () {
            const fileName = decodeFile(btn.getAttribute("data-start-transcript"));
            btn.disabled = true;
            await fetch("/recordings/" + encodeURIComponent(fileName) + "/transcribe", { method: "POST" });
            await openModal(fileName);
          });
        });

        retryTranscriptBtn.addEventListener("click", async function () {
          if (!currentFile) return;
          retryTranscriptBtn.disabled = true;
          await fetch("/recordings/" + encodeURIComponent(currentFile) + "/transcribe", { method: "POST" });
          retryTranscriptBtn.disabled = false;
          await loadTranscript(currentFile);
        });

        retrySummaryBtn.addEventListener("click", async function () {
          if (!currentFile) return;
          retrySummaryBtn.disabled = true;
          await fetch("/recordings/" + encodeURIComponent(currentFile) + "/summarize", { method: "POST" });
          retrySummaryBtn.disabled = false;
          setTab("summary");
          await loadTranscript(currentFile);
        });

        // Soft poll list chips for in-progress items
        const busyFiles = Array.from(document.querySelectorAll(".rec-item[data-busy='1']"))
          .map((el) => decodeFile(el.getAttribute("data-file")));
        if (busyFiles.length) {
          setInterval(async () => {
            for (const fileName of busyFiles) {
              try {
                const response = await fetch("/recordings/" + encodeURIComponent(fileName) + "/transcript");
                const payload = await response.json();
                updateProgressUi(fileName, payload.progress, payload.transcript?.status, payload.label);
              } catch (_) {}
            }
          }, 3000);
        }
      })();
    </script>
  </body>
</html>`;

module.exports = {
  escapeHtml,
  renderRecordingsArchivePage,
};
