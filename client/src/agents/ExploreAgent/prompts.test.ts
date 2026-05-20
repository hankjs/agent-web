import { describe, it, expect } from "vitest";
import {
  buildExploreReaderSystem,
  buildExploreSummarizerPrompt,
  buildExploreContinuePrompt,
  buildDocUpdaterPrompt,
  buildTaskGeneratorPrompt,
} from "./prompts";

describe("buildExploreReaderSystem", () => {
  it("includes workDir in output", () => {
    const result = buildExploreReaderSystem("/home/user/project");
    expect(result).toContain("/home/user/project");
  });

  it("includes reader instructions", () => {
    const result = buildExploreReaderSystem("/tmp");
    expect(result).toContain("代码阅读助手");
    expect(result).toContain("report_findings");
  });

  it("includes cost tier guidance", () => {
    const result = buildExploreReaderSystem("/tmp");
    expect(result).toContain("glob");
    expect(result).toContain("search");
    expect(result).toContain("read_file");
  });
});

describe("buildExploreSummarizerPrompt", () => {
  it("includes current summary and new findings", () => {
    const result = buildExploreSummarizerPrompt({
      currentSummary: "已有摘要内容",
      newFindings: "新发现内容",
    });
    expect(result).toContain("已有摘要内容");
    expect(result).toContain("新发现内容");
  });

  it("includes compression instructions", () => {
    const result = buildExploreSummarizerPrompt({
      currentSummary: "test",
      newFindings: "test",
    });
    expect(result).toContain("压缩");
    expect(result).toContain("500");
  });

  it("includes structural categories", () => {
    const result = buildExploreSummarizerPrompt({
      currentSummary: "",
      newFindings: "",
    });
    expect(result).toContain("已确认决策");
    expect(result).toContain("技术事实");
    expect(result).toContain("已排除路径");
    expect(result).toContain("待确认");
  });
});

describe("buildExploreContinuePrompt", () => {
  it("includes change name and work dir", () => {
    const result = buildExploreContinuePrompt({
      changeName: "添加登录功能",
      workDir: "/home/user/project",
      exploreSummary: "已有发现",
    });
    expect(result).toContain("添加登录功能");
    expect(result).toContain("/home/user/project");
    expect(result).toContain("已有发现");
  });

  it("uses fallback for empty explore summary", () => {
    const result = buildExploreContinuePrompt({
      changeName: "test",
      workDir: "/tmp",
      exploreSummary: "",
    });
    expect(result).toContain("暂无");
  });
});

describe("buildDocUpdaterPrompt", () => {
  it("includes all three context sections", () => {
    const result = buildDocUpdaterPrompt({
      documentSections: '[{"id":"sec1","title":"概览","content":"","status":"empty"}]',
      newFindings: "用户选择方案A",
      runningSummary: "技术摘要内容",
    });
    expect(result).toContain("sec1");
    expect(result).toContain("用户选择方案A");
    expect(result).toContain("技术摘要内容");
  });

  it("includes updater rules and JSON format", () => {
    const result = buildDocUpdaterPrompt({
      documentSections: "[]",
      newFindings: "",
      runningSummary: "",
    });
    expect(result).toContain("updates");
    expect(result).toContain("section_id");
    expect(result).toContain("filled");
    expect(result).toContain("partial");
  });
});

describe("buildTaskGeneratorPrompt", () => {
  it("includes requirement content and work dir", () => {
    const result = buildTaskGeneratorPrompt({
      requirementContent: "# 需求文档\n## 功能描述\n实现登录",
      workDir: "/home/user/project",
    });
    expect(result).toContain("需求文档");
    expect(result).toContain("实现登录");
    expect(result).toContain("/home/user/project");
  });

  it("includes task structure guidance", () => {
    const result = buildTaskGeneratorPrompt({
      requirementContent: "test",
      workDir: "/tmp",
    });
    expect(result).toContain("Phase");
    expect(result).toContain("Task");
    expect(result).toContain("验收");
  });
});
