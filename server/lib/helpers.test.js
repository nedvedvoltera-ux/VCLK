const {
  sanitizeAvatarUrl,
  parseAvatarDataUrl,
  getAvatarExtension,
  toSafeSlug,
  parseBasicAuth,
  parseCookies,
  getEgressTroubleshootingHint,
  isEgressNotFoundError,
  createRecordingsSessionToken,
  verifyRecordingsSessionToken,
  isSafeRecordingsNextPath,
  sanitizeRecordingsFileName,
  canJoinRoom,
} = require("./helpers");

describe("sanitizeAvatarUrl", () => {
  it("accepts relative avatar paths", () => {
    expect(sanitizeAvatarUrl("/avatar/abc.jpg")).toBe("/avatar/abc.jpg");
  });

  it("rejects external or empty urls", () => {
    expect(sanitizeAvatarUrl("https://evil.example/a.png")).toBe("");
    expect(sanitizeAvatarUrl("")).toBe("");
    expect(sanitizeAvatarUrl(null)).toBe("");
  });
});

describe("parseAvatarDataUrl", () => {
  it("parses jpeg data url", () => {
    const payload = Buffer.from("hello").toString("base64");
    const parsed = parseAvatarDataUrl(`data:image/jpeg;base64,${payload}`);
    expect(parsed).not.toBeNull();
    expect(parsed.mimeType).toBe("image/jpeg");
    expect(parsed.buffer.toString()).toBe("hello");
  });

  it("rejects oversized payload", () => {
    const big = Buffer.alloc(257 * 1024, 1).toString("base64");
    expect(parseAvatarDataUrl(`data:image/png;base64,${big}`)).toBeNull();
  });

  it("rejects invalid format", () => {
    expect(parseAvatarDataUrl("not-a-data-url")).toBeNull();
    expect(parseAvatarDataUrl("data:text/plain;base64,YQ==")).toBeNull();
  });
});

describe("getAvatarExtension", () => {
  it("maps mime types", () => {
    expect(getAvatarExtension("image/png")).toBe("png");
    expect(getAvatarExtension("image/webp")).toBe("webp");
    expect(getAvatarExtension("image/jpeg")).toBe("jpg");
  });
});

describe("toSafeSlug", () => {
  it("normalizes room names for filenames", () => {
    expect(toSafeSlug("Demo Room!")).toBe("demo-room");
    expect(toSafeSlug("!!!")).toBe("room");
    expect(toSafeSlug("A_B-1")).toBe("a_b-1");
  });
});

describe("parseBasicAuth", () => {
  it("parses valid header", () => {
    const header = `Basic ${Buffer.from("viewer:secret").toString("base64")}`;
    expect(parseBasicAuth(header)).toEqual({
      username: "viewer",
      password: "secret",
    });
  });

  it("returns null for invalid header", () => {
    expect(parseBasicAuth(undefined)).toBeNull();
    expect(parseBasicAuth("Bearer x")).toBeNull();
  });
});

describe("parseCookies", () => {
  it("parses cookie header", () => {
    expect(parseCookies("a=1; b=hello%20world")).toEqual({
      a: "1",
      b: "hello world",
    });
  });

  it("handles empty header", () => {
    expect(parseCookies("")).toEqual({});
  });
});

describe("getEgressTroubleshootingHint", () => {
  it("detects redis/egress connection issues", () => {
    expect(getEgressTroubleshootingHint({ message: "egress not connected" })).toMatch(/Redis/);
    expect(getEgressTroubleshootingHint({ message: "no response from servers" })).toMatch(
      /Egress недоступен/,
    );
    expect(getEgressTroubleshootingHint({ message: "websocket url timeout reached" })).toMatch(
      /RAM/,
    );
    expect(getEgressTroubleshootingHint({ message: "other" })).toMatch(/LiveKit API/);
  });
});

describe("isEgressNotFoundError", () => {
  it("detects missing egress sessions", () => {
    expect(isEgressNotFoundError({ message: "egress not found", code: "not_found" })).toBe(true);
    expect(isEgressNotFoundError({ message: "timeout" })).toBe(false);
  });
});

describe("recordings session token", () => {
  const opts = {
    user: "viewer",
    secret: "test-secret",
    ttlMs: 60_000,
    now: 1_000_000,
  };

  it("creates and verifies valid token", () => {
    const token = createRecordingsSessionToken(opts);
    expect(
      verifyRecordingsSessionToken(token, {
        user: opts.user,
        secret: opts.secret,
        now: opts.now + 1000,
      }),
    ).toBe(true);
  });

  it("rejects expired or tampered token", () => {
    const token = createRecordingsSessionToken(opts);
    expect(
      verifyRecordingsSessionToken(token, {
        user: opts.user,
        secret: opts.secret,
        now: opts.now + opts.ttlMs + 1,
      }),
    ).toBe(false);
    expect(
      verifyRecordingsSessionToken(`${token}x`, {
        user: opts.user,
        secret: opts.secret,
        now: opts.now,
      }),
    ).toBe(false);
    expect(
      verifyRecordingsSessionToken("", {
        user: opts.user,
        secret: opts.secret,
      }),
    ).toBe(false);
  });
});

describe("isSafeRecordingsNextPath", () => {
  it("allows only recordings paths", () => {
    expect(isSafeRecordingsNextPath("/recordings")).toBe(true);
    expect(isSafeRecordingsNextPath("/recordings?file=a.mp4")).toBe(true);
    expect(isSafeRecordingsNextPath("/token")).toBe(false);
    expect(isSafeRecordingsNextPath("https://evil")).toBe(false);
  });
});

describe("sanitizeRecordingsFileName", () => {
  it("allows plain mp4 names", () => {
    expect(sanitizeRecordingsFileName("room-1.mp4")).toBe("room-1.mp4");
  });

  it("blocks path traversal and non-mp4", () => {
    expect(sanitizeRecordingsFileName("../secret.mp4")).toBe("");
    expect(sanitizeRecordingsFileName("a/b.mp4")).toBe("");
    expect(sanitizeRecordingsFileName("notes.txt")).toBe("");
  });
});

describe("canJoinRoom", () => {
  it("requires non-empty room and username", () => {
    expect(canJoinRoom("demo", "alice")).toBe(true);
    expect(canJoinRoom(" ", "alice")).toBe(false);
    expect(canJoinRoom("demo", "")).toBe(false);
  });
});
