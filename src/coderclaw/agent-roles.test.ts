import { describe, expect, it, beforeEach } from "vitest";
import {
  findAgentRole,
  registerCustomRoles,
  clearCustomRoles,
  getBuiltInAgentRoles,
  CODE_CREATOR_ROLE,
} from "./agent-roles.js";
import type { AgentRole } from "./types.js";

describe("agent-roles", () => {
  beforeEach(() => {
    clearCustomRoles();
  });

  it("returns built-in roles by name", () => {
    const role = findAgentRole("code-creator");
    expect(role).toBe(CODE_CREATOR_ROLE);
  });

  it("returns null for unknown role when no custom roles registered", () => {
    const role = findAgentRole("unknown-role");
    expect(role).toBeNull();
  });

  it("registers and finds custom roles", () => {
    const customRole: AgentRole = {
      name: "my-custom-agent",
      description: "A custom test agent",
      tools: ["view", "bash"],
      systemPrompt: "You are a custom agent.",
      model: "test/model",
    };

    registerCustomRoles([customRole]);

    const found = findAgentRole("my-custom-agent");
    expect(found).not.toBeNull();
    expect(found?.name).toBe("my-custom-agent");
    expect(found?.tools).toEqual(["view", "bash"]);
  });

  it("custom roles override built-in roles with same name", () => {
    // Register a custom role with same name as built-in (though unusual)
    const overridingRole: AgentRole = {
      name: "code-creator",
      description: "Overridden description",
      tools: ["edit"],
      systemPrompt: "Overridden prompt",
      model: "override/model",
    };

    registerCustomRoles([overridingRole]);

    const role = findAgentRole("code-creator");
    expect(role).not.toBe(CODE_CREATOR_ROLE); // different instance
    expect(role?.description).toBe("Overridden description");
    expect(role?.tools).toEqual(["edit"]);
  });

  it("can register multiple custom roles", () => {
    const roles: AgentRole[] = [
      {
        name: "role-a",
        description: "Role A",
        tools: ["view"],
        systemPrompt: "A",
        model: "m/a",
      },
      {
        name: "role-b",
        description: "Role B",
        tools: ["edit"],
        systemPrompt: "B",
        model: "m/b",
      },
    ];

    registerCustomRoles(roles);

    expect(findAgentRole("role-a")?.description).toBe("Role A");
    expect(findAgentRole("role-b")?.description).toBe("Role B");
  });

  it("clearCustomRoles removes all custom roles", () => {
    const customRole: AgentRole = {
      name: "temp-role",
      description: "Temporary",
      tools: [],
      systemPrompt: "Temp",
      model: "test",
    };

    registerCustomRoles([customRole]);
    expect(findAgentRole("temp-role")).not.toBeNull();

    clearCustomRoles();

    expect(findAgentRole("temp-role")).toBeNull();
    // Built-in still works
    expect(findAgentRole("code-creator")).toBe(CODE_CREATOR_ROLE);
  });
});
