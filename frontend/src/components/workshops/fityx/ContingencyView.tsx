// Fit Y by X — contingency leg's view: categorical X x categorical Y. A
// mosaic plot (JMP_GAP J3 residual), a counts cross-tab (with row/col
// totals) built client-side from the two columns' resolved levels, the
// expected-count table, chi-square independence, and Fisher's exact test on
// a 2x2 table. Honest about small expected counts (low_expected) rather
// than hiding the chi-square caveat.

import { fmtNum } from "../../../lib/format";
import { DataTable, StatusDot } from "../../primitives";
import MosaicPlot from "./MosaicPlot";
import type { ContingencyResult } from "./useFitYByX";

export default function ContingencyView({ result }: { result: ContingencyResult }) {
  const { rowLabels, colLabels, table, chiSquare, fisher } = result;
  const expected = (chiSquare.expected as number[][] | undefined) ?? [];
  const rowTotals = table.map((row) => row.reduce((a, b) => a + b, 0));
  const colTotals = colLabels.map((_, j) => table.reduce((a, row) => a + row[j], 0));
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

  return (
    <>
      <MosaicPlot rowLabels={rowLabels} colLabels={colLabels} table={table} />

      <div className="qzk-field-lbl" style={{ marginTop: 8 }}>
        Counts
      </div>
      <div style={{ overflowX: "auto" }}>
        <DataTable
          columns={["", ...colLabels, "Total"]}
          rows={[
            ...table.map((row, i) => [rowLabels[i], ...row.map(String), String(rowTotals[i])]),
            ["Total", ...colTotals.map(String), String(grandTotal)],
          ]}
        />
      </div>

      <div className="qzk-field-lbl" style={{ marginTop: 10 }}>
        Expected (under independence)
      </div>
      <div style={{ overflowX: "auto" }}>
        <DataTable
          columns={["", ...colLabels]}
          rows={rowLabels.map((rl, i) => [rl, ...(expected[i] ?? []).map((v) => fmtNum(v))])}
        />
      </div>

      {Boolean(chiSquare.low_expected) && (
        <div style={{ marginTop: 8 }}>
          <StatusDot
            tone="warn"
            label={`${String(chiSquare.low_expected_count)} cell(s) have expected count < 5 — chi-square may be unreliable${
              rowLabels.length === 2 && colLabels.length === 2 ? "; consider Fisher's exact below" : ""
            }`}
          />
        </div>
      )}

      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <DataTable
          columns={["chi²", "dof", "p", "Cramér's V"]}
          rows={[[
            fmtNum(chiSquare.chi2),
            String(chiSquare.dof),
            fmtNum(chiSquare.p_value),
            fmtNum(chiSquare.cramers_v),
          ]]}
        />
      </div>

      {fisher && (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <div className="qzk-field-lbl">Fisher's exact (2x2)</div>
          <DataTable
            columns={["odds ratio", "p"]}
            rows={[[fmtNum(fisher.odds_ratio), fmtNum(fisher.p_value)]]}
          />
        </div>
      )}
    </>
  );
}
