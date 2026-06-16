import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  createHistoryState,
  pushHistoryState,
  redoHistoryState,
  resetHistoryState,
  undoHistoryState,
  type HistoryState,
} from '../utils/historyState';

export const useHistoryState = <T>(
  initialState: T,
): [T, Dispatch<SetStateAction<T>>, () => void, () => void, boolean, boolean, (newState: T) => void] => {
  const [state, setState] = useState<HistoryState<T>>(() => createHistoryState(initialState));

  const set = useCallback<Dispatch<SetStateAction<T>>>((newState) => {
    setState((currentState) => pushHistoryState(currentState, newState));
  }, []);

  const undo = useCallback(() => {
    setState((currentState) => undoHistoryState(currentState));
  }, []);

  const redo = useCallback(() => {
    setState((currentState) => redoHistoryState(currentState));
  }, []);

  const reset = useCallback((newState: T) => {
    setState(resetHistoryState(newState));
  }, []);

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  return [state.present, set, undo, redo, canUndo, canRedo, reset];
};
