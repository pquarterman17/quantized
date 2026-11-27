// Multivariate workbench (JMP_GAP J10) — view. A draggable ToolWindow: pick
// 2+ continuous columns, then switch between a correlation heatmap, a SPLOM,
// and PCA (scree/scores/loadings/biplot) over the SAME listwise-complete row
// set (useMultivar). Thin — fetching + shared row math live in the hook;
// each tab is its own sub-component; the result reads as one result book
// (lane RB4, MultivarResultBook).
//
// Residual (JMP_GAP_PLAN #10, item 6): matplotlib export parity for these
// views (a `figure_multivar` renderer) is explicitly NOT attempted here —
// only the "copy TSV" correlation-matrix export item 6 requires as a floor.

import { lazy, Suspense, useEffect, useState } from "react";

import ToolWindow from "../../overlays/ToolWindow";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { useMultivarStore } from "../../../store/multivar";
import StatsInputReview from "../analysisselection/StatsInputReview";
import { multivarRows } from "../analysisselection/statsInputReviewRows";
import ColumnPicker from "./ColumnPicker";
import CorrelationView from "./CorrelationView";
import MultivarResultBook from "./MultivarResultBook";
import PcaView from "./PcaView";
import SplomTabView from "./SplomTabView";
import { useMultivar } from "./useMultivar";

// PLS / LDA / spectra PCA (G12): its own chunk, loaded when the tab is first opened.
const MultivarExtTab = lazy(() => import("./ext/MultivarExtTab"));

// Clustering (item 11): likewise its own chunk.
const ClusterTab = lazy(() => import("./cluster/ClusterTab"));

type Tab = "correlation" | "splom" | "pca" | "ext" | "cluster";
const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: "correlation", label: "Correlation" },
  { value: "splom", label: "SPLOM" },
  { value: "pca", label: "PCA" },
  { value: "ext", label: "PLS / LDA" },
  { value: "cluster", label: "Clustering" },
];

export default function MultivarPanel() {
  const setOpen = useMultivarStore((s) => s.setOpen);
  const m = useMultivar();
  const launch = useMultivarStore((s) => s.launch);
  const [tab, setTab] = useState<Tab>(launch?.tab ?? "correlation");
  // A typed launch (PLS, LDA from the palette) while the panel is already open.
  useEffect(() => { if (launch) setTab(launch.tab); }, [launch]);

  return (
    <ToolWindow id="multivar" title="Multivariate" width={480} onClose={() => setOpen(false)}>
      {!m.hasData ? (
        <div className="qzk-helptext" style={{ color: "var(--text-faint)" }}>
          Select a dataset to explore.
        </div>
      ) : (
        <>
          <StatsInputReview inputs={m.inputs} rows={multivarRows(m.inputs, m)} />
          <ColumnPicker m={m} />
          <div style={{ marginTop: 10 }}>
            <MultivarResultBook m={m} view={<>
              <SegmentedControl options={TAB_OPTIONS} value={tab} onChange={setTab} />
              {tab === "correlation" && <CorrelationView m={m} />}
              {tab === "splom" && <SplomTabView m={m} />}
              {tab === "pca" && <PcaView m={m} />}
              {tab === "ext" && <Suspense fallback={null}><MultivarExtTab m={m} /></Suspense>}
              {tab === "cluster" && <Suspense fallback={null}><ClusterTab m={m} /></Suspense>}
            </>} />
          </div>
          {m.saveResultDisabledReason && (
            <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
              {m.saveResultDisabledReason}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}
