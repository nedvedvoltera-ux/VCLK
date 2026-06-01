import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  getTrackReferenceId,
  isTrackReference,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-core";
import {
  ConnectionStateToast,
  ControlBar,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useCreateLayoutContext,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track, type AudioCaptureOptions, type VideoCaptureOptions } from "livekit-client";
import "@livekit/components-styles";

type TokenResponse = {
  token: string;
};

function MeetParticipantTile({
  trackRef,
  className,
}: {
  trackRef?: TrackReferenceOrPlaceholder;
  className?: string;
}) {
  const participant = trackRef?.participant;
  const avatarUrl = participant?.attributes?.avatarDataUrl;
  const isSpeaking = Boolean(participant?.isSpeaking);
  const participantLabel = participant?.name || participant?.identity || "Участник";
  const hasVideo =
    trackRef &&
    isTrackReference(trackRef) &&
    trackRef.publication.isSubscribed &&
    !trackRef.publication.isMuted;

  return (
    <div
      className={`meet-participant-shell ${className ?? ""} ${isSpeaking ? "is-speaking" : ""}`}
    >
      <ParticipantTile trackRef={trackRef} />
      {isSpeaking ? (
        <div className="meet-speaking-badge" aria-live="polite">
          Говорит: {participantLabel}
        </div>
      ) : null}
      {!hasVideo && avatarUrl ? (
        <div className="meet-avatar-overlay">
          <img src={avatarUrl} alt={participant?.name || participant?.identity || "avatar"} />
        </div>
      ) : null}
    </div>
  );
}

function MeetRoomLayout({
  roomName,
  inviteLink,
  backendUrl,
  blurEnabled,
  avatarDataUrl,
  onLeave,
}: {
  roomName: string;
  inviteLink: string;
  backendUrl: string;
  blurEnabled: boolean;
  avatarDataUrl: string | null;
  onLeave: () => void;
}) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const layoutContext = useCreateLayoutContext();
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);
  const [layoutMode, setLayoutMode] = useState<"focus" | "grid">("focus");
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingEgressId, setRecordingEgressId] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showParticipants, setShowParticipants] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const controlBarHostRef = useRef<HTMLDivElement | null>(null);
  const [controlBarElement, setControlBarElement] = useState<HTMLDivElement | null>(null);
  const orderedTracks = useMemo(
    () =>
      [...tracks].sort((a, b) => {
        const aPriority = a.source === Track.Source.ScreenShare ? 0 : 1;
        const bPriority = b.source === Track.Source.ScreenShare ? 0 : 1;
        return aPriority - bPriority;
      }),
    [tracks],
  );
  const selectedTrack = useMemo(
    () =>
      orderedTracks.find((trackRef) => getTrackReferenceId(trackRef) === selectedTrackId) ??
      orderedTracks[0],
    [orderedTracks, selectedTrackId],
  );
  const activeTrackId = selectedTrack ? getTrackReferenceId(selectedTrack) : null;
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!orderedTracks.length) {
      setSelectedTrackId(null);
      return;
    }
    if (
      selectedTrackId &&
      orderedTracks.some((trackRef) => getTrackReferenceId(trackRef) === selectedTrackId)
    ) {
      return;
    }
    setSelectedTrackId(getTrackReferenceId(orderedTracks[0]));
  }, [orderedTracks, selectedTrackId]);

  useEffect(() => {
    const element = controlBarHostRef.current?.querySelector(
      ".lk-control-bar.meet-controlbar",
    );
    setControlBarElement((element as HTMLDivElement) ?? null);
  }, []);

  const fetchRecordingState = useCallback(async () => {
    try {
      const url = new URL("/recording/status", backendUrl);
      url.searchParams.set("room", roomName);
      const response = await fetch(url);
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      const recording = payload?.recording;
      if (recording?.active) {
        setIsRecording(true);
        setRecordingEgressId(
          typeof recording.egressId === "string" ? recording.egressId : null,
        );
      } else {
        setIsRecording(false);
        setRecordingEgressId(null);
      }
    } catch {
      // ignore status failure silently
    }
  }, [backendUrl, roomName]);

  useEffect(() => {
    void fetchRecordingState();
    const timer = setInterval(() => {
      void fetchRecordingState();
    }, 4000);
    return () => clearInterval(timer);
  }, [fetchRecordingState]);

  useEffect(() => {
    if (!avatarDataUrl) {
      return;
    }
    const syncAvatar = async () => {
      try {
        await localParticipant.setAttributes({ avatarDataUrl });
      } catch {
        // keep UI resilient if attributes are unavailable
      }
    };
    void syncAvatar();
  }, [avatarDataUrl, localParticipant]);

  const timeLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(now),
    [now],
  );

  const onCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1200);
    } catch {
      setIsCopied(false);
    }
  };

  const onToggleRecording = async () => {
    setRecordingBusy(true);
    setRecordingError(null);
    try {
      const endpoint = new URL(
        isRecording ? "/recording/stop" : "/recording/start",
        backendUrl,
      );
      const body = isRecording
        ? { room: roomName, egressId: recordingEgressId }
        : { room: roomName };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const rawBody = await response.text();
      let payload: Record<string, unknown> = {};
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          throw new Error(
            `Сервер записи вернул не-JSON ответ (HTTP ${response.status}). Проверьте /recording endpoint.`,
          );
        }
      }
      if (!response.ok) {
        const message =
          typeof payload.error === "string"
            ? payload.error
            : `Операция записи не выполнена (HTTP ${response.status})`;
        throw new Error(message);
      }
      if (isRecording) {
        setIsRecording(false);
        setRecordingEgressId(null);
      } else {
        setIsRecording(true);
        setRecordingEgressId(
          typeof payload.egressId === "string" ? payload.egressId : null,
        );
      }
      await fetchRecordingState();
      setSettingsOpen(false);
    } catch (error) {
      setRecordingError(
        error instanceof Error
          ? error.message
          : "Ошибка при работе с записью. Проверьте backend/egress.",
      );
    } finally {
      setRecordingBusy(false);
    }
  };

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }
    const onDocPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.closest(".meet-toolbar-menu-wrapper")) {
        return;
      }
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [settingsOpen]);

  return (
    <LayoutContextProvider value={layoutContext}>
      <div className={`meet-room ${blurEnabled ? "room-root--blur-local" : ""}`}>
        <header className="meet-topbar">
          <div className="meet-topbar-left">
            <p>{timeLabel}</p>
            <h2>{roomName}</h2>
          </div>
          <div className="meet-topbar-right">
            <span>{participants.length} уч.</span>
            {isRecording ? <span className="meet-rec-badge">REC</span> : null}
            <button
              type="button"
              className="meet-copy-btn"
              onClick={() => setShowParticipants((prev) => !prev)}
            >
              {showParticipants ? "Скрыть участников" : "Показать участников"}
            </button>
            <button type="button" className="meet-copy-btn" onClick={onCopyInvite}>
              {isCopied ? "Ссылка скопирована" : "Копировать ссылку"}
            </button>
            <button type="button" className="leave-btn" onClick={onLeave}>
              Выйти
            </button>
          </div>
        </header>
        {recordingError ? <p className="meet-record-error">{recordingError}</p> : null}

        <section className={`meet-stage ${showParticipants ? "meet-stage--with-panel" : ""}`}>
          <div className="meet-main-stage">
            {layoutMode === "focus" ? (
              <div className="meet-focus-layout">
                <aside className="meet-focus-thumbs">
                  {orderedTracks.map((trackRef) => {
                    const trackId = getTrackReferenceId(trackRef);
                    const isActive = trackId === activeTrackId;
                    return (
                      <button
                        key={trackId}
                        type="button"
                        className={`meet-thumb-button ${isActive ? "is-active" : ""}`}
                        onClick={() => setSelectedTrackId(trackId)}
                      >
                        <MeetParticipantTile trackRef={trackRef} />
                      </button>
                    );
                  })}
                </aside>
                <div className="meet-focus-main">
                  {selectedTrack ? (
                    <MeetParticipantTile trackRef={selectedTrack} className="meet-main-tile" />
                  ) : (
                    <div className="meet-empty-tile">Ожидание видео...</div>
                  )}
                </div>
              </div>
            ) : (
              <GridLayout tracks={orderedTracks} className="meet-grid meet-grid--equal">
                <MeetParticipantTile />
              </GridLayout>
            )}
          </div>

          {showParticipants ? (
            <aside className="meet-participants-panel">
              <h3>Участники</h3>
              <ul>
                {participants.map((participant) => (
                  <li key={participant.identity} className={participant.isSpeaking ? "is-speaking" : ""}>
                    <span>{participant.name || participant.identity}</span>
                    <small>{participant.isSpeaking ? "говорит" : "в сети"}</small>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
        </section>

        <footer className="meet-controls-shell">
          <div className="meet-toolbar" ref={controlBarHostRef}>
            <ControlBar
              className="meet-controlbar"
              variation="minimal"
              controls={{
                microphone: true,
                camera: true,
                screenShare: true,
                chat: false,
                settings: false,
                leave: false,
              }}
            />
            {controlBarElement
              ? createPortal(
                  <div className="meet-toolbar-menu-wrapper">
                    <button
                      type="button"
                      className="meet-layout-icon-btn"
                      onClick={() => setSettingsOpen((prev) => !prev)}
                      title="Меню вида и записи"
                      aria-label="Меню вида и записи"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none">
                        <path
                          fill="currentcolor"
                          fillRule="evenodd"
                          d="M8.961.894C8.875-.298 7.125-.298 7.04.894c-.066.912-1.246 1.228-1.76.472-.67-.99-2.186-.115-1.664.96.399.824-.465 1.688-1.288 1.289-1.076-.522-1.95.994-.961 1.665.756.513.44 1.693-.472 1.759-1.192.086-1.192 1.836 0 1.922.912.066 1.228 1.246.472 1.76-.99.67-.115 2.186.96 1.664.824-.399 1.688.465 1.289 1.288-.522 1.076.994 1.95 1.665.961.513-.756 1.693-.44 1.759.472.086 1.192 1.836 1.192 1.922 0 .066-.912 1.246-1.228 1.76-.472.67.99 2.186.115 1.664-.96-.399-.824.465-1.688 1.288-1.289 1.076.522 1.95-.994.961-1.665-.756-.513-.44-1.693.472-1.759 1.192-.086 1.192-1.836 0-1.922-.912-.066-1.228-1.246-.472-1.76.99-.67.115-2.186-.96-1.664-.824.399-1.688-.465-1.289-1.288.522-1.076-.994-1.95-1.665-.961-.513.756-1.693.44-1.759-.472ZM8 13A5 5 0 1 0 8 3a5 5 0 0 0 0 10Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                    {settingsOpen ? (
                      <div className="meet-toolbar-menu">
                        <button
                          type="button"
                          onClick={() =>
                            setLayoutMode((prev) => (prev === "focus" ? "grid" : "focus"))
                          }
                        >
                          {layoutMode === "focus" ? "Вид: сетка 2x2" : "Вид: фокус"}
                        </button>
                        <button
                          type="button"
                          onClick={onToggleRecording}
                          disabled={recordingBusy}
                        >
                          {recordingBusy
                            ? "Обработка..."
                            : isRecording
                              ? "Остановить запись"
                              : "Начать запись"}
                        </button>
                      </div>
                    ) : null}
                  </div>,
                  controlBarElement,
                )
              : null}
          </div>
        </footer>

        <RoomAudioRenderer />
        <ConnectionStateToast />
      </div>
    </LayoutContextProvider>
  );
}

function App() {
  const [room, setRoom] = useState(() => {
    const queryRoom = new URLSearchParams(window.location.search).get("room");
    return queryRoom?.trim() || "demo-room";
  });
  const [username, setUsername] = useState(() => {
    const queryUser = new URLSearchParams(window.location.search).get("name");
    return queryUser?.trim() || "";
  });
  const [backendUrl, setBackendUrl] = useState(window.location.origin);
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState("");
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [blurEnabled, setBlurEnabled] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const signalingProxyUrl = useMemo(() => {
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${wsProtocol}://${window.location.host}/livekit`;
  }, []);

  const canJoin = useMemo(
    () => room.trim().length > 0 && username.trim().length > 0,
    [room, username],
  );
  const inviteLink = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", room.trim() || "demo-room");
    return url.toString();
  }, [room]);
  const audioCaptureOptions: true | AudioCaptureOptions = useMemo(() => {
    if (!selectedAudioDeviceId) {
      return true;
    }
    return { deviceId: selectedAudioDeviceId };
  }, [selectedAudioDeviceId]);
  const videoCaptureOptions: true | VideoCaptureOptions = useMemo(() => {
    if (!selectedVideoDeviceId) {
      return true;
    }
    return { deviceId: selectedVideoDeviceId };
  }, [selectedVideoDeviceId]);

  useEffect(() => {
    let isCancelled = false;
    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (isCancelled) {
          return;
        }
        const cameras = devices.filter((d) => d.kind === "videoinput");
        const mics = devices.filter((d) => d.kind === "audioinput");
        setVideoDevices(cameras);
        setAudioDevices(mics);
        if (!selectedVideoDeviceId && cameras[0]?.deviceId) {
          setSelectedVideoDeviceId(cameras[0].deviceId);
        }
        if (!selectedAudioDeviceId && mics[0]?.deviceId) {
          setSelectedAudioDeviceId(mics[0].deviceId);
        }
      } catch {
        if (!isCancelled) {
          setPreviewError("Не удалось получить список устройств.");
        }
      }
    };

    loadDevices();
    navigator.mediaDevices.addEventListener("devicechange", loadDevices);
    return () => {
      isCancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", loadDevices);
    };
  }, [selectedAudioDeviceId, selectedVideoDeviceId]);

  useEffect(() => {
    if (token) {
      if (previewStream) {
        previewStream.getTracks().forEach((track) => track.stop());
      }
      setPreviewStream(null);
      return;
    }

    let isCancelled = false;
    let streamToCleanup: MediaStream | null = null;

    const startPreview = async () => {
      setPreviewError(null);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: selectedVideoDeviceId
            ? { deviceId: { exact: selectedVideoDeviceId } }
            : true,
          audio: selectedAudioDeviceId
            ? { deviceId: { exact: selectedAudioDeviceId } }
            : true,
        });

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        setPreviewStream((current) => {
          current?.getTracks().forEach((track) => track.stop());
          return stream;
        });
        streamToCleanup = stream;
      } catch (mediaError) {
        if (isCancelled) {
          return;
        }
        const message =
          mediaError instanceof Error
            ? mediaError.message
            : "Разрешите доступ к микрофону и камере.";
        setPreviewError(message);
        setPreviewStream((current) => {
          current?.getTracks().forEach((track) => track.stop());
          return null;
        });
      }
    };

    void startPreview();

    return () => {
      isCancelled = true;
      streamToCleanup?.getTracks().forEach((track) => track.stop());
    };
  }, [selectedAudioDeviceId, selectedVideoDeviceId, token]);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }
    videoRef.current.srcObject = previewStream;
  }, [previewStream]);

  useEffect(() => {
    if (!previewStream) {
      setMicLevel(0);
      return;
    }

    const audioTrack = previewStream.getAudioTracks()[0];
    if (!audioTrack) {
      setMicLevel(0);
      return;
    }

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let rafId = 0;
    const update = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i += 1) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      setMicLevel(Math.min(100, Math.round(rms * 260)));
      rafId = requestAnimationFrame(update);
    };
    update();

    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close();
    };
  }, [previewStream]);

  const onCapturePhoto = () => {
    if (!videoRef.current) {
      return;
    }
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }
    const canvas = document.createElement("canvas");
    const side = Math.min(video.videoWidth, video.videoHeight);
    const sx = Math.max(0, (video.videoWidth - side) / 2);
    const sy = Math.max(0, (video.videoHeight - side) / 2);
    canvas.width = 240;
    canvas.height = 240;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.drawImage(video, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    setAvatarDataUrl(canvas.toDataURL("image/jpeg", 0.8));
  };

  const onJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canJoin) {
      return;
    }

    setIsJoining(true);
    setError(null);

    const endpoint = new URL("/token", backendUrl);
    endpoint.searchParams.set("room", room.trim());
    endpoint.searchParams.set("username", username.trim());

    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to get token");
      }

      const data = (await response.json()) as TokenResponse;
      setToken(data.token);
      setServerUrl(signalingProxyUrl);
    } catch (joinError) {
      setError(
        joinError instanceof Error
          ? joinError.message
          : "Неизвестная ошибка при входе в комнату",
      );
    } finally {
      setIsJoining(false);
    }
  };

  if (token) {
    return (
      <main className="room-page">
        <LiveKitRoom
          className="room-root"
          token={token}
          serverUrl={serverUrl}
          connect
          video={videoCaptureOptions}
          audio={audioCaptureOptions}
          onDisconnected={() => {
            setToken(null);
          }}
        >
          <MeetRoomLayout
            roomName={room}
            inviteLink={inviteLink}
            backendUrl={backendUrl}
            blurEnabled={blurEnabled}
            avatarDataUrl={avatarDataUrl}
            onLeave={() => setToken(null)}
          />
        </LiveKitRoom>
      </main>
    );
  }

  return (
    <main className="join-page">
      <section className="hero-panel">
        <div className="hero-preview">
          <div className="hero-preview-badge">Готово к входу</div>
          {avatarDataUrl ? (
            <img className="hero-avatar-image" src={avatarDataUrl} alt="Фото профиля" />
          ) : (
            <div className="hero-avatar">{username.trim()[0]?.toUpperCase() || "?"}</div>
          )}
          <p className="hero-preview-title">{username.trim() || "Гость"}</p>
          <section className="diagnostics">
            <div className="preview-wrap">
              <video
                ref={videoRef}
                className={`preview-video ${blurEnabled ? "preview-video--blur" : ""}`}
                autoPlay
                muted
                playsInline
              />
              {!previewStream ? (
                <div className="preview-fallback">Камера недоступна</div>
              ) : null}
            </div>
            <div className="diagnostics-controls">
              <button type="button" className="secondary-btn" onClick={onCapturePhoto}>
                Заснять
              </button>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={blurEnabled}
                  onChange={(event) => setBlurEnabled(event.target.checked)}
                />
                Размытый фон (локально)
              </label>
            </div>
            <div className="diagnostics-stats">
              <div className="mic-meter" aria-label="microphone level">
                <span style={{ width: `${micLevel}%` }} />
              </div>
              <p className="diag-line">
                Микрофон: {previewStream?.getAudioTracks()[0] ? "OK" : "Нет сигнала"} |
                Камера: {previewStream?.getVideoTracks()[0] ? "OK" : "Нет сигнала"}
              </p>
            </div>
            {previewError ? <p className="error">{previewError}</p> : null}
            <div className="diag-devices">
              <label>
                Камера
                <select
                  value={selectedVideoDeviceId}
                  onChange={(event) => setSelectedVideoDeviceId(event.target.value)}
                >
                  {videoDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Камера ${device.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Микрофон
                <select
                  value={selectedAudioDeviceId}
                  onChange={(event) => setSelectedAudioDeviceId(event.target.value)}
                >
                  {audioDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Микрофон ${device.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        </div>
      </section>

      <form className="join-card" onSubmit={onJoin}>
        <h2>Вход в комнату</h2>

        <label>
          Ваше имя
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Алиса"
            autoComplete="off"
            required
          />
        </label>

        <label>
          Код комнаты
          <input
            type="text"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="demo-room"
            autoComplete="off"
            required
          />
        </label>

        <label>
          Ссылка-приглашение
          <input type="text" value={inviteLink} readOnly />
        </label>

        <details className="advanced">
          <summary>Расширенные настройки</summary>
          <label>
            URL сервера токенов
            <input
              type="url"
              value={backendUrl}
              onChange={(event) => setBackendUrl(event.target.value)}
              placeholder={window.location.origin}
              required
            />
          </label>
        </details>

        {error ? <p className="error">{error}</p> : null}

        <button type="submit" disabled={!canJoin || isJoining}>
          {isJoining ? "Подключение..." : "Войти"}
        </button>
      </form>
    </main>
  );
}

export default App;
