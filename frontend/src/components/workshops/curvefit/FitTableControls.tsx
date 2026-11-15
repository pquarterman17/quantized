// Curve Fit — "Results table on graph" (Origin's NLFit parameter table on the
// graph; single, global and batch fits all use it). Adds a graph TABLE layer
// (store/graphLayerEdit.ts, one undo step) whose cells come from
// lib/fitTableLayer.ts, so the screen and the vector export draw the same text.
//
// The layer is a SNAPSHOT: it holds text, not a link to the fit. After a
// re-fit, "Update table" rewrites the table this control added (still on the
// graph) as one undo step; Add always makes a new one. Lazy chunk.

import { useState } from "react";

import { DEFAULT_WANT, fitTableLayer, fitToCaps, TABLE_LIMIT, type FitTableWant } from "../../../lib/fitTableLayer";
import { addLayer, nextLayerId, patchLayer } from "../../../store/graphLayerEdit";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";

// The table this control last added, per fit source, so "Update table" finds
// it again after the panel re-renders or reopens (a deleted layer is simply
// no longer found).
const lastLayer = new Map<string, string>();

interface Props {
  /** Identifies what the table is of (kind + dataset), for "Update table". */
  sourceKey: string;
  /** The table cells for the chosen statistics. */
  build: (want: FitTableWant) => string[][];
  /** Offer the χ² / N rows (a batch table has neither). */
  stats?: readonly (keyof FitTableWant)[];
}

const LABEL: Record<keyof FitTableWant, string> = { r2: "R²", chiSqRed: "χ² (reduced)", chiSq: "χ² (sum of squares)", n: "Point count" };

export default function FitTableControls({ sourceKey, build, stats = ["r2", "chiSqRed", "chiSq", "n"] }: Props) {
  const setStatus = useApp((s) => s.setStatus);
  const layers = useApp((s) => s.layers);
  const [want, setWant] = useState<FitTableWant>(DEFAULT_WANT);
  // A layer deleted since is no longer found.
  const prior = lastLayer.get(sourceKey);
  const existing = prior !== undefined && layers.some((l) => l.id === prior && l.kind === "table");

  const cells = () => {
    const { rows, cut } = fitToCaps(build(want));
    return { rows, note: cut ? ` (cut to ${TABLE_LIMIT})` : "" };
  };
  const add = () => {
    const { rows, note } = cells();
    const id = nextLayerId();
    if (addLayer(fitTableLayer(id, rows))) {
      lastLayer.set(sourceKey, id);
      setStatus(`added a results table to the graph${note} (Undo removes). It is a snapshot: a new fit needs Update table.`);
    }
  };
  const update = () => {
    if (!prior) return;
    const { rows, note } = cells();
    patchLayer(prior, { rows }, "update fit results table");
    setStatus(`updated the results table on the graph${note}`);
  };

  return (
    <details style={{ marginTop: 10 }}>
      <summary className="qzk-field-lbl">Results table on graph</summary>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {stats.map((k) => (
            <Checkbox key={k} checked={want[k]} onChange={(v) => setWant((w) => ({ ...w, [k]: v }))}>{LABEL[k]}</Checkbox>
          ))}
        </div>
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", whiteSpace: "normal" }}>
          Parameters ± errors go in a table on the current graph (move or resize it there). It is a snapshot of this fit:
          re-running the fit does not change it, so press Update table afterwards.
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" onClick={add}>Add results table to graph</Button>
          {existing && <Button size="sm" onClick={update} title="Rewrite the table this panel added, from the current fit">Update table</Button>}
        </div>
      </div>
    </details>
  );
}
