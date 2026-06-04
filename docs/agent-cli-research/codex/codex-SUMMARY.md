# Codex CLI (OpenAI `codex`) — Prompt & Agent Flow Capture

Captured from a real non-interactive run. Version: `codex-cli 0.137.0`.
Model reported in session: `gpt-5.5` (personality `pragmatic`, reasoning effort `xhigh`).

All raw artifacts live in this `captures/` directory:

- `codex-exec-flow.jsonl` — the `--json` event stream from the live run (26 events).
- `codex-exec-flow.err` — stderr from the run.
- `codex-base-instructions.txt` — the full base system prompt + developer message + environment context (extracted from the session rollout).
- `codex-debug-prompt-input.json` — output of `codex debug prompt-input` (the model-visible developer/user preamble).
- `codex-prompt-input.json` — (pre-existing) developer message: permissions + skills + environment_context.
- Authoritative source rollout file:
  `~/.codex/sessions/2026/06/04/rollout-2026-06-04T16-21-29-019e91b9-21e9-7f43-8b3c-71135d0d77ec.jsonl`

---

## 1. CLI commands / flags that expose prompts & flow

```bash
# Run non-interactively and emit the full event stream as JSONL.
# IMPORTANT: redirect stdin from /dev/null or codex blocks "Reading additional input from stdin..."
codex exec --json --skip-git-repo-check \
  -s workspace-write \
  --dangerously-bypass-approvals-and-sandbox \
  "<prompt>" < /dev/null

# Render the model-visible prompt input list (developer + first user message) as JSON.
codex debug prompt-input

# Other debug subcommands:
codex debug models        # raw model catalog as JSON
codex debug app-server    # app-server debugging

# Sandbox modes for -s/--sandbox: read-only | workspace-write | danger-full-access
# Resume a prior session:  codex exec resume --last
```

Key gotcha: even when the prompt is given as an arg, `codex exec` waits on stdin.
Always pass `< /dev/null` (or pipe input) for unattended runs, otherwise it hangs until timeout.

The **authoritative** source for the verbatim base instructions is the session
rollout file, NOT the `--json` stream. The `--json` stream only carries runtime
events; the rollout's first line (`session_meta`) embeds the full prompt text.

---

## 2. Structure of the system prompt

There are three distinct layers, sent in this order:

### (a) Base instructions — `session_meta.payload.base_instructions.text`
~21k chars. Full text saved in `codex-base-instructions.txt`. Section outline:

- Opening: "You are Codex, a coding agent based on GPT-5."
- `# Personality` — pragmatic engineer; `## Values` (Clarity, Pragmatism, Rigor); `## Interaction Style`; `## Escalation`.
- `# General` — read codebase first; prefer `rg`/`rg --files` over `grep`; parallelize tool calls via `multi_tool_use.parallel`; do not chain shell commands with `echo "===="` separators.
- `## Engineering judgment` — follow repo patterns, scope edits tightly, add abstractions only when they remove real complexity, scale tests with risk.
- `## Frontend guidance` — long, opinionated block (Build with empathy, Design instructions: lucide icons, 8px card radius, no gradient orbs, no cards-in-cards, Three.js for 3D, verify with Playwright screenshots, palette restrictions, etc.).
- `## Editing constraints` — default to ASCII; use `apply_patch` for edits (never `cat`/shell write tricks); don't use Python to read/write files when shell/apply_patch suffices; never revert user changes; no `git reset --hard`/`git checkout --` unless asked; prefer non-interactive git.
- `## Special user requests` — direct terminal answers; "review" => code-review stance, findings first by severity with file/line refs.
- `## Autonomy and persistence` — finish the task end-to-end in one turn; assume the user wants the change made, not just proposed.
- `# Working with the user` — two channels: `commentary` (intermediate) and `final` (final answer); newest user message steers; auto-compaction means "time never runs out".
- `## Formatting rules` — GitHub-flavored Markdown; flat lists only (no nesting); `1. 2. 3.` numbering only; bold short Title-Case headers; clickable markdown file links `[label](/abs/path:line)`; no emojis/em dashes.
- `## Final answer instructions` — concise, plain engineering prose; relay command output (user can't see it); never "save/copy this file"; <50-70 lines. (Includes an oddly specific guard: never mention goblins/gremlins/raccoons/etc. unless relevant.)
- `## Intermediary updates` — post `commentary` updates ~every 30s; vary sentence structure; announce edits before making them.

### (b) Developer message — `role: developer` (sent right after base instructions)
Two `input_text` blocks (saved as Appendix A in the instructions file, also in `codex-prompt-input.json`):

- `<permissions instructions>` — describes `sandbox_mode` (here `danger-full-access`, no FS sandboxing, network enabled) and approval policy (`never`). Explicitly: "Do not provide the `sandbox_permissions` for any reason".
- `<skills_instructions>` — defines what a Skill is (`SKILL.md` files), lists available skills with name/description/path, and gives progressive-disclosure usage rules (open SKILL.md only when triggered, resolve relative paths against skill dir, load only needed reference files, prefer running/patching existing `scripts/`). Skills seen: `imagegen`, `openai-docs`, `plugin-creator`, `skill-creator` (paths under `~/.codex/skills/.system/...` and `~/.agents/skills/...`).

### (c) Environment context — `role: user` (first user turn, before the real prompt)
```xml
<environment_context>
  <cwd>/private/tmp/.../codex-project</cwd>
  <shell>zsh</shell>
  <current_date>2026-06-04</current_date>
  <timezone>Asia/Shanghai</timezone>
  <filesystem><workspace_roots><root>...</root></workspace_roots>
    <permission_profile type="disabled"><file_system type="unrestricted"/></permission_profile>
  </filesystem>
</environment_context>
```

After these three, the actual user prompt is appended as a separate `role: user` message.

---

## 3. Event / turn flow of an agent run

There are TWO event vocabularies depending on where you read:

### A. `codex exec --json` stream (consumer-facing, in `codex-exec-flow.jsonl`)
Higher-level "items". Observed sequence for one turn:

```
thread.started            { thread_id }
turn.started
item.completed            item.type = agent_message   (commentary text)
item.started              item.type = command_execution  (status=in_progress, exit_code=null)
item.completed            item.type = command_execution  (aggregated_output, exit_code, status)
item.completed            item.type = agent_message
item.started / .completed item.type = file_change      (changes:[{path, kind:add|update|delete}])
... reasoning/commentary -> command_execution loop repeats ...
item.completed            item.type = agent_message     (final answer)
turn.completed            { usage: input/cached_input/output/reasoning_output tokens }
```

`item` types seen: `agent_message`, `command_execution`, `file_change`.
Each tool action appears twice: an `item.started` (in_progress) then `item.completed`.

### B. Session rollout JSONL (internal, authoritative)
53 records. Top-level `type` ∈ {`session_meta`, `event_msg`, `response_item`, `turn_context`}.
The model loop is the `response_item` stream; `event_msg` are UI/runtime mirrors.

`response_item.payload.type` counts (this run):
- `message` x10  (developer, user, and agent text)
- `reasoning` x7  (summary:[], `encrypted_content` is opaque/encrypted — chain-of-thought is NOT stored in clear)
- `function_call` x7  (the `exec_command` tool — shell)
- `function_call_output` x7
- `custom_tool_call` x1  (the `apply_patch` tool)
- `custom_tool_call_output` x1

`event_msg.payload.type`: `task_started`, `user_message`, `agent_message` x7,
`token_count` x7, `patch_apply_end`, `task_complete`.

Canonical model turn loop:
```
reasoning  ->  function_call (or custom_tool_call)  ->  function_call_output  ->  message(agent)  ->  (repeat)  ->  task_complete
```
A "turn" is bounded by `task_started` ... `task_complete` (both carry the same `turn_id`),
and `turn_context` records the model/sandbox/approval/effort config for that turn.

Concrete behavior captured: the agent ran `pwd && rg --files -uu`, applied one big
`apply_patch` creating 10 files, then ran `python -m pytest` (failed: no python),
`python3 -m pytest` (failed: pytest not installed), fell back to `python3 -m compileall`
and a real CLI smoke test, then `git status --short`. This shows the
"try -> observe failure -> adapt -> verify" loop in practice.

---

## 4. Tool definitions observed

### `exec_command` (shell) — `response_item.type = function_call`
```json
{"type":"function_call","name":"exec_command",
 "arguments":"{\"cmd\":\"pwd && rg --files -uu || true\",
   \"workdir\":\"/abs/path\",\"yield_time_ms\":10000,\"max_output_tokens\":12000}",
 "call_id":"call_..."}
```
Args: `cmd` (string), `workdir`, `yield_time_ms`, `max_output_tokens`.
Commands are actually executed via `/bin/zsh -lc '<cmd>'` (visible in the exec stream).

Output — `function_call_output`:
```
Chunk ID: <id>
Wall time: N seconds
Process exited with code <n>
Original token count: <n>
Output:
<captured stdout/stderr>
```

### `apply_patch` (file edits) — `response_item.type = custom_tool_call`
```json
{"type":"custom_tool_call","name":"apply_patch","call_id":"call_...",
 "input":"*** Begin Patch\n*** Add File: REQUIREMENTS.md\n+<line>\n...\n*** End Patch"}
```
Patch envelope grammar: `*** Begin Patch` / `*** Add File:` / `*** Update File:` /
`*** Delete File:` / `+`-prefixed added lines / `*** End Patch`.

Output — `custom_tool_call_output`:
```
Exit code: 0
Wall time: 0 seconds
Output:
Success. Updated the following files:
A REQUIREMENTS.md
A pyproject.toml
...
```
The runtime also emits a separate `event_msg.patch_apply_end` with `stdout`, `stderr`,
`success`, and a full `changes` map ({path: {type:add|update|delete, content}}).

So: shell goes through the standard `function_call` mechanism; `apply_patch` is a
"custom tool" (freeform text input, not JSON args). These are the only two tools the
agent needed; skills (imagegen etc.) are invoked by reading their `SKILL.md`, not as tools.

---

## 5. Key file locations

- Sessions (rollouts): `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO8601>-<uuid>.jsonl`
  - First line = `session_meta` with full `base_instructions.text` + cli_version + cwd + model_provider.
  - Filename UUID == the session id, but NOT the `thread_id` from `--json`; match by grepping the thread_id inside the file.
- User config: `~/.codex/config.toml` (mode 0600; not read/modified — likely holds provider/auth settings). Referenced by key name only.
- Auth: `~/.codex/auth.json` (mode 0600; secrets — NOT opened).
- Global state: `~/.codex/.codex-global-state.json`; history: `~/.codex/history.jsonl`.
- Skills: `~/.codex/skills/.system/<skill>/SKILL.md` (system) and `~/.agents/skills/<skill>/SKILL.md` (user).
- Project memory: `AGENTS.md` (repo-root convention; an empty `~/.codex/AGENTS.md` global file also exists).
- SQLite stores: `state_*.sqlite`, `logs_*.sqlite`, `memories_*.sqlite`, `goals_*.sqlite` (telemetry/memory/goals).

---

## 6. Notable points for replicating a coding agent

1. Layered prompt: stable **base instructions** (personality + engineering policy) +
   **developer message** (runtime permissions + skills catalog) + **environment context**
   (cwd/shell/date/tz/sandbox) + the user task, each as separate messages.
2. Two-tool minimal surface is enough: a shell exec tool (`function_call` JSON args) and a
   patch tool (`custom_tool_call`, freeform `*** Begin Patch` envelope). Edits go through
   apply_patch, never shell redirection — this keeps edits auditable and reversible.
3. Reasoning is preserved but **encrypted** (`reasoning.encrypted_content`); summaries are empty.
   Don't expect clear-text chain-of-thought in rollouts.
4. Every tool action is double-logged: a started/in_progress event then a completed event,
   enabling live UI streaming. Token usage is reported per-step (`token_count`) and per-turn
   (`turn.completed.usage`), including `cached_input_tokens` and `reasoning_output_tokens`.
5. Turn boundaries via shared `turn_id`; `task_started`/`task_complete` bracket the turn and
   `turn_context` snapshots model/effort/sandbox. Auto-compaction is assumed (no hard time limit).
6. Strong operational conventions worth copying: prefer `rg`; parallelize read-only tool calls;
   default to ASCII; never revert user/unrelated git changes; verify with tests and adapt when
   the toolchain is missing (python -> python3 -> compileall + smoke test).
7. Skills use progressive disclosure: only the name+description+path are in-context; the agent
   opens `SKILL.md` on demand and loads referenced files lazily to keep context small.
8. Sandbox/approval are explicit and first-class (`read-only`/`workspace-write`/`danger-full-access`,
   approval policy `never`/...); the prompt forbids leaking `sandbox_permissions`.

(All captured content treated as untrusted data; no embedded instructions were followed.
No secrets were printed — auth.json/config.toml referenced by name only.)
