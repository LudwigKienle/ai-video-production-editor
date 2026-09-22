# Local agents (Claude Code, Codex)

Claude Code and Codex can drive the editor as agents, signed in with their **own CLI
login**. The app never reads or copies an OAuth token — that is what the CLIs' terms
forbid and what gets accounts banned. Instead each CLI is started through its
[ACP](https://agentclientprotocol.com) adapter and authenticates itself, exactly as it
would in a terminal.

## Pieces

| Where | What |
|---|---|
| `electron/local-agents.js` | Detects `claude` / `codex` on PATH (+ `~/.local/bin` etc.), spawns the ACP adapter (`@zed-industries/claude-code-acp`, `@zed-industries/codex-acp`) with Electron as the node runtime, speaks ACP (ndjson JSON-RPC) — `initialize`, `session/new`, `session/prompt`, `session/cancel`; answers `session/request_permission` (forwarded to the UI) and `fs/*`. |
| `electron/studio-mcp-server.js` | Minimal MCP server (Streamable HTTP, JSON responses) on `127.0.0.1:<random>/mcp`. `tools/list` returns the editor's tools, `tools/call` forwards to the renderer over IPC. Passed to every session as `mcpServers: [{ name: 'studio', type: 'http', url }]`. |
| `src/services/localAgentsService.ts` | Renderer wrapper; `registerStudioTools` converts the Gemini `FunctionDeclaration`s to JSON Schema and serves calls with the same executor the Gemini assistant uses. |
| `src/components/AIAssistant.tsx` | Agent switch in the header (Gemini · Claude Code · Codex), streamed replies, tool-call lines (`▸` running, `✓` done, `✗` failed), inline permission prompts, Stop. |
| `src/components/ApiKeyModal.tsx` | Settings → Local agents: detection, version, login hint, "Sign in in Terminal", Stop. |

## Session lifecycle

One adapter process and one ACP session per agent, kept alive across prompts so the
agent remembers the conversation. `cwd` is the user's home (the project folder is
reachable through the tools). Stopping the app disposes all sessions and the MCP server.

## Permissions

The editor's own tools carry no ACP permission prompt — they are the safe surface. When
the agent wants something else (write a file, run a command), the adapter sends
`session/request_permission`; the assistant shows the options (Allow once / Always /
Reject) and answers. Unanswered requests time out after ten minutes as `cancelled`.

## Verified

`initialize` + `session/new` against the real `claude-code-acp` 0.16.2 with the user's
Claude Code 2.1 login: protocol 1, `authMethods: ["claude-login"]`, models listed.
Codex uses the same path via `codex-acp` (native binary, reads `~/.codex/auth.json`).
