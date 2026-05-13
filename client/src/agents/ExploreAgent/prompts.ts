import plannerTemplate from "./prompts/explore-planner.md?raw";
import readerTemplate from "./prompts/explore-reader.md?raw";
import summarizerTemplate from "./prompts/explore-summarizer.md?raw";
import exploreTemplate from "./prompts/explore.md?raw";
import exploreContinueTemplate from "./prompts/explore-continue.md?raw";

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

export function buildExplorePlannerPrompt(values: {
  summary: string;
  uncoveredAreas: string;
  userInput: string;
}) {
  return fillTemplate(plannerTemplate, {
    summary: values.summary,
    uncovered_areas: values.uncoveredAreas,
    user_input: values.userInput,
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
  focusAreas: string;
}) {
  return fillTemplate(exploreTemplate, {
    project_label: values.projectLabel,
    work_dir: values.workDir,
    depth: values.depth,
    question_style: values.questionStyle,
    focus_areas: values.focusAreas,
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
