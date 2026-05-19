import plannerTemplate from "./prompts/explore-planner.md?raw";
import readerTemplate from "./prompts/explore-reader.md?raw";
import summarizerTemplate from "./prompts/explore-summarizer.md?raw";
import exploreTemplate from "./prompts/explore.md?raw";
import exploreContinueTemplate from "./prompts/explore-continue.md?raw";
import docUpdaterTemplate from "./prompts/doc-updater.md?raw";
import taskGeneratorTemplate from "./prompts/task-generator.md?raw";

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
}) {
  const filesReadStr = values.filesRead?.length
    ? values.filesRead.join(", ")
    : "（暂无）";
  return fillTemplate(plannerTemplate, {
    summary: values.summary,
    user_input: values.userInput,
    turn_count: String(values.turnCount),
    max_turns: String(values.maxTurns),
    findings_count: String(values.findingsCount),
    elapsed_sec: String(values.elapsedSec),
    files_read: filesReadStr,
    doc_progress: values.docProgress || "无文档模式",
  });
}

export function buildExploreReaderPrompt(values: {
  objective: string;
  workDir: string;
}) {
  return fillTemplate(readerTemplate, {
    objective: values.objective,
    work_dir: values.workDir,
  });
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

export function buildExplorePrompt(values: {
  projectLabel: string;
  workDir: string;
  depth: string;
  questionStyle: string;
}) {
  return fillTemplate(exploreTemplate, {
    project_label: values.projectLabel,
    work_dir: values.workDir,
    depth: values.depth,
    question_style: values.questionStyle,
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
