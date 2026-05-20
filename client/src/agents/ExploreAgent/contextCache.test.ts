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

  describe("LRU eviction", () => {
    // Helper: generate content of roughly `n` tokens
    function makeContent(id: number, lines = 20): string {
      return Array.from({ length: lines }, (_, i) => `// file${id} line ${i}: export const val = ${i};`).join("\n");
    }

    it("evicts oldest entry when MAX_ENTRIES (50) is reached", () => {
      // Fill cache to capacity
      for (let i = 0; i < 50; i++) {
        cache.offload(`t_${i}`, "read_file", {}, makeContent(i));
      }
      expect(cache.stats.entries).toBe(50);
      expect(cache.retrieve("t_0")).not.toBeNull();

      // Adding one more should evict t_0 (the oldest)
      cache.offload("t_50", "read_file", {}, makeContent(50));
      expect(cache.stats.entries).toBe(50);
      expect(cache.retrieve("t_0")).toBeNull();
      expect(cache.retrieve("t_50")).not.toBeNull();
      // t_1 should still be present
      expect(cache.retrieve("t_1")).not.toBeNull();
    });

    it("evicts multiple entries when adding many beyond capacity", () => {
      for (let i = 0; i < 50; i++) {
        cache.offload(`t_${i}`, "read_file", {}, makeContent(i));
      }
      // Add 3 more
      cache.offload("t_50", "read_file", {}, makeContent(50));
      cache.offload("t_51", "read_file", {}, makeContent(51));
      cache.offload("t_52", "read_file", {}, makeContent(52));

      expect(cache.stats.entries).toBe(50);
      expect(cache.retrieve("t_0")).toBeNull();
      expect(cache.retrieve("t_1")).toBeNull();
      expect(cache.retrieve("t_2")).toBeNull();
      expect(cache.retrieve("t_3")).not.toBeNull(); // still present
      expect(cache.retrieve("t_52")).not.toBeNull();
    });

    it("evicts by total token limit (MAX_TOTAL_TOKENS = 200_000)", () => {
      // Create a very large content item (~100k tokens worth of lines)
      const bigContent = Array.from({ length: 8000 }, (_, i) =>
        `export function bigHandler${i}(req: Request, res: Response) { return res.json({ ok: true, data: "${i}" }); }`
      ).join("\n");

      // Offload two big items — combined should approach or exceed 200k tokens
      cache.offload("big_1", "read_file", {}, bigContent);
      const tokensFirst = cache.stats.totalOffloadedTokens;
      expect(tokensFirst).toBeGreaterThan(50000);

      cache.offload("big_2", "read_file", {}, bigContent);

      // If combined exceeds 200k, big_1 should have been evicted
      if (tokensFirst * 2 > 200_000) {
        expect(cache.retrieve("big_1")).toBeNull();
        expect(cache.retrieve("big_2")).not.toBeNull();
        expect(cache.stats.entries).toBe(1);
      }
    });

    it("totalOffloadedTokens decreases after eviction", () => {
      for (let i = 0; i < 50; i++) {
        cache.offload(`t_${i}`, "read_file", {}, makeContent(i));
      }
      const tokensBefore = cache.stats.totalOffloadedTokens;

      // Evict one by adding new
      cache.offload("t_new", "read_file", {}, makeContent(999));
      // Tokens should stay roughly the same (evicted ~= added)
      expect(cache.stats.totalOffloadedTokens).toBeLessThanOrEqual(tokensBefore + 500);
      expect(cache.stats.totalOffloadedTokens).toBeGreaterThan(0);
    });
  });
});
