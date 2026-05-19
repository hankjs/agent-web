import readerTemplate from "./prompts/explore-reader.md?raw";
import summarizerTemplate from "./prompts/explore-summarizer.md?raw";
import exploreContinueTemplate from "./prompts/explore-continue.md?raw";
import docUpdaterTemplate from "./prompts/doc-updater.md?raw";
import taskGeneratorTemplate from "./prompts/task-generator.md?raw";
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

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

export function buildExplorePlannerPrompt(values: {
  summary: string;
  userInput: string;
  turnCount: number;
  maxTurns: number;
  findingsCount: number;
  elapsedSec: number;
  filesRead?: string[];
  docProgress?: string;
  isFirstTurn?: boolean;
  consecutiveReads?: number;
}) {
  const ctx: PlannerContext = {
    summary: values.summary,
    userInput: values.userInput,
    turnCount: values.turnCount,
    maxTurns: values.maxTurns,
    findingsCount: values.findingsCount,
    elapsedSec: values.elapsedSec,
    filesRead: values.filesRead || [],
    docProgress: values.docProgress || "无文档模式",
    isFirstTurn: values.isFirstTurn ?? values.turnCount === 0,
    consecutiveReads: values.consecutiveReads ?? 0,
    hasRecentUserDecision: values.summary.includes("[回答]") &&
      values.summary.lastIndexOf("[回答]") > values.summary.length - 200,
  };

  return new PromptBuilder()
    .pipe(identityPipe)
    .pipe(coreRulesPipe)
    .pipe(progressPipe)
    .pipe(convergenceRulesPipe)
    .pipe(antiConvergencePipe)
    .pipe(stagnationWarningPipe)
    .pipe(actionSchemaPipe)
    .pipe(prohibitionsPipe)
    .build(ctx);
}

/**
 * Prompt Cache 友好版本：
 * - system prompt 只含 workDir（整个会话不变），确保 API prefix cache 命中
 * - objective 由调用方放入第一条 user message
 */
export function buildExploreReaderSystem(workDir: string): string {
  return fillTemplate(readerTemplate, {
    work_dir: workDir,
  });
}

export function buildExploreSummarizerPrompt(values: {
  currentSummary: string;
  newFindings: string;
}) {
  return fillTemplate(summarizerTemplate, {
    current_summary: values.currentSummary,
    new_findings: values.newFindings,
  });
}

export function buildExploreContinuePrompt(values: {
  changeName: string;
  workDir: string;
  exploreSummary: string;
}) {
  return fillTemplate(exploreContinueTemplate, {
    change_name: values.changeName,
    work_dir: values.workDir,
    explore_summary: values.exploreSummary || "暂无",
  });
}

export function buildDocUpdaterPrompt(values: {
  documentSections: string;
  newFindings: string;
  runningSummary: string;
}) {
  return fillTemplate(docUpdaterTemplate, {
    document_sections: values.documentSections,
    new_findings: values.newFindings,
    running_summary: values.runningSummary,
  });
}

export function buildTaskGeneratorPrompt(values: {
  requirementContent: string;
  workDir: string;
}) {
  return fillTemplate(taskGeneratorTemplate, {
    requirement_content: values.requirementContent,
    work_dir: values.workDir,
  });
}
