// Operation generation shared by the project-lock store and lifecycle helpers.
// Any close, reservation, or new acquisition supersedes older async work.
let projectEpoch = 0;

export const beginProjectLockOperation = (): number => ++projectEpoch;
export const isCurrentProjectLockOperation = (candidate: number): boolean => candidate === projectEpoch;

/** The fields every close, reservation and fail-closed open resets. Writers
 *  spread this and add their own status/path/record, instead of repeating
 *  the literal (each copy was eager bytes). */
export const DETACHED_LOCK = { record: null, path: null, openedAsCopy: false, unverifiableHeartbeats: 0 } as const;
