// Statistical tests workshop — view. One ToolWindow for the tests the Test
// chooser does not cover: normality (Anderson-Darling, KS), two-sample and
// paired comparisons, Dunnett / Friedman / repeated-measures / two-way ANOVA,
// multiple and stepwise regression, partial correlation, and t-test power.
// Pick a test and its columns, Run, read one plain-language sentence plus the
// results table, then Copy / Export CSV / → Report. All state lives in
// useStatsTests; the pickers are StatsTestsInputs.

import type { StatsTestId } from "../../../lib/api/statsTests";
import { fmtNum } from "../../../lib/format";
import { STATS_TESTS } from "../../../lib/statsTests";
import type { TestOutput } from "../../../lib/statsTestsResults";
import { useStatsTestsStore } from "../../../store/statsTests";
import ToolWindow from "../../overlays/ToolWindow";
import { DataTable } from "../../primitives/DataTable";
import { Button, Select } from "../../primitives";
import StatsTestsInputs from "./StatsTestsInputs";
import { useStatsTests } from "./useStatsTests";

const TEST_OPTIONS = STATS_TESTS.map((t) => ({ value: t.id, label: `${t.family} — ${t.label}` }));
const faint = { color: "var(--text-faint)" } as const;

function Results({ output }: { output: TestOutput }) {
  return (
    <>
      <div style={{ marginTop: 10, fontWeight: 600 }}>{output.sentence}</div>
      {output.tables.map((table, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          {table.title && <div className="qzk-field-lbl">{table.title}</div>}
          <DataTable
            columns={table.columns}
            rows={table.rows.map((r) => r.map((v) => (typeof v === "number" ? fmtNum(v) : (v ?? "—"))))}
          />
        </div>
      ))}
    </>
  );
}

export default function StatsTestsPanel() {
  const setOpen = useStatsTestsStore((s) => s.setOpen);
  const t = useStatsTests();

  return (
    <ToolWindow id="stats-tests" title="Statistical tests" width={440} onClose={() => setOpen(false)}>
      <label className="qzk-field-lbl">Test</label>
      <Select
        aria-label="Test"
        options={TEST_OPTIONS}
        value={t.testId}
        onChange={(e) => t.setTestId(e.target.value as StatsTestId)}
      />
      <div className="qzk-ds-meta" style={{ ...faint, marginTop: 4 }}>
        {t.def.blurb}
      </div>

      <StatsTestsInputs t={t} />

      <div style={{ marginTop: 10 }}>
        <Button
          variant="primary"
          size="sm"
          disabled={t.busy || (t.def.input !== "none" && !t.active)}
          onClick={() => void t.run()}
        >
          Run test
        </Button>
        {t.busy && (
          <span className="qzk-ds-meta" style={{ ...faint, marginLeft: 8 }}>
            running…
          </span>
        )}
      </div>

      {t.error && (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--danger)" }}>
          {t.error}
        </div>
      )}

      {t.output && (
        <>
          <Results output={t.output} />
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <Button size="sm" onClick={() => void t.copy()} title="Copy the sentence and tables as tab-separated text.">
              Copy table
            </Button>
            <Button size="sm" onClick={t.exportCsv} title="Save the sentence and tables as a CSV file.">
              Export CSV
            </Button>
            <Button size="sm" disabled={t.busy} onClick={() => void t.toReport()}>
              → Report
            </Button>
          </div>
        </>
      )}
    </ToolWindow>
  );
}
