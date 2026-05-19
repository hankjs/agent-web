/**
 * 纯函数工具集 — 从 useExploreAgent 中提取，便于单元测试
 */
import type { LlmMessage, Finding } from "./types";

const MAX_FULL_ROUNDS = 3;

/** Safely parse tc.input which may be string, null, or object */
export function safeInput(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  return raw;
}

/** Extract findings from LLM text response containing ```json:findings block */
export function parseFindings(text: string): Finding[] {
  const match = text.match(/```json:findings\s*\n([\s\S]*?)\n```/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return (parsed.findings || []).map((f: any) => ({
      topic: f.topic || "", content: f.content || "", source: f.source || "", confirmed: false,
    }));
  } catch { return []; }
}

/** Sliding window: trim old tool rounds to keep context manageable.
 *  两层压缩策略（Compaction before Summarization）：
 *  1. Compaction: 保留的旧轮中，大 tool_result 就地截断（保留前 200 字符）
 *  2. Summarization: 超出窗口的轮次压缩为工具名 + 结果要点摘要
 *
 *  轮次按 assistant message 计数（不受额外 user message 插入影响）。
 */
export function trimMessages(msgs: LlmMessage[], maxFullRounds = MAX_FULL_ROUNDS): LlmMessage[] {
  // 按 assistant message 索引划分轮次（每个 assistant msg = 一轮）
  const assistantIndices: number[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === "assistant") assistantIndices.push(i);
  }
  const rounds = assistantIndices.length;
  if (rounds <= maxFullRounds) return msgs;

  const trimCount = rounds - maxFullRounds;
  // 保留第一条 user message（初始目标）
  const trimmed: LlmMessage[] = [msgs[0]];

  // Layer 1: 被裁剪轮次 → 摘要（Summarization）
  let summary = "（前几轮工具调用摘要）\n";
  for (let i = 0; i < trimCount; i++) {
    const aIdx = assistantIndices[i];
    // 找该 assistant 之后、下一个 assistant 之前的 user message（tool results）
    const nextAIdx = i + 1 < assistantIndices.length ? assistantIndices[i + 1] : msgs.length;
    const toolNames = msgs[aIdx].content
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => b.name);
    // 从后续 user messages 中提取 tool_result 要点
    const resultHints: string[] = [];
    for (let j = aIdx + 1; j < nextAIdx; j++) {
      if (msgs[j].role === "user" && Array.isArray(msgs[j].content)) {
        for (const b of msgs[j].content as any[]) {
          if (b.type === "tool_result" && !b.is_error && typeof b.content === "string") {
            const hint = b.content.split("\n").slice(0, 2).join(" ").slice(0, 100);
            if (hint) resultHints.push(hint);
          }
        }
      }
    }
    summary += `- ${toolNames.join(", ")}`;
    if (resultHints.length > 0) summary += ` → ${resultHints.slice(0, 2).join("; ")}`;
    summary += "\n";
  }
  trimmed.push({ role: "user", content: [{ type: "text", text: summary }] });

  // Layer 2: 保留的轮次 → Compaction（就地截断大 tool_result，保护 prefix 不变）
  const COMPACT_THRESHOLD = 500; // 超过此字符数的 tool_result 做截断
  const firstRetainedIdx = assistantIndices[trimCount];
  // 包含 firstRetainedIdx 之前的 user messages（如 roundDirective 注入的）
  // 找到被裁剪最后一轮的结束位置
  const retainStart = firstRetainedIdx;
  const retained = msgs.slice(retainStart);
  for (const msg of retained) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const compacted = msg.content.map((block: any) => {
        if (block.type === "tool_result" && typeof block.content === "string" && block.content.length > COMPACT_THRESHOLD) {
          // 保留前 200 字符 + 截断标记，保留结构完整性
          return { ...block, content: block.content.slice(0, 200) + "\n[...truncated, " + block.content.length + " chars total]" };
        }
        return block;
      });
      trimmed.push({ ...msg, content: compacted });
    } else {
      trimmed.push(msg);
    }
  }
  return trimmed;
}
