export type NetworkQuality = "low" | "medium" | "high" | "unknown";

export type TrackLike = {
  id: string;
  source: "camera" | "screen_share" | string;
  participantIdentity: string;
};

export const canJoin = (room: string, username: string): boolean =>
  room.trim().length > 0 && username.trim().length > 0;

export const buildInviteLink = (
  href: string,
  room: string,
  defaultRoom = "demo-room",
): string => {
  const url = new URL(href);
  url.searchParams.set("room", room.trim() || defaultRoom);
  return url.toString();
};

export const readJoinQueryParams = (
  search: string,
): { room: string; username: string } => {
  const params = new URLSearchParams(search);
  return {
    room: params.get("room")?.trim() || "demo-room",
    username: params.get("name")?.trim() || "",
  };
};

export const getNetworkQuality = (downlinkMbps: number | null | undefined): NetworkQuality => {
  if (typeof downlinkMbps !== "number" || !Number.isFinite(downlinkMbps)) {
    return "unknown";
  }
  if (downlinkMbps < 5) {
    return "low";
  }
  if (downlinkMbps <= 15) {
    return "medium";
  }
  return "high";
};

export const buildHttpsRequiredMessage = (hostname: string, port?: string): string => {
  const portSuffix = port ? `:${port}` : "";
  return `Для камеры и микрофона нужен HTTPS: https://${hostname}${portSuffix}/ — подтвердите сертификат в браузере.`;
};

export const buildSignalingProxyUrl = (
  protocol: string,
  host: string,
): string => {
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${host}/livekit`;
};

export const sortTracksByScreenSharePriority = <T>(
  tracks: T[],
  isScreenShare: (track: T) => boolean,
): T[] =>
  [...tracks].sort((a, b) => {
    const aPriority = isScreenShare(a) ? 0 : 1;
    const bPriority = isScreenShare(b) ? 0 : 1;
    return aPriority - bPriority;
  });

export const resolveSelectedTrack = <T>(
  orderedTracks: T[],
  selectedTrackId: string | null,
  getId: (track: T) => string,
): T | undefined =>
  orderedTracks.find((track) => getId(track) === selectedTrackId) ?? orderedTracks[0];

export const resolveNextSelectedTrackId = (
  orderedTrackIds: string[],
  selectedTrackId: string | null,
): string | null => {
  if (!orderedTrackIds.length) {
    return null;
  }
  if (selectedTrackId && orderedTrackIds.includes(selectedTrackId)) {
    return selectedTrackId;
  }
  return orderedTrackIds[0];
};

export type MobileLayoutMode = "single" | "two" | "stack";

export const getMobileLayoutMode = (trackCount: number): MobileLayoutMode => {
  if (trackCount <= 1) {
    return "single";
  }
  if (trackCount === 2) {
    return "two";
  }
  return "stack";
};

export const parseParticipantAvatar = (
  metadata: string | null | undefined,
  attributesAvatar?: string | null,
): string | null => {
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as {
        avatarDataUrl?: unknown;
        avatarUrl?: unknown;
      };
      if (typeof parsed.avatarUrl === "string" && parsed.avatarUrl.length > 0) {
        return parsed.avatarUrl;
      }
      if (typeof parsed.avatarDataUrl === "string") {
        return parsed.avatarDataUrl;
      }
    } catch {
      // ignore invalid metadata
    }
  }
  if (typeof attributesAvatar === "string" && attributesAvatar.length > 0) {
    return attributesAvatar;
  }
  return null;
};

export const shouldHideChatName = (
  currentFrom: unknown,
  previousFrom: unknown,
  index: number,
): boolean => index >= 1 && previousFrom === currentFrom;

export const shouldHideChatTimestamp = (
  currentTimestamp: number,
  previousTimestamp: number,
  hideName: boolean,
): boolean => hideName && currentTimestamp - previousTimestamp < 60_000;

export const isNonEmptyChatMessage = (value: string): boolean => value.trim().length > 0;

export const parseRecordingStatusPayload = (
  payload: unknown,
): { active: boolean; egressId: string | null } => {
  const recording = (payload as { recording?: { active?: unknown; egressId?: unknown } })
    ?.recording;
  if (recording?.active) {
    return {
      active: true,
      egressId: typeof recording.egressId === "string" ? recording.egressId : null,
    };
  }
  return { active: false, egressId: null };
};

export const tryParseJsonObject = (rawBody: string): Record<string, unknown> | null => {
  if (!rawBody) {
    return {};
  }
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
};
