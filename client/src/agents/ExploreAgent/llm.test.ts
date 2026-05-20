import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock localStorage for node environment
beforeAll(() => {
  if (typeof globalThis.localStorage === "undefined") {
    (globalThis as any).localStorage = {
      getItem: vi.fn(() => "test-token"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
  }
});

// Mock useSession (loaded by llm.ts indirectly)
vi.mock("../../composables/useSession", () => ({
  authFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: null }) })),
}));

// Mock config
vi.mock("../../config", () => ({
  API_BASE: "http://localhost:3000",
}));

import { validateBashCommand } from "./llm";

describe("validateBashCommand", () => {
  describe("allowed commands", () => {
    it("allows simple ls", () => {
      expect(validateBashCommand("ls")).toBeNull();
    });

    it("allows ls with flags", () => {
      expect(validateBashCommand("ls -la /tmp")).toBeNull();
    });

    it("allows cat", () => {
      expect(validateBashCommand("cat /etc/hosts")).toBeNull();
    });

    it("allows head/tail", () => {
      expect(validateBashCommand("head -20 file.txt")).toBeNull();
      expect(validateBashCommand("tail -f /var/log/syslog")).toBeNull();
    });

    it("allows find", () => {
      expect(validateBashCommand("find . -name '*.ts'")).toBeNull();
    });

    it("allows grep/rg/ag", () => {
      expect(validateBashCommand("grep -r pattern src/")).toBeNull();
      expect(validateBashCommand("rg pattern")).toBeNull();
      expect(validateBashCommand("ag pattern")).toBeNull();
    });

    it("allows git read commands", () => {
      expect(validateBashCommand("git log --oneline -10")).toBeNull();
      expect(validateBashCommand("git show HEAD")).toBeNull();
      expect(validateBashCommand("git diff")).toBeNull();
      expect(validateBashCommand("git status")).toBeNull();
      expect(validateBashCommand("git branch -a")).toBeNull();
    });

    it("allows curl", () => {
      expect(validateBashCommand("curl https://example.com")).toBeNull();
      expect(validateBashCommand("curl -s https://api.github.com/repos")).toBeNull();
    });

    it("allows tree/du/df/wc", () => {
      expect(validateBashCommand("tree src/")).toBeNull();
      expect(validateBashCommand("du -sh .")).toBeNull();
      expect(validateBashCommand("df -h")).toBeNull();
      expect(validateBashCommand("wc -l file.txt")).toBeNull();
    });

    it("allows which/type", () => {
      expect(validateBashCommand("which node")).toBeNull();
      expect(validateBashCommand("type ls")).toBeNull();
    });

    it("allows echo", () => {
      expect(validateBashCommand("echo hello")).toBeNull();
    });

    it("allows stat/file", () => {
      expect(validateBashCommand("stat /tmp")).toBeNull();
      expect(validateBashCommand("file image.png")).toBeNull();
    });
  });

  describe("allowed pipes", () => {
    it("allows piping between allowed commands", () => {
      expect(validateBashCommand("cat file.txt | grep pattern")).toBeNull();
      expect(validateBashCommand("ls -la | head -5")).toBeNull();
      expect(validateBashCommand("find . -name '*.ts' | wc -l")).toBeNull();
    });

    it("blocks pipe where second command is not allowed", () => {
      const result = validateBashCommand("cat file.txt | rm -rf /");
      expect(result).not.toBeNull();
      expect(result).toContain("not allowed");
    });

    it("blocks pipe where first command is not allowed", () => {
      const result = validateBashCommand("rm -rf / | cat");
      expect(result).not.toBeNull();
      expect(result).toContain("not allowed");
    });
  });

  describe("blocked commands", () => {
    it("blocks rm", () => {
      const result = validateBashCommand("rm -rf /");
      expect(result).not.toBeNull();
      expect(result).toContain("not allowed");
    });

    it("blocks mkdir", () => {
      expect(validateBashCommand("mkdir /tmp/test")).not.toBeNull();
    });

    it("blocks mv", () => {
      expect(validateBashCommand("mv a.txt b.txt")).not.toBeNull();
    });

    it("blocks cp", () => {
      expect(validateBashCommand("cp a.txt b.txt")).not.toBeNull();
    });

    it("blocks chmod", () => {
      expect(validateBashCommand("chmod 777 file")).not.toBeNull();
    });

    it("blocks python/node", () => {
      expect(validateBashCommand("python3 -c 'import os'")).not.toBeNull();
      expect(validateBashCommand("node -e 'process.exit(1)'")).not.toBeNull();
    });

    it("blocks npm/yarn/pnpm", () => {
      expect(validateBashCommand("npm install malware")).not.toBeNull();
      expect(validateBashCommand("pnpm add evil")).not.toBeNull();
    });

    it("blocks git write commands", () => {
      expect(validateBashCommand("git push")).not.toBeNull();
      expect(validateBashCommand("git commit -m 'x'")).not.toBeNull();
      expect(validateBashCommand("git checkout main")).not.toBeNull();
      expect(validateBashCommand("git reset --hard")).not.toBeNull();
    });
  });

  describe("subshell injection prevention", () => {
    it("blocks $() in any command including curl", () => {
      const result = validateBashCommand("curl $(rm -rf /)");
      expect(result).not.toBeNull();
      expect(result).toContain("Subshell");
    });

    it("blocks $() in allowed commands", () => {
      expect(validateBashCommand("ls $(whoami)")).not.toBeNull();
      expect(validateBashCommand("cat $(echo /etc/passwd)")).not.toBeNull();
    });

    it("blocks backticks in any command", () => {
      expect(validateBashCommand("curl `rm -rf /`")).not.toBeNull();
      expect(validateBashCommand("ls `whoami`")).not.toBeNull();
    });

    it("blocks nested subshells", () => {
      expect(validateBashCommand("echo $(echo $(rm -rf /))")).not.toBeNull();
    });
  });

  describe("command chaining prevention", () => {
    it("blocks semicolons", () => {
      const result = validateBashCommand("ls; rm -rf /");
      expect(result).not.toBeNull();
      expect(result).toContain("chaining");
    });

    it("blocks &", () => {
      const result = validateBashCommand("ls & rm -rf /");
      expect(result).not.toBeNull();
      expect(result).toContain("chaining");
    });
  });

  describe("edge cases", () => {
    it("blocks empty command", () => {
      expect(validateBashCommand("")).not.toBeNull();
      expect(validateBashCommand("   ")).not.toBeNull();
    });

    it("trims whitespace before validation", () => {
      expect(validateBashCommand("  ls -la  ")).toBeNull();
    });
  });
});
