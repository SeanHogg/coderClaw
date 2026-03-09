import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveDefaultConfigCandidates,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

// So state dir is legacy ~/.coderclaw in most tests (no install-id subdir)
vi.mock("./install-id.js", () => ({ getInstallId: vi.fn(() => null) }));
import { getInstallId } from "./install-id.js";

describe("oauth paths", () => {
  it("prefers CODERCLAW_OAUTH_DIR over CODERCLAW_STATE_DIR", () => {
    const env = {
      CODERCLAW_OAUTH_DIR: "/custom/oauth",
      CODERCLAW_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from CODERCLAW_STATE_DIR when unset", () => {
    const env = {
      CODERCLAW_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("uses CODERCLAW_STATE_DIR when set", () => {
    const env = {
      CODERCLAW_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("uses profile-based state dir when CODERCLAW_PROFILE is set (multi-instance)", () => {
    const env = { CODERCLAW_PROFILE: "work" } as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => "/home/test")).toBe(path.join("/home/test", ".coderclaw-work"));
  });

  it("treats CODERCLAW_PROFILE=default as no profile", () => {
    const env = { CODERCLAW_PROFILE: "default" } as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => "/home/test")).toBe(path.join("/home/test", ".coderclaw"));
  });

  it("prefers CODERCLAW_STATE_DIR over CODERCLAW_PROFILE", () => {
    const env = {
      CODERCLAW_STATE_DIR: "/custom/state",
      CODERCLAW_PROFILE: "work",
    } as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/custom/state"));
  });

  it("uses install-id subdir when getInstallId returns id and no legacy config", () => {
    vi.mocked(getInstallId).mockReturnValueOnce("a1b2c3d4");
    expect(resolveStateDir({} as NodeJS.ProcessEnv, () => "/home/test")).toBe(
      path.join("/home/test", ".coderclaw", "a1b2c3d4"),
    );
  });

  it("uses legacy flat ~/.coderclaw when legacy config exists and install-id dir does not", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-state-"));
    try {
      const legacyDir = path.join(root, ".coderclaw");
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(path.join(legacyDir, "coderclaw.json"), "{}", "utf-8");
      vi.mocked(getInstallId).mockReturnValueOnce("newinstall");
      const result = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(result).toBe(legacyDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses CODERCLAW_HOME for default state/config locations", () => {
    const env = {
      CODERCLAW_HOME: "/srv/coderclaw-home",
    } as NodeJS.ProcessEnv;

    const resolvedHome = path.resolve("/srv/coderclaw-home");
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".coderclaw"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".coderclaw", "coderclaw.json"));
  });

  it("prefers CODERCLAW_HOME over HOME for default state/config locations", () => {
    const env = {
      CODERCLAW_HOME: "/srv/coderclaw-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv;

    const resolvedHome = path.resolve("/srv/coderclaw-home");
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".coderclaw"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".coderclaw", "coderclaw.json"));
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [path.join(resolvedHome, ".coderclaw", "coderclaw.json")];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.coderclaw when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coderclaw-state-"));
    try {
      const newDir = path.join(root, ".coderclaw");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coderclaw-config-"));
    try {
      const legacyDir = path.join(root, ".coderclaw");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "coderclaw.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyPath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "coderclaw-config-override-"));
    try {
      const legacyDir = path.join(root, ".coderclaw");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "coderclaw.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { CODERCLAW_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "coderclaw.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
