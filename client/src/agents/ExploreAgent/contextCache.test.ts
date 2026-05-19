import { describe, it, expect, beforeEach } from "vitest";
import { ContextCache } from "./contextCache";

describe("ContextCache", () => {
  let cache: ContextCache;

  beforeEach(() => {
    cache = new ContextCache();
  });

  describe("shouldOffload", () => {
    it("returns false for short content", () => {
      expect(cache.shouldOffload("hello world")).toBe(false);
    });

    it("returns true for content exceeding threshold (~1500 tokens)", () => {
      // Use realistic code-like content; each line is ~10 tokens
      const lines = Array.from({ length: 200 }, (_, i) => `export function handler${i}(req: Request, res: Response) { return res.json({ ok: true }); }`);
      const longContent = lines.join("\n");
      expect(cache.shouldOffload(longContent)).toBe(true);
    });

    it("returns false for content under threshold", () => {
      const shortContent = "const x = 1;\nconst y = 2;\n".repeat(10);
      expect(cache.shouldOffload(shortContent)).toBe(false);
    });
  });

  describe("offload + retrieve", () => {
    it("stores content and returns a preview", () => {
      const content = Array.from({ length: 50 }, (_, i) => `line ${i}: some code here`).join("\n");
      const preview = cache.offload("tool_1", "read_file", { path: "/foo.ts" }, content);

      // Preview should contain first few lines
      expect(preview).toContain("line 0:");
      expect(preview).toContain("line 7:");
      // Preview should NOT contain all lines
      expect(preview).not.toContain("line 49:");
      // Should have cache reference with recovery hint
      expect(preview).toContain("已缓存");
      expect(preview).toContain("如需完整内容可重新 read_file");
    });

    it("retrieve returns full content", () => {
      const content = "full content here\n".repeat(100);
      cache.offload("tool_2", "search", { pattern: "foo" }, content);

      expect(cache.retrieve("tool_2")).toBe(content);
    });

    it("retrieve returns null for unknown id", () => {
      expect(cache.retrieve("nonexistent")).toBeNull();
    });
  });

  describe("stats", () => {
    it("tracks entries and total offloaded tokens", () => {
      expect(cache.stats.entries).toBe(0);
      expect(cache.stats.totalOffloadedTokens).toBe(0);

      const content = Array.from({ length: 200 }, (_, i) => `export const item${i} = { id: ${i}, name: "item" };`).join("\n");
      cache.offload("t1", "read_file", {}, content);

      expect(cache.stats.entries).toBe(1);
      expect(cache.stats.totalOffloadedTokens).toBeGreaterThan(0);
    });
  });

  describe("clear", () => {
    it("removes all cached entries", () => {
      const content = Array.from({ length: 200 }, (_, i) => `line ${i}: export const val${i} = ${i};`).join("\n");
      cache.offload("t1", "read_file", {}, content);
      cache.offload("t2", "search", {}, content);

      cache.clear();

      expect(cache.stats.entries).toBe(0);
      expect(cache.retrieve("t1")).toBeNull();
      expect(cache.retrieve("t2")).toBeNull();
    });
  });

  describe("preview format", () => {
    it("does not add suffix for short content that fits in preview lines", () => {
      // Content with fewer lines than PREVIEW_LINES (8)
      const content = "line1\nline2\nline3";
      const preview = cache.offload("t3", "read_file", {}, content);

      expect(preview).not.toContain("已缓存");
      expect(preview).toBe(content);
    });
  });
});
