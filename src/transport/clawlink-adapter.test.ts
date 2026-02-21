/**
 * Tests for ClawLink transport adapter
 *
 * Uses fetch mocking (no real network calls) to verify:
 *  - session creation on connect
 *  - task submission maps fields correctly
 *  - task state polling / streaming
 *  - cancellation
 *  - agent and skill listing
 *  - error and close handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClawLinkTransportAdapter } from "./clawlink-adapter.js";
import type { ClawLinkConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:8000";
const SESSION_ID = "test-session-uuid";
const TASK_ID = "test-task-uuid";

const config: ClawLinkConfig = {
  baseUrl: BASE_URL,
  userId: "test-user",
  deviceId: "test-device",
  pollIntervalMs: 10, // fast for tests
  timeoutMs: 5000,
};

function makeSessionResponse() {
  return {
    session_id: SESSION_ID,
    user_id: "test-user",
    created_at: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    permissions: ["task:submit", "task:view", "agent:execute"],
  };
}

function makeTaskStateResponse(state = "pending", error?: string) {
  return {
    task_id: TASK_ID,
    execution_uuid: TASK_ID,
    state,
    success: state === "completed",
    error: error ?? null,
    result: null,
    execution_time: null,
    metadata: {},
  };
}

/** Build a fetch mock that returns the given bodies in sequence. */
function mockFetchSequence(bodies: unknown[]) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const body = bodies[call++] ?? bodies[bodies.length - 1];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClawLinkTransportAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = mockFetchSequence([makeSessionResponse()]);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  describe("connect", () => {
    it("creates a session on the ClawLink node", async () => {
      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/api/runtime/sessions");
      expect(url).toContain("user_id=test-user");
      expect(url).toContain("device_id=test-device");
      expect(init.method).toBe("POST");
    });

    it("is idempotent — does not re-create the session on second call", async () => {
      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();
      await adapter.connect();

      // Only one fetch call despite two connect() calls
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("submitTask", () => {
    it("submits a task and maps the response to TaskState", async () => {
      fetchMock = mockFetchSequence([makeSessionResponse(), makeTaskStateResponse("pending")]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      const state = await adapter.submitTask({
        agentId: "claude",
        description: "Build login feature",
        input: "Create a login component",
        model: "claude-opus-4",
        metadata: { project: "my-app" },
      });

      expect(state.id).toBe(TASK_ID);
      expect(state.status).toBe("pending");
      expect(state.sessionId).toBe(SESSION_ID);

      // Verify the POST body sent to ClawLink
      const [submitUrl, submitInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(submitUrl).toContain("/api/runtime/tasks/submit");
      const body = JSON.parse(submitInit.body as string);
      expect(body.agent_type).toBe("claude");
      expect(body.prompt).toBe("Create a login component");
      expect(body.session_id).toBe(SESSION_ID);
    });

    it("auto-connects before submitting if not yet connected", async () => {
      fetchMock = mockFetchSequence([makeSessionResponse(), makeTaskStateResponse("running")]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      // No explicit connect() call
      const state = await adapter.submitTask({
        description: "test",
        input: "test input",
      });

      expect(fetchMock).toHaveBeenCalledTimes(2); // session + submit
      expect(state.status).toBe("running");
    });
  });

  // -------------------------------------------------------------------------
  describe("queryTaskState", () => {
    it("returns task state from ClawLink", async () => {
      fetchMock = mockFetchSequence([makeSessionResponse(), makeTaskStateResponse("completed")]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();
      const state = await adapter.queryTaskState(TASK_ID);

      expect(state).not.toBeNull();
      expect(state!.status).toBe("completed");
      expect(state!.progress).toBe(100);
    });

    it("returns null when ClawLink responds with an error", async () => {
      fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("sessions")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(makeSessionResponse()),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Not found"),
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();
      const state = await adapter.queryTaskState("nonexistent-task");
      expect(state).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("streamTaskUpdates", () => {
    it("polls until task reaches a terminal state and yields status changes", async () => {
      const responses = [
        makeSessionResponse(),
        makeTaskStateResponse("running"),
        makeTaskStateResponse("running"), // same — no yield
        makeTaskStateResponse("completed"),
      ];
      fetchMock = mockFetchSequence(responses);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();

      const events = [];
      for await (const event of adapter.streamTaskUpdates(TASK_ID)) {
        events.push(event);
      }

      // Should yield "running" (first change) and "completed" (terminal)
      expect(events).toHaveLength(2);
      expect(events[0].status).toBe("running");
      expect(events[1].status).toBe("completed");
      expect(events[1].progress).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  describe("cancelTask", () => {
    it("returns true when ClawLink confirms cancellation", async () => {
      fetchMock = mockFetchSequence([makeSessionResponse(), { success: true, task_id: TASK_ID }]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();
      const result = await adapter.cancelTask(TASK_ID);

      expect(result).toBe(true);
      const [url] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toContain(`/api/runtime/tasks/${TASK_ID}/cancel`);
    });

    it("returns false on network error", async () => {
      fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes("sessions")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSessionResponse()) });
        }
        return Promise.reject(new Error("Network error"));
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();
      const result = await adapter.cancelTask(TASK_ID);
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("listAgents", () => {
    it("maps ClawLink agent_type to CoderClaw AgentInfo id", async () => {
      const agents = [
        {
          agent_type: "claude",
          name: "Claude",
          description: "Anthropic Claude",
          available: true,
          capabilities: ["code"],
        },
        {
          agent_type: "ollama",
          name: "Ollama",
          description: "Local LLM",
          available: false,
          capabilities: ["code"],
        },
      ];
      fetchMock = mockFetchSequence([makeSessionResponse(), agents]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();
      const result = await adapter.listAgents();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("claude");
      expect(result[0].name).toBe("Claude");
      expect(result[0].capabilities).toContain("code");
      expect(result[1].id).toBe("ollama");
    });
  });

  // -------------------------------------------------------------------------
  describe("listSkills", () => {
    it("maps ClawLink skill_id to CoderClaw SkillInfo id", async () => {
      const skills = [
        {
          skill_id: "github-pr",
          name: "GitHub PR",
          description: "Create PRs",
          required_permissions: ["project:write"],
        },
      ];
      fetchMock = mockFetchSequence([makeSessionResponse(), skills]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();
      const result = await adapter.listSkills();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("github-pr");
      expect(result[0].enabled).toBe(true);
      expect(result[0].version).toBe("1.0.0");
    });
  });

  // -------------------------------------------------------------------------
  describe("close", () => {
    it("clears the session so the next connect() creates a new one", async () => {
      fetchMock = mockFetchSequence([makeSessionResponse(), makeSessionResponse()]);
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new ClawLinkTransportAdapter(config);
      await adapter.connect();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await adapter.close();
      await adapter.connect(); // should POST sessions again
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
