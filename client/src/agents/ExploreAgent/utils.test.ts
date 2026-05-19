import { describe, it, expect } from "vitest";
import { safeInput, parseFindings, trimMessages } from "./utils";
import type { LlmMessage } from "./types";

describe("safeInput", () => {
  it("returns empty object for null/undefined", () => {
    expect(safeInput(null)).toEqual({});
    expect(safeInput(undefined)).toEqual({});
    expect(safeInput("")).toEqual({});
    expect(safeInput(0)).toEqual({});
  });

  it("parses valid JSON string", () => {
    expect(safeInput('{"path":"/foo.ts"}')).toEqual({ path: "/foo.ts" });
  });

  it("returns empty object for invalid JSON string", () => {
    expect(safeInput("not json")).toEqual({});
    expect(safeInput("{broken")).toEqual({});
  });

  it("passes through objects directly", () => {
    const obj = { pattern: "*.ts", path: "/src" };
    expect(safeInput(obj)).toBe(obj);
  });
});

describe("parseFindings", () => {
  it("extracts findings from valid json:findings block", () => {
    const text = `Some text before
\`\`\`json:findings
{"findings":[{"topic":"Router","content":"Uses vue-router 4","source":"src/router/index.ts:1"}]}
\`\`\`
Some text after`;

    const result = parseFindings(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      topic: "Router",
      content: "Uses vue-router 4",
      source: "src/router/index.ts:1",
      confirmed: false,
    });
  });

  it("returns empty array when no json:findings block", () => {
    expect(parseFindings("just plain text")).toEqual([]);
    expect(parseFindings("```json\n{}\n```")).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    const text = "```json:findings\n{not valid json}\n```";
    expect(parseFindings(text)).toEqual([]);
  });

  it("handles missing fields gracefully", () => {
    const text = '```json:findings\n{"findings":[{"topic":"X"}]}\n```';
    const result = parseFindings(text);
    expect(result[0]).toEqual({ topic: "X", content: "", source: "", confirmed: false });
  });

  it("handles empty findings array", () => {
    const text = '```json:findings\n{"findings":[]}\n```';
    expect(parseFindings(text)).toEqual([]);
  });
});

describe("trimMessages", () => {
  function makeRound(toolName: string, result: string): [LlmMessage, LlmMessage] {
    const assistant: LlmMessage = {
      role: "assistant",
      content: [{ type: "tool_use", id: `id_${toolName}`, name: toolName, input: {} }],
    };
    const user: LlmMessage = {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: `id_${toolName}`, content: result }],
    };
    return [assistant, user];
  }

  it("returns messages unchanged when rounds <= maxFullRounds", () => {
    const initial: LlmMessage = { role: "user", content: [{ type: "text", text: "start" }] };
    const [a1, u1] = makeRound("read_file", "file content");
    const msgs = [initial, a1, u1];

    const result = trimMessages(msgs, 3);
    expect(result).toEqual(msgs);
  });

  it("trims old rounds and keeps last N full rounds", () => {
    const initial: LlmMessage = { role: "user", content: [{ type: "text", text: "start" }] };
    const [a1, u1] = makeRound("glob", "src/\nlib/");
    const [a2, u2] = makeRound("read_file", "export function foo() {}");
    const [a3, u3] = makeRound("search", "match at line 42");
    const [a4, u4] = makeRound("read_file", "final content");

    const msgs = [initial, a1, u1, a2, u2, a3, u3, a4, u4]; // 4 rounds

    const result = trimMessages(msgs, 3); // keep last 3, trim 1
    // Should have: summary + last 3 rounds = 1 + 6 = 7 messages
    expect(result).toHaveLength(8); // initial + summary_user + 3 rounds (6 msgs)

    // First message is original initial
    expect(result[0]).toBe(initial);
    // Second is the summary
    const summaryText = (result[1].content[0] as any).text;
    expect(summaryText).toContain("前几轮工具调用摘要");
    expect(summaryText).toContain("glob");
    // Summary should include result hints
    expect(summaryText).toContain("src/");
  });

  it("handles single round (no trimming needed)", () => {
    const initial: LlmMessage = { role: "user", content: [{ type: "text", text: "go" }] };
    const [a1, u1] = makeRound("glob", "result");
    const msgs = [initial, a1, u1];

    expect(trimMessages(msgs, 3)).toEqual(msgs);
  });

  it("preserves result hints in summary", () => {
    const initial: LlmMessage = { role: "user", content: [{ type: "text", text: "start" }] };
    const rounds: LlmMessage[] = [];
    for (let i = 0; i < 5; i++) {
      const [a, u] = makeRound(`tool_${i}`, `result line 1 of tool ${i}\nresult line 2\nresult line 3`);
      rounds.push(a, u);
    }
    const msgs: LlmMessage[] = [initial, ...rounds];

    const result = trimMessages(msgs, 3); // trim 2 rounds
    const summaryText = (result[1].content[0] as any).text;
    expect(summaryText).toContain("tool_0");
    expect(summaryText).toContain("tool_1");
    expect(summaryText).toContain("result line 1 of tool 0");
    // Should NOT contain tool_2 in summary (it's in the kept rounds)
    expect(summaryText).not.toContain("tool_2");
  });

  it("handles error results (excluded from hints)", () => {
    const initial: LlmMessage = { role: "user", content: [{ type: "text", text: "start" }] };
    const assistant: LlmMessage = {
      role: "assistant",
      content: [{ type: "tool_use", id: "err1", name: "read_file", input: {} }],
    };
    const user: LlmMessage = {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "err1", content: "File not found", is_error: true }],
    };
    // Add 3 more normal rounds to trigger trimming
    const extra: LlmMessage[] = [];
    for (let i = 0; i < 3; i++) {
      const [a, u] = makeRound(`t${i}`, `ok ${i}`);
      extra.push(a, u);
    }
    const msgs: LlmMessage[] = [initial, assistant, user, ...extra];

    const result = trimMessages(msgs, 3);
    const summaryText = (result[1].content[0] as any).text;
    // Error result should not appear in hints
    expect(summaryText).toContain("read_file");
    expect(summaryText).not.toContain("File not found");
  });
});
