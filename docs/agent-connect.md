# Claude & Codex → the editor (MCP / REST)

The open editor is the backend and the viewer; Claude Code, Codex, Claude Desktop or any
script is the driver. While the app runs it serves its tools on `127.0.0.1`, and every
change an agent makes lands in the open project (autosaved) and shows up in the UI at once.

## Connect

Settings → **Claude & Codex** → *Connect* next to Claude Code, Codex or Claude Desktop.
Each client gets the same stdio bridge (`~/.ai-video-production-editor/studio-mcp-stdio.js`,
run by the app's own binary with `ELECTRON_RUN_AS_NODE=1`). The bridge reads the live URL
and token from `~/.ai-video-production-editor/studio-connect.json`, so no secret is written
into the clients' configs and a new token or port needs no reconnect.

| Client | Where it is registered |
|---|---|
| Claude Code (terminal and the desktop Code tab) | `claude mcp add-json ai-video-studio … --scope user` |
| Codex | `codex mcp add ai-video-studio …` (`~/.codex/config.toml`) |
| Claude Desktop | `mcpServers.ai-video-studio` in `claude_desktop_config.json` (restart Claude) |

Start a new agent session afterwards; the tools appear as `mcp__ai-video-studio__*`.

## Endpoints

| | |
|---|---|
| MCP (Streamable HTTP, JSON responses) | `http://127.0.0.1:47820/mcp` |
| REST | `GET /api/tools`, `POST /api/tools/<name>` (JSON body = arguments), `GET /api/health` |
| Auth | `Authorization: Bearer <token>` (Settings → Claude & Codex → *Other tools*; *New token* rotates it) |

Port 47820 is preferred; if it is taken the server falls back to a free port and the
discovery file has the real one. Requests with a browser `Origin` or a non-local `Host`
are refused (DNS-rebinding guard).

```bash
TOKEN=$(node -p "require(require('os').homedir()+'/.ai-video-production-editor/studio-connect.json').token")
curl -s -X POST http://127.0.0.1:47820/api/tools/project_get_overview -H "Authorization: Bearer $TOKEN"
```

## Tools

Everything the in-app assistant can do (`navigateWorkspace`, `studioAgent*`, timeline
tools …) plus the Project Space tools in `src/services/projectAgentTools.ts`:

| Tool | Does |
|---|---|
| `project_get_overview` | Title, logline, style, cast/locations/props, shots with frame/video URLs, current phase |
| `project_get_story` / `project_update_story` | Story bible and script (the previous script is kept as a revision) |
| `project_list_references` / `project_upsert_reference` / `project_delete_reference` | Characters, environments, products, props; `imageUrl` / `imagePath` adds a selected image version |
| `project_list_shots` / `project_upsert_shots` / `project_delete_shots` | Storyboard shots; merge by shot number or `replace: true`; attach frames and videos |
| `project_view_image` | Returns a frame or reference image (≤1024 px) as MCP image content |
| `project_open_phase` | Shows script, concept, storyboard, filming … to the user |
| `project_generate` | The app's own steps with the models chosen in the app: concepts, environment angles, director pass, storyboard images/videos, write/improve script |

Local file paths in any `…Path` argument become `file://` URLs before the call reaches the
renderer. Edits go through the history stacks, so the user can undo them.

## Pieces

| Where | What |
|---|---|
| `electron/studio-mcp-server.js` | Server, token, discovery file, activity feed |
| `electron/studio-mcp-stdio.js` | stdio ⇄ HTTP bridge |
| `electron/agent-connect.js` | Connect / disconnect per client, status |
| `src/services/projectAgentTools.ts` | Project Space tools (pure merge logic is unit-tested) |
| `src/App.tsx` | Publishes the tool registry while the app runs |
| `src/components/StudioConnectPanel.tsx` | Settings → Claude & Codex |
