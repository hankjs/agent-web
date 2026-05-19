/**
 * PromptPipe — 模块化 prompt 组装基础设施
 *
 * 每个 Pipe 是一个纯函数，接收 PlannerContext 返回一段 prompt 文本或 null（跳过）。
 * PromptBuilder 将多个 Pipe 串联，过滤 null 后用双换行拼接。
 */

export interface PlannerContext {
  summary: string;
  userInput: string;
  turnCount: number;
  maxTurns: number;
  findingsCount: number;
  elapsedSec: number;
  filesRead: string[];
  docProgress: string;
  isFirstTurn: boolean;
  consecutiveReads: number;
  hasRecentUserDecision: boolean; // 摘要中最近有 [回答] 标记
}

export type PromptPipe = (ctx: PlannerContext) => string | null;

export class PromptBuilder {
  private pipes: PromptPipe[] = [];

  pipe(fn: PromptPipe): this {
    this.pipes.push(fn);
    return this;
  }

  build(ctx: PlannerContext): string {
    return this.pipes
      .map((fn) => fn(ctx))
      .filter((s): s is string => s !== null && s.length > 0)
      .join("\n\n");
  }
}
