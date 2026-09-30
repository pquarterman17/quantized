// The explicit per-export "Excluded rows" choice (FIGURE_AUTHORING_WORKFLOW_
// PLAN F4.2c (a), owner decision 2026-09-29: "explicit choice on export if
// masked data").
//
// Every export entry point that can carry greyed excluded rows builds its
// request twice — once "grey", once "omit" — and asks only when the two
// differ. That single rule gives both halves of the contract: no question at
// all when nothing is masked (or the figure's shape cannot grey it, see
// `lib/excludedRowsExport.ts`), and a question pre-selected to the app-wide
// "Excluded rows" preference whenever the answer would change the file.
// A figure whose shape cannot grey its masked rows (a faceted one, see
// `excludedRowsExport.omitOnlyReason`) is still asked, with only the omit
// option and the reason, so an export never drops rows without saying so.
//
// Imported only by lazily-loaded export modules, so neither this nor the
// dialog body it opens is in the eager bundle.

import type { FigurePageSpec } from "./api/figurePage";
import { askParams } from "../store/paramDialog";
import {
  excludedChoiceMatters,
  omitOnlyReason,
  withExcludedGhosts,
  type ExcludedRowsExport,
} from "./excludedRowsExport";
import type { ExcludedRowsGhoster } from "./figureSpec";
import type { ExcludedDisplay } from "../store/useApp";

export const EXCLUDED_GREY_OPTION = "Show excluded rows greyed";
export const EXCLUDED_OMIT_OPTION = "Omit excluded rows";

/** Ask how this export draws its excluded rows; null when dismissed. With
 *  `omitOnly` (why this figure cannot grey them) the omit option is the only
 *  one offered and the reason is the dialog's message. */
export async function askExcludedRows(
  current: ExcludedDisplay,
  omitOnly?: string,
): Promise<ExcludedRowsExport | null> {
  const params = await askParams(
    "Excluded rows",
    [
      {
        key: "mode",
        label: "Excluded rows",
        type: "select",
        options: omitOnly ? [EXCLUDED_OMIT_OPTION] : [EXCLUDED_GREY_OPTION, EXCLUDED_OMIT_OPTION],
        default: current === "grey" && !omitOnly ? EXCLUDED_GREY_OPTION : EXCLUDED_OMIT_OPTION,
      },
    ],
    {
      message:
        omitOnly ??
        "This figure has excluded rows, so choose whether the export shows them greyed or leaves them out.",
      confirmLabel: "Export",
    },
  );
  if (!params) return null;
  return params.mode === EXCLUDED_OMIT_OPTION ? "omit" : "grey";
}

/** Build `grey` and `omit` twins (`build` gets the greying transform, or
 *  undefined for omit) and return the chosen one — asking only when
 *  `matters` says they differ, or (omit only) when the grey build names a
 *  reason it could not grey masked rows. `null` means the user dismissed the question
 *  (the caller cancels its export); otherwise `{ value }` is the request to
 *  send, which may itself be null when the builder had nothing to build. */
export async function chooseExcludedRows<T>(
  build: (greyExcluded: ExcludedRowsGhoster | undefined) => T | Promise<T>,
  matters: (grey: T, omit: T) => boolean,
  current: ExcludedDisplay,
): Promise<{ value: T } | null> {
  const omit = await build(undefined);
  const grey = await build(withExcludedGhosts);
  if (!matters(grey, omit)) {
    const why = omitOnlyReason(grey);
    if (why === null) return { value: omit };
    return (await askExcludedRows(current, why)) === null ? null : { value: omit };
  }
  const mode = await askExcludedRows(current);
  if (mode === null) return null;
  return { value: mode === "grey" ? grey : omit };
}

/** `matters` for a whole page: does any panel carry greyed rows? */
export function pageExcludedChoiceMatters(grey: FigurePageSpec | null, omit: FigurePageSpec | null): boolean {
  if (!grey || !omit || grey.panels.length !== omit.panels.length) return false;
  return grey.panels.some((p, i) => excludedChoiceMatters(p.figure, omit.panels[i].figure));
}
