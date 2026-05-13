import generateTemplate from "./prompts/generate.md?raw";
import applyTemplate from "./prompts/apply.md?raw";

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
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
