// Shared workbench shell (lane WB4): wait for React to commit what the store
// just changed. A lazy Origin book that is installed while a run is in flight
// swaps the dataset's `.data` and clears its row state, which moves the run key
// (`datasetInputsToken`); a run launched before that would be aborted by the key
// change (useWorkbenchPreview) or land stamped with a key that is already out of
// date (useRunStamp). So a tool resolves its pending datasets FIRST, waits here
// for the commit that moves the key, and only then launches the run.
//
// A macrotask boundary is enough: React's store-driven render and its passive
// effects (which refresh the latest-key ref) run in microtasks before it.
export const afterCommit = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));
