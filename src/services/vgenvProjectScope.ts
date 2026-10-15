export type VgenvProjectEpoch = { path: string | null | undefined; value: number };

export const advanceVgenvProjectEpoch = (current: VgenvProjectEpoch, path: string | null | undefined): VgenvProjectEpoch =>
  current.path === path ? current : { path, value: current.value + 1 };

export const isCurrentVgenvProject = (current: VgenvProjectEpoch, path: string, epoch: number) =>
  current.path === path && current.value === epoch;

export const jobForVgenvProject = <T>(state: { path: string; job: T } | null, path: string | null | undefined): T | null =>
  state?.path === path ? state.job : null;
