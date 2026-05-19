/**
 * ContextCache — Offload 层
 *
 * 大工具结果不留在 LLM messages 里，存到这个 Map 中。
 * messages 里只保留一个短引用，reader 需要时可以 retrieve 回来。
 *
 * 设计原则：
 * - 上下文留给推理，数据存储交给缓存
 * - 可逆：原始内容随时可取回（区别于 Summarization 的不可逆压缩）
 * - 按 tool_use_id 索引，天然去重
 */

import { encodingForModel } from "js-tiktoken";

const enc = encodingForModel("gpt-4o");

/** 超过此 token 数的工具结果会被 offload */
const OFFLOAD_THRESHOLD = 1500;

/** offload 后留在 messages 里的引用最大行数（给模型一个预览） */
const PREVIEW_LINES = 8;

export interface CachedResult {
  toolName: string;
  input: any;
  content: string;
  tokens: number;
  timestamp: number;
}

/**
 * 工具结果缓存。生命周期跟随单次 executeReadCode 调用。
 * 每次新的 read_code 轮次可以选择清空或保留（当前设计：保留，因为同一探索会话内可能回溯）。
 */
export class ContextCache {
  private cache = new Map<string, CachedResult>();
  private _totalOffloaded = 0;

  /** 判断内容是否应该 offload */
  shouldOffload(content: string): boolean {
    return enc.encode(content).length > OFFLOAD_THRESHOLD;
  }

  /** 存储工具结果，返回用于替换 messages 中内容的短引用 */
  offload(toolUseId: string, toolName: string, input: any, content: string): string {
    const tokens = enc.encode(content).length;
    this.cache.set(toolUseId, { toolName, input, content, tokens, timestamp: Date.now() });
    this._totalOffloaded += tokens;

    // 生成预览：前几行 + 统计信息
    const lines = content.split("\n");
    const preview = lines.slice(0, PREVIEW_LINES).join("\n");
    const suffix = lines.length > PREVIEW_LINES
      ? `\n... (共 ${lines.length} 行, ${tokens} tokens, 已缓存 id=${toolUseId})`
      : "";
    return preview + suffix;
  }

  /** 取回完整内容 */
  retrieve(toolUseId: string): string | null {
    return this.cache.get(toolUseId)?.content ?? null;
  }

  /** 获取缓存统计 */
  get stats() {
    return {
      entries: this.cache.size,
      totalOffloadedTokens: this._totalOffloaded,
    };
  }

  /** 清空缓存（新探索会话时调用） */
  clear() {
    this.cache.clear();
    this._totalOffloaded = 0;
  }
}
