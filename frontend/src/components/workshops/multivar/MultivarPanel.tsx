// Multivariate workbench (JMP_GAP J10) — view. A draggable ToolWindow: pick
// 2+ continuous columns, then switch between a correlation heatmap, a SPLOM,
// and PCA (scree/scores/loadings/biplot) over the SAME listwise-complete row
// set (useMultivar). Thin — fetching + shared row math live in the hook;
// each tab is its own sub-component.
//
// Residual (JMP_GAP_PLAN #10, item 6): matplotlib export parity for these
// views (a `figure_multivar` renderer) is explicitly NOT attempted here —
// only the "copy TSV" correlation-matrix export item 6 requires as a floor.

import { useState } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { SegmentedControl } from "../../primitives";
import { useMultivarStore } from "../../../store/multivar";
import ColumnPicker from "./ColumnPicker";
import CorrelationView from "./CorrelationView";
import PcaView from "./PcaView";
import SplomTabView from "./SplomTabView";
import { useMultivar } from "./useMultivar";

type Tab = "correlation" | "splom" | "pca";
const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: "correlation", label: "Correlation" },
  { value: "splom", label: "SPLOM" },
  { value: "pca", label: "PCA" },
];

export default function MultivarPanel() {
  const setOpen = useMultivarStore((s) => s.setOpen);
  const m = useMultivar();
  const [tab, setTab] = useState<Tab>("correlation");

  return (
    <ToolWindow id="multivar" title="Multivariate" width={480} onClose={() => setOpen(false)}>
      {!m.hasData ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          Select a dataset to explore.
        </div>
      ) : (
        <>
          <ColumnPicker m={m} />
          <div style={{ marginTop: 10 }}>
            <SegmentedControl options={TAB_OPTIONS} value={tab} onChange={setTab} />
          </div>
          {tab === "correlation" && <CorrelationView m={m} />}
          {tab === "splom" && <SplomTabView m={m} />}
          {tab === "pca" && <PcaView m={m} />}
        </>
      )}
    </ToolWindow>
  );
}
