// Which hidden channels the plot legend leaves out entirely (re-audit #12).
// Origin's legend lists the curves a graph draws. A column that is not a
// curve of this plot -- an error column (bound as whiskers, by a role, a
// designation or a hint), a Label / Disregard / X column, or a Y that belongs
// to a secondary X -- is hidden by default and was still listed, greyed and
// struck through, so a book with three such columns showed more struck rows
// than curves. Those rows go; a CURVE the user hid stays listed, struck, so
// it can be shown again from the legend. Every channel stays toggleable from
// the Channels and Error columns cards.

import { bookDefaultHiddenChannels, errorRoleViewDefaults } from "./errorbars";
import type { Dataset } from "./types";

export function legendNonCurves(
  dataset: (Pick<Dataset, "data" | "errorRoles" | "columnDesignations">) | null | undefined,
  errKeys: Record<number, number> | null | undefined,
): Set<number> {
  const out = new Set<number>(Object.values(errKeys ?? {}));
  if (!dataset) return out;
  for (const c of errorRoleViewDefaults(dataset).hiddenChannels) out.add(c);
  for (const c of bookDefaultHiddenChannels(dataset)) out.add(c);
  return out;
}
