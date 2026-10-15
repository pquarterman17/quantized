import { useMemo, useRef, useState } from "react";

import { xChannelIdentity } from "../../../lib/peakTableFit";
import { wavelengthFromMetadata } from "../../../lib/xrdWavelength";
import {
  convertReferencePattern,
  MAX_REFERENCE_FILE_BYTES,
  parseReferencePatternText,
  type ParsedReferencePattern,
  type ReferenceAxisMode,
  type ReferenceReflection,
} from "../../../lib/xrdReferencePattern";
import { nextPlotObjectId } from "../../../store/idSeq";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import { NumberField } from "../../primitives/NumberField";
import { pawleyAxisProblem, scanRange } from "./pawleyInputs";

interface EditableReflection extends ReferenceReflection { included: boolean }

const hint = { marginTop: 8, color: "var(--text-faint)" } as const;

function optionalPositive(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 10 ? number : null;
}

export default function ReferencePatternSection() {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const recordHistory = useApp((s) => s.recordHistory);
  const setStatus = useApp((s) => s.setStatus);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  const readToken = useRef(0);
  const commitLocked = useRef(false);
  const [pattern, setPattern] = useState<ParsedReferencePattern | null>(null);
  const [rows, setRows] = useState<EditableReflection[]>([]);
  const [name, setName] = useState("");
  const [sourceWavelength, setSourceWavelength] = useState("");
  const [axisMode, setAxisMode] = useState<ReferenceAxisMode>("auto");
  const [baseline, setBaseline] = useState("0.03");
  const [height, setHeight] = useState("0.18");
  const [color, setColor] = useState("#d97706");
  const [showLabels, setShowLabels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const xIdentity = active ? xChannelIdentity(active.data, null) : null;
  const finiteX = active?.data.time.filter(Number.isFinite) ?? [];
  const range = finiteX.length ? scanRange(finiteX) : null;
  const axisProblem = active && xIdentity
    ? xKey !== null
      ? "Use the dataset's 2θ time axis (not a worksheet column) before adding a reference pattern."
      : pawleyAxisProblem(xIdentity, active.data.metadata, range)
    : "Select a powder XRD dataset first.";
  const targetWavelength = wavelengthFromMetadata(active?.data.metadata);
  const source = optionalPositive(sourceWavelength);
  const sourceProblem = sourceWavelength.trim() && source == null
    ? "Source wavelength must be positive and at most 10 Å."
    : null;
  const geometryProblem = (() => {
    const b = Number(baseline);
    const h = Number(height);
    if (!Number.isFinite(b) || b < 0 || b >= 1) return "Offset must be from 0 to less than 1.";
    if (!Number.isFinite(h) || h <= 0 || b + h > 1) return "Height must be positive and fit above the offset.";
    return null;
  })();
  const selected = rows.filter((row) => row.included);
  const converted = useMemo(
    () => convertReferencePattern(selected, source, targetWavelength),
    [selected, source, targetWavelength],
  );
  const canAdd = pattern != null && !axisProblem && !geometryProblem && !sourceProblem && converted.reflections.length > 0;

  async function openFile(file: File, mode: ReferenceAxisMode = axisMode): Promise<void> {
    lastFileRef.current = file;
    const token = ++readToken.current;
    setBusy(true);
    setError(null);
    try {
      if (file.size > MAX_REFERENCE_FILE_BYTES) throw new Error("Reference file is larger than 2 MiB.");
      const parsed = parseReferencePatternText(await file.text(), file.name, mode);
      if (token !== readToken.current) return;
      commitLocked.current = false;
      setPattern(parsed);
      setRows(parsed.reflections.map((row) => ({ ...row, included: true })));
      setName(parsed.name);
      setSourceWavelength(parsed.sourceWavelengthA == null ? "" : String(parsed.sourceWavelengthA));
    } catch (reason) {
      if (token !== readToken.current) return;
      setPattern(null);
      setRows([]);
      setError(reason instanceof Error ? reason.message : "Could not read the reference pattern.");
    } finally {
      if (token === readToken.current) setBusy(false);
    }
  }

  function addPattern(): void {
    if (!canAdd || !active || !pattern || commitLocked.current) return;
    commitLocked.current = true;
    const b = Number(baseline);
    const h = Number(height);
    const groupId = nextPlotObjectId("reference-pattern");
    const sourceName = name.trim() || pattern.name;
    const wavelengthLabel = source != null
      ? targetWavelength != null && Math.abs(source - targetWavelength) >= 1e-9
        ? ` · λ ${source.toFixed(5)}→${targetWavelength.toFixed(5)} Å`
        : ` · λ ${source.toFixed(5)} Å`
      : " · λ unknown";
    // Group label is durable, human-readable scientific provenance. Keeping
    // it once per pattern avoids repeating identical source metadata on every
    // one of as many as 2,000 stick objects.
    const groupLabel = `${sourceName}${wavelengthLabel}`;
    recordHistory("add XRD reference pattern");
    useApp.setState((state) => ({
      refLines: [...state.refLines, ...converted.reflections.map((row, index) => {
        return {
          id: nextPlotObjectId("ref"),
          axis: "x" as const,
          value: row.twoTheta,
          label: row.label,
          groupId,
          ...(index === 0 ? { groupLabel } : {}),
          stick: {
            intensity: row.intensity,
            baseline: b,
            height: h,
            color,
            visible: true,
            showLabel: showLabels,
          },
        };
      })],
    }));
    const conversion = converted.converted ? `, converted to ${targetWavelength?.toFixed(5)} Å` : "";
    const dropped = converted.dropped ? `; ${converted.dropped} impossible reflection${converted.dropped === 1 ? "" : "s"} omitted` : "";
    setStatus(`added ${converted.reflections.length} reference stick${converted.reflections.length === 1 ? "" : "s"}${conversion}${dropped}`);
    // Close the preview after a successful commit. Apart from keeping the
    // workshop uncluttered, this is the repeated-click guard: a double-click
    // cannot append the same pattern twice before React disables the button.
    setPattern(null);
    setRows([]);
    lastFileRef.current = null;
  }

  const wavelengthWarning = pattern && source == null
    ? "No source wavelength is recorded. Positions will be used as supplied."
    : pattern && targetWavelength == null
      ? "The active dataset has no wavelength metadata. Positions will be used as supplied."
      : null;

  return (
    <div style={{ marginTop: 10 }}>
      <div className="qzk-ds-meta" style={hint}>
        Import a trusted 2θ/intensity stick pattern (CSV, TSV, XY, or text). Raw data are not changed.
      </div>
      <label className="qzk-field-lbl" style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <input type="checkbox" checked={axisMode === "two-theta"} onChange={(e) => {
          const mode = e.target.checked ? "two-theta" : "auto";
          setAxisMode(mode);
          if (lastFileRef.current) void openFile(lastFileRef.current, mode);
        }} />
        Treat first column as 2θ when its header is unknown
      </label>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt,.xy,.dat"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void openFile(file);
        }}
      />
      <Button size="sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? "Reading…" : "Choose reference file…"}
      </Button>
      {axisProblem && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--warning, #d97706)" }}>{axisProblem}</div>}
      {error && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--danger)" }}>{error}</div>}

      {pattern && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 10px", alignItems: "center", marginTop: 10 }}>
            <label className="qzk-field-lbl">Pattern name</label>
            <input className="qz-input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            <label className="qzk-field-lbl">Source λ (Å)</label>
            <NumberField value={sourceWavelength} onChange={setSourceWavelength} width={90} placeholder="unknown" />
            <label className="qzk-field-lbl">Vertical offset</label>
            <NumberField value={baseline} onChange={setBaseline} width={90} step={0.01} />
            <label className="qzk-field-lbl">Maximum height</label>
            <NumberField value={height} onChange={setHeight} width={90} step={0.01} />
            <label className="qzk-field-lbl">Color</label>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Reference pattern color" />
          </div>
          <label className="qzk-field-lbl" style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
            Show reflection labels
          </label>
          <div className="qzk-ds-meta" style={hint}>
            Target wavelength: {targetWavelength == null ? "unknown" : `${targetWavelength.toFixed(5)} Å`}
            {converted.converted ? ` · ${converted.reflections.length} positions will be converted` : ""}
          </div>
          {wavelengthWarning && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--warning, #d97706)" }}>{wavelengthWarning}</div>}
          {converted.dropped > 0 && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--warning, #d97706)" }}>
            {converted.dropped} reflection{converted.dropped === 1 ? " is" : "s are"} impossible at the target wavelength and will be omitted.
          </div>}
          {sourceProblem && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--danger)" }}>{sourceProblem}</div>}
          {pattern.warnings.map((warning) => <div key={warning} className="qzk-ds-meta" style={hint}>{warning}</div>)}
          {geometryProblem && <div className="qzk-ds-meta" style={{ ...hint, color: "var(--danger)" }}>{geometryProblem}</div>}

          <div style={{ maxHeight: 220, overflow: "auto", marginTop: 10, border: "1px solid var(--border-subtle)" }}>
            <table className="qz-data-table" style={{ width: "100%" }}>
              <thead><tr><th>Use</th><th>2θ</th><th>Rel. I</th><th>Label</th></tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.twoTheta}-${index}`}>
                    <td><input type="checkbox" checked={row.included} aria-label={`Include ${row.twoTheta} degrees`} onChange={(e) => setRows((current) => current.map((item, i) => i === index ? { ...item, included: e.target.checked } : item))} /></td>
                    <td>{row.twoTheta.toFixed(4)}</td>
                    <td>{row.intensity.toFixed(3)}</td>
                    <td><input className="qz-input" value={row.label} maxLength={80} aria-label={`Label at ${row.twoTheta} degrees`} onChange={(e) => setRows((current) => current.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="primary" size="sm" style={{ marginTop: 10 }} disabled={!canAdd} onClick={addPattern}>
            Add {converted.reflections.length || ""} reference sticks
          </Button>
        </>
      )}
    </div>
  );
}
