// Operation generation shared by the project-lock store and lifecycle helpers.
// Any close, reservation, or new acquisition supersedes older async work.
let projectEpoch = 0;

export const beginProjectLockOperation = (): number => ++projectEpoch;
export const isCurrentProjectLockOperation = (candidate: number): boolean => candidate === projectEpoch;
