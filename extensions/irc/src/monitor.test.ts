import { describe, expect, it } from "vitest";
import { resolveIrcInboundTarget } from "./monitor.js";

describe("irc monitor inbound target", () => {
  it("keeps channel target for group messages", () => {
    expect(
      resolveIrcInboundTarget({
        target: "#coderclaw",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: true,
      target: "#coderclaw",
      rawTarget: "#coderclaw",
    });
  });

  it("maps DM target to sender nick and preserves raw target", () => {
    expect(
      resolveIrcInboundTarget({
        target: "coderclaw-bot",
        senderNick: "alice",
      }),
    ).toEqual({
      isGroup: false,
      target: "alice",
      rawTarget: "coderclaw-bot",
    });
  });

  it("falls back to raw target when sender nick is empty", () => {
    expect(
      resolveIrcInboundTarget({
        target: "coderclaw-bot",
        senderNick: " ",
      }),
    ).toEqual({
      isGroup: false,
      target: "coderclaw-bot",
      rawTarget: "coderclaw-bot",
    });
  });
});
