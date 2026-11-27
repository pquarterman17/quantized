// "Mirror column…": pick a source worksheet, then one of its numeric columns,
// and mirror it into a worksheet (store/mirrorColumn.ts, one undo step). The
// two asks go through the shared parameter dialog (store/paramDialog.ts).
// Loaded lazily from the worksheet's menus and the command palette.

import { mirrorSourceColumns } from "../lib/mirrorColumn";
import { onLoadFailure, runLazy } from "../lib/runLazy";
import { askParams } from "./paramDialog";
import { useApp } from "./useApp";

/** Pick a source worksheet, then one of its numeric columns, and mirror it
 *  into worksheet `id` (one undo step). Text columns are not offered: they
 *  have no letter for `sheet()` to name. */
export async function mirrorColumnDialog(id: string): Promise<void> {
  const others = useApp.getState().datasets.filter((d) => d.id !== id && !d.pending);
  if (others.length === 0) return void useApp.getState().setStatus("a mirror needs another worksheet that is fully loaded", "danger");
  const names = others.map((d) => d.name);
  const first = await askParams(
    "Mirror column — worksheet",
    [{ key: "sheet", label: "Source worksheet", type: "select", options: names, default: names[0] }],
    { confirmLabel: "Next", message: "A mirror column shows another worksheet's column, row for row, and follows it when it changes." },
  );
  if (!first) return;
  const src = others[Math.max(0, names.indexOf(String(first.sheet)))];
  const cols = mirrorSourceColumns(src);
  const options = cols.map((c) => `${c.letter === "x" ? "X" : c.letter} — ${c.label}${c.unit ? ` [${c.unit}]` : ""}`);
  const second = await askParams(
    `Mirror column — ${src.name}`,
    [{ key: "col", label: "Column to mirror", type: "select", options, default: options[Math.min(1, options.length - 1)] }],
    { confirmLabel: "Mirror", message: "Edit it at the source, or Detach it to make ordinary values. Sorting either worksheet is refused while the link holds." },
  );
  if (!second) return;
  const pick = cols[Math.max(0, options.indexOf(String(second.col)))];
  const m = await runLazy("Loading mirror columns…", () => import("./mirrorColumn")).catch(onLoadFailure);
  m?.createMirror(id, src.id, pick.col);
}
