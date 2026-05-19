import { describe, it, expect } from "vitest";
import { PromptBuilder, type PlannerContext } from "./promptPipe";
import {
  identityPipe,
  coreRulesPipe,
  progressPipe,
  convergenceRulesPipe,
  antiConvergencePipe,
  stagnationWarningPipe,
  actionSchemaPipe,
  prohibitionsPipe,
} from "./pipes";

function makeCtx(overrides: Partial<PlannerContext> = {}): PlannerContext {
  return {
    summary: "测试摘要",
    userInput: "用户输入",
    turnCount: 3,
    maxTurns: 20,
    findingsCount: 2,
    elapsedSec: 30,
    filesRead: ["src/main.ts"],
    docProgress: "3/7 filled",
    isFirstTurn: false,
    consecutiveReads: 0,
    hasRecentUserDecision: false,
    ...overrides,
  };
}

describe("PromptBuilder", () => {
  it("joins non-null pipe results with double newline", () => {
    const builder = new PromptBuilder()
      .pipe(() => "A")
      .pipe(() => null)
      .pipe(() => "B");
    expect(builder.build(makeCtx())).toBe("A\n\nB");
  });

  it("filters empty strings", () => {
    const builder = new PromptBuilder()
      .pipe(() => "A")
      .pipe(() => "");
    expect(builder.build(makeCtx())).toBe("A");
  });
});

describe("identityPipe", () => {
  it("always returns content", () => {
    expect(identityPipe(makeCtx())).toContain("需求探索规划器");
  });
});

describe("coreRulesPipe", () => {
  it("always returns content", () => {
    expect(coreRulesPipe(makeCtx())).toContain("核心原则");
  });
});

describe("progressPipe", () => {
  it("includes dynamic values", () => {
    const result = progressPipe(makeCtx({ turnCount: 5, maxTurns: 20 }));
    expect(result).toContain("5/20");
    expect(result).toContain("src/main.ts");
  });
});

describe("convergenceRulesPipe", () => {
  it("returns null when turnCount <= maxTurns/2", () => {
    expect(convergenceRulesPipe(makeCtx({ turnCount: 3, maxTurns: 20 }))).toBeNull();
  });

  it("returns content when turnCount > maxTurns/2", () => {
    const result = convergenceRulesPipe(makeCtx({ turnCount: 12, maxTurns: 20 }));
    expect(result).toContain("收敛规则");
  });

  it("returns content at exactly half + 1", () => {
    const result = convergenceRulesPipe(makeCtx({ turnCount: 11, maxTurns: 20 }));
    expect(result).toContain("收敛规则");
  });
});

describe("antiConvergencePipe", () => {
  it("returns null when no conditions met", () => {
    expect(antiConvergencePipe(makeCtx())).toBeNull();
  });

  it("returns content when docProgress has quality warning", () => {
    const result = antiConvergencePipe(makeCtx({ docProgress: "3/7 filled ⚠ 质量问题" }));
    expect(result).toContain("反收敛条件");
  });

  it("returns content when summary has 待确认", () => {
    const result = antiConvergencePipe(makeCtx({ summary: "一些内容\n待确认：X" }));
    expect(result).toContain("反收敛条件");
  });

  it("returns content when hasRecentUserDecision is true", () => {
    const result = antiConvergencePipe(makeCtx({ hasRecentUserDecision: true }));
    expect(result).toContain("反收敛条件");
  });
});

describe("stagnationWarningPipe", () => {
  it("returns null when consecutiveReads <= 3", () => {
    expect(stagnationWarningPipe(makeCtx({ consecutiveReads: 2 }))).toBeNull();
  });

  it("returns null when findingsCount > 0", () => {
    expect(stagnationWarningPipe(makeCtx({ consecutiveReads: 5, findingsCount: 3 }))).toBeNull();
  });

  it("returns warning when stagnating", () => {
    const result = stagnationWarningPipe(makeCtx({ consecutiveReads: 4, findingsCount: 0 }));
    expect(result).toContain("停滞警告");
    expect(result).toContain("4");
  });
});

describe("actionSchemaPipe", () => {
  it("always returns content", () => {
    expect(actionSchemaPipe(makeCtx())).toContain("read_code");
  });
});

describe("prohibitionsPipe", () => {
  it("always returns content", () => {
    expect(prohibitionsPipe(makeCtx())).toContain("禁止事项");
  });
});

describe("buildExplorePlannerPrompt integration", () => {
  it("early turns exclude convergence rules", async () => {
    const { buildExplorePlannerPrompt } = await import("./prompts");
    const result = buildExplorePlannerPrompt({
      summary: "初始摘要",
      userInput: "实现登录功能",
      turnCount: 2,
      maxTurns: 20,
      findingsCount: 1,
      elapsedSec: 10,
      filesRead: [],
      docProgress: "0/5 filled",
    });
    expect(result).toContain("核心原则");
    expect(result).not.toContain("收敛规则");
  });

  it("late turns include convergence rules", async () => {
    const { buildExplorePlannerPrompt } = await import("./prompts");
    const result = buildExplorePlannerPrompt({
      summary: "已有大量发现",
      userInput: "",
      turnCount: 15,
      maxTurns: 20,
      findingsCount: 10,
      elapsedSec: 120,
      filesRead: ["a.ts", "b.ts"],
      docProgress: "5/7 filled",
    });
    expect(result).toContain("收敛规则");
  });
});
