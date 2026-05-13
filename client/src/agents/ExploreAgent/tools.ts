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
      },
      required: ["pattern"],
    },
  },
];
