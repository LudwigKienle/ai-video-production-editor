import type { FunctionDeclaration } from '@google/genai';

/**
 * Local coding agents (Claude Code, Codex) driven over ACP from the Electron
 * main process (electron/local-agents.js). They sign in with their own CLI login;
 * the editor never sees a token. The editor's tools are offered to them through a
 * local MCP server, registered from the renderer via `registerStudioTools`.
 */

export type LocalAgentId = 'claude-code' | 'codex';

export type LocalAgentInfo = {
  id: LocalAgentId;
  label: string;
  installed: boolean;
  binary: string | null;
  version: string | null;
  adapterAvailable: boolean;
  login: 'signed-in' | 'likely' | 'unknown';
  loginHint: string;
  running: boolean;
};

export type AcpToolCallUpdate = {
  toolCallId: string;
  title?: string | null;
  kind?: string | null;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | null;
  content?: Array<{ type: string; content?: { type: string; text?: string }; text?: string }> | null;
};

export type LocalAgentEvent =
  | { type: 'update'; agent: LocalAgentId; sessionId: string; update: { sessionUpdate: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk'; content: { type: 'text'; text: string } | { type: string } } | ({ sessionUpdate: 'tool_call' | 'tool_call_update' } & AcpToolCallUpdate) | { sessionUpdate: 'plan'; entries: Array<{ content: string; status: string; priority?: string }> } | { sessionUpdate: string; [key: string]: unknown } }
  | { type: 'permission'; agent: LocalAgentId; requestId: string; toolCall: AcpToolCallUpdate; options: Array<{ optionId: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }> }
  | { type: 'turn'; agent: LocalAgentId; phase: 'start' | 'end' | 'error'; stopReason?: string; error?: string }
  | { type: 'session'; agent: LocalAgentId; sessionId: string }
  | { type: 'exit'; agent: LocalAgentId; code: number | null }
  | { type: 'log'; agent: LocalAgentId; text: string };

type LocalAgentsBridge = {
  list: () => Promise<LocalAgentInfo[]>;
  prompt: (payload: { agent: LocalAgentId; text: string; cwd?: string | null; permissionPolicy?: 'ask' | 'allow' }) => Promise<{ ok: true; stopReason?: string }>;
  cancel: (payload: { agent: LocalAgentId }) => Promise<{ ok: boolean }>;
  stop: (payload: { agent: LocalAgentId }) => Promise<{ ok: boolean }>;
  answerPermission: (payload: { agent: LocalAgentId; requestId: string; optionId: string }) => Promise<{ ok: boolean }>;
  openLogin: (payload: { agent: LocalAgentId }) => Promise<{ ok: boolean; hint?: string }>;
  onEvent: (callback: (event: LocalAgentEvent) => void) => () => void;
};

type StudioToolsBridge = {
  register: (tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>) => Promise<{ ok: boolean; count: number }>;
  onCall: (callback: (call: { callId: string; name: string; args: Record<string, unknown> }) => void) => () => void;
  reply: (payload: { callId: string; result?: unknown; error?: string }) => void;
};

// Window.electron is typed twice in this codebase; read through any like the sibling services.
const agentsApi = (): LocalAgentsBridge | undefined => (typeof window !== 'undefined' ? (window as any).electron?.localAgents : undefined);
const toolsApi = (): StudioToolsBridge | undefined => (typeof window !== 'undefined' ? (window as any).electron?.studioTools : undefined);

export const isLocalAgentsAvailable = () => Boolean(agentsApi());

export const listLocalAgents = async (): Promise<LocalAgentInfo[]> => {
  const api = agentsApi();
  if (!api) return [];
  try { return await api.list(); } catch { return []; }
};

export const promptLocalAgent = (payload: { agent: LocalAgentId; text: string; cwd?: string | null; permissionPolicy?: 'ask' | 'allow' }) => {
  const api = agentsApi();
  if (!api) throw new Error('Local agents are only available in the desktop app.');
  return api.prompt(payload);
};

export const cancelLocalAgent = (agent: LocalAgentId) => agentsApi()?.cancel({ agent });
export const stopLocalAgent = (agent: LocalAgentId) => agentsApi()?.stop({ agent });
export const answerLocalAgentPermission = (agent: LocalAgentId, requestId: string, optionId: string) => agentsApi()?.answerPermission({ agent, requestId, optionId });
export const openLocalAgentLogin = (agent: LocalAgentId) => agentsApi()?.openLogin({ agent });
export const onLocalAgentEvent = (callback: (event: LocalAgentEvent) => void): (() => void) => agentsApi()?.onEvent(callback) || (() => undefined);

/** Gemini's FunctionDeclaration schema uses upper-case Type enums; MCP wants plain JSON Schema. */
const toJsonSchema = (schema: any): any => {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') out.type = value.toLowerCase();
    else if (key === 'properties' && value && typeof value === 'object') out.properties = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSchema(v)]));
    else if (key === 'items') out.items = toJsonSchema(value);
    else if (key === 'nullable') continue;
    else out[key] = value;
  }
  return out;
};

/**
 * Publish the assistant's tools to the local MCP server and serve calls from it.
 * Returns an unsubscribe function; call again whenever the tool set changes.
 */
export const registerStudioTools = (tools: FunctionDeclaration[], executor: { [name: string]: Function }): (() => void) => {
  const api = toolsApi();
  if (!api) return () => undefined;
  const list = tools.map((tool) => ({
    name: tool.name || 'tool',
    description: tool.description || '',
    inputSchema: toJsonSchema(tool.parameters) || { type: 'object', properties: {} },
  }));
  void api.register(list);
  return api.onCall(async ({ callId, name, args }) => {
    const fn = executor[name];
    if (!fn) { api.reply({ callId, error: `Unknown tool: ${name}` }); return; }
    try {
      const result = await fn(args || {});
      api.reply({ callId, result: result ?? { ok: true } });
    } catch (error) {
      api.reply({ callId, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
