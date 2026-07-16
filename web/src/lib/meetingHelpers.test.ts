import { describe, expect, it } from "vitest";
import {
  buildHttpsRequiredMessage,
  buildInviteLink,
  buildSignalingProxyUrl,
  canJoin,
  getMobileLayoutMode,
  getNetworkQuality,
  isNonEmptyChatMessage,
  parseParticipantAvatar,
  parseRecordingStatusPayload,
  readJoinQueryParams,
  resolveNextSelectedTrackId,
  resolveSelectedTrack,
  shouldHideChatName,
  shouldHideChatTimestamp,
  sortTracksByScreenSharePriority,
  tryParseJsonObject,
} from "./meetingHelpers";

describe("canJoin / deep-link", () => {
  it("validates join form", () => {
    expect(canJoin("demo-room", "Alice")).toBe(true);
    expect(canJoin("", "Alice")).toBe(false);
    expect(canJoin("demo-room", "  ")).toBe(false);
  });

  it("reads query params", () => {
    expect(readJoinQueryParams("?room=sales&name=Bob")).toEqual({
      room: "sales",
      username: "Bob",
    });
    expect(readJoinQueryParams("")).toEqual({
      room: "demo-room",
      username: "",
    });
  });
});

describe("invite and signaling urls", () => {
  it("builds invite link with room", () => {
    expect(buildInviteLink("https://vclk.asntl.ru/?name=x", "team-1")).toBe(
      "https://vclk.asntl.ru/?name=x&room=team-1",
    );
  });

  it("builds signaling proxy url", () => {
    expect(buildSignalingProxyUrl("https:", "vclk.asntl.ru")).toBe(
      "wss://vclk.asntl.ru/livekit",
    );
    expect(buildSignalingProxyUrl("http:", "localhost:5173")).toBe(
      "ws://localhost:5173/livekit",
    );
  });

  it("builds https required message", () => {
    expect(buildHttpsRequiredMessage("192.168.215.44", "8443")).toContain(
      "https://192.168.215.44:8443/",
    );
  });
});

describe("network quality", () => {
  it("maps downlink thresholds", () => {
    expect(getNetworkQuality(null)).toBe("unknown");
    expect(getNetworkQuality(2)).toBe("low");
    expect(getNetworkQuality(10)).toBe("medium");
    expect(getNetworkQuality(20)).toBe("high");
  });
});

describe("track ordering and selection", () => {
  it("prioritizes screen share", () => {
    const tracks = [
      { id: "cam", source: "camera" },
      { id: "share", source: "screen_share" },
    ];
    const ordered = sortTracksByScreenSharePriority(
      tracks,
      (track) => track.source === "screen_share",
    );
    expect(ordered.map((t) => t.id)).toEqual(["share", "cam"]);
  });

  it("resolves selected track with fallback", () => {
    const tracks = [
      { id: "a", source: "camera" },
      { id: "b", source: "camera" },
    ];
    expect(resolveSelectedTrack(tracks, "b", (t) => t.id)?.id).toBe("b");
    expect(resolveSelectedTrack(tracks, "missing", (t) => t.id)?.id).toBe("a");
    expect(resolveNextSelectedTrackId(["a", "b"], "b")).toBe("b");
    expect(resolveNextSelectedTrackId(["a", "b"], "x")).toBe("a");
    expect(resolveNextSelectedTrackId([], "a")).toBeNull();
  });
});

describe("mobile layout", () => {
  it("picks layout mode by track count", () => {
    expect(getMobileLayoutMode(0)).toBe("single");
    expect(getMobileLayoutMode(1)).toBe("single");
    expect(getMobileLayoutMode(2)).toBe("two");
    expect(getMobileLayoutMode(4)).toBe("stack");
  });
});

describe("avatar metadata", () => {
  it("prefers avatarUrl over avatarDataUrl", () => {
    expect(
      parseParticipantAvatar(JSON.stringify({ avatarUrl: "/avatar/1.jpg", avatarDataUrl: "data:x" })),
    ).toBe("/avatar/1.jpg");
  });

  it("falls back to attributes", () => {
    expect(parseParticipantAvatar("not-json", "/avatar/attr.jpg")).toBe("/avatar/attr.jpg");
    expect(parseParticipantAvatar(null, null)).toBeNull();
  });
});

describe("chat helpers", () => {
  it("groups consecutive messages", () => {
    expect(shouldHideChatName("alice", "alice", 1)).toBe(true);
    expect(shouldHideChatName("alice", "bob", 1)).toBe(false);
    expect(shouldHideChatName("alice", "alice", 0)).toBe(false);
    expect(shouldHideChatTimestamp(70_000, 20_000, true)).toBe(true);
    expect(shouldHideChatTimestamp(90_000, 20_000, true)).toBe(false);
    expect(isNonEmptyChatMessage("  hi ")).toBe(true);
    expect(isNonEmptyChatMessage("   ")).toBe(false);
  });
});

describe("recording response parsing", () => {
  it("parses status payload", () => {
    expect(
      parseRecordingStatusPayload({
        recording: { active: true, egressId: "eg_1" },
      }),
    ).toEqual({ active: true, egressId: "eg_1" });
    expect(parseRecordingStatusPayload({ recording: { active: false } })).toEqual({
      active: false,
      egressId: null,
    });
  });

  it("parses json body safely", () => {
    expect(tryParseJsonObject('{"ok":true}')).toEqual({ ok: true });
    expect(tryParseJsonObject("")).toEqual({});
    expect(tryParseJsonObject("<html>")).toBeNull();
  });
});
