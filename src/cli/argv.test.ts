import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "coderclaw", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "coderclaw", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "coderclaw", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "coderclaw", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "coderclaw", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "coderclaw", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "coderclaw", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "coderclaw"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "coderclaw", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "coderclaw", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "coderclaw", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "coderclaw", "status", "--timeout=2500"], "--timeout")).toBe(
      "2500",
    );
    expect(getFlagValue(["node", "coderclaw", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "coderclaw", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "coderclaw", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "coderclaw", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "coderclaw", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "coderclaw", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "coderclaw", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "coderclaw", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "coderclaw", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "coderclaw", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["node", "coderclaw", "status"],
    });
    expect(nodeArgv).toEqual(["node", "coderclaw", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["node-22", "coderclaw", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "coderclaw", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["node-22.2.0.exe", "coderclaw", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "coderclaw", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["node-22.2", "coderclaw", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "coderclaw", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["node-22.2.exe", "coderclaw", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "coderclaw", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["/usr/bin/node-22.2.0", "coderclaw", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "coderclaw", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["nodejs", "coderclaw", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "coderclaw", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["node-dev", "coderclaw", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "coderclaw", "node-dev", "coderclaw", "status"]);

    const directArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["coderclaw", "status"],
    });
    expect(directArgv).toEqual(["node", "coderclaw", "status"]);

    const bunArgv = buildParseArgv({
      programName: "coderclaw",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "coderclaw",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "coderclaw", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "coderclaw", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "coderclaw", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "coderclaw", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "coderclaw", "config", "get", "update"])).toBe(false);
    expect(shouldMigrateState(["node", "coderclaw", "config", "unset", "update"])).toBe(false);
    expect(shouldMigrateState(["node", "coderclaw", "models", "list"])).toBe(false);
    expect(shouldMigrateState(["node", "coderclaw", "models", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "coderclaw", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "coderclaw", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "coderclaw", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "coderclaw", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["config", "get"])).toBe(false);
    expect(shouldMigrateStateFromPath(["models", "status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
