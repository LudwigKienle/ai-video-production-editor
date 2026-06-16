import { useState, useCallback } from 'react';

type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

/**
 * A custom hook to manage state history for undo/redo functionality.
 * @param initialState The initial state value.
 * @returns A tuple containing:
 *  - The present state.
 *  - A setter function for the state.
 *  - An undo function.
 *  - A redo function.
 *  - A boolean indicating if undo is possible.
 *  - A boolean indicating if redo is possible.
 */
export const useHistoryState = <T>(initialState: T): [T, (newState: T) => void, () => void, () => void, boolean, boolean] => {
  const [state, setState] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
  });

  const set = useCallback((newState: T) => {
    const { present } = state;
    if (newState === present) {
      return;
    }
    setState(currentState => ({
      past: [...currentState.past, currentState.present],
      present: newState,
      future: [],
    }));
  }, [state]);

  const undo = useCallback(() => {
    setState(currentState => {
        const { past, present, future } = currentState;
        if (past.length === 0) {
            return currentState;
        }
        const previous = past[past.length - 1];
        const newPast = past.slice(0, past.length - 1);
        return {
            past: newPast,
            present: previous,
            future: [present, ...future],
        };
    });
  }, []);

  const redo = useCallback(() => {
    setState(currentState => {
        const { past, present, future } = currentState;
        if (future.length === 0) {
            return currentState;
        }
        const next = future[0];
        const newFuture = future.slice(1);
        return {
            past: [...past, present],
            present: next,
            future: newFuture,
        };
    });
  }, []);

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  return [state.present, set, undo, redo, canUndo, canRedo];
};
