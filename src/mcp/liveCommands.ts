/**
 * Live commands: page components register handlers for UI-local state (an
 * export queue, the Fusion comp being edited, the photo layer stack …) while
 * they are mounted. MCP tools invoke them by name; if the page is not open,
 * the tool opens it and waits briefly for the handler to appear.
 */
import type { Workspace } from '../types';

type LiveHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers = new Map<string, LiveHandler>();
const waiters = new Map<string, Array<() => void>>();

export function registerLiveCommand(name: string, handler: LiveHandler): () => void {
  handlers.set(name, handler);
  (waiters.get(name) ?? []).forEach((resolve) => resolve());
  waiters.delete(name);
  return () => {
    if (handlers.get(name) === handler) handlers.delete(name);
  };
}

/** React helper: register several commands for the lifetime of a component. */
export function registerLiveCommands(map: Record<string, LiveHandler>): () => void {
  const disposers = Object.entries(map).map(([name, handler]) => registerLiveCommand(name, handler));
  return () => disposers.forEach((dispose) => dispose());
}

export function hasLiveCommand(name: string): boolean {
  return handlers.has(name);
}

export async function invokeLiveCommand(
  name: string,
  args: Record<string, unknown>,
  options: { openWorkspace?: () => void; workspace?: Workspace; timeoutMs?: number } = {},
): Promise<unknown> {
  if (!handlers.has(name)) {
    options.openWorkspace?.();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Command "${name}" is not available${options.workspace ? ` (open the ${options.workspace} page)` : ''}.`)), options.timeoutMs ?? 4000);
      const list = waiters.get(name) ?? [];
      list.push(() => {
        clearTimeout(timer);
        resolve();
      });
      waiters.set(name, list);
    });
  }
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Command "${name}" is not available.`);
  return handler(args);
}
