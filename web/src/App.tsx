import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  getTrackReferenceId,
  isTrackReference,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-core";
import {
  ChatEntry,
  ConnectionStateToast,
  ControlBar,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useChat,
  useCreateLayoutContext,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track, type AudioCaptureOptions, type VideoCaptureOptions } from "livekit-client";
import "@livekit/components-styles";
import {
  buildHttpsRequiredMessage,
  buildInviteLink,
  buildSignalingProxyUrl,
  canJoin as canJoinRoom,
  getMobileLayoutMode,
  getNetworkQuality,
  isNonEmptyChatMessage,
  parseParticipantAvatar,
  parseRecordingStatusPayload,
  readJoinQueryParams,
  resolveSelectedTrack,
  shouldAutoStartRecording,
  shouldHideChatName,
  shouldHideChatTimestamp,
  sortTracksByScreenSharePriority,
  tryParseJsonObject,
  type NetworkQuality,
} from "./lib/meetingHelpers";
import DashboardApp from "./DashboardApp";
import { useToast } from "./ui/Toast";

type TokenResponse = {
  token: string;
};

type AvatarUploadResponse = {
  avatarUrl: string;
};

function MeetParticipantTile({
  trackRef,
  className,
}: {
  trackRef?: TrackReferenceOrPlaceholder;
  className?: string;
}) {
  const participant = trackRef?.participant;
  const avatarUrl = useMemo(
    () =>
      parseParticipantAvatar(
        participant?.metadata,
        typeof participant?.attributes?.avatarDataUrl === "string"
          ? participant.attributes.avatarDataUrl
          : null,
      ),
    [participant?.attributes?.avatarDataUrl, participant?.metadata],
  );
  const isSpeaking = Boolean(participant?.isSpeaking);
  const participantLabel = participant?.name || participant?.identity || "Участник";
  const hasVideo =
    trackRef &&
    isTrackReference(trackRef) &&
    trackRef.publication.isSubscribed &&
    !trackRef.publication.isMuted;

  return (
    <div
      className={`meet-participant-shell ${className ?? ""} ${isSpeaking ? "is-speaking" : ""} ${avatarUrl ? "has-custom-avatar" : ""}`}
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

function MeetChatDrawer({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { chatMessages, send, isSending } = useChat();
  const messagesRef = useRef<HTMLUListElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight });
  }, [chatMessages, isOpen]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = inputRef.current?.value || "";
    if (!isNonEmptyChatMessage(value)) {
      return;
    }
    await send(value.trim());
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  };

  return (
    <aside className={`meet-chat-drawer ${isOpen ? "is-open" : ""}`}>
      <div className="lk-chat">
        <div className="lk-chat-header">
          <span>Сообщения</span>
          <button type="button" className="lk-close-button" onClick={onClose} aria-label="Закрыть чат">
            ×
          </button>
        </div>
        <ul className="lk-list lk-chat-messages" ref={messagesRef}>
          {chatMessages.map((msg, idx, allMsg) => {
            const hideName = shouldHideChatName(msg.from, allMsg[idx - 1]?.from, idx);
            const hideTimestamp = shouldHideChatTimestamp(
              msg.timestamp,
              allMsg[idx - 1]?.timestamp ?? 0,
              hideName,
            );
            return (
              <ChatEntry
                key={msg.id ?? idx}
                hideName={hideName}
                hideTimestamp={hideTimestamp}
                entry={msg}
              />
            );
          })}
        </ul>
        <form className="lk-chat-form" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            className="lk-form-control lk-chat-form-input"
            type="text"
            disabled={isSending}
            placeholder="Введите сообщение..."
            onInput={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
          />
          <button type="submit" className="lk-button lk-chat-form-button" disabled={isSending}>
            Отправить
          </button>
        </form>
      </div>
    </aside>
  );
}

function MeetRoomLayout({
  roomName,
  inviteLink,
  backendUrl,
  autoRecordEnabled = false,
  onLeave,
}: {
  roomName: string;
  inviteLink: string;
  backendUrl: string;
  autoRecordEnabled?: boolean;
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
  const [recordingBusy, setRecordingBusy] = useState(false);
  const autoRecordAttemptedRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showParticipants, setShowParticipants] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => window.matchMedia("(max-width: 980px)").matches,
  );
  const toast = useToast();
  const controlBarHostRef = useRef<HTMLDivElement | null>(null);
  const [controlBarElement, setControlBarElement] = useState<HTMLDivElement | null>(null);
  const isChatOpen = Boolean(layoutContext.widget.state?.showChat);
  const onToggleChat = () => {
    layoutContext.widget.dispatch?.({ msg: "toggle_chat" });
  };
  const localIdentity = localParticipant.identity;
  const orderedTracks = useMemo(
    () =>
      sortTracksByScreenSharePriority(
        tracks,
        (trackRef) => trackRef.source === Track.Source.ScreenShare,
      ),
    [tracks],
  );
  const selectedTrack = useMemo(
    () => resolveSelectedTrack(orderedTracks, selectedTrackId, getTrackReferenceId),
    [orderedTracks, selectedTrackId],
  );
  const activeTrackId = selectedTrack ? getTrackReferenceId(selectedTrack) : null;
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
    };
    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
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
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      const recording = parseRecordingStatusPayload(payload);
      setIsRecording(recording.active);
      setRecordingEgressId(recording.egressId);
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
      toast({ title: "Ссылка скопирована" });
    } catch {
      setIsCopied(false);
      toast({ title: "Не удалось скопировать ссылку", tone: "error" });
    }
  };

  const startRoomRecording = useCallback(async () => {
    const endpoint = new URL("/recording/start", backendUrl);
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: roomName }),
    });
    const rawBody = await response.text();
    const payload = tryParseJsonObject(rawBody);
    if (payload === null) {
      throw new Error("Не удалось начать запись: сервер вернул некорректный ответ.");
    }
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : "Не удалось начать запись.");
    }
    setIsRecording(true);
    setRecordingEgressId(typeof payload.egressId === "string" ? payload.egressId : null);
    await fetchRecordingState();
    return payload;
  }, [backendUrl, fetchRecordingState, roomName]);

  useEffect(() => {
    if (
      !shouldAutoStartRecording({
        recordingEnabled: autoRecordEnabled,
        participantCount: participants.length,
        alreadyRecording: isRecording,
        alreadyAttempted: autoRecordAttemptedRef.current,
      })
    ) {
      return;
    }
    autoRecordAttemptedRef.current = true;
    void startRoomRecording()
      .then(() => {
        toast({ title: "Запись началась", description: "В комнате два участника." });
      })
      .catch((error) => {
        toast({
          title: "Не удалось начать запись",
          description: error instanceof Error ? error.message : undefined,
          tone: "error",
        });
      });
  }, [
    autoRecordEnabled,
    isRecording,
    participants.length,
    startRoomRecording,
    toast,
  ]);

  const onToggleRecording = async () => {
    setRecordingBusy(true);
    const stopping = isRecording;
    try {
      if (!stopping) {
        await startRoomRecording();
        toast({ title: "Запись началась" });
        setSettingsOpen(false);
        return;
      }
      const endpoint = new URL("/recording/stop", backendUrl);
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: roomName, egressId: recordingEgressId }),
      });
      const rawBody = await response.text();
      const payload = tryParseJsonObject(rawBody);
      if (payload === null) {
        throw new Error("Не удалось остановить запись: сервер вернул некорректный ответ.");
      }
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Не удалось остановить запись.",
        );
      }
      setIsRecording(false);
      setRecordingEgressId(null);
      if (typeof payload.warning === "string" && payload.warning) {
        toast({ title: "Запись", description: payload.warning });
      } else {
        toast({ title: "Запись остановлена" });
      }
      await fetchRecordingState();
      setSettingsOpen(false);
    } catch (error) {
      toast({
        title: stopping ? "Не удалось остановить запись" : "Не удалось начать запись",
        description: error instanceof Error ? error.message : undefined,
        tone: "error",
      });
      setSettingsOpen(false);
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

  const localTrack = useMemo(
    () =>
      orderedTracks.find((trackRef) => trackRef.participant.identity === localIdentity) ??
      orderedTracks[0],
    [localIdentity, orderedTracks],
  );

  const remoteTracks = useMemo(
    () => orderedTracks.filter((trackRef) => trackRef.participant.identity !== localIdentity),
    [localIdentity, orderedTracks],
  );

  const mobilePrimaryTrack = useMemo(
    () => remoteTracks[0] ?? localTrack,
    [localTrack, remoteTracks],
  );

  const mobilePreviewTrack = useMemo(() => {
    if (orderedTracks.length !== 2) {
      return null;
    }
    const primaryTrackId = mobilePrimaryTrack ? getTrackReferenceId(mobilePrimaryTrack) : null;
    return (
      orderedTracks.find((trackRef) => getTrackReferenceId(trackRef) !== primaryTrackId) ?? null
    );
  }, [mobilePrimaryTrack, orderedTracks]);

  return (
    <LayoutContextProvider value={layoutContext}>
      <div className="meet-room">
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
              aria-expanded={showParticipants}
              aria-controls="meeting-participants"
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
        <section className="meet-stage">
          <MeetChatDrawer isOpen={isChatOpen} onClose={onToggleChat} />
          <aside id="meeting-participants" aria-label="Участники встречи" className={`meet-participants-drawer ${showParticipants ? "is-open" : ""}`}>
            <div className="meet-participants-panel">
              <h3>Участники</h3>
              <ul>
                {participants.map((participant) => (
                  <li key={participant.identity} className={participant.isSpeaking ? "is-speaking" : ""}>
                    <span>{participant.name || participant.identity}</span>
                    <small>{participant.isSpeaking ? "говорит" : "в сети"}</small>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
          <div className="meet-main-stage">
            {isMobileViewport ? (
              getMobileLayoutMode(orderedTracks.length) === "single" ? (
                <div className="meet-mobile-single">
                  {mobilePrimaryTrack ? (
                    <MeetParticipantTile trackRef={mobilePrimaryTrack} className="meet-main-tile" />
                  ) : (
                    <div className="meet-empty-tile">Ожидание видео...</div>
                  )}
                </div>
              ) : getMobileLayoutMode(orderedTracks.length) === "two" ? (
                <div className="meet-mobile-two-layout">
                  {mobilePrimaryTrack ? (
                    <MeetParticipantTile trackRef={mobilePrimaryTrack} className="meet-main-tile" />
                  ) : (
                    <div className="meet-empty-tile">Ожидание видео...</div>
                  )}
                  {mobilePreviewTrack ? (
                    <div className="meet-mobile-self-preview">
                      <MeetParticipantTile trackRef={mobilePreviewTrack} />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  className="meet-mobile-stack"
                  style={{
                    gridTemplateRows: `repeat(${orderedTracks.length}, minmax(0, 1fr))`,
                  }}
                >
                  {orderedTracks.map((trackRef) => (
                    <div className="meet-mobile-stack-item" key={getTrackReferenceId(trackRef)}>
                      <MeetParticipantTile trackRef={trackRef} />
                    </div>
                  ))}
                </div>
              )
            ) : layoutMode === "focus" ? (
              <div className="meet-focus-layout">
                <aside className="meet-focus-thumbs">
                  {orderedTracks.map((trackRef) => {
                    const trackId = getTrackReferenceId(trackRef);
                    const isActive = trackId === activeTrackId;
                    return (
                      <div
                        key={trackId}
                        role="button"
                        tabIndex={0}
                        className={`meet-thumb-button ${isActive ? "is-active" : ""}`}
                        aria-pressed={isActive}
                        aria-label={`Показать ${trackRef.participant.name || trackRef.participant.identity}`}
                        onClick={() => setSelectedTrackId(trackId)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedTrackId(trackId);
                          }
                        }}
                      >
                        <MeetParticipantTile trackRef={trackRef} />
                      </div>
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
                chat: true,
                settings: false,
                leave: false,
              }}
            />
            {controlBarElement
              ? createPortal(
                  <div className="meet-toolbar-menu-wrapper">
                    <DropdownMenu.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
                    <Tooltip.Root><Tooltip.Trigger asChild><DropdownMenu.Trigger className="meet-layout-icon-btn" aria-label="Меню вида и записи">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none">
                        <path
                          fill="currentcolor"
                          fillRule="evenodd"
                          d="M8.961.894C8.875-.298 7.125-.298 7.04.894c-.066.912-1.246 1.228-1.76.472-.67-.99-2.186-.115-1.664.96.399.824-.465 1.688-1.288 1.289-1.076-.522-1.95.994-.961 1.665.756.513.44 1.693-.472 1.759-1.192.086-1.192 1.836 0 1.922.912.066 1.228 1.246.472 1.76-.99.67-.115 2.186.96 1.664.824-.399 1.688.465 1.289 1.288-.522 1.076.994 1.95 1.665.961.513-.756 1.693-.44 1.759.472.086 1.192 1.836 1.192 1.922 0 .066-.912 1.246-1.228 1.76-.472.67.99 2.186.115 1.664-.96-.399-.824.465-1.688 1.288-1.289 1.076.522 1.95-.994.961-1.665-.756-.513-.44-1.693.472-1.759 1.192-.086 1.192-1.836 0-1.922-.912-.066-1.228-1.246-.472-1.76.99-.67.115-2.186-.96-1.664-.824.399-1.688-.465-1.289-1.288.522-1.076-.994-1.95-1.665-.961-.513.756-1.693.44-1.759-.472ZM8 13A5 5 0 1 0 8 3a5 5 0 0 0 0 10Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </DropdownMenu.Trigger></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="radix-tooltip" side="top">Вид и запись</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
                    <DropdownMenu.Portal><DropdownMenu.Content className="meet-toolbar-menu" side="top" align="end" sideOffset={10}>
                        <DropdownMenu.Item className="meet-menu-item" onSelect={() =>
                            setLayoutMode((prev) => (prev === "focus" ? "grid" : "focus"))
                          }>
                          {layoutMode === "focus" ? "Вид: сетка 2x2" : "Вид: фокус"}
                        </DropdownMenu.Item>
                        <DropdownMenu.Item className="meet-menu-item" onSelect={onToggleRecording}
                          disabled={recordingBusy}
                        >
                          {recordingBusy
                            ? "Обработка..."
                            : isRecording
                              ? "Остановить запись"
                              : "Начать запись"}
                        </DropdownMenu.Item>
                    </DropdownMenu.Content></DropdownMenu.Portal>
                    </DropdownMenu.Root>
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
  const [room, setRoom] = useState(() => readJoinQueryParams(window.location.search).room);
  const [username, setUsername] = useState(
    () => readJoinQueryParams(window.location.search).username,
  );
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
  const [estimatedBandwidthMbps, setEstimatedBandwidthMbps] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const signalingProxyUrl = useMemo(
    () => buildSignalingProxyUrl(window.location.protocol, window.location.host),
    [],
  );
  const meetingId = useMemo(
    () => new URLSearchParams(window.location.search).get("meeting"),
    [],
  );
  const [meetingTitle, setMeetingTitle] = useState<string | null>(null);
  const [autoRecordEnabled, setAutoRecordEnabled] = useState(false);
  const [scheduledReady, setScheduledReady] = useState(!meetingId);
  const [freeMode, setFreeMode] = useState<boolean | null>(null);

  useEffect(() => {
    if (meetingId) {
      setFreeMode(true);
      return;
    }
    void fetch("/api/bootstrap", { credentials: "include" })
      .then((response) => response.json())
      .then((data: { freeMode?: boolean }) => setFreeMode(Boolean(data.freeMode)))
      .catch(() => setFreeMode(false));
  }, [meetingId]);

  const canJoin = useMemo(
    () => (meetingId ? Boolean(username.trim()) : Boolean(freeMode) && canJoinRoom(room, username)),
    [freeMode, meetingId, room, username],
  );
  const inviteLink = useMemo(
    () => buildInviteLink(window.location.href, room),
    [room],
  );
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
    // Камера/микрофон нужны только в комнате ожидания (/room), не на dashboard.
    if (token || window.location.pathname !== "/room") {
      return;
    }
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || !window.isSecureContext) {
      const httpsPort = window.location.protocol === "https:" ? window.location.port : "8443";
      setPreviewError(buildHttpsRequiredMessage(window.location.hostname, httpsPort || undefined));
      return;
    }

    let isCancelled = false;
    const loadDevices = async () => {
      try {
        const devices = await mediaDevices.enumerateDevices();
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

    void loadDevices();
    mediaDevices.addEventListener("devicechange", loadDevices);
    return () => {
      isCancelled = true;
      mediaDevices.removeEventListener("devicechange", loadDevices);
    };
  }, [selectedAudioDeviceId, selectedVideoDeviceId, token]);

  useEffect(() => {
    if (!meetingId || token) {
      return;
    }
    let cancelled = false;
    const prepareScheduledMeeting = async () => {
      setError(null);
      setScheduledReady(false);
      try {
        const [meResponse, meetingResponse] = await Promise.all([
          fetch("/api/auth/me", { credentials: "include" }),
          fetch(`/api/meetings/${encodeURIComponent(meetingId)}`, { credentials: "include" }),
        ]);
        if (!meResponse.ok) {
          window.location.assign(`/?next=${encodeURIComponent(`/room?meeting=${meetingId}`)}`);
          return;
        }
        if (!meetingResponse.ok) {
          const payload = await meetingResponse.json().catch(() => ({ error: "Встреча недоступна" }));
          throw new Error(payload.error || "Встреча недоступна");
        }
        const me = (await meResponse.json()) as { user: { displayName: string } };
        const meetingPayload = (await meetingResponse.json()) as {
          meeting: { title: string; room_id: string };
        };
        if (!cancelled) {
          setUsername(me.user.displayName || "");
          setRoom(meetingPayload.meeting.room_id);
          setMeetingTitle(meetingPayload.meeting.title);
          setScheduledReady(true);
        }
      } catch (prepareError) {
        if (!cancelled) {
          setError(
            prepareError instanceof Error ? prepareError.message : "Не удалось открыть встречу",
          );
          setScheduledReady(true);
        }
      }
    };
    void prepareScheduledMeeting();
    return () => {
      cancelled = true;
    };
  }, [meetingId, token]);

  useEffect(() => {
    if (token || window.location.pathname !== "/room") {
      setPreviewStream((current) => {
        current?.getTracks().forEach((track) => track.stop());
        return null;
      });
      return;
    }

    let isCancelled = false;
    let streamToCleanup: MediaStream | null = null;

    const startPreview = async () => {
      setPreviewError(null);
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices || !window.isSecureContext) {
        return;
      }
      try {
        const stream = await mediaDevices.getUserMedia({
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
    const connection = (
      navigator as Navigator & {
        connection?: {
          downlink?: number;
          addEventListener?: (type: "change", listener: () => void) => void;
          removeEventListener?: (type: "change", listener: () => void) => void;
        };
      }
    ).connection;
    if (!connection) {
      setEstimatedBandwidthMbps(null);
      return;
    }

    const updateBandwidth = () => {
      const downlink = connection.downlink;
      if (typeof downlink === "number" && Number.isFinite(downlink)) {
        setEstimatedBandwidthMbps(downlink);
      } else {
        setEstimatedBandwidthMbps(null);
      }
    };

    updateBandwidth();
    connection.addEventListener?.("change", updateBandwidth);
    return () => {
      connection.removeEventListener?.("change", updateBandwidth);
    };
  }, []);

  const networkQuality = useMemo<NetworkQuality>(
    () => getNetworkQuality(estimatedBandwidthMbps),
    [estimatedBandwidthMbps],
  );

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
    canvas.width = 192;
    canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.drawImage(video, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    setAvatarDataUrl(canvas.toDataURL("image/jpeg", 0.82));
  };

  const onJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canJoin) {
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      let avatarUrlForToken = "";
      if (avatarDataUrl) {
        const avatarEndpoint = new URL("/avatar", backendUrl);
        const avatarResponse = await fetch(avatarEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageDataUrl: avatarDataUrl }),
        });
        if (avatarResponse.ok) {
          const avatarPayload = (await avatarResponse.json()) as AvatarUploadResponse;
          avatarUrlForToken = avatarPayload.avatarUrl;
        }
      }

      if (meetingId) {
        const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/join`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: username.trim(),
            avatarUrl: avatarUrlForToken,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({ error: "Не удалось подключиться" }));
          throw new Error(payload.error || "Не удалось подключиться");
        }
        const payload = (await response.json()) as {
          token: string;
          roomName: string;
          meeting?: { recording_enabled?: boolean };
        };
        setRoom(payload.roomName);
        setAutoRecordEnabled(Boolean(payload.meeting?.recording_enabled));
        setToken(payload.token);
        setServerUrl(signalingProxyUrl);
        return;
      }

      if (!freeMode) {
        throw new Error("Свободный режим отключён администратором. Войдите через запланированную встречу.");
      }

      const endpoint = new URL("/token", backendUrl);
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: room.trim(),
          username: username.trim(),
          avatarUrl: avatarUrlForToken,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Не удалось получить токен" }));
        throw new Error(payload.error || "Не удалось получить токен");
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

  if (!token && window.location.pathname !== "/room") {
    return <DashboardApp />;
  }

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
            autoRecordEnabled={autoRecordEnabled}
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
                className="preview-video"
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
            </div>
            <div className="diagnostics-stats">
              <div className="mic-meter" aria-label="microphone level">
                <span style={{ width: `${micLevel}%` }} />
              </div>
              <p className="diag-line">
                Микрофон: {previewStream?.getAudioTracks()[0] ? "OK" : "Нет сигнала"} |
                Камера: {previewStream?.getVideoTracks()[0] ? "OK" : "Нет сигнала"}
              </p>
              <div className={`net-indicator net-indicator--${networkQuality}`}>
                <span className="net-indicator-dot" />
                <span>
                  Интернет:{" "}
                  {estimatedBandwidthMbps === null
                    ? "нет данных"
                    : `${estimatedBandwidthMbps.toFixed(1)} Мбит/с`}
                </span>
              </div>
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
        <h2>{meetingId ? "Проверка перед входом" : "Вход в комнату"}</h2>
        <p className="join-dashboard-link">
          {meetingId
            ? "Проверьте камеру и микрофон, затем подключитесь к встрече."
            : freeMode
              ? <>Укажите имя и код комнаты. Список запланированных встреч — в <a href="/">dashboard VCLK</a>.</>
              : <>Свободный режим отключён. Запланированные встречи доступны в <a href="/">dashboard VCLK</a>.</>}
        </p>

        {meetingId ? (
          <label>
            Встреча
            <input type="text" value={meetingTitle || (scheduledReady ? "…" : "Загрузка…")} readOnly />
          </label>
        ) : null}

        {meetingId || freeMode ? (
          <label>
            Ваше имя
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Алиса"
              autoComplete="name"
              required
            />
          </label>
        ) : null}

        {!meetingId && freeMode ? (
          <>
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
          </>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <div className="join-card-actions">
          {meetingId || freeMode ? (
            <button type="submit" disabled={!canJoin || isJoining || (Boolean(meetingId) && !scheduledReady) || freeMode === null}>
              {isJoining ? "Подключение..." : meetingId ? "Подключиться к встрече" : "Войти"}
            </button>
          ) : (
            <a className="primary-link-btn" href="/">Открыть dashboard</a>
          )}
        </div>
      </form>
    </main>
  );
}

export default App;
