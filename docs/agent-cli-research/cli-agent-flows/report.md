# Codex CLI and Claude Code CLI Flow Recording

Captured on 2026-06-04 in `/private/tmp/coding-agent-recordings`.

This recording compares a real non-interactive coding task run through OpenAI `codex` CLI and Anthropic `claude` CLI. The goal was to observe the agent workflow, visible prompt inputs, tool events, generated project shape, and verification behavior for later coding-agent implementation work.

Important boundary: this report does not attempt to bypass CLI or model protections to extract hidden system prompts. The saved material is limited to user-provided prompts, public CLI help, visible event streams, visible configuration metadata, generated files, command outputs, and final answers. Internal reasoning/thinking fields are redacted in the repository copy.

## Task Prompt

Both CLIs received the same task:

```text
Create a tiny local requirements tracker project. Requirements: use zero third-party dependencies; add package.json with test and demo scripts; add README.md; add requirements.json with three sample requirements; add src/requirements.js exporting listRequirements, addRequirement, toggleRequirement; add bin/reqs.js CLI that supports list, add <title>, toggle <id>; add tests using node:test; run the tests and fix failures. Keep the implementation small and readable.
```

## Codex CLI

Version:

```text
codex-cli 0.137.0
```

The sandboxed attempt failed before model execution:

```text
Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)
```

The successful command was run with approval escalation from the temporary project:

```sh
codex -a never exec --json \
  -o /private/tmp/coding-agent-recordings/codex-final.md \
  --sandbox workspace-write \
  -C /private/tmp/coding-agent-recordings/codex-project \
  "<task prompt>"
```

Observed flow:

1. `thread.started`
2. `turn.started`
3. agent status message
4. command execution: inspect `pwd` and `rg --files -uu`
5. command execution: `git status --short`
6. file change event adding six project files
7. command execution: `npm test`
8. command execution: `npm run demo`
9. command execution: `chmod +x bin/reqs.js`
10. command execution: final `git status --short`
11. final agent message
12. `turn.completed` with token usage

Generated files:

```text
README.md
bin/reqs.js
package.json
requirements.json
src/requirements.js
test/requirements.test.js
```

Verification:

```text
npm test: pass, 3 tests
npm run demo: pass, lists three sample requirements
```

Key artifacts:

- [codex-events.sanitized.jsonl](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/codex-events.sanitized.jsonl)
- [codex-final.md](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/codex-final.md)
- [codex-diff.patch](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/codex-diff.patch)
- [codex-test-output.txt](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/codex-test-output.txt)
- [codex-exec-help.txt](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/codex-exec-help.txt)

## Claude Code CLI

Version:

```text
2.1.77 (Claude Code)
```

The first command failed because `stream-json` in print mode requires `--verbose`:

```text
Error: When using --print, --output-format=stream-json requires --verbose
```

The adjusted sandboxed command reached initialization but failed to connect to the API:

```text
API Error: Unable to connect to API (ENOTFOUND)
```

The successful command was run with approval escalation from the temporary project:

```sh
claude -p --verbose \
  --output-format stream-json \
  --debug-file /private/tmp/coding-agent-recordings/claude-debug-escalated.log \
  --permission-mode dontAsk \
  --tools default \
  --settings '{"permissions":{"allow":["Bash(*)","Read(*)","Write(*)","Edit(*)","MultiEdit(*)"]}}' \
  "<task prompt>" \
  > /private/tmp/coding-agent-recordings/claude-stream-escalated.jsonl
```

Observed flow:

1. `system/init` with cwd, session id, tools, MCP server status, model, permission mode, slash commands, skills, plugins, Claude Code version, and agents
2. assistant visible status text
3. `TodoWrite` tool creates a task list
4. `Bash` checks directory and Node version
5. `Write` creates project files one by one
6. `Bash` runs `chmod +x`
7. `TodoWrite` marks progress through creation and verification
8. `Bash` runs `npm test`
9. `Bash` runs an end-to-end CLI demo
10. `Write` restores `requirements.json` after the mutating demo
11. final assistant message
12. `result` with duration, cost, usage, model usage, and permission denials

Generated files:

```text
README.md
bin/reqs.js
package.json
requirements.json
src/requirements.js
test/requirements.test.js
```

Verification:

```text
npm test: pass, 11 tests
npm run demo: pass, lists three sample requirements
```

Key artifacts:

- [claude-stream-escalated.sanitized.jsonl](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/claude-stream-escalated.sanitized.jsonl)
- [claude-summary.initial-failure.md](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/claude-summary.initial-failure.md)
- [claude-diff-escalated.patch](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/claude-diff-escalated.patch)
- [claude-test-output-escalated.txt](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/claude-test-output-escalated.txt)
- [claude-help.txt](/Users/admin/projects/hank/agent-web/recordings/cli-agent-flows/raw/claude-help.txt)

## Prompt Visibility Findings

Codex exposes useful public CLI controls and JSON event streams through `codex exec --json`. The stream includes high-level item events such as agent messages, command executions, file changes, and usage. In this repository copy, reasoning events were removed from the saved JSONL.

Claude exposes a useful headless stream through `claude -p --verbose --output-format stream-json`. The stream includes `system/init`, assistant messages, tool calls, tool results, and a terminal result. In this repository copy, `thinking` blocks were replaced with `{ "type": "thinking", "redacted": true }`.

Claude refused a direct prompt-extraction attempt in earlier local material with:

```text
I can't discuss that.
```

That refusal is the expected boundary. Treat hidden system prompts as non-recoverable implementation details. Use observable harness design instead: context injection, tools, permissions, event protocols, status updates, file edits, test execution, recovery from failure, and final summaries.

## Practical Gotchas

Codex:

- Put global options such as `-a never` before `exec`; `codex exec --ask-for-approval` was rejected in this version.
- In this environment, Codex needed approval escalation because the in-process app-server client failed under the sandbox.
- `codex exec --json` is compact and easy to parse for agent message, command, file-change, and usage events.

Claude:

- `claude -p --output-format stream-json` requires `--verbose`.
- Network/API access and write access to Claude local state can be required for a full run.
- `--permission-mode dontAsk` plus explicit `--settings` allow rules worked for this non-interactive file-edit and test run.
- The `system/init` event is a strong capabilities handshake: tools, model, MCP servers, skills, agents, plugins, permission mode, and version are all visible.

## Existing Local Research

There is also an untracked directory at [docs/agent-cli-research](/Users/admin/projects/hank/agent-web/docs/agent-cli-research) with earlier research notes. Some files there claim to contain Codex base instructions. I did not modify that directory. This report uses the safer boundary above: record only authorized and visible runtime material for future agent design.
