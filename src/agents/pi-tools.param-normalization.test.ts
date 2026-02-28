import { describe, expect, it } from "vitest";
import { normalizeToolParams } from "./pi-tools.read.js";

describe("normalizeToolParams", () => {
  it("maps common edit aliases to oldText/newText", () => {
    const normalized = normalizeToolParams({
      path: "src/file.ts",
      search: "old value",
      replace: "new value",
    });

    expect(normalized?.oldText).toBe("old value");
    expect(normalized?.newText).toBe("new value");
  });

  it("extracts structured alias payloads", () => {
    const normalized = normalizeToolParams({
      file_path: "src/file.ts",
      searchText: [{ type: "text", text: "alpha" }],
      replacement: { kind: "text", value: "beta" },
    });

    expect(normalized?.path).toBe("src/file.ts");
    expect(normalized?.oldText).toBe("alpha");
    expect(normalized?.newText).toBe("beta");
  });

  it("keeps explicit oldText/newText when already provided", () => {
    const normalized = normalizeToolParams({
      path: "src/file.ts",
      oldText: "explicit-old",
      newText: "explicit-new",
      search: "alias-old",
      replace: "alias-new",
    });

    expect(normalized?.oldText).toBe("explicit-old");
    expect(normalized?.newText).toBe("explicit-new");
  });
});
