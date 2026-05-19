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
 *  2. Summarization: 超出窗口的轮次压缩为工具名 + 结果要点摘要 */
export function trimMessages(msgs: LlmMessage[], maxFullRounds = MAX_FULL_ROUNDS): LlmMessage[] {
  const rounds = (msgs.length - 1) / 2;
  if (rounds <= maxFullRounds) return msgs;
  const trimCount = Math.floor(rounds - maxFullRounds);
  const trimmed: LlmMessage[] = [msgs[0]];

  // Layer 1: 被裁剪轮次 → 摘要（Summarization）
  let summary = "（前几轮工具调用摘要）\n";
  for (let i = 0; i < trimCount; i++) {
    const aIdx = 1 + i * 2; // assistant message
    const uIdx = aIdx + 1;  // user message (tool results)
    const toolNames = msgs[aIdx].content
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => b.name);
    // 从 tool_result 中提取前 2 行作为要点
    const resultHints = msgs[uIdx]?.content
      ?.filter((b: any) => b.type === "tool_result" && !b.is_error)
      .map((b: any) => {
        const text = typeof b.content === "string" ? b.content : "";
        return text.split("\n").slice(0, 2).join(" ").slice(0, 100);
      })
      .filter(Boolean)
      .slice(0, 2) || [];
    summary += `- ${toolNames.join(", ")}`;
    if (resultHints.length > 0) summary += ` → ${resultHints.join("; ")}`;
    summary += "\n";
  }
  trimmed.push({ role: "user", content: [{ type: "text", text: summary }] });

  // Layer 2: 保留的轮次 → Compaction（就地截断大 tool_result，保护 prefix 不变）
  const COMPACT_THRESHOLD = 500; // 超过此字符数的 tool_result 做截断
  const retained = msgs.slice(1 + trimCount * 2);
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
