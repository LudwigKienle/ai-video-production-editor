/**
 * Renderer side of the external-agent connection (electron/agent-connect.js and
 * electron/studio-mcp-server.js): status, one-click connect for Claude Code / Codex /
 * Claude Desktop, the token, and a live feed of tool calls agents make.
 */

export type StudioConnectClientId = 'claude-code' | 'codex' | 'claude-desktop';

export type StudioConnectStatus = {
  server: {
    running: boolean;
    port: number;
    mcpUrl: string | null;
    apiUrl: string | null;
    token: string;
    toolCount: number;
    discoveryFile: string;
  };
  serverName: string;
  bridge: { command: string; args: string[]; env: Record<string, string> };
  clients: Array<{ id: StudioConnectClientId; label: string; installed: boolean; connected: boolean }>;
};

export type StudioConnectActivity = { phase?: 'start' | 'end'; callId?: string; tool: string; source: string; client?: string; ok?: boolean; error?: string; at: string };

type StudioConnectBridge = {
  status: () => Promise<StudioConnectStatus>;
  connect: (payload: { client: StudioConnectClientId }) => Promise<{ ok: boolean; hint?: string }>;
  disconnect: (payload: { client: StudioConnectClientId }) => Promise<{ ok: boolean }>;
  regenerateToken: () => Promise<{ token: string }>;
  activity: () => Promise<StudioConnectActivity[]>;
  onActivity: (callback: (entry: StudioConnectActivity) => void) => () => void;
};

const api = (): StudioConnectBridge | undefined => (typeof window !== 'undefined' ? (window as any).electron?.studioConnect : undefined);

export const isStudioConnectAvailable = () => Boolean(api());
export const getStudioConnectStatus = () => api()?.status() ?? Promise.resolve(null);
export const connectStudioClient = (client: StudioConnectClientId) => api()!.connect({ client });
export const disconnectStudioClient = (client: StudioConnectClientId) => api()!.disconnect({ client });
export const regenerateStudioToken = () => api()!.regenerateToken();
export const getStudioConnectActivity = () => api()?.activity() ?? Promise.resolve([]);
export const onStudioConnectActivity = (callback: (entry: StudioConnectActivity) => void) => api()?.onActivity(callback) || (() => undefined);
