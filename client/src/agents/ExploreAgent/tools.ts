// Tool definitions that client sends to LLM for the reader step
export const READER_TOOLS = [
  {
    name: "read_file",
    description: "Read the contents of a file. Returns the file content as text.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path (absolute or relative to work_dir)" },
        offset: { type: "integer", description: "Start line number (1-based, optional)" },
        limit: { type: "integer", description: "Max lines to read (optional)" },
      },
      required: ["path"],
    },
  },
  {
    name: "search",
    description: "Search for text patterns in files using ripgrep. Returns matching lines with file paths and line numbers.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory or file to search in (default: work_dir)" },
        glob: { type: "string", description: "File glob filter (e.g. '*.ts')" },
        ignore_case: { type: "boolean", description: "Case insensitive search (default: false)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern. Respects .gitignore. Returns matching file paths sorted by modification time.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts', 'src/**/*.vue')" },
        path: { type: "string", description: "Base directory to search in (default: work_dir)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "AskUserQuestion",
    description: "Ask the user a question when you need clarification or a decision before continuing.",
    input_schema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              header: { type: "string", description: "Short label for the question" },
              question: { type: "string", description: "The question to ask" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["label"],
                },
              },
            },
            required: ["header", "question", "options"],
          },
        },
      },
      required: ["questions"],
    },
  },
];

// Writer tools — available when agent needs to make changes
export const WRITER_TOOLS = [
  {
    name: "edit",
    description: "Perform exact string replacement in a file. The old_string must match exactly once in the file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to edit" },
        old_string: { type: "string", description: "Exact text to find and replace" },
        new_string: { type: "string", description: "Replacement text" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "bash",
    description: "Execute a shell command. Use for build, test, or other system operations.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout_ms: { type: "integer", description: "Timeout in milliseconds (default: 30000)" },
      },
      required: ["command"],
    },
  },
];
