// "Export worksheet…" — the worksheet (or the selected sheets / rows) as CSV,
// TSV or Excel, with Long Name and Units header rows (worksheet audit #8).
// Lazily imported on click from the File menu command and the worksheet
// toolbar, so neither the dialog wiring nor the table layout costs the eager
// bundle anything. The cells come from `worksheet/worksheetTable.ts` — the
// plan ⧉ Copy uses too — and the file is written by io/table_export.py.

import { askParams } from "../components/overlays/ParamDialog";
import { stemFromName, type StoreGet } from "../lib/exportActive";
import { exportWorksheetTable, type WorksheetExportFormat } from "../lib/api/worksheetExport";
import { excludedSet } from "../lib/rowstate";
import type { Dataset } from "../lib/types";
import { textColumnRowCount, worksheetTextColumns } from "../components/Stage/worksheet/textColumns";
import { worksheetTableWire } from "../components/Stage/worksheet/worksheetTable";
import { toast } from "../store/toasts";

const FORMATS: Record<string, WorksheetExportFormat> = {
  "CSV (comma-separated)": "csv",
  "TSV (tab-separated)": "tsv",
  "Excel workbook (.xlsx)": "xlsx",
};

export interface WorksheetExportScope {
  /** The sheets to export; default: the Library selection, else the active one. */
  ids?: string[];
  /** Source rows of a single sheet (the worksheet's row selection); default all. */
  rows?: number[];
}

function allRows(ds: Dataset): number[] {
  const n = Math.max(ds.data.time.length, textColumnRowCount(worksheetTextColumns(ds.data, ds.pending)));
  return Array.from({ length: n }, (_, i) => i);
}

function targets(s: StoreGet, scope: WorksheetExportScope): string[] {
  if (scope.ids?.length) return scope.ids;
  const st = s();
  const selected = st.selectedIds.filter((id) => st.datasets.some((d) => d.id === id));
  return selected.length > 0 ? selected : st.activeId ? [st.activeId] : [];
}

export async function runExportWorksheet(s: StoreGet, scope: WorksheetExportScope = {}): Promise<void> {
  const ids = targets(s, scope);
  if (ids.length === 0) {
    s().setStatus("no worksheet to export");
    toast("no worksheet to export", "danger");
    return;
  }
  const several = ids.length > 1;
  const what = several ? "the selected worksheets" : scope.rows?.length ? `the ${scope.rows.length} selected rows` : "every row";
  const answer = await askParams(
    several ? `Export ${ids.length} worksheets` : "Export worksheet",
    [
      { key: "format", label: "Format", type: "select", default: "CSV (comma-separated)", options: Object.keys(FORMATS),
        hint: several ? "Excel puts every worksheet on its own tab; CSV and TSV write one file each." : undefined },
      { key: "header", label: "Long Name and Units rows", type: "boolean", default: true },
      { key: "skipMasked", label: "Leave out masked rows", type: "boolean", default: false },
      { key: "skipDisregard", label: "Leave out Disregard columns", type: "boolean", default: false },
    ],
    { confirmLabel: "Export", message: `Writes ${what}, every column in place (text columns included).` },
  );
  if (!answer) return;
  const fmt = FORMATS[String(answer.format)] ?? "csv";
  const header = answer.header === true;
  try {
    const sheets = [];
    for (const id of ids) {
      const ds = await s().resolveDataset(id);
      if (!ds) continue;
      const masked = answer.skipMasked === true ? excludedSet(ds) : new Set<number>();
      const rows = (scope.rows?.length && !several ? scope.rows : allRows(ds)).filter((r) => !masked.has(r));
      // A spreadsheet's own sheet name ("Run2") over the dataset's ("run.xlsx:Run2").
      const sheet = ds.data.metadata?.sheet_name;
      const name = typeof sheet === "string" && sheet ? sheet : stemFromName(ds.name);
      sheets.push({ name, columns: worksheetTableWire(ds, rows, answer.skipDisregard === true) });
    }
    if (sheets.length === 0) throw new Error("the worksheets are no longer loaded");
    if (fmt === "xlsx") {
      await exportWorksheetTable({ sheets, fmt, header, filename: several ? "worksheets" : sheets[0].name });
    } else {
      for (const sheet of sheets) {
        await exportWorksheetTable({ sheets: [sheet], fmt, header, filename: sheet.name });
      }
    }
    const what = sheets.length === 1 ? `"${sheets[0].name}"` : `${sheets.length} worksheets`;
    const msg = `exported ${what} as ${fmt.toUpperCase()}`;
    s().setStatus(msg);
    toast(msg, "ok");
  } catch (e) {
    const msg = `worksheet export failed: ${e instanceof Error ? e.message : "unknown error"}`;
    s().setStatus(msg);
    toast(msg, "danger");
  }
}
