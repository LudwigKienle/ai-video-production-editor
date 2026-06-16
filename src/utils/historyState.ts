import type { SetStateAction } from 'react';

export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export const createHistoryState = <T>(initialState: T): HistoryState<T> => ({
  past: [],
  present: initialState,
  future: [],
});

const resolveHistoryUpdate = <T>(current: T, update: SetStateAction<T>): T => {
  if (typeof update === 'function') {
    return (update as (current: T) => T)(current);
  }
  return update;
};

export const pushHistoryState = <T>(
  state: HistoryState<T>,
  update: SetStateAction<T>,
): HistoryState<T> => {
  const next = resolveHistoryUpdate(state.present, update);
  if (Object.is(next, state.present)) {
    return state;
  }
  return {
    past: [...state.past, state.present],
    present: next,
    future: [],
  };
};

export const undoHistoryState = <T>(state: HistoryState<T>): HistoryState<T> => {
  if (state.past.length === 0) {
    return state;
  }
  const previous = state.past[state.past.length - 1];
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  };
};

export const redoHistoryState = <T>(state: HistoryState<T>): HistoryState<T> => {
  if (state.future.length === 0) {
    return state;
  }
  const next = state.future[0];
  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
  };
};

export const resetHistoryState = <T>(nextState: T): HistoryState<T> => createHistoryState(nextState);
