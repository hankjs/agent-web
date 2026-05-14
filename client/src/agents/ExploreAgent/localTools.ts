import { invoke } from "@tauri-apps/api/core";

export interface LocalToolResult {
  content: string;
  is_error: boolean;
  duration_ms: number;
}

/**
 * Execute a tool locally via Tauri commands.
 * Routes tool name to the corresponding Tauri command.
 */
export async function execToolLocal(toolName: string, input: any, workDir: string): Promise<LocalToolResult> {
  try {
    switch (toolName) {
      case "read_file":
        return await invoke<LocalToolResult>("tool_read_file", {
          path: input.path,
          workDir,
          offset: input.offset,
          limit: input.limit,
        });
      case "search":
        return await invoke<LocalToolResult>("tool_grep", {
          pattern: input.pattern,
          path: input.path,
          workDir,
          glob: input.glob,
          ignoreCase: input.ignore_case ?? false,
        });
      case "glob":
        return await invoke<LocalToolResult>("tool_glob", {
          pattern: input.pattern,
          path: input.path,
          workDir,
        });
      case "write_file":
        return await invoke<LocalToolResult>("tool_write_file", {
          path: input.path,
          content: input.content,
          workDir,
        });
      case "edit":
        return await invoke<LocalToolResult>("tool_edit", {
          path: input.path,
          oldString: input.old_string,
          newString: input.new_string,
          workDir,
        });
      case "bash":
        return await invoke<LocalToolResult>("tool_bash", {
          command: input.command,
          workDir,
          timeoutMs: input.timeout_ms ?? 30000,
        });
      default:
        return { content: `Unknown tool: ${toolName}`, is_error: true, duration_ms: 0 };
    }
  } catch (e: any) {
    return { content: `Tauri invoke error: ${e.toString()}`, is_error: true, duration_ms: 0 };
  }
}
