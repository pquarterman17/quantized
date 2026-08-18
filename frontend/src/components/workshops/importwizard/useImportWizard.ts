// Import wizard (ORIGIN_GAP_PLAN #40) — state hook. Reads a picked file's text
// client-side (never uploaded until Import), asks the backend to guess starting
// settings, then re-previews (debounced) on every settings edit — delimiter,
// header/units/data-start lines, and per-column name/unit/role. "Import" parses
// the full text and lands the result via addDataset, matching the filename.
// "Save as filter…" persists the current settings server-side (io.import_filters)
// so a returning file of the same shape imports with zero dialogs; the filter
// picker at the top re-applies one of those saved settings to re-preview.

import { useEffect, useMemo, useState } from "react";

import type { ErrorBinding } from "../../../lib/errorRoles";
import {
  importGuess,
  importParse,
  importPreview,
  listImportFilters,
  saveImportFilter,
  deleteImportFilter,
} from "../../../lib/api";
import {
  confirmedErrorBindings,
  resolveImportFilter,
  withColumnName,
  withColumnUnit,
  withRole,
  type WizardErrorRow,
} from "../../../lib/importwizard";
import type {
  ImportColumnRole,
  ImportFilterWire,
  ImportPreviewColumn,
  ImportPreviewResponse,
  ImportSettingsWire,
} from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useImportErrorRoles } from "./useImportErrorRoles";

const PREVIEW_ROWS = 30;
const DEBOUNCE_MS = 300;

let _seq = 0;

export interface ImportWizardState {
  file: File | null;
  settings: ImportSettingsWire | null;
  preview: ImportPreviewResponse | null;
  filters: ImportFilterWire[];
  filtersBusy: boolean;
  filterApplying: boolean;
  busy: boolean; // guess/preview round-trip in flight
  importing: boolean;
  error: string | null;
  imported: boolean; // one-shot success flag (view shows a done state)
  /** P1.6 item 2: one row per `error`-role column, editable target/axis/side. */
  errorRows: WizardErrorRow[];
  pickFile: (f: File) => Promise<void>;
  patchSettings: (patch: Partial<ImportSettingsWire>) => void;
  setColumnRole: (index: number, role: ImportColumnRole) => void;
  setColumnName: (index: number, name: string) => void;
  setColumnUnit: (index: number, unit: string) => void;
  setErrorTarget: (channel: number, target: number | null) => void;
  setErrorAxis: (channel: number, axis: "x" | "y") => void;
  setErrorSide: (channel: number, side: ErrorBinding["side"]) => void;
  applyFilter: (name: string) => Promise<void>;
  saveAsFilter: (name: string, glob: string) => Promise<void>;
  removeFilter: (name: string) => Promise<void>;
  doImport: () => Promise<void>;
  reset: () => void;
}

export function useImportWizard(): ImportWizardState {
  const addDataset = useApp((s) => s.addDataset);
  const pushRecent = useApp((s) => s.pushRecent);
  const setStatus = useApp((s) => s.setStatus);

  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState<string>("");
  const [settings, setSettings] = useState<ImportSettingsWire | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  // Optimistic per-column overlay: name/role edits update this immediately so
  // a second edit made before the debounced re-preview round-trips composes
  // on top of the FIRST edit instead of a stale server snapshot (`preview`
  // only refreshes every DEBOUNCE_MS). Resynced to the server truth whenever
  // a fresh preview lands (columns is `[]` until a preview response arrives).
  const [columns, setColumns] = useState<ImportPreviewColumn[]>([]);
  const [filters, setFilters] = useState<ImportFilterWire[]>([]);
  const [filtersBusy, setFiltersBusy] = useState(false);
  const [filterApplying, setFilterApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const { errorRows, setErrorTarget, setErrorAxis, setErrorSide, resetErrorRows } =
    useImportErrorRoles(columns);

  async function refreshFilters(): Promise<void> {
    setFiltersBusy(true);
    try {
      setFilters(await listImportFilters());
    } catch {
      // the filter picker is a convenience — a load failure just leaves it empty
    } finally {
      setFiltersBusy(false);
    }
  }

  useEffect(() => {
    void refreshFilters();
  }, []);

  // Re-preview (debounced) whenever the text or the settings change.
  useEffect(() => {
    if (!text || !settings) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      importPreview(text, settings, PREVIEW_ROWS)
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          setColumns(p.columns); // resync the optimistic overlay to the confirmed state
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "preview failed");
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, settings]);

  async function pickFile(f: File): Promise<void> {
    setError(null);
    setPreview(null);
    setColumns([]);
    setImported(false);
    setFile(f);
    setBusy(true);
    try {
      const t = await f.text();
      setText(t);
      setSettings(await importGuess(t));
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn't read file");
      setBusy(false);
    }
  }

  function patchSettings(patch: Partial<ImportSettingsWire>): void {
    setImported(false);
    setSettings((s) => (s ? { ...s, ...patch } : s));
  }

  function setColumnRole(index: number, role: ImportColumnRole): void {
    if (!settings || !columns.length) return;
    setColumns((cs) => cs.map((c, i) => (i === index ? { ...c, role } : c)));
    patchSettings({ roles: withRole(columns, index, role) });
  }

  function setColumnName(index: number, name: string): void {
    if (!settings || !columns.length) return;
    setColumns((cs) => cs.map((c, i) => (i === index ? { ...c, name } : c)));
    patchSettings({ column_names: withColumnName(columns, index, name) });
  }

  function setColumnUnit(index: number, unit: string): void {
    if (!settings || !columns.length) return;
    setColumns((cs) => cs.map((c, i) => (i === index ? { ...c, unit } : c)));
    patchSettings({ column_names: withColumnUnit(columns, index, unit) });
  }

  // P1.6 item 4: refusal-with-explanation on mismatch — mirrors the
  // H-template semantics (quickPlotTemplates.resolveTemplate): re-preview
  // the CURRENT file under the CANDIDATE filter's settings, resolve the
  // saved column shape AND line positions against what that produces (plus
  // an INDEPENDENT guess of where this file's data actually starts, review
  // round P1-2 — a saved header/units/label line landing at-or-past that
  // point means it's reading a DIFFERENT file's layout onto this one), and
  // refuse the WHOLE apply (current settings/preview untouched) rather than
  // silently clobbering with a filter that no longer fits — never a partial
  // apply.
  async function applyFilter(name: string): Promise<void> {
    const filt = filters.find((f) => f.name === name);
    if (!filt || !text) return;
    setFilterApplying(true);
    try {
      const [fresh, naturalGuess] = await Promise.all([
        importPreview(text, filt.settings, PREVIEW_ROWS),
        importGuess(text),
      ]);
      const resolution = resolveImportFilter(filt, fresh, naturalGuess.data_start_line);
      if (!resolution.ok) {
        toast(`can't apply filter "${filt.name}": ${resolution.reason}`, "danger");
        return;
      }
      setImported(false);
      setSettings({ ...filt.settings });
      setPreview(fresh);
      setColumns(fresh.columns);
      setError(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "couldn't apply filter", "danger");
    } finally {
      setFilterApplying(false);
    }
  }

  async function saveAsFilter(name: string, glob: string): Promise<void> {
    if (!settings) return;
    setError(null);
    try {
      const saved = await saveImportFilter(name, glob, settings);
      setFilters((fs) => [...fs.filter((f) => f.name !== saved.name), saved]);
      toast(`saved filter "${saved.name}"`, "ok");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "save filter failed";
      setError(msg);
      toast(msg, "danger");
    }
  }

  async function removeFilter(name: string): Promise<void> {
    try {
      await deleteImportFilter(name);
      setFilters((fs) => fs.filter((f) => f.name !== name));
    } catch (e) {
      toast(e instanceof Error ? e.message : "delete filter failed", "danger");
    }
  }

  async function doImport(): Promise<void> {
    if (!file || !settings || !text) return;
    setImporting(true);
    setError(null);
    try {
      const data = await importParse(text, settings);
      const id = `impwiz-${++_seq}`;
      // P1.6 item 2: only EXPLICITLY assigned error rows (target !== null)
      // become Dataset.errorRoles — an unassigned suggestion contributes
      // nothing, so a column the user never confirmed a target for imports
      // as a plain, unbound channel rather than guessing one.
      const errorRoles = confirmedErrorBindings(errorRows);
      addDataset({ id, name: file.name, data, ...(errorRoles.length ? { errorRoles } : {}) });
      pushRecent(file.name, file.size);
      setStatus(`imported ${file.name} via Import wizard`);
      toast(`imported ${file.name}`, "ok");
      setImported(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "import failed";
      setError(msg);
      toast(msg, "danger");
    } finally {
      setImporting(false);
    }
  }

  function reset(): void {
    setFile(null);
    setText("");
    setSettings(null);
    setPreview(null);
    setColumns([]);
    setError(null);
    setImported(false);
    resetErrorRows();
  }

  // The view always renders `columns` (the optimistic overlay) as the column
  // headers, so an edit shows instantly instead of waiting DEBOUNCE_MS for the
  // server round-trip; `rows`/`raw_lines` still come from the last confirmed
  // preview (they only change once the server actually re-parses).
  const displayPreview = useMemo<ImportPreviewResponse | null>(
    () => (preview ? { ...preview, columns: columns.length ? columns : preview.columns } : null),
    [preview, columns],
  );

  return {
    file,
    settings,
    preview: displayPreview,
    filters,
    filtersBusy,
    filterApplying,
    busy,
    importing,
    error,
    imported,
    errorRows,
    pickFile,
    patchSettings,
    setColumnRole,
    setColumnName,
    setColumnUnit,
    setErrorTarget,
    setErrorAxis,
    setErrorSide,
    applyFilter,
    saveAsFilter,
    removeFilter,
    doImport,
    reset,
  };
}
