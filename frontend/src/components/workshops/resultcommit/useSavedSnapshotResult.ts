// Whether this exact computation is already saved as a snapshot result (lane
// RL3). Reads the live store, so Undo or deleting the result re-enables Save.
// `key` comes from lib/snapshotResultKey.ts `snapshotResultKey(...)`, or null
// while there is no computation (no source, still loading, no mode yet).

import { savedSnapshotKey } from "../../../lib/snapshotResultKey";
import { useApp } from "../../../store/useApp";

export function useSavedSnapshotResult(key: string | null): boolean {
  return useApp((state) => key !== null && state.analysisResults.some((result) => savedSnapshotKey(result) === key));
}
