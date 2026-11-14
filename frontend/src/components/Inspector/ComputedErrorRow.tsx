// Error columns card — "Computed" row (origin gap audit 2 #14): error bars
// from a rule rather than an existing column. Each choice adds a linked
// formula column and binds it as the series' symmetric Y error, so it draws,
// weights a fit and exports like any bound error column
// (store/computedErrorRun.ts, loaded on click).

import { useState } from "react";

import type { ErrorSource } from "../../store/computedErrorRun";
import { useApp } from "../../store/useApp";
import { Button, Select } from "../primitives";
import { NumberField } from "../primitives/NumberField";

const SOURCES: { value: ErrorSource; label: string }[] = [
  { value: "sqrt", label: "√Y" },
  { value: "percent", label: "% of Y" },
  { value: "constant", label: "constant" },
];

export default function ComputedErrorRow({ datasetId, labels, series }: {
  datasetId: string;
  labels: readonly string[];
  /** The plotted series (channel indices) a computed error can describe. */
  series: readonly number[];
}) {
  const setStatus = useApp((s) => s.setStatus);
  const [target, setTarget] = useState<number | null>(null);
  const [source, setSource] = useState<ErrorSource>("sqrt");
  const [param, setParam] = useState("5");
  const [busy, setBusy] = useState(false);
  const choices = series.length ? series : labels.map((_, i) => i);
  const t = target !== null && choices.includes(target) ? target : choices[0];
  if (t === undefined) return null;

  const add = async () => {
    setBusy(true);
    try {
      const { addComputedError } = await import("../../store/computedErrorRun");
      await addComputedError(datasetId, t, source, Number(param));
    } catch (e) {
      setStatus(`Can't add the error column: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div className="qzk-ds-meta qzk-msg" style={{ color: "var(--text-faint)" }}>
        Computed error (a linked column, bound as ± y error)
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 2 }}>
        <Select
          style={{ flex: "1.2 1 0", minWidth: 0 }}
          aria-label="Computed error series"
          value={String(t)}
          onChange={(e) => setTarget(Number(e.target.value))}
          options={choices.map((c) => ({ value: String(c), label: labels[c] ?? `ch ${c}` }))}
        />
        <Select
          style={{ flex: "1 1 0", minWidth: 0 }}
          aria-label="Computed error source"
          value={source}
          onChange={(e) => setSource(e.target.value as ErrorSource)}
          options={SOURCES}
          title="√Y: counting statistics (Y below 1 counts as 1, so no point gets zero error)"
        />
        {source !== "sqrt" && (
          <NumberField
            aria-label={source === "percent" ? "Percent of Y" : "Constant error"}
            value={param}
            onChange={setParam}
            width={52}
          />
        )}
        <Button size="sm" disabled={busy} onClick={() => void add()} aria-label="Add computed error" title="Add the error column and bind it">
          Add
        </Button>
      </div>
    </div>
  );
}
