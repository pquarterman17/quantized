// "Manage presets…" under the preset bar: Export this tool's presets or every
// tool's to a JSON file, and Import a preset file (plans/PRESET_BAR_CONTRACT.md
// slice P5; the rules are in lib/presetFile.ts). Lazy: mounted only after the
// user opens it. Import validates every preset through its adapter and reports
// the counts; a malformed file imports nothing.

import { useRef, useState } from "react";

import { saveBlob } from "../../../lib/download";
import { describeImport, exportPresets, importPresetFile } from "../../../lib/presetFile";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import { loadPresetAdapters } from "./presetRegistry";

export default function PresetManager({ workshop, label, onChanged, onClose }: { workshop: string; label: string; onChanged: () => void; onClose: () => void }) {
  const [report, setReport] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const setAppStatus = useApp((s) => s.setStatus);
  const say = (text: string, bad = false) => {
    setReport({ text, bad });
    setAppStatus(text);
  };

  async function doExport(all: boolean): Promise<void> {
    setBusy(true);
    try {
      const out = exportPresets(await loadPresetAdapters(all ? undefined : [workshop]), all ? null : workshop);
      if (!out.ok) return say(`Nothing was exported: ${out.reason}`, true);
      saveBlob(new Blob([out.text], { type: "application/json" }), all ? "quantized-presets.json" : `quantized-presets-${workshop}.json`);
      const skipped = out.skipped.length ? `; ${out.skipped.length} not exported (${out.skipped.map((s) => `'${s.name}': ${s.reason}`).join("; ")})` : "";
      say(`Exported ${out.exported} preset${out.exported === 1 ? "" : "s"}${skipped}`);
    } catch (e) {
      say(`Nothing was exported: ${e instanceof Error ? e.message : "unexpected error"}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function doImport(file: File): Promise<void> {
    setBusy(true);
    try {
      const out = await importPresetFile(await file.text(), loadPresetAdapters);
      say(describeImport(out), !out.ok);
      if (out.ok) onChanged();
    } catch (e) {
      say(`Nothing was imported: ${e instanceof Error ? e.message : "the file could not be read"}`, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Manage presets" style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <Button size="sm" disabled={busy} onClick={() => void doExport(false)} title={`Save every ${label} preset to a file (settings only, no datasets)`}>Export {label} presets</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void doExport(true)} title="Save the presets of every tool to one file">Export all presets</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()} title="Add the presets in a file; a clashing name gets (imported) and nothing is overwritten">Import presets…</Button>
      <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        aria-label="Preset file"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void doImport(f);
        }}
      />
      {report && <div className="qzk-helptext" role="status" style={{ flexBasis: "100%", color: report.bad ? "var(--danger)" : undefined }}>{report.text}</div>}
    </div>
  );
}
