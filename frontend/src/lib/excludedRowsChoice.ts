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
//
// Imported only by lazily-loaded export modules, so neither this nor the
// dialog body it opens is in the eager bundle.

import type { FigurePageSpec } from "./api/figurePage";
import { askParams } from "../store/paramDialog";
import { excludedChoiceMatters, withExcludedGhosts, type ExcludedRowsExport } from "./excludedRowsExport";
import type { ExcludedRowsGhoster } from "./figureSpec";
import type { ExcludedDisplay } from "../store/useApp";

export const EXCLUDED_GREY_OPTION = "Show excluded rows greyed";
export const EXCLUDED_OMIT_OPTION = "Omit excluded rows";

/** Ask how this export draws its excluded rows; null when dismissed. */
export async function askExcludedRows(current: ExcludedDisplay): Promise<ExcludedRowsExport | null> {
  const params = await askParams(
    "Excluded rows",
    [
      {
        key: "mode",
        label: "Excluded rows",
        type: "select",
        options: [EXCLUDED_GREY_OPTION, EXCLUDED_OMIT_OPTION],
        default: current === "grey" ? EXCLUDED_GREY_OPTION : EXCLUDED_OMIT_OPTION,
      },
    ],
    {
      message: "This figure has excluded rows, so choose whether the export shows them greyed or leaves them out.",
      confirmLabel: "Export",
    },
  );
  if (!params) return null;
  return params.mode === EXCLUDED_OMIT_OPTION ? "omit" : "grey";
}

/** Build `grey` and `omit` twins (`build` gets the greying transform, or
 *  undefined for omit) and return the chosen one — asking only when
 *  `matters` says they differ. `null` means the user dismissed the question
 *  (the caller cancels its export); otherwise `{ value }` is the request to
 *  send, which may itself be null when the builder had nothing to build. */
export async function chooseExcludedRows<T>(
  build: (greyExcluded: ExcludedRowsGhoster | undefined) => T | Promise<T>,
  matters: (grey: T, omit: T) => boolean,
  current: ExcludedDisplay,
): Promise<{ value: T } | null> {
  const omit = await build(undefined);
  const grey = await build(withExcludedGhosts);
  if (!matters(grey, omit)) return { value: omit };
  const mode = await askExcludedRows(current);
  if (mode === null) return null;
  return { value: mode === "grey" ? grey : omit };
}

/** `matters` for a whole page: does any panel carry greyed rows? */
export function pageExcludedChoiceMatters(grey: FigurePageSpec | null, omit: FigurePageSpec | null): boolean {
  if (!grey || !omit || grey.panels.length !== omit.panels.length) return false;
  return grey.panels.some((p, i) => excludedChoiceMatters(p.figure, omit.panels[i].figure));
}
