// Multivariate workbench (JMP_GAP J10) — correlation tab: pearson/spearman
// toggle, the CorrelationMatrix heatmap, a copy-TSV export (item 6's floor —
// matplotlib export parity for this platform is an explicit residual, see
// JMP_GAP_PLAN #10), and the busy/error/too-few-rows states.

import { copyText } from "../../../lib/clipboard";
import { Button, SegmentedControl } from "../../primitives";
import { useApp } from "../../../store/useApp";
import CorrelationMatrix from "./CorrelationMatrix";
import type { CorrMethod, MultivarState } from "./useMultivar";

const METHOD_OPTIONS: { value: CorrMethod; label: string }[] = [
  { value: "pearson", label: "Pearson" },
  { value: "spearman", label: "Spearman" },
];

export default function CorrelationView({ m }: { m: MultivarState }) {
  const setStatus = useApp((s) => s.setStatus);

  async function copy(): Promise<void> {
    const ok = await copyText(m.toTSV());
    setStatus(ok ? `copied ${m.labels.length}×${m.labels.length} correlation matrix to clipboard` : "clipboard unavailable");
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <SegmentedControl options={METHOD_OPTIONS} value={m.method} onChange={m.setMethod} />
        <Button size="sm" disabled={!m.corr} onClick={() => void copy()}>
          Copy TSV
        </Button>
      </div>

      {m.corrBusy ? (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          computing…
        </div>
      ) : m.corrError ? (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          {m.corrError}
        </div>
      ) : m.corr ? (
        <>
          <div style={{ marginTop: 10 }}>
            <CorrelationMatrix labels={m.labels} corr={m.corr} />
          </div>
          <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
            N = {m.corr.N} complete rows · {m.corr.method}
          </div>
        </>
      ) : null}
    </div>
  );
}
