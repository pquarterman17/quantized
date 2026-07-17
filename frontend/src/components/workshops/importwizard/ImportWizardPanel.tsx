// Import wizard (ORIGIN_GAP_PLAN #40) — view. Pick a file -> guessed settings
// -> live preview (re-guessed on every edit, debounced) -> Import lands a new
// library dataset named after the file. "Save as filter…" persists the
// confirmed settings under a name + glob (io.import_filters) so a returning
// file of the same shape imports with zero dialogs next time; the picker at
// the top re-applies one of those saved settings. Thin — all state lives in
// useImportWizard; the raw-lines + resolved-columns grid is PreviewTable.

import { useRef, useState } from "react";

import { defaultFilterName, defaultGlob, DELIMITER_OPTIONS, parseLineField } from "../../../lib/importwizard";
import type { ImportColumnRole } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { askParams } from "../../overlays/ParamDialog";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, NumberField, Select } from "../../primitives";
import PreviewTable from "./PreviewTable";
import { useImportWizard } from "./useImportWizard";

export default function ImportWizardPanel() {
  const setOpen = useApp((s) => s.setImportWizardOpen);
  const w = useImportWizard();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickedFilter, setPickedFilter] = useState("");
  const faint = { color: "var(--text-faint)" } as const;

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
    ]);
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
              disabled={!w.file}
              onChange={(e) => {
                setPickedFilter(e.target.value);
                if (e.target.value) w.applyFilter(e.target.value);
              }}
            />
          </label>
          {pickedFilter && (
            <Button size="sm" variant="ghost" title="Delete this saved filter" onClick={() => void onRemoveFilter()}>
              delete
            </Button>
          )}
          <span className="qzk-ds-meta" style={faint}>
            {w.filtersBusy ? "loading…" : `${w.filters.length} saved`}
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
        <div className="qzk-ds-meta" style={faint}>
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
                onChange={(e) => w.patchSettings({ delimiter: e.target.value })}
              />
            </label>
            <label className="qzk-field">
              <span>Data start line</span>
              <NumberField
                value={w.settings?.data_start_line ?? 0}
                onChange={(v) => w.patchSettings({ data_start_line: parseLineField(v) ?? 0 })}
                width={56}
              />
            </label>
            <label className="qzk-field">
              <span>Header line</span>
              <NumberField
                value={w.settings?.header_line ?? ""}
                onChange={(v) => w.patchSettings({ header_line: parseLineField(v) })}
                placeholder="none"
                width={56}
              />
            </label>
            <label className="qzk-field">
              <span>Units line</span>
              <NumberField
                value={w.settings?.units_line ?? ""}
                onChange={(v) => w.patchSettings({ units_line: parseLineField(v) })}
                placeholder="none"
                width={56}
              />
            </label>
          </div>

          {w.error && (
            <div className="qzk-ds-meta" style={{ color: "var(--danger)", marginBottom: 8 }}>
              {w.error}
            </div>
          )}

          {w.busy && !w.preview && (
            <div className="qzk-ds-meta" style={faint}>
              Loading preview…
            </div>
          )}

          {w.preview && (
            <PreviewTable
              preview={w.preview}
              onRoleChange={(i, role: ImportColumnRole) => w.setColumnRole(i, role)}
              onNameChange={w.setColumnName}
              onUnitChange={w.setColumnUnit}
            />
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button
              variant="primary"
              size="sm"
              disabled={!w.preview || w.importing}
              onClick={() => void w.doImport()}
            >
              {w.importing ? "Importing…" : w.imported ? "Imported ✓ — import again" : "Import"}
            </Button>
            <Button size="sm" disabled={!w.settings} onClick={() => void onSaveAsFilter()}>
              Save as filter…
            </Button>
          </div>
        </>
      )}
    </ToolWindow>
  );
}
