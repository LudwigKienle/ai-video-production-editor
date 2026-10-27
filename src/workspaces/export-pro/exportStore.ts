/**
 * Module-level store for the Export page state. The page subscribes to it, and the MCP tools
 * (src/mcp/modules/exportTools.ts) read and change it directly — settings and the queue are
 * reachable even when the Export page is not open. Rendering itself needs the mounted page
 * (preview canvas, FX bake, Electron IPC) and is triggered through live commands.
 */
import { runExportCommand, type ExportCommandArgs, type ExportCommandContext, type ExportCommandId } from './commands.ts';
import { deserializeExportState, serializeExportState, type ExportPageState } from './exportState.ts';

const STORAGE_KEY = 'avpe.exportPage.v1';

const readStorage = (): string | null => {
    try {
        return typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : null;
    } catch {
        return null;
    }
};

let state: ExportPageState = deserializeExportState(readStorage());
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const persistSoon = () => {
    if (typeof window === 'undefined') return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = null;
        try {
            window.localStorage?.setItem(STORAGE_KEY, serializeExportState(state));
        } catch {
            // storage full / blocked — the page keeps working without persistence
        }
    }, 250);
};

export const getExportState = () => state;

export const setExportState = (updater: (current: ExportPageState) => ExportPageState) => {
    const next = updater(state);
    if (next === state) return state;
    state = next;
    persistSoon();
    listeners.forEach((listener) => listener());
    return state;
};

export const subscribeExportState = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const dispatchExportCommand = <K extends ExportCommandId>(id: K, args: ExportCommandArgs[K], ctx?: ExportCommandContext) =>
    setExportState((current) => runExportCommand(current, id, args, ctx));

/** Tests only: replace the store content. */
export const resetExportStoreForTests = (next?: ExportPageState) => {
    state = next ?? deserializeExportState(null);
    listeners.forEach((listener) => listener());
};
