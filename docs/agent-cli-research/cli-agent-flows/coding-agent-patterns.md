# Coding Agent Patterns From CLI Recordings

This is the reusable implementation guidance distilled from the Codex and Claude Code recordings. It intentionally avoids hidden prompt extraction and focuses on observable agent architecture.

## Minimal Agent Loop

Use a turn loop with these phases:

1. Accept task, environment, permissions, and tool inventory.
2. Inspect the workspace before editing.
3. State short progress updates while working.
4. Make scoped file changes through structured edit tools.
5. Run project-appropriate verification.
6. If verification fails, inspect the failure and retry with a narrower fix.
7. Summarize changed files, tests, and residual risks.

The visible event shape can be either Codex-like or Claude-like.

Codex-like:

```text
thread.started
turn.started
agent_message
command_execution.started
command_execution.completed
file_change.started
file_change.completed
command_execution.started
command_execution.completed
agent_message
turn.completed
```

Claude-like:

```text
system/init
assistant text
assistant tool_use
user tool_result
assistant tool_use
user tool_result
result
```

Both are sufficient. The key contract is stable correlation between tool calls and tool results, plus terminal usage/status metadata.

## Context Layers

Keep context explicit and layered:

- Base behavior: coding-agent role, collaboration style, editing constraints, verification expectations.
- Developer/runtime constraints: sandbox, network policy, approval policy, writable roots, command escalation rules.
- Workspace context: cwd, shell, date, timezone, repository roots.
- Tool inventory: shell, file read/write/edit, search, test runners, web or MCP tools if available.
- User task: the actual request, kept separate from runtime context.

Do not mix hidden implementation instructions with user-visible task content. Make it possible to log and replay the user task and runtime context without exposing private model prompts.

## Tooling Lessons

Shell tools should capture:

- command string
- working directory
- exit code
- stdout and stderr
- elapsed time
- whether escalation was used

File tools should capture:

- add/update/delete
- path
- patch or structured diff
- success or failure

Agent state tools should capture:

- task list or plan updates
- progress status
- final result
- usage/cost if available

## Permission Model

A coding agent needs a first-class permission model, not a boolean "can run shell" switch.

Useful modes:

- read-only: inspect only
- workspace-write: edit within approved roots
- unrestricted or escalated: only after explicit approval or trusted automation

When a command fails due to sandbox, DNS, registry, or writable-path restrictions, record the failure and retry with a scoped approval request if policy allows. This was required for both CLI recordings in this environment.

## Verification Behavior

Good behavior observed in both runs:

- Inspect before writing.
- Create a minimal project structure.
- Run tests after file creation.
- Exercise the CLI demo.
- Restore data after a mutating demo when the deliverable expects clean sample data.
- Report verification results in the final answer.

For implementation, make verification an explicit phase and store test output as an artifact.

## Prompt Strategy For A Custom Agent

Use this visible prompt skeleton rather than copying hidden prompts:

```text
You are a coding agent working in the user's repository.

Operate pragmatically:
- inspect before editing
- prefer existing project patterns
- keep changes scoped
- use structured file edits
- run relevant tests
- recover from failures by reading errors and making targeted fixes
- never revert user changes unless explicitly asked
- summarize changed files and verification

Runtime:
- cwd: <cwd>
- shell: <shell>
- date/timezone: <date/timezone>
- writable roots: <roots>
- sandbox mode: <mode>
- approval policy: <policy>
- available tools: <tools>

Task:
<user request>
```

Then build a controller around this prompt that provides tool results back to the model and records every step as JSONL.

## Event Schema Recommendation

For a future agent, a compact JSONL event schema is enough:

```json
{"type":"run.started","run_id":"...","cwd":"...","model":"...","tools":["shell","edit"]}
{"type":"message","role":"assistant","channel":"progress","text":"..."}
{"type":"tool.started","tool":"shell","call_id":"...","input":{"cmd":"npm test","cwd":"..."}}
{"type":"tool.completed","call_id":"...","output":{"exit_code":0,"stdout":"...","stderr":"..."}}
{"type":"file.changed","changes":[{"path":"src/app.js","kind":"update"}]}
{"type":"run.completed","status":"success","usage":{},"summary":"..."}
```

Keep internal reasoning out of durable logs. Store user-visible summaries and concrete tool observations instead.
