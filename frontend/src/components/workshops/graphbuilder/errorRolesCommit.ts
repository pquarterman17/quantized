// Committing the Graph Builder's error wells. Error roles are a DATASET
// property (`setErrorRoles` pushes them to every plot window bound to the
// dataset, and export + the Inspector read them from there), so a commit is
// visible in the dataset's other plot windows too. That is by design, but the
// user is told so it is not a surprise.

import type { ErrorBinding } from "../../../lib/errorRoles";
import { toast } from "../../../store/toasts";
import type { AppState } from "../../../store/useApp";

/** `app` is the live store state (the caller owns reading it). */
export function commitErrorRoles(app: AppState, datasetId: string, roles: readonly ErrorBinding[]): void {
  const others = app.plotWindows.filter((w) => w.kind === "plot" && w.datasetId === datasetId && w.id !== app.focusedWindowId).length;
  app.setErrorRoles(datasetId, roles);
  if (others > 0) toast(`Error bars belong to the dataset, so ${others} other plot window${others === 1 ? "" : "s"} on it show them too (undo removes them).`, "info");
}
