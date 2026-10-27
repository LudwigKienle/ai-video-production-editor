/**
 * Live pages: a page with lots of component-local state (generation settings,
 * reference lists, job queues …) publishes its settings and its buttons as
 * three live commands while it is mounted:
 *
 *   <ns>.get     → { settings, info }
 *   <ns>.set     → apply settings, wait for React to commit, return state
 *   <ns>.action  → optionally apply settings, then run a named button handler
 *
 * The page calls `useLivePage(ns, spec)` on every render with its current
 * values, setters and handlers, so a command always runs the same code as the
 * button. `livePageTools.ts` turns a spec description into MCP tools.
 */
import { useEffect, useRef } from 'react';
import { registerLiveCommands } from './liveCommands';

import { applySettings, snapshotSettings, type LivePageSpec } from './livePageCore';

export type { LiveActionHelpers, LivePageSpec, LiveSetting } from './livePageCore';

/** Registers `<ns>.get/.set/.action` for the lifetime of the page. */
export function useLivePage(ns: string, spec: LivePageSpec): void {
  const specRef = useRef(spec);
  specRef.current = spec;
  const waiters = useRef<Array<() => void>>([]);

  // Runs after every commit: whoever waits for the page to re-render continues.
  useEffect(() => {
    const list = waiters.current;
    waiters.current = [];
    list.forEach((resolve) => resolve());
  });

  useEffect(() => {
    const waitForCommit = () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        waiters.current.push(finish);
        // Nothing changed → no re-render; continue anyway.
        setTimeout(finish, 250);
      });
    const state = () => ({ settings: snapshotSettings(specRef.current.settings), info: specRef.current.info?.() ?? {} });
    return registerLiveCommands({
      [`${ns}.get`]: () => state(),
      [`${ns}.set`]: async (args) => {
        const changed = applySettings(specRef.current.settings, args.settings);
        if (changed.length) await waitForCommit();
        return { changed, ...state() };
      },
      [`${ns}.action`]: async (args) => {
        const name = String(args.action ?? '');
        if (!specRef.current.actions[name]) throw new Error(`Unknown action "${name}".`);
        if (applySettings(specRef.current.settings, args.settings).length) await waitForCommit();
        const result = await specRef.current.actions[name]((args.args as Record<string, unknown>) ?? {}, { waitForCommit });
        await waitForCommit();
        return { result: result ?? null, ...state() };
      },
    });
  }, [ns]);
}
