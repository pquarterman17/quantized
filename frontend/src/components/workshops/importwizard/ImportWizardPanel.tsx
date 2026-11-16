// Import wizard (ORIGIN_GAP_PLAN #40 / P1.6) — view. Pick a file -> guessed
// settings -> live preview (re-guessed on every edit, debounced) -> Import
// lands a new library dataset named after the file, Cancel (the window's
// close control) leaves zero state behind (ImportWizardPanel only mounts
// while open, AppOverlayPanels.tsx). "Save as filter…" persists the confirmed
// settings under a name + glob (io.import_filters) so a returning file of the
// same shape imports with zero dialogs next time; the picker at the top
// re-applies one of those saved settings — REFUSING (P1.6 item 4) rather than
// partially applying one whose column shape no longer matches. Thin — all
// state lives in useImportWizard; the raw-lines + resolved-columns grid is
// PreviewTable, the error-role assignment table is ErrorRolesEditor.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  DECIMAL_OPTIONS,
  defaultFilterName,
  defaultGlob,
  DELIMITER_OPTIONS,
} from "../../../lib/importwizard";
import { highlightDelimiter, inWizard, countLines, rawLines, RAW_LINE_LIMIT } from "../../../lib/importRawLines";
import type { ImportDecimal } from "../../../lib/importTypes";
import type { ImportColumnRole } from "../../../lib/types";
import { useWizardHandoff } from "../../../lib/importFailureToast";
import { useApp } from "../../../store/useApp";
import { askParams } from "../../overlays/ParamDialog";
import { askConfirm } from "../../overlays/ConfirmDialog";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import ErrorRolesEditor from "./ErrorRolesEditor";
import ErrorBindingSuggestions from "./ErrorBindingSuggestions";
import MetadataPreview from "./MetadataPreview";
import CategoricalProblems from "./CategoricalProblems";
import LineField from "./LineField";
import PreviewTable from "./PreviewTable";
import RawLines, { NO_LINE_ROLES } from "./RawLines";
import { useImportWizard } from "./useImportWizard";

export default function ImportWizardPanel() {
  const setOpen = useApp((s) => s.setImportWizardOpen);
  const w = useImportWizard();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickedFilter, setPickedFilter] = useState("");
  const faint = { color: "var(--text-faint)" } as const;
  // The file's own lines, for when the preview request failed (UX audit 8 #7:
  // the wizard used to show only the error, exactly when the lines mattered).
  const { text } = w;
  const fallback = useMemo(() => {
    if (!text) return null;
    const lines = rawLines(text);
    return { lines, more: lines.length < RAW_LINE_LIMIT ? 0 : countLines(text) - lines.length };
  }, [text]);

  // Close automatically on a successful import — this is a one-shot action,
  // not a workspace to linger in, and ToolWindow's own close path (used by
  // Cancel/Escape/the X button, below) already restores focus to whatever
  // opened the wizard. A failed import leaves `w.imported` false, so the
  // panel stays open with `w.error` visible for the user to fix and retry.
  useEffect(() => {
    if (w.imported) setOpen(false);
  }, [w.imported, setOpen]);

  // A failed import's "Open import wizard" hands its file over: take it (clear
  // first, so a re-open does not replay it) and preview it as if just picked.
  const handedFile = useWizardHandoff((s) => s.file);
  // A wizard already holding a file has work in it (edited settings): ask first.
  const { pickFile, file: current } = w;
  useEffect(() => {
    if (!handedFile) return;
    useWizardHandoff.setState({ file: null });
    const take = () => {
      setPickedFilter("");
      void pickFile(handedFile);
    };
    if (!current) return take();
    void askConfirm("Replace the file in the wizard?", `The wizard has ${current.name} open; this would switch to ${handedFile.name} and drop its settings.`, "Replace").then((ok) => ok && take(), () => undefined);
  }, [handedFile, pickFile, current]);

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (f) {
      setPickedFilter("");
      void w.pickFile(f);
    }
  }

  async function onRemoveFilter(): Promise<void> {
    if (!pickedFilter) return;
    await w.removeFilter(pickedFilter);
    setPickedFilter("");
  }

  async function onSaveAsFilter(): Promise<void> {
    if (!w.file || !w.settings) return;
    const params = await askParams("Save as filter", [
      { key: "name", label: "Name", type: "text", default: defaultFilterName(w.file.name) },
      { key: "glob", label: "File glob", type: "text", default: defaultGlob(w.file.name) },
    ], { confirmLabel: "Save" });
    if (!params) return;
    const name = String(params.name).trim();
    const glob = String(params.glob).trim();
    if (!name || !glob) return;
    await w.saveAsFilter(name, glob);
  }

  return (
    <ToolWindow id="importwizard" title="Import wizard" width={640} onClose={() => setOpen(false)}>
      <input ref={inputRef} type="file" style={{ display: "none" }} onChange={onFileChosen} />

      {w.filters.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
          <label className="qzk-field">
            <span>Apply saved filter</span>
            <Select
              options={[
                { value: "", label: "—" },
                ...w.filters.map((f) => ({ value: f.name, label: f.name })),
              ]}
              value={pickedFilter}
              disabled={!w.file || w.filterApplying}
              onChange={(e) => {
                setPickedFilter(e.target.value);
                if (e.target.value) void w.applyFilter(e.target.value);
              }}
            />
          </label>
          {pickedFilter && (
            <Button size="sm" variant="ghost" title="Delete this saved filter" onClick={() => void onRemoveFilter()}>
              delete
            </Button>
          )}
          <span className="qzk-ds-meta" style={faint}>
            {w.filterApplying ? "applying…" : w.filtersBusy ? "loading…" : `${w.filters.length} saved`}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <Button size="sm" onClick={() => inputRef.current?.click()}>
          {w.file ? "Choose a different file…" : "Choose a file…"}
        </Button>
        {w.file && <span style={faint}>{w.file.name}</span>}
      </div>

      {!w.file ? (
        <div className="qzk-helptext" style={faint}>
          Pick a delimited text file to preview and import under adjustable settings — delimiter,
          header/units lines, and per-column name / unit / role.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <label className="qzk-field">
              <span>Delimiter</span>
              <Select
                options={DELIMITER_OPTIONS}
                value={w.settings?.delimiter ?? "auto"}
                // A new delimiter splits the lines into different columns, so the
                // per-column names and roles guessed under the old one no longer
                // line up: re-read them (as the Header line field does).
                onChange={(e) => w.patchSettings({ delimiter: e.target.value, column_names: null, roles: null })}
              />
            </label>
            <label className="qzk-field" title="Auto reads 1,5 as 1.5 unless a value like 1,500 is ambiguous.">
              <span>Decimal separator</span>
              <Select
                options={DECIMAL_OPTIONS}
                value={w.settings?.decimal ?? "auto"}
                onChange={(e) => w.patchSettings({ decimal: e.target.value as ImportDecimal })}
              />
            </label>
            <label className="qzk-field">
              <span>Data start line</span>
              {/* Every line field is 1-based, like the raw-lines gutter (LineField). */}
              <LineField
                value={w.settings?.data_start_line ?? 0}
                required
                onLine={(i) => i !== null && w.patchSettings({ data_start_line: i })}
              />
            </label>
            <label className="qzk-field" title="The row that names the columns (the Long Name row of an Origin ASCII export); choosing a row re-reads the column names from it">
              <span>Header line</span>
              {/* `column_names: null`: the guessed names were read from the OLD
                  header row and outrank `header_line` while set, so picking a
                  row by hand did nothing to the names. */}
              <LineField
                value={w.settings?.header_line}
                onLine={(i) => w.patchSettings({ header_line: i, column_names: null })}
              />
            </label>
            <label className="qzk-field" title="The row that gives each column's unit (the Units row of an Origin ASCII export); any other row above the data start, such as an Origin Comments row, is kept as a comment in the dataset's metadata">
              <span>Units line</span>
              <LineField value={w.settings?.units_line} onLine={(i) => w.patchSettings({ units_line: i })} />
            </label>
            <label className="qzk-field" title="Per-column cells that override the legend label (P1.6)">
              <span>Label line</span>
              <LineField value={w.settings?.label_line} onLine={(i) => w.patchSettings({ label_line: i })} />
            </label>
          </div>

          {w.error && (
            <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginBottom: 8 }}>
              {inWizard(w.error)}
            </div>
          )}

          {w.xConflict && (
            <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginBottom: 8 }}>
              {w.xConflict}
            </div>
          )}

          {w.busy && !w.preview && (
            <div className="qzk-ds-meta" style={faint}>
              Loading preview…
            </div>
          )}

          {/* Also when the guess itself failed (server down): no settings yet, so
              no line roles, but the lines are still the file's own. */}
          {!w.preview && fallback && (
            <RawLines
              lines={fallback.lines}
              roles={w.settings ?? NO_LINE_ROLES}
              delimiter={highlightDelimiter(null, w.settings?.delimiter, fallback.lines)}
              more={fallback.more}
            />
          )}

          {w.preview && (
            <PreviewTable
              preview={w.preview}
              onRoleChange={(i, role: ImportColumnRole) => w.setColumnRole(i, role)}
              onNameChange={w.setColumnName}
              onUnitChange={w.setColumnUnit}
            />
          )}

          {w.preview && <MetadataPreview preview={w.preview} />}

          {w.preview && (
            <CategoricalProblems
              problems={w.preview.categorical_problems ?? []}
              accepted={w.acceptedCategorical}
              onAccept={w.acceptLargeCategorical}
              onUnaccept={w.unacceptLargeCategorical}
            />
          )}

          {w.preview && (
            <ErrorBindingSuggestions
              columns={w.preview.columns}
              suggestions={w.preview.suggested_error_bindings ?? []}
              problems={w.preview.error_binding_problems ?? []}
              onApply={w.applyErrorSuggestion}
              onRemoveProblem={w.removeRejectedErrorBinding}
            />
          )}

          {w.preview && (
            <div style={{ marginTop: 10 }}>
              <ErrorRolesEditor
                rows={w.errorRows}
                columns={w.preview.columns}
                onTargetChange={w.setErrorTarget}
                onAxisChange={w.setErrorAxis}
                onSideChange={w.setErrorSide}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={!w.preview || w.importing || !!w.xConflict || w.categoricalBlocked}
              onClick={() => void w.doImport()}
            >
              {w.importing ? "Importing…" : "Import"}
            </Button>
            <Button size="sm" disabled={!w.settings} onClick={() => void onSaveAsFilter()}>
              Save as filter…
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ToolWindow>
  );
}
