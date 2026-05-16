import { buildDocUpdaterPrompt, buildTaskGeneratorPrompt } from "./prompts";
import { callLLM } from "./llm";
import type { DocumentSection } from "./types";

export interface DocUpdateResult {
  updates: Array<{
    section_id: string;
    content: string;
    status: "partial" | "filled";
  }>;
}

/**
 * 调用 LLM 更新需求文档章节
 */
export async function runDocUpdater(
  sections: DocumentSection[],
  newFindings: string,
  runningSummary: string,
  signal: AbortSignal,
): Promise<DocUpdateResult> {
  const prompt = buildDocUpdaterPrompt({
    documentSections: JSON.stringify(sections, null, 2),
    newFindings,
    runningSummary,
  });

  const { text } = await callLLM(
    "你是一个 JSON 输出机器，只返回合法 JSON。",
    prompt,
    undefined,
    signal,
  );

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { updates: [] };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { updates: parsed.updates || [] };
  } catch {
    return { updates: [] };
  }
}

/**
 * 将 DocUpdateResult 应用到 sections 数组
 */
export function applySectionUpdates(
  sections: DocumentSection[],
  result: DocUpdateResult,
): DocumentSection[] {
  const updated = [...sections];
  for (const u of result.updates) {
    const idx = updated.findIndex(s => s.id === u.section_id);
    if (idx >= 0) {
      updated[idx] = { ...updated[idx], content: u.content, status: u.status };
    }
  }
  return updated;
}

/**
 * 从 sections 组装完整 Markdown 文档
 */
export function assembleMarkdown(sections: DocumentSection[], title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(`# ${title}`, "");
  for (const s of sections) {
    lines.push(`## ${s.title}`, "");
    if (s.content) {
      lines.push(s.content, "");
    } else {
      lines.push("*待填充*", "");
    }
  }
  return lines.join("\n");
}

/**
 * 计算文档进度字符串，如 "3/7 filled"
 */
export function getDocProgress(sections: DocumentSection[]): string {
  if (sections.length === 0) return "无文档模式";
  const filled = sections.filter(s => s.status === "filled").length;
  const partial = sections.filter(s => s.status === "partial").length;
  const pending = sections.filter(s => s.status === "empty").map(s => s.title);

  let result = `${filled}/${sections.length} filled, ${partial} partial`;

  // 已填章节摘要（每个截取前 80 字）
  const filledSections = sections.filter(s => s.status === "filled" || s.status === "partial");
  if (filledSections.length > 0) {
    result += "\n已填内容摘要:";
    for (const sec of filledSections) {
      const preview = sec.content.length > 80 ? sec.content.slice(0, 80) + "..." : sec.content;
      result += `\n- ${sec.title}: ${preview}`;
    }
  }

  if (pending.length > 0) {
    result += `\n待填: ${pending.join(", ")}`;
  }

  return result;
}

/**
 * 从模板内容解析出 DocumentSection 数组
 * 模板格式：以 ## 开头的章节，每个章节有 id 标记
 * 支持格式：## 章节标题 {#section-id}
 */
export function parseTemplateToSections(templateContent: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const lines = templateContent.split("\n");
  let currentSection: DocumentSection | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+?)(?:\s*\{#([\w-]+)\})?\s*$/);
    if (headerMatch) {
      if (currentSection) sections.push(currentSection);
      const title = headerMatch[1].trim();
      const id = headerMatch[2] || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      currentSection = { id, title, content: "", status: "empty" };
    } else if (currentSection) {
      // 跳过模板中的占位说明（以 > 或 *待填充* 开头的行）
      if (line.startsWith("> ") || line.trim() === "*待填充*") continue;
      if (currentSection.content || line.trim()) {
        currentSection.content += (currentSection.content ? "\n" : "") + line;
      }
    }
  }
  if (currentSection) sections.push(currentSection);

  // 清空模板中的示例内容，只保留结构
  return sections.map(s => ({ ...s, content: "", status: "empty" as const }));
}

/**
 * 从已保存的 markdown 文件解析出带内容的 DocumentSection 数组
 * 与 parseTemplateToSections 不同，此函数保留内容并推断 status
 */
export function parseMarkdownToSections(markdown: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const lines = markdown.split("\n");
  let currentSection: DocumentSection | null = null;
  const contentLines: string[] = [];

  function flushSection() {
    if (!currentSection) return;
    const content = contentLines.join("\n").trim();
    const isEmpty = !content || content === "*待填充*";
    currentSection.content = isEmpty ? "" : content;
    currentSection.status = isEmpty ? "empty" : "filled";
    sections.push(currentSection);
    contentLines.length = 0;
  }

  for (const line of lines) {
    // 跳过一级标题（文档标题）
    if (line.match(/^#\s+/) && !line.match(/^##/)) continue;
    const headerMatch = line.match(/^##\s+(.+?)(?:\s*\{#([\w-]+)\})?\s*$/);
    if (headerMatch) {
      flushSection();
      const title = headerMatch[1].trim();
      const id = headerMatch[2] || title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-");
      currentSection = { id, title, content: "", status: "empty" };
    } else if (currentSection) {
      contentLines.push(line);
    }
  }
  flushSection();
  return sections;
}

/**
 * 调用 LLM 生成任务文档
 */
export async function runTaskGenerator(
  requirementContent: string,
  workDir: string,
  signal: AbortSignal,
): Promise<string> {
  const prompt = buildTaskGeneratorPrompt({ requirementContent, workDir });
  const { text } = await callLLM(
    "你是一个任务分解专家，输出 Markdown 格式的任务文档。",
    prompt,
    undefined,
    signal,
  );
  return text.trim();
}
