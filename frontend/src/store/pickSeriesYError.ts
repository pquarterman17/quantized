// The ONE write for a series' symmetric-Y error column, shared by the Channels
// card's "±" pick and the series card's "Error bars" box. It writes BOTH homes
// -- the legacy `errKeys` pick and the dataset's error roles -- so the two
// cards and the plot never disagree about one series (figures-audit #10).

import { withErrKey, withSymmetricYError } from "../lib/errorRoleEdits";
import { symmetricBinding } from "../lib/errorRoles";
import { useApp } from "./useApp";

/** Set (or clear, `channel` = null) series `i`'s error column on dataset `id`. */
export function pickSeriesYError(id: string, i: number, channel: number | null): void {
  const s = useApp.getState();
  const roles = s.datasets.find((d) => d.id === id)?.errorRoles ?? [];
  // ONE undo step per pick. Each store setter records its own, so only the
  // one(s) that change anything run -- and when BOTH must (a restored legacy
  // pick plus an unbound role), the roles' entry already holds the pre-pick
  // state, so the legacy key is written under it, unrecorded.
  const keyChanges = (s.errKeys[i] ?? null) !== channel;
  const rolesChange = symmetricBinding(roles, i, "y") !== channel;
  if (rolesChange) s.setErrorRoles(id, withSymmetricYError(roles, i, channel));
  if (keyChanges && !rolesChange) s.setErrKey(i, channel);
  else if (keyChanges) useApp.setState((st) => ({ errKeys: withErrKey(st.errKeys, i, channel) }));
}
