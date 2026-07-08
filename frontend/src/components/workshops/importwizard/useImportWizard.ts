// Import wizard (ORIGIN_GAP_PLAN #40) — state hook. Reads a picked file's text
// client-side (never uploaded until Import), asks the backend to guess starting
// settings, then re-previews (debounced) on every settings edit — delimiter,
// header/units/data-start lines, and per-column name/unit/role. "Import" parses
// the full text and lands the result via addDataset, matching the filename.
// "Save as filter…" persists the current settings server-side (io.import_filters)
// so a returning file of the same shape imports with zero dialogs; the filter
// picker at the top re-applies one of those saved settings to re-preview.

import { useEffect, useMemo, useState } from "react";

import {
  importGuess,
  importParse,
  importPreview,
  listImportFilters,
  saveImportFilter,
  deleteImportFilter,
} from "../../../lib/api";
import {
  withColumnName,
  withColumnUnit,
  withRole,
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

const PREVIEW_ROWS = 30;
const DEBOUNCE_MS = 300;

let _seq = 0;

export interface ImportWizardState {
  file: File | null;
  settings: ImportSettingsWire | null;
  preview: ImportPreviewResponse | null;
  filters: ImportFilterWire[];
  filtersBusy: boolean;
  busy: boolean; // guess/preview round-trip in flight
  importing: boolean;
  error: string | null;
  imported: boolean; // one-shot success flag (view shows a done state)
  pickFile: (f: File) => Promise<void>;
  patchSettings: (patch: Partial<ImportSettingsWire>) => void;
  setColumnRole: (index: number, role: ImportColumnRole) => void;
  setColumnName: (index: number, name: string) => void;
  setColumnUnit: (index: number, unit: string) => void;
  applyFilter: (name: string) => void;
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
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);

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

  function applyFilter(name: string): void {
    const filt = filters.find((f) => f.name === name);
    if (!filt) return;
    setImported(false);
    setColumns([]); // the applied filter's settings may not match the current columns at all
    setSettings({ ...filt.settings });
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
      addDataset({ id, name: file.name, data });
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
    busy,
    importing,
    error,
    imported,
    pickFile,
    patchSettings,
    setColumnRole,
    setColumnName,
    setColumnUnit,
    applyFilter,
    saveAsFilter,
    removeFilter,
    doImport,
    reset,
  };
}
