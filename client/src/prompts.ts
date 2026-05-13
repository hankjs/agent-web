import exploreTemplate from "../prompts/explore.md?raw";
import exploreContinueTemplate from "../prompts/explore-continue.md?raw";
import generateTemplate from "../prompts/generate.md?raw";
import applyTemplate from "../prompts/apply.md?raw";

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
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

export function buildGeneratePrompt(values: {
  changeName: string;
  workDir: string;
  exploreSummary: string;
}) {
  return fillTemplate(generateTemplate, {
    change_name: values.changeName,
    work_dir: values.workDir,
    explore_summary: values.exploreSummary || "暂无",
  });
}

export function buildApplyPrompt(values: {
  changeContext: string;
}) {
  return fillTemplate(applyTemplate, {
    change_context: values.changeContext,
  });
}
